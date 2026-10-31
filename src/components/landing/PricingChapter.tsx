// Pricing: the free plan and the paid one, side by side (lib/plans). Shown only
// to the operator for now (LandingPage): nothing can be bought yet, so it asks
// instead whether people would (lib/planInterest).
//
// It opens on the yearly plan, the better deal, and says plainly by how much --
// with the amount actually billed beside it, and the monthly plan a press away.
//
// Its movement is the page's own (lib/landingMotion): the cards rise in turn, their
// lines following, the price counts up as it arrives and rolls between plans.
// With less motion asked for, or before the libraries arrive, it's simply there.

import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../../lib/i18n'
import { useLandingMotion } from '../../lib/landingMotion'
import { useLandingTheme } from '../../lib/useLandingTheme'
import { myPlanAnswer, sendPlanAnswer, type PlanAnswer } from '../../lib/planInterest'
import { planFeatures, planValue, PRICE_MONTHLY, PRICE_YEARLY, YEARLY_A_MONTH, YEARLY_SAVES_OVER } from '../../lib/plans'
import { ChapterLabel } from './parts'

const euros = (amount: number) => `€${Number.isInteger(amount) ? amount : amount.toFixed(2)}`

// "Would you buy this plan?" Closed by its ×, Cancel, Esc or a press beside it,
// none of which counts as an answer.
function InterestDialog({ onClose, onAnswered }: { onClose: () => void; onAnswered: (answer: PlanAnswer) => void }) {
  const { t } = useTranslation()
  const theme = useLandingTheme()
  const [state, setState] = useState<'asking' | 'sending' | 'thanks' | 'failed'>('asking')
  const firstRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { firstRef.current?.focus() }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const answer = async (choice: PlanAnswer) => {
    setState('sending')
    try {
      await sendPlanAnswer(choice)
      onAnswered(choice)
      setState('thanks')
      window.setTimeout(onClose, 1400)
    } catch {
      setState('failed')
    }
  }
  const CHOICE = 'flex-1 px-4 py-2.5 text-xs tracking-[0.12em] uppercase border border-nier-border/50 text-nier-strong hover:border-nier-bg transition-colors disabled:opacity-40'
  return createPortal(
    <div data-landing-theme={theme.resolved} data-interest-dialog="" className="pricing-dialog-back fixed inset-0 z-[10000200] flex items-center justify-center px-4 font-mono" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="pricing-interest-title" className="pricing-dialog relative w-full max-w-md border border-nier-border/40 p-6 pr-12 text-nier-bg" style={{ backgroundColor: 'rgb(var(--c-ground))' }} onClick={e => e.stopPropagation()}>
        <button type="button" data-interest-close="" onClick={onClose} aria-label={t('common.close')} className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center text-nier-bg/70 hover:text-nier-strong transition-colors">×</button>
        {state === 'thanks' ? (
          <p data-interest-thanks="" role="status" className="py-4 text-sm text-nier-strong">{t('landing.interest.thanks')}</p>
        ) : (
          <>
            <h3 id="pricing-interest-title" className="text-lg font-light tracking-[0.04em] text-nier-strong">{t('landing.interest.title')}</h3>
            <p className="mt-2 text-sm leading-relaxed text-nier-bg/80">{t('landing.interest.body')}</p>
            {state === 'failed' && <p role="alert" className="mt-3 text-xs" style={{ color: 'rgb(var(--c-danger))' }}>{t('landing.interest.failed')}</p>}
            <div className="mt-5 -mr-6 flex flex-wrap gap-2">
              <button ref={firstRef} type="button" data-interest-answer="yes" disabled={state === 'sending'} onClick={() => void answer('yes')} className={CHOICE}>{t('landing.interest.yes')}</button>
              <button type="button" data-interest-answer="no" disabled={state === 'sending'} onClick={() => void answer('no')} className={CHOICE}>{t('landing.interest.no')}</button>
            </div>
            <div className="mt-4 -mr-6 text-right">
              <button type="button" data-interest-cancel="" onClick={onClose} className="landing-link text-xs tracking-[0.15em] uppercase">{t('common.cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

const PricingChapter = forwardRef<HTMLElement, { index: number; enter: string; onGetStarted: () => void; className: string }>(function PricingChapter({ index, enter, onGetStarted, className }, ref) {
  const { t } = useTranslation()
  const motion = useLandingMotion()
  const [yearly, setYearly] = useState(true)
  const [asking, setAsking] = useState(false)
  const [answered, setAnswered] = useState(myPlanAnswer)
  const features = planFeatures()
  const root = useRef<HTMLElement | null>(null)

  // The price, written here rather than by React, so it can roll.
  const priceRef = useRef<HTMLSpanElement>(null)
  const shownRef = useRef<number | null>(null)
  const tweenRef = useRef<{ kill(): void } | null>(null)
  const target = yearly ? YEARLY_A_MONTH : PRICE_MONTHLY
  useLayoutEffect(() => {
    const el = priceRef.current
    if (!el) return
    if (!motion || shownRef.current === null) {
      el.textContent = euros(target)
      shownRef.current = target
      return
    }
    if (shownRef.current === target) return
    tweenRef.current?.kill()
    const rolling = { value: shownRef.current }
    tweenRef.current = motion.gsap.to(rolling, {
      value: target, duration: 0.45, ease: 'power2.out',
      onUpdate: () => { shownRef.current = rolling.value; el.textContent = `€${rolling.value.toFixed(2)}` },
      onComplete: () => { shownRef.current = target; el.textContent = euros(target) },
    })
  }, [target, motion])
  useEffect(() => () => tweenRef.current?.kill(), [])

  // The light behind the chosen period, gliding between them.
  const toggleRef = useRef<HTMLDivElement>(null)
  const glideRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const toggle = toggleRef.current, glide = glideRef.current
    if (!toggle || !glide) return
    const place = () => {
      const on = toggle.querySelector<HTMLElement>('[aria-pressed="true"]')
      if (!on) return
      glide.style.width = `${on.offsetWidth}px`
      glide.style.height = `${on.offsetHeight}px`
      glide.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`
    }
    place()
    const watching = new ResizeObserver(place)
    watching.observe(toggle)
    return () => watching.disconnect()
  }, [yearly, t])

  // The cards rising in turn, their lines after them, the price counting up.
  useEffect(() => {
    const section = root.current
    if (!motion || !section) return
    const { gsap, ScrollTrigger } = motion
    const cards = section.querySelector('[data-pricing-cards]')
    const ctx = gsap.context(() => {
      // No scope on this context: the scroller, named by a selector (lib/landingMotionLibs), is outside the section.
      const onCards = () => ({ trigger: cards, start: 'top 88%', once: true })
      gsap.from(section.querySelectorAll('[data-pricing-card]'), { opacity: 0, y: 44, duration: 0.9, ease: 'power3.out', stagger: 0.14, scrollTrigger: onCards() })
      section.querySelectorAll('[data-pricing-card]').forEach((card, i) => {
        gsap.from(card.querySelectorAll('[data-pricing-line]'), { opacity: 0, x: -12, duration: 0.5, ease: 'power2.out', stagger: 0.05, delay: 0.25 + i * 0.14, scrollTrigger: onCards() })
      })
      gsap.from(section.querySelector('[data-pricing-toggle]'), { opacity: 0, y: 14, duration: 0.6, ease: 'power2.out', scrollTrigger: { trigger: section, start: 'top 80%', once: true } })
      // Counted when the cards arrive: a number, so no animation of an element
      // for the trigger to attach to. A press on the toggle meanwhile takes over.
      ScrollTrigger.create({
        ...onCards(),
        onEnter: () => {
          const counting = { value: 0 }
          gsap.to(counting, {
            value: 1, duration: 1.1, ease: 'power2.out', delay: 0.3,
            onUpdate: () => {
              const el = priceRef.current
              if (el && shownRef.current !== null && !tweenRef.current) el.textContent = `€${(shownRef.current * counting.value).toFixed(2)}`
            },
            onComplete: () => { if (priceRef.current && !tweenRef.current && shownRef.current !== null) priceRef.current.textContent = euros(shownRef.current) },
          })
        },
      })
    })
    return () => ctx.revert()
  }, [motion])

  // A soft light under the pointer, on the paid card: written straight to the
  // card, so moving over it renders nothing.
  const onPaidMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--pricing-x', `${e.clientX - box.left}px`)
    e.currentTarget.style.setProperty('--pricing-y', `${e.clientY - box.top}px`)
  }

  const period = (on: boolean) => `relative z-[1] px-4 py-2 text-xs tracking-[0.15em] uppercase transition-colors ${on ? 'text-nier-strong' : 'text-nier-bg/70 hover:text-nier-strong'}`
  return (
    <section ref={el => { root.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el }} data-pricing="" className={className}>
      <div className="max-w-[1100px] mx-auto">
        <ChapterLabel index={index} className="mb-6">{t('landing.pricing.title')}</ChapterLabel>
        <p data-pricing-preview="" className="mb-10 text-xs text-nier-bg/60">{t('landing.pricing.preview')}</p>
        <div ref={toggleRef} data-pricing-toggle="" className="relative mb-8 inline-flex flex-wrap items-center gap-2">
          <span ref={glideRef} aria-hidden="true" className="pricing-glide" />
          <button type="button" data-pricing-period="yearly" aria-pressed={yearly} onClick={() => setYearly(true)} className={period(yearly)}>
            {t('landing.pricing.yearly')}
            <span className="ml-2 normal-case tracking-normal" style={{ color: 'rgb(var(--c-orange))' }}>{t('landing.pricing.save', { percent: YEARLY_SAVES_OVER })}</span>
          </button>
          <button type="button" data-pricing-period="monthly" aria-pressed={!yearly} onClick={() => setYearly(false)} className={period(!yearly)}>{t('landing.pricing.monthly')}</button>
        </div>
        {/* One grid for both cards, its rows shared (.pricing-card), so each line
            lies level with its neighbour whatever wraps above it. */}
        <div data-pricing-cards="" className="landing-bento grid md:grid-cols-2 gap-px" style={{ '--pricing-lines': features.length } as CSSProperties}>
          <div data-pricing-card="free" className="landing-cell pricing-card p-8 md:p-12 flex flex-col">
            <h3 className="text-2xl md:text-4xl font-extralight tracking-[0.08em] uppercase text-nier-strong">{t('plans.free')}</h3>
            <p className="pricing-price mt-5 font-extralight text-nier-strong">€0</p>
            {/* Its place kept, across from the paid card's note. */}
            <div aria-hidden="true" />
            <ul className="pricing-lines mt-8 text-sm">
              {features.map(([label, free]) => (
                <li key={label} data-pricing-line="" className="pricing-line flex items-baseline justify-between gap-4 border-b border-nier-border/15 py-2.5">
                  <span className="text-nier-bg/75">{t(label)}</span>
                  <span className="shrink-0 text-nier-strong">{planValue(free, t)}</span>
                </li>
              ))}
            </ul>
            <div className="pt-10">
              <button type="button" onClick={onGetStarted} className="landing-link text-sm tracking-[0.18em] uppercase">{enter} <span aria-hidden="true">→</span></button>
            </div>
          </div>
          <div data-pricing-card="paid" onMouseMove={onPaidMove} className="landing-cell pricing-card pricing-paid p-8 md:p-12 flex flex-col">
            <span aria-hidden="true" className="pricing-light" />
            <h3 className="text-2xl md:text-4xl font-extralight tracking-[0.08em] uppercase text-nier-strong">{t('plans.paid')}</h3>
            <p data-pricing-price="" className="pricing-price mt-5 font-extralight" style={{ color: 'rgb(var(--c-orange))' }}>
              <span ref={priceRef} className="tabular-nums" />
              <span className="pricing-per ml-3 text-sm text-nier-bg/80">{t('landing.pricing.perMonth')}</span>
            </p>
            {/* Keyed, so what it says arrives rather than just changes. */}
            <div key={yearly ? 'yearly' : 'monthly'} data-pricing-note="" className="pricing-swap mt-2 text-sm text-nier-bg/80">
              {yearly ? (
                <>
                  {t('landing.pricing.billedYearly', { amount: euros(PRICE_YEARLY) })}{' '}
                  <span className="whitespace-nowrap" style={{ color: 'rgb(var(--c-orange))' }}>{t('landing.pricing.bestValue')}</span>
                </>
              ) : (
                <button type="button" data-pricing-switch="" onClick={() => setYearly(true)} className="underline underline-offset-2 hover:text-nier-strong transition-colors text-left">
                  {t('landing.pricing.switchYearly', { month: euros(YEARLY_A_MONTH), percent: YEARLY_SAVES_OVER })}
                </button>
              )}
            </div>
            <ul className="pricing-lines mt-8 text-sm">
              {features.map(([label, , paid]) => (
                <li key={label} data-pricing-line="" className="pricing-line flex items-baseline justify-between gap-4 border-b border-nier-border/15 py-2.5">
                  <span className="text-nier-bg/75">{t(label)}</span>
                  <span className="shrink-0 text-nier-strong">{planValue(paid, t)}</span>
                </li>
              ))}
            </ul>
            <div className="pt-10 flex flex-wrap items-center gap-3">
              <button type="button" disabled className="px-5 py-3 text-xs tracking-[0.15em] uppercase border border-nier-border/30 text-nier-bg/60 cursor-not-allowed">{t('landing.pricing.soon')}</button>
              <button type="button" data-pricing-interest="" onClick={() => setAsking(true)} className="landing-link text-xs tracking-[0.12em] uppercase">
                {t(answered ? 'landing.interest.answered' : 'landing.interest.ask')}
              </button>
            </div>
          </div>
        </div>
        <p className="mt-6 text-sm text-nier-bg/70" data-reveal>{t('landing.pricing.vat')}</p>
      </div>
      {asking && <InterestDialog onClose={() => setAsking(false)} onAnswered={setAnswered} />}
    </section>
  )
})

export default PricingChapter
