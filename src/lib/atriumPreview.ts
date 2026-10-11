// A picture of an atrium for the atrium browser's cards: the view its owner or
// an admin last left it at, as it was seen -- the room (its colour, its
// picture, the canvas's ground, grid and particles: RoomSnapshot) and over it
// the traces, drawn from their data (lib/exportImage) -- small, as WebP, and
// kept with the atrium (lobbies.preview_url, preview_at -- add_lobby_preview.sql).
//
// Made only when something in the atrium or its look changed since the last
// one (or there isn't one), at most every few minutes, and never in the way:
// after leaving, once the browser is idle. Everything it needs is taken as the
// atrium is left, since the canvas and the store are gone straight after.
//
// One file an atrium, <id>/preview.webp, rewritten each time (on the web the
// atrium's owner and admins may overwrite it -- add_lobby_preview.sql), so no
// old picture is left behind. Its web address carries when it was made, so
// what's cached of the last one isn't shown for it.

import { supabase, isDesktop } from './supabase'
import { exportImage, loadPicture } from './exportImage'
import type { Layer, Trace } from '../types/database'
import type { TraceLink } from './traceLinks'

const MAX_SIDE = 960
// Not again within this long of the last, changed or not (ms).
const AT_MOST_EVERY = 3 * 60 * 1000
const memoryKey = (lobbyId: string) => `atrium.preview.${lobbyId}`

export interface PreviewDetail { lobbyId: string; url: string; at: string }

// The room as it's seen, read by the scene as the atrium is left. A point of
// the world at (x, y) is on screen at (x * zoom + view.x, y * zoom + view.y).
export interface RoomSnapshot {
  width: number
  height: number
  view: { x: number; y: number; zoom: number }
  colour: string
  // Its picture, placed as on screen (in screen pixels): repeated from (x, y)
  // in tiles w by h, or one picture there; as strong as `opacity`.
  picture: { url: string; x: number; y: number; w: number; h: number; repeat: boolean; opacity: number } | null
  // The canvas's ground, grid and particles, shrunk to the preview's size.
  layer: HTMLCanvasElement | null
}

export interface AtriumAsLeft {
  traces: Trace[]
  links: TraceLink[]
  layers: Layer[]
  // How it looks (its theme, as text): a change to it is a change too.
  look: string
  // Its colour, where there's no room to picture.
  background: string
  room: (maxSide: number) => RoomSnapshot | null
}

// What the atrium holds and how it looks, as one number: a change to any
// trace, or to its look, changes it.
function fingerprint(traces: Trace[], look: string): string {
  let hash = 0x811c9dc5
  const add = (text: string) => {
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  }
  for (const t of traces) add(`${t.id}|${t.x}|${t.y}|${t.width}|${t.height}|${t.scaleX ?? t.scale}|${t.scaleY ?? t.scale}|${t.rotation}|${t.content?.length}|${t.mediaUrl ?? ''}|`)
  add(look)
  return `${traces.length}:${(hash >>> 0).toString(36)}`
}

/** Take what's needed as the atrium is left; make the picture after, if it's due. */
export function captureAtriumPreview(lobbyId: string, atrium: AtriumAsLeft) {
  const { traces, links, layers, background } = atrium
  if (!supabase || traces.length === 0) return
  const print = fingerprint(traces, atrium.look)
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
  // The view as it's seen, where any of the atrium is in it; else all of it,
  // on its colour.
  const room = inView.length ? atrium.room(MAX_SIDE) : null
  const pictured = inView.length ? inView : traces

  const make = () => void makePreview(lobbyId, pictured, links, layers, room, background, print)
  if ('requestIdleCallback' in window) requestIdleCallback(make, { timeout: 4000 })
  else setTimeout(make, 1500)
}

async function makePreview(lobbyId: string, traces: Trace[], links: TraceLink[], layers: Layer[], room: RoomSnapshot | null, background: string, print: string) {
  if (!supabase) return
  try {
    const { blob } = await exportImage(traces, links, layers, {
      format: 'png', scale: 1, background, maxSide: MAX_SIDE, type: 'image/webp', quality: 0.8,
      ...(room && {
        frame: { x: -room.view.x / room.view.zoom, y: -room.view.y / room.view.zoom, width: room.width / room.view.zoom, height: room.height / room.view.zoom },
        underlay: await roomPicture(room),
      }),
    })
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

// The room under the traces, as it was seen: its colour; its picture as
// placed, under a veil of the colour as strong as the picture is faint (as
// the scene's backdrop paints it); then the canvas's own layers.
async function roomPicture(room: RoomSnapshot): Promise<HTMLCanvasElement> {
  const k = Math.min(1, MAX_SIDE / Math.max(room.width, room.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(room.width * k))
  canvas.height = Math.max(1, Math.round(room.height * k))
  const ctx = canvas.getContext('2d')!
  ctx.scale(k, k)
  ctx.fillStyle = room.colour
  ctx.fillRect(0, 0, room.width, room.height)
  const placed = room.picture
  const picture = placed && await loadPicture(placed.url)
  if (placed && picture) {
    if (placed.repeat) {
      const tiles = ctx.createPattern(picture.source, 'repeat')
      tiles?.setTransform(new DOMMatrix([placed.w / picture.width, 0, 0, placed.h / picture.height, placed.x, placed.y]))
      ctx.fillStyle = tiles ?? room.colour
      ctx.fillRect(0, 0, room.width, room.height)
    } else {
      ctx.drawImage(picture.source, placed.x, placed.y, placed.w, placed.h)
    }
    ctx.globalAlpha = 1 - placed.opacity
    ctx.fillStyle = room.colour
    ctx.fillRect(0, 0, room.width, room.height)
    ctx.globalAlpha = 1
  }
  if (room.layer) ctx.drawImage(room.layer, 0, 0, room.width, room.height)
  return canvas
}
