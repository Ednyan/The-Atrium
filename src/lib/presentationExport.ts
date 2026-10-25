// An atrium's locations as a presentation (LocationsPanel's Export): one slide
// each, in their order -- what a 1920x1080 screen shows standing at that
// location, at its zoom -- drawn from the atrium's data (lib/exportImage), as
// a PowerPoint (.pptx), a PDF, or a web page that is the whole presentation in
// one file: opened anywhere, offline, or put up on any site.
//
// Every slide is a picture: what's on it looks as it does in the atrium, and
// is edited there, not in the slides.

import type { LobbyLocation, Trace, Layer } from '../types/database'
import type { TraceLink } from './traceLinks'
import { exportImage } from './exportImage'
import { boundsOf, traceBox } from './traceGeometry'
import { isPathTrace, pathWorldBounds } from './pathBounds'

export type PresentationFormat = 'pptx' | 'pdf' | 'html'
export const PRESENTATION_FILTERS: Record<PresentationFormat, { name: string; extensions: string[] }> = {
  pptx: { name: 'PowerPoint', extensions: ['pptx'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
  html: { name: 'Web page', extensions: ['html'] },
}

// A slide's size in pixels: a 1080p screen, 16:9 as PowerPoint's widescreen.
const SLIDE_W = 1920
const SLIDE_H = 1080
const QUALITY = 0.9

export interface Slide { name: string; jpeg: Uint8Array; width: number; height: number }

/** Each location's slide, in order; `progress` after each. */
export async function slidesOf(
  locations: LobbyLocation[], traces: Trace[], links: TraceLink[], layers: Layer[], background: string,
  progress?: (done: number, total: number) => void,
): Promise<Slide[]> {
  const ordered = [...locations].sort((a, b) => a.orderIndex - b.orderIndex)
  const slides: Slide[] = []
  for (const location of ordered) {
    const width = SLIDE_W / location.zoom, height = SLIDE_H / location.zoom
    const frame = { x: location.positionX - width / 2, y: location.positionY - height / 2, width, height }
    // Only what reaches into the slide is drawn: the rest would be read and
    // drawn off the edge, once for every slide.
    const inside = traces.filter(trace => overlaps(worldBox(trace), frame))
    let blob: Blob
    if (inside.length) {
      blob = (await exportImage(inside, links, layers, { format: 'png', scale: 1, maxSide: SLIDE_W, background, frame, type: 'image/jpeg', quality: QUALITY })).blob
    } else {
      blob = await emptySlide(background)
    }
    slides.push({ name: location.name, jpeg: new Uint8Array(await blob.arrayBuffer()), width: SLIDE_W, height: SLIDE_H })
    progress?.(slides.length, ordered.length)
  }
  return slides
}

function worldBox(trace: Trace) {
  if (isPathTrace(trace)) {
    const box = pathWorldBounds(trace.shapePoints, trace.shapeOutlineWidth ?? 2)
    if (box) return box
  }
  return boundsOf(traceBox(trace))
}
const overlaps = (box: { minX: number; minY: number; maxX: number; maxY: number }, frame: { x: number; y: number; width: number; height: number }) =>
  box.maxX >= frame.x && box.minX <= frame.x + frame.width && box.maxY >= frame.y && box.minY <= frame.y + frame.height

async function emptySlide(background: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SLIDE_W
  canvas.height = SLIDE_H
  const context = canvas.getContext('2d')!
  context.fillStyle = background
  context.fillRect(0, 0, SLIDE_W, SLIDE_H)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('The slide could not be made')
  return blob
}

const base64 = (bytes: Uint8Array) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

/** A PDF, a page a slide, each its picture edge to edge at 16:9 (960 x 540
 *  points, PowerPoint's widescreen). Written here: a page that is one JPEG
 *  needs nothing a library would add. */
export function pdfOf(slides: Slide[]): Blob {
  const encoder = new TextEncoder()
  const parts: (Uint8Array | string)[] = []
  const offsets: number[] = []
  let length = 0
  const put = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    parts.push(bytes)
    length += bytes.length
  }
  // Objects: 1 catalog, 2 pages, then per slide its page, picture and drawing.
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length
    put(`${id} 0 obj\n${body}\n`)
    if (stream) { put('stream\n'); put(stream); put('\nendstream\n') }
    put('endobj\n')
  }
  const PAGE_W = 960, PAGE_H = 540
  put('%PDF-1.4\n%âãÏÓ\n')
  const pageIds = slides.map((_, i) => 3 + i * 3)
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${slides.length} >>`)
  slides.forEach((slide, i) => {
    const page = pageIds[i], picture = page + 1, drawing = page + 2
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im0 ${picture} 0 R >> >> /Contents ${drawing} 0 R >>`)
    object(picture, `<< /Type /XObject /Subtype /Image /Width ${slide.width} /Height ${slide.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${slide.jpeg.length} >>`, slide.jpeg)
    const draw = encoder.encode(`q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im0 Do Q`)
    object(drawing, `<< /Length ${draw.length} >>`, draw)
  })
  const count = 3 + slides.length * 3
  const xref = length
  put(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id++) put(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

/** A PowerPoint, a slide a slide: its picture edge to edge, its location's
 *  name as the picture's description and in the speaker notes. */
export async function pptxOf(slides: Slide[], title: string): Promise<Blob> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.title = title
  for (const slide of slides) {
    const page = pptx.addSlide()
    page.addImage({ data: `data:image/jpeg;base64,${base64(slide.jpeg)}`, x: 0, y: 0, w: '100%', h: '100%', altText: slide.name })
    page.addNotes(slide.name)
  }
  return await pptx.write({ outputType: 'blob' }) as Blob
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The whole presentation as one web page: its slides inside it, so it opens
 *  offline and can be put up on any site as it is. Arrow keys, a click or a
 *  tap on either half, Home and End; F for full screen. */
export function htmlOf(slides: Slide[], title: string, background: string): Blob {
  const figures = slides.map((slide, i) => `<figure${i === 0 ? ' class="on"' : ''}><img src="data:image/jpeg;base64,${base64(slide.jpeg)}" alt="${escape(slide.name)}"><figcaption>${escape(slide.name)}</figcaption></figure>`).join('\n')
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="The Digital Atrium">
<title>${escape(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; background: ${escape(background)}; color: #e8e8e8; font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; overflow: hidden; }
  main { position: fixed; inset: 0; display: grid; place-items: center; cursor: pointer; user-select: none; }
  figure { position: absolute; inset: 0; display: grid; place-items: center; opacity: 0; transform: translateX(3%) scale(.985); transition: opacity .5s ease, transform .6s cubic-bezier(.16, 1, .3, 1); pointer-events: none; }
  figure.on { opacity: 1; transform: none; }
  figure.before { transform: translateX(-3%) scale(.985); }
  img { max-width: 100vw; max-height: 100vh; aspect-ratio: 16 / 9; object-fit: contain; }
  figcaption { position: absolute; left: 24px; bottom: 20px; padding: 6px 10px; letter-spacing: .14em; text-transform: uppercase; font-size: 11px; background: rgb(0 0 0 / .45); }
  nav { position: fixed; right: 20px; bottom: 20px; display: flex; gap: 8px; align-items: center; letter-spacing: .12em; font-size: 11px; }
  nav button { background: rgb(0 0 0 / .45); color: inherit; border: 1px solid rgb(255 255 255 / .25); font: inherit; padding: 6px 10px; cursor: pointer; }
  nav button:hover { border-color: rgb(255 255 255 / .6); }
  @media (prefers-reduced-motion: reduce) { figure { transition: none; } }
</style>
</head>
<body>
<main aria-live="polite">
${figures}
</main>
<nav><button type="button" data-step="-1" aria-label="Previous">&#9664;</button><span id="count"></span><button type="button" data-step="1" aria-label="Next">&#9654;</button><button type="button" id="full" aria-label="Full screen">&#x26F6;</button></nav>
<script>
  var slides = document.querySelectorAll('figure'), at = 0, count = document.getElementById('count')
  function show(next) {
    next = Math.max(0, Math.min(slides.length - 1, next))
    slides.forEach(function (slide, i) { slide.classList.toggle('on', i === next); slide.classList.toggle('before', i < next) })
    at = next
    count.textContent = (at + 1) + ' / ' + slides.length
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') show(at + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') show(at - 1)
    else if (e.key === 'Home') show(0)
    else if (e.key === 'End') show(slides.length - 1)
    else if (e.key === 'f' || e.key === 'F') full()
    else return
    e.preventDefault()
  })
  document.querySelector('main').addEventListener('click', function (e) { show(at + (e.clientX < innerWidth / 3 ? -1 : 1)) })
  document.querySelectorAll('nav [data-step]').forEach(function (b) { b.addEventListener('click', function () { show(at + Number(b.dataset.step)) }) })
  function full() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen() }
  document.getElementById('full').addEventListener('click', full)
  show(0)
</script>
</body>
</html>
`
  return new Blob([page], { type: 'text/html' })
}
