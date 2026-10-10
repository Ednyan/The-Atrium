// What an atrium is, shown rather than said: the example atrium (photographed
// in the app, public/landing) held on screen while the page scrolls, the view
// moving in on each part as its line comes up -- the room, its references, a
// sketch and its thread, its palette and planning. On a phone, or with less
// motion, the same four lines, each over its part of the picture.

import { forwardRef, useEffect, useRef } from 'react'
import { useTranslation } from '../../lib/i18n'
import type { TranslationKey } from '../../locales/en'
import { useLandingMotion } from '../../lib/landingMotion'
import { Brackets, ChapterLabel } from './parts'

// Where each part is in the picture: its middle (0..1 across and down) and how
// far in to go.
const STEPS = [
  { cx: 0.5, cy: 0.5, zoom: 1 },
  { cx: 0.327, cy: 0.6, zoom: 1.37 },
  { cx: 0.725, cy: 0.38, zoom: 2.5 },
  { cx: 0.76, cy: 0.724, zoom: 2.1 },
] as const

// The picture moved so the part's middle is the frame's, as far as the
// picture's edges allow: as percentages of its own size, with its origin at
// the top left.
function framing({ cx, cy, zoom }: { cx: number; cy: number; zoom: number }) {
  const along = (c: number) => Math.min(0, Math.max(100 - 100 * zoom, 50 - c * zoom * 100))
  return { xPercent: along(cx), yPercent: along(cy), scale: zoom }
}

const InsideChapter = forwardRef<HTMLElement, { index: number; shot: 'light' | 'dark' }>(function InsideChapter({ index, shot }, ref) {
  const { t } = useTranslation()
  const motion = useLandingMotion()
  const hold = useRef<HTMLDivElement>(null)
  const picture = useRef<HTMLImageElement>(null)
  const steps = useRef<(HTMLDivElement | null)[]>([])
  const ticks = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    const el = hold.current
    if (!motion || !el || !picture.current) return
    const { gsap } = motion
    const mm = gsap.matchMedia()
    mm.add('(min-width: 1024px)', () => {
      gsap.set(picture.current, { transformOrigin: '0 0', ...framing(STEPS[0]) })
      gsap.set(steps.current.slice(1), { autoAlpha: 0, y: 40 })
      const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 0.7 } })
      STEPS.forEach((step, i) => {
        if (i === 0) return
        const at = i - 0.5
        tl.to(picture.current, { ...framing(step), duration: 1, ease: 'power2.inOut' }, at)
          .to(steps.current[i - 1], { autoAlpha: 0, y: -40, duration: 0.4 }, at)
          .to(steps.current[i], { autoAlpha: 1, y: 0, duration: 0.4 }, at + 0.5)
          .to(ticks.current[i], { scaleX: 1, duration: 0.5 }, at + 0.3)
      })
      tl.to({}, { duration: 0.5 })
    })
    return () => mm.revert()
  }, [motion])

  const src = `/landing/atrium-${shot}.webp`
  const srcSet = `/landing/atrium-${shot}-1000.webp 1000w, /landing/atrium-${shot}.webp 2000w`
  const label = (i: number) => t(`landing.inside.step${i + 1}` as TranslationKey)
  const body = (i: number) => t(`landing.inside.step${i + 1}Body` as TranslationKey)

  return (
    <section ref={ref} className="relative">
      {/* Pinned, from a laptop up and with motion: a screen per line. */}
      <div ref={hold} className={`hidden ${motion ? 'lg:block' : ''} h-[270vh]`}>
        <div className="sticky top-0 h-screen flex items-center px-10 lg:px-16">
          <div className="w-full max-w-[1400px] mx-auto grid grid-cols-[minmax(0,4fr)_minmax(0,8fr)] gap-14 items-center">
            <div>
              <ChapterLabel index={index}>{t('landing.inside.title')}</ChapterLabel>
              <div className="relative mt-10 h-[19rem]">
                {STEPS.map((_, i) => (
                  <div key={i} ref={el => { steps.current[i] = el }} className="absolute inset-x-0 top-0">
                    <p className="text-[clamp(2.2rem,3.6vw,3.6rem)] font-extralight leading-[1.02] tracking-[-0.01em] text-nier-strong text-balance">{label(i)}</p>
                    <p className="mt-6 max-w-[28rem] text-lg font-light leading-relaxed text-nier-bg/80 text-pretty">{body(i)}</p>
                  </div>
                ))}
              </div>
              <div aria-hidden="true" className="flex gap-2 mt-4">
                {STEPS.map((_, i) => (
                  <span key={i} className="relative h-[2px] w-10 bg-nier-border/25 overflow-hidden">
                    <span ref={el => { ticks.current[i] = el }} className="absolute inset-0 landing-light-fill origin-left" style={{ transform: `scaleX(${i === 0 ? 1 : 0})` }} />
                  </span>
                ))}
              </div>
            </div>
            <div className="relative">
              <Brackets inset="-0.75rem" />
              <div className="landing-window relative overflow-hidden border border-nier-border/30 aspect-[16/10]">
                {/* Seen up to two and a half times its size, so from the large file. */}
                <img ref={picture} src={src} srcSet={`${srcSet}, /landing/atrium-${shot}-4000.webp 4000w`} sizes="160vw" width={2000} height={1250} loading="lazy" decoding="async" alt={t('landing.inside.alt')} className="absolute inset-0 w-full h-full will-change-transform" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Otherwise: each line over its part of the picture. */}
      <div className={`${motion ? 'lg:hidden' : ''} px-5 sm:px-10 py-20 md:py-28`}>
        <div className="max-w-[1100px] mx-auto">
          <ChapterLabel index={index}>{t('landing.inside.title')}</ChapterLabel>
          <ol className="mt-12 space-y-16">
            {STEPS.map((step, i) => {
              const f = framing(step)
              return (
                <li key={i} className="grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 items-center" data-reveal>
                  <div>
                    <p className="text-3xl md:text-4xl font-extralight leading-tight text-nier-strong text-balance">{label(i)}</p>
                    <p className="mt-4 font-light leading-relaxed text-nier-bg/80 text-pretty">{body(i)}</p>
                  </div>
                  <div className="landing-window relative overflow-hidden border border-nier-border/30 aspect-[16/10]">
                    <img
                      src={src} srcSet={srcSet} sizes="(min-width: 768px) 60vw, 92vw" width={2000} height={1250} loading="lazy" decoding="async"
                      alt={i === 0 ? t('landing.inside.alt') : ''}
                      className="absolute inset-0 w-full h-full origin-top-left"
                      style={{ transform: `translate(${f.xPercent}%, ${f.yPercent}%) scale(${f.scale})` }}
                    />
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
})
export default InsideChapter
