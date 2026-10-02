// Spreadsheets, read: an .xlsx, .ods or .csv file as its sheets -- each a
// table of the text its cells show -- and, from an .xlsx, its charts, each as
// what it plots. Read in the browser with what browsers have: either kind of
// file is a zip of XML, inflated by DecompressionStream and read by DOMParser,
// so there's no library to keep up to date. A chart is read from the values
// the file keeps cached with it -- no formula is ever evaluated.
//
// Formatting is simplified: what a cell shows (its number format: decimals,
// thousands, percent, dates) is kept, not its fonts, fills or borders.

export interface SheetData {
  v: 1
  kind: 'sheet'
  name: string
  // The text each cell shows, row by row; '' for an empty one.
  cells: string[][]
  // Each row's cells' kinds, a letter each: 'n' a number (set right, as a
  // spreadsheet does), 's' anything else.
  kinds: string[]
  // Column widths, in world units (pixels at 100%).
  widths: number[]
  rowHeight: number
  // How much more the file had than is shown, when it was too big to show it all.
  more?: { rows: number; cols: number }
}

export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'doughnut'

export interface ChartSeries {
  name: string
  color: string
  values: (number | null)[]
  // A scatter series' x values.
  x?: (number | null)[]
  // A line's or a scatter's: its points marked; drawn as points alone; its
  // line's width; a straight trend line through it, in this colour.
  markers?: boolean
  markersOnly?: boolean
  width?: number
  trend?: string
}

export interface ChartData {
  v: 1
  kind: 'chart'
  type: ChartType
  title?: string
  xTitle?: string
  yTitle?: string
  stacked?: boolean
  // The category labels, for every type but scatter.
  categories?: string[]
  // How the axes' numbers show (a number format), when not plainly.
  xFormat?: string
  yFormat?: string
  // Its background -- a gradient from the first to the second, when there's
  // a second; none when it has none -- and its text's colour.
  background?: string
  background2?: string
  text: string
  // Where its legend is; null for none.
  legend: 'b' | 't' | 'r' | null
  series: ChartSeries[]
}

export interface ReadSpreadsheet { sheets: SheetData[]; charts: ChartData[] }

// More than this is left out, and said so (SheetData.more).
const MAX_ROWS = 5000
const MAX_COLS = 200
const ROW_HEIGHT = 22

// ---- Zip ------------------------------------------------------------------------------

// The files in a zip, by name: read through its central directory, each
// inflated when it's asked for.
async function unzip(buffer: ArrayBuffer): Promise<(name: string) => Promise<string | null>> {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  // The end-of-central-directory record, searched for from the end.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  }
  if (end < 0) throw new Error('not a zip file')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const entries = new Map<string, { method: number; size: number; offset: number }>()
  const decoder = new TextDecoder()
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) break
    const method = view.getUint16(at + 10, true)
    const size = view.getUint32(at + 20, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const offset = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    entries.set(name, { method, size, offset })
    at += 46 + nameLength + extraLength + commentLength
  }
  return async (name: string) => {
    const entry = entries.get(name)
    if (!entry) return null
    const local = entry.offset
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
    const data = bytes.subarray(start, start + entry.size)
    if (entry.method === 0) return decoder.decode(data)
    if (entry.method !== 8) throw new Error(`unsupported compression in ${name}`)
    const stream = new Blob([data as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    return await new Response(stream).text()
  }
}

const xml = (text: string) => new DOMParser().parseFromString(text, 'application/xml')
// Elements by local name, whatever their namespace prefix.
const all = (root: Element | Document, local: string) => Array.from(root.getElementsByTagNameNS('*', local))
const first = (root: Element | Document, local: string) => root.getElementsByTagNameNS('*', local)[0] as Element | undefined
const children = (el: Element, local: string) => Array.from(el.children).filter(c => c.localName === local)

// ---- Numbers, as a format shows them ------------------------------------------------------

const BUILTIN_FORMATS: Record<number, string> = {
  1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00', 9: '0%', 10: '0.00%', 11: '0.00E+00',
  14: 'mm-dd-yy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy', 18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM',
  20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yy h:mm', 37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)', 45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0',
}

// A spreadsheet's day number as a date (the 1900 system, with its leap-day quirk).
export const serialDate = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000))

// A number format's first section, without its quoted text and [colours].
const formatCore = (code: string | undefined) => (code ?? '').split(';')[0].replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
// Whether a number format shows a date or a time.
export const isDateFormat = (code: string | undefined) => {
  const format = formatCore(code)
  return /[dmyhs]/i.test(format) && !/^[#0.,%E+-]*$/i.test(format)
}

// What a number shows in a format: dates as dates (in the reader's language),
// percentages, decimals and thousands. Other formats show the number plainly.
export function formatNumber(value: number, code: string | undefined, lang?: string): string {
  const format = formatCore(code)
  if (isDateFormat(code)) {
    const date = serialDate(value)
    const hasDate = /[dy]/i.test(format) || /m{3,}/i.test(format)
    const hasTime = /[hs]/i.test(format)
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' }
    if (hasDate) Object.assign(options, { year: /y/i.test(format) ? 'numeric' : undefined, month: /mmm/i.test(format) ? 'short' : '2-digit', day: /d/i.test(format) ? '2-digit' : undefined })
    if (hasTime) Object.assign(options, { hour: '2-digit', minute: '2-digit', second: /s/i.test(format) ? '2-digit' : undefined })
    try { return new Intl.DateTimeFormat(lang, options).format(date) } catch { return date.toISOString().slice(0, 10) }
  }
  const decimals = (/\.(0+)/.exec(format)?.[1].length) ?? 0
  if (format.includes('%')) return `${(value * 100).toFixed(decimals)}%`
  if (/E\+/i.test(format)) return value.toExponential(decimals)
  if (/0/.test(format)) {
    return format.includes(',')
      ? value.toLocaleString(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : value.toFixed(decimals)
  }
  // General: as precise as it needs to be, no more.
  return String(Number(value.toPrecision(11)))
}

// ---- Sheets, made of what's read ------------------------------------------------------------

function sheetOf(name: string, grid: Map<number, Map<number, { text: string; number: boolean }>>, widths: Map<number, number>): SheetData | null {
  let rows = 0, cols = 0
  for (const [r, row] of grid) for (const [c, cell] of row) if (cell.text !== '') { rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1) }
  if (rows === 0) return null
  const shownRows = Math.min(rows, MAX_ROWS), shownCols = Math.min(cols, MAX_COLS)
  const cells: string[][] = [], kinds: string[] = []
  for (let r = 0; r < shownRows; r++) {
    const row = grid.get(r)
    const texts: string[] = []
    let kind = ''
    for (let c = 0; c < shownCols; c++) {
      const cell = row?.get(c)
      texts.push(cell?.text ?? '')
      kind += cell?.number ? 'n' : 's'
    }
    cells.push(texts)
    kinds.push(kind)
  }
  return {
    v: 1, kind: 'sheet', name, cells, kinds,
    widths: Array.from({ length: shownCols }, (_, c) => Math.round(widths.get(c) ?? 72)),
    rowHeight: ROW_HEIGHT,
    ...(rows > shownRows || cols > shownCols ? { more: { rows: rows - shownRows, cols: cols - shownCols } } : {}),
  }
}

// "AB12" as a 0-based row and column.
function cellAt(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return null
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]) - 1, c: c - 1 }
}

// ---- .xlsx -------------------------------------------------------------------------------

export const DEFAULT_PALETTE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e']

// A path a relationship points at, from the folder of the part pointing.
function resolve(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = from.split('/').slice(0, -1)
  for (const piece of target.split('/')) {
    if (piece === '..') parts.pop()
    else if (piece !== '.') parts.push(piece)
  }
  return parts.join('/')
}

async function relsOf(read: (name: string) => Promise<string | null>, part: string): Promise<Map<string, string>> {
  const folder = part.split('/').slice(0, -1).join('/')
  const name = part.split('/').pop()
  const text = await read(`${folder ? folder + '/' : ''}_rels/${name}.rels`)
  const map = new Map<string, string>()
  if (!text) return map
  for (const rel of all(xml(text), 'Relationship')) map.set(rel.getAttribute('Id') ?? '', resolve(part, rel.getAttribute('Target') ?? ''))
  return map
}

const textOf = (el: Element | undefined) => (el ? all(el, 't').map(t => t.textContent ?? '').join('') : '')

// A theme's colours by name: dk1, lt1, dk2, lt2, accent1 to accent6.
type Theme = Record<string, string>
const SCHEME_ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }
const OFFICE_THEME: Theme = {
  dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6',
  ...Object.fromEntries(DEFAULT_PALETTE.slice(0, 6).map((c, i) => [`accent${i + 1}`, c])),
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}
function rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const channel = (t: number) => {
    t = (t + 1) % 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
}

// The colour an element holding one (a solidFill, a gradient stop) holds: as
// written, the system's, or the theme's, with its tints and shades applied.
function colourOf(holder: Element | undefined, theme: Theme): string | undefined {
  const c = holder?.firstElementChild
  if (!c) return undefined
  const base = c.localName === 'srgbClr' ? `#${c.getAttribute('val')}`
    : c.localName === 'sysClr' ? `#${c.getAttribute('lastClr') ?? '000000'}`
    : c.localName === 'schemeClr' ? theme[SCHEME_ALIAS[c.getAttribute('val') ?? ''] ?? c.getAttribute('val') ?? '']
    : undefined
  if (!base || !/^#[0-9a-f]{6}$/i.test(base)) return undefined
  let [r, g, b] = [1, 3, 5].map(i => parseInt(base.slice(i, i + 2), 16) / 255)
  for (const m of Array.from(c.children)) {
    const v = Number(m.getAttribute('val')) / 100000
    if (m.localName === 'shade') [r, g, b] = [r * v, g * v, b * v]
    else if (m.localName === 'tint') [r, g, b] = [r, g, b].map(x => x + (1 - x) * (1 - v))
    else if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const [h, s, l] = hsl(r, g, b)
      ;[r, g, b] = rgb(h, s, Math.min(1, Math.max(0, m.localName === 'lumMod' ? l * v : l + v)))
    }
  }
  return `#${[r, g, b].map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('')}`
}

// A shape's fill (spPr's own solidFill) or its line's colour; none when it says noFill.
const fillOf = (sp: Element | undefined, theme: Theme) => (sp ? colourOf(children(sp, 'solidFill')[0], theme) : undefined)
const lineOf = (sp: Element | undefined, theme: Theme) => {
  const ln = sp && children(sp, 'ln')[0]
  return ln ? colourOf(children(ln, 'solidFill')[0], theme) : undefined
}
// The numbers or labels a chart keeps cached for a reference.
function cached(el: Element | undefined): { values: (string | null)[]; format?: string } {
  if (!el) return { values: [] }
  const cache = first(el, 'numCache') ?? first(el, 'strCache')
  if (!cache) {
    // Written in, not referenced.
    const lit = first(el, 'numLit') ?? first(el, 'strLit')
    if (!lit) return { values: [] }
    return cached(lit.parentElement ?? undefined)
  }
  const count = Number(first(cache, 'ptCount')?.getAttribute('val') ?? 0)
  const values: (string | null)[] = Array.from({ length: count }, () => null)
  for (const pt of children(cache, 'pt')) {
    const idx = Number(pt.getAttribute('idx'))
    if (idx >= 0) values[idx] = first(pt, 'v')?.textContent ?? null
  }
  return { values, format: first(cache, 'formatCode')?.textContent ?? undefined }
}

function readChart(doc: Document, theme: Theme): ChartData | null {
  const plot = first(doc, 'plotArea')
  if (!plot) return null
  const kinds: Record<string, ChartType> = {
    barChart: 'column', bar3DChart: 'column', lineChart: 'line', line3DChart: 'line', areaChart: 'area', area3DChart: 'area',
    scatterChart: 'scatter', pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut',
  }
  const group = Array.from(plot.children).find(c => c.localName in kinds)
  if (!group) return null
  let type = kinds[group.localName]
  if (type === 'column' && first(group, 'barDir')?.getAttribute('val') === 'bar') type = 'bar'
  const grouping = first(group, 'grouping')?.getAttribute('val')
  const lined = type === 'line' || type === 'scatter'
  const toNumbers = (values: (string | null)[]) => values.map(v => (v === null || v === '' || isNaN(Number(v)) ? null : Number(v)))
  const series: ChartSeries[] = []
  let categories: string[] | undefined
  let xFormat: string | undefined
  children(group, 'ser').forEach((ser, i) => {
    const tx = first(ser, 'tx')
    const name = cached(tx).values[0] ?? (tx && first(tx, 'v')?.textContent) ?? `Series ${i + 1}`
    const sp = children(ser, 'spPr')[0]
    const marker = children(ser, 'marker')[0]
    const markerSp = marker && children(marker, 'spPr')[0]
    const ln = sp && children(sp, 'ln')[0]
    const noLine = !!(ln && children(ln, 'noFill')[0])
    const color = (lined ? lineOf(sp, theme) ?? fillOf(markerSp, theme) ?? lineOf(markerSp, theme) : fillOf(sp, theme))
      ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]
    const made: ChartSeries = { name, color, values: [] }
    if (lined) {
      const symbol = marker && first(marker, 'symbol')?.getAttribute('val')
      made.markers = symbol ? symbol !== 'none' : type === 'scatter'
      if (noLine) made.markersOnly = true
      const width = Number(ln?.getAttribute('w') ?? 0)
      // EMUs to points; drawn thinner, as the chart is shown smaller than it was made.
      if (width) made.width = Math.min(4, Math.max(1.25, (width / 12700) * 0.6))
      const trend = children(ser, 'trendline')[0]
      if (trend && first(trend, 'trendlineType')?.getAttribute('val') === 'linear') {
        made.trend = lineOf(children(trend, 'spPr')[0], theme) ?? color
      }
    }
    if (type === 'scatter') {
      const x = cached(first(ser, 'xVal'))
      xFormat ??= x.format
      made.x = toNumbers(x.values)
      made.values = toNumbers(cached(first(ser, 'yVal')).values)
    } else {
      const cat = cached(first(ser, 'cat'))
      if (!categories && cat.values.length) {
        categories = cat.values.map(v => {
          if (v === null) return ''
          const n = Number(v)
          return cat.format && !isNaN(n) ? formatNumber(n, cat.format) : v
        })
      }
      made.values = toNumbers(cached(first(ser, 'val')).values)
    }
    series.push(made)
  })
  if (series.length === 0) return null

  // The chart's title, unless it was deleted; the axes' titles and formats.
  const chart = first(doc, 'chart')
  const titleEl = chart && children(chart, 'title')[0]
  const deleted = first(doc, 'autoTitleDeleted')?.getAttribute('val') === '1'
  const axes = Array.from(plot.children).filter(c => /Ax$/.test(c.localName))
  const axisAt = (positions: string[]) => axes.find(a => positions.includes(first(a, 'axPos')?.getAttribute('val') ?? ''))
  const axisTitle = (axis: Element | undefined) => {
    const title = axis && children(axis, 'title')[0]
    return title ? textOf(title) || undefined : undefined
  }
  const axisFormat = (axis: Element | undefined) => {
    const fmt = axis && children(axis, 'numFmt')[0]
    return fmt && fmt.getAttribute('sourceLinked') !== '1' ? fmt.getAttribute('formatCode') ?? undefined : undefined
  }
  const xAxis = axisAt(['b', 't']), yAxis = axisAt(['l', 'r'])
  // Its look: the background (a gradient's two ends), and the text's colour.
  const space = Array.from(doc.documentElement.children).find(c => c.localName === 'spPr')
  const stops = space ? all(space, 'gs').map(gs => colourOf(gs, theme)).filter((c): c is string => !!c) : []
  const background = space && children(space, 'noFill')[0] ? undefined : fillOf(space, theme) ?? stops[0] ?? '#ffffff'
  const textHolder = all(doc, 'defRPr').map(d => children(d, 'solidFill')[0]).find(Boolean)
  const legend = chart && children(chart, 'legend')[0]
  const legendPos = legend ? first(legend, 'legendPos')?.getAttribute('val') ?? 'r' : null
  return {
    v: 1, kind: 'chart', type,
    title: !deleted && titleEl ? textOf(titleEl) || (series.length === 1 ? series[0].name : undefined) : undefined,
    xTitle: axisTitle(xAxis),
    yTitle: axisTitle(yAxis),
    stacked: grouping === 'stacked' || grouping === 'percentStacked',
    ...(categories ? { categories } : {}),
    ...(axisFormat(xAxis) ?? xFormat ? { xFormat: axisFormat(xAxis) ?? xFormat } : {}),
    ...(axisFormat(yAxis) ? { yFormat: axisFormat(yAxis) } : {}),
    ...(background ? { background } : {}),
    ...(stops.length > 1 ? { background2: stops[stops.length - 1] } : {}),
    text: colourOf(textHolder, theme) ?? '#595959',
    legend: legendPos === null ? null : legendPos === 'b' || legendPos === 't' ? legendPos : 'r',
    series,
  }
}

async function readXlsx(read: (name: string) => Promise<string | null>, lang?: string): Promise<ReadSpreadsheet> {
  const workbookText = await read('xl/workbook.xml')
  if (!workbookText) throw new Error('not a workbook')
  const workbook = xml(workbookText)
  const rels = await relsOf(read, 'xl/workbook.xml')

  const strings = (await read('xl/sharedStrings.xml').then(t => (t ? all(xml(t), 'si') : []))).map(si =>
    Array.from(si.getElementsByTagNameNS('*', 't')).filter(t => t.parentElement?.localName !== 'rPh').map(t => t.textContent ?? '').join(''))

  // Each style's number format.
  const formats: (string | undefined)[] = []
  const stylesText = await read('xl/styles.xml')
  if (stylesText) {
    const styles = xml(stylesText)
    const custom = new Map(all(styles, 'numFmt').map(f => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']))
    const xfs = first(styles, 'cellXfs')
    for (const xf of xfs ? children(xfs, 'xf') : []) {
      const id = Number(xf.getAttribute('numFmtId') ?? 0)
      formats.push(custom.get(id) ?? BUILTIN_FORMATS[id])
    }
  }

  // The theme's colours, for those a chart names by them.
  const themeText = await read('xl/theme/theme1.xml')
  const theme: Theme = { ...OFFICE_THEME }
  const scheme = themeText ? first(xml(themeText), 'clrScheme') : undefined
  for (const el of scheme ? Array.from(scheme.children) : []) {
    const colour = colourOf(el, theme)
    if (colour) theme[el.localName] = colour
  }

  const sheets: SheetData[] = []
  const charts: ChartData[] = []
  for (const sheet of all(workbook, 'sheet')) {
    const name = sheet.getAttribute('name') ?? 'Sheet'
    const id = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? sheet.getAttribute('r:id') ?? ''
    const path = rels.get(id)
    if (!path) continue
    const text = await read(path)
    if (!text) continue
    const doc = xml(text)

    // Its cells, as they show.
    const grid = new Map<number, Map<number, { text: string; number: boolean }>>()
    for (const c of all(doc, 'c')) {
      const at = cellAt(c.getAttribute('r') ?? '')
      if (!at) continue
      const t = c.getAttribute('t')
      const v = first(c, 'v')?.textContent ?? ''
      let cell: { text: string; number: boolean } | null = null
      if (t === 's') cell = { text: strings[Number(v)] ?? '', number: false }
      else if (t === 'inlineStr') cell = { text: textOf(first(c, 'is')), number: false }
      else if (t === 'str' || t === 'e') cell = { text: v, number: false }
      else if (t === 'b') cell = { text: v === '1' ? 'TRUE' : 'FALSE', number: false }
      else if (t === 'd') cell = { text: new Date(v).toLocaleDateString(lang), number: true }
      else if (v !== '') cell = { text: formatNumber(Number(v), formats[Number(c.getAttribute('s') ?? 0)], lang), number: true }
      if (!cell) continue
      let row = grid.get(at.r)
      if (!row) grid.set(at.r, row = new Map())
      row.set(at.c, cell)
    }
    // Column widths: characters, as Excel keeps them, to pixels.
    const widths = new Map<number, number>()
    for (const col of all(doc, 'col')) {
      const width = Number(col.getAttribute('width') ?? 0)
      for (let c = Number(col.getAttribute('min')) - 1; c < Number(col.getAttribute('max')) && c < MAX_COLS; c++) widths.set(c, Math.max(24, width * 7 + 5))
    }
    const made = sheetOf(name, grid, widths)
    if (made) sheets.push(made)

    // Its charts: through its drawing, to each chart the drawing holds.
    const sheetRels = await relsOf(read, path)
    for (const drawing of all(doc, 'drawing')) {
      const drawingPath = sheetRels.get(drawing.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '')
      if (!drawingPath) continue
      const drawingRels = await relsOf(read, drawingPath)
      const drawingText = await read(drawingPath)
      if (!drawingText) continue
      for (const ref of all(xml(drawingText), 'chart')) {
        const chartPath = drawingRels.get(ref.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? '')
        const chartText = chartPath && await read(chartPath)
        const chart = chartText ? readChart(xml(chartText), theme) : null
        if (chart) charts.push(chart)
      }
    }
  }
  return { sheets, charts }
}

// ---- .ods --------------------------------------------------------------------------------

const ODS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0'
const ODS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const ODS_STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0'

// A length as ODF writes it ("2.258cm", "0.889in"), in pixels.
function odfLength(length: string | null): number | undefined {
  const m = /^([\d.]+)(cm|mm|in|pt|px)$/.exec(length ?? '')
  if (!m) return undefined
  const n = Number(m[1])
  return { cm: n * 37.795, mm: n * 3.7795, in: n * 96, pt: n * 1.333, px: n }[m[2]]
}

async function readOds(read: (name: string) => Promise<string | null>, lang?: string): Promise<ReadSpreadsheet> {
  const text = await read('content.xml')
  if (!text) throw new Error('not a spreadsheet')
  const doc = xml(text)
  const columnWidths = new Map<string, number>()
  for (const style of all(doc, 'style')) {
    const props = first(style, 'table-column-properties')
    const width = odfLength(props?.getAttributeNS(ODS_STYLE, 'column-width') ?? null)
    if (width) columnWidths.set(style.getAttributeNS(ODS_STYLE, 'name') ?? '', width)
  }
  const sheets: SheetData[] = []
  for (const table of all(doc, 'table')) {
    if (table.parentElement?.localName !== 'spreadsheet') continue
    const name = table.getAttributeNS(ODS_TABLE, 'name') ?? 'Sheet'
    const widths = new Map<number, number>()
    let c0 = 0
    for (const col of all(table, 'table-column')) {
      const repeat = Math.min(Number(col.getAttributeNS(ODS_TABLE, 'number-columns-repeated') ?? 1), MAX_COLS)
      const width = columnWidths.get(col.getAttributeNS(ODS_TABLE, 'style-name') ?? '')
      for (let i = 0; i < repeat && c0 < MAX_COLS; i++, c0++) if (width) widths.set(c0, width)
    }
    const grid = new Map<number, Map<number, { text: string; number: boolean }>>()
    let r = 0
    for (const rowEl of all(table, 'table-row')) {
      const rowRepeat = Number(rowEl.getAttributeNS(ODS_TABLE, 'number-rows-repeated') ?? 1)
      let c = 0
      const cells = new Map<number, { text: string; number: boolean }>()
      for (const cellEl of Array.from(rowEl.children).filter(ch => ch.localName === 'table-cell' || ch.localName === 'covered-table-cell')) {
        const repeat = Number(cellEl.getAttributeNS(ODS_TABLE, 'number-columns-repeated') ?? 1)
        const type = cellEl.getAttributeNS(ODS_OFFICE, 'value-type')
        const shown = all(cellEl, 'p').map(p => p.textContent ?? '').join('\n')
        if (type || shown) {
          const number = type === 'float' || type === 'percentage' || type === 'currency' || type === 'date' || type === 'time'
          // What it shows is what LibreOffice wrote it to show.
          const cell = { text: shown, number }
          for (let i = 0; i < Math.min(repeat, MAX_COLS); i++) cells.set(c + i, cell)
        }
        c += repeat
      }
      if (cells.size > 0) for (let i = 0; i < Math.min(rowRepeat, MAX_ROWS); i++) grid.set(r + i, cells)
      r += rowRepeat
      if (r > MAX_ROWS * 4) break
    }
    void lang
    const made = sheetOf(name, grid, widths)
    if (made) sheets.push(made)
  }
  return { sheets, charts: [] }
}

// ---- .csv --------------------------------------------------------------------------------

// Rows of fields: quoted fields may hold the separator, quotes doubled, and
// line breaks. The separator is whichever of , ; or tab the first line has most of.
export function parseCsv(text: string): string[][] {
  const head = text.slice(0, text.indexOf('\n') >>> 0)
  const separator = [',', ';', '\t'].map(s => [s, head.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0]
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === separator) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

function readCsv(text: string, name: string): ReadSpreadsheet {
  const grid = new Map<number, Map<number, { text: string; number: boolean }>>()
  parseCsv(text.replace(/^﻿/, '')).forEach((fields, r) => {
    const row = new Map<number, { text: string; number: boolean }>()
    fields.forEach((f, c) => { if (f !== '') row.set(c, { text: f, number: f.trim() !== '' && !isNaN(Number(f.replace(',', '.'))) }) })
    if (row.size) grid.set(r, row)
  })
  const sheet = sheetOf(name, grid, new Map())
  return { sheets: sheet ? [sheet] : [], charts: [] }
}

// ---- A file of one, read back ---------------------------------------------------------------

// A sheet or chart file, as read back from where it's kept: anything in it not
// of the shape a reader makes is set right or left out, so what's drawn from
// it (lib/sheetDraw, into the page) is only ever numbers, plain text it
// escapes, and colours written #rrggbb. Null when it's neither.
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined)
const nums = (v: unknown) => (Array.isArray(v) ? v.map(x => (typeof x === 'number' && isFinite(x) ? x : null)) : [])
const optional = (v: unknown) => (v == null ? undefined : str(v))
const CHART_TYPES: readonly ChartType[] = ['column', 'bar', 'line', 'area', 'scatter', 'pie', 'doughnut']

export function asSheetFile(raw: any): SheetData | ChartData | null {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return null
  if (raw.kind === 'sheet') {
    const cells: string[][] = (Array.isArray(raw.cells) ? raw.cells : []).slice(0, MAX_ROWS)
      .map((row: unknown) => (Array.isArray(row) ? row.slice(0, MAX_COLS).map(str) : []))
    const cols = cells.reduce((most, row) => Math.max(most, row.length), 0)
    return {
      v: 1, kind: 'sheet', name: str(raw.name), cells,
      kinds: cells.map((_, i) => str(raw.kinds?.[i])),
      widths: Array.from({ length: cols }, (_, c) => num(raw.widths?.[c], 72, 8, 2000)),
      rowHeight: num(raw.rowHeight, ROW_HEIGHT, 8, 200),
      ...(raw.more ? { more: { rows: num(raw.more.rows, 0, 0, 1e9), cols: num(raw.more.cols, 0, 0, 1e6) } } : {}),
    }
  }
  if (raw.kind === 'chart' && CHART_TYPES.includes(raw.type)) {
    const series: ChartSeries[] = (Array.isArray(raw.series) ? raw.series : []).map((s: any, i: number) => ({
      name: str(s?.name),
      color: hex(s?.color) ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
      values: nums(s?.values),
      ...(Array.isArray(s?.x) ? { x: nums(s.x) } : {}),
      ...(s?.markers ? { markers: true } : {}),
      ...(s?.markersOnly ? { markersOnly: true } : {}),
      ...(s?.width != null ? { width: num(s.width, 2, 0.5, 8) } : {}),
      ...(hex(s?.trend) ? { trend: hex(s.trend) } : {}),
    }))
    if (series.length === 0) return null
    return {
      v: 1, kind: 'chart', type: raw.type,
      title: optional(raw.title), xTitle: optional(raw.xTitle), yTitle: optional(raw.yTitle),
      stacked: !!raw.stacked,
      ...(Array.isArray(raw.categories) ? { categories: raw.categories.map(str) } : {}),
      ...(raw.xFormat != null ? { xFormat: str(raw.xFormat) } : {}),
      ...(raw.yFormat != null ? { yFormat: str(raw.yFormat) } : {}),
      ...(hex(raw.background) ? { background: hex(raw.background) } : {}),
      ...(hex(raw.background2) ? { background2: hex(raw.background2) } : {}),
      text: hex(raw.text) ?? '#595959',
      legend: raw.legend === 'b' || raw.legend === 't' || raw.legend === 'r' ? raw.legend : null,
      series,
    }
  }
  return null
}

// ---- Any of them ----------------------------------------------------------------------------

export const SPREADSHEET_FILE = /\.(xlsx|xlsm|ods|csv)$/i

export async function readSpreadsheet(file: File, lang?: string): Promise<ReadSpreadsheet> {
  const name = file.name.replace(/\.[^.]+$/, '')
  if (/\.csv$/i.test(file.name)) return readCsv(await file.text(), name)
  const read = await unzip(await file.arrayBuffer())
  if (await read('xl/workbook.xml')) return readXlsx(read, lang)
  if (await read('content.xml')) return readOds(read, lang)
  throw new Error('not a spreadsheet this can read')
}
