// The operator's dashboard (components/OperatorDashboard in the app): the
// money Stripe has had this month beside what's recorded of it, and each
// free-plan limit the Atrium runs inside beside how much of it is spent
// (docs/SCALING.md). Every figure is asked on its own, so one that can't be
// had is said in its place and the rest still show.
//
// Cloudflare's daily limits reset at 00:00 UTC, its monthly ones on the 1st;
// past one on the free plan, what it limits fails until then. Resend's are
// its own, and it says them.

import { ACTIVE_MS, LAST_EVENT, MOVED, setting, stripe } from './contributions'
import { isOperator, tablesIn } from './people'
import { graph, relayBudget, relayedBytes } from './relay'
import { outbound, replies, whoIs, type Env } from './who'

const DAY_MS = 24 * 60 * 60 * 1000
const GB = 1e9
// The worker (wrangler.toml), and its database: one database may hold 500 MB on the free plan.
const SCRIPT = 'atrium-rooms'
const DATABASE_ID = '98e3f3c7-95f3-4482-b0b2-f8be13c26562'
// R2's operations: these free, these class B (reads); the rest class A.
const R2_FREE = new Set(['DeleteObject', 'DeleteBucket', 'AbortMultipartUpload'])
const R2_CLASS_B = new Set(['HeadBucket', 'HeadObject', 'GetObject', 'UsageSummary', 'GetBucketEncryption', 'GetBucketLocation', 'GetBucketCors', 'GetBucketLifecycleConfiguration'])

export interface Meter {
  key: string
  used?: number
  // Null: no limit (Resend's, on a paid plan).
  limit: number | null
  unit: 'count' | 'bytes' | 'ms' | 'gbs'
  per: 'day' | 'month' | 'total' | 'request' | '31 days'
  // Requests that went past it (the CPU's).
  over?: number
  error?: string
}
type Shown = Omit<Meter, 'used' | 'over' | 'error'>

const said = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function ops(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  let asked: { token?: unknown }
  try { asked = await request.json() } catch { return answer(400, { error: 'body' }) }
  const token = typeof asked.token === 'string' ? asked.token : null
  const who = await whoIs(token, env)
  if (!who) return answer(401, { error: 'Not signed in' })
  if (!(await isOperator(env, who, token!))) return answer(403, { error: 'Not allowed' })
  if (what !== 'health') return answer(404, { error: 'no such thing' })
  const now = Date.now()
  const today = now - (now % DAY_MS)
  const month = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)
  const [money, meters] = await Promise.all([moneyOf(env, month).catch(error => ({ error: said(error) })), metersOf(env, now, today, month)])
  return answer(200, { at: now, money, meters })
}

// ---------------------------------------------------------------- money

async function moneyOf(env: Env, month: number) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set on the worker')
  const db = env.PEOPLE!
  await tablesIn(db)
  const [balance, stripeMonth, recorded, monthly, lastEvent, moved] = await Promise.all([
    stripe(env, 'GET', 'balance'),
    stripeMonthOf(env, month),
    db.prepare(`select count(*) as count, coalesce(sum(settled_eur_cents), 0) as cents from contributions
      where livemode = 1 and stripe_event_id is not null and created_at >= ?`).bind(month).first<{ count: number; cents: number }>(),
    db.prepare(`select count(distinct stripe_subscription_id) as count from contributions
      where livemode = 1 and refunded = 0 and stripe_subscription_id is not null and created_at > ?`).bind(Date.now() - ACTIVE_MS).first<{ count: number }>(),
    setting(db, LAST_EVENT),
    setting(db, MOVED),
  ])
  return {
    available: balance.available ?? [],
    pending: balance.pending ?? [],
    ...stripeMonth,
    // What the webhook wrote this month: the same count as Stripe's payments, or one was missed.
    recorded,
    monthlyContributors: monthly?.count ?? 0,
    lastEvent: Number(lastEvent) || null,
    moved: Number(moved) || null,
  }
}

// This month's money through Stripe, by currency: payments in -- with
// Stripe's fee, and what's left -- and refunds out.
async function stripeMonthOf(env: Env, month: number) {
  const payments: Record<string, { count: number; amount: number; fee: number; net: number }> = {}
  const refunds: Record<string, { count: number; amount: number }> = {}
  let after = ''
  // ponytail: 20 pages of 100 -- past 2,000 movements a month, ask Stripe's reports instead.
  for (let page = 0; page < 20; page++) {
    const list = await stripe(env, 'GET', `balance_transactions?limit=100&created[gte]=${Math.floor(month / 1000)}${after}`)
    for (const move of list.data ?? []) {
      if (move.type === 'charge' || move.type === 'payment') {
        const sum = (payments[move.currency] ??= { count: 0, amount: 0, fee: 0, net: 0 })
        sum.count++; sum.amount += move.amount; sum.fee += move.fee; sum.net += move.net
      } else if (move.type === 'refund' || move.type === 'payment_refund') {
        const sum = (refunds[move.currency] ??= { count: 0, amount: 0 })
        sum.count++; sum.amount -= move.amount
      }
    }
    if (!list.has_more || !list.data?.length) break
    after = `&starting_after=${list.data[list.data.length - 1].id}`
  }
  return { payments, refunds }
}

// ---------------------------------------------------------------- limits

const at = (ms: number) => JSON.stringify(new Date(ms).toISOString())
const on = (ms: number) => JSON.stringify(new Date(ms).toISOString().slice(0, 10))
const total = (groups: any[] | undefined, field: string, of = 'sum') => (groups ?? []).reduce((n, group) => n + Number(group?.[of]?.[field] ?? 0), 0)

function metersOf(env: Env, now: number, today: number, month: number): Promise<Meter[]> {
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
      const account = await graph(env, `cpu: workersInvocationsAdaptive(limit: 1, filter: { scriptName: "${SCRIPT}", ${since(today)} }) { quantiles { cpuTimeP99 } }
        over: workersInvocationsAdaptive(limit: 1, filter: { scriptName: "${SCRIPT}", status: "exceededResources", ${since(today)} }) { sum { requests } }`)
      return [{ used: Number(account.cpu?.[0]?.quantiles?.cpuTimeP99 ?? 0) / 1000, over: total(account.over, 'requests') }]
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
    // Resend's own count: everything sent with its key, Supabase's mail too.
    [[{ key: 'mailDay', limit: 100, unit: 'count', per: 'day' }, { key: 'mailMonth', limit: 3000, unit: 'count', per: 'month' }], async () => {
      if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set')
      const response = await fetch(outbound(env, 'https://api.resend.com/usage'), { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } })
      const body = await response.json().catch(() => null) as any
      if (!response.ok) throw new Error(`Resend: ${response.status} ${body?.message ?? ''}`.trim())
      const { daily, monthly } = body?.usage?.emails ?? body?.emails ?? {}
      return [{ used: Number(daily?.used ?? 0), limit: daily?.limit ?? null }, { used: Number(monthly?.used ?? 0), limit: monthly?.limit ?? null }]
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
