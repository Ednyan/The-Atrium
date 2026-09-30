// A drawing stroke painted from what's kept of it (lib/brushes StrokeData),
// at the density it's seen at -- where its picture file is only as sharp as
// the zoom it was drawn at. TraceOverlay shows this instead of the picture
// only when the stroke is seen closer than that, so a view full of strokes
// costs nothing more than it did.
//
// Painted again only when the density it needs crosses a power of two, or the
// stroke itself changes; its size on screen is the box's, as the picture's is.

import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { paintStrokeData, type StrokeData } from '../lib/brushes'

export default function StrokeCanvas({ data, width, height, density, style }: {
  data: StrokeData
  width: number
  height: number
  density: number
  style?: CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Before the frame is shown, so it never appears blank or stale.
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    canvas.width = Math.max(1, Math.round(width * density))
    canvas.height = Math.max(1, Math.round(height * density))
    paintStrokeData(ctx, data, density)
  }, [data, width, height, density])
  return <canvas ref={ref} className="w-full h-full pointer-events-none select-none" style={style} />
}
