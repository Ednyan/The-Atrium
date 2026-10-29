// A sound trace's bars: its own shape at rest, and while it plays, an
// equalizer of what's playing -- its frequencies, low to high, each bar's
// peak falling slowly back. Where the sound can't be reached (another site's
// file that doesn't allow it; lib/spatialSound), the bars pulse instead.
//
// Driven straight on the bars each frame, never through React, and only
// while something plays. Paused, they stay as they were -- frozen, not back
// at rest -- and played again, they go on from there: for its first few
// frames (SETTLE), while what's heard catches up from the silence of the
// pause, a bar only rises; after, it falls no faster than FALL.
//
// As many bands as its width has room for, each bar keeping its shape: a
// trace stretched wider hears in finer bands, rather than in the same few
// drawn fatter.

import { useEffect, useMemo, useRef, useState } from 'react'
import { analyserOf } from '../lib/spatialSound'
import { barCount, restHeights } from '../lib/soundBars'
import { hexToRgb } from '../lib/cursorLook'
// The bands, spaced as hearing is: 50 Hz to 14 kHz.
const LOW = 50, HIGH = 14000
// How far a bar may fall in a frame, of its whole height; and for how many
// frames from playing it may not.
const FALL = 0.04, SETTLE = 8

// `color`: the bars' (a sound's own, or its border's); else the theme's ink,
// which reads on a light atrium and a dark one alike -- a fixed light grey
// all but vanished on a light one.
export default function AudioBars({ traceId, playing, color }: { traceId: string; playing: boolean; color?: string }) {
  const ink = color || 'rgb(var(--c-fg))'
  const box = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(24)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const watch = new ResizeObserver(([entry]) => {
      setCount(barCount(entry.contentRect.width))
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  // Its shape at rest, the same every time for the same trace.
  const rest = useMemo(() => restHeights(traceId, count), [traceId, count])
  const bars = useRef<(HTMLDivElement | null)[]>([])
  const peaks = useRef<(HTMLDivElement | null)[]>([])
  // At rest until it first plays; then heard (the frame draws it) or pulsing,
  // and kept so when it pauses. Its bars' heights and peaks, kept with it.
  const [mode, setMode] = useState<'rest' | 'heard' | 'pulse'>('rest')
  const shown = useRef({ level: new Float32Array(0), peak: new Float32Array(0) })

  useEffect(() => {
    if (!playing) return
    const el = document.getElementById(`audio-${traceId}`) as HTMLAudioElement | null
    const analyser = el ? analyserOf(el) : null
    setMode(analyser ? 'heard' : 'pulse')
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    const hz = analyser.context.sampleRate / analyser.fftSize
    const edges = Array.from({ length: count + 1 }, (_, k) => Math.max(1, Math.round((LOW * (HIGH / LOW) ** (k / count)) / hz)))
    if (shown.current.level.length !== count) shown.current = { level: new Float32Array(count), peak: new Float32Array(count) }
    const { level: was, peak } = shown.current
    let frames = 0
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick)
      analyser.getByteFrequencyData(data)
      const fall = ++frames > SETTLE ? FALL : 0
      for (let k = 0; k < count; k++) {
        const from = edges[k], to = Math.max(from + 1, edges[k + 1])
        let sum = 0
        for (let b = from; b < to; b++) sum += data[b]
        was[k] = Math.max(0.05 + 0.95 * Math.min(1, (sum / (to - from) / 255) * 1.15), was[k] - fall)
        peak[k] = Math.max(was[k], peak[k] - 0.012)
        const bar = bars.current[k], cap = peaks.current[k]
        if (bar) bar.style.transform = `scaleY(${was[k]})`
        if (cap) cap.style.transform = `translateY(${(1 - peak[k]) * 100}%)`
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, traceId, count])

  const live = mode === 'heard'
  // The colour fainter, as rgb(... / alpha): a gradient between such colours
  // is drawn in sRGB. Between color-mix()es -- colours of the newer kind --
  // it's drawn in Oklab, which Firefox draws far slower: forty sound traces
  // held a drag to 17fps there, 25 this way.
  const faint = (alpha: number) => {
    if (!color) return `rgb(var(--c-fg) / ${alpha})`
    if (!/^#[\da-f]{6}$/i.test(color)) return `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`
    const { r, g, b } = hexToRgb(color)
    return `rgb(${r} ${g} ${b} / ${alpha})`
  }
  // Played, the colour full; at rest, the same colour fainter -- seen, but quiet.
  const fill = mode !== 'rest'
    ? `linear-gradient(to top, ${ink}, ${faint(0.55)})`
    : `linear-gradient(to top, ${faint(0.45)}, ${faint(0.18)})`
  return (
    <div ref={box} className="flex items-stretch justify-center gap-[2px] flex-1 w-full min-h-[24px]" style={{ contain: 'layout paint' }}>
      {rest.map((h, i) => (
        <div key={i} className="relative flex-1 max-w-[10px]">
          <div
            ref={el => { bars.current[i] = el }}
            className={`absolute inset-x-0 bottom-0 h-full origin-bottom ${live ? 'rounded-[1px]' : 'rounded-full'}`}
            style={{
              // At rest, and pulsing, its own height; heard, the frame sets its
              // scale -- here too, for a bar drawn anew while it's paused.
              height: live ? '100%' : `${h * 100}%`,
              minHeight: '3px',
              transform: live ? `scaleY(${shown.current.level[i] ?? 0.05})` : 'none',
              background: fill,
              transition: 'background 0.3s ease',
              animation: mode === 'pulse' ? `audioBarPulse 1.2s ease-in-out ${i * 0.05}s infinite alternate ${playing ? 'running' : 'paused'}` : undefined,
            }}
          />
          {live && (
            <div ref={el => { peaks.current[i] = el }} className="absolute inset-0 pointer-events-none" style={{ transform: 'translateY(100%)' }}>
              <div className="h-[2px] w-full" style={{ background: ink, opacity: 0.9 }} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
