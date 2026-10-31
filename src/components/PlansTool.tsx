import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import { leftPerPayer, MERCHANT_OF_RECORD, payersNeeded, planFeatures, PRICE_MONTHLY, PRICE_YEARLY, RUNNING_COSTS } from '../lib/plans'

const CELL = 'border border-nier-border/25 px-3 py-2 text-left align-top'
const WAY: Record<typeof RUNNING_COSTS[number]['id'], TranslationKey> = {
  'other-job': 'plans.way.otherJob',
  unpaid: 'plans.way.unpaid',
  'minimum-wage': 'plans.way.minimum',
  living: 'plans.way.living',
}
const euros = (amount: number, digits = 0) => amount.toLocaleString('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits })

/** The Developers page's plans (lib/plans), for the operator alone:
 *  what each would give, and what it takes to keep the Atrium going. Nothing
 *  here limits or charges anyone yet. */
export default function PlansTool() {
  const { t } = useTranslation()
  const word = (shown: string) => (shown === 'yes' ? t('plans.yes') : shown === 'no' ? t('plans.no') : shown === 'unlimited' ? t('plans.unlimited') : shown)
  const rows: [TranslationKey, string, string][] = [
    ...planFeatures().map(([label, free, paid]): [TranslationKey, string, string] => [label, word(free), word(paid)]),
    ['plans.row.appeal', t('plans.yes'), t('plans.no')],
  ]
  const perPayer = leftPerPayer(PRICE_MONTHLY, PRICE_YEARLY, MERCHANT_OF_RECORD)
  return (
    <section data-plans-tool="" className="space-y-8 text-xs">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-nier-strong">
              <th className={CELL} />
              <th className={CELL}>{t('plans.free')}</th>
              <th className={CELL}>
                {t('plans.paid')}
                <span className="block mt-1 font-normal text-nier-bg/70">{t('plans.price', { monthly: euros(PRICE_MONTHLY), yearly: euros(PRICE_YEARLY) })}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, free, paid]) => (
              <tr key={label}>
                <th className={`${CELL} font-normal text-nier-bg/80`}>{t(label)}</th>
                <td className={CELL}>{free}</td>
                <td className={`${CELL} text-nier-strong`}>{paid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-2 text-nier-strong tracking-[0.15em] uppercase text-[11px]">{t('plans.sustain')}</h3>
        <p className="mb-3 text-nier-bg/80 leading-relaxed">{t('plans.leftPerPayer', { amount: euros(perPayer, 2) })}</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-nier-strong">
                <th className={CELL}>{t('plans.col.way')}</th>
                <th className={CELL}>{t('plans.col.year')}</th>
                <th className={CELL}>{t('plans.col.payers')}</th>
                <th className={CELL}>{t('plans.col.users')}</th>
              </tr>
            </thead>
            <tbody>
              {RUNNING_COSTS.map(cost => {
                const payers = payersNeeded(cost.yearly, perPayer)
                return (
                  <tr key={cost.id} data-plan-cost={cost.id}>
                    <th className={`${CELL} font-normal text-nier-bg/80`}>{t(WAY[cost.id])}</th>
                    <td className={CELL}>{euros(cost.yearly)}</td>
                    <td className={`${CELL} text-nier-strong`}>{payers.toLocaleString('en-IE')}</td>
                    <td className={CELL}>{(payers * 100).toLocaleString('en-IE')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-nier-bg/60 leading-relaxed">{t('plans.note')}</p>
      </div>
    </section>
  )
}
