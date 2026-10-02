// Where a trace is and how big, as the canvas draws it: its base size, its
// transform as stored, the box it takes up, its border's colour. TraceOverlay
// draws from these, and so does the image export (lib/exportImage), so a
// picture of an atrium is where and the size the traces are.

import type { Trace } from '../types/database'
import { isPathTrace, pathWorldBounds } from './pathBounds.ts'

// A frame placed from the canvas menu, until it's resized to what it holds.
export const FRAME_DEFAULT = { width: 480, height: 320 }

// A trace's transform as the store holds it.
export const storedTransformOf = (trace: Trace) => ({
  x: trace.x ?? 0,
  y: trace.y ?? 0,
  scaleX: trace.scaleX ?? trace.scale ?? 1.0,
  scaleY: trace.scaleY ?? trace.scale ?? 1.0,
  rotation: trace.rotation ?? 0.0,
})

// Each kind's border, when it sets none of its own.
export function borderColourOf(type: string): string {
  switch (type) {
    case 'image': return '#a8a287'
    case 'audio': return '#9f987c'
    case 'video': return '#958f75'
    case 'embed': return '#8e886f'
    default: return '#b9b39d'
  }
}

// The size a trace is laid out at, before its scale: its own width and height
// where it keeps them; a picture or video without them, its natural size
// (`natural`, once it has loaded) brought down to a sensible one.
export function baseSizeOf(trace: Trace, natural?: { width: number; height: number }): { width: number; height: number } {
  const fitted = (maxBase: number) => {
    const longest = Math.max(natural!.width, natural!.height)
    const scale = longest > maxBase ? maxBase / longest : 1
    return { width: Math.round(natural!.width * scale), height: Math.round(natural!.height * scale) }
  }
  switch (trace.type) {
    case 'shape':
      return { width: trace.width || 200, height: trace.height || 200 }
    case 'text':
      // Text conforms to its box, like a spreadsheet cell's wrapped text.
      return { width: trace.width || 150, height: trace.height || 80 }
    case 'image':
      if (trace.width && trace.height) return { width: trace.width, height: trace.height }
      return natural ? fitted(300) : { width: 200, height: 200 }
    case 'audio':
      return { width: trace.width || 120, height: trace.height || 100 }
    case 'video':
      if (natural) {
        const scale = Math.min(200 / natural.width, 200 / natural.height, 1)
        return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) }
      }
      return { width: 200, height: 150 }
    case 'embed':
      if (trace.width && trace.height) return { width: trace.width, height: trace.height }
      // 16:9 until it says otherwise.
      return natural ? fitted(300) : { width: 300, height: 169 }
    case 'frame':
      return { width: trace.width || FRAME_DEFAULT.width, height: trace.height || FRAME_DEFAULT.height }
    case 'document':
      // A4 portrait, for one that kept no size.
      return { width: trace.width || 424, height: trace.height || 600 }
    case 'sheet':
    case 'chart':
      return { width: trace.width || 600, height: trace.height || 400 }
    default:
      return { width: 120, height: 80 }
  }
}

// The box a trace takes up in the world, border included (it's drawn outside
// the content, which is content-box sized): its centre, half its width and
// height, and its turn. A path's is its points', stroke included, already
// turned. `size` and `transform` default to the trace's own.
export function traceBox(
  trace: Trace,
  size = baseSizeOf(trace),
  transform: { x: number; y: number; scaleX?: number; scaleY?: number; rotation?: number } = storedTransformOf(trace),
): { cx: number; cy: number; halfW: number; halfH: number; turn: number } {
  if (isPathTrace(trace)) {
    const box = pathWorldBounds(trace.shapePoints, trace.shapeOutlineWidth ?? 2)
    if (box) return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, halfW: (box.maxX - box.minX) / 2, halfH: (box.maxY - box.minY) / 2, turn: 0 }
  }
  const w = (trace.type === 'shape' ? size.width : size.width * (trace.cropWidth ?? 1)) * (transform.scaleX ?? 1)
  const h = (trace.type === 'shape' ? size.height : size.height * (trace.cropHeight ?? 1)) * (transform.scaleY ?? 1)
  const frame = trace.type !== 'shape' && (trace.showBorder ?? true) ? (trace.borderWidth ?? 2) : 0
  return { cx: transform.x, cy: transform.y, halfW: w / 2 + frame, halfH: h / 2 + frame, turn: ((transform.rotation ?? 0) * Math.PI) / 180 }
}

// A polygon's outline as an SVG path with each corner rounded by `radius`
// (in the points' units) -- a triangle's corner radius, which SVG has no
// rx/ry for. Each corner's radius stops at half its shorter edge, so
// roundings can't meet and turn inside out.
export function roundedPolygonPath(points: { x: number; y: number }[], radius: number): string {
  if (radius <= 0) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
  }
  const n = points.length
  const segments: string[] = []
  for (let i = 0; i < n; i++) {
    const curr = points[i]
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y }
    const toNext = { x: next.x - curr.x, y: next.y - curr.y }
    const distPrev = Math.hypot(toPrev.x, toPrev.y) || 1
    const distNext = Math.hypot(toNext.x, toNext.y) || 1
    const rPrev = Math.min(radius, distPrev / 2)
    const rNext = Math.min(radius, distNext / 2)
    const startPoint = { x: curr.x + (toPrev.x / distPrev) * rPrev, y: curr.y + (toPrev.y / distPrev) * rPrev }
    const endPoint = { x: curr.x + (toNext.x / distNext) * rNext, y: curr.y + (toNext.y / distNext) * rNext }
    segments.push(i === 0 ? `M${startPoint.x},${startPoint.y}` : `L${startPoint.x},${startPoint.y}`)
    segments.push(`Q${curr.x},${curr.y} ${endPoint.x},${endPoint.y}`)
  }
  segments.push('Z')
  return segments.join(' ')
}
