// Pinterest for Google accounts (src/lib/pinterest.ts in the app): its
// sign-in's code exchanged, and its boards and pins read, on their behalf --
// Pinterest's API takes no calls from a browser, and its tokens must never
// reach one. The app's secret is a secret here (PINTEREST_CLIENT_SECRET); each
// account's tokens are sealed in the directory (src/people.ts), bound to it.
// An existing account's Pinterest stays Supabase's (supabase/functions/pinterest-*).

import { tablesIn } from './people'
import { fromBase64, keyFrom, outbound, replies, toBase64, whoIs, type Env } from './who'

const API = 'https://api.pinterest.com/v5'
// Renewed a little before it runs out, so no request races it.
const RENEW_BEFORE_MS = 60_000

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
  const who = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!who) return answer(401, { error: 'Not authenticated' })
  if (who.kind === 'supabase') return answer(403, { error: 'An existing account’s Pinterest is Supabase’s' })
  await tablesIn(db)
  const key = await keyFrom(env.GOOGLE_CLIENT_SECRET, 'atrium pinterest', 'AES-GCM', ['encrypt', 'decrypt'])

  // The code from Pinterest's sign-in, exchanged: the account connected.
  if (what === 'exchange') {
    const code = typeof asked.code === 'string' ? asked.code : '', redirectUri = typeof asked.redirectUri === 'string' ? asked.redirectUri : ''
    if (!code || !redirectUri) return answer(400, { error: 'Missing code or redirectUri' })
    const got = await fromPinterest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    if (!got) return answer(502, { error: 'Pinterest rejected the authorization code' })
    let username: string | null = null
    const account = await fetch(outbound(env, `${API}/user_account`), { headers: { Authorization: `Bearer ${got.access}` } }).catch(() => null)
    if (account?.ok) username = ((await account.json()) as { username?: string }).username ?? null
    await db.prepare(`insert into pinterest (account, sealed, username, updated_at) values (?, ?, ?, ?)
      on conflict (account) do update set sealed = excluded.sealed, username = excluded.username, updated_at = excluded.updated_at`)
      .bind(who.id, await seal(key, who.id, got), username, Date.now()).run()
    return answer(200, { success: true, username })
  }

  if (what === 'status') {
    const row = await db.prepare('select username from pinterest where account = ?').bind(who.id).first<{ username: string | null }>()
    return answer(200, { connected: !!row, username: row?.username ?? null })
  }

  if (what === 'disconnect') {
    await db.prepare('delete from pinterest where account = ?').bind(who.id).run()
    return answer(200, { connected: false })
  }

  // Boards, and a board's pins, a page at a time.
  if (what === 'api') {
    const bookmark = typeof asked.bookmark === 'string' ? `&bookmark=${encodeURIComponent(asked.bookmark)}` : ''
    let path: string
    if (asked.action === 'boards') path = `/boards?page_size=100${bookmark}`
    else if (asked.action === 'pins' && typeof asked.boardId === 'string' && asked.boardId) path = `/boards/${encodeURIComponent(asked.boardId)}/pins?page_size=100${bookmark}`
    else return answer(400, { error: asked.action === 'pins' ? 'Missing boardId' : 'Unknown action' })
    const access = await accessFor(env, db, key, who.id)
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

// The account's access token: as kept, or renewed (and kept so) when it's
// about to run out. Null if it's not connected, or its connection is dead.
async function accessFor(env: Env, db: D1Database, key: CryptoKey, account: string): Promise<string | null> {
  const row = await db.prepare('select sealed from pinterest where account = ?').bind(account).first<{ sealed: string }>()
  const tokens = row ? await open(key, account, row.sealed) : null
  if (!tokens) return null
  if (tokens.until - Date.now() > RENEW_BEFORE_MS || !tokens.refresh) return tokens.access
  const renewed = await fromPinterest(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh })
  if (!renewed) return null
  const kept = { ...renewed, refresh: renewed.refresh ?? tokens.refresh }
  await db.prepare('update pinterest set sealed = ?, updated_at = ? where account = ?').bind(await seal(key, account, kept), Date.now(), account).run()
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

// Tokens sealed to their account: opened only as that account's.
async function seal(key: CryptoKey, account: string, tokens: Tokens): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(account) }, key, new TextEncoder().encode(JSON.stringify(tokens))))
  return toBase64(new Uint8Array([...iv, ...sealed]))
}
async function open(key: CryptoKey, account: string, sealed: string): Promise<Tokens | null> {
  try {
    const bytes = fromBase64(sealed)
    return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(account) }, key, bytes.subarray(12))))
  } catch {
    return null
  }
}
