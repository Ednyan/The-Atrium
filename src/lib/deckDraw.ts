// A deck's slides, drawn: one slide (lib/deck) as SVG markup, in the slide's
// own pixels -- shown on the canvas (components/DeckSlide) and put in a PNG
// or SVG export (lib/exportImage) alike. Text is laid out here, a line at a
// time, measured in the fonts it's drawn in.

import { asDeckFile, type DeckData, type DeckItem, type DeckRun, type DeckText } from './deck'
import { chartSvg } from './sheetDraw'

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const n = (v: number) => Math.round(v * 100) / 100
const stack = (face: string) => `'${face}', Calibri, Carlito, Arial, sans-serif`

type Look = Pick<DeckRun, 'size' | 'font' | 'bold' | 'italic'>
let measurer: CanvasRenderingContext2D | null = null
function widthOf(text: string, look: Look): number {
  measurer ??= document.createElement('canvas').getContext('2d')
  if (!measurer) return text.length * look.size * 0.5
  measurer.font = `${look.italic ? 'italic ' : ''}${look.bold ? 'bold ' : ''}${look.size}px ${stack(look.font)}`
  return measurer.measureText(text).width
}

const runAttrs = (r: DeckRun) =>
  `font-family="${esc(stack(r.font))}" font-size="${n(r.size)}" fill="${r.color}"`
  + (r.bold ? ' font-weight="bold"' : '') + (r.italic ? ' font-style="italic"' : '')
  + (r.underline || r.strike ? ` text-decoration="${[r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ')}"` : '')

interface Piece { run: DeckRun; text: string; width: number }
const blank = (text: string) => /^\s+$/.test(text)

// A text body in a box w by h: its paragraphs broken into lines that fit,
// set as they're aligned, the whole placed top, middle or bottom.
function textSvg(t: DeckText, w: number, h: number): string {
  const [il, it, ir, ib] = t.inset
  const room = Math.max(1, w - il - ir)
  const lines: { pieces: Piece[]; x: number; baseline: number; bullet?: { text: string; x: number; run: DeckRun } }[] = []
  let y = 0
  t.paragraphs.forEach((p, pi) => {
    if (pi) y += p.before
    const lead = p.runs.find(r => r.text.trim()) ?? { text: '', size: p.size, color: '#000000', font: 'Calibri' }
    const bulletRun = p.bullet ? { ...lead, text: p.bullet.text, color: p.bullet.color, font: p.bullet.font } : undefined
    const bulletX = p.marL + p.indent
    const firstStart = bulletRun ? Math.max(p.marL, bulletX + widthOf(bulletRun.text, bulletRun) + lead.size * 0.25) : p.marL + p.indent
    let current: Piece[] = [], used = 0, lineNo = 0
    const startOf = () => (lineNo === 0 ? firstStart : p.marL)
    const flush = () => {
      while (current.length && blank(current[current.length - 1].text)) used -= current.pop()!.width
      const size = current.length ? Math.max(...current.map(c => c.run.size)) : p.size
      const height = p.spacingPx ?? size * 1.2 * p.spacing
      const free = room - startOf() - used
      lines.push({
        pieces: current,
        x: il + startOf() + (p.align === 'ctr' ? free / 2 : p.align === 'r' ? free : 0),
        baseline: y + height - size * 0.25,
        ...(lineNo === 0 && bulletRun ? { bullet: { text: bulletRun.text, x: il + bulletX, run: bulletRun } } : {}),
      })
      y += height
      current = []
      used = 0
      lineNo++
    }
    for (const run of p.runs) {
      for (const text of run.text.split(/(\n|\s+)/)) {
        if (!text) continue
        if (text === '\n') { flush(); continue }
        const space = blank(text)
        // A wrapped line doesn't start with the space it broke at.
        if (space && !current.length && lineNo > 0) continue
        const width = widthOf(text, run)
        if (t.wrap && !space && current.length && used + width > room - startOf()) {
          flush()
        }
        // A word longer than a whole line: broken where it has to be.
        if (t.wrap && !space && width > room - startOf()) {
          let rest = text
          while (rest) {
            let k = rest.length
            while (k > 1 && widthOf(rest.slice(0, k), run) > room - startOf() - used) k--
            const piece = rest.slice(0, k)
            current.push({ run, text: piece, width: widthOf(piece, run) })
            used += current[current.length - 1].width
            rest = rest.slice(k)
            if (rest) flush()
          }
          continue
        }
        current.push({ run, text, width })
        used += width
      }
    }
    flush()
    y += p.after
  })

  const top = it + (t.anchor === 'ctr' ? (h - it - ib - y) / 2 : t.anchor === 'b' ? h - it - ib - y : 0)
  const out: string[] = []
  for (const line of lines) {
    const baseline = n(top + line.baseline)
    if (line.bullet) out.push(`<text x="${n(line.bullet.x)}" y="${baseline}" ${runAttrs(line.bullet.run)}>${esc(line.bullet.text)}</text>`)
    if (!line.pieces.length) continue
    const spans: { run: DeckRun; text: string }[] = []
    for (const piece of line.pieces) {
      const last = spans[spans.length - 1]
      if (last && last.run === piece.run) last.text += piece.text
      else spans.push({ run: piece.run, text: piece.text })
    }
    out.push(`<text x="${n(line.x)}" y="${baseline}" xml:space="preserve" style="white-space:pre">${spans.map(s => `<tspan ${runAttrs(s.run)}>${esc(s.text)}</tspan>`).join('')}</text>`)
  }
  return out.join('')
}

const DASH: Record<string, number[]> = {
  dash: [4, 3], sysDash: [3, 1], dot: [1, 1], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3],
  lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1],
}
// An arrowhead, one a colour: the same markup wherever it's drawn, so two
// slides on screen sharing the id draw the same thing.
const arrowId = (colour: string) => `deck-arrow-${colour.slice(1)}`
const flipOf = (i: { flipH?: boolean; flipV?: boolean; w: number; h: number }) =>
  i.flipH || i.flipV ? ` transform="matrix(${i.flipH ? -1 : 1} 0 0 ${i.flipV ? -1 : 1} ${i.flipH ? n(i.w) : 0} ${i.flipV ? n(i.h) : 0})"` : ''

function itemSvg(i: DeckItem, src: (url: string) => string | undefined): string {
  const inner = (() => {
    switch (i.kind) {
      case 'shape': {
        const stroke = i.line
          ? ` stroke="${i.line}" stroke-width="${n(i.lineWidth ?? 1)}"`
            + (i.dash ? ` stroke-dasharray="${DASH[i.dash].map(d => n(d * (i.lineWidth ?? 1))).join(' ')}"` : '')
            + (i.head ? ` marker-start="url(#${arrowId(i.line)})"` : '') + (i.tail ? ` marker-end="url(#${arrowId(i.line)})"` : '')
          : ''
        const body = i.fill || i.line ? `<path d="${i.path}" fill="${i.fill ?? 'none'}"${stroke}${flipOf(i)}/>` : ''
        return body + (i.text ? textSvg(i.text, i.w, i.h) : '')
      }
      case 'picture': {
        const href = src(i.src)
        if (!href) return ''
        const [l, t, r, b] = i.crop ?? [0, 0, 0, 0]
        const W = i.w / Math.max(0.01, 1 - l - r), H = i.h / Math.max(0.01, 1 - t - b)
        return `<svg width="${n(i.w)}" height="${n(i.h)}"><g${flipOf(i)}><image href="${esc(href)}" x="${n(-l * W)}" y="${n(-t * H)}" width="${n(W)}" height="${n(H)}" preserveAspectRatio="none"/></g></svg>`
      }
      case 'table': {
        const lefts: number[] = []
        i.cols.reduce((x, c, k) => (lefts[k] = x) + c, 0)
        const tops: number[] = []
        i.rows.reduce((y, row, k) => (tops[k] = y) + row.h, 0)
        const out: string[] = []
        i.rows.forEach((row, ri) => row.cells.forEach((cell, ci) => {
          if (cell.merged || lefts[ci] === undefined) return
          const w = i.cols.slice(ci, ci + (cell.span ?? 1)).reduce((a, b) => a + b, 0)
          const h = i.rows.slice(ri, ri + (cell.rowSpan ?? 1)).reduce((a, r) => a + r.h, 0)
          const x = lefts[ci], y = tops[ri]
          out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${cell.fill ?? 'none'}"${i.border ? ` stroke="${i.border}" stroke-width="1"` : ''}/>`)
          if (cell.text) out.push(`<g transform="translate(${n(x)} ${n(y)})">${textSvg(cell.text, w, h)}</g>`)
        }))
        return out.join('')
      }
      case 'chart':
        return chartSvg(i.chart, i.w, i.h)
    }
  })()
  if (!inner) return ''
  return `<g transform="translate(${n(i.x)} ${n(i.y)})${i.rot ? ` rotate(${n(i.rot)} ${n(i.w / 2)} ${n(i.h / 2)})` : ''}">${inner}</g>`
}

// Slide `index` of a deck, `size` pixels (its own size unless said).
// `src`: where a picture can be had from, for its address in the deck --
// nothing drawn where it can't be yet.
export function deckSvg(d: DeckData, index: number, src: (url: string) => string | undefined, size?: { width: number; height: number }): string {
  const slide = d.slides[Math.max(0, Math.min(d.slides.length - 1, index))]
  if (!slide) return ''
  const colours = new Set(slide.items.flatMap(i => (i.kind === 'shape' && i.line && (i.head || i.tail) ? [i.line] : [])))
  const defs = colours.size
    ? `<defs>${[...colours].map(c => `<marker id="${arrowId(c)}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${c}"/></marker>`).join('')}</defs>`
    : ''
  const backdrop = slide.picture && src(slide.picture.src)
  // letter-spacing: the slide's own, not the page's around it -- its lines
  // are measured without any.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n(d.width)} ${n(d.height)}" width="${n(size?.width ?? d.width)}" height="${n(size?.height ?? d.height)}" preserveAspectRatio="none" letter-spacing="normal">`
    + defs
    + `<rect width="${n(d.width)}" height="${n(d.height)}" fill="${slide.background}"/>`
    + (backdrop ? `<image href="${esc(backdrop)}" width="${n(d.width)}" height="${n(d.height)}" preserveAspectRatio="xMidYMid slice"/>` : '')
    + slide.items.map(i => itemSvg(i, src)).join('')
    + '</svg>'
}

// The pictures slide `index` shows, by their address in the deck.
export const slidePictures = (d: DeckData, index: number): string[] => {
  const slide = d.slides[index]
  if (!slide) return []
  return [...(slide.picture ? [slide.picture.src] : []), ...slide.items.flatMap(i => (i.kind === 'picture' ? [i.src] : []))]
}

// A document trace's file is a deck when it's JSON (a PDF's is a .pdf).
export const isDeckFile = (url: string | null | undefined) => !!url && /\.json(\?.*)?$/i.test(url)

// Decks by file, read once a visit -- as sheetFile keeps sheets.
const files = new Map<string, Promise<DeckData | null>>()
export function deckFile(url: string): Promise<DeckData | null> {
  let file = files.get(url)
  if (!file) {
    file = (async () => {
      const { fetchMedia } = await import('./exportImage')
      const blob = await fetchMedia(url)
      return blob ? asDeckFile(JSON.parse(await blob.text())) : null
    })().catch(() => null)
    files.set(url, file)
    void file.then(data => { if (!data) files.delete(url) })
  }
  return file
}
export const keepDeckFile = (url: string, data: DeckData) => { files.set(url, Promise.resolve(data)) }

// A picture of a deck's, as something an <image> can show: the address as it
// is when the web has it, else its file read once a visit.
// ponytail: never let go of for the visit; a deck's pictures are what's on it.
const pictures = new Map<string, Promise<string | undefined>>()
export function pictureSrc(url: string): Promise<string | undefined> {
  if (/^(https:|data:)/.test(url)) return Promise.resolve(url)
  let found = pictures.get(url)
  if (!found) {
    found = (async () => {
      const { fetchMedia } = await import('./exportImage')
      const blob = await fetchMedia(url)
      return blob ? URL.createObjectURL(blob) : undefined
    })().catch(() => undefined)
    pictures.set(url, found)
    void found.then(u => { if (!u) pictures.delete(url) })
  }
  return found
}
