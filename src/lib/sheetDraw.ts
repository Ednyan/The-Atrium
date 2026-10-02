// Sheets and charts, drawn: as SVG markup, the one drawing of each -- shown on
// the canvas (components/SheetTrace) and put in a PNG or SVG export
// (lib/exportImage) alike. Drawn in a trace's own units: a sheet at its
// columns' widths, a chart at the size its box is.

import { asSheetFile, DEFAULT_PALETTE, formatNumber, isDateFormat, type ChartData, type ChartSeries, type SheetData } from './spreadsheet'
import { tCount } from './i18n'

const FONT = 'Calibri, Carlito, Arial, sans-serif'
const CELL_FONT = 13
const INK = '#1f1f1f'
const GRID = '#e1e1e1'

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const n = (v: number) => Math.round(v * 100) / 100

let measurer: CanvasRenderingContext2D | null = null
function widthOf(text: string, size: number, bold = false): number {
  measurer ??= document.createElement('canvas').getContext('2d')
  if (!measurer) return text.length * size * 0.55
  measurer.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`
  return measurer.measureText(text).width
}

// As much of `text` as fits in `room`, with an ellipsis when it's cut.
function fitted(text: string, room: number, size: number, bold = false): string {
  if (room <= 0) return ''
  if (widthOf(text, size, bold) <= room) return text
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (widthOf(text.slice(0, mid) + '…', size, bold) <= room) lo = mid
    else hi = mid - 1
  }
  return lo > 0 ? text.slice(0, lo) + '…' : ''
}

// An SVG of the region x, y, w, h, `outW` by `outH` pixels.
const svgOpen = (x: number, y: number, w: number, h: number, outW: number, outH: number, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x)} ${n(y)} ${n(w)} ${n(h)}" width="${n(outW)}" height="${n(outH)}" font-family="${esc(FONT)}"${extra}>`

// ---- Sheets ------------------------------------------------------------------------------

// Its rows, the note under them saying what was left out included.
export const sheetRows = (d: SheetData) => d.cells.length + (d.more ? 1 : 0)
export const sheetSize = (d: SheetData) => ({ width: d.widths.reduce((a, b) => a + b, 0), height: sheetRows(d) * d.rowHeight })

// Rows `from` to `to` of a sheet, stretched to `size` pixels (its own size
// unless said). A text runs on into the empty cells to its right, as a
// spreadsheet's does; a number stays in its own, set to the right.
export function sheetSvg(d: SheetData, from = 0, to = sheetRows(d), size?: { width: number; height: number }): string {
  const { width } = sheetSize(d)
  const rh = d.rowHeight
  const top = from * rh, height = (to - from) * rh
  const lefts: number[] = []
  d.widths.reduce((x, w, i) => (lefts[i] = x) + w, 0)
  const out = [svgOpen(0, top, width, height, size?.width ?? width, size?.height ?? height, ' preserveAspectRatio="none"'), `<rect x="0" y="${top}" width="${width}" height="${height}" fill="#ffffff"/>`]
  let lines = ''
  for (let r = from; r <= to; r++) lines += `M0 ${r * rh + 0.5}H${width}`
  for (let c = 0; c <= d.widths.length; c++) lines += `M${(c < d.widths.length ? lefts[c] : width) + 0.5} ${top}V${top + height}`
  out.push(`<path d="${lines}" stroke="${GRID}" stroke-width="1" fill="none"/>`, `<g font-size="${CELL_FONT}" fill="${INK}">`)
  for (let r = from; r < Math.min(to, d.cells.length); r++) {
    const row = d.cells[r], kinds = d.kinds[r]
    const y = r * rh + rh * 0.68
    for (let c = 0; c < row.length; c++) {
      const text = row[c].replace(/\s*\n\s*/g, ' ')
      if (!text) continue
      if (kinds[c] === 'n') {
        out.push(`<text x="${lefts[c] + d.widths[c] - 4}" y="${y}" text-anchor="end">${esc(fitted(text, d.widths[c] - 8, CELL_FONT))}</text>`)
      } else {
        let room = d.widths[c]
        for (let k = c + 1; k < row.length && !row[k]; k++) room += d.widths[k]
        out.push(`<text x="${lefts[c] + 4}" y="${y}">${esc(fitted(text, room - 8, CELL_FONT))}</text>`)
      }
    }
  }
  out.push('</g>')
  if (d.more && to > d.cells.length) {
    const note = [d.more.rows ? tCount('atrium.sheet.moreRows', d.more.rows) : '', d.more.cols ? tCount('atrium.sheet.moreColumns', d.more.cols) : ''].filter(Boolean).join(' · ')
    out.push(`<text x="6" y="${d.cells.length * rh + rh * 0.68}" font-size="${CELL_FONT}" font-style="italic" fill="#767676">${esc(fitted(note, width - 12, CELL_FONT))}</text>`)
  }
  out.push('</svg>')
  return out.join('')
}

// ---- Charts ------------------------------------------------------------------------------

// Ticks for an axis from `lo` to `hi`: round numbers, about `count` of them.
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!isFinite(lo) || !isFinite(hi)) return [0, 1]
  if (lo === hi) { lo -= Math.abs(lo) || 1; hi += Math.abs(hi) || 1 }
  const raw = (hi - lo) / count
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw) ?? 10 * power
  const ticks: number[] = []
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) ticks.push(Number(v.toPrecision(12)))
  return ticks
}

// Ticks for a date axis (spreadsheet day numbers): the first of a month,
// every 1, 2, 3, 6 or 12 months or more, from the one at or before `lo` to the
// one at or after `hi`. Spans of under a few months tick in plain days.
export function dateTicks(lo: number, hi: number, count = 5): number[] {
  if (!isFinite(lo) || !isFinite(hi) || (hi - lo) / count < 20) return niceTicks(lo, hi, count)
  const every = [1, 2, 3, 6, 12, 24, 60, 120, 240].find(m => (hi - lo) / (m * 30.44) <= count) ?? 240
  const epoch = Date.UTC(1899, 11, 30)
  const serialOf = (month: number) => (Date.UTC(Math.floor(month / 12), month % 12, 1) - epoch) / 86400000
  const start = new Date(epoch + lo * 86400000)
  const ticks: number[] = []
  for (let month = Math.floor((start.getUTCFullYear() * 12 + start.getUTCMonth()) / every) * every; ; month += every) {
    ticks.push(serialOf(month))
    if (ticks[ticks.length - 1] >= hi) return ticks
  }
}

// A value axis's range, as a spreadsheet picks it: from zero, unless the
// values sit far from it (their least over five sixths of their most).
function valueRange(values: number[], fromZero: boolean): [number, number] {
  if (!values.length) return [0, 1]
  let lo = Math.min(...values), hi = Math.max(...values)
  const nearZero = !(lo > 0 && lo > (hi * 5) / 6) && !(hi < 0 && hi < (lo * 5) / 6)
  if (fromZero || nearZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  return [lo, hi]
}

let gradients = 0

export function chartSvg(c: ChartData, W: number, H: number, scale = 1, lang?: string): string {
  const ink = c.text
  const out: string[] = [svgOpen(0, 0, W, H, W * scale, H * scale)]
  if (c.background) {
    if (c.background2) {
      const id = `atrium-chart-bg-${++gradients}`
      out.push(`<defs><radialGradient id="${id}"><stop offset="0" stop-color="${c.background}"/><stop offset="1" stop-color="${c.background2}"/></radialGradient></defs>`)
      out.push(`<rect width="${W}" height="${H}" fill="url(#${id})"/>`)
    } else out.push(`<rect width="${W}" height="${H}" fill="${c.background}"/>`)
  }
  const pad = 12
  let top = pad, bottom = H - pad, left = pad, right = W - pad
  if (c.title) {
    out.push(`<text x="${W / 2}" y="${top + 16}" text-anchor="middle" font-size="17" font-weight="bold" fill="${ink}">${esc(fitted(c.title, W - pad * 2, 17, true))}</text>`)
    top += 28
  }

  const pie = c.type === 'pie' || c.type === 'doughnut'
  // The legend: categories for a pie, series for anything else.
  const entries = pie
    ? (c.categories ?? c.series[0].values.map((_, i) => String(i + 1))).map((name, i) => ({ name, color: DEFAULT_PALETTE[i % DEFAULT_PALETTE.length], line: false }))
    : c.series.map(s => ({ name: s.name, color: s.color, line: (c.type === 'line' || c.type === 'scatter') && !s.markersOnly }))
  if (c.legend && entries.length > 0) {
    const swatch = (e: { color: string; line: boolean }, x: number, y: number) => e.line
      ? `<line x1="${x}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="${e.color}" stroke-width="3"/>`
      : `<rect x="${x + 2}" y="${y - 5}" width="10" height="10" fill="${e.color}"/>`
    if (c.legend === 'r') {
      const room = Math.min(W * 0.3, Math.max(...entries.map(e => widthOf(e.name, 12))) + 24)
      const x = right - room
      const y0 = (top + bottom) / 2 - (entries.length * 18) / 2 + 9
      entries.forEach((e, i) => out.push(swatch(e, x, y0 + i * 18), `<text x="${x + 20}" y="${y0 + i * 18 + 4}" font-size="12" fill="${ink}">${esc(fitted(e.name, room - 20, 12))}</text>`))
      right = x - 8
    } else {
      const widths = entries.map(e => Math.min(widthOf(e.name, 12), 160) + 32)
      let x = (W - widths.reduce((a, b) => a + b, 0)) / 2
      const y = c.legend === 't' ? top + 8 : bottom - 6
      entries.forEach((e, i) => { out.push(swatch(e, Math.max(pad, x), y), `<text x="${Math.max(pad, x) + 20}" y="${y + 4}" font-size="12" fill="${ink}">${esc(fitted(e.name, 160, 12))}</text>`); x += widths[i] })
      if (c.legend === 't') top += 22; else bottom -= 22
    }
  }

  if (pie) {
    const values = c.series[0].values.map(v => Math.max(0, v ?? 0))
    const total = values.reduce((a, b) => a + b, 0) || 1
    const cx = (left + right) / 2, cy = (top + bottom) / 2
    const r = Math.max(4, Math.min(right - left, bottom - top) / 2 - 4)
    const inner = c.type === 'doughnut' ? r * 0.5 : 0
    let angle = -Math.PI / 2
    values.forEach((v, i) => {
      if (v <= 0) return
      const sweep = (v / total) * Math.PI * 2
      const a1 = angle + sweep
      const big = sweep > Math.PI ? 1 : 0
      const p = (rad: number, a: number) => `${n(cx + rad * Math.cos(a))} ${n(cy + rad * Math.sin(a))}`
      const d = sweep >= Math.PI * 2 - 1e-6
        ? `M${p(r, angle)}A${r} ${r} 0 1 1 ${p(r, angle + Math.PI)}A${r} ${r} 0 1 1 ${p(r, angle)}` + (inner ? `M${p(inner, angle)}A${inner} ${inner} 0 1 0 ${p(inner, angle + Math.PI)}A${inner} ${inner} 0 1 0 ${p(inner, angle)}` : '')
        : inner
          ? `M${p(r, angle)}A${r} ${r} 0 ${big} 1 ${p(r, a1)}L${p(inner, a1)}A${inner} ${inner} 0 ${big} 0 ${p(inner, angle)}Z`
          : `M${cx} ${cy}L${p(r, angle)}A${r} ${r} 0 ${big} 1 ${p(r, a1)}Z`
      out.push(`<path d="${d}" fill="${DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]}" fill-rule="evenodd" stroke="${c.background ?? '#ffffff'}" stroke-width="1.5"/>`)
      angle = a1
    })
    out.push('</svg>')
    return out.join('')
  }

  // Axes' titles.
  if (c.yTitle) {
    out.push(`<text transform="translate(${left + 12} ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="13" font-weight="bold" fill="${ink}">${esc(fitted(c.yTitle, bottom - top, 13, true))}</text>`)
    left += 22
  }
  if (c.xTitle) {
    out.push(`<text x="${(left + right) / 2}" y="${bottom - 2}" text-anchor="middle" font-size="13" font-weight="bold" fill="${ink}">${esc(fitted(c.xTitle, right - left, 13, true))}</text>`)
    bottom -= 22
  }

  const horizontal = c.type === 'bar'
  const scatter = c.type === 'scatter'
  const categories = c.categories ?? []
  const count = scatter ? 0 : Math.max(categories.length, ...c.series.map(s => s.values.length))
  // The values the value axis has to hold: stacked ones summed.
  const values: number[] = []
  if (c.stacked && !scatter) {
    for (let i = 0; i < count; i++) {
      let up = 0, down = 0
      for (const s of c.series) { const v = s.values[i] ?? 0; if (v >= 0) up += v; else down += v }
      values.push(up, down)
    }
  } else for (const s of c.series) for (const v of s.values) if (v !== null) values.push(v)
  const vTicks = niceTicks(...valueRange(values, c.type === 'column' || c.type === 'bar' || c.type === 'area'))
  const vLo = vTicks[0], vHi = vTicks[vTicks.length - 1]
  const vLabel = (v: number) => formatNumber(v, c.yFormat, lang)

  // Scatter's x axis: numbers (or dates) too.
  const xs = scatter ? c.series.flatMap(s => (s.x ?? []).filter((v, i): v is number => v !== null && s.values[i] !== null && s.values[i] !== undefined)) : []
  const xTicks = scatter ? (isDateFormat(c.xFormat) ? dateTicks : niceTicks)(Math.min(...xs), Math.max(...xs), Math.max(2, Math.floor((right - left) / 110))) : []
  const xLo = xTicks[0] ?? 0, xHi = xTicks[xTicks.length - 1] ?? 1
  const xLabel = (v: number) => formatNumber(v, c.xFormat, lang)

  // Room for the tick labels, then the plot.
  const valueLabelWidth = Math.max(...vTicks.map(v => widthOf(vLabel(v), 12))) + 8
  const categoryLabelWidth = horizontal ? Math.min((right - left) * 0.3, Math.max(0, ...categories.map(s => widthOf(s, 12))) + 8) : 0
  if (horizontal) { left += categoryLabelWidth; bottom -= 18 } else { left += valueLabelWidth; bottom -= 18 }
  const pw = Math.max(1, right - left), ph = Math.max(1, bottom - top)

  // A value's place along the value axis, and a category's band.
  const along = (v: number) => (horizontal ? left + ((v - vLo) / (vHi - vLo || 1)) * pw : bottom - ((v - vLo) / (vHi - vLo || 1)) * ph)
  const band = (horizontal ? ph : pw) / Math.max(1, count)
  const bandStart = (i: number) => (horizontal ? bottom - (i + 1) * band : left + i * band)
  const xAt = (v: number) => left + ((v - xLo) / (xHi - xLo || 1)) * pw

  // Gridlines and the value axis's labels.
  for (const v of vTicks) {
    const p = n(along(v))
    out.push(horizontal
      ? `<line x1="${p}" y1="${top}" x2="${p}" y2="${bottom}" stroke="${ink}" stroke-opacity="0.18"/><text x="${p}" y="${bottom + 14}" text-anchor="middle" font-size="12" fill="${ink}">${esc(vLabel(v))}</text>`
      : `<line x1="${left}" y1="${p}" x2="${right}" y2="${p}" stroke="${ink}" stroke-opacity="0.18"/><text x="${left - 6}" y="${p + 4}" text-anchor="end" font-size="12" fill="${ink}">${esc(vLabel(v))}</text>`)
  }
  // The category (or scatter's x) axis's labels: as many as fit.
  if (scatter) {
    // Kept inside the chart at its ends.
    for (const v of xTicks) {
      const label = xLabel(v), half = widthOf(label, 12) / 2
      out.push(`<text x="${n(Math.min(W - pad - half, Math.max(pad + half, xAt(v))))}" y="${bottom + 14}" text-anchor="middle" font-size="12" fill="${ink}">${esc(label)}</text>`)
    }
  } else if (count > 0) {
    const need = horizontal ? 16 : Math.max(...categories.map(s => Math.min(widthOf(s, 12), 120))) + 8
    const every = Math.max(1, Math.ceil(need / band))
    for (let i = 0; i < categories.length; i += every) {
      const mid = bandStart(i) + band / 2
      out.push(horizontal
        ? `<text x="${left - 6}" y="${n(mid + 4)}" text-anchor="end" font-size="12" fill="${ink}">${esc(fitted(categories[i], categoryLabelWidth - 8, 12))}</text>`
        : `<text x="${n(mid)}" y="${bottom + 14}" text-anchor="middle" font-size="12" fill="${ink}">${esc(fitted(categories[i], band * every - 4, 12))}</text>`)
    }
  }
  // The axis the values stand on.
  const base = n(along(Math.min(Math.max(0, vLo), vHi)))
  out.push(horizontal
    ? `<line x1="${base}" y1="${top}" x2="${base}" y2="${bottom}" stroke="${ink}" stroke-opacity="0.45"/>`
    : `<line x1="${left}" y1="${base}" x2="${right}" y2="${base}" stroke="${ink}" stroke-opacity="0.45"/>`)

  // The series.
  const points = (s: ChartSeries): { x: number; y: number; v: number; at: number }[] => {
    const list: { x: number; y: number; v: number; at: number }[] = []
    if (scatter) {
      for (let i = 0; i < Math.min(s.values.length, s.x?.length ?? 0); i++) {
        const v = s.values[i], x = s.x![i]
        if (v !== null && x !== null) list.push({ x: xAt(x), y: along(v), v, at: x })
      }
    } else s.values.forEach((v, i) => { if (v !== null) list.push({ x: bandStart(i) + band / 2, y: along(v), v, at: i }) })
    return list
  }
  const line = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join('')

  if (c.type === 'column' || c.type === 'bar') {
    const stackUp: number[] = [], stackDown: number[] = []
    const groupWidth = band * 0.7
    const each = c.stacked ? groupWidth : groupWidth / c.series.length
    c.series.forEach((s, si) => s.values.forEach((v, i) => {
      if (v === null) return
      let from = 0, to = v
      if (c.stacked) {
        const stack = v >= 0 ? stackUp : stackDown
        from = stack[i] ?? 0; to = from + v; stack[i] = to
      }
      const a = along(from), b = along(to)
      const offset = bandStart(i) + (band - groupWidth) / 2 + (c.stacked ? 0 : si * each)
      out.push(horizontal
        ? `<rect x="${n(Math.min(a, b))}" y="${n(offset)}" width="${n(Math.abs(b - a))}" height="${n(each)}" fill="${s.color}"/>`
        : `<rect x="${n(offset)}" y="${n(Math.min(a, b))}" width="${n(each)}" height="${n(Math.abs(b - a))}" fill="${s.color}"/>`)
    }))
  } else if (c.type === 'area') {
    const stack: number[] = []
    for (const s of c.series) {
      const tops = s.values.map((v, i) => { const from = c.stacked ? stack[i] ?? 0 : 0; return { i, from, to: from + (v ?? 0) } })
      if (tops.length === 0) continue
      const upper = tops.map(p => ({ x: bandStart(p.i) + band / 2, y: along(p.to) }))
      const lower = tops.map(p => ({ x: bandStart(p.i) + band / 2, y: along(p.from) })).reverse()
      out.push(`<path d="${line([...upper, ...lower])}Z" fill="${s.color}" fill-opacity="${c.stacked ? 1 : 0.75}"/>`)
      if (c.stacked) tops.forEach(p => { stack[p.i] = p.to })
    }
  } else {
    for (const s of c.series) {
      const pts = points(s)
      const width = s.width ?? 2.25
      if (!s.markersOnly && pts.length > 1) out.push(`<path d="${line(pts)}" fill="none" stroke="${s.color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`)
      if (s.markers || s.markersOnly) {
        const r = Math.max(2.5, width * 0.8)
        out.push(`<g fill="${s.color}">${pts.map(p => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(r)}"/>`).join('')}</g>`)
      }
      // A straight line fitted to its points, least squares.
      if (s.trend && pts.length > 1) {
        const k = pts.length
        const mx = pts.reduce((a, p) => a + p.at, 0) / k, my = pts.reduce((a, p) => a + p.v, 0) / k
        const sxx = pts.reduce((a, p) => a + (p.at - mx) ** 2, 0)
        const slope = sxx ? pts.reduce((a, p) => a + (p.at - mx) * (p.v - my), 0) / sxx : 0
        const ends = [pts[0], pts[k - 1]].map(p => ({ x: p.x, y: along(my + slope * (p.at - mx)) }))
        out.push(`<path d="${line(ends)}" stroke="${s.trend}" stroke-width="2" fill="none"/>`)
      }
    }
  }
  out.push('</svg>')
  return out.join('')
}

// ---- Their files -------------------------------------------------------------------------

const files = new Map<string, Promise<SheetData | ChartData | null>>()

// A sheet or chart trace's file, read once and kept. One that can't be read
// isn't kept, as it may yet arrive (a vault write still landing).
export function sheetFile(url: string): Promise<SheetData | ChartData | null> {
  let file = files.get(url)
  if (!file) {
    file = (async () => {
      const { fetchMedia } = await import('./exportImage')
      const blob = await fetchMedia(url)
      return blob ? asSheetFile(JSON.parse(await blob.text())) : null
    })().catch(() => null)
    files.set(url, file)
    void file.then(data => { if (!data) files.delete(url) })
  }
  return file
}

// A file just made, known before it's been written anywhere it could be read back from.
export const keepSheetFile = (url: string, data: SheetData | ChartData) => { files.set(url, Promise.resolve(data)) }
