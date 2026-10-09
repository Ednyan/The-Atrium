// What a sheet or chart trace shows: its file (lib/spreadsheet), drawn by
// lib/sheetDraw. A chart is drawn whole, at its box's size. A sheet is drawn a
// block of rows at a time, and only the blocks near the screen -- a
// spreadsheet of thousands of rows costs what's in view.
//
// A sheet is edited a cell at a time (`editAt`: where it was double-clicked,
// as fractions across and down it): an input over the cell, in the sheet's
// own units, so it scales and turns with the trace. Enter keeps the cell and
// goes down, Tab across (Shift back), Escape leaves it as it was.

import { useEffect, useMemo, useRef, useState } from 'react'
import { looksNumeric } from '../lib/sheetEdit'
import { useTranslation } from '../lib/i18n'
import { atriumChartLook, chartSvg, sheetFile, sheetRows, sheetSize, sheetSvg } from '../lib/sheetDraw'
import { baseSizeOf } from '../lib/traceGeometry'
import type { ChartData, SheetData } from '../lib/spreadsheet'
import type { Trace } from '../types/database'

const BLOCK = 40
// Fills its box, however the box is stretched.
const FILL = 'absolute left-0 w-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block'

export default function SheetTrace({ trace, editAt, onCell, onEditEnd }: {
  trace: Trace
  editAt?: { fx: number; fy: number } | null
  onCell?: (row: number, col: number, text: string) => void
  onEditEnd?: () => void
}) {
  const { t, language } = useTranslation()
  // Undefined while it's read; null when it can't be.
  const [data, setData] = useState<SheetData | ChartData | null | undefined>(undefined)
  useEffect(() => {
    const url = trace.mediaUrl
    if (!url) { setData(null); return }
    let live = true
    // The sheet as it was stays until the next is read -- an edit is a new
    // file, and a moment of "rendering" between every cell was a flicker.
    const load = () => void sheetFile(url).then(d => { if (live) setData(d) })
    load()
    // A file still being written to the vault is read again once it's there.
    const written = (e: Event) => { if ((e as CustomEvent).detail?.localUrl === url) load() }
    window.addEventListener('atrium:vault-write-complete', written)
    return () => { live = false; window.removeEventListener('atrium:vault-write-complete', written) }
  }, [trace.mediaUrl])

  const size = baseSizeOf(trace)
  // In the Atrium's look, in this trace's own colours (atriumChartLook).
  const chart = useMemo(
    () => (data?.kind === 'chart' ? chartSvg(data, size.width, size.height, 1, language, atriumChartLook(trace.fillColor, trace.textColor)) : ''),
    [data, size.width, size.height, language, trace.fillColor, trace.textColor],
  )

  if (!data) {
    return (
      <div className="w-full h-full bg-white flex items-center justify-center pointer-events-none select-none">
        <span className="text-black/40 text-[10px] tracking-wider uppercase">
          {data === null ? t('atrium.sheet.unreadable') : t('atrium.controls.rendering')}
        </span>
      </div>
    )
  }
  if (data.kind === 'chart') {
    return <div className={`${FILL} top-0 h-full pointer-events-none select-none`} dangerouslySetInnerHTML={{ __html: chart }} />
  }
  const rows = sheetRows(data)
  return (
    <div data-sheet-trace="" className="w-full h-full relative bg-white overflow-hidden pointer-events-none select-none">
      {Array.from({ length: Math.ceil(rows / BLOCK) }, (_, i) => (
        <SheetBlock key={i} data={data} from={i * BLOCK} to={Math.min(rows, (i + 1) * BLOCK)} rows={rows} />
      ))}
      {editAt && onCell && <CellEditor data={data} box={size} at={editAt} onCell={onCell} onEnd={() => onEditEnd?.()} />}
    </div>
  )
}

// The cell being edited, over the sheet: found from where it was
// double-clicked, then moved by Enter and Tab.
function CellEditor({ data, box, at, onCell, onEnd }: {
  data: SheetData
  box: { width: number; height: number }
  at: { fx: number; fy: number }
  onCell: (row: number, col: number, text: string) => void
  onEnd: () => void
}) {
  const own = sheetSize(data)
  const lefts = useMemo(() => { const out: number[] = []; data.widths.reduce((x, w, i) => (out[i] = x) + w, 0); return out }, [data.widths])
  const cellAt = (fx: number, fy: number) => {
    const x = fx * own.width, y = fy * own.height
    let col = 0
    while (col + 1 < lefts.length && lefts[col + 1] <= x) col++
    const row = Math.max(0, Math.min(data.cells.length - 1, Math.floor(y / data.rowHeight)))
    return { row, col }
  }
  const [cell, setCell] = useState(() => cellAt(at.fx, at.fy))
  useEffect(() => { setCell(cellAt(at.fx, at.fy)) }, [at.fx, at.fy]) // eslint-disable-line react-hooks/exhaustive-deps
  const input = useRef<HTMLInputElement>(null)
  // Kept once, whichever way it's left: Enter, Tab, or the pointer elsewhere.
  const settled = useRef(false)
  useEffect(() => { settled.current = false; input.current?.focus(); input.current?.select() }, [cell.row, cell.col])
  const sx = box.width / own.width, sy = box.height / own.height
  const keep = () => { if (!settled.current) { settled.current = true; onCell(cell.row, cell.col, input.current?.value ?? '') } }
  const go = (dr: number, dc: number) => {
    keep()
    const row = cell.row + dr, col = cell.col + dc
    if (row < 0 || col < 0 || row >= data.cells.length || col >= data.widths.length) { onEnd(); return }
    setCell({ row, col })
  }
  const shown = data.cells[cell.row]?.[cell.col] ?? ''
  return (
    <input
      key={`${cell.row}:${cell.col}`}
      ref={input}
      data-sheet-cell-editor={`${cell.row}:${cell.col}`}
      defaultValue={shown}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1, 0) }
        else if (e.key === 'Tab') { e.preventDefault(); go(0, e.shiftKey ? -1 : 1) }
        else if (e.key === 'Escape') { e.preventDefault(); settled.current = true; onEnd() }
      }}
      onBlur={() => { keep(); onEnd() }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      className="absolute pointer-events-auto outline-none"
      style={{
        left: lefts[cell.col] * sx,
        top: cell.row * data.rowHeight * sy,
        width: (data.widths[cell.col] ?? 72) * sx,
        height: data.rowHeight * sy,
        fontSize: 13 * sy,
        fontFamily: 'Calibri, Carlito, Arial, sans-serif',
        padding: `0 ${4 * sx}px`,
        background: '#ffffff',
        color: '#1f1f1f',
        border: `${2 * Math.min(sx, sy)}px solid #d9823b`,
        boxSizing: 'border-box',
        textAlign: looksNumeric(shown) ? 'right' : 'left',
      }}
    />
  )
}

// Rows `from` to `to`, drawn while they're on screen or near it.
function SheetBlock({ data, from, to, rows }: { data: SheetData; from: number; to: number; rows: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: '50%' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const markup = useMemo(() => (near ? sheetSvg(data, from, to) : ''), [near, data, from, to])
  return (
    <div
      ref={ref}
      className={FILL}
      style={{ top: `${(from / rows) * 100}%`, height: `${((to - from) / rows) * 100}%` }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
