// Who someone is, to the worker: a Supabase sign-in (an existing account), or
// the worker's own session (a Google account, src/google.ts). And what the
// worker's parts share besides: what it's given, and how it answers pages.

import type { Room } from './index'

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
  // Google's token address; another only in a local test.
  GOOGLE_TOKEN_URL?: string
  // The directory (src/people.ts).
  PEOPLE?: D1Database
  // The worker's key to Supabase's account_for_email (a secret; Supabase
  // keeps only its SHA-256 -- add_account_for_email.sql).
  SUPABASE_WORKER_KEY?: string
}

export interface Who { id: string; kind: 'google' | 'supabase' }

export async function whoIs(token: string | null | undefined, env: Env): Promise<Who | null> {
  if (!token) return null
  if (token.startsWith(SESSION)) {
    const id = await sessionUser(env, token)
    return id ? { id, kind: 'google' } : null
  }
  try {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY } })
    if (!response.ok) return null
    const user = await response.json() as { id?: unknown }
    return typeof user.id === 'string' ? { id: user.id, kind: 'supabase' } : null
  } catch {
    return null
  }
}

// The site's pages, and a local one (a test, or the app run locally). Plain
// requests (a text body, no headers of their own), so a browser sends them
// without asking first: one request each.
const ORIGINS = /^(https:\/\/(www\.)?digitalatrium\.org|http:\/\/(localhost|127\.0\.0\.1):\d+)$/

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

// ---------------------------------------------------------------- keys

/** A key made from the app's secret, by what it's for: a new secret makes
 *  every grant and session useless, and each browser signs in once again. */
export const keyFrom = async (secret: string, label: string, algorithm: 'AES-GCM' | 'HMAC', usages: ('encrypt' | 'decrypt' | 'sign' | 'verify')[]) =>
  crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${label}\n${secret}`)),
    algorithm === 'HMAC' ? { name: 'HMAC', hash: 'SHA-256' } : 'AES-GCM', false, usages)

export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0))
const toUrl = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromUrl = (text: string) => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4))

// ---------------------------------------------------------------- sessions

// The worker's word for who a Google account is, for an hour: signed here
// and checked here, so a room lets someone in without asking anyone else.
const SESSION = 'a1.'
const SESSION_MS = 60 * 60_000

export async function signSession(env: Env, id: string): Promise<{ session: string; until: number }> {
  const until = Date.now() + SESSION_MS
  const body = toUrl(new TextEncoder().encode(JSON.stringify({ id, until })))
  const key = await keyFrom(env.GOOGLE_CLIENT_SECRET!, 'atrium session', 'HMAC', ['sign'])
  const mac = toUrl(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))
  return { session: `${SESSION}${body}.${mac}`, until }
}

async function sessionUser(env: Env, token: string): Promise<string | null> {
  const [body, mac] = token.slice(SESSION.length).split('.')
  if (!env.GOOGLE_CLIENT_SECRET || !body || !mac) return null
  try {
    const key = await keyFrom(env.GOOGLE_CLIENT_SECRET, 'atrium session', 'HMAC', ['verify'])
    if (!(await crypto.subtle.verify('HMAC', key, fromUrl(mac), new TextEncoder().encode(body)))) return null
    const { id, until } = JSON.parse(new TextDecoder().decode(fromUrl(body))) as { id?: unknown; until?: unknown }
    return typeof id === 'string' && typeof until === 'number' && Date.now() < until ? id : null
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
