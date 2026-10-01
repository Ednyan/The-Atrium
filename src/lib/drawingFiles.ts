// A drawing's strokes as files and as rows: saved, loaded, deleted, brought
// back, changed after they're drawn, and split apart. Drawing mode
// (LobbyScene), a stroke's look changed afterwards (StrokeStyleField) and
// Split into Strokes (TraceOverlay) all go through here.
//
// Everything a drawing does is written at once, as each stroke is -- a
// stroke taken away (undone, erased entirely, cleared) is deleted then and
// there, and put back as the same row -- rather than waiting for Save.

import { supabase, isDesktop } from './supabase'
import { useGameStore } from '../store/gameStore'
import type { Trace } from '../types/database'
import { asStrokeData, fitBox, isDrawingTrace, localToWorldDelta, nextRev, pictureSize, renderStrokeData, splitStrokes, tintPicture, type Picture, type Piece, type Stroke, type StrokeData, type TracePlacement } from './brushes'
import { buildTraceInsertRow, traceRow } from './traceInsert'
import { adoptTraces, withLayerUndo } from './layerUndo'
import { queueLayerChange } from './layerQueue'
import { recordAction } from './actionHistory'
import { createGroup } from '../hooks/useLayers'
import { keysAt, keysBetween } from './order'
import { mapRowToTrace } from '../hooks/useTraces'

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
// (storedTransformOf, getTraceSize). The picture only for a trace with no size
// of its own, which a stroke always has.
export function placementOf(trace: Trace, picture?: Picture): TracePlacement {
  const natural = picture ? pictureSize(picture) : { width: 1, height: 1 }
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

export type PictureFields = Pick<Trace, 'mediaUrl' | 'strokeData' | 'x' | 'y' | 'width' | 'height' | 'scale' | 'scaleX' | 'scaleY' | 'rotation' | 'flipHorizontal' | 'flipVertical' | 'cropX' | 'cropY' | 'cropWidth' | 'cropHeight'>

// A stroke's picture and where it is -- all of it in the picture: nothing
// scaled, turned, flipped or cropped.
export const pieceFields = (piece: Piece, mediaUrl: string): PictureFields => ({
  mediaUrl, strokeData: piece.data ?? null, x: piece.placement.cx, y: piece.placement.cy, width: piece.placement.width, height: piece.placement.height,
  scale: 1, scaleX: 1, scaleY: 1, rotation: 0, flipHorizontal: false, flipVertical: false,
  cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1,
})

export const pictureFieldsOf = (t: Trace): PictureFields => ({
  mediaUrl: t.mediaUrl, strokeData: t.strokeData ?? null, x: t.x, y: t.y, width: t.width, height: t.height, scale: t.scale, scaleX: t.scaleX, scaleY: t.scaleY,
  rotation: t.rotation, flipHorizontal: t.flipHorizontal, flipVertical: t.flipVertical,
  cropX: t.cropX, cropY: t.cropY, cropWidth: t.cropWidth, cropHeight: t.cropHeight,
})

const COLUMNS: Record<keyof PictureFields, string> = {
  mediaUrl: 'media_url', strokeData: 'stroke_data', x: 'position_x', y: 'position_y', width: 'width', height: 'height',
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
// removeOrphanedTraceMedia): a kept drawing is marked changed, so its file is
// made again from what's kept (and painted from that meanwhile); a picture
// alone is written again from the copy held here, and the row points at that.
export async function restoreStrokes(back: Trace[]): Promise<void> {
  if (back.length === 0) return
  back = await Promise.all(back.map(async t => {
    const data = asStrokeData(t.strokeData)
    if (data) return { ...t, strokeData: { ...data, rev: nextRev() } }
    const picture = t.mediaUrl?.startsWith('local://') ? pictures.get(t.mediaUrl) : undefined
    return picture && t.lobbyId ? { ...t, mediaUrl: await saveDrawingPicture(picture, t.lobbyId, t.userId) } : t
  }))
  adoptTraces(back.map(t => t.id))
  for (const t of back) useGameStore.getState().addTrace(t)
  if (!supabase) return
  for (const t of back) {
    const { error } = await (supabase.from('traces') as any)
      .insert(traceRow(t))
    if (error) console.error('[drawing] could not put a stroke back:', error)
  }
  for (const t of back) if (t.strokeData) refreshDrawingFile(t.id)
}

// ---- A kept drawing, written and painted --------------------------------------------

// A drawing painted from what's kept, as its file would be: for drawing mode's
// canvas, painted once per change.
const painted = new Map<string, { key: string; picture: HTMLCanvasElement }>()
export function paintedDrawing(trace: Trace): HTMLCanvasElement | null {
  const data = asStrokeData(trace.strokeData)
  if (!data || !trace.width || !trace.height) return null
  const key = `${data.rev}:${trace.width}x${trace.height}`
  const known = painted.get(trace.id)
  if (known?.key === key) return known.picture
  const picture = renderStrokeData(data, trace.width, trace.height)
  painted.set(trace.id, { key, picture })
  return picture
}

type DrawingFields = { strokeData: StrokeData } & Partial<Pick<Trace, 'x' | 'y' | 'width' | 'height'>>

// A kept drawing changed: written at once, marked as a change its file doesn't
// show yet -- whatever the data being put back said, so an undo can't claim a
// file that shows something else -- and its file made again behind it.
export async function writeDrawing(traceId: string, fields: DrawingFields): Promise<void> {
  const current = asStrokeData(useGameStore.getState().traces.find(t => t.id === traceId)?.strokeData)
  const strokeData: StrokeData = { ...fields.strokeData, rev: nextRev(), fileRev: current?.fileRev ?? 0 }
  await writePicture(traceId, { ...fields, strokeData })
  refreshDrawingFile(traceId)
}

// Its file made again from what's kept, a moment after it last changed -- not
// once a stroke: every copy is a file in the atrium's storage -- or not while
// it's held (being drawn on: releaseDrawingFiles makes it then).
const REFRESH_AFTER_MS = 800
const held = new Set<string>()
const timers = new Map<string, number>()
export function holdDrawingFiles(ids: Iterable<string>) {
  for (const id of ids) held.add(id)
}
export function releaseDrawingFiles(ids: Iterable<string>) {
  for (const id of ids) {
    held.delete(id)
    refreshDrawingFile(id, 0)
  }
}
export function refreshDrawingFile(traceId: string, delay = REFRESH_AFTER_MS) {
  window.clearTimeout(timers.get(traceId))
  if (held.has(traceId)) return
  timers.set(traceId, window.setTimeout(() => {
    timers.delete(traceId)
    void makeDrawingFile(traceId)
  }, delay))
}
async function makeDrawingFile(traceId: string) {
  const store = useGameStore.getState()
  const trace = store.traces.find(t => t.id === traceId)
  const data = asStrokeData(trace?.strokeData)
  if (!trace?.lobbyId || !data || data.fileRev === data.rev || !trace.width || !trace.height) return
  const url = await saveDrawingPicture(renderStrokeData(data, trace.width, trace.height), trace.lobbyId, store.userId)
  // Changed again meanwhile: that change's own refresh will make its file.
  const now = asStrokeData(useGameStore.getState().traces.find(t => t.id === traceId)?.strokeData)
  if (now?.rev !== data.rev) return
  await writePicture(traceId, { mediaUrl: url, strokeData: { ...now, fileRev: now.rev } })
}

// What can be changed on a stroke after it's drawn.
export type StrokeChange = Partial<Pick<Stroke, 'color' | 'width' | 'brush' | 'hardness'>>

// Strokes changed after they're drawn -- every stroke of a drawing -- painted
// again from what's kept (StrokeData): a new width, brush or softness fitting
// its box to them again, the trace staying where it is. All of it one step of
// undo. A drawing from before strokes were kept has only its picture: its
// colour can change (tintPicture, shading kept, every colour in it becoming
// the one), nothing else. False when none of them changed.
export async function changeStrokes(traceIds: string[], change: StrokeChange, lobbyId: string, userId: string | null): Promise<boolean> {
  const kept: { id: string; before: DrawingFields; after: DrawingFields }[] = []
  const pictures: { id: string; before: string; after: string }[] = []
  const reshape = change.width !== undefined || change.brush !== undefined || change.hardness !== undefined
  for (const id of traceIds) {
    const trace = useGameStore.getState().traces.find(t => t.id === id)
    if (!trace || !isDrawingTrace(trace)) continue
    const data = asStrokeData(trace.strokeData)
    if (!data || !trace.width || !trace.height) {
      if (!change.color || !trace.mediaUrl) continue
      const picture = await loadDrawingPicture(trace.mediaUrl)
      if (!picture) continue
      pictures.push({ id, before: trace.mediaUrl, after: await saveDrawingPicture(tintPicture(picture, change.color), lobbyId, userId) })
      continue
    }
    const next: StrokeData = { ...data, ops: data.ops.map(op => (op.isEraser ? op : { ...op, ...change })) }
    const before: DrawingFields = { strokeData: data, x: trace.x, y: trace.y, width: trace.width, height: trace.height }
    if (!reshape) {
      kept.push({ id, before, after: { strokeData: next } })
      continue
    }
    const fitted = fitBox(next, trace.width, trace.height, false)
    const moved = localToWorldDelta(fitted.dx, fitted.dy, placementOf(trace))
    kept.push({ id, before, after: { strokeData: fitted.data, x: trace.x + moved.x, y: trace.y + moved.y, width: fitted.width, height: fitted.height } })
  }
  if (kept.length === 0 && pictures.length === 0) return false
  const put = (which: 'before' | 'after') => Promise.all([
    ...kept.map(c => writeDrawing(c.id, c[which])),
    ...pictures.map(c => writePicture(c.id, { mediaUrl: c[which] })),
  ]).then(() => {})
  await put('after')
  recordAction({ label: 'stroke changed', undo: () => put('before'), redo: () => put('after') })
  return true
}

// ---- Split into strokes ------------------------------------------------------------------

// A drawing apart into its strokes (lib/brushes splitStrokes): each a trace of
// its own named Stroke N, where it was in the drawing -- turned, scaled and
// flipped as the drawing is -- together in a group where the drawing was: a
// new group named as the drawing was, or, the drawing already in one, that
// group. The drawing goes. One layer change, so one step of undo that puts
// the drawing back (lib/layerUndo).
export function splitDrawing(traceId: string, strokeName: (n: number) => string): Promise<boolean> {
  return queueLayerChange(() => withLayerUndo('split drawing', async () => {
    const { traces, layers, userId } = useGameStore.getState()
    const drawing = traces.find(t => t.id === traceId)
    const data = asStrokeData(drawing?.strokeData)
    if (!supabase || !drawing?.lobbyId || !data || !drawing.width || !drawing.height) return false
    const pieces = splitStrokes(data, drawing.width, drawing.height)
    if (pieces.length < 2) return false
    const placement = placementOf(drawing)

    // Where they go: into the drawing's group at its place, or a new group of
    // their own in its place in the stack.
    const inGroup = drawing.layerId && layers.some(l => l.id === drawing.layerId) ? drawing.layerId : null
    let groupId: string
    let keys: string[]
    if (inGroup) {
      groupId = inGroup
      const others = traces.filter(t => t.layerId === inGroup && t.id !== drawing.id)
      const below = others.filter(t => (t.orderKey ?? '') < (drawing.orderKey ?? '')).length
      keys = keysAt(others, below, pieces.length) ?? keysBetween(null, null, pieces.length)
    } else {
      groupId = (await createGroup(drawing.lobbyId, drawing.content || strokeName(1), userId, drawing.orderKey ?? undefined)).id
      keys = keysBetween(null, null, pieces.length)
    }

    const taken = inGroup ? traces.filter(t => t.layerId === inGroup).map(t => t.content) : []
    const names: string[] = []
    for (let n = 1; names.length < pieces.length; n++) if (!taken.includes(strokeName(n))) names.push(strokeName(n))

    for (const [i, piece] of pieces.entries()) {
      const moved = localToWorldDelta(piece.dx, piece.dy, placement)
      const url = await saveDrawingPicture(piece.picture, drawing.lobbyId, userId)
      const row = {
        ...buildTraceInsertRow({
          ...drawing,
          content: names[i],
          mediaUrl: url,
          strokeData: piece.data,
          x: drawing.x + moved.x,
          y: drawing.y + moved.y,
          width: piece.width,
          height: piece.height,
          cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1,
          layerId: groupId,
          orderKey: keys[i],
          frameId: drawing.frameId,
        }, drawing.userId, drawing.username, drawing.lobbyId, 0, 0),
        id: crypto.randomUUID(),
      }
      const { error } = await (supabase.from('traces') as any).insert(row)
      if (error) throw error
      useGameStore.getState().addTrace(mapRowToTrace(row))
    }
    const { error } = await (supabase.from('traces') as any).delete().eq('id', drawing.id)
    if (error) throw error
    useGameStore.getState().removeTrace(drawing.id)
    window.dispatchEvent(new Event('atrium:layers-changed'))
    return true
  }))
}
