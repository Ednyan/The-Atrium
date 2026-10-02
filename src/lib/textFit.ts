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

// Simulates the on-canvas text box's `whitespace-pre-wrap break-words`
// wrapping char-by-char, not just word-by-word: a single word/URL longer
// than the box's own width still has to break-words mid-word in the real
// CSS, so a word-only simulation would report far fewer lines than what
// actually renders (and the box would come out too short).
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
    words.forEach((word, i) => {
      const isLastWord = i === words.length - 1
      const wordWithSpace = isLastWord ? word : `${word} `
      const wordWidth = ctx.measureText(wordWithSpace).width

      if (wordWidth <= availableWidth) {
        if (lineWidth > 0 && lineWidth + wordWidth > availableWidth) {
          linesForParagraph += 1
          lineWidth = wordWidth
        } else {
          lineWidth += wordWidth
        }
        return
      }

      // The word itself doesn't fit on any line -- break it character by
      // character, same as CSS break-words/overflow-wrap would.
      if (lineWidth > 0) {
        linesForParagraph += 1
        lineWidth = 0
      }
      let chunk = ''
      for (const ch of word) {
        const chunkWidth = ctx.measureText(chunk + ch).width
        if (chunkWidth > availableWidth && chunk !== '') {
          linesForParagraph += 1
          chunk = ch
        } else {
          chunk += ch
        }
      }
      lineWidth = ctx.measureText(chunk + (isLastWord ? '' : ' ')).width
    })
    totalLines += linesForParagraph
  }
  return totalLines
}

export interface AutoFitTextOptions {
  fontFamily?: string // CSS font-family value, e.g. 'sans-serif' | 'serif' | 'monospace'
  baseWidth?: number
  baseHeight?: number
}

export function computeAutoFitTextSize(
  content: string,
  fontSizePx: number,
  options: AutoFitTextOptions = {},
): { width: number; height: number } {
  const { fontFamily = 'sans-serif', baseWidth = BASE_TEXT_WIDTH, baseHeight = BASE_TEXT_HEIGHT } = options
  const ctx = getMeasureContext()
  if (!ctx || !content.trim()) {
    return { width: baseWidth, height: baseHeight }
  }

  ctx.font = `${fontSizePx}px ${fontFamily}`
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

// Maps a stored fontFamily value to the actual CSS font-family used to
// render it. Generic keywords (sans/serif/mono) and the new web-safe OS
// fonts get a real fallback stack; everything else (palatino, impact,
// cursive, fantasy, system-ui, and any custom font name) passes through
// unchanged -- those are already valid single-token CSS values on their own.
// One shared function instead of four copies of the same lookup object (one
// per place a font actually gets applied/measured) so adding a font only
// means editing this one map.
export const FONT_FAMILY_CSS_MAP: Record<string, string> = {
  sans: 'sans-serif',
  serif: 'serif',
  mono: 'monospace',
  arial: 'Arial, Helvetica, sans-serif',
  times: "'Times New Roman', Times, serif",
  georgia: "Georgia, 'Times New Roman', serif",
  courier: "'Courier New', Courier, monospace",
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  trebuchet: "'Trebuchet MS', 'Lucida Grande', sans-serif",
  segoe: "'Segoe UI', Tahoma, sans-serif",
  calibri: 'Calibri, Candara, sans-serif',
  consolas: "Consolas, 'Courier New', monospace",
  'century-gothic': "'Century Gothic', 'Apple Gothic', sans-serif",
}

export function resolveFontFamilyCss(key: string): string {
  return FONT_FAMILY_CSS_MAP[key] || key
}

// A text trace's font size in pixels: a number, or one of the names it was
// once kept as.
export function fontPxOf(fontSize: 'small' | 'medium' | 'large' | number | undefined): number {
  return typeof fontSize === 'number' ? fontSize : fontSize === 'small' ? 10 : fontSize === 'large' ? 14 : 12
}

// The box a text trace fits its text in, in its own font and size -- as when a
// font is set on it (Customize, Batch Edit, Paste Style).
export function fittedTextBox(trace: { content?: string | null; fontSize?: 'small' | 'medium' | 'large' | number; fontFamily?: string }): { width: number; height: number } {
  return computeAutoFitTextSize(trace.content ?? '', fontPxOf(trace.fontSize), { fontFamily: resolveFontFamilyCss(trace.fontFamily ?? 'sans') })
}
