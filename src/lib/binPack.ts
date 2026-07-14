// Placement for multiple traces dropped/pasted at once. Originally each item
// in a batch was offset by a fixed (i*30, i*30) diagonal from the drop point
// (predictable cascade, heavy overlap past a couple of items), then replaced
// with fixed-width shelf rows (uniform grid, and could end up taller than
// wide for a handful of items since row width didn't relate to item count).
// Two packers are available now, both tallest/largest-first ("anchor" pieces
// settle first, smaller ones nestle into the gaps around them) and both
// centered on the batch's own bounding box rather than an arbitrary origin:
//
// - 'square': a skyline/best-fit packer. Keeps a running profile of the
//   tallest point at each x position and places each box wherever it lands
//   lowest, so a short box tucks in beside a tall one rather than every row
//   being flattened to its tallest item -- an irregular, interlocking
//   "puzzle piece" silhouette instead of uniform grid lines. Target width is
//   derived from the batch's total area (aiming for width ~= height).
// - 'circle': a golden-angle spiral packer (the same placement pattern as
//   sunflower seed heads/phyllotaxis). Walks outward from the center along
//   the spiral and drops each box at the first position that doesn't
//   overlap anything already placed, producing an organic circular cluster.

export interface PackBox {
  width: number
  height: number
}

export interface PackedOffset {
  x: number
  y: number
}

export type PackShape = 'square' | 'circle'

type TraceKindForSizing = 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | string

// Matches getTraceSize's image case: the longest edge is capped at 300
// world units, scaled down proportionally, once a real image is detected.
// Real probed dimensions (e.g. a 4000x3000 photo) must be run through this
// before packing -- packing at raw pixel dimensions lays boxes out many
// times larger than the trace will ever actually render at, which is what
// made a packed batch look sparse/far apart once on the canvas.
const IMAGE_DISPLAY_MAX_EDGE = 300

export function scaleToDisplayBox(box: PackBox, maxEdge = IMAGE_DISPLAY_MAX_EDGE): PackBox {
  const longest = Math.max(box.width, box.height)
  const scale = longest > maxEdge ? maxEdge / longest : 1
  return { width: Math.round(box.width * scale), height: Math.round(box.height * scale) }
}

// Mirrors TraceOverlay's getTraceSize default (pre-aspect-ratio-detection)
// dimensions, so a freshly-placed batch is packed against roughly the same
// footprint each trace will actually render at.
export function getDefaultTraceBoxSize(type: TraceKindForSizing): PackBox {
  switch (type) {
    case 'text':
      return { width: 150, height: 80 }
    case 'image':
      return { width: 200, height: 200 }
    case 'audio':
      return { width: 120, height: 100 }
    case 'video':
      return { width: 200, height: 150 }
    case 'embed':
      return { width: 300, height: 169 }
    default:
      return { width: 120, height: 80 }
  }
}

// ---- 'square' packer: skyline/best-fit ----

interface SkylineSegment {
  x: number
  width: number
  height: number
}

function heightAcross(skyline: SkylineSegment[], start: number, end: number): number {
  let maxH = 0
  for (const seg of skyline) {
    if (seg.x < end && seg.x + seg.width > start) {
      maxH = Math.max(maxH, seg.height)
    }
  }
  return maxH
}

function addToSkyline(skyline: SkylineSegment[], start: number, width: number, height: number): SkylineSegment[] {
  const end = start + width
  const next: SkylineSegment[] = []
  for (const seg of skyline) {
    const segEnd = seg.x + seg.width
    if (segEnd <= start || seg.x >= end) {
      next.push(seg)
      continue
    }
    if (seg.x < start) next.push({ x: seg.x, width: start - seg.x, height: seg.height })
    if (segEnd > end) next.push({ x: end, width: segEnd - end, height: seg.height })
  }
  next.push({ x: start, width, height })
  next.sort((a, b) => a.x - b.x)
  return next
}

function packSquare(boxes: PackBox[], gap: number): PackedOffset[] {
  const totalArea = boxes.reduce((sum, b) => sum + (b.width + gap) * (b.height + gap), 0)
  const widestBox = Math.max(...boxes.map(b => b.width)) + gap
  // Square-ish target width from total area, floored at the single widest
  // box so there's always room to place at least one item per pass.
  const targetWidth = Math.max(Math.sqrt(totalArea) * 1.05, widestBox)

  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b].height - boxes[a].height)
  let skyline: SkylineSegment[] = [{ x: 0, width: targetWidth, height: 0 }]
  const topLeft: PackedOffset[] = new Array(boxes.length)

  for (const i of order) {
    const box = boxes[i]
    const spanWidth = box.width + gap

    // targetWidth is a soft cap, not a hard one: prefer the lowest position
    // that stays within it, and only spill past it (tracked separately) if
    // nothing fits within bounds. Without this preference the skyline
    // happily wanders past targetWidth toward any 0-height gap it can see,
    // which made the packed result skew wider with every added item.
    let bestX = 0
    let bestY = Infinity
    let bestXOverflow = 0
    let bestYOverflow = Infinity
    for (const x of new Set(skyline.map(s => s.x))) {
      const y = heightAcross(skyline, x, x + spanWidth)
      if (x + spanWidth <= targetWidth) {
        if (y < bestY - 0.01 || (Math.abs(y - bestY) < 0.01 && x < bestX)) {
          bestY = y
          bestX = x
        }
      } else if (y < bestYOverflow - 0.01 || (Math.abs(y - bestYOverflow) < 0.01 && x < bestXOverflow)) {
        bestYOverflow = y
        bestXOverflow = x
      }
    }

    const useWithinBounds = bestY !== Infinity
    const x = useWithinBounds ? bestX : bestXOverflow
    const y = useWithinBounds ? bestY : bestYOverflow

    topLeft[i] = { x, y }
    skyline = addToSkyline(skyline, x, spanWidth, y + box.height + gap)
  }

  return boxes.map((box, i) => ({
    x: topLeft[i].x + box.width / 2,
    y: topLeft[i].y + box.height / 2,
  }))
}

// ---- 'circle' packer: golden-angle spiral ----

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)) // ~137.5 degrees
const CIRCLE_RADIUS_STEP = 10
const CIRCLE_MAX_STEPS_PER_ITEM = 2000

function packCircle(boxes: PackBox[], gap: number): PackedOffset[] {
  const order = boxes.map((_, i) => i).sort((a, b) => (boxes[b].width * boxes[b].height) - (boxes[a].width * boxes[a].height))
  const placed: { index: number; x: number; y: number }[] = []

  const overlapsAnyPlaced = (x: number, y: number, box: PackBox) => {
    for (const p of placed) {
      const other = boxes[p.index]
      const dx = Math.abs(x - p.x)
      const dy = Math.abs(y - p.y)
      const minDx = (box.width + other.width) / 2 + gap
      const minDy = (box.height + other.height) / 2 + gap
      if (dx < minDx && dy < minDy) return true
    }
    return false
  }

  const maxSteps = Math.max(CIRCLE_MAX_STEPS_PER_ITEM, boxes.length * CIRCLE_MAX_STEPS_PER_ITEM)

  for (const i of order) {
    const box = boxes[i]
    if (placed.length === 0) {
      placed.push({ index: i, x: 0, y: 0 })
      continue
    }
    let step = 1
    let x = 0
    let y = 0
    while (step <= maxSteps) {
      const angle = step * GOLDEN_ANGLE
      const radius = CIRCLE_RADIUS_STEP * Math.sqrt(step)
      x = radius * Math.cos(angle)
      y = radius * Math.sin(angle)
      if (!overlapsAnyPlaced(x, y, box)) break
      step++
    }
    placed.push({ index: i, x, y })
  }

  const result: PackedOffset[] = new Array(boxes.length)
  for (const p of placed) result[p.index] = { x: p.x, y: p.y }
  return result
}

// Packs boxes and returns each box's CENTER offset relative to the center of
// the overall packed layout's bounding box -- the caller adds these to a
// single anchor point (e.g. a drop/paste world position) to get final
// coordinates.
export function packBoxesAroundCenter(boxes: PackBox[], gap = 24, shape: PackShape = 'square'): PackedOffset[] {
  if (boxes.length === 0) return []
  if (boxes.length === 1) return [{ x: 0, y: 0 }]

  const centers = shape === 'circle' ? packCircle(boxes, gap) : packSquare(boxes, gap)

  const lefts = boxes.map((b, i) => centers[i].x - b.width / 2)
  const rights = boxes.map((b, i) => centers[i].x + b.width / 2)
  const tops = boxes.map((b, i) => centers[i].y - b.height / 2)
  const bottoms = boxes.map((b, i) => centers[i].y + b.height / 2)
  const midX = (Math.min(...lefts) + Math.max(...rights)) / 2
  const midY = (Math.min(...tops) + Math.max(...bottoms)) / 2

  return centers.map(c => ({ x: c.x - midX, y: c.y - midY }))
}
