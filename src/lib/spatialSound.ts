// Spatial sound (User Preferences; off unless turned on): a playing video or
// sound trace is heard from where it is. In view, as it is -- centred, at its
// own volume. Out of view, quieter the further off it is, silent a screen
// and a half away, and from the side it's on, all the way over half a screen
// past the edge.
//
// The side needs Web Audio, which plays a file from another site as silence
// unless that site allows it (CORS) and the element asked (crossOrigin). So
// only a source known to allow it is asked (corsReady): the app's own files,
// a vault file through the asset protocol, Supabase's storage, blob: and
// data:. Anything else is still quieter with distance, from the middle.

import { useEffect } from 'react'

export function corsReady(src: string | undefined | null): boolean {
  if (!src) return false
  if (/^(blob|data):/.test(src)) return true
  if (/^(https?:\/\/asset\.localhost|asset:\/\/localhost)\//.test(src)) return true
  if (/\.supabase\.co\/storage\/v1\/object\//.test(src)) return true
  try { return new URL(src, location.href).origin === location.origin } catch { return false }
}

let context: AudioContext | null = null
// Each element taken into Web Audio, once -- an element can't be taken twice,
// nor let go -- with its pan; null for one that can only be made quieter.
const panners = new WeakMap<HTMLMediaElement, StereoPannerNode | null>()
function pannerOf(el: HTMLMediaElement): StereoPannerNode | null {
  if (panners.has(el)) return panners.get(el)!
  let pan: StereoPannerNode | null = null
  if (el.crossOrigin === 'anonymous' || corsReady(el.currentSrc) && /^(blob|data):/.test(el.currentSrc)) {
    try {
      context ??= new AudioContext()
      pan = context.createStereoPanner()
      context.createMediaElementSource(el).connect(pan).connect(context.destination)
    } catch {
      pan = null
    }
  }
  panners.set(el, pan)
  return pan
}

// How it's heard from where it is on screen: its volume (0-1) and side (-1-1).
export function heardAt(cx: number, cy: number, width: number, height: number): { volume: number; pan: number } {
  const outX = cx < 0 ? -cx : cx > width ? cx - width : 0
  const outY = cy < 0 ? -cy : cy > height ? cy - height : 0
  if (!outX && !outY) return { volume: 1, pan: 0 }
  const away = Math.hypot(outX, outY) / Math.max(width, height)
  const volume = Math.max(0, 1 - away / 1.5)
  const pan = outX ? Math.sign(cx - width / 2) * Math.min(1, outX / (width / 2)) : 0
  return { volume, pan }
}

const MEDIA = 'video[id^="video-"], audio[id^="audio-"]'

// While on: every frame, each playing trace's sound set from where it is now.
// Turned off, all of them back as they were.
export function useSpatialSound(on: boolean) {
  useEffect(() => {
    const reset = () => {
      for (const el of document.querySelectorAll<HTMLMediaElement>(MEDIA)) {
        el.volume = 1
        const pan = panners.get(el)
        if (pan) pan.pan.value = 0
      }
    }
    if (!on) { reset(); return }
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick)
      for (const el of document.querySelectorAll<HTMLMediaElement>(MEDIA)) {
        if (el.paused) continue
        const trace = el.closest('[data-trace-id]')
        if (!trace) continue
        const r = trace.getBoundingClientRect()
        const { volume, pan } = heardAt(r.left + r.width / 2, r.top + r.height / 2, innerWidth, innerHeight)
        el.volume = volume
        const panner = pannerOf(el)
        if (panner) {
          if (context?.state === 'suspended') void context.resume()
          panner.pan.setTargetAtTime(pan, panner.context.currentTime, 0.05)
        }
      }
    })
    return () => { cancelAnimationFrame(frame); reset() }
  }, [on])
}
