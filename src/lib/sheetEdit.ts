// A sheet trace's cell, changed: its file is the sheet's cells as JSON
// (lib/sheetTraces), so a change is a new file with that cell changed, and the
// trace pointed at it -- undoing points it back at the one before. What a cell
// says is what's typed: a sheet keeps the text its cells show, not formulas,
// so nothing else recalculates.

import { keepSheetFile, sheetFile } from './sheetDraw'
import { uploadTraceFile } from './traceUpload'
import type { SheetData } from './spreadsheet'

// Typed as a number: set to the right, as a spreadsheet sets numbers.
export const looksNumeric = (text: string) => /^[-+]?(\d{1,3}([ ,.]\d{3})*|\d+)([.,]\d+)?%?$/.test(text.trim())

// `data` with the cell at `row`, `col` saying `text` -- the grid grown to
// hold it -- or null when it says that already.
export function withCell(data: SheetData, row: number, col: number, text: string): SheetData | null {
  if ((data.cells[row]?.[col] ?? '') === text) return null
  const cells = data.cells.map(r => r.slice())
  const kinds = data.kinds.slice()
  while (cells.length <= row) { cells.push([]); kinds.push('') }
  const cellsOfRow = cells[row]
  while (cellsOfRow.length <= col) cellsOfRow.push('')
  cellsOfRow[col] = text
  const letters = (kinds[row] ?? '').padEnd(cellsOfRow.length, 's').split('')
  letters[col] = looksNumeric(text) ? 'n' : 's'
  kinds[row] = letters.join('')
  return { ...data, cells, kinds }
}

// The sheet at `url` with the cell changed, saved as a file of its own: its
// address, or null when nothing changed (or it isn't a sheet).
export async function editSheetCell(url: string, row: number, col: number, text: string, lobbyId: string, userId: string): Promise<string | null> {
  const data = await sheetFile(url)
  if (!data || data.kind !== 'sheet') return null
  const next = withCell(data, row, col, text)
  if (!next) return null
  const saved = await uploadTraceFile(new File([JSON.stringify(next)], 'sheet.json', { type: 'application/json' }), lobbyId, userId)
  keepSheetFile(saved, next)
  return saved
}
