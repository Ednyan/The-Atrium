// An atrium, or the traces chosen of it, as a picture -- PNG or SVG, at 1x, 2x
// or 3x, as Excalidraw exports. 1x is the atrium at 100% zoom.
//
// Drawn from the traces' data, not captured from the screen: the screen only
// draws what's near it, and can't picture what's inside an embed's frame.
// Where everything goes comes from the canvas's own geometry -- lib/
// traceGeometry for boxes, lib/traceLinks and lib/elbow for connections,
// lib/pathGeometry for paths, lib/textFit for where text wraps -- so the
// picture has the traces where, and the size, they are. Only the traces given
// are drawn, and the picture is just big enough to hold them: an export of a
// selection is that selection alone, whatever else is near it.
//
// Embeds, audio, video and documents show as cards with their name: what
// plays or loads inside them can't be pictured. Sheets and charts are drawn as
// the canvas draws them (lib/sheetDraw). Lights are drawn; usernames
// and descriptions are left off, as labels rather than part of the picture.
//
// One scene, drawn through a Painter: onto a canvas for PNG, into markup for
// SVG.

import type { Layer, Trace } from '../types/database'
import { arrowhead, curveMiddle, restOf, visiblePart, type TraceLink } from './traceLinks'
import { ELBOW_RADIUS, elbowRoute, elbowThrough, roundedPath, trimEnds } from './elbow'
import { curvePath, handlesAt, type PathPoint } from './pathGeometry'
import { drawRanks } from './order'
import { baseSizeOf, borderColourOf, boundsOf, roundedPolygonPath, shapePolygon, storedTransformOf, traceBox } from './traceGeometry'
import { ARROW_SCALE, shapePaint, shapeStyleOf } from './shapeStyle'
import { fitFontSize, fontPxOf, resolveFontFamilyCss, wrapLines } from './textFit'
import { asStrokeData, renderStrokeData, strokeDensity } from './brushes'
import { dashArray } from './strokeStyle'
import { embedSourcesIn, youtubeId } from './embedUrl'
import { customFontUrl } from './customFonts'
import { isPathTrace, pathWorldBounds } from './pathBounds'
import { cropOf } from './traceCrop'
import { chartSvg, sheetFile, sheetRows, sheetSvg, atriumChartLook } from './sheetDraw'
import { deckFile, deckSvg, isDeckFile, slidePictures } from './deckDraw'
import { currentLanguage } from './i18n'
import { isDesktop } from './supabase'

export type ExportScale = 1 | 2 | 3
export interface ImageExportOptions {
  format: 'png' | 'svg'
  scale: ExportScale
  // The atrium's background behind the traces, or none (transparent).
  background: string | null
}

// Browsers refuse canvases past these; a picture that would be bigger is made
// at the largest scale that fits, and says so (ExportResult.scale).
const MAX_SIDE = 16384
const MAX_AREA = 120_000_000
// Room around the traces, in world units.
const MARGIN = 24

type Matrix = [number, number, number, number, number, number]
interface Paint {
  fill?: string | null
  fillOpacity?: number
  stroke?: string | null
  strokeWidth?: number
  strokeOpacity?: number
  round?: boolean
  opacity?: number
  // A trace's soft shadow, as the canvas draws it under a background.
  shadow?: boolean
  // Dashed or dotted (lib/strokeStyle dashArray): its pattern; a 0 dash is a
  // dot, which takes a round cap.
  dash?: number[] | null
}
interface Font { family: string; size: number; bold?: boolean; italic?: boolean }
interface Picture { source: CanvasImageSource; width: number; height: number; href: () => Promise<string> }

interface Painter {
  push(m?: Matrix, clip?: { x: number; y: number; w: number; h: number; r: number }): void
  pop(): void
  rect(x: number, y: number, w: number, h: number, r: number, paint: Paint): void
  ellipse(cx: number, cy: number, rx: number, ry: number, paint: Paint): void
  path(d: string, paint: Paint): void
  poly(points: number[], paint: Paint): void
  image(pic: Picture, x: number, y: number, w: number, h: number): void
  text(s: string, x: number, y: number, font: Font, color: string, align: 'left' | 'center' | 'right', underline?: boolean): void
  light(cx: number, cy: number, r: number, color: string, alpha: number): void
}

const cssFont = (f: Font) => `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px ${f.family}`

// ---- PNG: a canvas --------------------------------------------------------------------

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function canvasPainter(ctx: CanvasRenderingContext2D, pixelsPerUnit: number): Painter {
  const fillStroke = (paint: Paint, shape: () => void, path?: Path2D) => {
    ctx.save()
    if (paint.round) { ctx.lineCap = 'round'; ctx.lineJoin = 'round' }
    if (paint.fill) {
      if (paint.shadow) {
        // In pixels, not the drawing's units: a canvas shadow ignores the transform.
        ctx.shadowColor = 'rgba(0, 0, 0, 0.68)'
        ctx.shadowBlur = 16 * pixelsPerUnit
        ctx.shadowOffsetY = 6 * pixelsPerUnit
      }
      ctx.globalAlpha = (paint.opacity ?? 1) * (paint.fillOpacity ?? 1)
      ctx.fillStyle = paint.fill
      if (path) ctx.fill(path); else { shape(); ctx.fill() }
      ctx.shadowColor = 'transparent'
    }
    if (paint.stroke && (paint.strokeWidth ?? 0) > 0) {
      ctx.globalAlpha = (paint.opacity ?? 1) * (paint.strokeOpacity ?? 1)
      ctx.strokeStyle = paint.stroke
      ctx.lineWidth = paint.strokeWidth!
      if (paint.dash) {
        ctx.setLineDash(paint.dash)
        if (paint.dash[0] === 0) ctx.lineCap = 'round'
      }
      if (path) ctx.stroke(path); else { shape(); ctx.stroke() }
    }
    ctx.restore()
  }
  return {
    push(m, clip) {
      ctx.save()
      if (m) ctx.transform(...m)
      if (clip) { roundedRect(ctx, clip.x, clip.y, clip.w, clip.h, clip.r); ctx.clip() }
    },
    pop() { ctx.restore() },
    rect(x, y, w, h, r, paint) { fillStroke(paint, () => roundedRect(ctx, x, y, w, h, r)) },
    ellipse(cx, cy, rx, ry, paint) { fillStroke(paint, () => { ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2) }) },
    path(d, paint) { fillStroke(paint, () => {}, new Path2D(d)) },
    poly(points, paint) {
      fillStroke(paint, () => {
        ctx.beginPath()
        for (let i = 0; i < points.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, points[i], points[i + 1])
        ctx.closePath()
      })
    },
    image(pic, x, y, w, h) { ctx.drawImage(pic.source, x, y, w, h) },
    text(s, x, y, font, color, align, underline) {
      ctx.save()
      ctx.font = cssFont(font)
      ctx.fillStyle = color
      ctx.textAlign = align
      ctx.textBaseline = 'alphabetic'
      ctx.fillText(s, x, y)
      if (underline) {
        const w = ctx.measureText(s).width
        const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
        ctx.fillRect(x0, y + font.size * 0.12, w, Math.max(0.5, font.size / 14))
      }
      ctx.restore()
    },
    light(cx, cy, r, color, alpha) {
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      g.addColorStop(0, withAlpha(color, alpha))
      g.addColorStop(0.55, withAlpha(color, alpha * 0.7))
      g.addColorStop(1, withAlpha(color, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    },
  }
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return `rgba(255, 255, 255, ${alpha})`
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

// ---- SVG: markup ----------------------------------------------------------------------

// What XML can't hold at all, escaped or not: the control characters (bar tab
// and the line breaks) and its two non-characters. A trace's text can carry
// them -- a file's bytes put in as text -- and one such trace made the whole
// file unreadable.
const XML_INVALID = /[\x00-\x08\x0b\x0c\x0e-\x1f￾￿]/g
const esc = (s: string) => s.replace(XML_INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n: number) => String(Math.round(n * 1000) / 1000)

function svgPainter(): Painter & { markup: () => Promise<{ defs: string; body: string }> } {
  const body: string[] = []
  const defs: string[] = []
  const opened: number[] = []
  // Pictures are written in once they're read (an async step), so each is
  // a placeholder until then.
  const pending: { index: number; pic: Picture; attrs: string }[] = []
  // The font families its text is in, for the fonts the app carries to be
  // written into the file (see markup).
  const families = new Set<string>()
  let ids = 0
  let shadowDefined = false
  const attrs = (p: Paint) => {
    const a: string[] = []
    a.push(`fill="${p.fill ? esc(p.fill) : 'none'}"`)
    if (p.fill && p.fillOpacity !== undefined && p.fillOpacity < 1) a.push(`fill-opacity="${num(p.fillOpacity)}"`)
    if (p.stroke && (p.strokeWidth ?? 0) > 0) {
      a.push(`stroke="${esc(p.stroke)}" stroke-width="${num(p.strokeWidth!)}"`)
      if (p.strokeOpacity !== undefined && p.strokeOpacity < 1) a.push(`stroke-opacity="${num(p.strokeOpacity)}"`)
      if (p.dash) a.push(`stroke-dasharray="${p.dash.map(num).join(' ')}"${p.dash[0] === 0 && !p.round ? ' stroke-linecap="round"' : ''}`)
    }
    if (p.round) a.push('stroke-linecap="round" stroke-linejoin="round"')
    if (p.opacity !== undefined && p.opacity < 1) a.push(`opacity="${num(p.opacity)}"`)
    if (p.shadow && p.fill) {
      if (!shadowDefined) {
        defs.push('<filter id="trace-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000000" flood-opacity="0.68"/></filter>')
        shadowDefined = true
      }
      a.push('filter="url(#trace-shadow)"')
    }
    return a.join(' ')
  }
  return {
    push(m, clip) {
      let n = 0
      if (m) { body.push(`<g transform="matrix(${m.map(num).join(' ')})">`); n++ }
      if (clip) {
        const id = `c${ids++}`
        const r = Math.max(0, Math.min(clip.r, clip.w / 2, clip.h / 2))
        defs.push(`<clipPath id="${id}"><rect x="${num(clip.x)}" y="${num(clip.y)}" width="${num(clip.w)}" height="${num(clip.h)}" rx="${num(r)}"/></clipPath>`)
        body.push(`<g clip-path="url(#${id})">`)
        n++
      }
      opened.push(n)
    },
    pop() { body.push('</g>'.repeat(opened.pop() ?? 0)) },
    rect(x, y, w, h, r, paint) {
      const rr = Math.max(0, Math.min(r, w / 2, h / 2))
      body.push(`<rect x="${num(x)}" y="${num(y)}" width="${num(Math.max(0, w))}" height="${num(Math.max(0, h))}"${rr ? ` rx="${num(rr)}"` : ''} ${attrs(paint)}/>`)
    },
    ellipse(cx, cy, rx, ry, paint) {
      body.push(`<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(Math.max(0, rx))}" ry="${num(Math.max(0, ry))}" ${attrs(paint)}/>`)
    },
    path(d, paint) { body.push(`<path d="${esc(d)}" ${attrs(paint)}/>`) },
    poly(points, paint) {
      const pts = []
      for (let i = 0; i < points.length; i += 2) pts.push(`${num(points[i])},${num(points[i + 1])}`)
      body.push(`<polygon points="${pts.join(' ')}" ${attrs(paint)}/>`)
    },
    image(pic, x, y, w, h) {
      pending.push({ index: body.length, pic, attrs: `x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"` })
      body.push('')
    },
    text(s, x, y, font, color, align, underline) {
      const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start'
      families.add(font.family)
      body.push(`<text x="${num(x)}" y="${num(y)}" font-family="${esc(font.family)}" font-size="${num(font.size)}"${font.bold ? ' font-weight="bold"' : ''}${font.italic ? ' font-style="italic"' : ''}${underline ? ' text-decoration="underline"' : ''} fill="${esc(color)}" text-anchor="${anchor}" xml:space="preserve">${esc(s)}</text>`)
    },
    light(cx, cy, r, color, alpha) {
      const id = `l${ids++}`
      defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${esc(color)}" stop-opacity="${num(alpha)}"/><stop offset="0.55" stop-color="${esc(color)}" stop-opacity="${num(alpha * 0.7)}"/><stop offset="1" stop-color="${esc(color)}" stop-opacity="0"/></radialGradient>`)
      body.push(`<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="url(#${id})" style="mix-blend-mode:screen"/>`)
    },
    async markup() {
      for (const p of pending) body[p.index] = `<image href="${esc(await p.pic.href())}" ${p.attrs}/>`
      // A font the app carries (Montserrat, Inter, Caveat...) is the app's
      // alone: the file only named it, so anywhere else its text fell back to
      // whatever font was at hand. Each one the text uses is written in, whole,
      // as an @font-face; a font of the system's (Arial, Georgia) stays a name.
      const faces = await Promise.all([...families].map(async family => {
        const url = customFontUrl(family)
        if (!url) return ''
        try {
          const file = await (await fetch(url)).blob()
          const type = /\.woff2$/i.test(url) ? 'font/woff2' : /\.woff$/i.test(url) ? 'font/woff' : /\.otf$/i.test(url) ? 'font/otf' : 'font/ttf'
          return `@font-face{font-family:'${family}';src:url(${await readAsDataUrl(new Blob([file], { type }))})}`
        } catch {
          return ''
        }
      }))
      const fonts = faces.join('')
      return { defs: (fonts ? `<style>${fonts}</style>` : '') + defs.join(''), body: body.join('') }
    },
  }
}

// ---- Pictures -------------------------------------------------------------------------

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

// What a file is, from its name, for one read as bare bytes.
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon', pdf: 'application/pdf', json: 'application/json',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}

// A file a trace points at, as bytes: read straight from the vault on desktop
// (fetching a vault file's blob: URL is refused there -- the desktop's CSP
// allows no blob: requests), from the network on the web, through the app's
// image proxy when the host won't share it.
export async function fetchMedia(url: string): Promise<Blob | null> {
  const href = url
  try {
    if (href.startsWith('local://')) {
      const { readLocalFileBytes } = await import('./localDb')
      const bytes = await readLocalFileBytes(href)
      if (!bytes) return null
      const ext = href.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''
      return new Blob([bytes as unknown as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' })
    }
    const response = await fetch(href)
    if (response.ok) return await response.blob()
  } catch { /* tried the proxy next */ }
  if (/^https?:/i.test(href) && !isDesktop) {
    try {
      const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(href)}`)
      if (response.ok) return await response.blob()
    } catch { /* not there */ }
  }
  return null
}

async function loadPicture(url: string): Promise<Picture | null> {
  const blob = await fetchMedia(url)
  return blob ? pictureOf(blob) : null
}

async function pictureOf(blob: Blob): Promise<Picture | null> {
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = objectUrl
    await img.decode()
    return { source: img, width: img.naturalWidth || 1, height: img.naturalHeight || 1, href: () => readAsDataUrl(blob) }
  } catch {
    URL.revokeObjectURL(objectUrl)
    return null
  }
}

// A sheet or chart trace, drawn `density` pixels to a unit and stretched to
// its box, as the canvas stretches it.
async function sheetPicture(trace: Trace, density: number): Promise<Picture | null> {
  const data = trace.mediaUrl ? await sheetFile(trace.mediaUrl) : null
  if (!data) return null
  const { width, height } = baseSizeOf(trace)
  const markup = data.kind === 'chart'
    ? chartSvg(data, width, height, density, currentLanguage(), atriumChartLook(trace.fillColor, trace.textColor))
    : sheetSvg(data, 0, sheetRows(data), { width: width * density, height: height * density })
  return pictureOf(new Blob([markup], { type: 'image/svg+xml' }))
}

// A deck's first slide, drawn `density` pixels to a unit, its pictures written in.
async function deckPicture(trace: Trace, density: number): Promise<Picture | null> {
  const deck = trace.mediaUrl ? await deckFile(trace.mediaUrl) : null
  if (!deck) return null
  const srcs = new Map<string, string>()
  await Promise.all(slidePictures(deck, 0).map(async src => {
    const blob = await fetchMedia(src).catch(() => null)
    if (blob) srcs.set(src, await readAsDataUrl(blob))
  }))
  const { width, height } = baseSizeOf(trace)
  return pictureOf(new Blob([deckSvg(deck, 0, src => srcs.get(src), { width: width * density, height: height * density })], { type: 'image/svg+xml' }))
}

// What an embed or a video looks like, for one with no preview kept: a
// YouTube video's thumbnail (the largest there is), a frame of a video file a
// second in, the picture itself for a link to one. Anything else -- a page --
// stays a card. Each given a while, not forever: a picture is waited for.
// Found once a visit for each address: the export dialog makes its preview
// again at every change, and a thumbnail took seconds to come.
// ponytail: unbounded for the visit; thumbnails are small, a video's frame is one picture.
const found = new Map<string, Promise<Picture | null>>()
function mediaPicture(trace: Trace): Promise<Picture | null> {
  const key = `${trace.type} ${trace.mediaUrl ?? ''}`
  if (!found.has(key)) found.set(key, findMediaPicture(trace))
  return found.get(key)!
}
async function findMediaPicture(trace: Trace): Promise<Picture | null> {
  let url = (trace.mediaUrl ?? '').trim()
  if (!url) return null
  // Embed code: what it frames.
  if (url.startsWith('<')) url = embedSourcesIn(url)[0] ?? ''
  if (!url) return null
  const youtube = youtubeId(url)
  if (youtube) {
    for (const size of ['maxresdefault', 'hqdefault']) {
      const picture = await within(8000, loadPicture(`https://i.ytimg.com/vi/${youtube}/${size}.jpg`))
      // YouTube answers for a size it hasn't got with a grey 120 x 90.
      if (picture && picture.width > 120) return picture
    }
    return null
  }
  if (trace.type === 'video') return within(15000, videoPicture(url))
  return within(8000, loadPicture(url))
}

const within = <T,>(ms: number, work: Promise<T | null>): Promise<T | null> =>
  Promise.race([work, new Promise<null>(resolve => setTimeout(resolve, ms, null))])

// A frame of a video, a second in (or a tenth of the way, for a short one).
async function videoPicture(url: string): Promise<Picture | null> {
  const blob = await fetchMedia(url)
  if (!blob) return null
  const src = URL.createObjectURL(blob)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = src
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject })
    video.currentTime = Math.min(1, (video.duration || 0) / 10)
    await new Promise(resolve => { video.onseeked = resolve })
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1
    canvas.height = video.videoHeight || 1
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    return canvasPicture(canvas)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(src)
  }
}

const canvasPicture = (canvas: HTMLCanvasElement): Picture => ({
  source: canvas, width: canvas.width, height: canvas.height, href: async () => canvas.toDataURL('image/png'),
})

// ---- The scene ------------------------------------------------------------------------

const rotation = (cx: number, cy: number, degrees: number): Matrix => {
  const a = (degrees * Math.PI) / 180
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), cx, cy]
}

// The name a card shows for a trace whose content can't be pictured.
function cardName(trace: Trace): string {
  const title = (trace.content ?? '').trim()
  if (title) return title.length > 48 ? `${title.slice(0, 47)}…` : title
  const url = trace.mediaUrl ?? trace.linkUrl ?? ''
  try {
    if (/^https?:/i.test(url)) return new URL(url).hostname
  } catch { /* not a URL */ }
  const file = url.split(/[/\\?#]/).filter(Boolean).pop()
  return file && !url.startsWith('data:') ? file : trace.type
}

interface Prepared {
  trace: Trace
  size: { width: number; height: number }
  picture: Picture | null
}

// How a path ends, for its arrowheads: the direction it's heading at that end.
function pathEnds(points: PathPoint[], curve: string): { start: { x: number; y: number; ux: number; uy: number }; end: { x: number; y: number; ux: number; uy: number } } {
  const unit = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { ux: x / l, uy: y / l } }
  const run = curve === 'elbow' ? elbowThrough(points) : points
  const n = run.length
  let from = run[n - 2], into = run[1]
  if (curve === 'bezier') {
    from = handlesAt(points, points.length - 1).cp1
    into = handlesAt(points, 0).cp2
  }
  const last = run[n - 1], first = run[0]
  return {
    end: { x: last.x, y: last.y, ...unit(last.x - from.x, last.y - from.y) },
    start: { x: first.x, y: first.y, ...unit(first.x - into.x, first.y - into.y) },
  }
}

function drawPath(p: Painter, trace: Trace) {
  const points = (trace.shapePoints ?? []) as PathPoint[]
  if (points.length < 2) return
  const curve = trace.pathCurveType || 'straight'
  const d = curve === 'bezier'
    ? curvePath(points)
    : curve === 'elbow'
      ? roundedPath(elbowThrough(points), ELBOW_RADIUS)
      : points.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x} ${pt.y}`).join(' ')
  const width = Math.max(trace.shapeOutlineWidth ?? 2, 0.5)
  const colour = trace.shapeColor || '#3b82f6'
  const opacity = trace.shapeOpacity ?? 1
  if (trace.illuminate) {
    p.path(d, { stroke: trace.lightColor ?? '#cbcbcb', strokeWidth: width + 4, round: true, opacity: 0.22 * (trace.lightIntensity ?? 1) })
  }
  p.path(d, { stroke: colour, strokeWidth: width, round: true, opacity, dash: dashArray(trace.strokeStyle, width) })
  // Arrowheads as the canvas draws them: ARROW_SCALE times the line's width,
  // a triangle reaching out past the end, a diamond centred on it.
  const m = width * ARROW_SCALE
  const ends = pathEnds(points, curve)
  const head = (kind: string | undefined, e: { x: number; y: number; ux: number; uy: number }) => {
    if (!kind || kind === 'none') return
    const nx = -e.uy, ny = e.ux
    const pts = kind === 'diamond'
      ? [e.x + e.ux * m / 2, e.y + e.uy * m / 2, e.x + nx * m / 2, e.y + ny * m / 2, e.x - e.ux * m / 2, e.y - e.uy * m / 2, e.x - nx * m / 2, e.y - ny * m / 2]
      : [e.x + e.ux * m, e.y + e.uy * m, e.x + nx * m / 2, e.y + ny * m / 2, e.x - nx * m / 2, e.y - ny * m / 2]
    p.poly(pts, { fill: colour, opacity })
  }
  head(trace.pathArrowEnd, ends.end)
  head(trace.pathArrowStart, ends.start)
}

function drawShape(p: Painter, trace: Trace) {
  const t = storedTransformOf(trace)
  const size = baseSizeOf(trace)
  const bw = size.width * t.scaleX, bh = size.height * t.scaleY
  const paint = shapePaint(shapeStyleOf(trace), 1)
  const hasOutline = paint.strokeWidth > 0
  const ix = hasOutline ? Math.min(paint.strokeWidth / 2, bw / 2) : 0
  const iy = hasOutline ? Math.min(paint.strokeWidth / 2, bh / 2) : 0
  const style: Paint = {
    fill: paint.fill === 'none' ? null : paint.fill,
    fillOpacity: paint.fillOpacity,
    stroke: paint.stroke === 'none' ? null : paint.stroke,
    strokeWidth: paint.strokeWidth,
    strokeOpacity: paint.strokeOpacity,
    round: true,
    dash: dashArray(trace.strokeStyle, paint.strokeWidth),
  }
  p.push(rotation(t.x, t.y, t.rotation))
  // A shape crops in place, in a box that doesn't move: what's outside the
  // window is cut, on the shape as it's seen (flipped).
  const c = cropOf(trace)
  let left = c.x, right = 1 - c.x - c.w, top = c.y, bottom = 1 - c.y - c.h
  if (trace.flipHorizontal) [left, right] = [right, left]
  if (trace.flipVertical) [top, bottom] = [bottom, top]
  const cropped = c.w < 1 || c.h < 1
  p.push([1, 0, 0, 1, -bw / 2, -bh / 2], cropped ? { x: left * bw, y: top * bh, w: bw * (1 - left - right), h: bh * (1 - top - bottom), r: 0 } : undefined)
  p.push([trace.flipHorizontal ? -1 : 1, 0, 0, trace.flipVertical ? -1 : 1, trace.flipHorizontal ? bw : 0, trace.flipVertical ? bh : 0])
  const r = trace.cornerRadius || 0
  if (trace.shapeType === 'circle') {
    p.ellipse(bw / 2, bh / 2, bw / 2 - ix, bh / 2 - iy, style)
  } else if (shapePolygon(trace.shapeType, bw, bh)) {
    p.path(roundedPolygonPath(shapePolygon(trace.shapeType, bw, bh, ix, iy)!, r), style)
  } else {
    p.rect(ix, iy, bw - ix * 2, bh - iy * 2, r, style)
  }
  p.pop()
  p.pop()
  p.pop()
}

// Text, as the canvas lays it out: once at the trace's own size -- its font,
// 6 of padding, line height 1.3, wrapped as pre-wrap break-words -- up, down
// or in the middle of the box as it's set, and scaled to the box as a whole.
// Fitted to its box (textFit), at the box's own size, in the font that fills
// it, as the canvas has it.
function drawText(p: Painter, trace: Trace, bw: number, bh: number, measure: CanvasRenderingContext2D) {
  const t = storedTransformOf(trace)
  const fitted = trace.textFit === true
  const scale = fitted ? 1 : (trace.textScaleWithBox ?? true) ? (Math.sqrt(Math.max(0, t.scaleX * t.scaleY)) || 1) : 1
  const family = resolveFontFamilyCss(trace.fontFamily ?? 'sans')
  const size = fitted
    ? fitFontSize(trace.content ?? '', bw, bh, { family, bold: trace.textBold, italic: trace.textItalic })
    : fontPxOf(trace.fontSize ?? 'medium')
  const font: Font = { family, size, bold: !!trace.textBold, italic: !!trace.textItalic }
  const lw = bw / scale - 12, lh = bh / scale - 12
  measure.font = cssFont(font)
  const lines = wrapLines(measure, trace.content ?? '', lw)
  const lineHeight = font.size * 1.3
  const metrics = measure.measureText('Mg')
  const ascent = metrics.fontBoundingBoxAscent ?? font.size * 0.8
  const descent = metrics.fontBoundingBoxDescent ?? font.size * 0.2
  const room = lh - lines.length * lineHeight
  const above = trace.textValign === 'top' ? 0 : trace.textValign === 'bottom' ? room : room / 2
  const first = 6 + above + (lineHeight - (ascent + descent)) / 2 + ascent
  const align = trace.textAlign === 'right' ? 'right' : trace.textAlign === 'center' || !trace.textAlign ? 'center' : 'left'
  const x = align === 'center' ? 6 + lw / 2 : align === 'right' ? 6 + lw : 6
  p.push([scale, 0, 0, scale, 0, 0])
  // Mirrored with the trace, as the canvas mirrors what it shows.
  if (trace.flipHorizontal || trace.flipVertical) {
    p.push([trace.flipHorizontal ? -1 : 1, 0, 0, trace.flipVertical ? -1 : 1, trace.flipHorizontal ? bw / scale : 0, trace.flipVertical ? bh / scale : 0])
  }
  lines.forEach((line, i) => p.text(line.replace(/ +$/, ''), x, first + i * lineHeight, font, trace.textColor ?? '#ffffff', align, !!trace.textUnderline))
  if (trace.flipHorizontal || trace.flipVertical) p.pop()
  p.pop()
}

// A trace in its box: background, border and shadow as the canvas draws
// them, and what it shows inside, cut to the box.
function drawBoxed(p: Painter, item: Prepared, measure: CanvasRenderingContext2D) {
  const { trace, size, picture } = item
  const t = storedTransformOf(trace)
  const c = trace.type === 'text' ? { x: 0, y: 0, w: 1, h: 1 } : cropOf(trace)
  const bw = size.width * c.w * t.scaleX, bh = size.height * c.h * t.scaleY
  const border = (trace.showBorder ?? true) ? (trace.borderWidth ?? 2) : 0
  const r = trace.borderRadius ?? 0
  const borderColour = trace.borderColor || borderColourOf(trace.type)
  const showBackground = trace.showBackground ?? true
  p.push(rotation(t.x, t.y, t.rotation))
  // The background reaches under the border, as CSS paints it.
  if (showBackground) {
    p.rect(-bw / 2 - border, -bh / 2 - border, bw + border * 2, bh + border * 2, r, {
      fill: trace.fillColor || '#191919', fillOpacity: trace.fillOpacity ?? 0.95, shadow: trace.showShadow ?? true,
    })
  }
  if (border > 0) {
    p.rect(-bw / 2 - border / 2, -bh / 2 - border / 2, bw + border, bh + border, Math.max(0, r - border / 2), {
      stroke: borderColour, strokeWidth: border, strokeOpacity: trace.borderOpacity ?? 1, dash: dashArray(trace.strokeStyle, border),
    })
  }
  p.push([1, 0, 0, 1, -bw / 2, -bh / 2], { x: 0, y: 0, w: bw, h: bh, r: Math.max(0, r - border) })
  if (trace.type === 'text') {
    drawText(p, trace, bw, bh, measure)
  } else if (picture) {
    // The whole content box, scaled, moved so the crop's window shows, and
    // mirrored in its box -- as the canvas transforms it.
    const W = size.width, H = size.height
    p.push([t.scaleX, 0, 0, t.scaleY, -c.x * W * t.scaleX, -c.y * H * t.scaleY])
    p.push([trace.flipHorizontal ? -1 : 1, 0, 0, trace.flipVertical ? -1 : 1, trace.flipHorizontal ? W : 0, trace.flipVertical ? H : 0])
    // A picture is contained in its box, keeping its shape.
    const fit = Math.min(W / picture.width, H / picture.height)
    const dw = picture.width * fit, dh = picture.height * fit
    p.image(picture, (W - dw) / 2, (H - dh) / 2, dw, dh)
    p.pop()
    p.pop()
  } else if (trace.type !== 'frame') {
    // What can't be pictured: a card naming it.
    const label: Font = { family: 'Consolas, "Courier New", monospace', size: 9 }
    const name: Font = { family: 'Consolas, "Courier New", monospace', size: 11, bold: true }
    p.push([t.scaleX, 0, 0, t.scaleY, 0, 0])
    const w = bw / t.scaleX, h = bh / t.scaleY
    p.text(trace.type.toUpperCase(), w / 2, h / 2 - 6, label, borderColour, 'center')
    p.text(cardName(trace), w / 2, h / 2 + 10, name, borderColour, 'center')
    p.pop()
  }
  p.pop()
  // A frame's title, over its top-left corner.
  if (trace.type === 'frame' && trace.content) {
    p.text(trace.content, -bw / 2 - border, -bh / 2 - border - 4, { family: 'sans-serif', size: 12, bold: true }, borderColour, 'left')
  }
  p.pop()
}

// Where a connection's ends are: each trace's box, turned, and its border's colour.
type End = { x: number; y: number; hw: number; hh: number; turn: number; colour: string }

function drawLink(p: Painter, link: TraceLink, a: End, b: End, measure: CanvasRenderingContext2D) {
  const colour = link.color || a.colour
  const width = Math.max(0.75, link.width)
  const size = 6 + width * 2
  const headsTo = link.arrow === 'forward' || link.arrow === 'both'
  const headsFrom = link.arrow === 'back' || link.arrow === 'both'
  const line: Paint = { stroke: colour, strokeWidth: width, strokeOpacity: link.opacity, round: true, dash: dashArray(link.strokeStyle, width) }
  const fill: Paint = { fill: colour, fillOpacity: link.opacity }
  let middle: { x: number; y: number }
  if (link.elbow) {
    const route = elbowRoute({ x: a.x, y: a.y, hw: a.hw, hh: a.hh }, { x: b.x, y: b.y, hw: b.hw, hh: b.hh }, link.elbowAt)
    p.path(roundedPath(trimEnds(route, headsFrom ? size * 0.8 : 0, headsTo ? size * 0.8 : 0), ELBOW_RADIUS), line)
    const n = route.length
    if (headsTo) p.poly(arrowhead(route[n - 1].x, route[n - 1].y, route[n - 2].x, route[n - 2].y, size), fill)
    if (headsFrom) p.poly(arrowhead(route[0].x, route[0].y, route[1].x, route[1].y, size), fill)
    const mid = Math.floor((n - 1) / 2)
    middle = { x: (route[mid].x + route[mid + 1].x) / 2, y: (route[mid].y + route[mid + 1].y) / 2 }
  } else {
    // At rest: hanging in its curve, or straight.
    const c = restOf(link.straight, a.x, a.y, b.x, b.y)
    const seen = visiblePart(a.x, a.y, c.x, c.y, b.x, b.y, { hw: a.hw, hh: a.hh, turn: a.turn }, { hw: b.hw, hh: b.hh, turn: b.turn },
      !link.toCenter && headsFrom ? size * 0.8 : 0, !link.toCenter && headsTo ? size * 0.8 : 0)
    const d = link.toCenter ? `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}` : seen ? `M ${seen.x0} ${seen.y0} Q ${seen.cx} ${seen.cy} ${seen.x1} ${seen.y1}` : ''
    if (d) p.path(d, line)
    if (seen && headsTo) p.poly(arrowhead(seen.to.x, seen.to.y, seen.to.x - seen.to.dx, seen.to.y - seen.to.dy, size), fill)
    if (seen && headsFrom) p.poly(arrowhead(seen.from.x, seen.from.y, seen.from.x - seen.from.dx, seen.from.y - seen.from.dy, size), fill)
    middle = seen && !link.toCenter ? curveMiddle(seen.x0, seen.y0, seen.cx, seen.cy, seen.x1, seen.y1) : curveMiddle(a.x, a.y, c.x, c.y, b.x, b.y)
  }
  // Its label, when it's always shown.
  if (link.label && !link.labelOnHover) {
    const font: Font = { family: 'Consolas, "Courier New", monospace', size: link.labelSize }
    measure.font = cssFont(font)
    const w = measure.measureText(link.label).width + font.size * 1.3
    const h = font.size * 1.35 + font.size * 0.3
    p.rect(middle.x - w / 2, middle.y - h / 2, w, h, 0, { fill: '#191919', fillOpacity: 0.92, stroke: colour, strokeWidth: 1 })
    p.text(link.label, middle.x, middle.y + font.size * 0.35, font, '#cbcbcb', 'center')
  }
}

// maxScale: the largest a PNG of it can be made (MAX_SIDE, MAX_AREA).
export interface ExportResult { blob: Blob; scale: number; width: number; height: number; maxScale: number }

// The picture of `traces` -- and of the connections between two of them --
// in the atrium's order (`layers` for its groups).
export async function exportImage(traces: Trace[], links: TraceLink[], layers: Layer[], options: ImageExportOptions): Promise<ExportResult> {
  if (traces.length === 0) throw new Error('Nothing to export')
  await document.fonts?.ready

  // Read what's to be pictured first: pictures, kept drawings, natural sizes.
  const prepared = new Map<string, Prepared>()
  await Promise.all(traces.map(async trace => {
    let picture: Picture | null = null
    const data = trace.type === 'image' && trace.width && trace.height ? asStrokeData(trace.strokeData) : null
    const t = storedTransformOf(trace)
    if (data) {
      const ppw = strokeDensity(options.scale * Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY)), trace.width!, trace.height!)
      picture = canvasPicture(renderStrokeData(data, trace.width!, trace.height!, ppw))
    } else if (trace.type === 'image' && (trace.mediaUrl || trace.imageUrl)) {
      picture = await loadPicture((trace.mediaUrl || trace.imageUrl)!)
    } else if (trace.type === 'sheet' || trace.type === 'chart') {
      picture = await sheetPicture(trace, options.scale * Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY)))
    } else if (trace.type === 'document' && isDeckFile(trace.mediaUrl)) {
      picture = await deckPicture(trace, options.scale * Math.max(Math.abs(t.scaleX), Math.abs(t.scaleY)))
    } else if (trace.type === 'embed' || trace.type === 'video') {
      // A preview it keeps, where it has one; else one found for it.
      picture = (trace.imageUrl ? await loadPicture(trace.imageUrl) : null) ?? await mediaPicture(trace)
    }
    const natural = picture && !(trace.width && trace.height) ? { width: picture.width, height: picture.height } : undefined
    prepared.set(trace.id, { trace, size: baseSizeOf(trace, natural), picture })
  }))

  // Where each trace is, for the picture's bounds and the connections' ends.
  const ends = new Map<string, End>()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const take = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
  for (const { trace, size } of prepared.values()) {
    if (isPathTrace(trace)) {
      const box = pathWorldBounds(trace.shapePoints, trace.shapeOutlineWidth ?? 2)
      if (!box) continue
      const reach = (trace.shapeOutlineWidth ?? 2) * ARROW_SCALE
      take(box.minX - reach, box.minY - reach)
      take(box.maxX + reach, box.maxY + reach)
    } else {
      const box = boundsOf(traceBox(trace, size))
      take(box.minX, box.minY)
      take(box.maxX, box.maxY)
      // A frame's title above it.
      if (trace.type === 'frame' && trace.content) take(box.minX, box.minY - 18)
    }
    const box = traceBox(trace, size)
    ends.set(trace.id, { x: box.cx, y: box.cy, hw: box.halfW, hh: box.halfH, turn: box.turn, colour: trace.borderColor || borderColourOf(trace.type) })
  }
  if (!isFinite(minX)) throw new Error('Nothing to export')
  minX -= MARGIN; minY -= MARGIN; maxX += MARGIN; maxY += MARGIN
  const width = maxX - minX, height = maxY - minY

  // As big as asked, or as big as a canvas may be.
  const maxScale = Math.min(MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)))
  const scale = options.format === 'png' ? Math.min(options.scale, maxScale) : options.scale

  // Bottom first, as the atrium stacks them; a connection just under the
  // lower of its two traces, as the canvas draws it.
  const ranks = drawRanks(traces, layers)
  const ordered = [...traces].sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0))
  const linksUnder = new Map<string, TraceLink[]>()
  for (const link of links) {
    if (!ends.has(link.from) || !ends.has(link.to)) continue
    const lower = (ranks.get(link.from) ?? 0) <= (ranks.get(link.to) ?? 0) ? link.from : link.to
    linksUnder.set(lower, [...(linksUnder.get(lower) ?? []), link])
  }

  const measure = document.createElement('canvas').getContext('2d')!
  const paint = (p: Painter) => {
    if (options.background) p.rect(minX, minY, width, height, 0, { fill: options.background })
    for (const trace of ordered) {
      for (const link of linksUnder.get(trace.id) ?? []) drawLink(p, link, ends.get(link.from)!, ends.get(link.to)!, measure)
      // Its light, just under it.
      if (trace.illuminate && !isPathTrace(trace)) {
        const t = storedTransformOf(trace)
        const radius = trace.lightRadius ?? 200
        // From its shape or border: a glow over all of it, as near as a
        // round light comes -- reaching past its box as the canvas's does.
        const end = ends.get(trace.id)
        if ((trace.lightEmit === 'shape' || trace.lightEmit === 'border') && end) {
          p.light(end.x, end.y, Math.max(end.hw, end.hh) + radius * 0.5, trace.lightColor ?? '#ffffff', (trace.lightIntensity ?? 1) * 0.8)
        } else {
          p.light(t.x + (trace.lightOffsetX ?? 0), t.y + (trace.lightOffsetY ?? 0), radius, trace.lightColor ?? '#ffffff', (trace.lightIntensity ?? 1) * 0.8)
        }
      }
      if (isPathTrace(trace)) drawPath(p, trace)
      else if (trace.type === 'shape') drawShape(p, trace)
      else drawBoxed(p, prepared.get(trace.id)!, measure)
    }
  }

  const pixelWidth = Math.max(1, Math.round(width * scale)), pixelHeight = Math.max(1, Math.round(height * scale))
  if (options.format === 'svg') {
    const painter = svgPainter()
    paint(painter)
    const { defs, body } = await painter.markup()
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="${num(minX)} ${num(minY)} ${num(width)} ${num(height)}">`
      + (defs ? `<defs>${defs}</defs>` : '') + body + '</svg>'
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), scale, width: pixelWidth, height: pixelHeight, maxScale }
  }
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale)
  paint(canvasPainter(ctx, scale))
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The picture could not be made')
  return { blob, scale, width: pixelWidth, height: pixelHeight, maxScale }
}
