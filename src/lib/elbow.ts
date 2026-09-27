// Elbows: lines made of straight runs and right-angle turns, with their
// corners rounded. Shared by connections set to Elbow (routed between two
// traces, elbowRoute) and paths set to Elbow (through the points placed,
// elbowThrough). Kept free of the app, so it can be tested on its own.

export interface Pt { x: number; y: number }

// How much an elbow's corners are rounded, in world units.
export const ELBOW_RADIUS = 12
// A box by its centre and half-size. Turned boxes are taken as unturned.
export interface CentredBox { x: number; y: number; hw: number; hh: number }

// Which way two boxes lie apart: across (left and right of each other) when
// the gap across is the larger, down otherwise.
export const elbowAxis = (a: CentredBox, b: CentredBox): 'x' | 'y' =>
  Math.abs(b.x - a.x) - (a.hw + b.hw) >= Math.abs(b.y - a.y) - (a.hh + b.hh) ? 'x' : 'y'

// The ends of an elbow from `a` to `b`: the middle of the side of each that
// faces the other.
function elbowEnds(a: CentredBox, b: CentredBox, axis: 'x' | 'y'): [Pt, Pt] {
  if (axis === 'x') {
    const s = b.x >= a.x ? 1 : -1
    return [{ x: a.x + s * a.hw, y: a.y }, { x: b.x - s * b.hw, y: b.y }]
  }
  const s = b.y >= a.y ? 1 : -1
  return [{ x: a.x, y: a.y + s * a.hh }, { x: b.x, y: b.y - s * b.hh }]
}

// An elbow from box `a` to box `b`: out of the side of `a` facing `b`, into
// the side of `b` facing `a`, turning twice, with its middle run `at` of the
// way from one end to the other (0.5 halfway; past 0 or 1 when dragged
// there). Its corners, the first and last on the borders. Level ends are one
// straight run.
export function elbowRoute(a: CentredBox, b: CentredBox, at: number): Pt[] {
  const axis = elbowAxis(a, b)
  const [start, end] = elbowEnds(a, b, axis)
  if (axis === 'x') {
    if (Math.abs(start.y - end.y) < 0.5) return [start, end]
    const mx = start.x + (end.x - start.x) * at
    return [start, { x: mx, y: start.y }, { x: mx, y: end.y }, end]
  }
  if (Math.abs(start.x - end.x) < 0.5) return [start, end]
  const my = start.y + (end.y - start.y) * at
  return [start, { x: start.x, y: my }, { x: end.x, y: my }, end]
}

// The `at` that puts an elbow's middle run under a pointer: how far along,
// from start to end, the pointer is on the axis the boxes lie apart on.
export function elbowAtFor(a: CentredBox, b: CentredBox, pointer: Pt): number {
  const axis = elbowAxis(a, b)
  const [start, end] = elbowEnds(a, b, axis)
  const span = axis === 'x' ? end.x - start.x : end.y - start.y
  if (Math.abs(span) < 1e-6) return 0.5
  const at = ((axis === 'x' ? pointer.x - start.x : pointer.y - start.y) / span)
  return Math.max(-5, Math.min(6, at))
}

// An elbow through points in order: from each to the next, one run and a
// turn and another run, the first of them at right angles to the run that
// came in, so it never doubles back on itself at a point. The first run
// leaves along the longer way. A pair already level or plumb is one run.
export function elbowThrough(points: Pt[]): Pt[] {
  if (points.length < 2) return points.slice()
  const out: Pt[] = [points[0]]
  let lastAxis: 'x' | 'y' | null = null
  for (let i = 1; i < points.length; i++) {
    const p = out[out.length - 1], q = points[i]
    const dx = Math.abs(q.x - p.x), dy = Math.abs(q.y - p.y)
    if (dx < 0.5 || dy < 0.5) {
      out.push(q)
      lastAxis = dx < 0.5 ? 'y' : 'x'
      continue
    }
    const first: 'x' | 'y' = lastAxis === 'x' ? 'y' : lastAxis === 'y' ? 'x' : (dx >= dy ? 'x' : 'y')
    out.push(first === 'x' ? { x: q.x, y: p.y } : { x: p.x, y: q.y }, q)
    lastAxis = first === 'x' ? 'y' : 'x'
  }
  return out
}

// A line through points as an SVG path, each corner rounded by up to
// `radius` -- less where a run is too short to take it.
export function roundedPath(points: Pt[], radius: number): string {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], p = points[i], next = points[i + 1]
    const into = Math.hypot(p.x - prev.x, p.y - prev.y), out = Math.hypot(next.x - p.x, next.y - p.y)
    const k = Math.min(radius, into / 2, out / 2)
    if (k < 0.01) {
      d += ` L ${p.x} ${p.y}`
      continue
    }
    const ax = p.x - ((p.x - prev.x) / into) * k, ay = p.y - ((p.y - prev.y) / into) * k
    const bx = p.x + ((next.x - p.x) / out) * k, by = p.y + ((next.y - p.y) / out) * k
    d += ` L ${ax} ${ay} Q ${p.x} ${p.y} ${bx} ${by}`
  }
  const last = points[points.length - 1]
  return `${d} L ${last.x} ${last.y}`
}

// The same line with its ends drawn back along their runs -- `start` from the
// first point, `end` from the last -- where arrowheads cover them. Never past
// the next point.
export function trimEnds(points: Pt[], start: number, end: number): Pt[] {
  if (points.length < 2 || (start <= 0 && end <= 0)) return points
  const out = points.map(p => ({ ...p }))
  const pull = (from: Pt, toward: Pt, by: number, room: number) => {
    const len = Math.hypot(toward.x - from.x, toward.y - from.y)
    if (len < 1e-6 || by <= 0) return from
    const k = Math.min(by, len * room) / len
    return { x: from.x + (toward.x - from.x) * k, y: from.y + (toward.y - from.y) * k }
  }
  // With one run, each end may take only half of it.
  const room = points.length === 2 ? 0.5 : 1
  out[0] = pull(points[0], points[1], start, room)
  const n = points.length
  out[n - 1] = pull(points[n - 1], points[n - 2], end, room)
  return out
}

// Where a line through points is halfway along its length.
export function lineMiddle(points: Pt[]): Pt {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
  let left = lengths.reduce((a, b) => a + b, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] > 0 ? Math.min(1, left / lengths[i]) : 0
      return { x: points[i].x + (points[i + 1].x - points[i].x) * k, y: points[i].y + (points[i + 1].y - points[i].y) * k }
    }
    left -= lengths[i]
  }
  return points[points.length - 1]
}

// The middle of an elbow's middle run: where its label sits, and its grip for
// dragging that run. A single run's middle when it has no turns.
export function elbowGrip(points: Pt[]): Pt {
  if (points.length === 4) return { x: (points[1].x + points[2].x) / 2, y: (points[1].y + points[2].y) / 2 }
  return lineMiddle(points)
}

// Whether a line through points crosses or lies in an area.
export function lineCrosses(points: Pt[], area: { left: number; top: number; right: number; bottom: number }): boolean {
  const inside = (p: Pt) => p.x >= area.left && p.x <= area.right && p.y >= area.top && p.y <= area.bottom
  if (points.some(inside)) return true
  const edges: [Pt, Pt][] = [
    [{ x: area.left, y: area.top }, { x: area.right, y: area.top }],
    [{ x: area.right, y: area.top }, { x: area.right, y: area.bottom }],
    [{ x: area.right, y: area.bottom }, { x: area.left, y: area.bottom }],
    [{ x: area.left, y: area.bottom }, { x: area.left, y: area.top }],
  ]
  const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
    const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)
  }
  for (let i = 1; i < points.length; i++) {
    for (const [c, d] of edges) if (cross(points[i - 1], points[i], c, d)) return true
  }
  return false
}
