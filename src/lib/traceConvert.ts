import { supabase, isDesktop } from './supabase'
import { useGameStore } from '../store/gameStore'
import { isUrlAnImage } from './imageDetection'

// What the bytes actually are, from the bytes themselves.
//
// More trustworthy than either the URL or a content-type header: plenty of
// image URLs carry no extension, and plenty of hosts label everything
// application/octet-stream. Only the formats worth storing are recognised;
// anything else falls back to the URL's own extension.
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null
  const [a, b, c, d] = bytes
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return 'image/png'
  if (a === 0xff && b === 0xd8 && c === 0xff) return 'image/jpeg'
  if (a === 0x47 && b === 0x49 && c === 0x46) return 'image/gif'
  if (a === 0x42 && b === 0x4d) return 'image/bmp'
  if (
    a === 0x52 && b === 0x49 && c === 0x46 && d === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp'
  return null
}

// Fetches the image behind an embed.
//
// On desktop this goes through Rust rather than the webview. Reading another
// origin's bytes from a page is governed by CORS, and a host that doesn't send
// the header refuses it -- which is why converting worked on some embeds and
// not others, with nothing wrong on our side. Rust isn't a browser, so the same
// request simply succeeds. The command guards against being pointed at private
// addresses; see download_remote_image.
//
// The web keeps using fetch, where there is no way around CORS. Those hosts
// stay unconvertible there, which is the browser's security model working.
async function downloadImage(url: string): Promise<Blob> {
  if (isDesktop) {
    // Imported here rather than at the top: this module runs on the web too,
    // and the Tauri API has no business in that bundle.
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke<ArrayBuffer | number[]>('download_remote_image', { url })
    const bytes = result instanceof ArrayBuffer
      ? new Uint8Array(result)
      : ArrayBuffer.isView(result)
        ? new Uint8Array((result as ArrayBufferView).buffer)
        : Uint8Array.from(result as number[])
    // Copied into a fresh ArrayBuffer so the Blob has a definitely-not-shared
    // backing store, which is what BlobPart requires.
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return new Blob([copy.buffer], { type: sniffImageMime(bytes) ?? '' })
  }

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download this image (HTTP ${res.status})`)
  return res.blob()
}

function inferExtension(url: string, contentType: string | null): string {
  const fromUrl = url.split('?')[0].split('.').pop()
  if (fromUrl && fromUrl.length <= 4 && /^[a-zA-Z0-9]+$/.test(fromUrl)) return fromUrl.toLowerCase()
  if (contentType?.includes('jpeg')) return 'jpg'
  if (contentType?.includes('png')) return 'png'
  if (contentType?.includes('gif')) return 'gif'
  if (contentType?.includes('webp')) return 'webp'
  if (contentType?.includes('svg')) return 'svg'
  return 'png'
}

// Downloads an embed trace's underlying image and re-saves it as an internal
// `image` trace: on desktop this writes into the user's configured Vault
// folder (same upload path TracePanel.tsx uses for new image uploads); on
// web it uploads to Supabase Storage, since that's available on both
// platforms and gives the same "no longer dependent on an external host"
// result without needing local filesystem access.
export async function convertEmbedToInternalImage(traceId: string): Promise<{ ok: boolean; error?: string }> {
  const store = useGameStore.getState()
  const trace = store.traces.find(t => t.id === traceId)
  if (!trace) return { ok: false, error: 'Trace not found' }
  if (trace.type !== 'embed') return { ok: false, error: 'Only embed traces can be converted' }

  const url = trace.mediaUrl || trace.imageUrl
  if (!url) return { ok: false, error: 'This trace has no media URL' }

  const isImage = await isUrlAnImage(url)
  if (!isImage) return { ok: false, error: 'This embed does not appear to be a direct image' }

  if (!supabase) return { ok: false, error: 'Storage is not available' }

  try {
    const blob = await downloadImage(url)
    const ext = inferExtension(url, blob.type || null)
    const fileName = `${store.userId}_${Date.now()}.${ext}`

    let finalUrl: string
    if (isDesktop) {
      const storagePath = `${trace.lobbyId ?? 'unfiled'}/${fileName}`
      const localUrl = `local://traces/${storagePath}`
      const blobUrl = URL.createObjectURL(blob)
      const localDb = await import('./localDb')
      localDb.preCacheLocalUrl(localUrl, blobUrl)
      const { error: uploadError } = await supabase.storage.from('traces').upload(storagePath, blob)
      if (uploadError) throw uploadError
      finalUrl = localUrl
    } else {
      const { error: uploadError } = await supabase.storage.from('traces').upload(fileName, blob)
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('traces').getPublicUrl(fileName)
      finalUrl = data.publicUrl
    }

    const current = useGameStore.getState().traces.find(t => t.id === traceId)
    if (current) {
      useGameStore.getState().addTrace({ ...current, type: 'image', mediaUrl: finalUrl })
      useGameStore.getState().markTraceChanged(traceId)
    }
    return { ok: true }
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Could not download this image (it may be blocked by the source site). Try opening it in a browser and saving manually.',
    }
  }
}
