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

// Where a line from a box's centre (cx, cy) out toward (qx, qy) crosses the
// edge of the box (half-sizes hw, hh). Where an arrowhead goes: the thread
// runs to the centre, under the trace, so the tip belongs on the border.
export function boxEdge(cx: number, cy: number, hw: number, hh: number, qx: number, qy: number) {
  const dx = qx - cx, dy = qy - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity)
  return t >= 1 ? { x: qx, y: qy } : { x: cx + dx * t, y: cy + dy * t }
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
