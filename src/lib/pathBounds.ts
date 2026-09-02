/**
 * Where a path actually is.
 *
 * Every other trace keeps its extent in x/y/width/height. A path keeps only
 * its points, in world space, and those are what move when one is edited --
 * dragging a point, adding one, extending the line. x/y/width/height stay at
 * whatever they were when the path was created, so anything measuring a path
 * from them is describing the rectangle the path was BORN in, not the one it
 * occupies now.
 *
 * That mistake has been made in three different places, each found separately:
 * the selection box, the group bounds, and the area-select hit test -- which is
 * why the measurement lives here now rather than being written out a fourth
 * time. The hit test was the visible one: dragging a box over a path that had
 * been moved selected nothing, while dragging over the empty space where it was
 * first drawn selected it.
 *
 * Points are world coordinates, the same space as a trace's x/y, so the result
 * can be compared directly against either.
 */
export type PathPoint = { x: number; y: number }

export type PathBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * `outlineWidth` is the stroke's full width; half of it is added on each side,
 * so the box holds the drawn line rather than the centre of it. Callers that
 * need the bare point extent -- anything doing arithmetic against an anchor,
 * where growing the box by half a stroke would move the anchor -- leave it 0.
 */
export function pathWorldBounds(
  points: PathPoint[] | null | undefined,
  outlineWidth = 0,
): PathBounds | null {
  if (!points || points.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  // A point with a NaN coordinate would leave these at their sentinels and
  // hand back a box spanning everything, which as a hit test selects the whole
  // atrium. Say "no box" instead.
  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return null
  }

  const half = outlineWidth / 2
  return {
    minX: minX - half,
    minY: minY - half,
    maxX: maxX + half,
    maxY: maxY + half,
  }
}

/** True when this trace is one whose extent has to be measured, not read. */
export function isPathTrace(trace: {
  type?: string
  shapeType?: string
}): boolean {
  return trace.type === 'shape' && trace.shapeType === 'path'
}
