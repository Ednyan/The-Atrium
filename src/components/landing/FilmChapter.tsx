// The film, straight after the hall: the portal's light opening into it. The
// frame is held on screen while the page scrolls past, and grows out of a
// glow the size of the orb into the whole window -- everything comes out of
// the orb. Without motion, it's simply there, open.
//
// What plays in it: the film once it's made; a teaser of the app until then;
// failing both, a card saying it's on its way.

import { forwardRef, useEffect, useRef } from 'react'
import { useTranslation } from '../../lib/i18n'
import { useLandingMotion } from '../../lib/landingMotion'
import { Brackets, ChapterLabel, Clip } from './parts'

// Served from any https address (public/_headers allows media from one).
const FILM_SRC: string = ''
const FILM_POSTER: string = ''
// Until then: a short, silent loop -- the portal, the app at work, the name
// -- and its last frame for a poster.
const TEASER_SRC: string = '/landing/teaser.mp4'
const TEASER_POSTER = '/landing/teaser.webp'

const FilmChapter = forwardRef<HTMLElement, { index: number; still: boolean }>(function FilmChapter({ index, still }, ref) {
  const { t } = useTranslation()
  const motion = useLandingMotion()
  const hold = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const glow = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = hold.current
    if (!motion || !el || !frame.current) return
    const { gsap } = motion
    const ctx = gsap.context(() => {
      gsap.timeline({ scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 0.6 } })
        .fromTo(frame.current, { clipPath: 'inset(44% 47% 44% 47% round 999px)' }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'power2.inOut', duration: 1 }, 0)
        .fromTo(glow.current, { scale: 1, opacity: 1 }, { scale: 6, opacity: 0, ease: 'power1.in', duration: 0.6 }, 0)
        .fromTo(label.current, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.3 }, 0.55)
    })
    return () => ctx.revert()
  }, [motion])

  return (
    <section ref={ref} aria-labelledby="film-title" className="relative">
      {/* Taller than a screen while it opens, so there is scrolling to open it with. */}
      <div ref={hold} className={motion ? 'h-[190vh]' : ''}>
        <div className={`${motion ? 'sticky top-0 h-screen' : 'py-20 md:py-28'} flex flex-col justify-center px-5 sm:px-10 lg:px-16`}>
          <div className="w-full max-w-[1300px] mx-auto">
            <div ref={label} className="mb-8">
              <ChapterLabel index={index}>{t('landing.film.title')}</ChapterLabel>
              <span id="film-title" className="sr-only">{t('landing.film.title')}</span>
            </div>
            <div className="relative mx-auto" style={{ width: 'min(100%, calc((100vh - 13rem) * 16 / 9))' }}>
              <Brackets inset="-0.75rem" />
              {/* Only while it opens: nothing would fade it out otherwise. */}
              {motion && <div ref={glow} aria-hidden="true" className="film-glow absolute left-1/2 top-1/2 w-16 h-16 -ml-8 -mt-8 rounded-full pointer-events-none" />}
              <Screen ref={frame} still={still} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
})
export default FilmChapter

const Screen = forwardRef<HTMLDivElement, { still: boolean }>(function Screen({ still }, ref) {
  const { t } = useTranslation()
  return (
    <div ref={ref} className="film-screen landing-window relative aspect-video border border-nier-border/30 overflow-hidden bg-black">
      {FILM_SRC ? (
        <video src={FILM_SRC} poster={FILM_POSTER || undefined} controls preload="none" playsInline aria-label={t('landing.film.title')} className="absolute inset-0 w-full h-full" />
      ) : TEASER_SRC ? (
        <>
          <Clip src={TEASER_SRC} poster={TEASER_POSTER} still={still} />
          <span className="absolute left-4 bottom-4 text-[10px] tracking-[0.3em] uppercase text-white/80">{t('landing.film.teaser')}</span>
        </>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 sm:gap-8 px-6 text-center">
          <span aria-hidden="true" className="landing-orb w-4 h-4 sm:w-5 sm:h-5 rounded-full" />
          <p className="text-[11px] sm:text-xs tracking-[0.35em] uppercase text-white/90">{t('landing.film.soon')}</p>
          <p className="max-w-[30rem] text-sm sm:text-base font-light leading-relaxed text-white/70 text-pretty">{t('landing.film.body')}</p>
        </div>
      )}
    </div>
  )
})
