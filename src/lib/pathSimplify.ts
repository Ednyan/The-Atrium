/**
 * Path simplification using Ramer-Douglas-Peucker algorithm
 * Reduces the number of points in a path while preserving visual shape
 */

interface Point {
  x: number
  y: number
}

/**
 * Calculate perpendicular distance from a point to a line segment
 */
function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y

  if (dx === 0 && dy === 0) {
    // Line segment is a point
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2)
  }

  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy)
  const clampedT = Math.max(0, Math.min(1, t))

  const projX = lineStart.x + clampedT * dx
  const projY = lineStart.y + clampedT * dy

  return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2)
}

/**
 * Ramer-Douglas-Peucker path simplification
 * @param points - Array of points to simplify
 * @param epsilon - Maximum allowed distance deviation (higher = more aggressive simplification)
 * @returns Simplified array of points
 */
export function simplifyPath(points: Point[], epsilon: number = 2.0): Point[] {
  if (points.length <= 2) return points

  // Find the point with maximum distance from the line between first and last
  let maxDist = 0
  let maxIndex = 0

  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last)
    if (dist > maxDist) {
      maxDist = dist
      maxIndex = i
    }
  }

  // If max distance exceeds epsilon, recursively simplify both halves
  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIndex + 1), epsilon)
    const right = simplifyPath(points.slice(maxIndex), epsilon)

    // Combine, removing duplicate middle point
    return [...left.slice(0, -1), ...right]
  }

  // All points are within epsilon — keep only endpoints
  return [first, last]
}

/**
 * Pre-filter: remove points that are very close together (radial distance)
 * This is a fast first pass before RDP to handle high-frequency sampling
 * @param points - Raw input points
 * @param minDistance - Minimum distance between consecutive points
 */
export function radialSimplify(points: Point[], minDistance: number = 1.5): Point[] {
  if (points.length <= 2) return points

  const result: Point[] = [points[0]]
  let prevPoint = points[0]

  for (let i = 1; i < points.length - 1; i++) {
    const dx = points[i].x - prevPoint.x
    const dy = points[i].y - prevPoint.y
    if (dx * dx + dy * dy >= minDistance * minDistance) {
      result.push(points[i])
      prevPoint = points[i]
    }
  }

  // Always include last point
  result.push(points[points.length - 1])
  return result
}

/**
 * Full simplification pipeline: radial filter + RDP
 * Typically reduces 80-90% of points while preserving visual quality
 * @param points - Raw captured points
 * @param epsilon - RDP tolerance (default 2.0 — good balance of quality/compression)
 */
export function simplifyDrawing(points: Point[], epsilon: number = 2.0): Point[] {
  // Step 1: Remove points that are too close together
  const radialFiltered = radialSimplify(points, 1.5)
  // Step 2: Apply RDP simplification
  return simplifyPath(radialFiltered, epsilon)
}
