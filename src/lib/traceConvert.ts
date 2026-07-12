import { supabase, isDesktop } from './supabase'
import { useGameStore } from '../store/gameStore'
import { isUrlAnImage } from './imageDetection'

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
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Could not download this image (HTTP ${res.status})`)
    const blob = await res.blob()
    const ext = inferExtension(url, blob.type || res.headers.get('content-type'))
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
