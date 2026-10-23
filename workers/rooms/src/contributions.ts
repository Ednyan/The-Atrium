// Contributions (docs/DECENTRALIZING.md, phase 10, step 6): what the four
// Supabase functions did -- create-contribution, contribution-status,
// stripe-webhook, moderate-contributors -- under the same rules (their
// comments say why each is as it is). Checkout and its status, and the wall
// with the month's gauge, for anyone (lib/donate, lib/contributions in the
// app); Stripe's webhook, which alone records a payment; the operator's
// moderation (components/NameApprovalPanel).
//
// Until the operator moves the record here (`move`), Supabase's is the
// record: the public routes and moderation answer 409, and the app asks
// Supabase as before. The webhook records from the start, so nothing paid in
// between is missed: the move replaces any payment both have with Supabase's
// row, which carries what was decided there.

import { nameProblem as problemOf, MAX_NAME_LENGTH } from '../../../supabase/functions/_shared/contributorName'
import { BASE_CURRENCY, currencyByCode, isAllowedStep, isCurrencyCode, minorPerUnit } from '../../../supabase/functions/_shared/currencies'
import { SITE, mailReady, toContributor } from './mail'
import { allowedNow, isOperator, keep, setting, tablesIn } from './people'
import { outbound, replies, whoIs, type Env } from './who'

const STRIPE_VERSION = '2026-07-29.dahlia'
const SIGNATURE_TOLERANCE_S = 300
const DAY_MS = 24 * 60 * 60 * 1000
// A monthly contributor still giving: paid within this long.
export const ACTIVE_MS = 50 * DAY_MS
// What the wall can draw, and a search shows.
const WALL_MOST = 10_000
const SEARCH_MOST = 40
const CHECKOUTS_AN_HOUR = 30
// Stripe's events are a few KB; anything far bigger isn't one, and isn't read.
const MOST_EVENT_BYTES = 512 * 1024
// How long the wall is kept at the edge before it's worked out again.
const WALL_FRESH_S = 300
// Supabase's monthly_goal_cents default, until one is set or moved.
export const DEFAULT_GOAL_CENTS = 5000
export const MOVED = 'contributions.moved'
export const GOAL = 'contributions.goal_cents'
export const LAST_EVENT = 'stripe.last_event'

const SAID: Record<string, string> = {
  length: `Names are limited to ${MAX_NAME_LENGTH} characters.`,
  banned: "That name can't be used here.",
  url: "Names can't contain web addresses.",
  unrenderable: "That name contains characters that can't be shown.",
}
const nameProblem = (name: string) => { const problem = problemOf(name); return problem && SAID[problem] }

// ---------------------------------------------------------------- helpers

/** Stripe's API: form-encoded in, JSON out; its own message when it refuses. */
export async function stripe(env: Env, method: 'GET' | 'POST' | 'DELETE', path: string, form?: URLSearchParams): Promise<any> {
  const response = await fetch(outbound(env, `https://api.stripe.com/v1/${path}`), {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': STRIPE_VERSION,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form?.toString(),
  })
  const body = await response.json().catch(() => null) as any
  if (!response.ok) throw Object.assign(new Error(body?.error?.message ?? `Stripe ${method} ${path}: ${response.status}`), { status: response.status })
  return body
}

// Moved once and for good: remembered by the instance once it is.
let moved = false
const isMoved = async (db: D1Database) => (moved ||= !!(await setting(db, MOVED)))

// Open to any page, the desktop app's too: nothing here is anyone's.
const open = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers } })

// The wall as the edge keeps it, dropped as the record changes (in this
// data centre; elsewhere it's at most WALL_FRESH_S old).
const WALL_KEY = `${SITE}/contributions/wall`
const fresh = () => caches.default.delete(WALL_KEY).catch(() => false)

export const monthStart = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)

// ---------------------------------------------------------------- routes

export async function contributions(request: Request, env: Env, what: string): Promise<Response> {
  if (!env.PEOPLE) return open(503, { error: 'not set up' })
  const db = env.PEOPLE
  await tablesIn(db)
  if (what === 'ops') return operate(request, env, db)
  if (!(await isMoved(db))) return open(409, { error: 'not moved' })
  if (what === 'wall' && request.method === 'GET') return wall(db)
  if (what === 'search' && request.method === 'GET') return search(db, new URL(request.url).searchParams.get('q') ?? '')
  if (what === 'checkout' && request.method === 'POST') {
    // So many Checkout pages an hour from a network: past any honest giver.
    if (!(await allowedNow(db, `checkout:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, CHECKOUTS_AN_HOUR))) return open(429, { error: 'Too many tries just now. Try again in a while.' })
    return checkout(request, env)
  }
  if (what === 'status' && request.method === 'POST') return status(request, env)
  return open(404, { error: 'no such thing' })
}

// The wall: every approved contributor, as contributors_searchable worked it
// out (contributors_subscription_state.sql), and the month's gauge.
// ponytail: worked out per request and kept at the edge for WALL_FRESH_S; past a few thousand contributors, keep it
// worked out on each change (R2) so a request stays inside the free plan's 10 ms of CPU.
const CONTRIBUTORS = `
  with live as (
    select trim(display_name) as name, kind, settled_eur_cents as cents, created_at as at from contributions
    where livemode = 1 and name_approved = 1 and hidden = 0 and refunded = 0 and trim(coalesce(display_name, '')) <> ''
  ),
  marked as (
    select name, cents, at, case when at - lag(at) over (partition by name order by at) <= ?1 then 0 else 1 end as starts
    from live where kind = 'monthly'
  ),
  runs as (select name, cents, at, sum(starts) over (partition by name order by at) as run from marked),
  spans as (select name, min(at) as started, max(at) as last_paid from runs group by name, run),
  latest as (select name, started, last_paid from (select *, row_number() over (partition by name order by last_paid desc) as n from spans) where n = 1),
  rate as (select name, cents from (select name, cents, row_number() over (partition by name order by at desc) as n from runs) where n = 1),
  people as (
    select live.name as display_name,
      cast(round(sum(live.cents) / 100.0) as integer) as amount_eur,
      max(live.kind = 'monthly') as is_monthly,
      cast(round(rate.cents / 100.0) as integer) as monthly_eur,
      strftime('%Y-%m-%d', (case when latest.last_paid > ?2 then latest.started else min(live.at) end) / 1000, 'unixepoch') as since,
      count(*) as contribution_count,
      max(live.kind = 'one_time') as has_one_time,
      cast(round(coalesce(sum(case when live.kind = 'one_time' then live.cents end), 0) / 100.0) as integer) as one_time_eur,
      coalesce(latest.last_paid > ?2, 0) as monthly_active,
      cast(round(coalesce(sum(case when live.at > ?3 then live.cents end), 0) / 100.0) as integer) as amount_7d,
      cast(round(coalesce(sum(case when live.at > ?4 then live.cents end), 0) / 100.0) as integer) as amount_30d,
      cast(round(coalesce(sum(case when live.at > ?5 then live.cents end), 0) / 100.0) as integer) as amount_365d
    from live left join latest on latest.name = live.name left join rate on rate.name = live.name
    group by live.name
  )
  select * from people`
const contributorsAsked = (db: D1Database, rest: string, ...more: unknown[]) => {
  const now = Date.now()
  return db.prepare(CONTRIBUTORS + rest).bind(ACTIVE_MS, now - ACTIVE_MS, now - 7 * DAY_MS, now - 30 * DAY_MS, now - 365 * DAY_MS, ...more)
}

async function wall(db: D1Database): Promise<Response> {
  const kept = await caches.default.match(WALL_KEY).catch(() => undefined)
  if (kept) return kept
  const [people, month, goal] = await db.batch([
    contributorsAsked(db, ' order by amount_eur desc, since desc limit ?6', WALL_MOST),
    db.prepare(`select coalesce(sum(settled_eur_cents), 0) as total_cents, count(*) as contribution_count from contributions
      where livemode = 1 and refunded = 0 and counts_toward_goal = 1 and created_at >= ?`).bind(monthStart()),
    db.prepare('select value from settings where key = ?').bind(GOAL),
  ])
  const goalCents = Number((goal.results[0] as { value?: string } | undefined)?.value ?? DEFAULT_GOAL_CENTS)
  const answer = open(200, { contributors: people.results, month: { ...(month.results[0] as object), goal_cents: goalCents } }, { 'Cache-Control': `s-maxage=${WALL_FRESH_S}` })
  await caches.default.put(WALL_KEY, answer.clone()).catch(() => {})
  return answer
}

// Someone looked up past the wall, by part of their name.
async function search(db: D1Database, query: string): Promise<Response> {
  const needle = query.trim()
  if (needle.length < 2 || needle.length > MAX_NAME_LENGTH) return open(200, [])
  const pattern = `%${needle.replace(/[\\%_]/g, ch => `\\${ch}`)}%`
  const { results } = await contributorsAsked(db, " where display_name like ?6 escape '\\' limit ?7", pattern, SEARCH_MOST).all()
  return open(200, results)
}

// A Checkout page for a contribution: the amount checked against the same
// table the page offers from, the name against the same rules.
async function checkout(request: Request, env: Env): Promise<Response> {
  let asked: { amountCents?: unknown; monthly?: unknown; displayName?: unknown; currency?: unknown }
  try { asked = await request.json() } catch { return open(400, { error: 'body' }) }
  const code = isCurrencyCode(asked.currency) ? asked.currency : BASE_CURRENCY
  const money = currencyByCode(code)
  const per = minorPerUnit(code)
  const amount = Math.round(Number(asked.amountCents))
  if (!Number.isFinite(amount) || amount < money.min || amount > money.max) {
    return open(400, { error: `Choose an amount between ${money.symbol}${money.min / per} and ${money.symbol}${money.max / per}.` })
  }
  if (!isAllowedStep(amount, code)) return open(400, { error: `Choose a whole number of ${code}.` })
  const name = typeof asked.displayName === 'string' ? asked.displayName.trim() : ''
  const problem = nameProblem(name)
  if (problem) return open(400, { error: problem })
  if (!env.STRIPE_SECRET_KEY) return open(503, { error: 'Contributions are not set up yet.' })

  const monthly = asked.monthly === true
  const form = new URLSearchParams({
    mode: monthly ? 'subscription' : 'payment',
    success_url: `${SITE}/contributed`,
    cancel_url: `${SITE}/welcome`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': code.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': monthly ? 'Monthly contribution to The Digital Atrium' : 'Contribution to The Digital Atrium',
    'metadata[display_name]': name,
    'metadata[kind]': monthly ? 'monthly' : 'one_time',
  })
  if (monthly) {
    form.set('line_items[0][price_data][recurring][interval]', 'month')
    // invoice.paid carries the subscription's metadata, not the session's.
    form.set('subscription_data[metadata][display_name]', name)
    form.set('subscription_data[metadata][kind]', 'monthly')
  }
  try {
    const session = await stripe(env, 'POST', 'checkout/sessions', form)
    return open(200, { url: session.url, sessionId: session.id })
  } catch (error) {
    console.error('[contributions] Stripe refused the session:', error)
    return open(502, { error: 'Could not start the contribution. Please try again.' })
  }
}

// Whether a Checkout session was paid: what the app waits on to say thanks.
const SESSION_ID = /^cs_[A-Za-z0-9_]{8,120}$/
async function status(request: Request, env: Env): Promise<Response> {
  let asked: { sessionId?: unknown }
  try { asked = await request.json() } catch { return open(400, { error: 'body' }) }
  if (typeof asked.sessionId !== 'string' || !SESSION_ID.test(asked.sessionId)) return open(400, { error: 'Not a session id.' })
  if (!env.STRIPE_SECRET_KEY) return open(503, { error: 'Contributions are not set up yet.' })
  try {
    const session = await stripe(env, 'GET', `checkout/sessions/${encodeURIComponent(asked.sessionId)}`)
    return open(200, { status: session.status ?? 'open', paid: session.payment_status === 'paid' || session.payment_status === 'no_payment_required' })
  } catch (error) {
    if ((error as { status?: number }).status === 404) return open(200, { status: 'expired' })
    console.error('[contributions] a status:', error)
    return open(502, { error: 'Could not check the payment.' })
  }
}

// ---------------------------------------------------------------- Stripe's webhook

// Stripe signs "timestamp.body" with the endpoint's secret: checked on the
// raw text, before it's parsed, within a replay window, in constant time.
async function signed(raw: string, header: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map(piece => { const at = piece.indexOf('='); return [piece.slice(0, at).trim(), piece.slice(at + 1).trim()] }))
  const { t: timestamp, v1: signature } = parts
  if (!timestamp || !signature) return false
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_S) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`)))
  const expected = [...mac].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (expected.length !== signature.length) return false
  let difference = 0
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return difference === 0
}

// What a payment settled as in euros -- the balance transaction's amount,
// never a rate guessed here. Null if it settled in another currency (said
// loudly: it then counts nothing) or can't be had.
async function settledEurCents(env: Env, paymentIntent: string): Promise<number | null> {
  try {
    const intent = await stripe(env, 'GET', `payment_intents/${encodeURIComponent(paymentIntent)}?expand[]=latest_charge`)
    const charge = intent?.latest_charge
    const transaction = typeof charge?.balance_transaction === 'string' ? charge.balance_transaction : charge?.balance_transaction?.id
    if (!transaction) return null
    const settled = await stripe(env, 'GET', `balance_transactions/${encodeURIComponent(transaction)}`)
    if (settled?.currency !== 'eur') {
      console.error(`[contributions] ${transaction} settled in ${settled?.currency}, not eur: recorded as 0 euros. Settle that currency into the euro balance.`)
      return null
    }
    return Number(settled.amount) || null
  } catch (error) {
    console.error('[contributions] the settled amount:', error)
    return null
  }
}

const RECORD = `insert into contributions (id, amount_cents, currency, settled_eur_cents, kind, display_name, name_approved,
  name_rejected_reason, contact_email, stripe_event_id, stripe_payment_id, stripe_subscription_id, livemode, created_at)
  values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (stripe_event_id) do nothing`

export async function stripeWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 })
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY || !env.PEOPLE) {
    console.error('[contributions] STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY is not set')
    return new Response('not set up', { status: 503 })
  }
  if (Number(request.headers.get('Content-Length') ?? 0) > MOST_EVENT_BYTES) return new Response('too big', { status: 413 })
  const raw = await request.text()
  if (raw.length > MOST_EVENT_BYTES || !(await signed(raw, request.headers.get('stripe-signature') ?? '', env.STRIPE_WEBHOOK_SECRET))) return new Response('bad signature', { status: 400 })
  const event = JSON.parse(raw)
  const db = env.PEOPLE
  await tablesIn(db)
  // Anything skipped still answers 200: anything else, Stripe tries again for days.
  const ok = () => new Response('ok')
  const live = event.livemode === true ? 1 : 0
  // When it happened, not when it arrived: a redelivery counts in its own month.
  const at = Number(event.created) * 1000 || Date.now()
  try {
    const writes: D1PreparedStatement[] = [keep(db, LAST_EVENT, Date.now())]
    const object = event.data?.object ?? {}
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      // Delayed methods complete unpaid and come back as async_payment_succeeded;
      // subscriptions are counted from their invoices.
      if (object.payment_status === 'paid' && object.mode !== 'subscription') {
        const settled = object.payment_intent ? await settledEurCents(env, object.payment_intent) : null
        writes.push(db.prepare(RECORD).bind(crypto.randomUUID(), object.amount_total, object.currency ?? 'eur',
          settled ?? (object.currency === 'eur' ? object.amount_total : 0), 'one_time', object.metadata?.display_name?.trim() || null, 0, null,
          object.customer_details?.email ?? null, event.id, object.payment_intent ?? object.id, null, live, at))
      }
    } else if (event.type === 'invoice.paid') {
      // Every month of a subscription, the first included. Both of the
      // invoice's shapes: the subscription under `parent` now, on it before.
      const details = object.parent?.subscription_details ?? object.subscription_details
      const subscription = details?.subscription ?? object.subscription
      if (subscription && Number(object.amount_paid) > 0) {
        let paymentIntent: string | null = object.payment_intent ?? null
        if (!paymentIntent) {
          try {
            const expanded = await stripe(env, 'GET', `invoices/${encodeURIComponent(object.id)}?expand[]=payments`)
            paymentIntent = expanded?.payments?.data?.[0]?.payment?.payment_intent ?? null
          } catch (error) {
            console.error('[contributions] the invoice payments:', error)
          }
        }
        const settled = paymentIntent ? await settledEurCents(env, paymentIntent) : null
        // A renewal is the same person, already judged: last month's row decides.
        const previous = await db.prepare(`select display_name, name_approved, name_rejected_reason from contributions
          where stripe_subscription_id = ? and livemode = ? order by created_at desc limit 1`).bind(subscription, live)
          .first<{ display_name: string | null; name_approved: number; name_rejected_reason: string | null }>()
        const fromMetadata = typeof details?.metadata?.display_name === 'string' ? details.metadata.display_name.trim() || null : null
        writes.push(db.prepare(RECORD).bind(crypto.randomUUID(), object.amount_paid, object.currency ?? 'eur',
          settled ?? (object.currency === 'eur' ? object.amount_paid : 0), 'monthly', previous ? previous.display_name : fromMetadata,
          previous?.name_approved ? 1 : 0, previous?.name_rejected_reason ?? null, object.customer_email ?? null, event.id,
          paymentIntent ?? object.id, subscription, live, at))
      }
    } else if (event.type === 'charge.refunded') {
      // Marked, not deleted: the history stays honest, the totals stop counting it.
      const payment = object.payment_intent ?? object.id
      if (payment) writes.push(db.prepare('update contributions set refunded = 1 where stripe_payment_id = ?').bind(payment))
    }
    await db.batch(writes)
    if (writes.length > 1) await fresh()
    return ok()
  } catch (error) {
    // A real failure: Stripe tries again, and the payment isn't lost.
    console.error('[contributions]', event?.type, error)
    return new Response('error', { status: 500 })
  }
}

// ---------------------------------------------------------------- the operator's

interface Row {
  id: string; amount_cents: number; currency: string; settled_eur_cents: number; kind: string; display_name: string | null
  name_approved: number; name_rejected_reason: string | null; contact_email: string | null; stripe_event_id: string | null
  stripe_payment_id: string | null; stripe_subscription_id: string | null; refunded: number; hidden: number; livemode: number
  counts_toward_goal: number; created_at: number
}
const COLUMNS = ['id', 'amount_cents', 'currency', 'settled_eur_cents', 'kind', 'display_name', 'name_approved', 'name_rejected_reason',
  'contact_email', 'stripe_event_id', 'stripe_payment_id', 'stripe_subscription_id', 'refunded', 'hidden', 'livemode', 'counts_toward_goal', 'created_at'] as const

async function operate(request: Request, env: Env, db: D1Database): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  let asked: Record<string, any>
  try { asked = await request.json() } catch { return answer(400, { error: 'body' }) }
  const who = await whoIs(asked.token, env)
  if (!who) return answer(401, { error: 'Not signed in' })
  if (!(await isOperator(env, who, asked.token))) return answer(403, { error: 'Not allowed' })
  const { action, id } = asked
  if (action === 'move') return move(env, db, who.kind === 'supabase' ? asked.token : null, answer)
  if (!(await isMoved(db))) return answer(409, { error: 'not moved' })

  const row = async () => (id ? await db.prepare('select * from contributions where id = ?').bind(id).first<Row>() : null)
  const changed = async (statements: D1PreparedStatement[], body: object = { ok: true }) => { await db.batch(statements); await fresh(); return answer(200, body) }
  const cents = (euros: unknown, least: number) => { const value = Math.round(Number(euros) * 100); return Number.isFinite(value) && value >= least && value <= 100_000_000 ? value : null }
  const when = (value: unknown) => { const date = typeof value === 'string' && value.trim() ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.getTime() : null }

  switch (action) {
    case 'get_settings':
      return answer(200, { monthlyGoalCents: Number((await setting(db, GOAL)) ?? DEFAULT_GOAL_CENTS) })
    case 'set_goal': {
      const goal = cents(asked.goalEur, 100)
      if (goal === null) return answer(400, { error: 'That is not a usable goal.' })
      return changed([keep(db, GOAL, goal)], { ok: true, monthlyGoalCents: goal })
    }
    // Live rows with a name, newest first: what's waiting, shown, refunded, rejected.
    case 'list': {
      const { results } = await db.prepare(`select id, display_name, kind, name_approved, name_rejected_reason, hidden, refunded, settled_eur_cents,
        created_at, stripe_event_id, counts_toward_goal from contributions where livemode = 1 and display_name is not null
        order by created_at desc limit 200`).all<Row>()
      return answer(200, {
        entries: results.map(({ stripe_event_id, created_at, name_approved, hidden, refunded, counts_toward_goal, ...entry }) => ({
          ...entry, created_at: new Date(created_at).toISOString(), name_approved: !!name_approved, hidden: !!hidden, refunded: !!refunded,
          counts_toward_goal: !!counts_toward_goal, manual: !stripe_event_id,
        })),
      })
    }
    // By hand: a payment that came another way, or a name for one that came
    // without. Approved at once; `counts` false keeps its money out of the month.
    case 'add': {
      const name = typeof asked.displayName === 'string' ? asked.displayName.trim() : ''
      if (!name) return answer(400, { error: 'A contribution added by hand needs a name.' })
      const problem = nameProblem(name)
      if (problem) return answer(400, { error: problem })
      const amount = cents(asked.amountEur, 1)
      if (amount === null) return answer(400, { error: 'That amount is not a number.' })
      const at = asked.createdAt ? when(asked.createdAt) : Date.now()
      if (at === null) return answer(400, { error: 'That date could not be read.' })
      const added = crypto.randomUUID()
      return changed([db.prepare(`insert into contributions (id, amount_cents, currency, settled_eur_cents, kind, display_name, name_approved,
        livemode, counts_toward_goal, created_at) values (?, ?, 'eur', ?, ?, ?, 1, 1, ?, ?)`)
        .bind(added, amount, amount, asked.kind === 'monthly' ? 'monthly' : 'one_time', name, asked.counts === false ? 0 : 1, at)], { ok: true, id: added })
    }
    case 'hide':
    case 'unhide':
      if (!id) return answer(400, { error: 'Missing id' })
      return changed([db.prepare('update contributions set hidden = ? where id = ?').bind(action === 'hide' ? 1 : 0, id)])
    case 'delete':
      if (!id) return answer(400, { error: 'Missing id' })
      return changed([db.prepare('delete from contributions where id = ?').bind(id)])
    case 'approve':
      if (!id) return answer(400, { error: 'Missing id' })
      return changed([db.prepare('update contributions set name_approved = 1, name_rejected_reason = null where id = ?').bind(id)])
    // What the wall shows, and whether its money counts. A rename is the
    // whole contributor's: the wall groups by name.
    case 'edit': {
      const target = await row()
      if (!target) return answer(404, { error: 'No such contribution.' })
      const sets: string[] = []
      const values: unknown[] = []
      let name: string | null | undefined
      if (typeof asked.displayName === 'string') {
        const problem = nameProblem(asked.displayName)
        if (problem) return answer(400, { error: problem })
        name = asked.displayName.trim() || null
        sets.push('display_name = ?'); values.push(name)
      }
      if (asked.amountEur !== undefined && asked.amountEur !== null) {
        const amount = cents(asked.amountEur, 0)
        if (amount === null) return answer(400, { error: 'That amount is not a number.' })
        sets.push('amount_cents = ?', 'settled_eur_cents = ?'); values.push(amount || 1, amount)
      }
      if (typeof asked.createdAt === 'string' && asked.createdAt.trim()) {
        const at = when(asked.createdAt)
        if (at === null) return answer(400, { error: 'That date could not be read.' })
        sets.push('created_at = ?'); values.push(at)
      }
      if (typeof asked.counts === 'boolean') { sets.push('counts_toward_goal = ?'); values.push(asked.counts ? 1 : 0) }
      if (!sets.length) return answer(400, { error: 'Nothing to change' })
      const statements = [db.prepare(`update contributions set ${sets.join(', ')} where id = ?`).bind(...values, id)]
      const previous = target.display_name?.trim()
      let renamed = 0
      if (name !== undefined && previous) {
        renamed = (await db.prepare('select count(*) as n from contributions where trim(display_name) = ? and livemode = ? and id <> ?')
          .bind(previous, target.livemode, id).first<{ n: number }>())?.n ?? 0
        statements.push(db.prepare('update contributions set display_name = ? where trim(display_name) = ? and livemode = ? and id <> ?').bind(name, previous, target.livemode, id))
      }
      return changed(statements, { ok: true, renamed })
    }
    // Written to before anything's decided -- two people asking for one name.
    // The address never comes back to the page.
    case 'message': {
      const target = await row()
      if (!target) return answer(404, { error: 'No such contribution.' })
      const body = typeof asked.message === 'string' ? asked.message.trim() : ''
      if (!body) return answer(400, { error: 'Nothing to send.' })
      if (body.length > 4000) return answer(400, { error: 'That message is too long to send.' })
      if (!target.contact_email) return answer(400, { error: 'Stripe recorded no address for this payment, so there is nowhere to write.' })
      if (!mailReady(env)) return answer(503, { error: 'Email is not configured on this project.' })
      const sent = await toContributor(env, target.contact_email, 'About your contribution', {
        heading: 'Your contribution',
        body,
        footnote: [`You contributed as "${target.display_name}".`, 'Reply to this email and it reaches thedigitalatrium@gmail.com.'].join('\n'),
      })
      return sent ? answer(200, { ok: true }) : answer(502, { error: 'The message could not be sent.' })
    }
    // The reason kept and said, and -- asked -- the money given back: a
    // monthly contribution's subscription ended with it, or it's taken again
    // next month.
    case 'reject': {
      const target = await row()
      if (!target) return answer(404, { error: 'No such contribution.' })
      const reason = typeof asked.reason === 'string' && asked.reason.trim() ? asked.reason.trim() : 'Not suitable for the public list'
      await db.prepare('update contributions set name_approved = 0, name_rejected_reason = ? where id = ?').bind(reason, id).run()
      let refunded = false
      let ended = false
      let refundError = ''
      if (asked.refund && target.stripe_payment_id && !target.refunded) {
        if (!env.STRIPE_SECRET_KEY) refundError = 'Stripe is not configured on this project.'
        else {
          try {
            await stripe(env, 'POST', 'refunds', new URLSearchParams({ payment_intent: target.stripe_payment_id }))
            refunded = true
            await db.prepare('update contributions set refunded = 1 where id = ?').bind(id).run()
            if (target.stripe_subscription_id) {
              await stripe(env, 'DELETE', `subscriptions/${encodeURIComponent(target.stripe_subscription_id)}`)
                .catch(error => { if ((error as { status?: number }).status !== 404) throw error })
              ended = true
            }
          } catch (error) {
            refundError = (error as Error).message || 'The refund could not be made.'
            console.error('[contributions] the refund:', error)
          }
        }
      }
      await fresh()
      if (target.contact_email && mailReady(env)) {
        await toContributor(env, target.contact_email, 'About the name on your contribution', {
          heading: 'About your name',
          body: ['Thank you for contributing to The Digital Atrium.', '', `You asked to be listed as "${target.display_name}", and that name can't be shown on the public contributors list.`].join('\n'),
          quote: typeof asked.reason === 'string' && asked.reason.trim() ? reason : undefined,
          footnote: refunded
            ? ended ? 'Your payment has been refunded, and your monthly contribution has ended.' : 'Your payment has been refunded.'
            : ['Your contribution is unaffected, and still counts toward the month.', 'If you would like a different name shown, reply to this email and it will be changed.'].join('\n'),
        })
      }
      return answer(200, { ok: true, refunded, ended, refundError })
    }
    default:
      return answer(400, { error: 'Unknown action' })
  }
}

// Supabase's record copied here, by the operator's sign-in there
// (moderate-contributors, 'export': the addresses go server to server, never
// through the page). The first time, it's the record: a payment both have
// takes Supabase's row, decisions and all, and from then on this is the
// record. Again after: only what's missing here is added.
async function move(env: Env, db: D1Database, supabaseToken: string | null, answer: (status: number, body: unknown) => Response): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return answer(503, { error: 'Stripe is not set up on the worker yet (STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET).' })
  if (!supabaseToken) return answer(400, { error: 'Sign in with the operator account Supabase knows to copy its contributions.' })
  const response = await fetch(`${env.SUPABASE_URL}/functions/v1/moderate-contributors`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${supabaseToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'export' }),
  })
  const exported = await response.json().catch(() => null) as { entries?: Record<string, unknown>[]; monthlyGoalCents?: number; error?: string } | null
  if (!response.ok || !Array.isArray(exported?.entries)) return answer(502, { error: `Supabase gave nothing to copy: ${exported?.error ?? response.status}` })
  const first = !(await isMoved(db))
  const insert = `insert ${first ? 'or replace ' : ''}into contributions (${COLUMNS.join(', ')}) values (${COLUMNS.map(() => '?').join(', ')})${first ? '' : ' on conflict do nothing'}`
  const flag = (value: unknown) => (value === true ? 1 : 0)
  const statements = exported.entries.map(entry => db.prepare(insert).bind(...COLUMNS.map(column => {
    const value = entry[column]
    if (column === 'created_at') return new Date(String(value)).getTime()
    if (['name_approved', 'refunded', 'hidden', 'livemode'].includes(column)) return flag(value)
    if (column === 'counts_toward_goal') return value === false ? 0 : 1
    return value ?? null
  })))
  let added = 0
  // ponytail: batches of 50, each its own transaction -- a failure part way is put right by moving again.
  for (let at = 0; at < statements.length; at += 50) {
    for (const result of await db.batch(statements.slice(at, at + 50))) added += result.meta.changes ?? 0
  }
  if (first) {
    await db.batch([keep(db, GOAL, Number(exported.monthlyGoalCents) || DEFAULT_GOAL_CENTS), keep(db, MOVED, Date.now())])
    moved = true
  }
  await fresh()
  return answer(200, { ok: true, copied: exported.entries.length, added, first })
}
