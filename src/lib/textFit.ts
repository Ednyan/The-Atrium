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

// The lines a text box's `whitespace-pre-wrap break-words` wrapping makes of
// `content` in `availableWidth`, in the font set on `ctx`: word by word, and
// a word longer than a whole line broken character by character, as
// break-words does. Counted to fit a box to its text (below) and drawn by
// the image export (lib/exportImage). A line keeps the space after its last
// word, as the wrapping measures it.
export function wrapLines(ctx: CanvasRenderingContext2D, content: string, availableWidth: number): string[] {
  const width = Math.max(1, availableWidth)
  const lines: string[] = []
  for (const paragraph of content.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    const words = paragraph.split(' ')
    let line = ''
    let lineWidth = 0
    words.forEach((word, i) => {
      const isLastWord = i === words.length - 1
      const wordWithSpace = isLastWord ? word : `${word} `
      const wordWidth = ctx.measureText(wordWithSpace).width
      if (wordWidth <= width) {
        if (lineWidth > 0 && lineWidth + wordWidth > width) {
          lines.push(line)
          line = wordWithSpace
          lineWidth = wordWidth
        } else {
          line += wordWithSpace
          lineWidth += wordWidth
        }
        return
      }
      // The word itself doesn't fit on any line -- broken character by
      // character, as break-words does.
      if (lineWidth > 0) lines.push(line)
      let chunk = ''
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > width && chunk !== '') {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk += ch
        }
      }
      line = chunk + (isLastWord ? '' : ' ')
      lineWidth = ctx.measureText(line).width
    })
    lines.push(line)
  }
  return lines
}

const countWrappedLines = (ctx: CanvasRenderingContext2D, content: string, boxWidth: number) =>
  wrapLines(ctx, content, boxWidth - PADDING * 2).length

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

// The font size, in the box's own units, at which `content` fills a `width` x
// `height` text box as far as it can, Miro's way: one letter in a big box is
// big, a paragraph small enough to fit. The largest size whose wrapped lines
// fit both ways, inside the box's 6px padding, found by halving. Remembered:
// a text is drawn again on every frame of a zoom. An empty box is sized as
// one letter would be, so typing the first one doesn't jump.
const FIT_PADDING = 6
const fitCache = new Map<string, number>()
export function fitFontSize(content: string, width: number, height: number, font: { family: string; bold?: boolean; italic?: boolean }): number {
  const key = [content, Math.round(width), Math.round(height), font.family, font.bold ? 1 : 0, font.italic ? 1 : 0].join('\u0001')
  const known = fitCache.get(key)
  if (known !== undefined) return known
  const ctx = getMeasureContext()
  const innerW = Math.max(1, width - FIT_PADDING * 2), innerH = Math.max(1, height - FIT_PADDING * 2)
  if (!ctx) return Math.max(4, innerH / LINE_HEIGHT_RATIO / 2)
  const text = content.trim() ? content : 'M'
  // Words whole: a size that would break one across lines is too big (a word
  // is broken only where even the smallest size can't fit it).
  const words = text.split(/\s+/).filter(Boolean)
  const fits = (size: number) => {
    ctx.font = `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${size}px ${font.family}`
    if (words.some(word => ctx.measureText(word).width > innerW)) return false
    const lines = wrapLines(ctx, text, innerW)
    if (lines.length * size * LINE_HEIGHT_RATIO > innerH) return false
    return lines.every(line => ctx.measureText(line.trimEnd()).width <= innerW + 0.5)
  }
  let low = 2, high = Math.max(2, innerH / LINE_HEIGHT_RATIO)
  for (let i = 0; i < 16 && high - low > 0.25; i++) {
    const middle = (low + high) / 2
    if (fits(middle)) low = middle
    else high = middle
  }
  if (fitCache.size > 400) fitCache.delete(fitCache.keys().next().value!)
  fitCache.set(key, low)
  return low
}
