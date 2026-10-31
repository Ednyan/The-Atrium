// What the operator is shown of the Atrium's health. Two answers:
//
//   /ops/money   the month's money through Stripe beside what the Atrium
//                recorded -- the names panel's short look (components/HealthTool, MoneyPopup)
//   /ops/health  everything a developer needs (Developers > Health): that,
//                with the last 30 days of it, Stripe's movements and whether
//                the key may do what the worker asks of it; every free-plan
//                limit, today and over 30 days; the worker's setup; and how
//                much the Atrium is used
//
// Every figure is asked on its own, so one that can't be had is said in its
// place and the rest still show. Cloudflare's daily limits reset at 00:00
// UTC, its monthly ones on the 1st; past one on the free plan, what it
// limits fails until then (docs/SCALING.md). Resend's are its own, and it
// says them.

import { ACTIVE_MS, DEFAULT_GOAL_CENTS, GOAL, LAST_EVENT, MOVED, monthStart, stripe } from './contributions'
import { MAIL_COUNTS, SENT_TODAY } from './mail'
import { isOperator, setting, tablesIn } from './people'
import { graph, relayBudget, relayedBytes } from './relay'
import { replies, whoIs, type Env } from './who'

const DAY_MS = 24 * 60 * 60 * 1000
const GB = 1e9
const DAYS = 30
// The worker (wrangler.toml), and its database: one database may hold 500 MB on the free plan.
const SCRIPT = 'atrium-rooms'
const DATABASE_ID = '98e3f3c7-95f3-4482-b0b2-f8be13c26562'
// R2's operations: these free, these class B (reads); the rest class A.
const R2_FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload'])
const R2_CLASS_B = new Set(['HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration'])
// What the worker is given, by name only -- never a value.
const SECRETS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'RESEND_API_KEY', 'BREVO_API_KEY', 'GOOGLE_CLIENT_SECRET', 'SUPABASE_WORKER_KEY',
  'CF_ACCOUNT_ID', 'CF_ANALYTICS_TOKEN', 'CF_TURN_KEY_ID', 'CF_TURN_KEY_TOKEN', 'PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET'] as const
// What the worker asks of Stripe, each tried in a way that changes nothing: a
// write sent empty (refused for what's missing in it, if the key may write),
// a cancellation of no subscription, a read of one. Stripe's names for them.
const PERMISSIONS: [name: string, method: 'GET' | 'POST' | 'DELETE', path: string][] = [
  ['Checkout Sessions: write', 'POST', 'checkout/sessions'],
  ['Charges and Refunds: write', 'POST', 'refunds'],
  ['Subscriptions: write', 'DELETE', 'subscriptions/sub_atrium_check'],
  ['Payment Intents: read', 'GET', 'payment_intents?limit=1'],
  ['Balance: read', 'GET', 'balance_transactions?limit=1'],
  ['Invoices: read', 'GET', 'invoices?limit=1'],
]

export interface Meter {
  key: string
  used?: number
  // Null: no limit (Resend's, on a paid plan).
  limit: number | null
  unit: 'count' | 'bytes' | 'ms' | 'gbs'
  per: 'day' | 'month' | 'total' | 'request' | '31 days'
  // Requests stopped for going past it (the CPU's): its only hard edge --
  // Cloudflare lets a request run over now and then.
  over?: number
  // The middle request's, beside the slowest 1%'s (the CPU's): what most cost.
  typical?: number
  // When it was counted, if not just now (Resend's, as the last email brought it).
  at?: number
  error?: string
}
type Shown = Omit<Meter, 'used' | 'over' | 'error'>
interface Day { date: string; value: number }

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))
// Each part on its own: its answer, or why not.
const part = <T>(work: () => Promise<T>) => work().catch(error => ({ error: said(error) }))

export async function ops(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  let asked: { token?: unknown }
  try { asked = await request.json() } catch { return answer(400, { error: 'body' }) }
  const token = typeof asked.token === 'string' ? asked.token : null
  const who = await whoIs(token, env)
  if (!who) return answer(401, { error: 'Not signed in' })
  // Whether one is the operator: what the app asks to show one the operator's tools.
  if (what === 'operator') return answer(200, { operator: await isOperator(env, who, token!) })
  if (!(await isOperator(env, who, token!))) return answer(403, { error: 'Not allowed' })
  const now = Date.now()
  if (what === 'money') return answer(200, { at: now, money: await part(() => moneyOf(env, now, false)) })
  if (what !== 'health') return answer(404, { error: 'no such thing' })
  const [money, meters, history, key, usage] = await Promise.all([
    part(() => moneyOf(env, now, true)),
    metersOf(env, now),
    historyOf(env, now),
    part(() => keyCheck(env)),
    part(() => usageOf(env, now)),
  ])
  return answer(200, { at: now, money, meters, history, key, usage, setup: setupOf(env) })
}

// ---------------------------------------------------------------- money

interface Movement { id: string; at: number; type: string; amount: number; fee: number; net: number; currency: string; pending: boolean; description: string | null }

// Stripe's balance movements since then, newest first.
async function movementsSince(env: Env, from: number): Promise<Movement[]> {
  const movements: Movement[] = []
  let after = ''
  // ponytail: 20 pages of 100 -- past 2,000 movements in 30 days, ask Stripe's reports instead.
  for (let page = 0; page < 20; page++) {
    const list = await stripe(env, 'GET', `balance_transactions?limit=100&created[gte]=${Math.floor(from / 1000)}${after}`)
    for (const move of list.data ?? []) {
      movements.push({ id: move.id, at: move.created * 1000, type: move.type, amount: move.amount, fee: move.fee, net: move.net,
        currency: move.currency, pending: move.status === 'pending', description: move.description ?? null })
    }
    if (!list.has_more || !list.data?.length) break
    after = `&starting_after=${list.data[list.data.length - 1].id}`
  }
  return movements
}

const PAID = new Set(['charge', 'payment'])
const REFUNDED = new Set(['refund', 'payment_refund'])

// This month's money, by currency: payments in -- with Stripe's fee, and
// what's left -- and refunds out; beside what the webhook recorded. In
// detail, the last 30 days of it too, each month's against the goal, and the
// movements themselves.
async function moneyOf(env: Env, now: number, detail: boolean) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set on the worker')
  const db = env.PEOPLE!
  await tablesIn(db)
  const month = monthStart(new Date(now))
  const today = now - (now % DAY_MS)
  const from = detail ? Math.min(month, today - (DAYS - 1) * DAY_MS) : month
  const yearAgo = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 11, 1)
  const [balance, movements, recorded, monthly, lastEvent, moved, goal, months] = await Promise.all([
    stripe(env, 'GET', 'balance'),
    movementsSince(env, from),
    db.prepare(`select count(*) as count, coalesce(sum(settled_eur_cents), 0) as cents from contributions
      where livemode = 1 and stripe_event_id is not null and created_at >= ?`).bind(month).first<{ count: number; cents: number }>(),
    db.prepare(`select count(distinct stripe_subscription_id) as count from contributions
      where livemode = 1 and refunded = 0 and stripe_subscription_id is not null and created_at > ?`).bind(now - ACTIVE_MS).first<{ count: number }>(),
    setting(db, LAST_EVENT),
    setting(db, MOVED),
    setting(db, GOAL),
    detail ? db.prepare(`select strftime('%Y-%m', created_at / 1000, 'unixepoch') as month, coalesce(sum(settled_eur_cents), 0) as cents
      from contributions where livemode = 1 and refunded = 0 and counts_toward_goal = 1 and created_at >= ? group by month order by month`).bind(yearAgo).all<{ month: string; cents: number }>() : null,
  ])
  const payments: Record<string, { count: number; amount: number; fee: number; net: number }> = {}
  const refunds: Record<string, { count: number; amount: number }> = {}
  for (const move of movements.filter(move => move.at >= month)) {
    if (PAID.has(move.type)) {
      const sum = (payments[move.currency] ??= { count: 0, amount: 0, fee: 0, net: 0 })
      sum.count++; sum.amount += move.amount; sum.fee += move.fee; sum.net += move.net
    } else if (REFUNDED.has(move.type)) {
      const sum = (refunds[move.currency] ??= { count: 0, amount: 0 })
      sum.count++; sum.amount -= move.amount
    }
  }
  const summary = {
    available: balance.available ?? [],
    pending: balance.pending ?? [],
    payments,
    refunds,
    // What the webhook wrote this month: the same count as Stripe's payments, or one was missed.
    recorded,
    monthlyContributors: monthly?.count ?? 0,
    lastEvent: Number(lastEvent) || null,
    moved: Number(moved) || null,
  }
  if (!detail) return summary
  // The account's own currency: what the days are counted in.
  const currency = balance.available?.[0]?.currency ?? 'eur'
  const daily = new Map<string, number>()
  for (let day = today - (DAYS - 1) * DAY_MS; day <= today; day += DAY_MS) daily.set(new Date(day).toISOString().slice(0, 10), 0)
  for (const move of movements) {
    const date = new Date(move.at).toISOString().slice(0, 10)
    if (PAID.has(move.type) && move.currency === currency && daily.has(date)) daily.set(date, daily.get(date)! + move.net)
  }
  const byMonth = new Map((months?.results ?? []).map(row => [row.month, row.cents]))
  return {
    ...summary,
    currency,
    daily: [...daily].map(([date, value]) => ({ date, value })),
    months: [...Array(12)].map((_, i) => {
      const key = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7)
      return { date: key, value: byMonth.get(key) ?? 0 }
    }),
    goalCents: Number(goal) || DEFAULT_GOAL_CENTS,
    movements: movements.slice(0, 60),
  }
}

// Whether the key may do each thing the worker asks of Stripe: missing for
// a permission it lacks (403), refused for no such key (401), unknown if
// Stripe couldn't be asked.
async function keyCheck(env: Env) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set on the worker')
  return Promise.all(PERMISSIONS.map(async ([name, method, path]) => {
    const status = await stripe(env, method, path, method === 'GET' ? undefined : new URLSearchParams()).then(() => 200, error => (error as { status?: number }).status ?? 0)
    return { name, state: status === 403 ? 'missing' : status === 401 ? 'refused' : status === 0 || status >= 500 ? 'unknown' : 'allowed' }
  }))
}

// ---------------------------------------------------------------- limits

const at = (ms: number) => JSON.stringify(new Date(ms).toISOString())
const on = (ms: number) => JSON.stringify(new Date(ms).toISOString().slice(0, 10))
const total = (groups: any[] | undefined, field: string, of = 'sum') => (groups ?? []).reduce((n, group) => n + Number(group?.[of]?.[field] ?? 0), 0)

function metersOf(env: Env, now: number): Promise<Meter[]> {
  const today = now - (now % DAY_MS)
  const month = monthStart(new Date(now))
  const since = (from: number) => `datetime_geq: ${at(from)}, datetime_leq: ${at(now)}`
  const readings: [Shown[], () => Promise<Partial<Meter>[]>][] = [
    // Every request to a worker or a Pages function: one allowance for both.
    [[{ key: 'requests', limit: 100_000, unit: 'count', per: 'day' }], async () => {
      const [workers, pages] = await Promise.all([
        graph(env, `workersInvocationsAdaptive(limit: 10000, filter: { ${since(today)} }) { sum { requests } }`),
        graph(env, `pagesFunctionsInvocationsAdaptiveGroups(limit: 10000, filter: { ${since(today)} }) { sum { requests } }`),
      ])
      return [{ used: total(workers.workersInvocationsAdaptive, 'requests') + total(pages.pagesFunctionsInvocationsAdaptiveGroups, 'requests') }]
    }],
    // The worker's CPU a request (p99), against the 10 ms each may use; and how many ran out today.
    [[{ key: 'cpu', limit: 10, unit: 'ms', per: 'request' }], async () => {
      const account = await graph(env, `cpu: workersInvocationsAdaptive(limit: 1, filter: { scriptName: "${SCRIPT}", ${since(today)} }) { quantiles { cpuTimeP50 cpuTimeP99 } }
        over: workersInvocationsAdaptive(limit: 1, filter: { scriptName: "${SCRIPT}", status_in: ["exceededResources", "exceededCpu"], ${since(today)} }) { sum { requests } }`)
      const quantiles = account.cpu?.[0]?.quantiles
      return [{ used: Number(quantiles?.cpuTimeP99 ?? 0) / 1000, typical: Number(quantiles?.cpuTimeP50 ?? 0) / 1000, over: total(account.over, 'requests') }]
    }],
    [[{ key: 'rooms', limit: 100_000, unit: 'count', per: 'day' }], async () =>
      [{ used: total((await graph(env, `durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { date_geq: ${on(today)} }) { sum { requests } }`)).durableObjectsInvocationsAdaptiveGroups, 'requests') }]],
    // The rooms' time awake, at the 128 MB each is billed for.
    [[{ key: 'roomTime', limit: 13_000, unit: 'gbs', per: 'day' }], async () =>
      [{ used: (total((await graph(env, `durableObjectsPeriodicGroups(limit: 10000, filter: { date_geq: ${on(today)} }) { sum { activeTime } }`)).durableObjectsPeriodicGroups, 'activeTime') / 1e6) * 0.128 }]],
    [[{ key: 'dbRead', limit: 5_000_000, unit: 'count', per: 'day' }, { key: 'dbWritten', limit: 100_000, unit: 'count', per: 'day' }], async () => {
      const groups = (await graph(env, `d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: ${on(today)} }) { sum { rowsRead rowsWritten } }`)).d1AnalyticsAdaptiveGroups
      return [{ used: total(groups, 'rowsRead') }, { used: total(groups, 'rowsWritten') }]
    }],
    [[{ key: 'dbSize', limit: 500e6, unit: 'bytes', per: 'total' }], async () =>
      [{ used: total((await graph(env, `d1StorageAdaptiveGroups(limit: 1, filter: { databaseId: "${DATABASE_ID}", date_geq: ${on(today - DAY_MS)} }, orderBy: [date_DESC]) { max { databaseSizeBytes } dimensions { date } }`)).d1StorageAdaptiveGroups, 'databaseSizeBytes', 'max') }]],
    // Each bucket's newest size, together.
    [[{ key: 'files', limit: 10 * GB, unit: 'bytes', per: 'total' }], async () => {
      const groups = (await graph(env, `r2StorageAdaptiveGroups(limit: 1000, filter: { ${since(now - DAY_MS)} }, orderBy: [datetime_DESC]) { max { payloadSize metadataSize } dimensions { bucketName datetime } }`)).r2StorageAdaptiveGroups ?? []
      const newest = new Map<string, any>()
      for (const group of groups) if (!newest.has(group.dimensions?.bucketName)) newest.set(group.dimensions?.bucketName, group)
      return [{ used: [...newest.values()].reduce((n, group) => n + Number(group.max?.payloadSize ?? 0) + Number(group.max?.metadataSize ?? 0), 0) }]
    }],
    [[{ key: 'filesWritten', limit: 1_000_000, unit: 'count', per: 'month' }, { key: 'filesRead', limit: 10_000_000, unit: 'count', per: 'month' }], async () => {
      const groups = (await graph(env, `r2OperationsAdaptiveGroups(limit: 1000, filter: { ${since(month)} }) { sum { requests } dimensions { actionType } }`)).r2OperationsAdaptiveGroups ?? []
      let written = 0
      let read = 0
      for (const group of groups) {
        const action = group.dimensions?.actionType
        const count = Number(group.sum?.requests ?? 0)
        if (R2_CLASS_B.has(action)) read += count
        else if (!R2_FREE.has(action)) written += count
      }
      return [{ used: written }, { used: read }]
    }],
    // Where the relay stops giving passes (src/relay.ts), under the 1,000 GB it's free for.
    [[{ key: 'relay', limit: relayBudget(env), unit: 'bytes', per: '31 days' }], async () => [{ used: await relayedBytes(env) }]],
    // Resend's own count of everything sent with its key, Supabase's mail
    // too -- as the worker's last email brought it (src/mail.ts): today's
    // over a rolling 24 hours, the month's since the 1st.
    [[{ key: 'mailDay', limit: 100, unit: 'count', per: 'day' }, { key: 'mailMonth', limit: 3000, unit: 'count', per: 'month' }], async () => {
      const kept = env.PEOPLE && await setting(env.PEOPLE, MAIL_COUNTS)
      if (!kept) throw new Error('No email sent by the worker since this was set up: Resend gives its counts with each one.')
      const { daily, monthly, at } = JSON.parse(kept) as { daily: number | null; monthly: number | null; at: number }
      return [{ used: daily ?? 0, at }, { used: monthly ?? 0, at }]
    }],
    // Brevo's day (src/mail.ts), counted by the worker as it sends: the mail that can wait goes there first.
    [[{ key: 'mailBrevo', limit: 300, unit: 'count', per: 'day' }], async () => {
      if (!env.BREVO_API_KEY) throw new Error('No BREVO_API_KEY yet: all the mail goes through Resend.')
      const kept = JSON.parse((env.PEOPLE && await setting(env.PEOPLE, SENT_TODAY)) || 'null') as { day: string; brevo?: number } | null
      return [{ used: kept?.day === new Date(now).toISOString().slice(0, 10) ? kept.brevo ?? 0 : 0 }]
    }],
  ]
  return Promise.all(readings.map(async ([shown, read]) => {
    try {
      const readings = await read()
      return shown.map((meter, i) => ({ ...meter, ...readings[i] }))
    } catch (error) {
      return shown.map(meter => ({ ...meter, error: said(error) }))
    }
  })).then(groups => groups.flat())
}

// The daily limits over the last 30 days, a value a day (none counted: 0).
function historyOf(env: Env, now: number) {
  const first = now - (now % DAY_MS) - (DAYS - 1) * DAY_MS
  const days = (groups: any[] | undefined, field: string) => {
    const byDate = new Map<string, number>()
    for (let day = first; day <= now; day += DAY_MS) byDate.set(new Date(day).toISOString().slice(0, 10), 0)
    for (const group of groups ?? []) {
      const date = group.dimensions?.date
      if (byDate.has(date)) byDate.set(date, byDate.get(date)! + Number(group.sum?.[field] ?? 0))
    }
    return [...byDate].map(([date, value]) => ({ date, value }))
  }
  const added = (a: Day[], b: Day[]) => a.map((day, i) => ({ date: day.date, value: day.value + (b[i]?.value ?? 0) }))
  const since = `datetime_geq: ${at(first)}, datetime_leq: ${at(now)}`
  const readings: [{ key: string; limit: number }[], () => Promise<Day[][]>][] = [
    [[{ key: 'requests', limit: 100_000 }], async () => {
      const [workers, pages] = await Promise.all([
        graph(env, `workersInvocationsAdaptive(limit: 10000, filter: { ${since} }) { sum { requests } dimensions { date } }`),
        graph(env, `pagesFunctionsInvocationsAdaptiveGroups(limit: 10000, filter: { ${since} }) { sum { requests } dimensions { date } }`),
      ])
      return [added(days(workers.workersInvocationsAdaptive, 'requests'), days(pages.pagesFunctionsInvocationsAdaptiveGroups, 'requests'))]
    }],
    [[{ key: 'rooms', limit: 100_000 }], async () =>
      [days((await graph(env, `durableObjectsInvocationsAdaptiveGroups(limit: 10000, filter: { date_geq: ${on(first)} }) { sum { requests } dimensions { date } }`)).durableObjectsInvocationsAdaptiveGroups, 'requests')]],
    [[{ key: 'dbWritten', limit: 100_000 }, { key: 'dbRead', limit: 5_000_000 }], async () => {
      const groups = (await graph(env, `d1AnalyticsAdaptiveGroups(limit: 10000, filter: { date_geq: ${on(first)} }) { sum { rowsRead rowsWritten } dimensions { date } }`)).d1AnalyticsAdaptiveGroups
      return [days(groups, 'rowsWritten'), days(groups, 'rowsRead')]
    }],
  ]
  return Promise.all(readings.map(async ([shown, read]) => {
    try {
      const series = await read()
      return shown.map((chart, i) => ({ ...chart, days: series[i] }))
    } catch (error) {
      return shown.map(chart => ({ ...chart, error: said(error) }))
    }
  })).then(groups => groups.flat())
}

// ---------------------------------------------------------------- the Atrium

// What the worker is given -- each set or not -- and what it's told.
function setupOf(env: Env) {
  return {
    secrets: SECRETS.map(name => ({ name, set: !!env[name] })),
    relayBudgetGb: relayBudget(env) / GB,
    storeQuotaMb: Number(env.STORE_QUOTA_MB) || 50,
  }
}

// How much the Atrium is used, from the directory. Each count reads its
// table whole: fine for a look now and then.
async function usageOf(env: Env, now: number) {
  const db = env.PEOPLE
  if (!db) throw new Error('the directory (D1) is not bound')
  await tablesIn(db)
  const week = now - 7 * DAY_MS
  const [accounts, logins, signedIn, hosted, publicAtriums, mirrored, invites, bans, contributions, interest] = await db.batch([
    db.prepare('select kind, count(*) as count, coalesce(sum(created_at > ?), 0) as recent from accounts group by kind').bind(week),
    db.prepare('select count(*) as count, coalesce(sum(confirmed_at is not null), 0) as confirmed from logins'),
    db.prepare('select count(distinct account) as count from refresh_tokens where used_at > ?').bind(week),
    db.prepare(`select coalesce(sum(name = 'atrium.roster' and folder = 0), 0) as atriums, coalesce(sum(size), 0) as bytes, count(distinct owner) as owners from store_files`),
    db.prepare('select count(*) as count from public_atriums'),
    db.prepare('select coalesce(sum(size), 0) as bytes from mirror_files'),
    db.prepare('select count(*) as count from invites'),
    db.prepare('select count(*) as count from bans'),
    db.prepare('select count(*) as count, coalesce(sum(livemode = 1), 0) as live from contributions'),
    db.prepare('select kind, answer, count(*) as count from plan_interest group by kind, answer'),
  ])
  const one = (result: D1Result) => (result.results[0] ?? {}) as Record<string, number>
  return {
    accounts: accounts.results as { kind: string; count: number; recent: number }[],
    logins: one(logins),
    signedInThisWeek: one(signedIn).count ?? 0,
    hosted: one(hosted),
    publicAtriums: one(publicAtriums).count ?? 0,
    mirroredBytes: one(mirrored).bytes ?? 0,
    invites: one(invites).count ?? 0,
    bans: one(bans).count ?? 0,
    contributions: one(contributions),
    interest: interest.results as { kind: string; answer: string; count: number }[],
  }
}
