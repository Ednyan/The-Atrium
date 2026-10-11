// The film, straight after the hall. Once about half of it is in view, the
// screen rises into place as it fades in, and what plays in it starts from its
// beginning; each time it's come back to after leaving view, again. Transform and opacity only, so the compositor does it all
// (LandingPage's styles). Without motion, it's simply there, open.
//
// What plays in it: the film once it's made; a teaser of the app until then;
// failing both, a card saying it's on its way.

import { forwardRef, useEffect, useRef, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { Brackets, ChapterLabel, Clip } from './parts'

// Served from any https address (public/_headers allows media from one).
const FILM_SRC: string = ''
const FILM_POSTER: string = ''
// Until then: a short, silent loop -- the portal, the app at work, the name
// -- and its last frame for a poster. In 1080p where the screen it plays on
// has the pixels for it, 720p elsewhere (a phone): half the download.
const TEASER_SRC: string = typeof window !== 'undefined' && Math.min(window.innerWidth, 1300) * (window.devicePixelRatio || 1) > 1100
  ? '/landing/teaser.mp4'
  : '/landing/teaser-720.mp4'
const TEASER_POSTER = '/landing/teaser.webp'

const FilmChapter = forwardRef<HTMLElement, { index: number; still: boolean }>(function FilmChapter({ index, still }, ref) {
  const { t } = useTranslation()
  const frame = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(still)

  // Open with about half of it in view; closed again once wholly out of it.
  // Watched by its frame, which keeps its size while the screen is shrunk.
  useEffect(() => {
    const screen = frame.current?.parentElement
    if (still || !screen) return
    const watch = new IntersectionObserver(([entry]) => {
      if (entry.intersectionRatio >= 0.45) setOpen(true)
      else if (!entry.isIntersecting) setOpen(false)
    }, { threshold: [0, 0.45] })
    watch.observe(screen)
    return () => watch.disconnect()
  }, [still])
  // Each opening from the start.
  useEffect(() => {
    const loop = open && !still ? frame.current?.querySelector('video') : null
    if (loop) loop.currentTime = 0
  }, [open, still])

  return (
    <section ref={ref} aria-labelledby="film-title" className="relative">
      <div className={`film-stage py-20 md:py-28 px-5 sm:px-10 lg:px-16 ${still ? '' : 'is-moving'}`} data-open={open ? '' : undefined}>
        <div className="w-full max-w-[1300px] mx-auto">
          <div className="film-label mb-8">
            <ChapterLabel index={index}>{t('landing.film.title')}</ChapterLabel>
            <span id="film-title" className="sr-only">{t('landing.film.title')}</span>
          </div>
          <div className="relative mx-auto" style={{ width: 'min(100%, calc((100vh - 13rem) * 16 / 9))' }}>
            <Brackets inset="-0.75rem" />
            <Screen ref={frame} still={still} />
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
          {/* Fetched once it's on screen, not before: right under the hall, it
              would otherwise download while the page itself still is. */}
          <Clip src={TEASER_SRC} poster={TEASER_POSTER} still={still} controls ahead="0px" />
          <span className="absolute left-4 bottom-14 text-[10px] tracking-[0.3em] uppercase text-white/80 pointer-events-none">{t('landing.film.teaser')}</span>
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
