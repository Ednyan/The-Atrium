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
export function dashArray(style: StrokeStyle | null | undefined, width: number): number[] | null {
  if (style === 'dashed') return [Math.max(5, width * 3), Math.max(4, width * 2.5)]
  if (style === 'dotted') return [0, Math.max(3, width * 2.2)]
  return null
}

// The same as SVG attributes: the pattern, and the round cap a dot needs.
export function dashProps(style: StrokeStyle | null | undefined, width: number): { strokeDasharray?: string; strokeLinecap?: 'round' } {
  const dash = dashArray(style, width)
  if (!dash) return {}
  return { strokeDasharray: dash.join(' '), ...(style === 'dotted' ? { strokeLinecap: 'round' as const } : {}) }
}
