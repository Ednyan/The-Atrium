// Who someone is, to the worker: a Supabase sign-in (an existing account), or
// the worker's own session (a Google account, src/google.ts). And what the
// worker's parts share besides: what it's given, and how it answers pages.

import type { Room } from './index'
import { isBanned } from './people'

export interface Env {
  ROOMS: DurableObjectNamespace<Room>
  // Whose a Supabase sign-in is: Supabase Auth is asked.
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  // Google sign-in: the app's client id (wrangler.toml) and secret (a
  // secret). Without the secret, the app asks Google itself, and there are
  // no Google accounts.
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  // Google's token address, its keys for ID tokens, and where access is given
  // back; others only in a local test.
  GOOGLE_TOKEN_URL?: string
  GOOGLE_CERTS_URL?: string
  GOOGLE_REVOKE_URL?: string
  // The directory (src/people.ts).
  PEOPLE?: D1Database
  // The worker's key to Supabase's account_for_email (a secret; Supabase
  // keeps only its SHA-256 -- add_account_for_email.sql).
  SUPABASE_WORKER_KEY?: string
  // Cloudflare's relay (src/relay.ts): its TURN key, and an API token that
  // reads the account's usage (secrets); the budget, in GB a month (800 if
  // unset, 0 switches the relay off).
  CF_TURN_KEY_ID?: string
  CF_TURN_KEY_TOKEN?: string
  CF_ACCOUNT_ID?: string
  CF_ANALYTICS_TOKEN?: string
  RELAY_BUDGET_GB?: string
  // Mail, through Resend (src/mail.ts): its key (a secret).
  RESEND_API_KEY?: string
  // Pinterest's app (src/pinterest.ts): its id and secret (secrets).
  PINTEREST_CLIENT_ID?: string
  PINTEREST_CLIENT_SECRET?: string
  // The hosted store (src/store.ts): its bytes, and each account's quota in
  // MB (50 if unset).
  FILES?: R2Bucket
  STORE_QUOTA_MB?: string
  // Contributions (src/contributions.ts): Stripe's restricted key, and the
  // webhook endpoint's signing secret (secrets).
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  // A local test's stand-in for every other service on the internet
  // (Resend, Cloudflare's APIs, Pinterest): never set live.
  TEST_UPSTREAM?: string
}

// Who's asking: an account, its kind -- an existing account (Supabase's), a
// Google account, or an email account (phase 10, src/auth.ts) -- and, an
// existing account's, its address once Supabase has confirmed it (the others'
// are in the directory, src/people.ts emailOf).
export interface Who { id: string; kind: 'google' | 'supabase' | 'email'; email?: string }

/** Where a request to another service goes: there, or -- in a local test --
 *  to its stand-in, by the same address under it. */
export const outbound = (env: Env, url: string) => (env.TEST_UPSTREAM ? `${env.TEST_UPSTREAM}/${url.replace(/^https:\/\//, '')}` : url)

/** Who's asking, by their token -- or null: none, not one this worker or
 *  Supabase knows, or an account banned (people.ts), as good as signed out
 *  for everything the worker runs. */
export async function whoIs(token: string | null | undefined, env: Env): Promise<Who | null> {
  const who = await identify(token, env)
  return who && !(await isBanned(env, who.id)) ? who : null
}
async function identify(token: string | null | undefined, env: Env): Promise<Who | null> {
  if (!token) return null
  if (token.startsWith(SESSION)) return sessionUser(env, token)
  try {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY } })
    if (!response.ok) return null
    const user = await response.json() as { id?: unknown; email?: unknown; email_confirmed_at?: unknown }
    if (typeof user.id !== 'string') return null
    return { id: user.id, kind: 'supabase', ...(typeof user.email === 'string' && user.email_confirmed_at ? { email: user.email } : {}) }
  } catch {
    return null
  }
}

// The site's pages, the desktop app's (Tauri's own address: http or https
// tauri.localhost on Windows, tauri://localhost elsewhere), and a local one (a
// test, or the app run locally). Plain requests (a text body, no headers of
// their own), so a browser sends them without asking first: one request each.
const ORIGINS = /^(https:\/\/(www\.)?digitalatrium\.org|https?:\/\/tauri\.localhost|tauri:\/\/localhost|http:\/\/(localhost|127\.0\.0\.1):\d+)$/

/** Whether a page of the site's is asking, and a JSON answer readable by it. */
export function replies(request: Request) {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = ORIGINS.test(origin) && request.method === 'POST'
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) },
  })
  return { allowed, answer }
}

// ---------------------------------------------------------------- files sent

// A file the hosted store or a mirror is sent (src/store.ts, src/mirror.ts):
// 25 MB at most, its name anything but a path or control characters.
export const MOST_FILE_BYTES = 25 * 1024 * 1024
export const FILE_NAME = /^[^\u0000-\u001f/]{1,200}$/
const MOST_HEAD_BYTES = 16 * 1024

/** A file as a page sends it: a line of JSON first -- the sign-in, where it
 *  goes -- then its bytes, in one plain request. The bytes are handed on as
 *  they arrive, a stream of known length for R2, never parsed or copied
 *  whole: a big file costs next to no CPU (the free plan allows 10 ms).
 *  Null if the head can't be read. */
export async function sentFile(request: Request): Promise<{ head: Record<string, unknown>; size: number; body: ReadableStream | ArrayBuffer | null } | null> {
  // ponytail: the form pages sent before (multipart, parsed whole) -- drop once no open page can send it.
  if ((request.headers.get('Content-Type') ?? '').startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    if (!form) return null
    const bytes = form.get('bytes')
    const head = Object.fromEntries([...form.entries()].filter(([key]) => key !== 'bytes').map(([key, value]) => [key, String(value)]))
    return { head, size: bytes instanceof File ? bytes.size : 0, body: bytes instanceof File ? await bytes.arrayBuffer() : null }
  }
  const total = Number(request.headers.get('Content-Length'))
  if (!request.body || !Number.isFinite(total)) return null
  const reader = request.body.getReader()
  let held = new Uint8Array(0)
  for (;;) {
    const end = held.indexOf(10)
    if (end >= 0) {
      let head: Record<string, unknown>
      try { head = JSON.parse(new TextDecoder().decode(held.subarray(0, end))) } catch { return null }
      if (!head || typeof head !== 'object') return null
      const size = total - end - 1
      if (size < 0) return null
      const { readable, writable } = new FixedLengthStream(size)
      const rest = held.subarray(end + 1)
      // The rest, passed on as it comes -- while whoever asked checks who's sending it.
      void (async () => {
        const writer = writable.getWriter()
        try {
          if (rest.length) await writer.write(rest)
          for (let part = await reader.read(); !part.done; part = await reader.read()) await writer.write(part.value)
          await writer.close()
        } catch (error) {
          await writer.abort(error).catch(() => {})
        }
      })()
      return { head, size, body: readable }
    }
    if (held.length > MOST_HEAD_BYTES) return null
    const part = await reader.read()
    if (part.done) return null
    const joined = new Uint8Array(held.length + part.value.length)
    joined.set(held)
    joined.set(part.value, held.length)
    held = joined
  }
}

// ---------------------------------------------------------------- keys

/** A key made from the app's secret, by what it's for: a new secret makes
 *  every grant and session useless, and each browser signs in once again. */
export const keyFrom = async (secret: string, label: string, algorithm: 'AES-GCM' | 'HMAC', usages: ('encrypt' | 'decrypt' | 'sign' | 'verify')[]) =>
  crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${label}\n${secret}`)),
    algorithm === 'HMAC' ? { name: 'HMAC', hash: 'SHA-256' } : 'AES-GCM', false, usages)

// In slices, and by a plain loop: spreading a large array into one call
// overflows it, and a callback per byte is CPU the free plan doesn't have.
export const toBase64 = (bytes: Uint8Array) => {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}
export const fromBase64 = (text: string) => {
  const raw = atob(text)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}
const toUrl = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const fromUrl = (text: string) => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4))

// ---------------------------------------------------------------- sessions

// The worker's word for who a Google account or an email account is, for an
// hour: signed here and checked here, so a room lets someone in without
// asking anyone else. An email account's says so (`k`); a Google account's,
// as ever, doesn't.
const SESSION = 'a1.'
const SESSION_MS = 60 * 60_000

export async function signSession(env: Env, id: string, kind: Who['kind'] = 'google'): Promise<{ session: string; until: number }> {
  const until = Date.now() + SESSION_MS
  const body = toUrl(new TextEncoder().encode(JSON.stringify({ id, until, ...(kind === 'google' ? {} : { k: KINDS[kind] }) })))
  const key = await keyFrom(env.GOOGLE_CLIENT_SECRET!, 'atrium session', 'HMAC', ['sign'])
  const mac = toUrl(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))
  return { session: `${SESSION}${body}.${mac}`, until }
}

// A session's kind of account, in its body: a Google account's says none (as
// they did first); an existing account's is one only the desktop app holds
// (auth.ts, link) -- elsewhere Supabase's own token is its sign-in.
const KINDS = { email: 'e', supabase: 's', google: '' } as const

async function sessionUser(env: Env, token: string): Promise<Who | null> {
  const [body, mac] = token.slice(SESSION.length).split('.')
  if (!env.GOOGLE_CLIENT_SECRET || !body || !mac) return null
  try {
    const key = await keyFrom(env.GOOGLE_CLIENT_SECRET, 'atrium session', 'HMAC', ['verify'])
    if (!(await crypto.subtle.verify('HMAC', key, fromUrl(mac), new TextEncoder().encode(body)))) return null
    const { id, until, k } = JSON.parse(new TextDecoder().decode(fromUrl(body))) as { id?: unknown; until?: unknown; k?: unknown }
    return typeof id === 'string' && typeof until === 'number' && Date.now() < until ? { id, kind: k === 'e' ? 'email' : k === 's' ? 'supabase' : 'google' } : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- a Google account's id

// A UUID (v5) made from Google's id for the person: the same each time they
// sign in, chosen by nobody, and shaped as an existing account's id is.
const NAMESPACE = '8f1e6c2a-4b7d-5e93-a0c4-2d6f9b1e7a35'

export async function accountIdFor(googleId: string): Promise<string> {
  const space = Uint8Array.from(NAMESPACE.replace(/-/g, '').match(/../g)!, pair => parseInt(pair, 16))
  const name = new TextEncoder().encode(`google:${googleId}`)
  const joined = new Uint8Array(space.length + name.length)
  joined.set(space)
  joined.set(name, space.length)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', joined)).slice(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = [...hash].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Who Google says it is, from the ID token in Google's own answer -- had
 *  from Google directly, over TLS, so it needn't be checked further. Its
 *  email only where Google has verified it's theirs. */
export function personOf(idToken: unknown): { sub: string; email?: string; name?: string; picture?: string } | null {
  if (typeof idToken !== 'string') return null
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromUrl(idToken.split('.')[1]))) as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown; picture?: unknown }
    if (typeof claims.sub !== 'string') return null
    const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
    const verified = claims.email_verified === true || claims.email_verified === 'true'
    return { sub: claims.sub, email: verified ? text(claims.email) : undefined, name: text(claims.name), picture: text(claims.picture) }
  } catch {
    return null
  }
}
