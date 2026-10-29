// A sound trace's bars at rest -- how many its width has room for, and each
// one's height, the same every time for the same trace: drawn on the canvas
// (components/AudioBars) and in a picture of the atrium (lib/exportImage).

// A bar and its gap, in the canvas's units; and the fewest and most bands.
export const BAR_PITCH = 9
const FEWEST = 12, MOST = 96

export const barCount = (width: number) => Math.max(FEWEST, Math.min(MOST, Math.floor((width + 2) / BAR_PITCH)))

/** Each bar's height at rest, as a share of the bars' room. */
export const restHeights = (traceId: string, count: number) => Array.from({ length: count }, (_, i) => {
  const hash = traceId.charCodeAt(i % traceId.length) + i * 7
  return 0.18 + (((Math.sin(hash) * 43758.5453) % 1 + 1) % 1) * 0.82
})
