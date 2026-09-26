// Cropping, as fractions of a trace's whole content box: the window kept is
// x..x+w across and y..y+h down, measured on the content as it is seen
// (flipped, if it is -- see traceFlip). Kept free of the app's imports, so
// it can be tested on its own.
//
// A trace sits centred on its window, so cropping moves where it sits: the
// window's centre moves by cropShift, in the trace's own (turned) axes, and
// whatever edge wasn't dragged stays exactly where it was on screen.

export interface Crop { x: number; y: number; w: number; h: number }

export const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 }
// The smallest window, a share of the box each way.
export const MIN_CROP = 0.05

export function cropOf(t: { cropX?: number; cropY?: number; cropWidth?: number; cropHeight?: number }): Crop {
  return { x: t.cropX ?? 0, y: t.cropY ?? 0, w: t.cropWidth ?? 1, h: t.cropHeight ?? 1 }
}

/**
 * The window after dragging a handle by (du, dv), as shares of the box, in
 * the trace's own axes. `handle` names the edges it moves -- 'l', 'r', 't',
 * 'b', a corner such as 'tl' -- or 'm' for the whole window, slid across the
 * content. Each edge stops at the box and short of its opposite.
 */
export function dragCrop(start: Crop, handle: string, du: number, dv: number): Crop {
  let l = start.x, r = start.x + start.w, t = start.y, b = start.y + start.h
  if (handle === 'm') {
    const su = Math.max(-l, Math.min(1 - r, du)), sv = Math.max(-t, Math.min(1 - b, dv))
    return { x: l + su, y: t + sv, w: start.w, h: start.h }
  }
  if (handle.includes('l')) l = Math.max(0, Math.min(r - MIN_CROP, l + du))
  if (handle.includes('r')) r = Math.min(1, Math.max(l + MIN_CROP, r + du))
  if (handle.includes('t')) t = Math.max(0, Math.min(b - MIN_CROP, t + dv))
  if (handle.includes('b')) b = Math.min(1, Math.max(t + MIN_CROP, b + dv))
  return { x: l, y: t, w: r - l, h: b - t }
}

/** How far the window's centre moved from one crop to another, as shares of the box. */
export function cropShift(from: Crop, to: Crop) {
  return { u: to.x + to.w / 2 - (from.x + from.w / 2), v: to.y + to.h / 2 - (from.y + from.h / 2) }
}

/**
 * From the window's centre to the whole box's, in the box's own units
 * (multiply by its size): where the uncropped content sits while cropping.
 */
export function boxFromWindow(c: Crop) {
  return { u: 0.5 - (c.x + c.w / 2), v: 0.5 - (c.y + c.h / 2) }
}

/** A vector in a trace's own axes, turned by its rotation (degrees) into the world's. */
export function turn(u: number, v: number, degrees: number) {
  const r = (degrees * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r)
  return { x: u * cos - v * sin, y: u * sin + v * cos }
}
