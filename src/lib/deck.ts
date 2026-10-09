// PowerPoint decks: a .pptx read into the slides lib/deckDraw draws -- each
// slide's background and what's on it (text, shapes, pictures, tables,
// charts), in the slide's own pixels. What a slide takes from its layout and
// master -- where a placeholder sits, its text's size and colour and font,
// the theme's colours, what's drawn behind every slide -- is worked out here,
// so drawing is only drawing what's there.
//
// Kept as JSON, the trace's file (a document trace: paged with arrows, as a
// PDF is). asDeckFile reads one back -- a file that may have come from
// someone else's .atrium, so nothing in it is drawn unchecked.
//
// Not drawn: animations, transitions, notes, effects (shadows, glows, 3D),
// a group's own rotation, and pictures no browser shows (EMF, WMF, TIFF).

import { all, asSheetFile, children, colourOf, first, readChart, relsOf, themeOf, unzip, xml, type ChartData, type Theme, type Zip } from './spreadsheet.ts'

export interface DeckRun { text: string; size: number; color: string; font: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }
export interface DeckParagraph {
  align: 'l' | 'ctr' | 'r'
  runs: DeckRun[]
  // Its size when it has no runs (an empty line), and its bullet's.
  size: number
  bullet?: { text: string; color: string; font: string }
  marL: number
  indent: number
  before: number
  after: number
  // Line height: a multiple of the font's, or (`spacingPx`) exactly.
  spacing: number
  spacingPx?: number
}
export interface DeckText { anchor: 't' | 'ctr' | 'b'; inset: [number, number, number, number]; wrap: boolean; paragraphs: DeckParagraph[] }
interface Box { x: number; y: number; w: number; h: number; rot?: number; flipH?: boolean; flipV?: boolean }
export interface DeckCell { text?: DeckText; fill?: string; span?: number; rowSpan?: number; merged?: boolean }
export type DeckItem =
  | (Box & { kind: 'shape'; path: string; open?: boolean; fill?: string; line?: string; lineWidth?: number; dash?: string; head?: boolean; tail?: boolean; text?: DeckText })
  | (Box & { kind: 'picture'; src: string; hash: string; crop?: [number, number, number, number] })
  | (Box & { kind: 'table'; cols: number[]; rows: { h: number; cells: DeckCell[] }[]; border?: string })
  | (Box & { kind: 'chart'; chart: ChartData })
export interface DeckSlide { background: string; picture?: { src: string; hash: string }; items: DeckItem[] }
export interface DeckData { v: 1; kind: 'deck'; name: string; width: number; height: number; slides: DeckSlide[] }

// Where a picture in the deck is kept: given its bytes as a file and a hash of
// them, its address.
export type KeepPicture = (file: File, hash: string) => Promise<string>

export const DECK_FILE = /\.pptx$/i

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const EMU_PX = 9525
const PT = 4 / 3
const emu = (v: string | null | undefined, fallback = 0) => {
  const n = Number(v)
  return v != null && v !== '' && isFinite(n) ? n / EMU_PX : fallback
}
const attr = (el: Element | undefined, name: string) => el?.getAttribute(name) ?? null
const child = (el: Element | undefined, local: string) => (el ? children(el, local)[0] : undefined)
const relId = (el: Element | undefined, name: string) => (el ? el.getAttributeNS(R_NS, name) || el.getAttribute(`r:${name}`) || '' : '')
const firstOf = <T>(values: (T | null | undefined)[]): T | undefined => values.find(v => v != null) ?? undefined

const PICTURE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', webp: 'image/webp' }

// ---- The deck's parts ------------------------------------------------------------------------

interface Part { path: string; doc: Document; rels: Map<string, string> }
// A master's look: its theme's colours (with tx1, bg1... as it maps them) and
// fonts, and its text styles.
interface Look { theme: Theme; major: string; minor: string; title?: Element; body?: Element; other?: Element }

interface Reading {
  zip: Zip
  keep: KeepPicture
  parts: Map<string, Promise<Part | null>>
  looks: Map<string, Promise<Look>>
  pictures: Map<string, Promise<{ src: string; hash: string } | null>>
  defaults?: Element
}

function partOf(r: Reading, path: string): Promise<Part | null> {
  if (!r.parts.has(path)) {
    r.parts.set(path, (async () => {
      const text = await r.zip(path)
      return text ? { path, doc: xml(text), rels: await relsOf(r.zip, path) } : null
    })())
  }
  return r.parts.get(path)!
}
const related = (part: Part, folder: string) => [...part.rels.values()].find(p => p.includes(`/${folder}/`))

function lookOf(r: Reading, master: Part): Promise<Look> {
  if (!r.looks.has(master.path)) {
    r.looks.set(master.path, (async () => {
      const themePath = related(master, 'theme')
      const themeText = themePath ? await r.zip(themePath) : null
      const theme = themeOf(themeText)
      // tx1, bg1, tx2, bg2 as the master maps them -- a dark master swaps them.
      const map = first(master.doc, 'clrMap')
      for (const name of ['tx1', 'bg1', 'tx2', 'bg2']) {
        const to = attr(map, name) ?? { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' }[name]!
        if (theme[to]) theme[name] = theme[to]
      }
      const fonts = themeText ? first(xml(themeText), 'fontScheme') : undefined
      const face = (which: string) => attr(child(fonts && child(fonts, which), 'latin'), 'typeface') || 'Calibri'
      const styles = first(master.doc, 'txStyles')
      return {
        theme, major: face('majorFont'), minor: face('minorFont'),
        title: child(styles, 'titleStyle'), body: child(styles, 'bodyStyle'), other: child(styles, 'otherStyle'),
      }
    })())
  }
  return r.looks.get(master.path)!
}

// A picture in the deck, kept once however many slides show it.
function pictureOf(r: Reading, path: string | undefined): Promise<{ src: string; hash: string } | null> {
  if (!path) return Promise.resolve(null)
  if (!r.pictures.has(path)) {
    r.pictures.set(path, (async () => {
      const ext = path.split('.').pop()?.toLowerCase() ?? ''
      if (!PICTURE_TYPES[ext]) return null
      const bytes = await r.zip.bytes(path)
      if (!bytes) return null
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource))
      const hash = Array.from(digest.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
      const src = await r.keep(new File([bytes as unknown as BlobPart], path.split('/').pop() ?? `picture.${ext}`, { type: PICTURE_TYPES[ext] }), hash)
      return { src, hash }
    })().catch(() => null))
  }
  return r.pictures.get(path)!
}

// ---- Placeholders ------------------------------------------------------------------------------

interface Ph { type: string; idx: string | null }
function phOf(el: Element): Ph | null {
  const nv = Array.from(el.children).find(c => c.localName.startsWith('nv'))
  const ph = child(child(nv, 'nvPr'), 'ph')
  return ph ? { type: attr(ph, 'type') ?? 'obj', idx: attr(ph, 'idx') } : null
}
// Its kind as a master has them.
const kindOf = (type: string) => (type === 'ctrTitle' || type === 'title' ? 'title' : ['dt', 'ftr', 'sldNum', 'hdr'].includes(type) ? type : 'body')

// The layout's or master's placeholder a slide's fills: by its index, else by its kind.
function matching(doc: Document | undefined, ph: Ph, byKind = false): Element | undefined {
  if (!doc) return undefined
  const placeholders = all(doc, 'sp').filter(sp => phOf(sp))
  if (!byKind && ph.idx !== null) {
    const hit = placeholders.find(sp => phOf(sp)!.idx === ph.idx)
    if (hit) return hit
  }
  return placeholders.find(sp => kindOf(phOf(sp)!.type) === kindOf(ph.type))
}

// ---- Boxes -----------------------------------------------------------------------------------

function xfrmOf(el: Element | undefined): Element | undefined {
  if (!el) return undefined
  const sp = Array.from(el.children).find(c => c.localName === 'spPr' || c.localName === 'grpSpPr')
  return (sp && child(sp, 'xfrm')) ?? child(el, 'xfrm')
}
function boxOf(x: Element | undefined): Box | null {
  const off = child(x, 'off'), ext = child(x, 'ext')
  if (!off || !ext) return null
  const rot = Number(attr(x, 'rot') ?? 0) / 60000
  return {
    x: emu(attr(off, 'x')), y: emu(attr(off, 'y')), w: emu(attr(ext, 'cx')), h: emu(attr(ext, 'cy')),
    ...(rot ? { rot } : {}), ...(attr(x, 'flipH') === '1' ? { flipH: true } : {}), ...(attr(x, 'flipV') === '1' ? { flipV: true } : {}),
  }
}
type Place = (b: Box) => Box
const asIs: Place = b => b

// ---- Text --------------------------------------------------------------------------------------

// Where a text's look comes from, nearest first: its paragraph's own, then
// each list of levels (the shape's, its layout's and master's placeholder's,
// the master's style for its kind, the deck's default).
interface TextFrom {
  lists: (Element | undefined)[]
  bodies: (Element | undefined)[]
  // A shape's own text colour (its style's fontRef), and a table header's.
  ink?: string
  bold?: boolean
  inset?: [number, number, number, number]
  anchor?: string | null
}

const WINGDINGS: Record<string, string> = { '§': '▪', 'Ø': '➢', 'ü': '✓', 'q': '❑', 'v': '❖', 'n': '■', 'l': '●', 'Ü': '➢', 'o': '○', 'p': '□', 'w': '◆', 'u': '◆' }

function numbered(type: string, n: number): string {
  const roman = (v: number) => {
    let out = ''
    for (const [k, s] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as const) while (v >= k) { out += s; v -= k }
    return out
  }
  const alpha = (v: number) => String.fromCharCode(96 + (((v - 1) % 26) + 1))
  const core = /^alphaLc/.test(type) ? alpha(n) : /^alphaUc/.test(type) ? alpha(n).toUpperCase()
    : /^romanLc/.test(type) ? roman(n) : /^romanUc/.test(type) ? roman(n).toUpperCase() : String(n)
  return /ParenBoth$/.test(type) ? `(${core})` : /ParenR$/.test(type) ? `${core})` : /Plain$/.test(type) ? core : `${core}.`
}

function readText(txBody: Element | undefined, from: TextFrom, look: Look): DeckText | undefined {
  if (!txBody) return undefined
  const paragraphs = children(txBody, 'p')
  if (!paragraphs.some(p => (p.textContent ?? '').trim())) return undefined
  const bodyAttr = (name: string) => firstOf(from.bodies.map(b => attr(b, name)))
  const fit = child(from.bodies[0], 'normAutofit')
  const scale = Number(attr(fit, 'fontScale') ?? 100000) / 100000 || 1
  const cut = Number(attr(fit, 'lnSpcReduction') ?? 0) / 100000
  const face = (typeface: string | null | undefined) =>
    !typeface ? undefined : typeface.startsWith('+mj') ? look.major : typeface.startsWith('+mn') ? look.minor : typeface
  const counters: number[] = []

  const out: DeckParagraph[] = paragraphs.map(p => {
    const pPr = child(p, 'pPr')
    const level = Math.min(8, Number(attr(pPr, 'lvl') ?? 0))
    for (let deeper = level + 1; deeper < counters.length; deeper++) counters[deeper] = 0
    const levels = [pPr, ...from.lists.map(l => (l ? child(l, `lvl${level + 1}pPr`) : undefined))]
    const pAttr = (name: string) => firstOf(levels.map(l => attr(l, name)))
    const defs = levels.map(l => child(l, 'defRPr'))
    // Nearest first; a shape's own text colour goes after the placeholder's
    // lists and before the master's style for its kind.
    const runColour = (rPr: Element | undefined) => firstOf([
      colourOf(child(rPr, 'solidFill'), look.theme),
      ...defs.slice(0, 4).map(d => colourOf(child(d, 'solidFill'), look.theme)),
      from.ink,
      ...defs.slice(4).map(d => colourOf(child(d, 'solidFill'), look.theme)),
    ]) ?? look.theme.tx1 ?? '#000000'
    const runAttr = (rPr: Element | undefined, name: string) => attr(rPr, name) ?? firstOf(defs.map(d => attr(d, name)))
    const runOf = (rPr: Element | undefined, text: string): DeckRun => {
      const bold = runAttr(rPr, 'b'), italic = runAttr(rPr, 'i'), u = runAttr(rPr, 'u'), strike = runAttr(rPr, 'strike')
      const caps = runAttr(rPr, 'cap')
      const isBold = bold != null ? bold === '1' || bold === 'true' : !!from.bold
      return {
        text: caps === 'all' ? text.toUpperCase() : text,
        size: (Number(runAttr(rPr, 'sz') ?? 1800) / 100) * PT * scale,
        color: runColour(rPr),
        font: face(attr(child(rPr, 'latin'), 'typeface')) ?? face(firstOf(defs.map(d => attr(child(d, 'latin'), 'typeface')))) ?? look.minor,
        ...(isBold ? { bold: true } : {}),
        ...(italic === '1' || italic === 'true' ? { italic: true } : {}),
        ...(u && u !== 'none' ? { underline: true } : {}),
        ...(strike && strike !== 'noStrike' ? { strike: true } : {}),
      }
    }

    const runs: DeckRun[] = []
    for (const el of Array.from(p.children)) {
      if (el.localName === 'r' || el.localName === 'fld') runs.push(runOf(child(el, 'rPr'), child(el, 't')?.textContent ?? ''))
      else if (el.localName === 'br') runs.push(runOf(child(el, 'rPr'), '\n'))
    }
    const end = runOf(child(p, 'endParaRPr'), '')
    const lead = runs.find(r => r.text.trim()) ?? end

    // Its bullet: the nearest level that says one way or the other.
    let bullet: DeckParagraph['bullet']
    const bu = firstOf(levels.map(l => (l ? Array.from(l.children).find(c => /^bu(None|Char|AutoNum|Blip)$/.test(c.localName)) : undefined)))
    if (bu?.localName === 'buAutoNum') {
      counters[level] = counters[level] ? counters[level] + 1 : Number(attr(bu, 'startAt') ?? 1)
      bullet = { text: numbered(attr(bu, 'type') ?? 'arabicPeriod', counters[level]), color: lead.color, font: lead.font }
    } else {
      counters[level] = 0
      if (bu?.localName === 'buChar' || bu?.localName === 'buBlip') {
        const buFace = firstOf(levels.map(l => attr(child(l, 'buFont'), 'typeface')))
        const char = bu.localName === 'buBlip' ? '•' : attr(bu, 'char') ?? '•'
        const wing = /wingdings/i.test(buFace ?? '')
        bullet = {
          text: wing ? WINGDINGS[char] ?? '•' : char,
          color: colourOf(firstOf(levels.map(l => child(l, 'buClr'))), look.theme) ?? lead.color,
          font: wing || !buFace ? lead.font : face(buFace) ?? lead.font,
        }
      }
    }
    if (!runs.some(r => r.text.trim())) bullet = undefined

    const spacingOf = (name: string): { pct?: number; px?: number } => {
      const holder = firstOf(levels.map(l => child(l, name)))
      const pct = child(holder, 'spcPct'), pts = child(holder, 'spcPts')
      return pct ? { pct: Number(attr(pct, 'val') ?? 100000) / 100000 } : pts ? { px: (Number(attr(pts, 'val') ?? 0) / 100) * PT * scale } : {}
    }
    const line = spacingOf('lnSpc'), before = spacingOf('spcBef'), after = spacingOf('spcAft')
    const size = Math.max(end.size, ...runs.map(r => r.size))
    const algn = pAttr('algn')
    return {
      align: algn === 'ctr' ? 'ctr' : algn === 'r' ? 'r' : 'l',
      runs: runs.filter(r => r.text !== ''),
      size: end.size,
      ...(bullet ? { bullet } : {}),
      marL: emu(pAttr('marL')),
      indent: emu(pAttr('indent')),
      before: before.px ?? (before.pct ?? 0) * size * 1.2,
      after: after.px ?? (after.pct ?? 0) * size * 1.2,
      spacing: (line.pct ?? 1) * (1 - cut),
      ...(line.px ? { spacingPx: line.px } : {}),
    }
  })

  const anchor = from.anchor ?? bodyAttr('anchor')
  return {
    anchor: anchor === 'ctr' ? 'ctr' : anchor === 'b' ? 'b' : 't',
    inset: from.inset ?? [
      emu(bodyAttr('lIns'), 9.6), emu(bodyAttr('tIns'), 4.8), emu(bodyAttr('rIns'), 9.6), emu(bodyAttr('bIns'), 4.8),
    ],
    wrap: bodyAttr('wrap') !== 'none',
    paragraphs: out,
  }
}

// ---- Shapes ----------------------------------------------------------------------------------

const f = (v: number) => Math.round(v * 100) / 100

// A preset shape's outline in its box, w by h; its adjustments by name.
function presetPath(prst: string, w: number, h: number, adj: (name: string, fallback: number) => number): { path: string; open?: boolean } {
  const m = Math.min(w, h)
  const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z`
  const ellipse = `M0 ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)} A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)} Z`
  const rounded = (r: number) => {
    r = Math.min(r, w / 2, h / 2)
    return `M${f(r)} 0 H${f(w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V${f(h - r)} A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)} H${f(r)} A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)} V${f(r)} A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0 Z`
  }
  // An arrow pointing right, in a w by h box -- turned by `turn` for the others.
  const arrow = (W: number, H: number, turn: (x: number, y: number) => [number, number]) => {
    const shaft = H * adj('adj1', 50000) / 100000, head = Math.min(W, Math.min(W, H) * adj('adj2', 50000) / 100000)
    const y1 = (H - shaft) / 2, y2 = (H + shaft) / 2, hx = W - head
    return poly(([[0, y1], [hx, y1], [hx, 0], [W, H / 2], [hx, H], [hx, y2], [0, y2]] as [number, number][]).map(([x, y]) => turn(x, y)))
  }
  const star = (points: number, inner: number) => poly(Array.from({ length: points * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / points, r = i % 2 ? inner : 1
    return [w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)] as [number, number]
  }))
  switch (prst) {
    case 'line': case 'straightConnector1': return { path: `M0 0 L${f(w)} ${f(h)}`, open: true }
    case 'bentConnector2': return { path: `M0 0 L${f(w)} 0 L${f(w)} ${f(h)}`, open: true }
    case 'bentConnector3': case 'bentConnector4': case 'bentConnector5': {
      const x = w * adj('adj1', 50000) / 100000
      return { path: `M0 0 L${f(x)} 0 L${f(x)} ${f(h)} L${f(w)} ${f(h)}`, open: true }
    }
    case 'curvedConnector2': case 'curvedConnector3': case 'curvedConnector4': case 'curvedConnector5':
      return { path: `M0 0 C${f(w / 2)} 0 ${f(w / 2)} ${f(h)} ${f(w)} ${f(h)}`, open: true }
    case 'ellipse': case 'flowChartConnector': case 'donut': case 'cloud': case 'cloudCallout': case 'wedgeEllipseCallout': return { path: ellipse }
    case 'roundRect': case 'flowChartAlternateProcess': case 'wedgeRoundRectCallout': return { path: rounded(m * adj('adj', adj('adj1', 16667)) / 100000) }
    case 'flowChartTerminator': return { path: rounded(h / 2) }
    case 'triangle': case 'flowChartExtract': return { path: poly([[w * adj('adj', 50000) / 100000, 0], [w, h], [0, h]]) }
    case 'rtTriangle': return { path: poly([[0, 0], [w, h], [0, h]]) }
    case 'diamond': case 'flowChartDecision': return { path: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) }
    case 'parallelogram': case 'flowChartInputOutput': { const o = m * adj('adj', 25000) / 100000; return { path: poly([[o, 0], [w, 0], [w - o, h], [0, h]]) } }
    case 'trapezoid': { const o = m * adj('adj', 25000) / 100000; return { path: poly([[0, h], [o, 0], [w - o, 0], [w, h]]) } }
    case 'pentagon': return { path: poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]) }
    case 'homePlate': { const o = Math.min(w, m * adj('adj', 50000) / 100000); return { path: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]) } }
    case 'chevron': { const o = Math.min(w, m * adj('adj', 50000) / 100000); return { path: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]) } }
    case 'hexagon': { const o = m * adj('adj', 25000) / 100000; return { path: poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]) } }
    case 'octagon': { const o = m * adj('adj', 29289) / 100000; return { path: poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]) } }
    case 'plus': case 'flowChartSummingJunction': { const o = m * adj('adj', 25000) / 100000; return { path: poly([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]) } }
    case 'rightArrow': return { path: arrow(w, h, (x, y) => [x, y]) }
    case 'leftArrow': return { path: arrow(w, h, (x, y) => [w - x, y]) }
    case 'downArrow': return { path: arrow(h, w, (x, y) => [y, x]) }
    case 'upArrow': return { path: arrow(h, w, (x, y) => [y, h - x]) }
    case 'star4': return { path: star(4, 0.25) }
    case 'star5': return { path: star(5, 0.38) }
    case 'star6': return { path: star(6, 0.58) }
    case 'star8': return { path: star(8, 0.7) }
    default: return { path: `M0 0 H${f(w)} V${f(h)} H0 Z` }
  }
}

// A freeform shape's outline, scaled from its own path size to its box.
function customPath(geom: Element, w: number, h: number): { path: string; open: boolean } | null {
  const out: string[] = []
  let open = true
  for (const path of all(geom, 'path')) {
    const sx = Number(attr(path, 'w') ?? 0) ? w / Number(attr(path, 'w')) : 1 / EMU_PX
    const sy = Number(attr(path, 'h') ?? 0) ? h / Number(attr(path, 'h')) : 1 / EMU_PX
    const pt = (p: Element) => [Number(attr(p, 'x') ?? 0) * sx, Number(attr(p, 'y') ?? 0) * sy] as [number, number]
    let at: [number, number] = [0, 0]
    for (const step of Array.from(path.children)) {
      const pts = children(step, 'pt').map(pt)
      if (step.localName === 'moveTo' && pts[0]) { at = pts[0]; out.push(`M${f(at[0])} ${f(at[1])}`) }
      else if (step.localName === 'lnTo' && pts[0]) { at = pts[0]; out.push(`L${f(at[0])} ${f(at[1])}`) }
      else if (step.localName === 'cubicBezTo' && pts.length === 3) { at = pts[2]; out.push(`C${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' ')}`) }
      else if (step.localName === 'quadBezTo' && pts.length === 2) { at = pts[1]; out.push(`Q${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join(' ')}`) }
      else if (step.localName === 'arcTo') {
        const rx = Number(attr(step, 'wR') ?? 0) * sx, ry = Number(attr(step, 'hR') ?? 0) * sy
        const start = (Number(attr(step, 'stAng') ?? 0) / 60000) * Math.PI / 180, sweep = (Number(attr(step, 'swAng') ?? 0) / 60000) * Math.PI / 180
        const cx = at[0] - rx * Math.cos(start), cy = at[1] - ry * Math.sin(start)
        at = [cx + rx * Math.cos(start + sweep), cy + ry * Math.sin(start + sweep)]
        out.push(`A${f(rx)} ${f(ry)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${f(at[0])} ${f(at[1])}`)
      } else if (step.localName === 'close') { out.push('Z'); open = false }
    }
  }
  return out.length ? { path: out.join(' '), open } : null
}

const DASHES = new Set(['dash', 'dashDot', 'dot', 'lgDash', 'lgDashDot', 'lgDashDotDot', 'sysDash', 'sysDashDot', 'sysDashDotDot', 'sysDot'])

// A fill as a spPr says it: a colour, none (''), or nothing said (undefined).
function fillIn(spPr: Element | undefined, theme: Theme): string | undefined {
  if (!spPr) return undefined
  for (const c of Array.from(spPr.children)) {
    if (c.localName === 'noFill') return ''
    if (c.localName === 'solidFill') return colourOf(c, theme) ?? ''
    if (c.localName === 'gradFill') return colourOf(first(c, 'gs'), theme) ?? ''
    if (c.localName === 'pattFill') return colourOf(child(c, 'fgClr'), theme) ?? ''
    if (c.localName === 'blipFill' || c.localName === 'grpFill') return ''
  }
  return undefined
}

const styleRef = (el: Element, name: string) => child(child(el, 'style'), name)
const refColour = (ref: Element | undefined, theme: Theme) => (ref && attr(ref, 'idx') !== '0' ? colourOf(ref, theme) : undefined)

// Where a slide's shapes come from, for the placeholders among them.
interface Inherit { layout?: Document; master?: Document }

async function readShape(r: Reading, el: Element, part: Part, look: Look, place: Place, inherit: Inherit | null): Promise<DeckItem[]> {
  const ph = phOf(el)
  if (ph && !inherit) return []
  const layoutSp = ph && inherit ? matching(inherit.layout, ph) : undefined
  const masterSp = ph && inherit ? matching(inherit.master, layoutSp ? phOf(layoutSp) ?? ph : ph, true) : undefined
  const own = place(boxOf(xfrmOf(el)) ?? boxOf(xfrmOf(layoutSp)) ?? boxOf(xfrmOf(masterSp)) ?? { x: 0, y: 0, w: 0, h: 0 })
  if (!own.w && !own.h) return []
  const spPrs = [el, layoutSp, masterSp].map(s => (s ? child(s, 'spPr') : undefined))
  const { theme } = look

  const geom = firstOf(spPrs.map(s => child(s, 'prstGeom') ?? child(s, 'custGeom')))
  const adj = (name: string, fallback: number) => {
    const gd = geom && all(geom, 'gd').find(g => attr(g, 'name') === name)
    const m = /^val (-?\d+)/.exec(attr(gd, 'fmla') ?? '')
    return m ? Number(m[1]) : fallback
  }
  const outline = geom?.localName === 'custGeom'
    ? customPath(geom, own.w, own.h) ?? presetPath('rect', own.w, own.h, adj)
    : presetPath(attr(geom, 'prst') ?? 'rect', own.w, own.h, adj)

  const said = firstOf(spPrs.map(s => fillIn(s, theme)))
  const fill = said !== undefined ? said || undefined : outline.open ? undefined : refColour(styleRef(el, 'fillRef'), theme)
  const ln = firstOf(spPrs.map(s => child(s, 'ln')))
  const lineSaid = fillIn(ln, theme)
  const line = lineSaid !== undefined ? lineSaid || undefined : refColour(styleRef(el, 'lnRef'), theme)
  const dash = attr(child(ln, 'prstDash'), 'val')
  const ends = (name: string) => { const t = attr(child(ln, name), 'type'); return !!t && t !== 'none' }

  const kind = ph ? kindOf(ph.type) : null
  const lstOf = (s: Element | undefined) => child(child(s, 'txBody'), 'lstStyle')
  const text = readText(child(el, 'txBody'), {
    lists: [lstOf(el), lstOf(layoutSp), lstOf(masterSp), kind === 'title' ? look.title : kind === 'body' ? look.body : kind ? look.other : undefined, r.defaults],
    bodies: [el, layoutSp, masterSp].map(s => child(child(s, 'txBody'), 'bodyPr')),
    ink: colourOf(styleRef(el, 'fontRef'), theme),
  }, look)

  const items: DeckItem[] = []
  // A shape filled with a picture: the picture, then the shape's outline and text.
  const blip = firstOf(spPrs.map(s => child(s, 'blipFill')))
  if (blip) {
    const pic = await pictureOf(r, part.rels.get(relId(first(blip, 'blip'), 'embed')))
    if (pic) items.push({ kind: 'picture', ...own, flipH: undefined, flipV: undefined, ...pic })
  }
  if (!fill && !line && !text) return items
  items.push({
    kind: 'shape', ...own, path: outline.path,
    ...(outline.open ? { open: true } : {}),
    ...(fill ? { fill } : {}),
    ...(line ? { line, lineWidth: Math.max(0.5, emu(attr(ln, 'w'), 4 / 3)) } : {}),
    ...(line && dash && DASHES.has(dash) ? { dash } : {}),
    ...(line && ends('headEnd') ? { head: true } : {}),
    ...(line && ends('tailEnd') ? { tail: true } : {}),
    ...(text ? { text } : {}),
  })
  return items
}

async function readPicture(r: Reading, el: Element, part: Part, place: Place, inherit: Inherit | null): Promise<DeckItem[]> {
  const ph = phOf(el)
  const layoutSp = ph && inherit ? matching(inherit.layout, ph) : undefined
  const box = boxOf(xfrmOf(el)) ?? boxOf(xfrmOf(layoutSp))
  const blipFill = child(el, 'blipFill')
  const pic = await pictureOf(r, part.rels.get(relId(child(blipFill, 'blip'), 'embed')))
  if (!box || !pic) return []
  const rect = child(blipFill, 'srcRect')
  const crop = ['l', 't', 'r', 'b'].map(k => Number(attr(rect, k) ?? 0) / 100000) as [number, number, number, number]
  return [{ kind: 'picture', ...place(box), ...pic, ...(crop.some(Boolean) ? { crop } : {}) }]
}

function mix(hex: string, toward: string, t: number): string {
  const a = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), b = [1, 3, 5].map(i => parseInt(toward.slice(i, i + 2), 16))
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

async function readFrame(r: Reading, el: Element, part: Part, look: Look, place: Place, inherit: Inherit | null): Promise<DeckItem[]> {
  const box = boxOf(xfrmOf(el))
  const data = first(el, 'graphicData')
  const uri = attr(data, 'uri') ?? ''
  if (!box || !data) return []
  const at = place(box)

  if (uri.endsWith('/chart')) {
    const path = part.rels.get(relId(first(data, 'chart'), 'id'))
    const text = path ? await r.zip(path) : null
    const chart = text ? readChart(xml(text), look.theme) : null
    return chart ? [{ kind: 'chart', ...at, chart }] : []
  }

  if (uri.endsWith('/table')) {
    const tbl = first(data, 'tbl')
    if (!tbl) return []
    const tblPr = child(tbl, 'tblPr')
    const header = attr(tblPr, 'firstRow') === '1', banded = attr(tblPr, 'bandRow') === '1'
    // Office's default table style, near enough: the first accent for the
    // header, its tints for alternate rows, white between cells.
    const accent = look.theme.accent1 ?? '#4472c4'
    const styled = header || banded
    const grid = child(tbl, 'tblGrid')
    const cols = grid ? children(grid, 'gridCol').map(c => emu(attr(c, 'w'))) : []
    const rows = children(tbl, 'tr').map((tr, ri) => ({
      h: emu(attr(tr, 'h')),
      cells: children(tr, 'tc').map((tc): DeckCell => {
        const tcPr = child(tc, 'tcPr')
        const isHeader = header && ri === 0
        const data = ri - (header ? 1 : 0)
        const own = fillIn(tcPr, look.theme)
        const fill = own !== undefined ? own || undefined
          : isHeader ? accent : banded ? mix(accent, '#ffffff', data % 2 === 0 ? 0.6 : 0.8) : undefined
        const text = readText(child(tc, 'txBody'), {
          lists: [child(child(tc, 'txBody'), 'lstStyle'), undefined, undefined, undefined, r.defaults],
          bodies: [],
          ink: isHeader ? look.theme.lt1 ?? '#ffffff' : undefined,
          bold: isHeader,
          inset: [emu(attr(tcPr, 'marL'), 9.6), emu(attr(tcPr, 'marT'), 4.8), emu(attr(tcPr, 'marR'), 9.6), emu(attr(tcPr, 'marB'), 4.8)],
          anchor: attr(tcPr, 'anchor'),
        }, look)
        return {
          ...(text ? { text } : {}),
          ...(fill ? { fill } : {}),
          ...(Number(attr(tc, 'gridSpan') ?? 1) > 1 ? { span: Number(attr(tc, 'gridSpan')) } : {}),
          ...(Number(attr(tc, 'rowSpan') ?? 1) > 1 ? { rowSpan: Number(attr(tc, 'rowSpan')) } : {}),
          ...(attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1' ? { merged: true } : {}),
        }
      }),
    }))
    // The cells' own line where they have one, else white for a styled table.
    const lnB = first(tbl, 'lnB')
    const border = colourOf(lnB && child(lnB, 'solidFill'), look.theme) ?? (styled ? '#ffffff' : undefined)
    return [{ kind: 'table', ...at, cols, rows, ...(border ? { border } : {}) }]
  }

  // SmartArt: the drawing PowerPoint keeps of it, placed in the frame.
  if (uri.endsWith('/diagram')) {
    const dataPath = part.rels.get(relId(first(data, 'relIds'), 'dm'))
    const dataText = dataPath ? await r.zip(dataPath) : null
    const drawingId = dataText ? attr(first(xml(dataText), 'dataModelExt'), 'relId') : null
    const drawingPath = drawingId ? part.rels.get(drawingId) : undefined
    const drawing = drawingPath ? await partOf(r, drawingPath) : null
    const tree = drawing && first(drawing.doc, 'spTree')
    if (!drawing || !tree) return []
    return shapesIn(r, tree, drawing, look, b => place({ ...b, x: b.x + box.x, y: b.y + box.y }), null)
  }

  // Anything else that keeps a picture of itself (an embedded object).
  const pic = first(data, 'pic')
  if (pic) {
    const items = await readPicture(r, pic, part, asIs, inherit)
    return items.map(item => ({ ...item, ...at }))
  }
  return []
}

// What's in a tree of shapes, in the order drawn. `inherit` is the slide's
// layout and master, for its placeholders; a layout's or master's own
// placeholders are only prompts, never drawn.
async function shapesIn(r: Reading, tree: Element, part: Part, look: Look, place: Place, inherit: Inherit | null): Promise<DeckItem[]> {
  const out: DeckItem[] = []
  for (const el of Array.from(tree.children)) {
    switch (el.localName) {
      case 'sp': case 'cxnSp':
        out.push(...await readShape(r, el, part, look, place, inherit))
        break
      case 'pic':
        if (!phOf(el) || inherit) out.push(...await readPicture(r, el, part, place, inherit))
        break
      case 'graphicFrame':
        out.push(...await readFrame(r, el, part, look, place, inherit))
        break
      case 'grpSp': {
        const x = xfrmOf(el)
        const g = boxOf(x)
        const chOff = child(x, 'chOff'), chExt = child(x, 'chExt')
        if (!g) break
        const cx = emu(attr(chOff, 'x')), cy = emu(attr(chOff, 'y'))
        const sx = g.w / (emu(attr(chExt, 'cx')) || g.w || 1), sy = g.h / (emu(attr(chExt, 'cy')) || g.h || 1)
        out.push(...await shapesIn(r, el, part, look, b => place({ ...b, x: g.x + (b.x - cx) * sx, y: g.y + (b.y - cy) * sy, w: b.w * sx, h: b.h * sy }), inherit))
        break
      }
      case 'AlternateContent': {
        const pick = child(el, 'Fallback') ?? child(el, 'Choice')
        if (pick) out.push(...await shapesIn(r, pick, part, look, place, inherit))
        break
      }
    }
  }
  return out
}

// A slide's background: its own, else its layout's, else its master's.
async function backgroundOf(r: Reading, parts: Part[], look: Look): Promise<Pick<DeckSlide, 'background' | 'picture'>> {
  for (const part of parts) {
    const bg = first(part.doc, 'bg')
    if (!bg) continue
    const bgPr = child(bg, 'bgPr')
    const blip = child(bgPr, 'blipFill')
    if (blip) {
      const picture = await pictureOf(r, part.rels.get(relId(first(blip, 'blip'), 'embed')))
      if (picture) return { background: look.theme.bg1 ?? '#ffffff', picture }
    }
    const colour = bgPr ? fillIn(bgPr, look.theme) : colourOf(child(bg, 'bgRef'), look.theme)
    if (colour) return { background: colour }
  }
  return { background: look.theme.bg1 ?? '#ffffff' }
}

const showsMaster = (part: Part) => part.doc.documentElement.getAttribute('showMasterSp') !== '0'

// A .pptx file's slides; pictures kept by `keep`. Thrown when it isn't one.
export async function readDeck(file: File, keep: KeepPicture): Promise<DeckData> {
  const zip = await unzip(await file.arrayBuffer())
  const r: Reading = { zip, keep, parts: new Map(), looks: new Map(), pictures: new Map() }
  const presentation = await partOf(r, 'ppt/presentation.xml')
  if (!presentation) throw new Error('not a PowerPoint file')
  r.defaults = first(presentation.doc, 'defaultTextStyle')
  const size = first(presentation.doc, 'sldSz')
  const width = emu(attr(size, 'cx'), 1280), height = emu(attr(size, 'cy'), 720)

  const slides: DeckSlide[] = []
  for (const id of all(presentation.doc, 'sldId')) {
    const slide = await partOf(r, presentation.rels.get(relId(id, 'id')) ?? '')
    const layoutPath = slide && related(slide, 'slideLayouts')
    const layout = layoutPath ? await partOf(r, layoutPath) : null
    const masterPath = layout && related(layout, 'slideMasters')
    const master = masterPath ? await partOf(r, masterPath) : null
    if (!slide || !layout || !master) continue
    const look = await lookOf(r, master)
    const items: DeckItem[] = []
    const treeOf = (part: Part) => first(part.doc, 'spTree')
    if (showsMaster(slide) && showsMaster(layout) && treeOf(master)) items.push(...await shapesIn(r, treeOf(master)!, master, look, asIs, null))
    if (showsMaster(slide) && treeOf(layout)) items.push(...await shapesIn(r, treeOf(layout)!, layout, look, asIs, null))
    if (treeOf(slide)) items.push(...await shapesIn(r, treeOf(slide)!, slide, look, asIs, { layout: layout.doc, master: master.doc }))
    slides.push({ ...await backgroundOf(r, [slide, layout, master], look), items })
  }
  return { v: 1, kind: 'deck', name: file.name.replace(/\.[^.]+$/, ''), width, height, slides }
}

// ---- Read back, checked ---------------------------------------------------------------------

const MAX_SLIDES = 1000
const MAX_ITEMS = 3000
const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined)
const num = (v: unknown, fallback = 0, lo = -1e6, hi = 1e6) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
const str = (v: unknown) => (typeof v === 'string' ? v : '')
// Only what the vault or the web keeps, or a picture written in.
const SRC = /^(local:\/\/|https:\/\/|data:image\/(png|jpeg|gif|webp|bmp);)/
const PATH = /^[MLHVCSQTAZmlhvcsqtaz0-9.,\s-]*$/
const FONT_NAME = (v: unknown) => str(v).replace(/[^\w .-]/g, '').slice(0, 64) || 'Calibri'

function asText(raw: any): DeckText | undefined {
  if (!raw || !Array.isArray(raw.paragraphs)) return undefined
  const run = (r: any): DeckRun => ({
    text: str(r?.text).slice(0, 10000), size: num(r?.size, 24, 1, 2000), color: hex(r?.color) ?? '#000000', font: FONT_NAME(r?.font),
    ...(r?.bold ? { bold: true } : {}), ...(r?.italic ? { italic: true } : {}), ...(r?.underline ? { underline: true } : {}), ...(r?.strike ? { strike: true } : {}),
  })
  return {
    anchor: raw.anchor === 'ctr' || raw.anchor === 'b' ? raw.anchor : 't',
    inset: [0, 1, 2, 3].map(i => num(raw.inset?.[i], 0, 0, 1e4)) as [number, number, number, number],
    wrap: raw.wrap !== false,
    paragraphs: raw.paragraphs.slice(0, 2000).map((p: any): DeckParagraph => ({
      align: p?.align === 'ctr' || p?.align === 'r' ? p.align : 'l',
      runs: (Array.isArray(p?.runs) ? p.runs : []).slice(0, 2000).map(run),
      size: num(p?.size, 24, 1, 2000),
      ...(p?.bullet ? { bullet: { text: str(p.bullet.text).slice(0, 16), color: hex(p.bullet.color) ?? '#000000', font: FONT_NAME(p.bullet.font) } } : {}),
      marL: num(p?.marL), indent: num(p?.indent), before: num(p?.before, 0, 0), after: num(p?.after, 0, 0),
      spacing: num(p?.spacing, 1, 0.1, 10),
      ...(p?.spacingPx != null ? { spacingPx: num(p.spacingPx, 24, 1, 2000) } : {}),
    })),
  }
}

function asItem(raw: any): DeckItem | null {
  if (!raw || typeof raw !== 'object') return null
  const box: Box = {
    x: num(raw.x), y: num(raw.y), w: num(raw.w, 0, 0), h: num(raw.h, 0, 0),
    ...(raw.rot ? { rot: num(raw.rot, 0, -360, 360) } : {}), ...(raw.flipH ? { flipH: true } : {}), ...(raw.flipV ? { flipV: true } : {}),
  }
  if (raw.kind === 'shape' && PATH.test(str(raw.path))) {
    const text = asText(raw.text)
    return {
      kind: 'shape', ...box, path: str(raw.path).slice(0, 100000),
      ...(raw.open ? { open: true } : {}),
      ...(hex(raw.fill) ? { fill: hex(raw.fill) } : {}),
      ...(hex(raw.line) ? { line: hex(raw.line), lineWidth: num(raw.lineWidth, 1, 0.1, 200) } : {}),
      ...(DASHES.has(raw.dash) ? { dash: raw.dash } : {}),
      ...(raw.head ? { head: true } : {}), ...(raw.tail ? { tail: true } : {}),
      ...(text ? { text } : {}),
    }
  }
  if (raw.kind === 'picture' && SRC.test(str(raw.src))) {
    const crop = Array.isArray(raw.crop) ? [0, 1, 2, 3].map(i => num(raw.crop[i], 0, -10, 0.99)) as [number, number, number, number] : undefined
    return { kind: 'picture', ...box, src: str(raw.src), hash: str(raw.hash).replace(/[^0-9a-f]/g, '').slice(0, 64), ...(crop ? { crop } : {}) }
  }
  if (raw.kind === 'table' && Array.isArray(raw.cols) && Array.isArray(raw.rows)) {
    return {
      kind: 'table', ...box,
      cols: raw.cols.slice(0, 200).map((c: unknown) => num(c, 0, 0)),
      rows: raw.rows.slice(0, 1000).map((row: any) => ({
        h: num(row?.h, 0, 0),
        cells: (Array.isArray(row?.cells) ? row.cells : []).slice(0, 200).map((c: any): DeckCell => {
          const text = asText(c?.text)
          return {
            ...(text ? { text } : {}), ...(hex(c?.fill) ? { fill: hex(c.fill) } : {}),
            ...(c?.span ? { span: num(c.span, 1, 1, 200) } : {}), ...(c?.rowSpan ? { rowSpan: num(c.rowSpan, 1, 1, 1000) } : {}),
            ...(c?.merged ? { merged: true } : {}),
          }
        }),
      })),
      ...(hex(raw.border) ? { border: hex(raw.border) } : {}),
    }
  }
  if (raw.kind === 'chart') {
    const chart = asSheetFile(raw.chart)
    return chart?.kind === 'chart' ? { kind: 'chart', ...box, chart } : null
  }
  return null
}

export function asDeckFile(raw: any): DeckData | null {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || raw.kind !== 'deck' || !Array.isArray(raw.slides)) return null
  return {
    v: 1, kind: 'deck', name: str(raw.name).slice(0, 500),
    width: num(raw.width, 1280, 1, 1e5), height: num(raw.height, 720, 1, 1e5),
    slides: raw.slides.slice(0, MAX_SLIDES).map((s: any): DeckSlide => ({
      background: hex(s?.background) ?? '#ffffff',
      ...(s?.picture && SRC.test(str(s.picture.src)) ? { picture: { src: str(s.picture.src), hash: str(s.picture.hash).replace(/[^0-9a-f]/g, '').slice(0, 64) } } : {}),
      items: (Array.isArray(s?.items) ? s.items : []).slice(0, MAX_ITEMS).map(asItem).filter((i: DeckItem | null): i is DeckItem => !!i),
    })),
  }
}

// Every picture a deck shows, by hash: kept again as they are when it's read again.
export function deckPictures(d: DeckData | null): Map<string, string> {
  const out = new Map<string, string>()
  for (const s of d?.slides ?? []) {
    if (s.picture) out.set(s.picture.hash, s.picture.src)
    for (const i of s.items) if (i.kind === 'picture') out.set(i.hash, i.src)
  }
  return out
}
