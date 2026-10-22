// A pass for Cloudflare's relay (TURN), for someone hiding their IP address
// in an atrium (src/lib/peers.ts in the app): their connections go only
// through Cloudflare, so the others see Cloudflare's address instead of
// theirs. Everyone else connects directly and never needs one. For either
// kind of account (src/who.ts).
//
// The relay is free up to 1,000 GB a month, then billed. So before a pass is
// given, Cloudflare is asked how much the relay has sent in the last 31 days
// -- every billing month falls inside that, however Cloudflare's months are
// cut -- and past RELAY_BUDGET_GB the answer is { capped: true }: the app
// then carries that person's cursor through the room, as it did before there
// was a relay. The margin under 1,000 covers passes already out (each lasts
// PASS_SECONDS) and the analytics' own delay and sampling. Any doubt -- a
// secret missing, the usage unknown -- is answered the same way: the relay
// must never produce a bill.

import { outbound, replies, whoIs, type Env } from './who'

const PASS_SECONDS = 12 * 60 * 60
// How long a reading of the usage is trusted, while this instance is warm.
const USAGE_FRESH_MS = 5 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

let usage: { bytes: number; at: number } | null = null

/** Cloudflare's analytics (GraphQL) for the account, these fields asked of
 *  it: what it answers, or why not. Also the operator's dashboard's
 *  (src/ops.ts). */
export async function graph(env: Env, fields: string): Promise<any> {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) throw new Error('CF_ACCOUNT_ID or CF_ANALYTICS_TOKEN is not set')
  const query = `{ viewer { accounts(filter: { accountTag: ${JSON.stringify(env.CF_ACCOUNT_ID)} }) { ${fields} } } }`
  const response = await fetch(outbound(env, 'https://api.cloudflare.com/client/v4/graphql'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await response.json().catch(() => null) as { errors?: { message?: string }[]; data?: { viewer?: { accounts?: unknown[] } } } | null
  if (!response.ok || !body || body.errors?.length) throw new Error(`analytics: ${response.status} ${body?.errors?.map(error => error.message).join('; ') ?? ''}`)
  const accounts = body.data?.viewer?.accounts
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('analytics: no such account')
  return accounts[0]
}

/** Bytes the account's relay has sent out over the last 31 days. */
export async function relayedBytes(env: Env): Promise<number> {
  if (usage && Date.now() - usage.at < USAGE_FRESH_MS) return usage.bytes
  const day = (ms: number) => JSON.stringify(new Date(ms).toISOString().slice(0, 10))
  const account = await graph(env, `callsTurnUsageAdaptiveGroups(filter: { date_geq: ${day(Date.now() - 30 * DAY_MS)}, date_leq: ${day(Date.now())} }, limit: 1) {
    sum { egressBytes }
  }`)
  const bytes = Number(account.callsTurnUsageAdaptiveGroups?.[0]?.sum?.egressBytes ?? 0)
  if (!Number.isFinite(bytes)) throw new Error('usage query: no number')
  usage = { bytes, at: Date.now() }
  return bytes
}

/** Where the relay stops, in bytes: RELAY_BUDGET_GB, 800 if unset -- 0 is a
 *  budget too, the relay switched off. */
export function relayBudget(env: Env): number {
  const set = env.RELAY_BUDGET_GB?.trim()
  return (set && Number(set) >= 0 ? Number(set) : 800) * 1e9
}

export async function relay(request: Request, env: Env): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  let asked: { token?: unknown }
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  // Signed-in people only: a pass is a key to the free allowance.
  if (!(await whoIs(typeof asked.token === 'string' ? asked.token : null, env))) return answer(401, { error: 'sign-in' })

  const { CF_TURN_KEY_ID: keyId, CF_TURN_KEY_TOKEN: keyToken } = env
  if (!keyId || !keyToken) {
    console.error('[relay] a CF_TURN_* secret is not set')
    return answer(200, { capped: true })
  }
  const budget = relayBudget(env)
  try {
    const used = await relayedBytes(env)
    if (used >= budget) {
      console.warn(`[relay] capped: ${(used / 1e9).toFixed(1)} GB relayed in 31 days`)
      return answer(200, { capped: true })
    }
  } catch (error) {
    console.error('[relay] usage unknown, so no pass:', error)
    return answer(200, { capped: true })
  }

  const response = await fetch(outbound(env, `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${keyToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: PASS_SECONDS }),
  })
  const body = await response.json().catch(() => null) as { iceServers?: { urls: string | string[] }[] } | null
  if (!response.ok || !Array.isArray(body?.iceServers)) {
    console.error('[relay] Cloudflare gave no pass:', response.status, JSON.stringify(body))
    return answer(200, { capped: true })
  }
  // Port 53 is blocked by browsers, and the app waits for every address
  // before sending them (no trickle), so it would only wait for nothing.
  const iceServers = body.iceServers
    .map(server => ({ ...server, urls: ([] as string[]).concat(server.urls).filter(url => !/:53(\?|$)/.test(url)) }))
    .filter(server => server.urls.length > 0)
  return answer(200, { iceServers, seconds: PASS_SECONDS })
}
