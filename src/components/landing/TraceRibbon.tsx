// What can be brought in: every kind of trace as a card of glass on a ring
// seen from in front -- monotone until it turns to face you. Turned by
// dragging, the arrows, or the keys; drifting a little as the page scrolls
// past. Chosen, a card comes to the front and turns over to say more.
//
// Real buttons and text throughout, in a 3D arrangement of CSS rather than a
// canvas, so it reads sharply and works with a keyboard and a screen reader.

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import type { TranslationKey } from '../../locales/en'
import { useLandingMotion } from '../../lib/landingMotion'
import { ChapterLabel, Headline } from './parts'

// In the order they sit around the ring; it opens on the pictures, in the middle.
const CARDS = ['sound', 'documents', 'video', 'pictures', 'notes', 'drawings', 'sheets', 'links'] as const
const FIRST = CARDS.indexOf('pictures')
type CardId = typeof CARDS[number]
// Photographed in the app (public/landing/close-*).
const PHOTOGRAPHED: CardId[] = ['pictures', 'notes', 'sheets', 'drawings']
// Degrees between one card and the next around the ring.
const STEP = 32

const TraceRibbon = forwardRef<HTMLElement, { index: number; shot: 'light' | 'dark'; still: boolean }>(function TraceRibbon({ index, shot, still }, ref) {
  const { t } = useTranslation()
  const motion = useLandingMotion()
  const section = useRef<HTMLElement | null>(null)
  const cards = useRef<(HTMLButtonElement | null)[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [front, setFront] = useState(FIRST)

  // Where the ring is: `target` where it's going, `shown` where it's drawn,
  // `drift` what the scroll adds -- held still while a card is open.
  const state = useRef({ target: FIRST, shown: FIRST, drift: 0, frame: 0 })
  const draw = useCallback(() => {
    const s = state.current
    const at = s.shown + s.drift
    cards.current.forEach((card, i) => {
      if (!card) return
      const angle = (i - at) * STEP
      const away = Math.min(1, Math.abs(angle) / 100)
      card.style.transform = `translate(-50%, -50%) rotateY(${angle}deg) translateZ(var(--ribbon-radius)) ${i === open ? 'translateZ(60px) scale(1.06)' : ''}`
      card.style.opacity = String(Math.abs(angle) > 110 ? 0 : 1 - away * 0.55)
      card.style.setProperty('--colour', String(Math.max(0, 1 - Math.abs(angle) / 22)))
      card.style.zIndex = String(100 - Math.round(Math.abs(angle)))
      card.style.visibility = Math.abs(angle) > 120 ? 'hidden' : 'visible'
    })
    const nearest = Math.max(0, Math.min(CARDS.length - 1, Math.round(at)))
    setFront(f => (f === nearest ? f : nearest))
  }, [open])

  // Eased toward the target, a frame at a time, until it's there.
  const settle = useCallback(() => {
    const s = state.current
    if (s.frame) return
    const step = () => {
      const gap = s.target - s.shown
      s.shown = still || Math.abs(gap) < 0.001 ? s.target : s.shown + gap * 0.14
      draw()
      s.frame = s.shown === s.target ? 0 : requestAnimationFrame(step)
    }
    s.frame = requestAnimationFrame(step)
  }, [draw, still])
  useEffect(() => { draw() }, [draw])
  useEffect(() => () => cancelAnimationFrame(state.current.frame), [])

  const goTo = useCallback((i: number) => {
    state.current.target = Math.max(0, Math.min(CARDS.length - 1, i)) - state.current.drift
    settle()
  }, [settle])

  // The scroll's drift: a card and a half either way as the chapter passes.
  useEffect(() => {
    const el = section.current
    if (!motion || still || !el) return
    const { ScrollTrigger } = motion
    const trigger = ScrollTrigger.create({
      trigger: el, start: 'top bottom', end: 'bottom top',
      onUpdate: self => {
        if (open !== null) return
        state.current.drift = (self.progress - 0.5) * 3
        draw()
      },
    })
    return () => trigger.kill()
  }, [motion, still, open, draw])

  // Dragged: the ring follows the pointer, and settles on the nearest card.
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null)
  // A drag that ends over a card still clicks it: not a choice.
  const dragged = useRef(false)
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, from: state.current.target, moved: false }
    dragged.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 6) return
    if (!d.moved) { d.moved = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setOpen(null) }
    state.current.target = d.from - dx / 240
    settle()
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    dragged.current = true
    goTo(Math.round(state.current.target + state.current.drift))
  }

  const choose = (i: number) => {
    if (dragged.current) { dragged.current = false; return }
    if (open === i) { setOpen(null); return }
    goTo(i)
    setOpen(i)
  }
  // Arrows take the focus along to the next card, which brings it round
  // (its onFocus), so Enter turns over the card in front.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (step) {
      e.preventDefault()
      setOpen(null)
      cards.current[Math.max(0, Math.min(CARDS.length - 1, front + step))]?.focus({ preventScroll: true })
    } else if (e.key === 'Escape') setOpen(null)
  }

  return (
    <section ref={el => { section.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el }} className="relative px-5 sm:px-10 lg:px-16 py-20 md:py-28 overflow-hidden">
      <div className="max-w-[1300px] mx-auto">
        <ChapterLabel index={index}>{t('landing.traces.title')}</ChapterLabel>
        <div className="mt-8 grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-6 items-end" data-reveal>
          <Headline className="text-[clamp(2.4rem,5.6vw,5.2rem)] font-extralight leading-[0.98] tracking-[-0.01em] text-nier-strong">{t('landing.traces.lead')}</Headline>
          <p className="text-sm tracking-[0.12em] uppercase text-nier-bg/60 lg:text-right">{t('landing.traces.hint')}</p>
        </div>
      </div>

      <div
        className="ribbon-stage relative mx-auto mt-6 select-none touch-pan-y"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className="ribbon-ring absolute inset-0">
          {CARDS.map((id, i) => (
            <button
              key={id}
              ref={el => { cards.current[i] = el }}
              type="button"
              className={`ribbon-card ${open === i ? 'is-open' : ''}`}
              aria-expanded={open === i}
              aria-label={t(`landing.traces.${id}` as TranslationKey)}
              onClick={() => choose(i)}
              onFocus={() => { if (open !== i) goTo(i) }}
            >
              <span className="ribbon-card-inner">
                <span className="ribbon-face ribbon-front">
                  <span className="ribbon-visual"><Visual id={id} shot={shot} still={still} /></span>
                  <span className="ribbon-caption">
                    <span className="tabular-nums text-nier-bg/60">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-nier-strong">{t(`landing.traces.${id}` as TranslationKey)}</span>
                  </span>
                </span>
                <span className="ribbon-face ribbon-back" aria-hidden={open !== i}>
                  <span className="text-[10px] tracking-[0.3em] uppercase text-nier-bg/55 tabular-nums">{String(i + 1).padStart(2, '0')} / {String(CARDS.length).padStart(2, '0')}</span>
                  <span className="block mt-3 text-xl tracking-[0.06em] uppercase text-nier-strong">{t(`landing.traces.${id}` as TranslationKey)}</span>
                  <span className="block mt-4 text-sm leading-relaxed text-nier-bg/85 normal-case tracking-normal">{t(`landing.traces.${id}Desc` as TranslationKey)}</span>
                  <span className="block mt-5 space-y-2.5">
                    {[1, 2].map(n => (
                      <span key={n} className="flex gap-3 text-[13px] leading-snug text-nier-bg/75 normal-case tracking-normal">
                        <span aria-hidden="true" className="mt-1.5 w-1.5 h-1.5 rotate-45 shrink-0 landing-lit" />
                        {t(`landing.traces.${id}F${n}` as TranslationKey)}
                      </span>
                    ))}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="relative z-10 mt-4 flex items-center justify-center gap-6">
        <button type="button" onClick={() => { setOpen(null); goTo(front - 1) }} disabled={front === 0} aria-label={t('landing.traces.previous')} className="ribbon-arrow">←</button>
        <span className="text-xs tracking-[0.3em] tabular-nums text-nier-bg/70" aria-live="polite">
          {String(front + 1).padStart(2, '0')} / {String(CARDS.length).padStart(2, '0')}
        </span>
        <button type="button" onClick={() => { setOpen(null); goTo(front + 1) }} disabled={front === CARDS.length - 1} aria-label={t('landing.traces.next')} className="ribbon-arrow">→</button>
      </div>
    </section>
  )
})
export default TraceRibbon

// What's on a card's face: the trace photographed, or drawn.
function Visual({ id, shot, still }: { id: CardId; shot: 'light' | 'dark'; still: boolean }) {
  if (PHOTOGRAPHED.includes(id)) {
    return <img src={`/landing/close-${id}-${shot}.webp`} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
  }
  if (id === 'video') {
    return <video src="/idle-animation.mp4" muted loop autoPlay={!still} playsInline aria-hidden="true" className="landing-cell-video w-full h-full object-cover" />
  }
  if (id === 'sound') {
    return (
      <span className="ribbon-sound" aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => <span key={i} style={{ animationDelay: `${-((i * 0.37) % 1.4)}s`, height: `${22 + ((i * 47) % 61)}%` }} />)}
      </span>
    )
  }
  if (id === 'documents') {
    return (
      <span className="ribbon-pages" aria-hidden="true">
        {[2, 1, 0].map(n => <span key={n} style={{ transform: `translate(${n * 10}px, ${n * -10}px)` }}><i /><i /><i /><i /><i /></span>)}
      </span>
    )
  }
  return (
    <span className="ribbon-browser" aria-hidden="true">
      <span className="ribbon-browser-bar"><b /><b /><b /><em /></span>
      <span className="ribbon-browser-body"><i /><i /><i /></span>
    </span>
  )
}
