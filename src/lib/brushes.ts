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
import { groupIdOf, type Stackable } from './order.ts'

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

// ---- A drawing, stroke by stroke ---------------------------------------------
//
// Each stroke is saved as it's finished, as a picture of just that stroke --
// a trace of its own, in the drawing's group (LobbyScene). The eraser takes
// pixels out of every stroke of the drawing it crosses, each one painted again
// without them. A drawing from before this is one picture of all its strokes,
// and is erased the same way.

// Whether a trace is a drawing. Its file is saved as drawing_<...>.png; the
// label covers one kept as a data URL because its upload failed.
export function isDrawingTrace(t: { type: string; mediaUrl?: string | null; content?: string | null }): boolean {
  return t.type === 'image'
    && (/(^|\/)drawing_[^/?#]*\.png([?#]|$)/.test(t.mediaUrl ?? '') || t.content === 'freehand drawing')
}

// Where a trace shows its picture on screen, as TraceOverlay lays it out:
// centred on (cx, cy), turned by `rotation` degrees. The picture is fitted
// inside width x height (world units) and mirrored there by the flips, that
// box is stretched by scaleX/scaleY (screen px per world unit, zoom
// included), and a crop keeps its share of the box and cuts away the rest --
// of the flipped picture, as it's seen (lib/traceFlip).
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

// A stroke's picture: loaded from its file, or painted here.
export type Picture = HTMLImageElement | HTMLCanvasElement
export const pictureSize = (picture: Picture) => 'naturalWidth' in picture
  ? { width: picture.naturalWidth, height: picture.naturalHeight }
  : { width: picture.width, height: picture.height }

export function drawPlacedPicture(ctx: CanvasRenderingContext2D, img: Picture, pl: TracePlacement) {
  const size = pictureSize(img)
  const p = placePicture(pl, size.width, size.height)
  ctx.save()
  ctx.translate(pl.cx, pl.cy)
  ctx.rotate(pl.rotation * Math.PI / 180)
  ctx.beginPath()
  ctx.rect(-p.clipW / 2, -p.clipH / 2, p.clipW, p.clipH)
  ctx.clip()
  // Mirrored about the middle of the whole box, not of what the crop leaves.
  const mx = -p.clipW / 2 + (pl.width / 2 - pl.cropX * pl.width) * pl.scaleX
  const my = -p.clipH / 2 + (pl.height / 2 - pl.cropY * pl.height) * pl.scaleY
  ctx.translate(mx, my)
  ctx.scale(pl.flipH ? -1 : 1, pl.flipV ? -1 : 1)
  ctx.translate(-mx, -my)
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

// ---- Stroke pictures -------------------------------------------------------------

// A picture and where it sits in the world: centred on (cx, cy), width x height
// world units, nothing turned, flipped or cropped -- and, for a stroke, the
// stroke itself, to paint it again from (StrokeData).
export interface Piece { picture: HTMLCanvasElement; placement: TracePlacement; data?: StrokeData }

export const plainPlacement = (cx: number, cy: number, width: number, height: number): TracePlacement => ({
  cx, cy, rotation: 0, flipH: false, flipV: false, width, height, scaleX: 1, scaleY: 1, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1,
})

// Pixels per world unit a stroke's picture is painted at: at least `wanted`,
// and a whole number of them (1, 2, 3...) or a whole number of world units to
// the pixel (1/2, 1/3...). With that, and the picture padded to match
// (worldSize), its size is a whole number of world units -- which is all the
// web's width and height columns hold -- so it's shown exactly as painted, and
// erasing it again copies its pixels across untouched rather than blurring
// them a little more each time.
export function niceDensity(wanted: number): number {
  if (wanted >= 1) return Math.max(1, Math.ceil(wanted - 1e-6))
  return 1 / Math.max(1, Math.floor(1 / wanted + 1e-6))
}

// The next density down from a nice one, for a picture too big to paint.
const lowerDensity = (ppw: number) => (ppw > 1 ? ppw - 1 : 1 / (Math.round(1 / ppw) + 1))

// `px` pixels across, padded so they come to a whole number of world units.
export function worldSize(px: number, ppw: number): { px: number; units: number } {
  if (ppw >= 1) {
    const units = Math.max(1, Math.ceil(px / ppw - 1e-6))
    return { px: Math.round(units * ppw), units }
  }
  const perPixel = Math.round(1 / ppw)
  return { px: Math.max(1, px), units: Math.max(1, px) * perPixel }
}

// Canvases are refused past this on a side.
const MAX_SIDE = 8192

// What's left on `canvas` -- whose top-left pixel is at (originX, originY) in
// the world, `ppw` pixels to a world unit -- cut down to its ink, as a piece.
// Null when nothing is left.
function trimToInk(canvas: HTMLCanvasElement, originX: number, originY: number, ppw: number): Piece | null {
  const ctx = canvas.getContext('2d')!
  const found = alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
  if (!found) return null
  const wide = worldSize(found.maxX - found.minX, ppw)
  const high = worldSize(found.maxY - found.minY, ppw)
  const picture = document.createElement('canvas')
  picture.width = wide.px
  picture.height = high.px
  picture.getContext('2d')!.drawImage(canvas, -found.minX, -found.minY)
  return {
    picture,
    placement: plainPlacement(originX + found.minX / ppw + wide.units / 2, originY + found.minY / ppw + high.units / 2, wide.units, high.units),
  }
}

// A stroke's reach past its points, in its own units: its edge beyond the
// centre line, and a soft one's fade, three quarters of a width further out.
const strokeReach = (stroke: Stroke) => stroke.width * 1.3

function strokeBox(stroke: Stroke, reach: number) {
  const xs = stroke.points.map(p => p.x)
  const ys = stroke.points.map(p => p.y)
  return { minX: Math.min(...xs) - reach, maxX: Math.max(...xs) + reach, minY: Math.min(...ys) - reach, maxY: Math.max(...ys) + reach }
}

// Paints `stroke` (in world units) onto `ctx`, whose top-left is (originX,
// originY) in the world at `ppw` pixels to a unit.
function paintInto(ctx: CanvasRenderingContext2D, stroke: Stroke, originX: number, originY: number, ppw: number) {
  drawStroke(ctx, {
    ...stroke,
    width: stroke.width * ppw,
    points: stroke.points.map(p => ({ ...p, x: (p.x - originX) * ppw, y: (p.y - originY) * ppw })),
  })
}

// A finished stroke (world units) as a piece of its own, painted at no less
// than `zoom` pixels to a world unit -- the detail it was drawn with. Null if
// it left no ink.
export function rasterizeStroke(stroke: Stroke, zoom: number): Piece | null {
  if (stroke.points.length === 0 || stroke.isEraser) return null
  const box = strokeBox(stroke, Math.max(20 / zoom, strokeReach(stroke) + 4 / zoom))
  let ppw = niceDensity(zoom)
  while (ppw > 1 / 64 && Math.max(box.maxX - box.minX, box.maxY - box.minY) * ppw > MAX_SIDE) ppw = lowerDensity(ppw)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil((box.maxX - box.minX) * ppw))
  canvas.height = Math.max(1, Math.ceil((box.maxY - box.minY) * ppw))
  paintInto(canvas.getContext('2d')!, stroke, box.minX, box.minY, ppw)
  const piece = trimToInk(canvas, box.minX, box.minY, ppw)
  if (!piece) return null
  // Kept too, in the box's own units: its top-left the picture's first pixel.
  const { cx, cy, width, height } = piece.placement
  return { ...piece, data: { v: 1, ppw, stroke: shiftStroke(stroke, -(cx - width / 2), -(cy - height / 2)), erasers: [] } }
}

// A drawing's picture, placed in the world as its trace shows it, with an
// eraser stroke (world units) taken out of it: 'untouched' when the eraser
// didn't reach any of its ink, null when it took all of it, else what's left.
//
// A picture that isn't turned, flipped or cropped -- every stroke saved since
// strokes were saved one by one -- is copied across pixel for pixel, at its
// own density; one that is (a drawing from before, moved about) is painted
// flat once, at the nearest nice density to its own.
export function erasePicture(picture: Picture, placement: TracePlacement, eraser: Stroke): Piece | null | 'untouched' {
  if (eraser.points.length === 0) return 'untouched'
  const { width: nw, height: nh } = pictureSize(picture)
  if (!nw || !nh) return 'untouched'
  const shown = placePicture(placement, nw, nh)
  const plain = placement.rotation % 360 === 0 && !placement.flipH && !placement.flipV
    && placement.cropX === 0 && placement.cropY === 0 && placement.cropWidth === 1 && placement.cropHeight === 1
  let ppw = niceDensity(nw / Math.abs(shown.w))
  const box = plain
    ? { minX: placement.cx + shown.x, minY: placement.cy + shown.y, maxX: placement.cx + shown.x + shown.w, maxY: placement.cy + shown.y + shown.h }
    : placementBounds(placement, nw, nh)

  const reach = strokeBox(eraser, strokeReach(eraser) + 2 / ppw)
  if (reach.maxX < box.minX || reach.minX > box.maxX || reach.maxY < box.minY || reach.minY > box.maxY) return 'untouched'

  while (!plain && ppw > 1 / 64 && Math.max(box.maxX - box.minX, box.maxY - box.minY) * ppw > MAX_SIDE) ppw = lowerDensity(ppw)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.min(MAX_SIDE, Math.round((box.maxX - box.minX) * ppw + (plain ? 0 : 0.5))))
  canvas.height = Math.max(1, Math.min(MAX_SIDE, Math.round((box.maxY - box.minY) * ppw + (plain ? 0 : 0.5))))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.setTransform(ppw, 0, 0, ppw, -box.minX * ppw, -box.minY * ppw)
  drawPlacedPicture(ctx, picture, placement)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  paintInto(ctx, eraser, box.minX, box.minY, ppw)
  const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let changed = false
  for (let i = 3; i < after.length && !changed; i += 4) changed = after[i] !== before[i]
  if (!changed) return 'untouched'
  return trimToInk(canvas, box.minX, box.minY, ppw)
}

// A stroke's picture in another colour: every pixel that colour, as opaque
// as it was -- a brush's grain, a soft edge and what the eraser took all kept.
// A drawing from before strokes were saved one by one comes out one colour.
// With no colour, a copy as it is, on a canvas.
export function tintPicture(picture: Picture, colour: string | null): HTMLCanvasElement {
  const { width, height } = pictureSize(picture)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(picture, 0, 0)
  if (colour) {
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = colour
    ctx.fillRect(0, 0, width, height)
  }
  return canvas
}

// The colour a stroke is painted in: its most opaque pixel's, as #rrggbb --
// the edges are blended toward nothing and say less. Null for a blank one.
export function inkColour(picture: Picture): string | null {
  const { width, height } = pictureSize(picture)
  if (!width || !height) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(picture, 0, 0)
  const data = ctx.getImageData(0, 0, width, height).data
  let best = -1
  for (let i = 3; i < data.length; i += 4) {
    if (best < 0 || data[i] > data[best]) best = i
    if (data[i] === 255) break
  }
  if (best < 0 || data[best] === 0) return null
  return '#' + [data[best - 3], data[best - 2], data[best - 1]].map(v => v.toString(16).padStart(2, '0')).join('')
}

// The drawing a drawing trace belongs to: the group it's in, when everything
// in that group is a drawing (a "Drawing N"), or just itself -- alone, or
// among other things in a group of some other kind.
export function drawingOf<T extends Stackable & { type: string; mediaUrl?: string | null; content?: string | null }>(
  trace: T, traces: T[], layers: { id: string }[],
): { groupId: string | null; members: T[] } {
  const groupId = groupIdOf(trace, layers)
  if (!groupId) return { groupId: null, members: [trace] }
  const inGroup = traces.filter(t => t.layerId === groupId)
  return { groupId, members: inGroup.every(isDrawingTrace) ? inGroup : [trace] }
}

// ---- A stroke kept as it was drawn ----------------------------------------------
//
// A stroke's picture is its file, but the stroke is kept as well: its points,
// colour, width, brush, softness and seed, and each eraser stroke taken out of
// it, in the trace's own box units -- (0, 0) the box's top-left, width x
// height its size before any scaling. Moving, scaling or turning the trace
// leaves them alone. From them it's painted again: sharp at whatever zoom
// it's seen at (TraceOverlay), and in another colour, width, brush or
// softness. The file stays, for everything that reads files -- exports, older
// copies of the app -- and is painted again with it.

export interface StrokeData {
  v: 1
  // Pixels per unit its file is painted at.
  ppw: number
  stroke: Stroke
  erasers: Stroke[]
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function asStroke(value: any): Stroke | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.points) || typeof value.color !== 'string' || !finite(value.width) || value.width <= 0) return null
  if (!value.points.every((p: any) => p && finite(p.x) && finite(p.y) && (p.p === undefined || finite(p.p)))) return null
  return {
    points: value.points.map((p: any) => (p.p === undefined ? { x: p.x, y: p.y } : { x: p.x, y: p.y, p: p.p })),
    color: value.color,
    width: value.width,
    isEraser: !!value.isEraser,
    ...(typeof value.brush === 'string' ? { brush: value.brush } : {}),
    ...(finite(value.seed) ? { seed: value.seed } : {}),
    ...(finite(value.hardness) ? { hardness: value.hardness } : {}),
  }
}

// A stroke's data as read back -- from the database, a file, a desktop vault
// (as text there) -- or null for anything that isn't one. Never trusted as it
// comes: it's painted from.
export function asStrokeData(value: unknown): StrokeData | null {
  let data: any = value
  if (typeof data === 'string') {
    try { data = JSON.parse(data) } catch { return null }
  }
  if (!data || typeof data !== 'object' || data.v !== 1 || !finite(data.ppw) || data.ppw <= 0 || !Array.isArray(data.erasers)) return null
  const stroke = asStroke(data.stroke)
  const erasers = data.erasers.map(asStroke)
  if (!stroke || erasers.some((e: Stroke | null) => !e)) return null
  return { v: 1, ppw: data.ppw, stroke: { ...stroke, isEraser: false }, erasers: erasers.map((e: Stroke) => ({ ...e, isEraser: true })) }
}

export const shiftStroke = (stroke: Stroke, dx: number, dy: number): Stroke =>
  ({ ...stroke, points: stroke.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy })) })

// The stroke, and what the eraser took from it, painted at `ppw` pixels to a
// unit: its box's top-left at the canvas's.
export function paintStrokeData(ctx: CanvasRenderingContext2D, data: StrokeData, ppw: number) {
  paintInto(ctx, data.stroke, 0, 0, ppw)
  for (const eraser of data.erasers) paintInto(ctx, eraser, 0, 0, ppw)
}

export function renderStrokeData(data: StrokeData, width: number, height: number, ppw = data.ppw): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * ppw))
  canvas.height = Math.max(1, Math.round(height * ppw))
  paintStrokeData(canvas.getContext('2d', { willReadFrequently: true })!, data, ppw)
  return canvas
}

// An eraser stroke in the world, in a trace's own box units: back through
// where it's centred, how it's turned, scaled and flipped (TracePlacement, in
// world units). Its width by the scale's geometric mean -- a trace stretched
// more one way than the other gets a round eraser, near enough.
export function strokeToLocal(stroke: Stroke, pl: TracePlacement): Stroke {
  const turn = -pl.rotation * Math.PI / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const sx = pl.scaleX || 1
  const sy = pl.scaleY || 1
  return {
    ...stroke,
    width: stroke.width / Math.sqrt(Math.abs(sx * sy)),
    points: stroke.points.map(p => {
      const dx = p.x - pl.cx
      const dy = p.y - pl.cy
      let x = (dx * cos - dy * sin) / sx
      let y = (dx * sin + dy * cos) / sy
      if (pl.flipH) x = -x
      if (pl.flipV) y = -y
      return { ...p, x: x + pl.width / 2, y: y + pl.height / 2 }
    }),
  }
}

// A move in a trace's box units, as it is in the world: flipped, scaled and
// turned as the trace is.
export function localToWorldDelta(dx: number, dy: number, pl: TracePlacement) {
  const x = (pl.flipH ? -dx : dx) * (pl.scaleX || 1)
  const y = (pl.flipV ? -dy : dy) * (pl.scaleY || 1)
  const turn = pl.rotation * Math.PI / 180
  return { x: x * Math.cos(turn) - y * Math.sin(turn), y: x * Math.sin(turn) + y * Math.cos(turn) }
}

const pixelsOf = (canvas: HTMLCanvasElement) => canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height).data
function inkChanged(before: Uint8ClampedArray, after: Uint8ClampedArray) {
  for (let i = 3; i < after.length; i += 4) if (after[i] !== before[i]) return true
  return false
}
function hasInk(data: Uint8ClampedArray) {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true
  return false
}

// An eraser stroke, in the trace's box units, taken out of a kept stroke:
// 'untouched' when it reached none of its ink, null when it took all of it,
// else the stroke with that eraser added and its picture. The box stays as it
// is, so the trace doesn't move.
export function eraseStrokeData(data: StrokeData, width: number, height: number, eraser: Stroke): { data: StrokeData; picture: HTMLCanvasElement } | null | 'untouched' {
  if (eraser.points.length === 0) return 'untouched'
  const reach = strokeBox(eraser, strokeReach(eraser) + 2 / data.ppw)
  if (reach.maxX < 0 || reach.minX > width || reach.maxY < 0 || reach.minY > height) return 'untouched'
  const next: StrokeData = { ...data, erasers: [...data.erasers, { ...eraser, isEraser: true }] }
  const picture = renderStrokeData(next, width, height)
  const after = pixelsOf(picture)
  if (!inkChanged(pixelsOf(renderStrokeData(data, width, height)), after)) return 'untouched'
  return hasInk(after) ? { data: next, picture } : null
}

// A kept stroke painted again after its width, brush or softness changed --
// which can need a bigger box, or fit a smaller one: its box fitted to its ink
// again. Returned in the new box's units, with the new box's size and how far
// its centre moved, in the old box's units. Null when no ink is left.
export function refitStrokeData(data: StrokeData, width: number, height: number): {
  data: StrokeData; picture: HTMLCanvasElement; width: number; height: number; dx: number; dy: number
} | null {
  const ppw = data.ppw
  const box = strokeBox(data.stroke, Math.max(20 / ppw, strokeReach(data.stroke) + 4 / ppw))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.min(MAX_SIDE, Math.ceil((box.maxX - box.minX) * ppw)))
  canvas.height = Math.max(1, Math.min(MAX_SIDE, Math.ceil((box.maxY - box.minY) * ppw)))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  paintInto(ctx, data.stroke, box.minX, box.minY, ppw)
  for (const eraser of data.erasers) paintInto(ctx, eraser, box.minX, box.minY, ppw)
  const piece = trimToInk(canvas, box.minX, box.minY, ppw)
  if (!piece) return null
  const { cx, cy, width: w, height: h } = piece.placement
  const left = cx - w / 2
  const top = cy - h / 2
  return {
    data: { ...data, stroke: shiftStroke(data.stroke, -left, -top), erasers: data.erasers.map(e => shiftStroke(e, -left, -top)) },
    picture: piece.picture,
    width: w,
    height: h,
    dx: cx - width / 2,
    dy: cy - height / 2,
  }
}

// How sharp a kept stroke is painted when seen closer than its file
// (components/StrokeCanvas). Pixels a stroke's canvas may hold: A stroke seen far closer than it was
// drawn stops getting sharper past this -- one as big as the screen, at a
// high zoom, would otherwise ask for tens of megabytes, and a drawing is
// many strokes.
const MAX_STROKE_PIXELS = 1_000_000

// The pixels per box unit to paint at, for `needed`: the power of two at or
// above it, as far as MAX_STROKE_PIXELS allows for a width x height box.
export function strokeDensity(needed: number, width: number, height: number): number {
  let density = 2 ** Math.ceil(Math.log2(Math.max(1 / 16, needed)))
  while (density > 1 / 16 && width * height * density * density > MAX_STROKE_PIXELS) density /= 2
  return density
}
