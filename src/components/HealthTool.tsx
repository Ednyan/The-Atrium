import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import { formatMoney } from '../lib/currency'
import { isCurrencyCode } from '../../supabase/functions/_shared/currencies.ts'
import { toWorker } from '../lib/worker'
import { Brackets, Heading } from './landing/parts'

// The Atrium's health, as the worker reports it (workers/rooms, ops.ts) to
// the operator alone: in full in Developers > Health -- money, every
// free-plan limit today and over 30 days, Stripe's movements and key, the
// worker's setup, how much the Atrium is used -- and, from the names panel,
// the month's money in a few lines (MoneyPopup).

interface Meter {
  key: string
  used?: number
  limit: number | null
  unit: 'count' | 'bytes' | 'ms' | 'gbs'
  per: 'day' | 'month' | 'total' | 'request' | '31 days'
  // Requests stopped for going past it (the CPU's).
  over?: number
  typical?: number
  // When it was counted, if not just now.
  at?: number
  error?: string
}
interface Day { date: string; value: number }
interface Failed { error: string }
interface Movement { id: string; at: number; type: string; amount: number; fee: number; net: number; currency: string; pending: boolean; description: string | null }
interface Money {
  available: { amount: number; currency: string }[]
  pending: { amount: number; currency: string }[]
  payments: Record<string, { count: number; amount: number; fee: number; net: number }>
  refunds: Record<string, { count: number; amount: number }>
  recorded: { count: number; cents: number } | null
  monthlyContributors: number
  lastEvent: number | null
  moved: number | null
  // In full only.
  currency?: string
  daily?: Day[]
  months?: Day[]
  goalCents?: number
  movements?: Movement[]
}
interface Usage {
  accounts: { kind: string; count: number; recent: number }[]
  logins: { count?: number; confirmed?: number }
  signedInThisWeek: number
  hosted: { atriums?: number; bytes?: number; owners?: number }
  publicAtriums: number
  mirroredBytes: number
  invites: number
  bans: number
  contributions: { count?: number; live?: number }
  // Would people buy the paid plan; from a worker older than this, none.
  interest?: { kind: string; answer: string; count: number }[]
}
interface Health {
  at: number
  money: Money | Failed
  meters?: Meter[]
  history?: { key: string; limit: number; days?: Day[]; error?: string }[]
  key?: { name: string; state: 'allowed' | 'missing' | 'refused' | 'unknown' }[] | Failed
  usage?: Usage | Failed
  setup?: { secrets: { name: string; set: boolean }[]; relayBudgetGb: number; storeQuotaMb: number }
}

const failed = (value: unknown): value is Failed => !!value && typeof value === 'object' && 'error' in value
// Amber past this share of a limit, red past the next.
const NEAR = 0.7
const AT = 0.9
const AMBER = 'rgb(var(--c-amber))'
const DANGER = 'rgb(var(--c-danger))'
const GOOD = 'rgb(var(--c-emerald))'
const BUTTON = 'px-3 py-1.5 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/70 hover:text-nier-strong transition-colors disabled:opacity-30'

// The report asked for, kept, and asked again on Refresh.
function useHealth(what: 'money' | 'health') {
  const { t } = useTranslation()
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const { ok, answer } = await toWorker(`/ops/${what}`, {}, true)
      if (!ok) throw new Error(answer?.error || t('names.requestFailed'))
      setHealth(answer)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => { void load() }, [])
  return { health, error, busy, load }
}

// Numbers as the reader's language writes them.
function useFormat() {
  const { language } = useTranslation()
  const number = (value: number, digits = 0) => new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value)
  const compact = (value: number) => new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const money = (minor: number, currency: string, whole = false) => {
    const code = currency.toUpperCase()
    return isCurrencyCode(code) ? formatMoney(minor, code, { locale: language, whole }) : `${(minor / 100).toFixed(whole ? 0 : 2)} ${code}`
  }
  const bytes = (value: number) => (value >= 1e9 ? `${number(value / 1e9, 2)} GB` : `${number(value / 1e6, 1)} MB`)
  const measure = (value: number, unit: Meter['unit']) =>
    unit === 'bytes' ? bytes(value) : unit === 'ms' ? `${number(value, 1)} ms` : unit === 'gbs' ? `${number(value)} GB-s` : number(value)
  const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(language, { month: 'short', day: 'numeric' })
  const month = (date: string) => new Date(`${date}-15T12:00:00Z`).toLocaleDateString(language, { month: 'short', year: 'numeric' })
  const when = (ms: number) => new Date(ms).toLocaleString(language, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return { number, compact, money, bytes, measure, day, month, when, language }
}

// A copy of what Supabase alone recorded (moderate-contributors' export): a
// payment the worker's webhook missed.
async function copyMissing(t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  const { ok, answer } = await toWorker('/contributions/ops', { action: 'move' }, true)
  if (!ok) throw new Error(answer?.error || t('names.requestFailed'))
  return t('ops.copied', { count: answer?.added ?? 0 })
}

// A state said twice: its symbol in the state's colour, its word in the text's.
function Mark({ symbol, colour, children }: { symbol: string; colour: string; children: ReactNode }) {
  return <span className="whitespace-nowrap"><span aria-hidden="true" style={{ color: colour }}>{symbol}</span> {children}</span>
}

function Line({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-nier-bg/70">{label}</span>
      <span className="text-nier-strong tabular-nums text-right">{warn ? <Mark symbol="△" colour={AMBER}>{value}</Mark> : value}</span>
    </div>
  )
}

// The month's money: what came in through Stripe, what's waiting there, who
// gives monthly, and whether the Atrium recorded every payment -- concise,
// as the names panel shows it, or line by line.
function MoneyLines({ money, concise, onCopy, busy }: { money: Money; concise?: boolean; onCopy: () => void; busy: boolean }) {
  const { t } = useTranslation()
  const f = useFormat()
  const amounts = (list: { amount: number; currency: string }[]) => list.map(entry => f.money(entry.amount, entry.currency)).join(' + ') || f.money(0, 'eur')
  const paidCount = Object.values(money.payments).reduce((n, sum) => n + sum.count, 0)
  // Payments Stripe has that the Atrium didn't record: a webhook missed.
  const missing = money.moved && money.recorded ? Math.max(0, paidCount - money.recorded.count) : 0
  const payments = Object.entries(money.payments)
  return (
    <div className="space-y-2 text-xs">
      {payments.length === 0 && <Line label={t('ops.payments')} value="0" />}
      {payments.map(([currency, sum]) => concise ? (
        <Line key={currency} label={t('ops.payments')} value={t('health.monthLine', { count: f.number(sum.count), amount: f.money(sum.amount, currency), net: f.money(sum.net, currency) })} />
      ) : (
        <div key={currency} className="space-y-2">
          <Line label={t('ops.payments')} value={`${f.number(sum.count)} · ${f.money(sum.amount, currency)}`} />
          <Line label={t('ops.fees')} value={f.money(sum.fee, currency)} />
          <Line label={t('ops.net')} value={f.money(sum.net, currency)} />
        </div>
      ))}
      {Object.entries(money.refunds).map(([currency, sum]) => (
        <Line key={currency} label={t('ops.refunds')} value={`${f.number(sum.count)} · ${f.money(sum.amount, currency)}`} />
      ))}
      <Line label={t('ops.balance')} value={t('ops.balanceValue', { available: amounts(money.available), pending: amounts(money.pending) })} />
      <Line label={t('ops.monthly')} value={f.number(money.monthlyContributors)} />
      <Line label={t('ops.lastEvent')} value={money.lastEvent ? f.when(money.lastEvent) : t('ops.never')} warn={!money.lastEvent} />
      {money.moved
        ? <Line label={t('ops.recorded')} value={f.number(money.recorded?.count ?? 0)} warn={missing > 0} />
        : <p className="text-[10px] tracking-wide leading-relaxed pt-1 text-nier-bg/80"><Mark symbol="△" colour={AMBER}>{null}</Mark> {t('ops.notMoved')}</p>}
      {missing > 0 && (
        <div className="pt-1">
          <p className="text-[10px] tracking-wide leading-relaxed mb-2 text-nier-bg/80">
            <Mark symbol="△" colour={AMBER}>{null}</Mark> {t('ops.mismatch', { stripe: paidCount, recorded: money.recorded?.count ?? 0 })}
          </p>
          <button type="button" onClick={onCopy} disabled={busy} className={BUTTON}>{t('ops.copyMissing')}</button>
        </div>
      )}
    </div>
  )
}

// A share of a limit, said in words as well as in colour.
function Status({ share }: { share: number }) {
  const { t } = useTranslation()
  if (share < NEAR) return null
  return (
    <span className="ml-2 text-[9px] tracking-[0.15em] uppercase text-nier-bg/80">
      {share >= AT ? <Mark symbol="▲" colour={DANGER}>{t('health.atLimit')}</Mark> : <Mark symbol="△" colour={AMBER}>{t('health.near')}</Mark>}
    </span>
  )
}

function useMeterNames() {
  const { t } = useTranslation()
  const per: Record<Meter['per'], string> = {
    day: t('ops.per.day'), month: t('ops.per.month'), total: t('ops.per.total'), request: t('ops.per.request'), '31 days': t('ops.per.31days'),
  }
  const name: Record<string, string> = {
    requests: t('ops.meter.requests'), cpu: t('ops.meter.cpu'), rooms: t('ops.meter.rooms'), roomTime: t('ops.meter.roomTime'),
    dbRead: t('ops.meter.dbRead'), dbWritten: t('ops.meter.dbWritten'), dbSize: t('ops.meter.dbSize'), files: t('ops.meter.files'),
    filesWritten: t('ops.meter.filesWritten'), filesRead: t('ops.meter.filesRead'), relay: t('ops.meter.relay'),
    mailDay: `${t('ops.meter.mail')} (Resend)`, mailMonth: `${t('ops.meter.mail')} (Resend)`, mailBrevo: `${t('ops.meter.mail')} (Brevo)`,
  }
  return { per, name }
}

function MeterRow({ meter }: { meter: Meter }) {
  const { t } = useTranslation()
  const f = useFormat()
  const { per, name } = useMeterNames()
  const ratio = meter.limit && meter.used !== undefined ? meter.used / meter.limit : 0
  // A limit that lets a request past it now and then (the CPU's) is reached
  // only once requests are stopped; until then, past it is only near.
  const share = meter.over === undefined ? ratio : meter.over > 0 ? 1 : Math.min(ratio, NEAR)
  const fill = share >= AT ? DANGER : share >= NEAR ? AMBER : 'rgb(var(--c-fg) / 0.7)'
  return (
    <div data-meter={meter.key}>
      <div className="flex justify-between gap-3 text-[11px] tracking-wide">
        <span className="text-nier-bg/80">{name[meter.key] ?? meter.key}</span>
        {meter.error === undefined && meter.used !== undefined && (
          <span className="tabular-nums shrink-0 text-nier-strong text-right">
            {meter.limit === null
              ? t('ops.noLimit', { used: f.measure(meter.used, meter.unit), per: per[meter.per] })
              : t('ops.of', { used: f.measure(meter.used, meter.unit), limit: f.measure(meter.limit, meter.unit), per: per[meter.per] })}
            <Status share={share} />
          </span>
        )}
      </div>
      {meter.error !== undefined ? (
        <p className="text-[10px] tracking-wide mt-1 break-words" style={{ color: DANGER }}>{meter.error}</p>
      ) : meter.limit !== null && (
        <div className="h-[3px] mt-1.5 bg-nier-border/20">
          <div className="h-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: fill }} />
        </div>
      )}
      {!!meter.over && <p className="text-[10px] tracking-wide mt-1" style={{ color: DANGER }}>{t('ops.ranOut', { count: f.number(meter.over) })}</p>}
      {meter.over === 0 && ratio >= 1 && <p className="text-[10px] tracking-wide mt-1 text-nier-bg/65 leading-relaxed">{t('health.noneStopped')}</p>}
      {meter.typical !== undefined && meter.error === undefined && <p className="text-[10px] tracking-wide mt-1 text-nier-bg/65">{t('health.typical', { value: f.measure(meter.typical, meter.unit) })}</p>}
      {meter.at && meter.error === undefined && <p className="text-[10px] tracking-wide mt-1 text-nier-bg/55">{t('health.countedAt', { time: f.when(meter.at) })}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- a chart

const niceTop = (value: number) => {
  const step = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 2.5, 5, 10].map(n => n * step).find(n => n >= value) ?? value
}

// A value a day (or a month) as columns, with the line it mustn't cross --
// drawn where it is, or named when it's far above everything. Each column
// says its value when pointed at; the same values as a table beneath.
function Columns({ title, days, line, lineLabel, format, axis, label }: {
  title: string
  days: Day[]
  line?: number
  lineLabel?: (value: string) => string
  format: (value: number) => string
  // The scale's numbers, short (compact counts unless said).
  axis?: (value: number) => string
  label: (date: string) => string
}) {
  const { t } = useTranslation()
  const f = useFormat()
  const [hover, setHover] = useState<number | null>(null)
  const W = 560, H = 160, LEFT = 46, BOTTOM = 22, TOP = 14
  const highest = Math.max(1, ...days.map(day => day.value))
  // The line on the scale only when it's near enough to compare with.
  const lineShown = line !== undefined && line <= highest * 4
  const top = niceTop(Math.max(highest, lineShown ? line! : 0) * 1.08)
  const y = (value: number) => TOP + (H - TOP - BOTTOM) * (1 - value / top)
  const slot = (W - LEFT) / days.length
  const width = Math.min(24, slot * 0.62)
  const xOf = (i: number) => LEFT + i * slot + (slot - width) / 2
  const column = (i: number, value: number) => {
    const x = xOf(i), bottom = y(0), h = Math.max(0, bottom - y(value)), r = Math.min(4, h / 2, width / 2)
    return `M${x},${bottom}V${bottom - h + r}Q${x},${bottom - h} ${x + r},${bottom - h}H${x + width - r}Q${x + width},${bottom - h} ${x + width},${bottom - h + r}V${bottom}Z`
  }
  const ticks = [0, top / 2, top]
  const marks = [0, Math.floor((days.length - 1) / 2), days.length - 1]
  const pointed = hover === null ? null : days[hover]
  return (
    <figure data-chart={title} className="relative">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
        <span className="text-nier-strong text-[11px] tracking-[0.12em] uppercase">{title}</span>
        {line !== undefined && lineLabel && !lineShown && <span className="text-nier-bg/60 text-[10px] tracking-wide">{lineLabel((axis ?? f.compact)(line))}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label={title} onPointerLeave={() => setHover(null)}>
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={LEFT} x2={W} y1={y(tick)} y2={y(tick)} stroke="rgb(var(--c-line) / 0.25)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={LEFT - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="rgb(var(--c-fg) / 0.6)" className="tabular-nums">{(axis ?? f.compact)(tick)}</text>
          </g>
        ))}
        {days.map((day, i) => (
          <path key={day.date} d={column(i, day.value)} fill={hover === i ? 'rgb(var(--c-strong))' : 'rgb(var(--c-fg) / 0.55)'} />
        ))}
        {lineShown && (
          <g>
            <line x1={LEFT} x2={W} y1={y(line!)} y2={y(line!)} stroke="rgb(var(--c-strong) / 0.75)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={W} y={y(line!) - 5} textAnchor="end" fontSize={10} fill="rgb(var(--c-fg) / 0.8)">{lineLabel?.((axis ?? f.compact)(line!))}</text>
          </g>
        )}
        {marks.map(i => days[i] && (
          <text key={i} x={xOf(i) + width / 2} y={H - 6} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} fontSize={10} fill="rgb(var(--c-fg) / 0.6)">{label(days[i].date)}</text>
        ))}
        {/* The whole slot answers, not only the painted column. */}
        {days.map((day, i) => (
          <rect key={day.date} x={LEFT + i * slot} y={TOP} width={slot} height={H - TOP - BOTTOM} fill="transparent" onPointerEnter={() => setHover(i)} />
        ))}
      </svg>
      {pointed && (
        <div
          role="status"
          className="absolute pointer-events-none border border-nier-border/40 px-2.5 py-1.5 text-[11px] whitespace-nowrap -translate-x-1/2"
          style={{ left: `${((xOf(hover!) + width / 2) / W) * 100}%`, top: 24, backgroundColor: 'rgb(var(--c-surface))' }}
        >
          <span className="block text-nier-strong tabular-nums">{format(pointed.value)}</span>
          <span className="block text-nier-bg/65 text-[10px]">{label(pointed.date)}</span>
        </div>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-nier-bg/60 text-[10px] tracking-[0.12em] uppercase hover:text-nier-strong">{t('health.asTable')}</summary>
        <table className="mt-2 w-full text-[11px] tabular-nums">
          <tbody>
            {days.map(day => (
              <tr key={day.date} className="border-t border-nier-border/15">
                <td className="py-1 text-nier-bg/70">{label(day.date)}</td>
                <td className="py-1 text-right text-nier-strong">{format(day.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  )
}

// ---------------------------------------------------------------- the panels

function Panel({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`relative ${className}`}>
      <Brackets inset="-0.35rem" />
      <div className="border border-nier-border/30 p-5 sm:p-6 h-full" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.75)' }}>
        <Heading>{title}</Heading>
        {children}
      </div>
    </section>
  )
}

function Tile({ label, value, detail, warn }: { label: string; value: string; detail?: string; warn?: boolean }) {
  return (
    <div className="border border-nier-border/25 px-4 py-3 min-w-0">
      <p className="text-nier-bg/65 text-[10px] tracking-[0.12em] uppercase">{label}</p>
      <p className="mt-1.5 text-nier-strong text-xl font-light truncate">{warn ? <Mark symbol="△" colour={AMBER}>{value}</Mark> : value}</p>
      {detail && <p className="mt-1 text-nier-bg/60 text-[10px] tracking-wide truncate">{detail}</p>}
    </div>
  )
}

const KINDS: Record<string, TranslationKey> = { charge: 'health.kind.payment', payment: 'health.kind.payment', refund: 'health.kind.refund', payment_refund: 'health.kind.refund', payout: 'health.kind.payout', stripe_fee: 'health.kind.fee' }

/** Developers > Health: everything a developer needs to know of the Atrium's health. */
const interestOf = (usage: Usage, kind: string, answer: string) => usage.interest?.find(row => row.kind === kind && row.answer === answer)?.count ?? 0

export default function HealthTool() {
  const { t } = useTranslation()
  const f = useFormat()
  const { name } = useMeterNames()
  const { health, error, busy, load } = useHealth('health')
  const [note, setNote] = useState('')
  const copy = () => void copyMissing(t).then(done => { setNote(done); return load() }, e => setNote(e.message))

  const money = health && !failed(health.money) ? health.money : null
  const meters = health?.meters ?? []
  const closest = meters.filter(m => m.limit && m.used !== undefined).sort((a, b) => b.used! / b.limit! - a.used! / a.limit!)[0]
  const currency = money?.currency ?? 'eur'
  const thisMonth = money?.payments[currency]
  const chartNames: Record<string, string> = {
    requests: t('health.chart.requests'), rooms: t('health.chart.rooms'), dbWritten: t('health.chart.dbWritten'), dbRead: t('health.chart.dbRead'),
  }
  const usage = health?.usage && !failed(health.usage) ? health.usage : null
  const KIND_NAMES: Record<string, string> = { google: t('health.usage.google'), email: t('health.usage.email'), supabase: t('health.usage.supabase') }

  return (
    <div data-health-tool="" className="space-y-8" style={{ opacity: busy && health ? 0.6 : 1, transition: 'opacity 200ms' }}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 min-w-[14rem] text-nier-bg/65 text-[11px] tracking-wide">
          {health ? t('ops.asOf', { time: new Date(health.at).toLocaleTimeString(f.language, { hour: '2-digit', minute: '2-digit' }) }) : `${t('common.loading')}…`}
        </p>
        <button type="button" onClick={() => void load()} disabled={busy} className={BUTTON}>{busy ? t('common.loading') : t('ops.refresh')}</button>
      </div>
      {error && <p role="alert" className="text-xs" style={{ color: DANGER }}>{error}</p>}
      {note && <p role="status" className="text-xs text-nier-bg/80">{note}</p>}

      {health && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label={t('health.receivedMonth')} value={money ? f.money(thisMonth?.net ?? 0, currency) : '—'} detail={thisMonth ? f.money(thisMonth.amount, currency) : undefined} />
            <Tile label={t('health.paymentsMonth')} value={money ? f.number(thisMonth?.count ?? 0) : '—'} detail={money ? `${t('ops.monthly')}: ${f.number(money.monthlyContributors)}` : undefined} />
            <Tile
              label={t('health.closest')}
              value={closest ? `${f.number((closest.used! / closest.limit!) * 100)}%` : '—'}
              detail={closest ? name[closest.key] : undefined}
              warn={!!closest && closest.used! / closest.limit! >= NEAR}
            />
            <Tile label={t('ops.lastEvent')} value={money?.lastEvent ? f.when(money.lastEvent) : t('health.never')} warn={!!money && !money.lastEvent} />
          </div>

          <Panel title={t('ops.limits')}>
            <div className="grid md:grid-cols-2 gap-x-10 gap-y-4">
              {meters.map(meter => <MeterRow key={meter.key} meter={meter} />)}
            </div>
          </Panel>

          <Panel title={t('health.history')}>
            <div className="grid md:grid-cols-2 gap-x-10 gap-y-8">
              {(health.history ?? []).map(chart => chart.error !== undefined ? (
                <div key={chart.key}>
                  <p className="text-nier-strong text-[11px] tracking-[0.12em] uppercase mb-2">{chartNames[chart.key]}</p>
                  <p className="text-[10px] tracking-wide break-words" style={{ color: DANGER }}>{chart.error}</p>
                </div>
              ) : (
                <Columns key={chart.key} title={chartNames[chart.key]} days={chart.days!} line={chart.limit} lineLabel={value => t('health.limitLine', { value })} format={value => f.number(value)} label={f.day} />
              ))}
              {money?.daily && (
                <Columns title={t('health.chart.money')} days={money.daily} format={value => f.money(value, currency)} axis={value => f.money(value, currency, true)} label={f.day} />
              )}
              {money?.months && (
                <Columns
                  title={t('health.chart.months')}
                  days={money.months}
                  line={money.goalCents}
                  lineLabel={value => t('health.goalLine', { value })}
                  format={value => f.money(value, 'eur')}
                  axis={value => f.money(value, 'eur', true)}
                  label={f.month}
                />
              )}
            </div>
          </Panel>

          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-8">
            <Panel title={t('health.stripe')}>
              {failed(health.money) ? (
                <p className="text-xs" style={{ color: DANGER }}>{health.money.error}</p>
              ) : (
                <MoneyLines money={health.money} onCopy={copy} busy={busy} />
              )}
              <div className="mt-6">
                <p className="text-nier-strong text-[11px] tracking-[0.12em] uppercase mb-3">{t('health.key')}</p>
                {!health.key ? null : failed(health.key) ? (
                  <p className="text-xs" style={{ color: DANGER }}>{health.key.error}</p>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {health.key.map(({ name, state }) => (
                      <li key={name} data-permission={name} className="flex justify-between gap-3">
                        <span className="text-nier-bg/75">{name}</span>
                        <span className="text-nier-strong">
                          <Mark symbol={state === 'allowed' ? '✓' : state === 'unknown' ? '?' : '✕'} colour={state === 'allowed' ? GOOD : state === 'unknown' ? AMBER : DANGER}>
                            {t(`health.key.${state}` as TranslationKey)}
                          </Mark>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Panel>

            <Panel title={t('health.movements')}>
              {!money?.movements?.length ? (
                <p className="text-nier-bg/65 text-xs">{money ? t('health.noMovements') : '—'}</p>
              ) : (
                <div className="max-h-[26rem] overflow-y-auto -mx-1 px-1">
                  <table className="w-full text-[11px] tabular-nums">
                    <thead className="text-nier-bg/60 text-[10px] tracking-[0.1em] uppercase">
                      <tr>
                        <th className="text-left font-normal pb-2">{t('health.col.date')}</th>
                        <th className="text-left font-normal pb-2">{t('health.col.kind')}</th>
                        <th className="text-right font-normal pb-2">{t('health.col.amount')}</th>
                        <th className="text-right font-normal pb-2 hidden sm:table-cell">{t('health.col.fee')}</th>
                        <th className="text-right font-normal pb-2">{t('health.col.net')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {money.movements.map(move => (
                        <tr key={move.id} className="border-t border-nier-border/15" title={move.description ?? undefined}>
                          <td className="py-1.5 pr-2 text-nier-bg/75 whitespace-nowrap">{f.when(move.at)}</td>
                          <td className="py-1.5 pr-2 text-nier-bg/85">
                            {KINDS[move.type] ? t(KINDS[move.type]) : move.type}
                            {move.pending && <span className="ml-1.5 text-nier-bg/55 text-[9px] uppercase tracking-wider">{t('health.pending')}</span>}
                          </td>
                          <td className="py-1.5 text-right text-nier-strong">{f.money(move.amount, move.currency)}</td>
                          <td className="py-1.5 text-right text-nier-bg/70 hidden sm:table-cell">{f.money(move.fee, move.currency)}</td>
                          <td className="py-1.5 text-right text-nier-strong">{f.money(move.net, move.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <Panel title={t('health.usage')}>
            {failed(health.usage) ? (
              <p className="text-xs" style={{ color: DANGER }}>{health.usage.error}</p>
            ) : usage && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {usage.accounts.map(({ kind, count, recent }) => (
                  <Tile key={kind} label={KIND_NAMES[kind] ?? kind} value={f.number(count)} detail={t('health.usage.newThisWeek', { count: f.number(recent) })} />
                ))}
                <Tile label={t('health.usage.signedIn')} value={f.number(usage.signedInThisWeek)} detail={t('health.usage.confirmed', { confirmed: f.number(usage.logins.confirmed ?? 0), count: f.number(usage.logins.count ?? 0) })} />
                <Tile label={t('health.usage.hosted')} value={f.number(usage.hosted.atriums ?? 0)} detail={t('health.usage.hostedDetail', { owners: f.number(usage.hosted.owners ?? 0), size: f.bytes(usage.hosted.bytes ?? 0) })} />
                <Tile label={t('health.usage.public')} value={f.number(usage.publicAtriums)} detail={t('health.usage.publicDetail', { size: f.bytes(usage.mirroredBytes) })} />
                <Tile label={t('health.usage.invites')} value={f.number(usage.invites)} />
                <Tile label={t('health.usage.bans')} value={f.number(usage.bans)} />
                <Tile label={t('health.usage.contributions')} value={f.number(usage.contributions.count ?? 0)} detail={t('health.usage.contributionsDetail', { live: f.number(usage.contributions.live ?? 0) })} />
                <Tile label={t('health.interest.accounts')} value={t('health.interest.counts', { yes: f.number(interestOf(usage, 'account', 'yes')), no: f.number(interestOf(usage, 'account', 'no')) })} />
                <Tile label={t('health.interest.guests')} value={t('health.interest.counts', { yes: f.number(interestOf(usage, 'guest', 'yes')), no: f.number(interestOf(usage, 'guest', 'no')) })} />
              </div>
            )}
          </Panel>

          {health.setup && (
            <Panel title={t('health.setup')}>
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-1.5 text-[11px]">
                {health.setup.secrets.map(({ name, set }) => (
                  <li key={name} data-secret={name} className="flex justify-between gap-3">
                    <span translate="no" className="text-nier-bg/75 truncate">{name}</span>
                    <span className="shrink-0 text-nier-strong">
                      {set ? <Mark symbol="✓" colour={GOOD}>{t('health.set')}</Mark> : <Mark symbol="✕" colour={AMBER}>{t('health.unset')}</Mark>}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 pt-4 border-t border-nier-border/15 grid sm:grid-cols-2 gap-x-8 gap-y-1.5 text-[11px]">
                <Line label={t('health.relayBudget')} value={`${f.number(health.setup.relayBudgetGb)} GB`} />
                <Line label={t('health.storeQuota')} value={`${f.number(health.setup.storeQuotaMb)} MB`} />
                <Line label={t('health.moved')} value={money?.moved ? f.when(money.moved) : t('health.notYet')} warn={!!money && !money.moved} />
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  )
}

/** The names panel's look at the month's money: a few lines, the rest in Developers. */
export function MoneyPopup({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const f = useFormat()
  const { health, error, busy, load } = useHealth('money')
  const [note, setNote] = useState('')
  const copy = () => void copyMissing(t).then(done => { setNote(done); return load() }, e => setNote(e.message))
  return (
    <div className="modal-backdrop fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000300] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative max-h-[85vh] overflow-y-auto">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
        <div className="flex items-center gap-3 mb-1">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">{t('ops.title')}</h3>
          <button type="button" onClick={() => void load()} disabled={busy} className={`ml-auto ${BUTTON}`}>{busy ? t('common.loading') : t('ops.refresh')}</button>
        </div>
        <p className="text-nier-bg/65 text-[10px] tracking-wider mb-5">
          {health ? `${t('ops.money')} · ${new Date(health.at).toLocaleTimeString(f.language, { hour: '2-digit', minute: '2-digit' })}` : `${t('common.loading')}…`}
        </p>
        {health && (failed(health.money)
          ? <p className="text-xs" style={{ color: DANGER }}>{health.money.error}</p>
          : <MoneyLines money={health.money} concise onCopy={copy} busy={busy} />)}
        {(error || note) && <p role="status" className="mt-4 text-[11px]" style={{ color: error ? DANGER : undefined }}>{error || note}</p>}
        <p className="mt-5 text-nier-bg/55 text-[10px] tracking-wide">{t('health.more')}</p>
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-4 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}
