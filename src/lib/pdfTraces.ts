// PDF traces. A PDF is placed as one document trace shown a page at a time,
// with arrows to turn them ("single, with arrows") -- the way a picked or
// dropped PDF arrives -- or as one picture per page, in reading order. Extract
// Pages turns the first into the second, as Miro's does.

import { supabase } from './supabase'
import { useGameStore } from '../store/gameStore'
import { mapRowToTrace } from '../hooks/useTraces'
import { createGroup } from '../hooks/useLayers'
import { insertTrace } from './traceWrites'
import { uploadTraceFile } from './traceUpload'
import { currentTracePreset } from './tracePresets'
import { scaleToDisplayBox } from './binPack'
import { fileTitle } from './traceNames'
import { keysAt, keysBetween, newTraceOrderFields } from './order'
import { queueLayerChange } from './layerQueue'
import { withLayerUndo } from './layerUndo'
import { fetchMedia } from './exportImage'
import { showToast } from './toast'
import { t, tCount } from './i18n'
import type { RenderedPage } from './pdf'
import type { Trace } from '../types/database'

export interface TraceMaker { lobbyId: string; userId: string; username: string }

// A PDF as a document trace at `at`: the shape of its first page, named after
// the file unless given a title. Thrown when the file isn't a PDF that reads.
export async function createPdfTrace(file: File, at: { x: number; y: number }, who: TraceMaker, title?: string): Promise<Trace> {
  const { getPdfInfo } = await import('./pdf')
  const info = await getPdfInfo(await file.arrayBuffer())
  const size = scaleToDisplayBox({ width: info.width, height: info.height }, 600)
  const url = await uploadTraceFile(file, who.lobbyId, who.userId)
  const preset = currentTracePreset(who.lobbyId)
  const { traces, layers } = useGameStore.getState()
  return insertTrace({
    user_id: who.userId,
    username: who.username,
    type: 'document',
    border_color: preset.border,
    fill_color: preset.fill,
    show_border: true,
    show_background: true,
    font_family: 'mono',
    content: title?.trim() || fileTitle(file.name) || 'PDF',
    position_x: at.x,
    position_y: at.y,
    media_url: url,
    scale: 1.0,
    rotation: 0.0,
    border_radius: 0,
    lobby_id: who.lobbyId,
    show_description: false,
    show_filename: false,
    width: size.width,
    height: size.height,
    ...newTraceOrderFields(traces, layers)[0],
  }, message => showToast(t('atrium.error.traceSaveFailed', { message })))
}

// Pages as picture rows, ready to insert: in reading order, `columns` across,
// centred on `at`, each no longer than `edge` along its longest side, their
// files saved. `extra` adds to each row (its group, its place in the stack).
export async function pageRows(
  pages: Pick<RenderedPage, 'blob' | 'width' | 'height'>[],
  at: { x: number; y: number },
  columns: number,
  who: TraceMaker,
  edge = 600,
  extra: (index: number) => Record<string, any> = () => ({}),
): Promise<Record<string, any>[]> {
  const cols = Math.max(1, Math.min(columns, pages.length))
  const rowCount = Math.ceil(pages.length / cols)
  // One pitch for every page, from the widest and tallest, so pages stay in
  // line even when a document mixes portrait and landscape.
  const boxes = pages.map(p => scaleToDisplayBox({ width: p.width, height: p.height }, edge))
  const cellWidth = Math.max(...boxes.map(b => b.width)) + 24
  const cellHeight = Math.max(...boxes.map(b => b.height)) + 24
  const originX = at.x - ((cols - 1) * cellWidth) / 2
  const originY = at.y - ((rowCount - 1) * cellHeight) / 2
  const rows: Record<string, any>[] = []
  for (const [i, page] of pages.entries()) {
    // Named for the format the encoder produced: it falls back to PNG where
    // WebP isn't available.
    const ext = page.blob.type === 'image/webp' ? 'webp' : 'png'
    const url = await uploadTraceFile(new File([page.blob], `page-${i + 1}.${ext}`, { type: page.blob.type }), who.lobbyId, who.userId)
    rows.push({
      user_id: who.userId,
      username: who.username,
      type: 'image',
      content: t('atrium.trace.pageN', { n: i + 1 }),
      position_x: originX + (i % cols) * cellWidth,
      position_y: originY + Math.floor(i / cols) * cellHeight,
      media_url: url,
      scale: 1.0,
      rotation: 0.0,
      border_radius: 0,
      lobby_id: who.lobbyId,
      show_description: false,
      show_filename: false,
      width: boxes[i].width,
      height: boxes[i].height,
      ...extra(i),
    })
  }
  return rows
}

// A columns count that reads well: a 4-page document as 2 x 2, not 3 + 1.
export const pageColumns = (count: number) => Math.min(count, Math.max(1, Math.round(Math.sqrt(count))))

// A document trace turned into its pages: one picture each, in reading order,
// where it was and the size it was shown at, together in a group named after
// it -- or, already in a group, in that group in its place. The document goes.
// One step of undo, which puts it back.
export function extractPages(traceId: string, who: TraceMaker, onProgress?: (done: number, total: number) => void): Promise<number> {
  return queueLayerChange(() => withLayerUndo('extract pages', async () => {
    const db = supabase
    const { traces, layers } = useGameStore.getState()
    const doc = traces.find(tr => tr.id === traceId)
    if (!db || !doc || doc.type !== 'document' || !doc.mediaUrl) return 0
    const file = await fetchMedia(doc.mediaUrl)
    if (!file) throw new Error(t('atrium.error.fileNotInVault'))
    const { renderPdfPages } = await import('./pdf')
    const pages = await renderPdfPages(await file.arrayBuffer(), onProgress)
    if (pages.length === 0) return 0

    const name = doc.content?.trim() || 'PDF'
    const inGroup = doc.layerId && layers.some(l => l.id === doc.layerId) ? doc.layerId : null
    let groupId: string
    let keys: string[]
    if (inGroup) {
      groupId = inGroup
      const others = traces.filter(tr => tr.layerId === inGroup && tr.id !== doc.id)
      const below = others.filter(tr => (tr.orderKey ?? '') < (doc.orderKey ?? '')).length
      keys = keysAt(others, below, pages.length) ?? keysBetween(null, null, pages.length)
    } else {
      groupId = (await createGroup(who.lobbyId, name, who.userId, doc.orderKey ?? undefined)).id
      keys = keysBetween(null, null, pages.length)
    }

    // The size it was shown at: each page as long as the document was.
    const shown = Math.max((doc.width || 424) * Math.abs(doc.scaleX ?? doc.scale ?? 1), (doc.height || 600) * Math.abs(doc.scaleY ?? doc.scale ?? 1))
    const rows = await pageRows(pages, { x: doc.x, y: doc.y }, pageColumns(pages.length), who, shown,
      i => ({ layer_id: groupId, order_key: keys[i], content: t('atrium.trace.pageN', { n: i + 1 }) }))
    const { data, error } = await (db.from('traces') as any).insert(rows).select()
    if (error) throw new Error(error.message)
    for (const row of data ?? []) useGameStore.getState().addTrace(mapRowToTrace(row))

    // The document goes, now its pages are there.
    await (db.from('traces') as any).delete().eq('id', doc.id)
    useGameStore.getState().removeTrace(doc.id)
    window.dispatchEvent(new Event('atrium:layers-changed'))

    const megabytes = pages.reduce((sum, p) => sum + p.blob.size, 0) / (1024 * 1024)
    showToast(tCount('atrium.toast.pagesPlaced', pages.length, { size: megabytes.toFixed(1) }))
    return pages.length
  }))
}
