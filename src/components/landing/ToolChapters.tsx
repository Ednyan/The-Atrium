// What can be done in an atrium: a run of chapters that slides sideways as the
// page scrolls down -- each a big number, the tool's name, a sentence, and the
// app doing it -- ending on the keys. On a phone, or with less motion, the
// same chapters one under another.

import { forwardRef, useEffect, useRef } from 'react'
import { useTranslation } from '../../lib/i18n'
import type { TranslationKey } from '../../locales/en'
import { useLandingMotion } from '../../lib/landingMotion'
import { ChapterLabel, Clip, Headline } from './parts'

const TOOLS = ['move', 'arrange', 'connect', 'together', 'style', 'keep'] as const
const KEYS: [TranslationKey, TranslationKey][] = [
  ['landing.controls.dragKey', 'landing.controls.drag'],
  ['landing.controls.scrollKey', 'landing.controls.scroll'],
  ['landing.controls.numbersKey', 'landing.controls.numbers'],
  ['landing.controls.dKey', 'landing.controls.d'],
  ['landing.controls.tKeyKey', 'landing.controls.tKey'],
]

const ToolChapters = forwardRef<HTMLElement, { index: number; shot: 'light' | 'dark'; still: boolean }>(function ToolChapters({ index, shot, still }, ref) {
  const { t } = useTranslation()
  const motion = useLandingMotion()
  const hold = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = hold.current, run = track.current
    if (!motion || !el || !run) return
    const { gsap } = motion
    const mm = gsap.matchMedia()
    mm.add('(min-width: 1024px)', () => {
      const distance = () => run.scrollWidth - window.innerWidth
      // As tall as the run is wide, so a turn of the wheel moves it as far
      // sideways as it would have moved the page down.
      const size = () => { el.style.height = `${distance() + window.innerHeight}px` }
      size()
      gsap.to(run, {
        x: () => -distance(), ease: 'none',
        scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: 0.6, invalidateOnRefresh: true, onRefreshInit: size },
      })
      // Each chapter's number slides the other way, a little: depth.
      run.querySelectorAll<HTMLElement>('.tool-number').forEach(number => {
        gsap.fromTo(number, { xPercent: 30 }, { xPercent: -30, ease: 'none', scrollTrigger: { trigger: el, start: 'top top', end: 'bottom bottom', scrub: true } })
      })
      return () => { el.style.height = '' }
    })
    return () => mm.revert()
  }, [motion])

  const intro = (
    <div className="tool-panel tool-intro" data-reveal>
      <ChapterLabel index={index}>{t('landing.tools.title')}</ChapterLabel>
      <Headline className="mt-10 text-[clamp(2.6rem,6vw,5.6rem)] font-extralight leading-[0.98] tracking-[-0.01em] text-nier-strong">{t('landing.tools.lead')}</Headline>
      <p className="mt-8 text-sm tracking-[0.15em] uppercase text-nier-bg/60 hidden lg:block">{t('landing.tools.scrollHint')} <span aria-hidden="true">→</span></p>
    </div>
  )
  const keys = (
    <div className="tool-panel tool-keys">
      <h3 className="text-xs tracking-[0.25em] uppercase text-nier-bg/70 mb-6">{t('landing.tools.keys')}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-baseline">
        {KEYS.map(([key, desc]) => (
          <div key={key} className="contents">
            <dt><kbd className="landing-key">{t(key)}</kbd></dt>
            <dd className="text-nier-bg/80">{t(desc)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )

  return (
    <section ref={ref} className="relative">
      <div ref={hold} className={motion ? 'lg:relative' : ''}>
        <div className={motion ? 'lg:sticky lg:top-0 lg:h-screen lg:overflow-hidden lg:flex lg:items-center' : ''}>
          <div ref={track} className={`tool-run ${motion ? 'tool-run-flow lg:flex lg:w-max lg:items-stretch' : ''}`}>
            {intro}
            {TOOLS.map((id, i) => (
              <article key={id} className="tool-panel tool-chapter" data-reveal>
                <span aria-hidden="true" className="tool-number">{String(i + 1).padStart(2, '0')}</span>
                <div className="relative">
                  <h3 className="text-[clamp(2rem,3.4vw,3.4rem)] font-extralight leading-[1.02] tracking-[0.04em] uppercase text-nier-strong">{t(`landing.tools.${id}` as TranslationKey)}</h3>
                  <p className="mt-4 max-w-[26rem] text-lg font-light leading-relaxed text-nier-bg/80 text-pretty">{t(`landing.tools.${id}Desc` as TranslationKey)}</p>
                </div>
                <div className="tool-media landing-window relative overflow-hidden border border-nier-border/30 aspect-[16/10]">
                  <Clip src={`/landing/tool-${id}-${shot}.mp4`} poster={`/landing/atrium-${shot}-1000.webp`} still={still} />
                </div>
              </article>
            ))}
            {keys}
          </div>
        </div>
      </div>
    </section>
  )
})
export default ToolChapters
