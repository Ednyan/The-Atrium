// A picture's colour, graded: exposure in stops, on the light, then
// brightness and contrast on what's shown -- the three an EXR's grade has
// (lib/exr gradeExr), for an image, a video, an embed or a document's pages.
// Live, through an SVG filter on the picture (components/LookFilter), never
// into its file; exported, on its pixels (lib/exportImage). Kept as the
// trace's own `look` (traces.look), only once it's been set.

import type { Trace } from '../types/database'

export interface TraceLook { exposure: number; brightness: number; contrast: number }
export const NEUTRAL_LOOK: TraceLook = { exposure: 0, brightness: 0, contrast: 0 }

const clamp = (value: unknown, least: number, most: number) =>
  (typeof value === 'number' && Number.isFinite(value) ? Math.max(least, Math.min(most, value)) : 0)

/** A stored look, read safely: its numbers in range, or none. */
export function asLook(value: unknown): TraceLook | undefined {
  let v = value
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return undefined } }
  if (!v || typeof v !== 'object') return undefined
  const look = v as Record<string, unknown>
  return { exposure: clamp(look.exposure, -6, 6), brightness: clamp(look.brightness, -1, 1), contrast: clamp(look.contrast, -1, 1) }
}

export const isNeutral = (look?: TraceLook) => !look || (look.exposure === 0 && look.brightness === 0 && look.contrast === 0)

/** The traces it's for: pictures of things -- not a drawing, nor an EXR,
 *  which grades its own original (ExrGradePanel). */
export const takesLook = (trace: Trace) =>
  (trace.type === 'image' && !trace.exr && !trace.strokeData) || trace.type === 'video' || trace.type === 'embed' || trace.type === 'document'

/** The grade's two steps: a gain on linear light, then a line on the shown values. */
export function lookSteps(look: TraceLook) {
  const slope = 1 + look.contrast
  return { gain: Math.pow(2, look.exposure), slope, intercept: 0.5 - 0.5 * slope + 0.5 * look.brightness }
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
const toShown = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** The same grade on a picture's pixels (RGBA bytes, in place), as the
 *  filter draws it: a table a channel value, 256 sums rather than one a pixel. */
export function gradePixels(data: Uint8ClampedArray, look: TraceLook) {
  const { gain, slope, intercept } = lookSteps(look)
  const table = new Uint8ClampedArray(256)
  for (let i = 0; i < 256; i++) {
    const lit = toShown(Math.min(1, toLinear(i / 255) * gain))
    table[i] = Math.round(Math.max(0, Math.min(1, lit * slope + intercept)) * 255)
  }
  for (let i = 0; i < data.length; i += 4) {
    data[i] = table[data[i]]
    data[i + 1] = table[data[i + 1]]
    data[i + 2] = table[data[i + 2]]
  }
}
