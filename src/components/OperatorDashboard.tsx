import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { formatMoney } from '../lib/currency'
import { isCurrencyCode } from '../../supabase/functions/_shared/currencies.ts'
import { toWorker } from '../lib/worker'

// The operator's dashboard (workers/rooms, ops.ts): the money Stripe has had
// this month beside what the Atrium recorded of it, and each free-plan limit
// beside how much of it is spent -- so a limit about to be reached is seen
// before it's reached. Opened from the names panel; the worker checks who's
// asking, as it does for everything there.

interface Meter {
  key: string
  used?: number
  limit: number | null
  unit: 'count' | 'bytes' | 'ms' | 'gbs'
  per: 'day' | 'month' | 'total' | 'request' | '31 days'
  over?: number
  error?: string
}
type ByCurrency<T> = Record<string, T>
interface Money {
  available: { amount: number; currency: string }[]
  pending: { amount: number; currency: string }[]
  payments: ByCurrency<{ count: number; amount: number; fee: number; net: number }>
  refunds: ByCurrency<{ count: number; amount: number }>
  recorded: { count: number; cents: number } | null
  monthlyContributors: number
  lastEvent: number | null
  moved: number | null
}
interface Health { at: number; money: Money | { error: string }; meters: Meter[] }

// Amber past this share of a limit, red past the next.
const NEAR = 0.7
const AT = 0.9

const amount = (minor: number, currency: string) => {
  const code = currency.toUpperCase()
  return isCurrencyCode(code) ? formatMoney(minor, code) : `${(minor / 100).toFixed(2)} ${code}`
}
const amounts = (list: { amount: number; currency: string }[]) => list.map(entry => amount(entry.amount, entry.currency)).join(' + ') || amount(0, 'eur')

export default function OperatorDashboard({ onClose }: { onClose: () => void }) {
  const { t, language } = useTranslation()
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const { ok, answer } = await toWorker('/ops/health', {}, true)
      if (!ok) throw new Error(answer?.error || t('names.requestFailed'))
      setHealth(answer)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { void load() }, [])

  // A payment only Supabase recorded (its webhook got it, the worker's
  // didn't): copied across, nothing the worker has touched.
  const copyMissing = async () => {
    setBusy(true)
    setError('')
    try {
      const { ok, answer } = await toWorker('/contributions/ops', { action: 'move' }, true)
      if (!ok) throw new Error(answer?.error || t('names.requestFailed'))
      setNotice(t('ops.copied', { count: answer?.added ?? 0 }))
      await load()
    } catch (e: any) {
      setError(e.message)
      setBusy(false)
    }
  }

  const number = (value: number, digits = 0) => new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value)
  const measure = (value: number, unit: Meter['unit']) => {
    if (unit === 'bytes') return value >= 1e9 ? `${number(value / 1e9, 2)} GB` : `${number(value / 1e6, 1)} MB`
    if (unit === 'ms') return `${number(value, 1)} ms`
    if (unit === 'gbs') return `${number(value, 0)} GB-s`
    return number(value)
  }
  const PER: Record<Meter['per'], string> = {
    day: t('ops.per.day'), month: t('ops.per.month'), total: t('ops.per.total'), request: t('ops.per.request'), '31 days': t('ops.per.31days'),
  }
  const LABEL: Record<string, string> = {
    requests: t('ops.meter.requests'), cpu: t('ops.meter.cpu'), rooms: t('ops.meter.rooms'), roomTime: t('ops.meter.roomTime'),
    dbRead: t('ops.meter.dbRead'), dbWritten: t('ops.meter.dbWritten'), dbSize: t('ops.meter.dbSize'), files: t('ops.meter.files'),
    filesWritten: t('ops.meter.filesWritten'), filesRead: t('ops.meter.filesRead'), relay: t('ops.meter.relay'),
    mailDay: t('ops.meter.mail'), mailMonth: t('ops.meter.mail'),
  }

  const money = health && !('error' in health.money) ? health.money : null
  const stripeCount = money ? Object.values(money.payments).reduce((n, sum) => n + sum.count, 0) : 0
  // Payments Stripe has that the Atrium didn't record: a webhook missed.
  const missing = money?.moved && money.recorded ? Math.max(0, stripeCount - money.recorded.count) : 0

  return (
    <div className="modal-backdrop fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000300] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-xl w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-1">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">{t('ops.title')}</h3>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="ml-auto px-3 py-1 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors disabled:opacity-30"
          >
            {busy ? t('common.loading') : t('ops.refresh')}
          </button>
        </div>
        <p className="text-nier-bg/70 text-[9px] tracking-wider mb-5">
          {health ? t('ops.asOf', { time: new Date(health.at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' }) }) : `${t('common.loading')}…`}
        </p>

        {health && (
          <>
            <Heading label={t('ops.money')} />
            {'error' in health.money ? (
              <p className="text-red-400 text-[10px] tracking-wide mb-5">{health.money.error}</p>
            ) : (
              <div className="space-y-1.5 mb-6 text-[11px]">
                {Object.keys(health.money.payments).length === 0 && <Line label={t('ops.payments')} value="0" />}
                {Object.entries(health.money.payments).map(([currency, sum]) => (
                  <div key={currency} className="space-y-1.5">
                    <Line label={t('ops.payments')} value={`${number(sum.count)} · ${amount(sum.amount, currency)}`} />
                    <Line label={t('ops.fees')} value={amount(sum.fee, currency)} />
                    <Line label={t('ops.net')} value={amount(sum.net, currency)} />
                  </div>
                ))}
                {Object.entries(health.money.refunds).map(([currency, sum]) => (
                  <Line key={currency} label={t('ops.refunds')} value={`${number(sum.count)} · ${amount(sum.amount, currency)}`} />
                ))}
                <Line label={t('ops.balance')} value={t('ops.balanceValue', { available: amounts(health.money.available), pending: amounts(health.money.pending) })} />
                <Line label={t('ops.monthly')} value={number(health.money.monthlyContributors)} />
                <Line
                  label={t('ops.lastEvent')}
                  value={health.money.lastEvent ? new Date(health.money.lastEvent).toLocaleString(language) : t('ops.never')}
                  warn={!health.money.lastEvent}
                />
                {health.money.moved ? (
                  <Line label={t('ops.recorded')} value={number(health.money.recorded?.count ?? 0)} warn={missing > 0} />
                ) : (
                  <p className="text-[9px] tracking-wider leading-relaxed pt-1" style={{ color: '#E8C15A' }}>{t('ops.notMoved')}</p>
                )}
                {missing > 0 && (
                  <div className="pt-1">
                    <p className="text-[9px] tracking-wider leading-relaxed mb-2" style={{ color: '#E8C15A' }}>
                      {t('ops.mismatch', { stripe: stripeCount, recorded: health.money.recorded?.count ?? 0 })}
                    </p>
                    <button
                      type="button"
                      onClick={copyMissing}
                      disabled={busy}
                      className="px-3 py-1 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors disabled:opacity-30"
                    >
                      {t('ops.copyMissing')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <Heading label={t('ops.limits')} />
            <div className="space-y-3">
              {health.meters.map(meter => {
                const share = meter.limit && meter.used !== undefined ? meter.used / meter.limit : 0
                const colour = share >= AT ? '#FF6161' : share >= NEAR ? '#E8C15A' : 'rgb(var(--c-fg) / 0.75)'
                return (
                  <div key={meter.key}>
                    <div className="flex justify-between gap-3 text-[10px] tracking-wide">
                      <span className="text-nier-bg/80">{LABEL[meter.key] ?? meter.key}</span>
                      {meter.error === undefined && meter.used !== undefined && (
                        <span className="tabular-nums shrink-0" style={{ color: share >= NEAR ? colour : undefined }}>
                          {meter.limit === null
                            ? t('ops.noLimit', { used: measure(meter.used, meter.unit), per: PER[meter.per] })
                            : t('ops.of', { used: measure(meter.used, meter.unit), limit: measure(meter.limit, meter.unit), per: PER[meter.per] })}
                        </span>
                      )}
                    </div>
                    {meter.error !== undefined ? (
                      <p className="text-red-400/80 text-[9px] tracking-wide mt-1 break-words">{meter.error}</p>
                    ) : meter.limit !== null && (
                      <div className="h-[3px] mt-1.5 bg-nier-border/15">
                        <div className="h-full" style={{ width: `${Math.min(100, share * 100)}%`, background: colour }} />
                      </div>
                    )}
                    {!!meter.over && <p className="text-red-400 text-[9px] tracking-wide mt-1">{t('ops.ranOut', { count: number(meter.over) })}</p>}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {notice && (
          <div className="bg-nier-black border border-nier-border/20 p-3 mt-4">
            <p className="text-green-400 text-[10px] tracking-wide">{notice}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mt-4">
            <p className="text-red-400 text-[10px] tracking-wide">{error}</p>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-5 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}

function Heading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-nier-bg/80 text-[9px] tracking-[0.2em] uppercase">{label}</span>
      <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
    </div>
  )
}

function Line({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-nier-bg/70">{label}</span>
      <span className="text-nier-bg tabular-nums text-right" style={warn ? { color: '#E8C15A' } : undefined}>{value}</span>
    </div>
  )
}
