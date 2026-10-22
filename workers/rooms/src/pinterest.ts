// Pinterest, for every account and for the desktop app (src/lib/pinterest.ts
// and src/lib/pinterestDesktop.ts in the app): its sign-in's code exchanged,
// and its boards and pins read, on their behalf -- Pinterest's API takes no
// calls from a browser, and its tokens must never reach one. The app's
// secret is a secret here (PINTEREST_CLIENT_SECRET); each connection's
// tokens are sealed in the directory (src/people.ts), bound to who holds
// them: an account, or a desktop app's link (`link:` its token's hash).
//
// The desktop app has no account and no https address for Pinterest to come
// back to: it sends its person to the website, which connects Pinterest on
// its behalf (`exchange`, mode desktop, nobody signed in) and shows a short
// code; the app trades that for a link token (`link`), the one thing it keeps.
//
// Moved from Supabase (phase 10, step 6): an existing account's connection,
// and a desktop link Supabase made, are handed over the first time they're
// used here (supabase/functions/pinterest-handover), and kept here from then on.

import { tablesIn } from './people'
import { fromBase64, keyFrom, outbound, replies, toBase64, whoIs, type Env } from './who'

const API = 'https://api.pinterest.com/v5'
// Renewed a little before it runs out, so no request races it.
const RENEW_BEFORE_MS = 60_000
// The desktop's pairing code: eight of these, for ten minutes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
const PAIRING_MS = 10 * 60_000

interface Tokens { access: string; refresh: string | null; until: number }

export async function pinterest(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  const db = env.PEOPLE
  if (!db || !env.PINTEREST_CLIENT_ID || !env.PINTEREST_CLIENT_SECRET || !env.GOOGLE_CLIENT_SECRET) return answer(503, { error: 'Pinterest app not configured on the server' })
  let asked: Record<string, unknown>
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  await tablesIn(db)
  const key = await keyFrom(env.GOOGLE_CLIENT_SECRET, 'atrium pinterest', 'AES-GCM', ['encrypt', 'decrypt'])
  const keepFor = async (holder: string, tokens: Tokens, username: string | null) => db.prepare(`insert into pinterest (account, sealed, username, updated_at) values (?, ?, ?, ?)
    on conflict (account) do update set sealed = excluded.sealed, username = excluded.username, updated_at = excluded.updated_at`)
    .bind(holder, await seal(key, holder, tokens), username, Date.now()).run()

  // The desktop's: the code shown on the website, traded for a link token.
  if (what === 'link') {
    const code = typeof asked.code === 'string' ? asked.code.toUpperCase().replace(/[^A-Z0-9]/g, '') : ''
    if (code.length !== CODE_LENGTH) return answer(400, { error: 'That code is not the right shape.' })
    const pairing = `pairing:${await sha256Hex(code)}`
    const row = await db.prepare('select sealed, username, updated_at from pinterest where account = ?').bind(pairing).first<{ sealed: string; username: string | null; updated_at: number }>()
    const tokens = row && Date.now() - row.updated_at < PAIRING_MS ? await open(key, pairing, row.sealed) : null
    await db.prepare('delete from pinterest where account = ?').bind(pairing).run()
    if (!tokens) return answer(404, { error: 'That code is not valid any more. Generate a new one.' })
    const token = toUrl(crypto.getRandomValues(new Uint8Array(32)))
    await keepFor(`link:${await sha256Hex(token)}`, tokens, row!.username)
    return answer(200, { token })
  }

  // The code from Pinterest's sign-in, exchanged: an account connected -- or,
  // the desktop's (nobody signed in here), a pairing code for its app.
  if (what === 'exchange') {
    const code = typeof asked.code === 'string' ? asked.code : '', redirectUri = typeof asked.redirectUri === 'string' ? asked.redirectUri : ''
    if (!code || !redirectUri) return answer(400, { error: 'Missing code or redirectUri' })
    const desktop = asked.mode === 'desktop'
    const who = desktop ? null : await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
    if (!desktop && !who) return answer(401, { error: 'Not authenticated' })
    const got = await fromPinterest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    if (!got) return answer(502, { error: 'Pinterest rejected the authorization code' })
    let username: string | null = null
    const account = await fetch(outbound(env, `${API}/user_account`), { headers: { Authorization: `Bearer ${got.access}` } }).catch(() => null)
    if (account?.ok) username = ((await account.json()) as { username?: string }).username ?? null
    if (desktop) {
      // Codes never traded in, gone once they've run out.
      await db.prepare("delete from pinterest where account like 'pairing:%' and updated_at < ?").bind(Date.now() - PAIRING_MS).run()
      const plain = [...crypto.getRandomValues(new Uint8Array(CODE_LENGTH))].map(byte => CODE_ALPHABET[byte & 31]).join('')
      await keepFor(`pairing:${await sha256Hex(plain)}`, got, username)
      return answer(200, { success: true, username, code: plain })
    }
    await keepFor(who!.id, got, username)
    return answer(200, { success: true, username })
  }

  // Whose connection this is: the signed-in account's, or a desktop link's.
  const link = typeof asked.link === 'string' && asked.link ? asked.link : null
  const who = link ? null : await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!link && !who) return answer(401, { error: 'Not authenticated' })
  const holder = link ? `link:${await sha256Hex(link)}` : who!.id
  // Supabase's, the first time: an existing account's, or a link Supabase made.
  if ((link || who!.kind === 'supabase') && !(await db.prepare('select 1 from pinterest where account = ?').bind(holder).first())) {
    const handed = await handover(env, link ? { link } : { token: asked.token as string })
    if (handed) await keepFor(holder, handed.tokens, handed.username)
  }

  if (what === 'status') {
    const row = await db.prepare('select username from pinterest where account = ?').bind(holder).first<{ username: string | null }>()
    return answer(200, { linked: !link || !!row, connected: !!row, username: row?.username ?? null })
  }

  if (what === 'disconnect' || what === 'unlink') {
    await db.prepare('delete from pinterest where account = ?').bind(holder).run()
    return answer(200, { connected: false })
  }

  // Boards, and a board's pins, a page at a time.
  if (what === 'api') {
    const bookmark = typeof asked.bookmark === 'string' ? `&bookmark=${encodeURIComponent(asked.bookmark)}` : ''
    let path: string
    if (asked.action === 'boards') path = `/boards?page_size=100${bookmark}`
    else if (asked.action === 'pins' && typeof asked.boardId === 'string' && asked.boardId) path = `/boards/${encodeURIComponent(asked.boardId)}/pins?page_size=100${bookmark}`
    else return answer(400, { error: asked.action === 'pins' ? 'Missing boardId' : 'Unknown action' })
    const access = await accessFor(env, db, key, holder)
    if (!access) return answer(409, { error: 'Pinterest not connected' })
    const response = await fetch(outbound(env, `${API}${path}`), { headers: { Authorization: `Bearer ${access}` } })
    if (!response.ok) {
      console.error('[pinterest] Pinterest refused:', response.status, await response.text())
      return answer(502, { error: 'Pinterest API request failed' })
    }
    return answer(200, await response.json())
  }
  return answer(400, { error: 'body' })
}

// A connection Supabase kept, handed over to this worker (and gone from there).
async function handover(env: Env, from: { token: string } | { link: string }): Promise<{ tokens: Tokens; username: string | null } | null> {
  if (!env.SUPABASE_WORKER_KEY) return null
  const response = await fetch(`${env.SUPABASE_URL}/functions/v1/pinterest-handover`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY, 'x-worker-key': env.SUPABASE_WORKER_KEY, 'Content-Type': 'application/json',
      Authorization: `Bearer ${'token' in from ? from.token : env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify('link' in from ? { link: from.link } : {}),
  }).catch(() => null)
  const got = response?.ok ? await response.json().catch(() => null) as { access_token?: string; refresh_token?: string | null; token_expires_at?: string | null; pinterest_username?: string | null } | null : null
  if (!got?.access_token) return null
  const until = got.token_expires_at ? Date.parse(got.token_expires_at) : NaN
  return { tokens: { access: got.access_token, refresh: got.refresh_token ?? null, until: Number.isFinite(until) ? until : 0 }, username: got.pinterest_username ?? null }
}

// The holder's access token: as kept, or renewed (and kept so) when it's
// about to run out. Null if it's not connected, or its connection is dead.
async function accessFor(env: Env, db: D1Database, key: CryptoKey, holder: string): Promise<string | null> {
  const row = await db.prepare('select sealed from pinterest where account = ?').bind(holder).first<{ sealed: string }>()
  const tokens = row ? await open(key, holder, row.sealed) : null
  if (!tokens) return null
  if (tokens.until - Date.now() > RENEW_BEFORE_MS || !tokens.refresh) return tokens.access
  const renewed = await fromPinterest(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh })
  if (!renewed) return null
  const kept = { ...renewed, refresh: renewed.refresh ?? tokens.refresh }
  await db.prepare('update pinterest set sealed = ?, updated_at = ? where account = ?').bind(await seal(key, holder, kept), Date.now(), holder).run()
  return kept.access
}

// Pinterest's token address, asked with the app's id and secret.
async function fromPinterest(env: Env, form: Record<string, string>): Promise<Tokens | null> {
  const response = await fetch(outbound(env, `${API}/oauth/token`), {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${env.PINTEREST_CLIENT_ID}:${env.PINTEREST_CLIENT_SECRET}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
  if (!response.ok) {
    console.error('[pinterest] token:', response.status, await response.text())
    return null
  }
  const got = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!got.access_token) return null
  return { access: got.access_token, refresh: got.refresh_token ?? null, until: Date.now() + Number(got.expires_in ?? 0) * 1000 }
}

const sha256Hex = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
const toUrl = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Tokens sealed to their holder: opened only as that holder's.
async function seal(key: CryptoKey, holder: string, tokens: Tokens): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(holder) }, key, new TextEncoder().encode(JSON.stringify(tokens))))
  return toBase64(new Uint8Array([...iv, ...sealed]))
}
async function open(key: CryptoKey, holder: string, sealed: string): Promise<Tokens | null> {
  try {
    const bytes = fromBase64(sealed)
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(holder) }, key, bytes.subarray(12))))
  } catch {
    return null
  }
}
