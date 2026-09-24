// How a drawing's strokes are painted: the brushes it offers, and the ones a
// person imports.
//
// Five are built in. Pen is the smooth round line drawing always had. Marker is
// one translucent path, calligraphy a flat nib swept along the line, and
// pencil and airbrush stamp a tip along it at a fixed spacing -- which is also
// how an imported brush works, and why it can be any shape at all: its picture
// is the tip.
//
// A stroke is kept as points and painted again whenever the canvas is, so
// anything random -- the pencil's grain turning from stamp to stamp -- comes
// from a generator seeded per stroke. The same stroke paints the same way
// every time, rather than shimmering as the next one is drawn.

import { anyTransparent } from './imageAlpha.ts'

// p is pen pressure, 0..1, present only on points drawn with a pen.
export type StrokePoint = { x: number; y: number; p?: number }

export interface Stroke {
  points: StrokePoint[]
  color: string
  width: number
  isEraser: boolean
  // A built-in brush's name or customBrushKey(id). Absent on a stroke from
  // before there was a choice, which was a pen.
  brush?: string
  seed?: number
  // 1 is a hard edge (and what a stroke without one has), 0 the softest.
  hardness?: number
}

export const BUILTIN_BRUSHES = ['pen', 'pencil', 'marker', 'airbrush', 'calligraphy'] as const
export type BuiltinBrush = typeof BUILTIN_BRUSHES[number]

// tip: a PNG data URL, white, with the shape in its alpha channel.
export interface CustomBrush {
  id: string
  name: string
  tip: string
}

export const customBrushKey = (id: string) => `custom:${id}`

// Width at a point: the brush width, scaled by pen pressure where there is
// any. The floor is a fifth of the width, so the lightest touch still leaves
// a line rather than nothing.
export function pressureWidth(width: number, p: number | undefined): number {
  return p === undefined ? width : width * (0.2 + 0.8 * Math.min(1, Math.max(0, p)))
}

export function newStrokeSeed(): number {
  return (Math.random() * 2 ** 32) >>> 0
}

// mulberry32: small, fast, and the same sequence for the same seed.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const lerpP = (a: number | undefined, b: number | undefined, t: number) =>
  a === undefined || b === undefined ? a ?? b : a + (b - a) * t

// Points along the line at a spacing, for stamping. The spacing is asked for
// at each stamp so it can follow the pressure: a smaller tip, closer stamps.
export function stampPositions(points: StrokePoint[], spacingAt: (p: number | undefined) => number): StrokePoint[] {
  if (points.length === 0) return []
  const out: StrokePoint[] = [points[0]]
  // Distance travelled since the last stamp, carried across segments.
  let since = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length === 0) continue
    let pos = 0
    for (;;) {
      const step = Math.max(0, Math.max(0.25, spacingAt(lerpP(a.p, b.p, pos / length))) - since)
      if (pos + step > length) {
        since += length - pos
        break
      }
      pos += step
      since = 0
      const t = pos / length
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: lerpP(a.p, b.p, t) })
    }
  }
  return out
}

// An imported picture's pixels as a tip: white, with the shape in the alpha.
// A picture with transparency is its own shape. One without -- a dark brush on
// white, as brush images usually come -- is read by darkness, so the white
// drops away and the dark becomes the ink.
export function tipAlpha(rgba: ArrayLike<number>): Uint8ClampedArray<ArrayBuffer> {
  const transparent = anyTransparent(rgba)
  const out = new Uint8ClampedArray(rgba.length)
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = out[i + 1] = out[i + 2] = 255
    out[i + 3] = transparent
      ? rgba[i + 3]
      : 255 - (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2])
  }
  return out
}

// ---- Painting ---------------------------------------------------------------

// Tip masks by brush key, and their tinted copies by key and colour.
const tipMasks = new Map<string, HTMLCanvasElement>()
const tintedTips = new Map<string, HTMLCanvasElement>()

function builtinTip(kind: 'pencil' | 'airbrush'): HTMLCanvasElement {
  const known = tipMasks.get(kind)
  if (known) return known
  const size = kind === 'pencil' ? 24 : 64
  const tip = document.createElement('canvas')
  tip.width = tip.height = size
  const ctx = tip.getContext('2d')!
  if (kind === 'airbrush') {
    const r = size / 2
    const g = ctx.createRadialGradient(r, r, 0, r, r, r)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  } else {
    // Graphite: a disc of uneven density, the grain a pencil leaves on paper.
    const img = ctx.createImageData(size, size)
    const rand = seededRandom(7)
    const r = size / 2
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r
        const i = (y * size + x) * 4
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
        img.data[i + 3] = d < 1 && rand() < 0.6 ? (0.45 + 0.55 * rand()) * (1 - d * d) * 255 : 0
      }
    }
    ctx.putImageData(img, 0, 0)
  }
  tipMasks.set(kind, tip)
  return tip
}

function tinted(key: string, mask: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const k = `${key}|${color}`
  const known = tintedTips.get(k)
  if (known) return known
  // Dragging through the colour picker makes a new colour per step.
  if (tintedTips.size > 64) tintedTips.clear()
  const tip = document.createElement('canvas')
  tip.width = mask.width
  tip.height = mask.height
  const ctx = tip.getContext('2d')!
  ctx.drawImage(mask, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, tip.width, tip.height)
  tintedTips.set(k, tip)
  return tip
}

function stamp(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  key: string,
  mask: HTMLCanvasElement,
  o: { spacing: number; flow: (p: number | undefined) => number; pressureSize: boolean; rotate: boolean },
) {
  const tip = tinted(key, mask, stroke.color)
  const rand = seededRandom(stroke.seed ?? 1)
  const sizeAt = (p: number | undefined) => Math.max(1, o.pressureSize ? pressureWidth(stroke.width, p) : stroke.width)
  ctx.save()
  const base = ctx.getTransform()
  for (const s of stampPositions(stroke.points, p => sizeAt(p) * o.spacing)) {
    const size = sizeAt(s.p)
    ctx.globalAlpha = Math.min(1, o.flow(s.p))
    if (o.rotate) {
      ctx.setTransform(base)
      ctx.translate(s.x, s.y)
      ctx.rotate(rand() * Math.PI * 2)
      ctx.drawImage(tip, -size / 2, -size / 2, size, size)
    } else {
      ctx.drawImage(tip, s.x - size / 2, s.y - size / 2, size, size)
    }
  }
  ctx.restore()
}

// The round line: one smooth path through the points, or one per segment when
// a pen gave each its own width.
function drawPen(ctx: CanvasRenderingContext2D, points: StrokePoint[], color: string, width: number, isEraser: boolean) {
  ctx.save()
  ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over'

  if (points.length === 1) {
    // A click with no movement -- draw a single dot instead of nothing,
    // matching what most drawing apps do for a stationary tap/click.
    ctx.fillStyle = isEraser ? 'rgba(0,0,0,1)' : color
    ctx.beginPath()
    ctx.arc(points[0].x, points[0].y, pressureWidth(width, points[0].p) / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const control = (i: number) => {
    const p0 = i > 0 ? points[i - 1] : points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = i + 2 < points.length ? points[i + 2] : p2
    const tension = 0.5
    return {
      cp1x: p1.x + (p2.x - p0.x) / 6 * tension,
      cp1y: p1.y + (p2.y - p0.y) / 6 * tension,
      cp2x: p2.x - (p3.x - p1.x) / 6 * tension,
      cp2y: p2.y - (p3.y - p1.y) / 6 * tension,
    }
  }

  // With pressure, one path per segment, each at the width the pen gave it;
  // round caps make the joins seamless. Without it, the single path it has
  // always been -- one path is also what keeps a translucent colour from
  // darkening where segments would overlap.
  if (points.some(pt => pt.p !== undefined)) {
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]
      const p2 = points[i + 1]
      const { cp1x, cp1y, cp2x, cp2y } = control(i)
      ctx.lineWidth = pressureWidth(width, ((p1.p ?? 0.5) + (p2.p ?? 0.5)) / 2)
      ctx.beginPath()
      ctx.moveTo(p1.x, p1.y)
      if (points.length === 2) ctx.lineTo(p2.x, p2.y)
      else ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
      ctx.stroke()
    }
    ctx.restore()
    return
  }

  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  if (points.length === 2) {
    ctx.lineTo(points[1].x, points[1].y)
  } else {
    for (let i = 0; i < points.length - 1; i++) {
      const { cp1x, cp1y, cp2x, cp2y } = control(i)
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, points[i + 1].x, points[i + 1].y)
    }
  }
  ctx.stroke()
  ctx.restore()
}

// A flat nib held at 45 degrees and swept along the line: broad one way,
// hairline the other. Placed closely enough to join up, all in one path, so
// the stroke fills in one operation with no seams between pieces.
function drawCalligraphy(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const nx = Math.SQRT1_2
  const ny = -Math.SQRT1_2
  ctx.save()
  ctx.strokeStyle = stroke.color
  ctx.lineCap = 'round'
  // The nib's own thickness, so a line along the nib is thin, not missing.
  ctx.lineWidth = Math.max(1, stroke.width * 0.12)
  ctx.beginPath()
  for (const s of stampPositions(stroke.points, () => 0.75)) {
    const h = pressureWidth(stroke.width, s.p) / 2
    ctx.moveTo(s.x - nx * h, s.y - ny * h)
    ctx.lineTo(s.x + nx * h, s.y + ny * h)
  }
  ctx.stroke()
  ctx.restore()
}

function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const { points, color, width, isEraser } = stroke
  if (points.length === 0) return
  // The eraser is always round and hard, whatever brush was chosen before it.
  const brush = isEraser ? 'pen' : stroke.brush ?? 'pen'

  if (brush === 'marker') {
    // Half strength, one path: even ink across the stroke, darker only where
    // another stroke crosses it, as a felt tip is. A single path has a single
    // width, so pressure doesn't reach it.
    ctx.save()
    ctx.globalAlpha = 0.5
    drawPen(ctx, points.map(({ x, y }) => ({ x, y })), color, width, false)
    ctx.restore()
    return
  }
  if (brush === 'calligraphy') return drawCalligraphy(ctx, stroke)
  if (brush === 'pencil') {
    // Pressure darkens the graphite as well as widening it.
    return stamp(ctx, stroke, 'pencil', builtinTip('pencil'), {
      spacing: 0.2, pressureSize: true, rotate: true,
      flow: p => 0.3 * (0.4 + 0.6 * (p ?? 1)),
    })
  }
  if (brush === 'airbrush') {
    // Pressure is how much paint, not how wide the spray.
    return stamp(ctx, stroke, 'airbrush', builtinTip('airbrush'), {
      spacing: 0.08, pressureSize: false, rotate: false,
      flow: p => 0.12 * (p ?? 1),
    })
  }
  const custom = tipMasks.get(brush)
  if (brush.startsWith('custom:') && custom) {
    return stamp(ctx, stroke, brush, custom, { spacing: 0.15, pressureSize: true, rotate: false, flow: () => 1 })
  }
  // Pen, and any brush whose tip isn't here to paint with.
  drawPen(ctx, points, color, width, isEraser)
}

// Reused between strokes; grown when one needs more room than it has.
let scratch: HTMLCanvasElement | null = null

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const hardness = Math.min(1, Math.max(0, stroke.hardness ?? 1))
  if (hardness >= 1 || stroke.points.length === 0) return paintStroke(ctx, stroke)

  // A soft edge: the stroke painted hard on a scratch canvas, then blurred on
  // the way across. One blur of the whole stroke, not one per piece, so where
  // a line's segments or stamps overlap the fade doesn't bead.
  //
  // The blur is a canvas shadow rather than ctx.filter, which the macOS
  // webview only has from Safari 18: the stroke is drawn far off to the side
  // with its shadow offset back onto the spot, so only the blurred shadow
  // lands. At no hardness the fade runs about three quarters of the brush
  // width out past the edge (shadowBlur is twice the blur's sigma).
  const blur = (1 - hardness) * stroke.width * 0.75
  const pad = Math.ceil(stroke.width + blur * 2 + 2)
  const xs = stroke.points.map(p => p.x)
  const ys = stroke.points.map(p => p.y)
  const minX = Math.floor(Math.min(...xs)) - pad
  const minY = Math.floor(Math.min(...ys)) - pad
  const w = Math.ceil(Math.max(...xs)) + pad - minX
  const h = Math.ceil(Math.max(...ys)) + pad - minY

  scratch ??= document.createElement('canvas')
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w)
    scratch.height = Math.max(scratch.height, h)
  }
  const sctx = scratch.getContext('2d')
  if (!sctx) return paintStroke(ctx, stroke)
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.clearRect(0, 0, w, h)
  sctx.translate(-minX, -minY)
  // Painted as ink either way; an eraser's ink is what gets taken away below.
  paintStroke(sctx, { ...stroke, isEraser: false, brush: stroke.isEraser ? 'pen' : stroke.brush, hardness: 1 })

  // A shadow takes its colour from shadowColor and only the alpha from what
  // casts it -- right here, since every brush paints in the one colour.
  const off = ctx.canvas.width + w + 100
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (stroke.isEraser) ctx.globalCompositeOperation = 'destination-out'
  ctx.shadowColor = stroke.isEraser ? '#000' : stroke.color
  ctx.shadowBlur = blur
  ctx.shadowOffsetX = off
  ctx.drawImage(scratch, 0, 0, w, h, minX - off, minY, w, h)
  ctx.restore()
}

// ---- Imported brushes -------------------------------------------------------

const TIP_EDGE = 128

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not decode image'))
    img.src = src
  })
}

// A picture file as a tip, as a PNG data URL -- or null when it has no shape
// to paint with (it wouldn't decode, or it's blank). At most 128px across, and
// padded to a square so a stamp keeps the shape's proportions.
export async function makeBrushTip(file: Blob): Promise<string | null> {
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    if (!img.naturalWidth || !img.naturalHeight) return null
    const scale = Math.min(1, TIP_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))

    // Read at its own size first: padding drawn in before the read would be
    // mistaken for ink in a picture that has no transparency of its own.
    const read = document.createElement('canvas')
    read.width = w
    read.height = h
    const readCtx = read.getContext('2d', { willReadFrequently: true })!
    readCtx.drawImage(img, 0, 0, w, h)
    const alpha = tipAlpha(readCtx.getImageData(0, 0, w, h).data)
    let ink = false
    for (let i = 3; i < alpha.length && !ink; i += 4) ink = alpha[i] > 8
    if (!ink) return null
    readCtx.putImageData(new ImageData(alpha, w, h), 0, 0)

    const side = Math.max(w, h)
    const square = document.createElement('canvas')
    square.width = square.height = side
    square.getContext('2d')!.drawImage(read, (side - w) / 2, (side - h) / 2)
    return square.toDataURL('image/png')
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Only what makeBrushTip writes. The list comes back from a file on disk, and
// a tip also goes into a CSS url(), so anything else is left out.
export function isCustomBrush(value: any): value is CustomBrush {
  return !!value
    && typeof value.id === 'string' && /^[\w-]{1,64}$/.test(value.id)
    && typeof value.name === 'string'
    && typeof value.tip === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value.tip)
}

// Makes an imported brush paintable. Kept for the rest of the session even if
// the brush is removed, so strokes already drawn with it still paint.
export async function registerCustomBrush(brush: CustomBrush): Promise<boolean> {
  try {
    const img = await loadImage(brush.tip)
    const mask = document.createElement('canvas')
    mask.width = img.naturalWidth
    mask.height = img.naturalHeight
    mask.getContext('2d')!.drawImage(img, 0, 0)
    tipMasks.set(customBrushKey(brush.id), mask)
    return true
  } catch {
    return false
  }
}

// ---- Editing a saved drawing ------------------------------------------------
//
// A saved drawing is a picture -- its strokes were flattened into it -- so
// editing one starts from that picture: it goes under the new strokes exactly
// where the trace shows it, the eraser can take parts of it away, and saving
// paints the two together into a new picture for the same trace.

// Whether a trace is a drawing. Its file is saved as drawing_<...>.png; the
// label covers one kept as a data URL because its upload failed.
export function isDrawingTrace(t: { type: string; mediaUrl?: string | null; content?: string | null }): boolean {
  return t.type === 'image'
    && (/(^|\/)drawing_[^/?#]*\.png([?#]|$)/.test(t.mediaUrl ?? '') || t.content === 'freehand drawing')
}

// Where a trace shows its picture on screen, as TraceOverlay lays it out:
// centred on (cx, cy), turned by `rotation` degrees, mirrored by the flips.
// The picture is fitted inside width x height (world units), that box is
// stretched by scaleX/scaleY (screen px per world unit, zoom included), and a
// crop keeps its share of the box and cuts away the rest.
export interface TracePlacement {
  cx: number
  cy: number
  rotation: number
  flipH: boolean
  flipV: boolean
  width: number
  height: number
  scaleX: number
  scaleY: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
}

// The visible box (clipW x clipH) and the picture's rectangle within it, both
// centred on the trace, before rotation and flips.
export function placePicture(pl: TracePlacement, naturalWidth: number, naturalHeight: number) {
  const fit = Math.min(pl.width / naturalWidth, pl.height / naturalHeight)
  const iw = naturalWidth * fit
  const ih = naturalHeight * fit
  const clipW = pl.width * pl.cropWidth * pl.scaleX
  const clipH = pl.height * pl.cropHeight * pl.scaleY
  return {
    clipW,
    clipH,
    x: -clipW / 2 + ((pl.width - iw) / 2 - pl.cropX * pl.width) * pl.scaleX,
    y: -clipH / 2 + ((pl.height - ih) / 2 - pl.cropY * pl.height) * pl.scaleY,
    w: iw * pl.scaleX,
    h: ih * pl.scaleY,
  }
}

// The screen area the picture covers, rotation included.
export function placementBounds(pl: TracePlacement, naturalWidth: number, naturalHeight: number) {
  const { clipW, clipH } = placePicture(pl, naturalWidth, naturalHeight)
  const r = pl.rotation * Math.PI / 180
  const hw = (Math.abs(Math.cos(r)) * clipW + Math.abs(Math.sin(r)) * clipH) / 2
  const hh = (Math.abs(Math.sin(r)) * clipW + Math.abs(Math.cos(r)) * clipH) / 2
  return { minX: pl.cx - hw, maxX: pl.cx + hw, minY: pl.cy - hh, maxY: pl.cy + hh }
}

export function drawPlacedPicture(ctx: CanvasRenderingContext2D, img: HTMLImageElement, pl: TracePlacement) {
  const p = placePicture(pl, img.naturalWidth, img.naturalHeight)
  ctx.save()
  ctx.translate(pl.cx, pl.cy)
  ctx.rotate(pl.rotation * Math.PI / 180)
  ctx.scale(pl.flipH ? -1 : 1, pl.flipV ? -1 : 1)
  ctx.beginPath()
  ctx.rect(-p.clipW / 2, -p.clipH / 2, p.clipW, p.clipH)
  ctx.clip()
  ctx.drawImage(img, p.x, p.y, p.w, p.h)
  ctx.restore()
}

// The smallest box holding every pixel that isn't fully transparent, as
// [min, max) in pixels -- or null when there is none. A saved drawing is
// trimmed to it, so what was erased doesn't stay on as empty trace.
export function alphaBounds(rgba: ArrayLike<number>, width: number, height: number) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      maxY = y
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX: maxX + 1, maxY: maxY + 1 }
}
