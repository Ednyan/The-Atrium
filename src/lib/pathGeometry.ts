// Path traces' geometry: their curves' handles, where a point is added on
// each kind of line, and a dragged point snapping onto another trace's
// border. Kept free of the app, so it can be tested on its own.

import { elbowThrough, lineMiddle, type Pt } from './elbow.ts'

export type PathCurve = 'straight' | 'bezier' | 'elbow'

// A path's point, with its curve handles where they've been set: cp1 into
// it, cp2 out of it.
export interface PathPoint extends Pt {
  cp1x?: number
  cp1y?: number
  cp2x?: number
  cp2y?: number
}

// How far a point's handles reach when they haven't been set: a share of the
// run from the point before to the point after. It was half of this, which
// left an unedited curve barely bending.
export const CURVE_TENSION = 1

// A point's two handles, in line with each other: set ones as set, unset
// ones along the line from the point before to the point after (an end
// point's along its one run).
export function handlesAt(points: PathPoint[], i: number): { cp1: Pt; cp2: Pt } {
  const p = points[i]
  const prev = points[i - 1] ?? p, next = points[i + 1] ?? p
  const tx = ((next.x - prev.x) / 6) * CURVE_TENSION, ty = ((next.y - prev.y) / 6) * CURVE_TENSION
  return {
    cp1: p.cp1x !== undefined && p.cp1y !== undefined ? { x: p.cp1x, y: p.cp1y } : { x: p.x - tx, y: p.y - ty },
    cp2: p.cp2x !== undefined && p.cp2y !== undefined ? { x: p.cp2x, y: p.cp2y } : { x: p.x + tx, y: p.y + ty },
  }
}

// A curve through points as an SVG path: one cubic from each point to the
// next, on their handles.
export function curvePath(points: PathPoint[]): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const a = handlesAt(points, i).cp2, b = handlesAt(points, i + 1).cp1, q = points[i + 1]
    d += ` C ${a.x} ${a.y}, ${b.x} ${b.y}, ${q.x} ${q.y}`
  }
  return d
}

// One handle moved, the other turned to stay in line with it, through the
// point, keeping its own length: an aligned node, as in a drawing program.
export function alignedHandle(point: Pt, moved: Pt, other: Pt): Pt {
  const mx = moved.x - point.x, my = moved.y - point.y, ml = Math.hypot(mx, my)
  if (ml < 1e-6) return other
  const len = Math.hypot(other.x - point.x, other.y - point.y)
  return { x: point.x - (mx / ml) * len, y: point.y - (my / ml) * len }
}

// Where a point is added between points i and i + 1: halfway along the line
// drawn between them, whichever kind of line it is.
export function pointBetween(points: PathPoint[], curve: PathCurve, i: number): Pt {
  const p = points[i], q = points[i + 1]
  if (curve === 'bezier') {
    const a = handlesAt(points, i).cp2, b = handlesAt(points, i + 1).cp1
    // A cubic at its middle: (p + 3a + 3b + q) / 8.
    return { x: (p.x + 3 * a.x + 3 * b.x + q.x) / 8, y: (p.y + 3 * a.y + 3 * b.y + q.y) / 8 }
  }
  if (curve === 'elbow') {
    // The runs between the two, as the whole elbow draws them: each turns to
    // follow the run before, so it's taken from the whole line.
    // elbowThrough keeps the points it's given, so points[i] is found in it.
    const route = elbowThrough(points.slice(0, i + 2))
    return lineMiddle(route.slice(Math.max(0, route.lastIndexOf(points[i]))))
  }
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
}

// A box on the canvas: its centre, half-size and turn in degrees. Round, its
// border is the ellipse inside it (a circle trace's).
export interface TurnedBox {
  cx: number
  cy: number
  halfW: number
  halfH: number
  rotation: number
  round?: boolean
}

const toBox = (box: TurnedBox, p: Pt) => {
  const r = (box.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  const dx = p.x - box.cx, dy = p.y - box.cy
  return { u: dx * c + dy * s, v: -dx * s + dy * c }
}
const fromBox = (box: TurnedBox, u: number, v: number): Pt => {
  const r = (box.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  return { x: box.cx + u * c - v * s, y: box.cy + u * s + v * c }
}

// Whether a point is on the box, or within `margin` of it.
export function boxHolds(box: TurnedBox, p: Pt, margin = 0): boolean {
  const { u, v } = toBox(box, p)
  return Math.abs(u) <= box.halfW + margin && Math.abs(v) <= box.halfH + margin
}

// The points of a border a dragged point snaps to first, clockwise from the
// top left, in the box's own terms: a box's four corners and the middles of
// its four sides; round, the four ends of the ellipse and the four points
// halfway round between them.
function marksOf(box: TurnedBox): [number, number][] {
  const w = box.halfW, h = box.halfH
  if (box.round) {
    return [-135, -90, -45, 0, 45, 90, 135, 180].map(deg => {
      const a = (deg * Math.PI) / 180
      return [w * Math.cos(a), h * Math.sin(a)]
    })
  }
  return [[-w, -h], [0, -h], [w, -h], [w, 0], [w, h], [0, h], [-w, h], [-w, 0]]
}

export function borderMarks(box: TurnedBox): Pt[] {
  return marksOf(box).map(([u, v]) => fromBox(box, u, v))
}

// Where a point dragged over a box lands on its border: the nearest point of
// the border, or one of its marks (borderMarks) when within `grip` of it.
export function snapToBorder(box: TurnedBox, p: Pt, grip: number): Pt {
  let { u, v } = toBox(box, p)
  const w = box.halfW, h = box.halfH
  if (box.round) {
    // Out from the middle, onto the ellipse -- the nearest point of a
    // circle, and near enough it for an ellipse.
    const a = Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9 ? -Math.PI / 2 : Math.atan2(v / (h || 1), u / (w || 1))
    u = w * Math.cos(a)
    v = h * Math.sin(a)
  } else if (Math.abs(u) <= w && Math.abs(v) <= h) {
    // Inside: out to the nearest side.
    const sides = [w - u, w + u, h - v, h + v]
    const nearest = sides.indexOf(Math.min(...sides))
    if (nearest === 0) u = w
    else if (nearest === 1) u = -w
    else if (nearest === 2) v = h
    else v = -h
  } else {
    u = Math.max(-w, Math.min(w, u))
    v = Math.max(-h, Math.min(h, v))
  }
  let best: [number, number] | null = null, bestD = grip
  for (const [mu, mv] of marksOf(box)) {
    const d = Math.hypot(u - mu, v - mv)
    if (d <= bestD) { best = [mu, mv]; bestD = d }
  }
  if (best) [u, v] = best
  return fromBox(box, u, v)
}
