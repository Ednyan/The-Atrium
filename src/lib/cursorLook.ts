// How cursors are coloured, for your own (TraceOverlay) and everyone else's
// (RemoteCursors).

// A #rrggbb colour as numbers, white for anything else.
export function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 255, g: 255, b: 255 }
}

// A cursor's outline, which is what separates it from the atrium: near-black
// on a light one, white on a dark one.
export function cursorEdgeOn(background: string | undefined) {
  const g = hexToRgb(background || '#0a0a0f')
  return (0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b) / 255 > 0.5 ? '#1a1a1a' : '#ffffff'
}
