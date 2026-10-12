// A pass for Cloudflare's relay (TURN), for someone hiding their IP address
// in an atrium (src/lib/peers.ts): their connections go only through
// Cloudflare, so the others see Cloudflare's address instead of theirs.
// Everyone else connects directly and never needs one.
//
// The relay is free up to 1,000 GB a month, then billed. So before a pass is
// given, Cloudflare is asked how much the relay has sent in the last 31 days
// -- every billing month falls inside that, however Cloudflare's months are
// cut -- and past RELAY_BUDGET_GB the answer is { capped: true }: the app
// then carries that person's cursor through the presence channel, as it did
// before there was a relay. The margin under 1,000 covers passes already out
// (each lasts PASS_SECONDS) and the analytics' own delay and sampling. Any
// doubt -- a secret missing, the usage unknown -- is answered the same way:
// the relay must never produce a bill.
//
// Secrets (Supabase dashboard, Edge Functions, Secrets):
//   CF_TURN_KEY_ID, CF_TURN_KEY_TOKEN -- Cloudflare, Realtime, TURN: the key
//   CF_ACCOUNT_ID, CF_ANALYTICS_TOKEN -- an API token with Account Analytics: Read
//   RELAY_BUDGET_GB                    -- optional, 800 if unset; 0 switches the relay off

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'

const PASS_SECONDS = 12 * 60 * 60
// How long a reading of the usage is trusted, while this instance is warm.
const USAGE_FRESH_MS = 5 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

let usage: { bytes: number; at: number } | null = null

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

// Bytes the account's relay has sent out over the last 31 days.
async function relayedBytes(accountId: string, token: string): Promise<number> {
  if (usage && Date.now() - usage.at < USAGE_FRESH_MS) return usage.bytes
  const day = (ms: number) => JSON.stringify(new Date(ms).toISOString().slice(0, 10))
  const query = `{ viewer { accounts(filter: { accountTag: ${JSON.stringify(accountId)} }) {
    callsTurnUsageAdaptiveGroups(filter: { date_geq: ${day(Date.now() - 30 * DAY_MS)}, date_leq: ${day(Date.now())} }, limit: 1) {
      sum { egressBytes }
    }
  } } }`
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !body || body.errors?.length) throw new Error(`usage query: ${res.status} ${JSON.stringify(body?.errors ?? body)}`)
  const accounts = body.data?.viewer?.accounts
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('usage query: no such account')
  const bytes = Number(accounts[0].callsTurnUsageAdaptiveGroups?.[0]?.sum?.egressBytes ?? 0)
  if (!Number.isFinite(bytes)) throw new Error('usage query: no number')
  usage = { bytes, at: Date.now() }
  return bytes
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Signed-in people only: a pass is a key to someone's free allowance.
  if (!(await getAuthenticatedUserId(req, createAdminClient()))) return json({ error: 'Not signed in' }, 401)

  const keyId = Deno.env.get('CF_TURN_KEY_ID')
  const keyToken = Deno.env.get('CF_TURN_KEY_TOKEN')
  const accountId = Deno.env.get('CF_ACCOUNT_ID')
  const analyticsToken = Deno.env.get('CF_ANALYTICS_TOKEN')
  if (!keyId || !keyToken || !accountId || !analyticsToken) {
    console.error('[relay-pass] a CF_* secret is not set')
    return json({ capped: true })
  }
  // 0 is a budget too: the relay switched off.
  const setBudget = Deno.env.get('RELAY_BUDGET_GB')?.trim()
  const budget = (setBudget && Number(setBudget) >= 0 ? Number(setBudget) : 800) * 1e9

  try {
    const used = await relayedBytes(accountId, analyticsToken)
    if (used >= budget) {
      console.warn(`[relay-pass] capped: ${(used / 1e9).toFixed(1)} GB relayed in 31 days`)
      return json({ capped: true })
    }
  } catch (err) {
    console.error('[relay-pass] usage unknown, so no pass:', err)
    return json({ capped: true })
  }

  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${keyToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: PASS_SECONDS }),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok || !Array.isArray(body?.iceServers)) {
    console.error('[relay-pass] Cloudflare gave no pass:', res.status, JSON.stringify(body))
    return json({ capped: true })
  }
  // Port 53 is blocked by browsers, and the app waits for every address
  // before sending them (no trickle), so it would only wait for nothing.
  const iceServers = body.iceServers
    .map((server: { urls: string | string[] }) => ({ ...server, urls: ([] as string[]).concat(server.urls).filter(url => !/:53(\?|$)/.test(url)) }))
    .filter((server: { urls: string[] }) => server.urls.length > 0)
  return json({ iceServers, seconds: PASS_SECONDS })
})
