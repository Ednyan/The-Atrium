// Placement for multiple traces dropped/pasted at once. Previously each item
// in a batch was offset by a fixed (i*30, i*30) diagonal from the drop point,
// which produces a predictable cascade with a lot of overlap once more than
// a couple of items land at once. This packs variable-sized boxes into rows
// (a "shelf" bin-packing strategy: place left-to-right, wrap to a new row
// once the running width would exceed maxRowWidth, each row's height set by
// its tallest box) for a tighter, more organic, less repetitive layout.

export interface PackBox {
  width: number
  height: number
}

export interface PackedOffset {
  x: number
  y: number
}

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

// Packs boxes into rows and returns each box's CENTER offset relative to the
// center of the overall packed layout -- the caller adds these to a single
// anchor point (e.g. a drop/paste world position) to get final coordinates.
export function packBoxesAroundCenter(boxes: PackBox[], gap = 24, maxRowWidth = 900): PackedOffset[] {
  if (boxes.length === 0) return []

  const topLeft: PackedOffset[] = []
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0
  let maxWidthUsed = 0

  boxes.forEach((box) => {
    if (cursorX > 0 && cursorX + box.width > maxRowWidth) {
      cursorY += rowHeight + gap
      cursorX = 0
      rowHeight = 0
    }
    topLeft.push({ x: cursorX, y: cursorY })
    cursorX += box.width + gap
    rowHeight = Math.max(rowHeight, box.height)
    maxWidthUsed = Math.max(maxWidthUsed, cursorX - gap)
  })

  const totalWidth = maxWidthUsed
  const totalHeight = cursorY + rowHeight

  return boxes.map((box, i) => ({
    x: topLeft[i].x + box.width / 2 - totalWidth / 2,
    y: topLeft[i].y + box.height / 2 - totalHeight / 2,
  }))
}
