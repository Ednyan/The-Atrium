// A video's or sound's own controls on the canvas: play and pause, where it is
// (a timeline to take it anywhere), and how loud. Drawn over the trace in the
// canvas's own units (TraceOverlay's control layer) -- never stretched with the
// trace -- and dropping the times, then the volume, where it's narrow
// (index.css, .media-bar).
//
// The element is found by its id and listened to rather than driven through
// React: it plays on its own, and only what's shown follows it -- every frame
// while it plays, so the timeline moves smoothly.
//
// Presses stay here: the canvas underneath would take one as the start of
// moving the trace, and a drag along the timeline as dragging it away.

import { useEffect, useState } from 'react'
import type { CSSProperties, SyntheticEvent } from 'react'
import { useTranslation } from '../lib/i18n'
import { listenerVolumeOf, setListenerVolume } from '../lib/spatialSound'
import { useGameStore } from '../store/gameStore'

const stop = (e: SyntheticEvent) => e.stopPropagation()
/** For any control laid over a trace (these, a document's pages): its presses
    kept from the canvas, and the cursor the plain arrow over it -- not the
    trace's four arrows, which say it would be moved. */
export const overTrace = {
  onPointerDown: stop, onMouseDown: stop, onTouchStart: stop, onClick: stop, onDoubleClick: stop,
  onMouseEnter: () => useGameStore.getState().setCursorState('default'),
  onMouseLeave: () => useGameStore.getState().setCursorState('pointer'),
}

// 0:07, 3:45, 1:02:09.
const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

const PLAY = <svg viewBox="0 0 10 10" aria-hidden="true"><polygon points="2.5,1 9,5 2.5,9" fill="currentColor" /></svg>
const PAUSE = <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="1.5" width="2.2" height="7" fill="currentColor" /><rect x="5.8" y="1.5" width="2.2" height="7" fill="currentColor" /></svg>
const speaker = (level: number) => (
  <svg viewBox="0 0 12 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
    <path d="M1 3.5h2l2.5-2v7L3 6.5H1z" fill="currentColor" stroke="none" />
    {level === 0 ? <path d="M8 3.5l3 3M11 3.5l-3 3" /> : <path d="M7.6 3.3a2.4 2.4 0 0 1 0 3.4" />}
    {level > 0.5 && <path d="M9.2 1.8a4.6 4.6 0 0 1 0 6.4" />}
  </svg>
)

export default function MediaControls({ mediaId, playing, overVideo = false }: { mediaId: string; playing: boolean; overVideo?: boolean }) {
  const { t } = useTranslation()
  const [media, setMedia] = useState<HTMLMediaElement | null>(null)
  const [now, setNow] = useState(0)
  const [length, setLength] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const el = document.getElementById(mediaId) as HTMLMediaElement | null
    setMedia(el)
    if (!el) return
    const sync = () => {
      setNow(el.currentTime)
      setLength(Number.isFinite(el.duration) ? el.duration : 0)
      setVolume(listenerVolumeOf(el))
      setMuted(el.muted)
    }
    sync()
    const events = ['timeupdate', 'durationchange', 'loadedmetadata', 'volumechange', 'seeked', 'emptied']
    for (const e of events) el.addEventListener(e, sync)
    return () => { for (const e of events) el.removeEventListener(e, sync) }
  }, [mediaId])

  useEffect(() => {
    if (!playing || !media) return
    let frame = requestAnimationFrame(function tick() {
      setNow(media.currentTime)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, media])

  const heard = muted ? 0 : volume
  const share = (value: number) => ({ '--at': `${Math.max(0, Math.min(1, value)) * 100}%` }) as CSSProperties
  return (
    <div className={`media-bar${overVideo ? ' media-bar-over' : ''}`} data-paused={playing ? undefined : ''} {...overTrace}>
      <button
        type="button"
        className="media-btn"
        aria-label={playing ? t('atrium.controls.pause') : t('atrium.controls.play')}
        onClick={e => { e.stopPropagation(); if (media) { if (media.paused) void media.play(); else media.pause() } }}
      >
        {playing ? PAUSE : PLAY}
      </button>
      <span className="media-time">{clock(now)}</span>
      <input
        type="range"
        className="media-range media-timeline"
        aria-label={t('atrium.controls.timeline')}
        min={0}
        max={length || 1}
        step="any"
        value={Math.min(now, length || 1)}
        disabled={!length}
        style={share(length ? now / length : 0)}
        onChange={e => { if (media) { media.currentTime = Number(e.target.value); setNow(media.currentTime) } }}
      />
      <span className="media-time">{clock(length)}</span>
      <button
        type="button"
        className="media-btn"
        aria-label={muted ? t('atrium.controls.unmute') : t('atrium.controls.mute')}
        onClick={e => { e.stopPropagation(); if (media) media.muted = !media.muted }}
      >
        {speaker(heard)}
      </button>
      <input
        type="range"
        className="media-range media-volume"
        aria-label={t('atrium.controls.volume')}
        min={0}
        max={1}
        step={0.01}
        value={heard}
        style={share(heard)}
        onChange={e => {
          if (!media) return
          const level = Number(e.target.value)
          setListenerVolume(media, level)
          media.muted = level === 0
        }}
      />
    </div>
  )
}
