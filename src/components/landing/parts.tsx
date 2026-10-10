// What the landing page's chapters are built of: the atrium's corner
// brackets, a chapter's label, its headline, and its silent loops.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useLandingMotion } from '../../lib/landingMotion'
import { useTranslation } from '../../lib/i18n'

// Corner brackets, the atrium's own framing for anything set apart.
export function Brackets({ inset = '-0.5rem' }: { inset?: string }) {
  const corner = 'absolute w-6 h-6 border-nier-border/60 pointer-events-none'
  return (
    <>
      <span aria-hidden="true" className={`${corner} border-l border-t`} style={{ top: inset, left: inset }} />
      <span aria-hidden="true" className={`${corner} border-r border-t`} style={{ top: inset, right: inset }} />
      <span aria-hidden="true" className={`${corner} border-l border-b`} style={{ bottom: inset, left: inset }} />
      <span aria-hidden="true" className={`${corner} border-r border-b`} style={{ bottom: inset, right: inset }} />
    </>
  )
}

// A chapter's label: its number, a diamond the light fills as it comes into
// view, its name -- decoded the way NieR's screens write themselves,
// scrambled with its own letters so a Japanese name stays Japanese and the
// width it will have -- and a rule drawn out from it.
export function ChapterLabel({ index, children, className = '' }: { index: number; children: string; className?: string }) {
  const motion = useLandingMotion()
  const textRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = textRef.current
    if (!motion || !el) return
    const { gsap } = motion
    const ctx = gsap.context(() => {
      gsap.to(el, {
        duration: 1.1, ease: 'none',
        scrambleText: { text: children, chars: children.replace(/\s/g, ''), revealDelay: 0.25, speed: 0.5 },
        scrollTrigger: { trigger: el, start: 'top 92%', once: true },
      })
    })
    return () => ctx.revert()
  }, [motion, children])
  return (
    <div className={`flex items-center gap-4 text-xs md:text-sm tracking-[0.3em] uppercase ${className}`}>
      <span aria-hidden="true" className="tabular-nums text-nier-bg/55">{String(index).padStart(2, '0')}</span>
      <span aria-hidden="true" className="lit-diamond w-2.5 h-2.5 rotate-45 shrink-0" />
      {/* Named by its label, so nothing reads the scramble out. Keyed by its
          text: the scramble rewrites the text React put there. */}
      <h2 aria-label={children} className="text-nier-strong whitespace-nowrap">
        <span key={children} ref={textRef} aria-hidden="true">{children}</span>
      </h2>
      <span aria-hidden="true" className="lit-rule h-px flex-1 max-w-[16rem]" />
    </div>
  )
}

// A chapter's headline: big, and risen into view a word at a time from behind
// a mask as it's scrolled to (.headline-word, LandingPage's styles).
export function Headline({ children, as: Tag = 'p', className = '' }: { children: string; as?: 'p' | 'h3'; className?: string }) {
  const words = children.split(/(\s+)/)
  let n = 0
  return (
    <Tag className={`headline ${className}`}>
      {words.map((word, i) => /^\s+$/.test(word) ? word : (
        <span key={i} className="headline-mask"><span className="headline-word" style={{ transitionDelay: `${(n++) * 55}ms` }}>{word}</span></span>
      ))}
    </Tag>
  )
}

export const Lead = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <p className={`text-nier-bg/80 text-lg md:text-xl font-light leading-relaxed text-pretty ${className}`}>{children}</p>
)

// A silent loop (a tool at work, the teaser): fetched and played only while
// it's on screen or about to be, paused off it. With less motion, its poster
// stands in, still. With `controls` (the teaser): a pause, and a timeline to
// click or drag along -- which also lets anyone who asked for less motion
// play it after all. Paused by hand, it stays paused coming back into view.
export function Clip({ src, poster, still, controls = false }: { src: string; poster: string; still: boolean; controls?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const held = useRef(false)
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    const v = video.current
    if (!v || still) return
    const watch = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { v.pause(); return }
      if (held.current) return
      if (!v.getAttribute('src')) v.src = src
      void v.play().catch(() => { /* not allowed to play yet: the picture stays */ })
    }, { rootMargin: '200px 400px' })
    watch.observe(v)
    return () => watch.disconnect()
  }, [src, still])
  return (
    <>
      <video
        ref={video}
        muted
        loop
        playsInline
        preload="none"
        poster={poster}
        aria-hidden="true"
        className="absolute inset-0 w-full h-full object-cover"
        onPlay={controls ? () => setPlaying(true) : undefined}
        onPause={controls ? () => setPlaying(false) : undefined}
      />
      {controls && <ClipControls video={video} src={src} playing={playing} held={held} />}
    </>
  )
}

// The teaser's controls: play or pause, and where it is -- a native range,
// so a click anywhere along it jumps there, a drag scrubs, and the keys work.
function ClipControls({ video, src, playing, held }: { video: RefObject<HTMLVideoElement>; src: string; playing: boolean; held: { current: boolean } }) {
  const { t } = useTranslation()
  const bar = useRef<HTMLInputElement>(null)
  // Following the film while it plays.
  useEffect(() => {
    const v = video.current
    if (!playing || !v) return
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick)
      showAt(bar.current, v)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, video])
  const load = (v: HTMLVideoElement) => { if (!v.getAttribute('src')) v.src = src }
  const toggle = () => {
    const v = video.current
    if (!v) return
    held.current = !v.paused
    if (v.paused) { load(v); void v.play().catch(() => {}) } else v.pause()
  }
  const seek = (percent: number) => {
    const v = video.current
    if (!v) return
    load(v)
    const go = () => { v.currentTime = (percent / 100) * v.duration; showAt(bar.current, v) }
    if (v.duration) go()
    else v.addEventListener('loadedmetadata', go, { once: true })
  }
  return (
    <div className="clip-controls absolute inset-x-0 bottom-0 flex items-center gap-3 px-3 sm:px-4 pb-3 pt-10" data-playing={playing ? '' : undefined}>
      <button type="button" onClick={toggle} aria-label={playing ? t('atrium.controls.pause') : t('atrium.controls.play')} className="clip-toggle shrink-0">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
          {playing ? <><rect x="1.5" y="1" width="2.5" height="8" /><rect x="6" y="1" width="2.5" height="8" /></> : <polygon points="2,0.5 9.5,5 2,9.5" />}
        </svg>
      </button>
      <input
        ref={bar}
        type="range"
        min={0}
        max={100}
        step="any"
        defaultValue={0}
        aria-label={t('landing.film.timeline')}
        onInput={e => seek(Number(e.currentTarget.value))}
        className="clip-timeline flex-1 min-w-0"
      />
    </div>
  )
}
// Where the film is, on its timeline: the thumb, and the line lit up to it.
function showAt(bar: HTMLInputElement | null, v: HTMLVideoElement) {
  const at = v.duration ? (v.currentTime / v.duration) * 100 : 0
  if (!bar) return
  bar.value = String(at)
  bar.style.setProperty('--at', `${at}%`)
}
