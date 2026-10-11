// A picture of an atrium for the atrium browser's cards: what was on screen
// when its owner or an admin last left it, drawn from the traces
// (lib/exportImage) small, as WebP, and kept with the atrium (lobbies.preview_url,
// preview_at -- add_lobby_preview.sql).
//
// Made only when something in the atrium changed since the last one (or there
// isn't one), at most every few minutes, and never in the way: after leaving,
// once the browser is idle. Everything it needs is taken as the atrium is left,
// since the store is cleared straight after.
//
// One file an atrium, <id>/preview.webp, rewritten each time (on the web the
// atrium's owner and admins may overwrite it -- add_lobby_preview.sql), so no
// old picture is left behind. Its web address carries when it was made, so
// what's cached of the last one isn't shown for it.

import { supabase, isDesktop } from './supabase'
import { exportImage } from './exportImage'
import type { Layer, Trace } from '../types/database'
import type { TraceLink } from './traceLinks'

const MAX_SIDE = 960
// Not again within this long of the last, changed or not (ms).
const AT_MOST_EVERY = 3 * 60 * 1000
const memoryKey = (lobbyId: string) => `atrium.preview.${lobbyId}`

export interface PreviewDetail { lobbyId: string; url: string; at: string }

// What the atrium holds, as one number: a change to any trace changes it.
function fingerprint(traces: Trace[]): string {
  let hash = 0x811c9dc5
  const add = (text: string) => {
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  }
  for (const t of traces) add(`${t.id}|${t.x}|${t.y}|${t.width}|${t.height}|${t.scaleX ?? t.scale}|${t.scaleY ?? t.scale}|${t.rotation}|${t.content?.length}|${t.mediaUrl ?? ''}|`)
  return `${traces.length}:${(hash >>> 0).toString(36)}`
}

/** Take what's needed as the atrium is left; make the picture after, if it's due. */
export function captureAtriumPreview(lobbyId: string, traces: Trace[], links: TraceLink[], layers: Layer[], background: string) {
  if (!supabase || traces.length === 0) return
  const print = fingerprint(traces)
  let last: { print: string; at: number } | null = null
  try { last = JSON.parse(localStorage.getItem(memoryKey(lobbyId)) || 'null') } catch { /* none */ }
  if (last && (last.print === print || Date.now() - last.at < AT_MOST_EVERY)) return

  // On screen as it's left: the traces whose boxes meet the window, and a
  // frame's whole contents with it (else its off-screen part stands empty).
  // All of them, where none do.
  const shown = new Set<string>()
  for (const el of document.querySelectorAll<HTMLElement>('[data-trace-id]')) {
    const r = el.getBoundingClientRect()
    if (r.width && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight) shown.add(el.dataset.traceId!)
  }
  const inView = traces.filter(trace => shown.has(trace.id) || (trace.frameId && shown.has(trace.frameId)))
  const pictured = inView.length ? inView : traces

  const make = () => void makePreview(lobbyId, pictured, links, layers, background, print)
  if ('requestIdleCallback' in window) requestIdleCallback(make, { timeout: 4000 })
  else setTimeout(make, 1500)
}

async function makePreview(lobbyId: string, traces: Trace[], links: TraceLink[], layers: Layer[], background: string, print: string) {
  if (!supabase) return
  try {
    const { blob } = await exportImage(traces, links, layers, { format: 'png', scale: 1, background, maxSide: MAX_SIDE, type: 'image/webp', quality: 0.8 })
    const path = `${lobbyId}/preview.webp`
    const { error } = await supabase.storage.from('traces').upload(path, blob, { contentType: 'image/webp', upsert: true })
    if (error) return
    const stored: string = supabase.storage.from('traces').getPublicUrl(path).data.publicUrl
    // The vault's file was rewritten in place: what it's read as, read again.
    if (isDesktop) await (await import('./localDb')).refreshLocalUrl(stored)
    const url = isDesktop ? stored : `${stored}?v=${Date.now()}`
    const at = new Date().toISOString()
    const { error: saved } = await (supabase.from('lobbies') as any).update({ preview_url: url, preview_at: at }).eq('id', lobbyId)
    if (saved) return
    try { localStorage.setItem(memoryKey(lobbyId), JSON.stringify({ print, at: Date.now() })) } catch { /* the next leave tries again */ }
    window.dispatchEvent(new CustomEvent<PreviewDetail>('atrium:preview', { detail: { lobbyId, url, at } }))
  } catch (error) {
    console.warn('[preview] not made:', error)
  }
}
