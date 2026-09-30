// A drawing's strokes as files and as rows: saved, loaded, deleted, brought
// back and recoloured. Drawing mode (LobbyScene) and a stroke's colour
// changed afterwards (StrokeColourField) both go through here.
//
// Everything a drawing does is written at once, as each stroke is -- a
// stroke taken away (undone, erased entirely, cleared) is deleted then and
// there, and put back as the same row -- rather than waiting for Save.

import { supabase, isDesktop } from './supabase'
import { useGameStore } from '../store/gameStore'
import type { Trace } from '../types/database'
import { isDrawingTrace, pictureSize, tintPicture, type Picture, type Piece, type TracePlacement } from './brushes'
import { buildTraceInsertRow } from './traceInsert'
import { adoptTraces } from './layerUndo'
import { recordAction } from './actionHistory'

// Every stroke's picture, by its file's address: painted here, or loaded.
const pictures = new Map<string, Picture>()
export const cachedPicture = (url: string) => pictures.get(url)

// A picture's file: drawing_<user>_<time>.png (isDrawingTrace knows a drawing
// by it), or the picture in the row as a data URL if the upload fails.
// Remembered by its address, so it's painted from here, not fetched.
export async function saveDrawingPicture(picture: Picture, lobbyId: string, userId: string | null): Promise<string> {
  const canvas = picture instanceof HTMLCanvasElement ? picture : tintPicture(picture, null)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  let url = ''
  if (blob && supabase) {
    const storagePath = `${lobbyId}/drawing_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`
    const { error } = await supabase.storage.from('traces').upload(storagePath, blob, { contentType: 'image/png' })
    if (error) console.error('Storage upload failed, falling back to data URL:', error)
    else url = supabase.storage.from('traces').getPublicUrl(storagePath).data.publicUrl
  }
  if (!url) url = canvas.toDataURL('image/png')
  pictures.set(url, canvas)
  // Fetched ahead, so it's there when the trace shows it.
  if (/^https?:/.test(url)) new Image().src = url
  return url
}

// A drawing's picture from its file, readable back from a canvas (the eraser
// and the recolouring read it): from the vault as a blob on desktop, and on
// the web with CORS, falling back to the site's own image proxy. Null if it
// can't be had.
export async function loadDrawingPicture(mediaUrl: string): Promise<Picture | null> {
  const known = pictures.get(mediaUrl)
  if (known) return known
  const load = (src: string, crossOrigin: boolean) => new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
  let img: HTMLImageElement | null = null
  if (mediaUrl.startsWith('local://')) {
    const { resolveLocalUrl } = await import('./localDb')
    const resolved = await resolveLocalUrl(mediaUrl)
    if (!resolved.startsWith('local://')) img = await load(resolved, false)
  } else if (mediaUrl.startsWith('data:')) {
    img = await load(mediaUrl, false)
  } else {
    img = await load(mediaUrl, true)
      ?? (isDesktop ? null : await load(`/api/proxy-image?url=${encodeURIComponent(mediaUrl)}`, false))
  }
  if (!img || !img.naturalWidth) return null
  pictures.set(mediaUrl, img)
  return img
}

// Where a stroke trace's picture is in the world, as TraceOverlay lays it out
// (storedTransformOf, getTraceSize).
export function placementOf(trace: Trace, picture: Picture): TracePlacement {
  const natural = pictureSize(picture)
  const fit = Math.min(1, 300 / Math.max(1, natural.width, natural.height))
  const sized = !!(trace.width && trace.height)
  return {
    cx: trace.x, cy: trace.y, rotation: trace.rotation ?? 0,
    flipH: !!trace.flipHorizontal, flipV: !!trace.flipVertical,
    width: sized ? trace.width! : Math.round(natural.width * fit),
    height: sized ? trace.height! : Math.round(natural.height * fit),
    scaleX: trace.scaleX ?? trace.scale ?? 1, scaleY: trace.scaleY ?? trace.scale ?? 1,
    cropX: trace.cropX ?? 0, cropY: trace.cropY ?? 0, cropWidth: trace.cropWidth ?? 1, cropHeight: trace.cropHeight ?? 1,
  }
}

export type PictureFields = Pick<Trace, 'mediaUrl' | 'x' | 'y' | 'width' | 'height' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'flipHorizontal' | 'flipVertical' | 'cropX' | 'cropY' | 'cropWidth' | 'cropHeight'>

// A stroke's picture and where it is -- all of it in the picture: nothing
// scaled, turned, flipped or cropped.
export const pieceFields = (piece: Piece, mediaUrl: string): PictureFields => ({
  mediaUrl, x: piece.placement.cx, y: piece.placement.cy, width: piece.placement.width, height: piece.placement.height,
  scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipHorizontal: false, flipVertical: false,
  cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1,
})

export const pictureFieldsOf = (t: Trace): PictureFields => ({
  mediaUrl: t.mediaUrl, x: t.x, y: t.y, width: t.width, height: t.height, scale: t.scale, scaleX: t.scaleX, scaleY: t.scaleY,
  rotation: t.rotation, flipHorizontal: t.flipHorizontal, flipVertical: t.flipVertical,
  cropX: t.cropX, cropY: t.cropY, cropWidth: t.cropWidth, cropHeight: t.cropHeight,
})

const COLUMNS: Record<keyof PictureFields, string> = {
  mediaUrl: 'media_url', x: 'position_x', y: 'position_y', width: 'width', height: 'height',
  scale: 'scale', scaleX: 'scale_x', scaleY: 'scale_y', rotation: 'rotation',
  flipHorizontal: 'flip_horizontal', flipVertical: 'flip_vertical',
  cropX: 'crop_x', cropY: 'crop_y', cropWidth: 'crop_width', cropHeight: 'crop_height',
}

// The fields given, as columns.
export const pictureRow = (fields: Partial<PictureFields>) =>
  Object.fromEntries(Object.entries(fields).map(([key, value]) => [COLUMNS[key as keyof PictureFields], value ?? null]))

// A stroke given (some of) these fields: in the store and the database at once.
export async function writePicture(traceId: string, fields: Partial<PictureFields>): Promise<void> {
  const current = useGameStore.getState().traces.find(t => t.id === traceId)
  if (current) useGameStore.getState().addTrace({ ...current, ...fields })
  if (!supabase) return
  const { error } = await (supabase.from('traces') as any).update(pictureRow(fields)).eq('id', traceId)
  if (error) console.error('[drawing] could not save a stroke:', error)
}

// Strokes taken away: from the store, and deleted from the database now,
// with nothing of theirs left waiting for Save.
export async function dropStrokes(gone: Trace[]): Promise<void> {
  if (gone.length === 0) return
  const store = useGameStore.getState()
  for (const t of gone) {
    store.removeTrace(t.id)
    store.markTraceDeleted(t.id)
    store.unmarkTraceDeleted(t.id)
  }
  if (!supabase) return
  const { error } = await (supabase.from('traces') as any).delete().in('id', gone.map(t => t.id))
  if (error) console.error('[drawing] could not delete strokes:', error)
}

// Strokes put back as they were, the same rows, ids and all. Their own step
// already, so TraceOverlay isn't to record them arriving (adoptTraces).
//
// On desktop a deleted row's file goes from the vault with it (localDb
// removeOrphanedTraceMedia), so a stroke's picture is written again, from
// the one kept here, and the row points at that.
export async function restoreStrokes(back: Trace[]): Promise<void> {
  if (back.length === 0) return
  back = await Promise.all(back.map(async t => {
    const picture = t.mediaUrl?.startsWith('local://') ? pictures.get(t.mediaUrl) : undefined
    return picture && t.lobbyId ? { ...t, mediaUrl: await saveDrawingPicture(picture, t.lobbyId, t.userId) } : t
  }))
  adoptTraces(back.map(t => t.id))
  for (const t of back) useGameStore.getState().addTrace(t)
  if (!supabase) return
  for (const t of back) {
    const { error } = await (supabase.from('traces') as any)
      .insert({ ...buildTraceInsertRow(t, t.userId, t.username, t.lobbyId ?? undefined, 0, 0), id: t.id, is_locked: !!t.isLocked })
    if (error) console.error('[drawing] could not put a stroke back:', error)
  }
}

// Strokes painted over in `colour`, their shading kept (tintPicture): each a
// new file, all of it one step of undo. False when none of them could be.
export async function recolourStrokes(traceIds: string[], colour: string, lobbyId: string, userId: string | null): Promise<boolean> {
  const changes: { id: string; before: string; after: string }[] = []
  for (const id of traceIds) {
    const trace = useGameStore.getState().traces.find(t => t.id === id)
    if (!trace?.mediaUrl || !isDrawingTrace(trace)) continue
    const picture = await loadDrawingPicture(trace.mediaUrl)
    if (!picture) continue
    changes.push({ id, before: trace.mediaUrl, after: await saveDrawingPicture(tintPicture(picture, colour), lobbyId, userId) })
  }
  if (changes.length === 0) return false
  const put = (which: 'before' | 'after') => Promise.all(changes.map(c => writePicture(c.id, { mediaUrl: c[which] }))).then(() => {})
  await put('after')
  recordAction({ label: 'stroke colour', undo: () => put('before'), redo: () => put('after') })
  return true
}
