// Connections between traces: a curved thread from one trace's centre to
// another's, drawn under both -- the traces are the nodes, as in graphify.
//
// Kept free of the app's imports, so the geometry below can be tested on its
// own. The table is trace_links; see supabase/migrations/add_trace_links.sql.

// 'forward' points from `from` to `to`, 'back' the other way.
export type LinkArrow = 'none' | 'forward' | 'back' | 'both'

export interface TraceLink {
  id: string
  lobbyId: string
  from: string
  to: string
  arrow: LinkArrow
  // null follows the border colour of the trace it comes from.
  color: string | null
  width: number
  label: string
  // The label is shown always unless this is set; then only on hover (or
  // while the thread is selected, which is how touch gets to it).
  labelOnHover: boolean
}

export const DEFAULT_LINK_WIDTH = 2
const ARROWS: LinkArrow[] = ['none', 'forward', 'back', 'both']

export function mapRowToLink(row: any): TraceLink {
  return {
    id: row.id,
    lobbyId: row.lobby_id,
    from: row.from_trace,
    to: row.to_trace,
    arrow: ARROWS.includes(row.arrow) ? row.arrow : 'none',
    color: typeof row.color === 'string' && row.color ? row.color : null,
    // Within the table's checks, so a hand-edited file can't carry a value
    // the database refuses.
    width: typeof row.width === 'number' && row.width > 0 ? Math.min(row.width, 40) : DEFAULT_LINK_WIDTH,
    label: typeof row.label === 'string' ? row.label.slice(0, 80) : '',
    labelOnHover: !!row.label_on_hover,
  }
}

export function linkRow(link: TraceLink) {
  return {
    id: link.id,
    lobby_id: link.lobbyId,
    from_trace: link.from,
    to_trace: link.to,
    arrow: link.arrow,
    color: link.color,
    width: link.width,
    label: link.label || null,
    label_on_hover: link.labelOnHover,
  }
}

// Threads carried into another atrium -- an import, an upload, a restore from
// the vault -- whose traces got new ids on the way (`traceIds`: old to new).
// Both ends are repointed; a thread whose other end didn't make it is left
// behind, and so is a second thread between the same two traces, which the
// table refuses -- one refusal would lose the whole batch. The rows keep
// their lobby_id for the caller to repoint, and leave the id to the table.
export function carryLinks(rows: unknown, traceIds: Map<string, string>) {
  if (!Array.isArray(rows)) return []
  const pairs = new Set<string>()
  return rows.flatMap(row => {
    const from = traceIds.get(row?.from_trace), to = traceIds.get(row?.to_trace)
    const pair = [from, to].sort().join(' ')
    if (!from || !to || from === to || pairs.has(pair)) return []
    pairs.add(pair)
    const { id: _id, ...rest } = linkRow({ ...mapRowToLink(row), from, to })
    return [rest]
  })
}

// Whether two traces are already joined, whichever way round.
export function joins(link: TraceLink, a: string, b: string): boolean {
  return (link.from === a && link.to === b) || (link.from === b && link.to === a)
}

// The control point of a thread from A to B: off the straight line by a share
// of its length, always to the same side of the direction of travel, as
// graphify bends its edges.
export function bend(ax: number, ay: number, bx: number, by: number, amount = 0.14) {
  return { x: (ax + bx) / 2 - (by - ay) * amount, y: (ay + by) / 2 + (bx - ax) * amount }
}

// Where a thread from (ax, ay), bent through (cx, cy), enters the box of the
// trace it ends at -- centre (bx, by), half-sizes hw and hh, turned by `turn`
// radians -- and the way it's heading there: an arrowhead's tip and aim. The
// thread runs on under the trace to its centre, so the border is where a tip
// can be seen, and it's found on the curve itself: the straight line from the
// centre toward the bend meets the border somewhere else, further off the
// bigger the trace. Null when the thread starts inside the box, as between
// overlapping traces.
export function curveEntry(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, hw: number, hh: number, turn = 0) {
  const cos = Math.cos(turn), sin = Math.sin(turn)
  const at = (t: number) => {
    const u = 1 - t
    return { x: u * u * ax + 2 * u * t * cx + t * t * bx, y: u * u * ay + 2 * u * t * cy + t * t * by }
  }
  const inside = (t: number) => {
    const p = at(t), dx = p.x - bx, dy = p.y - by
    return Math.abs(dx * cos + dy * sin) <= hw && Math.abs(dy * cos - dx * sin) <= hh
  }
  // Stepped back from the end, which is inside, to the first point that
  // isn't -- the last crossing, even on a curve that grazes a corner first --
  // then the step between them halved down to nothing.
  let hi = 1, lo = 1
  do { hi = lo; lo = Math.max(0, lo - 1 / 32) } while (lo > 0 && inside(lo))
  if (inside(lo)) return null
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (inside(mid)) hi = mid
    else lo = mid
  }
  const t = hi, u = 1 - t
  return { ...at(t), dx: 2 * u * (cx - ax) + 2 * t * (bx - cx), dy: 2 * u * (cy - ay) + 2 * t * (by - cy) }
}

export interface Box { left: number; top: number; right: number; bottom: number }

// Whether a thread between the traces boxed `a` and `b` shows anywhere inside
// `area` -- for area selection, so sweeping across a thread anywhere takes
// it. Only the part that shows counts: under its two traces, where it runs on
// to their centres, it doesn't, or boxing a trace would take every thread
// running out from under it.
// ponytail: sampled at 64 points, so an area thinner than the gap between two
// of them (a long thread's length / 64) can slip through; intersect the curve
// with the area's edges if that ever matters.
export function threadCrosses(a: Box, b: Box, area: Box): boolean {
  const ax = (a.left + a.right) / 2, ay = (a.top + a.bottom) / 2
  const bx = (b.left + b.right) / 2, by = (b.top + b.bottom) / 2
  const c = bend(ax, ay, bx, by)
  const within = (box: Box, x: number, y: number) => x > box.left && x < box.right && y > box.top && y < box.bottom
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, u = 1 - t
    const x = u * u * ax + 2 * u * t * c.x + t * t * bx, y = u * u * ay + 2 * u * t * c.y + t * t * by
    if (within(area, x, y) && !within(a, x, y) && !within(b, x, y)) return true
  }
  return false
}

// An arrowhead with its tip at (tx, ty), pointing away from (fx, fy): three
// points for a filled triangle.
export function arrowhead(tx: number, ty: number, fx: number, fy: number, size: number) {
  const len = Math.hypot(tx - fx, ty - fy) || 1
  const ux = (tx - fx) / len, uy = (ty - fy) / len
  const bx = tx - ux * size, by = ty - uy * size, half = size * 0.5
  return [tx, ty, bx - uy * half, by + ux * half, bx + uy * half, by - ux * half]
}

// The point halfway along the curve, for the label and the delete button.
export function curveMiddle(ax: number, ay: number, cx: number, cy: number, bx: number, by: number) {
  return { x: 0.25 * ax + 0.5 * cx + 0.25 * bx, y: 0.25 * ay + 0.5 * cy + 0.25 * by }
}
