// Signing in with Google (src/lib/drive.ts in the app). Google's pass lasts
// an hour, and in a browser only a click can ask for another; so a browser
// asks once, in Google's code flow, and this turns the code into a pass and a
// renewal grant -- which takes the app's secret, kept here. The grant never
// rests here: it goes back to the browser sealed with a key only this worker
// has, holding whose it is, and comes back with each renewal.
//
// Whose: an existing account (a Supabase sign-in comes with the code, and
// with each renewal), or a Google account, whose id is made from Google's
// for the person -- and who gets the worker's own session with each pass
// (src/who.ts), which is how they're known to the rooms and the directory.

import { link, linkedTo, meet, supersededBy } from './people'
import { accountIdFor, fromBase64, keyFrom, personOf, replies, signSession, toBase64, whoIs, type Env, type Who } from './who'

// A grant: Google's refresh token, the account it's for, its kind, and the
// Google account it was given by (Google's id for the person) -- so each
// renewal can tell whose Google it is.
interface Grant { r: string; a: string; k: Who['kind']; g?: string }
interface Answer { access_token?: string; expires_in?: number; scope?: string; refresh_token?: string; id_token?: string; error?: string }

export async function google(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return answer(503, { error: 'not set up' })
  let asked: { token?: unknown; code?: unknown; grant?: unknown }
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  const token = typeof asked.token === 'string' ? asked.token : null
  const key = await keyFrom(env.GOOGLE_CLIENT_SECRET, 'atrium drive grant', 'AES-GCM', ['encrypt', 'decrypt'])

  if (what === 'grant' && typeof asked.code === 'string') {
    // Signed in already -- an existing account connecting Drive, or a
    // Google account asking Google for more -- or signing in now.
    const who = token ? await whoIs(token, env) : null
    if (token && !who) return answer(401, { error: 'sign-in' })
    // A code from Google's window in popup mode is exchanged with this address.
    const got = await fromGoogle(env, { grant_type: 'authorization_code', code: asked.code, redirect_uri: 'postmessage' })
    if (got instanceof Response) return withCors(got, answer)
    const person = personOf(got.id_token)
    let account: Who
    if (who?.kind === 'supabase') {
      account = who
      if (person) await link(env, person.sub, who.id)
    } else {
      if (!person) return answer(400, { error: 'identity' })
      // Already someone's existing account: theirs to sign in to, not a second one.
      const existing = who ? null : await linkedTo(env, person.sub, person.email ?? null)
      if (existing) return answer(409, { error: 'existing account', how: existing.how })
      account = { id: await accountIdFor(person.sub), kind: 'google' }
      // A Google account is that Google account's alone.
      if (who && who.id !== account.id) return answer(409, { error: 'another google account' })
      await meet(env, account.id, person)
    }
    return answer(200, {
      ...passOf(got),
      account: { ...account, ...(person ? { email: person.email, name: person.name, picture: person.picture } : {}) },
      ...(got.refresh_token ? { grant: await sealGrant(key, { r: got.refresh_token, a: account.id, k: account.kind, ...(person ? { g: person.sub } : {}) }) } : {}),
      ...(account.kind === 'google' ? await signSession(env, account.id) : {}),
    })
  }

  if (what === 'renew' && typeof asked.grant === 'string') {
    const grant = await openGrant(key, asked.grant, token, env)
    // Its account's sign-in missing or run out: the grant itself may be fine.
    if (grant === 'sign-in') return answer(401, { error: 'sign-in' })
    if (!grant) return answer(401, { error: 'grant' })
    const got = await fromGoogle(env, { grant_type: 'refresh_token', refresh_token: grant.r })
    if (got instanceof Response) return withCors(got, answer)
    // Whose Google: as the grant says, or (one from before it said) Google's answer.
    const googleId = grant.g ?? personOf(got.id_token)?.sub
    if (googleId && grant.k === 'supabase') await link(env, googleId, grant.a)
    // A Google account that's really an existing account's, never finished:
    // gone, and its person pointed to the account they already have.
    const superseded = grant.k === 'google' ? await supersededBy(env, grant.a, googleId ?? null) : null
    if (superseded) return answer(409, { error: 'existing account', how: superseded.how })
    return answer(200, {
      ...passOf(got),
      account: { id: grant.a, kind: grant.k },
      ...(grant.k === 'google' ? await signSession(env, grant.a) : {}),
    })
  }
  return answer(400, { error: 'body' })
}

const passOf = (got: Answer) => ({ access_token: got.access_token, expires_in: got.expires_in, scope: got.scope })

// Google's token address, answered: its tokens, or the answer to give the page.
async function fromGoogle(env: Env, form: Record<string, string>): Promise<Answer | Response> {
  const response = await fetch(env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ ...form, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET! }),
  })
  const got = await response.json().catch(() => ({})) as Answer
  // Taken back (the person removed the app's access), or a code already used.
  if (got.error === 'invalid_grant') return Response.json({ error: 'grant' }, { status: 401 })
  if (!response.ok || !got.access_token) return Response.json({ error: 'google', detail: got.error }, { status: 502 })
  return got
}
const withCors = async (response: Response, answer: (status: number, body: unknown) => Response) => answer(response.status, await response.json())

async function sealGrant(key: CryptoKey, grant: Grant): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(grant))))
  return toBase64(new Uint8Array([...iv, ...sealed]))
}

/** A grant sealed here, and whose: an existing account's only with that
 *  account's sign-in alongside ('sign-in' without it). Null for anything
 *  else. */
async function openGrant(key: CryptoKey, sealed: string, token: string | null, env: Env): Promise<Grant | 'sign-in' | null> {
  let bytes: Uint8Array
  try {
    bytes = fromBase64(sealed)
  } catch {
    return null
  }
  const open = async (additionalData?: string) => new TextDecoder().decode(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, 12), ...(additionalData ? { additionalData: new TextEncoder().encode(additionalData) } : {}) }, key, bytes.subarray(12)))
  try {
    const grant = JSON.parse(await open()) as Grant
    if (grant.k === 'google') return grant
    const who = await whoIs(token, env)
    if (!who) return 'sign-in'
    return who.kind === 'supabase' && who.id === grant.a ? grant : null
  } catch {
    // From before accounts (2026-10-16): the refresh token alone, bound to
    // the Supabase account it was given to.
    const who = await whoIs(token, env)
    if (!who) return 'sign-in'
    if (who.kind !== 'supabase') return null
    try {
      return { r: await open(who.id), a: who.id, k: 'supabase' }
    } catch {
      return null
    }
  }
}
