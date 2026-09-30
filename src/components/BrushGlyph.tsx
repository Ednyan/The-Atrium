// The built-in brushes' names and pictures, for the drawing panel and for a
// stroke's brush changed afterwards (StrokeStyleField).

import type { BuiltinBrush } from '../lib/brushes'

export const BRUSH_LABELS = {
  pen: 'atrium.draw.brushPen',
  pencil: 'atrium.draw.brushPencil',
  marker: 'atrium.draw.brushMarker',
  airbrush: 'atrium.draw.brushAirbrush',
  calligraphy: 'atrium.draw.brushCalligraphy',
} as const satisfies Record<BuiltinBrush, string>

// Each built-in brush as a small picture of the mark it makes.
export default function BrushGlyph({ brush }: { brush: BuiltinBrush }) {
  const wave = 'M2 11 C 6 3, 10 3, 12 7 S 18 11, 22 3'
  return (
    <svg width="24" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
      {brush === 'pen' && <path d={wave} strokeWidth="1.8" />}
      {brush === 'pencil' && <path d={wave} strokeWidth="1.4" strokeDasharray="0.6 1.4" />}
      {brush === 'marker' && <path d={wave} strokeWidth="4" strokeOpacity="0.5" strokeLinecap="butt" />}
      {brush === 'airbrush' && (
        <>
          <circle cx="12" cy="7" r="6" fill="currentColor" fillOpacity="0.15" stroke="none" />
          <circle cx="12" cy="7" r="3.5" fill="currentColor" fillOpacity="0.35" stroke="none" />
          <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
        </>
      )}
      {/* The same wave swept along a 45-degree nib, as the brush does. */}
      {brush === 'calligraphy' && [-1.5, -0.9, -0.3, 0.3, 0.9, 1.5].map(o => (
        <path key={o} d={wave} strokeWidth="0.9" transform={`translate(${o} ${-o})`} />
      ))}
    </svg>
  )
}
