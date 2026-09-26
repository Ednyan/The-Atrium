// Flipping a trace mirrors what it shows -- its picture, text, video, shape
// -- and nothing on it: not its type tag, frame or labels, not its handles,
// not its crop. The crop is a window on the flipped picture, so it cuts what
// is seen, where it is seen.

interface Flippable { flipHorizontal?: boolean; flipVertical?: boolean }
interface Croppable extends Flippable { cropX?: number; cropY?: number; cropWidth?: number; cropHeight?: number }

/** A CSS transform mirroring an element within its own box, for transform-origin top left. Empty when unflipped. */
export function flipInBox(t: Flippable): string {
  if (!t.flipHorizontal && !t.flipVertical) return ''
  return `translate(${t.flipHorizontal ? 100 : 0}%, ${t.flipVertical ? 100 : 0}%) scale(${t.flipHorizontal ? -1 : 1}, ${t.flipVertical ? -1 : 1})`
}

/**
 * The crop as a clip-path inset, on content that is then flipped: mirrored
 * with it, so once the content has turned over, the cut lands where the crop
 * is. Undefined when nothing is cropped.
 */
export function cropClip(t: Croppable): string | undefined {
  const x = t.cropX ?? 0, y = t.cropY ?? 0, w = t.cropWidth ?? 1, h = t.cropHeight ?? 1
  if (w >= 1 && h >= 1) return undefined
  let left = x, right = 1 - x - w, top = y, bottom = 1 - y - h
  if (t.flipHorizontal) [left, right] = [right, left]
  if (t.flipVertical) [top, bottom] = [bottom, top]
  return `inset(${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%)`
}
