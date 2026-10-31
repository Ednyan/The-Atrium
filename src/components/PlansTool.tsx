import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import { FREE_PLAN, leftPerPayer, MERCHANT_OF_RECORD, PAID_PLAN, payersNeeded, PRICE_MONTHLY, PRICE_YEARLY, RUNNING_COSTS } from '../lib/plans'

const CELL = 'border border-nier-border/25 px-3 py-2 text-left align-top'
const WAY: Record<typeof RUNNING_COSTS[number]['id'], TranslationKey> = {
  'other-job': 'plans.way.otherJob',
  unpaid: 'plans.way.unpaid',
  'minimum-wage': 'plans.way.minimum',
  living: 'plans.way.living',
}
const euros = (amount: number, digits = 0) => amount.toLocaleString('en-IE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits })
const size = (mb: number) => (mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`)

/** The Developers page's plans (lib/plans, docs/PLANS.md), for the operator alone:
 *  what each would give, and what it takes to keep the Atrium going. Nothing
 *  here limits or charges anyone yet. */
export default function PlansTool() {
  const { t } = useTranslation()
  const yes = t('plans.yes'), no = t('plans.no'), unlimited = t('plans.unlimited')
  const rows: [TranslationKey, string, string][] = [
    ['plans.row.atriums', String(FREE_PLAN.cloudAtriums), String(PAID_PLAN.cloudAtriums)],
    ['plans.row.space', size(FREE_PLAN.cloudMb), size(PAID_PLAN.cloudMb)],
    ['plans.row.file', size(FREE_PLAN.fileMb), size(PAID_PLAN.fileMb)],
    ['plans.row.mirror', size(FREE_PLAN.mirrorMb), size(PAID_PLAN.mirrorMb)],
    ['plans.row.elsewhere', unlimited, unlimited],
    ['plans.row.rooms', yes, yes],
    ['plans.row.builtin', yes, yes],
    ['plans.row.own', no, yes],
    ['plans.row.appeal', yes, no],
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
