// Computes a box size for a text trace that fits its content without
// clipping, by growing the trace's base box size (150x80, see
// TraceOverlay's getTraceSize) proportionally -- same aspect ratio, larger
// scale -- until a canvas-measured word-wrap simulation says the text fits.
// Used both when a text trace is first created and whenever its content is
// edited, so the box never needs a manual resize just to stop clipping.

const BASE_TEXT_WIDTH = 150
const BASE_TEXT_HEIGHT = 80
const PADDING = 12 // matches the on-canvas text box's own padding
const LINE_HEIGHT_RATIO = 1.3 // matches the on-canvas text box's lineHeight
const MAX_SCALE = 6 // cap growth so one huge paste can't create an enormous box
const SCALE_STEP = 0.25

let measureCtx: CanvasRenderingContext2D | null | undefined

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx
  if (typeof document === 'undefined') {
    measureCtx = null
    return measureCtx
  }
  measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

function countWrappedLines(ctx: CanvasRenderingContext2D, content: string, boxWidth: number): number {
  const availableWidth = Math.max(1, boxWidth - PADDING * 2)
  let totalLines = 0
  for (const paragraph of content.split('\n')) {
    if (paragraph === '') {
      totalLines += 1
      continue
    }
    const words = paragraph.split(' ')
    let lineWidth = 0
    let linesForParagraph = 1
    for (const word of words) {
      const wordWidth = ctx.measureText(`${word} `).width
      if (lineWidth > 0 && lineWidth + wordWidth > availableWidth) {
        linesForParagraph += 1
        lineWidth = wordWidth
      } else {
        lineWidth += wordWidth
      }
    }
    totalLines += linesForParagraph
  }
  return totalLines
}

export function computeAutoFitTextSize(
  content: string,
  fontSizePx: number,
  baseWidth = BASE_TEXT_WIDTH,
  baseHeight = BASE_TEXT_HEIGHT,
): { width: number; height: number } {
  const ctx = getMeasureContext()
  if (!ctx || !content.trim()) {
    return { width: baseWidth, height: baseHeight }
  }

  ctx.font = `${fontSizePx}px sans-serif`
  const lineHeight = fontSizePx * LINE_HEIGHT_RATIO

  for (let scale = 1; scale <= MAX_SCALE; scale += SCALE_STEP) {
    const boxWidth = baseWidth * scale
    const boxHeight = baseHeight * scale
    const lines = countWrappedLines(ctx, content, boxWidth)
    const neededHeight = lines * lineHeight + PADDING * 2
    if (neededHeight <= boxHeight) {
      return { width: Math.round(boxWidth), height: Math.round(boxHeight) }
    }
  }

  return { width: Math.round(baseWidth * MAX_SCALE), height: Math.round(baseHeight * MAX_SCALE) }
}
