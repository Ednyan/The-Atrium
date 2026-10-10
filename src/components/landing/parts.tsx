// What the landing page's chapters are built of: the atrium's corner
// brackets, a chapter's label, its headline, and its silent loops.

import { useEffect, useRef, type ReactNode } from 'react'
import { useLandingMotion } from '../../lib/landingMotion'

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
// stands in, still.
export function Clip({ src, poster, still }: { src: string; poster: string; still: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = video.current
    if (!v || still) return
    const watch = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) { v.pause(); return }
      if (!v.getAttribute('src')) v.src = src
      void v.play().catch(() => { /* not allowed to play yet: the picture stays */ })
    }, { rootMargin: '200px 400px' })
    watch.observe(v)
    return () => watch.disconnect()
  }, [src, still])
  return <video ref={video} muted loop playsInline preload="none" poster={poster} aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />
}
