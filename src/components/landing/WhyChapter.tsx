// Why the Atrium exists, and the way into how it was made: the code history
// (public/code-history), which slides in beside this page (lib/codeHistory).
// Its button stands in a bloom of the Atrium's own code (CodeBloom), and the
// roots growing down the margins (CodeRoots) gather at it too.

import { forwardRef, useRef, type RefObject } from 'react'
import { useTranslation } from '../../lib/i18n'
import { openCodeHistory, preloadCodeHistory } from '../../lib/codeHistory'
import ScrollReveal from '../reactbits/ScrollReveal'
import CodeBloom from './CodeBloom'
import { ChapterLabel, Lead } from './parts'

const WhyChapter = forwardRef<HTMLElement, { index: number; buttonRef: RefObject<HTMLAnchorElement> }>(function WhyChapter({ index, buttonRef }, ref) {
  const { t } = useTranslation()
  const stage = useRef<HTMLDivElement>(null)
  const clear = useRef<HTMLDivElement>(null)
  return (
    <section ref={ref} className="relative pt-16 pb-16 md:pt-20 md:pb-24">
      <div className="px-5 sm:px-10 lg:px-16">
        <div className="max-w-[980px] mx-auto">
          <ChapterLabel index={index}>{t('landing.why.title')}</ChapterLabel>
          <ScrollReveal className="mt-10 text-[clamp(2rem,4.6vw,4rem)] font-extralight leading-[1.08] tracking-[-0.01em] text-nier-strong text-balance">{t('landing.why.lead')}</ScrollReveal>
          {/* The roots are only drawn from 1100px (CodeRoots), so only said there. */}
          <div className="mt-10 grid min-[1100px]:grid-cols-2 gap-8 md:gap-14" data-reveal>
            <Lead>{t('landing.why.body')}</Lead>
            <p className="hidden min-[1100px]:block text-nier-bg/65 leading-relaxed text-pretty">{t('landing.why.roots')}</p>
          </div>
        </div>
      </div>
      <div ref={stage} className="relative mt-6 mx-auto max-w-[1600px] h-[clamp(620px,86vh,820px)] flex items-center justify-center px-5">
        <CodeBloom stage={stage} button={buttonRef} clear={clear} />
        {/* Not revealed by sliding in: the bloom is measured off the button, and grows out of it. */}
        <div ref={clear} className="relative flex flex-col items-center text-center max-w-[30rem]">
          <a
            ref={buttonRef}
            href="/code-history/"
            onPointerEnter={preloadCodeHistory}
            onFocus={preloadCodeHistory}
            onClick={e => {
              if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              if (openCodeHistory()) e.preventDefault()
            }}
            className="code-history-button group relative inline-flex items-center gap-4 px-8 py-4 text-sm tracking-[0.22em] uppercase text-nier-strong"
          >
            <span aria-hidden="true" className="w-2 h-2 rotate-45 shrink-0 landing-lit" />
            {t('landing.codeHistory')}
            <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">→</span>
          </a>
          <p className="mt-5 text-sm text-nier-bg/60 leading-relaxed text-pretty">{t('landing.codeHistory.what')}</p>
        </div>
      </div>
    </section>
  )
})
export default WhyChapter
