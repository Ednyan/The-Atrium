// A line's style, as Excalidraw has it: solid, dashed or dotted -- for a
// trace's border, a shape's outline, a path and a connection alike. Kept as
// stroke_style on traces and trace_links (add_stroke_style.sql); none is
// solid, so a trace that never chose one sends nothing and saves as before.

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'
export const STROKE_STYLES: readonly StrokeStyle[] = ['solid', 'dashed', 'dotted']

export const asStrokeStyle = (value: unknown): StrokeStyle | undefined =>
  (STROKE_STYLES as readonly unknown[]).includes(value) ? value as StrokeStyle : undefined

// Its dash pattern for a line `width` wide, or null for solid: dashes a few
// widths long, and dots -- zero-length dashes, made round by a round cap --
// a couple of widths apart. Never so fine a thin line's pattern is a blur.
// The width is the line's own, in the atrium (world units), and the pattern
// is in those units times `zoom`: on screen it grows and shrinks with
// everything else, so a line shows the same dashes at any zoom.
export function dashArray(style: StrokeStyle | null | undefined, width: number, zoom = 1): number[] | null {
  if (style === 'dashed') return [Math.max(5, width * 3) * zoom, Math.max(4, width * 2.5) * zoom]
  if (style === 'dotted') return [0, Math.max(3, width * 2.2) * zoom]
  return null
}

// The same as SVG attributes: the pattern, and the round cap a dot needs.
export function dashProps(style: StrokeStyle | null | undefined, width: number, zoom = 1): { strokeDasharray?: string; strokeLinecap?: 'round' } {
  const dash = dashArray(style, width, zoom)
  if (!dash) return {}
  return { strokeDasharray: dash.join(' '), ...(style === 'dotted' ? { strokeLinecap: 'round' as const } : {}) }
}

// A box's dashed or dotted border, as a CSS background picture of its
// outline, for an element whose own border is kept but transparent: CSS
// draws its own dashes, sized by whole device pixels, so they'd change as
// the zoom does and not match the lines around them. `w` and `h` are the
// box's outer size on screen, `radius` its corners'; `width` as above.
export function dashedBorderImage(style: StrokeStyle | null | undefined, colour: string, w: number, h: number, radius: number, width: number, zoom: number): string | undefined {
  const dash = dashArray(style, width, zoom)
  if (!dash) return undefined
  const line = width * zoom, half = line / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`
    + `<rect x="${half}" y="${half}" width="${Math.max(0, w - line)}" height="${Math.max(0, h - line)}" rx="${Math.max(0, radius - half)}"`
    + ` fill="none" stroke="${colour}" stroke-width="${line}" stroke-dasharray="${dash.join(' ')}"${style === 'dotted' ? ' stroke-linecap="round"' : ''}/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
