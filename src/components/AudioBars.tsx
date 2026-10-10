// A sound trace's bars: its own shape at rest, and while it plays, an
// equalizer of what's playing -- its frequencies, low to high, each bar's
// peak falling slowly back. Where the sound can't be reached (another site's
// file that doesn't allow it; lib/spatialSound), the bars pulse instead.
//
// Driven straight on the bars each frame, never through React, and only
// while something plays.

import { useEffect, useMemo, useRef, useState } from 'react'
import { analyserOf } from '../lib/spatialSound'

const BARS = 24
// The bands, spaced as hearing is: 50 Hz to 14 kHz.
const LOW = 50, HIGH = 14000

export default function AudioBars({ traceId, playing, color }: { traceId: string; playing: boolean; color?: string }) {
  // Its shape at rest, the same every time for the same trace.
  const rest = useMemo(() => Array.from({ length: BARS }, (_, i) => {
    const hash = traceId.charCodeAt(i % traceId.length) + i * 7
    return 0.18 + (((Math.sin(hash) * 43758.5453) % 1 + 1) % 1) * 0.82
  }), [traceId])
  const bars = useRef<(HTMLDivElement | null)[]>([])
  const peaks = useRef<(HTMLDivElement | null)[]>([])
  const [heard, setHeard] = useState(false)

  useEffect(() => {
    const el = document.getElementById(`audio-${traceId}`) as HTMLAudioElement | null
    const analyser = playing && el ? analyserOf(el) : null
    setHeard(!!analyser)
    if (!analyser) return
    const data = new Uint8Array(analyser.frequencyBinCount)
    const hz = analyser.context.sampleRate / analyser.fftSize
    const edges = Array.from({ length: BARS + 1 }, (_, k) => Math.max(1, Math.round((LOW * (HIGH / LOW) ** (k / BARS)) / hz)))
    const peak = new Float32Array(BARS)
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick)
      analyser.getByteFrequencyData(data)
      for (let k = 0; k < BARS; k++) {
        const from = edges[k], to = Math.max(from + 1, edges[k + 1])
        let sum = 0
        for (let b = from; b < to; b++) sum += data[b]
        const level = 0.05 + 0.95 * Math.min(1, (sum / (to - from) / 255) * 1.15)
        peak[k] = Math.max(level, peak[k] - 0.012)
        const bar = bars.current[k], cap = peaks.current[k]
        if (bar) bar.style.transform = `scaleY(${level})`
        if (cap) cap.style.transform = `translateY(${(1 - peak[k]) * 100}%)`
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, traceId])

  const live = playing && heard
  const fill = playing
    ? `linear-gradient(to top, ${color || '#8f8f8f'}, ${color ? color + '88' : '#cbcbcb'})`
    : 'linear-gradient(to top, rgba(203, 203, 203,0.3), rgba(203, 203, 203,0.1))'
  return (
    <div className="flex items-stretch justify-center gap-[2px] flex-1 w-full max-h-[60%] min-h-[24px]" style={{ contain: 'layout paint' }}>
      {rest.map((h, i) => (
        <div key={i} className="relative flex-1 max-w-[10px]">
          <div
            ref={el => { bars.current[i] = el }}
            className={`absolute inset-x-0 bottom-0 h-full origin-bottom ${live ? 'rounded-[1px]' : 'rounded-full'}`}
            style={{
              // At rest, and pulsing, its own height; live, the frame sets its scale.
              height: live ? '100%' : `${h * 100}%`,
              minHeight: '3px',
              transform: live ? undefined : 'none',
              background: fill,
              transition: 'background 0.3s ease',
              animation: playing && !live ? `audioBarPulse 1.2s ease-in-out ${i * 0.05}s infinite alternate` : undefined,
            }}
          />
          {live && (
            <div ref={el => { peaks.current[i] = el }} className="absolute inset-0 pointer-events-none" style={{ transform: 'translateY(100%)' }}>
              <div className="h-[2px] w-full" style={{ background: color || '#e8e8e8', opacity: 0.9 }} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
