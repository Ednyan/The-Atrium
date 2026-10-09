// Spreadsheets on the canvas. A spreadsheet file placed becomes what's in it:
// a sheet trace for each sheet that has anything in it, a chart trace for each
// chart, side by side -- together in a group named after the file. One step
// of undo takes it all away again. (They were framed too; the frame was in
// the way more than it helped.)
//
// Each trace's content is a small JSON file it points at (media_url), as a
// picture's is: what it shows, already read (lib/spreadsheet), so it's never
// read from the spreadsheet again.

import { supabase } from './supabase'
import { useGameStore } from '../store/gameStore'
import { mapRowToTrace } from '../hooks/useTraces'
import { createGroup } from '../hooks/useLayers'
import { uploadTraceFile } from './traceUpload'
import { currentTracePreset } from './tracePresets'
import { firstFreeName, fileTitle } from './traceNames'
import { keysBetween } from './order'
import { queueLayerChange } from './layerQueue'
import { withLayerUndo } from './layerUndo'
import { readSpreadsheet, type ChartData, type SheetData } from './spreadsheet'
import { keepSheetFile, sheetSize } from './sheetDraw'
import { currentLanguage, t } from './i18n'
import type { TraceMaker } from './pdfTraces'
import { followFile } from './liveFiles'

const CHART_SIZE = { width: 600, height: 400 }
const GAP = 48

// The spreadsheet in `file`, placed centred on `at`. How many traces it made;
// thrown when it can't be read, or has nothing in it. With `path`, where the
// file is on disk, its traces follow it (lib/liveFiles).
export async function importSpreadsheet(file: File, at: { x: number; y: number }, who: TraceMaker, path?: string | null): Promise<number> {
  const { sheets, charts } = await readSpreadsheet(file, currentLanguage())
  const parts: (SheetData | ChartData)[] = [...sheets, ...charts]
  if (parts.length === 0) throw new Error(t('atrium.sheet.empty'))

  return queueLayerChange(() => withLayerUndo('import spreadsheet', async () => {
    const db = supabase
    if (!db) return 0
    const { layers } = useGameStore.getState()
    const preset = currentTracePreset(who.lobbyId)

    // Left to right, their tops in line, the whole centred on `at`.
    const sizes = parts.map(part => (part.kind === 'sheet' ? sheetSize(part) : CHART_SIZE))
    const across = sizes.reduce((sum, s) => sum + s.width, 0) + GAP * (parts.length - 1)
    const top = at.y - Math.max(...sizes.map(s => s.height)) / 2
    let left = at.x - across / 2
    const boxes = sizes.map(s => {
      const box = { cx: left + s.width / 2, cy: top + s.height / 2, halfW: s.width / 2, halfH: s.height / 2 }
      left += s.width + GAP
      return box
    })

    // Their files, known at once to what draws them.
    const urls: string[] = []
    for (const [i, part] of parts.entries()) {
      const url = await uploadTraceFile(new File([JSON.stringify(part)], `${part.kind}-${i + 1}.json`, { type: 'application/json' }), who.lobbyId, who.userId)
      keepSheetFile(url, part)
      urls.push(url)
    }

    // The group, named after the file (Spreadsheet N when it has no name).
    const groupName = fileTitle(file.name) || firstFreeName(layers.map(l => l.name), n => t('atrium.sheet.groupN', { n }))
    const group = await createGroup(who.lobbyId, groupName, who.userId)
    const keys = keysBetween(null, null, parts.length)
    let chartNumber = 0
    const rows = [
      ...parts.map((part, i) => ({
        user_id: who.userId,
        username: who.username,
        type: part.kind,
        content: part.kind === 'sheet' ? part.name : part.title || t('atrium.sheet.chartN', { n: ++chartNumber }),
        position_x: boxes[i].cx,
        position_y: boxes[i].cy,
        media_url: urls[i],
        width: sizes[i].width,
        height: sizes[i].height,
        border_color: preset.border,
        fill_color: preset.fill,
        show_border: true,
        show_background: true,
        show_description: false,
        show_filename: false,
        font_family: 'mono',
        scale: 1.0,
        rotation: 0.0,
        border_radius: 0,
        lobby_id: who.lobbyId,
        layer_id: group.id,
        order_key: keys[i],
      })),
    ]
    const { data, error } = await (db.from('traces') as any).insert(rows).select()
    if (error) throw new Error(error.message)
    for (const row of data ?? []) useGameStore.getState().addTrace(mapRowToTrace(row))
    window.dispatchEvent(new Event('atrium:layers-changed'))
    if (path) {
      void followFile(path, (data ?? []).flatMap((row: any) => {
        const i = urls.indexOf(row.media_url)
        return i < 0 ? [] : [{ id: row.id as string, kind: parts[i].kind, index: i < sheets.length ? i : i - sheets.length }]
      }))
    }
    return parts.length
  }))
}
