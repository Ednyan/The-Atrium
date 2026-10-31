// Pricing: the free plan and the paid one, side by side (lib/plans). Shown only
// to the operator for now (LandingPage): nothing can be bought yet.
//
// It opens on the yearly plan, the better deal, and says plainly by how much --
// with the amount actually billed beside it, and the monthly plan a press away.

import { forwardRef, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import { planFeatures, PRICE_MONTHLY, PRICE_YEARLY, YEARLY_A_MONTH, YEARLY_SAVES_OVER } from '../../lib/plans'
import { ChapterLabel } from './parts'

const euros = (amount: number) => `€${Number.isInteger(amount) ? amount : amount.toFixed(2)}`

const PricingChapter = forwardRef<HTMLElement, { index: number; enter: string; onGetStarted: () => void; className: string }>(function PricingChapter({ index, enter, onGetStarted, className }, ref) {
  const { t } = useTranslation()
  const [yearly, setYearly] = useState(true)
  const value = (shown: string) => (shown === 'yes' ? t('plans.yes') : shown === 'no' ? t('plans.no') : shown === 'unlimited' ? t('plans.unlimited') : shown)
  const features = planFeatures()
  const choice = (on: boolean) => `px-4 py-2 text-xs tracking-[0.15em] uppercase border transition-colors ${on ? 'border-nier-bg text-nier-strong' : 'border-nier-border/30 text-nier-bg/70 hover:text-nier-strong'}`
  return (
    <section ref={ref} data-pricing="" className={className}>
      <div className="max-w-[1100px] mx-auto">
        <ChapterLabel index={index} className="mb-6">{t('landing.pricing.title')}</ChapterLabel>
        <p data-pricing-preview="" className="mb-10 text-xs text-nier-bg/60">{t('landing.pricing.preview')}</p>
        <div className="mb-8 flex flex-wrap items-center gap-2" data-reveal>
          <button type="button" data-pricing-period="yearly" aria-pressed={yearly} onClick={() => setYearly(true)} className={choice(yearly)}>
            {t('landing.pricing.yearly')}
            <span className="ml-2 normal-case tracking-normal" style={{ color: 'rgb(var(--c-orange))' }}>{t('landing.pricing.save', { percent: YEARLY_SAVES_OVER })}</span>
          </button>
          <button type="button" data-pricing-period="monthly" aria-pressed={!yearly} onClick={() => setYearly(false)} className={choice(!yearly)}>{t('landing.pricing.monthly')}</button>
        </div>
        <div className="landing-bento grid md:grid-cols-2 gap-px" data-reveal>
          <div className="landing-cell p-8 md:p-12 flex flex-col">
            <h3 className="text-2xl md:text-4xl font-extralight tracking-[0.08em] uppercase text-nier-strong">{t('plans.free')}</h3>
            <p className="mt-4 text-3xl font-extralight text-nier-strong">€0</p>
            <ul className="mt-8 space-y-3 text-sm">
              {features.map(([label, free]) => (
                <li key={label} className="flex items-baseline justify-between gap-4 border-b border-nier-border/15 pb-2">
                  <span className="text-nier-bg/75">{t(label)}</span>
                  <span className="shrink-0 text-nier-strong">{value(free)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-10">
              <button type="button" onClick={onGetStarted} className="landing-link text-sm tracking-[0.18em] uppercase">{enter} <span aria-hidden="true">→</span></button>
            </div>
          </div>
          <div className="landing-cell p-8 md:p-12 flex flex-col">
            <h3 className="text-2xl md:text-4xl font-extralight tracking-[0.08em] uppercase text-nier-strong">{t('plans.paid')}</h3>
            <p data-pricing-price="" className="mt-4 text-3xl font-extralight text-nier-strong">
              {euros(yearly ? YEARLY_A_MONTH : PRICE_MONTHLY)}
              <span className="ml-2 text-sm text-nier-bg/70">{t('landing.pricing.perMonth')}</span>
            </p>
            {yearly ? (
              <p data-pricing-note="" className="mt-2 text-sm text-nier-bg/80">
                {t('landing.pricing.billedYearly', { amount: euros(PRICE_YEARLY) })}{' '}
                <span className="whitespace-nowrap" style={{ color: 'rgb(var(--c-orange))' }}>{t('landing.pricing.bestValue')}</span>
              </p>
            ) : (
              <p data-pricing-note="" className="mt-2 text-sm text-nier-bg/80">
                <button type="button" data-pricing-switch="" onClick={() => setYearly(true)} className="underline underline-offset-2 hover:text-nier-strong transition-colors text-left">
                  {t('landing.pricing.switchYearly', { month: euros(YEARLY_A_MONTH), percent: YEARLY_SAVES_OVER })}
                </button>
              </p>
            )}
            <ul className="mt-8 space-y-3 text-sm">
              {features.map(([label, , paid]) => (
                <li key={label} className="flex items-baseline justify-between gap-4 border-b border-nier-border/15 pb-2">
                  <span className="text-nier-bg/75">{t(label)}</span>
                  <span className="shrink-0 text-nier-strong">{value(paid)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-10">
              <button type="button" disabled className="px-6 py-3 text-xs tracking-[0.18em] uppercase border border-nier-border/30 text-nier-bg/60 cursor-not-allowed">{t('landing.pricing.soon')}</button>
            </div>
          </div>
        </div>
        <p className="mt-6 text-sm text-nier-bg/70" data-reveal>{t('landing.pricing.vat')}</p>
      </div>
    </section>
  )
})

export default PricingChapter
