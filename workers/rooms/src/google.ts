// Signing in with Google, and Drive (src/lib/drive.ts in the app). Google's
// pass lasts an hour, and in a browser only a click can ask for another; so a
// browser asks once, in Google's code flow, and this turns the code into a
// pass and a renewal grant -- which takes the app's secret, kept here. The
// grant never rests here: it goes back to the browser sealed with a key only
// this worker has, holding whose it is, and comes back with each renewal.
//
// Signing in asks Google for nothing but who one is; Drive is asked for when
// it's first used (a Drive atrium made or joined). So a Google account's
// grant may hold no Google renewal at all -- it's then the worker's own word
// that the browser is signed in, renewing the session alone.
//
// Whose: an existing account (a Supabase sign-in comes with the code, and
// with each renewal), or a Google account, whose id is made from Google's
// for the person -- and who gets the worker's own session with each pass
// (src/who.ts), which is how they're known to the rooms and the directory.

import { forgetGoogleGrant, googleGrantFor, keepGoogleGrant, link, linkedGoogleIds, linkedTo, meet, supersededBy } from './people'
import { accountIdFor, fromBase64, keyFrom, personOf, replies, signSession, toBase64, whoIs, type Env, type Who } from './who'

// A grant: Google's refresh token (none for a Google account signed in
// without Drive), the account it's for, its kind, and the Google account it
// was given by (Google's id for the person) -- so each renewal can tell whose
// Google it is.
interface Grant { r?: string; a: string; k: Who['kind']; g?: string }
interface Answer { access_token?: string; expires_in?: number; scope?: string; refresh_token?: string; id_token?: string; error?: string }

export async function google(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return answer(503, { error: 'not set up' })
  let asked: { token?: unknown; code?: unknown; grant?: unknown; access_token?: unknown }
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  const token = typeof asked.token === 'string' ? asked.token : null
  const key = await keyFrom(env.GOOGLE_CLIENT_SECRET, 'atrium drive grant', 'AES-GCM', ['encrypt', 'decrypt'])
  // Signed in already -- an existing account, or a Google account -- or not.
  const who = token ? await whoIs(token, env) : null
  if (token && !who) return answer(401, { error: 'sign-in' })

  // Google's code, from its window -- the one that asks for consent: the
  // grant kept here too, so that Google account needn't consent again, on
  // any browser.
  if (what === 'grant' && typeof asked.code === 'string') {
    // A code from Google's window in popup mode is exchanged with this address.
    const got = await fromGoogle(env, { grant_type: 'authorization_code', code: asked.code, redirect_uri: 'postmessage' })
    if (got instanceof Response) return withCors(got, answer)
    const person = personOf(got.id_token)
    if (person && got.refresh_token) await keepGoogleGrant(env, person.sub, await sealFor(key, person.sub, got.refresh_token))
    const [status, body] = await signedIn(env, key, who, got, person, got.refresh_token ?? null)
    return answer(status, body)
  }

  // Signing in: a pass Google gave this browser for who one is (the token
  // flow, prompt '' -- Google asks only the first time), checked with Google
  // as this app's. With the grant kept here for this Google, renewed: its
  // Drive, and Google's ID token. Without (no Drive yet, or its access taken
  // back), the pass alone signs in -- but an existing account is signed in to
  // by Supabase, with Google's ID token, which only consent gives: that, once.
  if (what === 'signin' && typeof asked.access_token === 'string') {
    const pass = await tokenInfo(env, asked.access_token)
    if (!pass) return answer(401, { error: 'google' })
    const kept = await googleGrantFor(env, pass.sub)
    const refresh = kept ? await openFor(key, pass.sub, kept) : null
    if (refresh) {
      const got = await fromGoogle(env, { grant_type: 'refresh_token', refresh_token: refresh })
      if (!(got instanceof Response)) {
        // Who it is: Google's ID token, if this answer has one -- else the pass's own word.
        const person = personOf(got.id_token) ?? pass
        const [status, body] = await signedIn(env, key, who, got, person, got.refresh_token ?? refresh)
        return answer(status, body)
      }
      if (got.status !== 401) return withCors(got, answer)
      await forgetGoogleGrant(env, pass.sub)
    }
    const [status, body] = await signedIn(env, key, who, { access_token: asked.access_token, expires_in: pass.expires_in, scope: pass.scope }, pass, null)
    return answer(status, body)
  }

  // An existing account on a browser without its grant: its Drive pass from
  // the grant kept here for its Google -- no window at all.
  if (what === 'resume' && who?.kind === 'supabase') {
    for (const googleId of await linkedGoogleIds(env, who.id)) {
      const kept = await googleGrantFor(env, googleId)
      const refresh = kept ? await openFor(key, googleId, kept) : null
      if (!refresh) continue
      const got = await fromGoogle(env, { grant_type: 'refresh_token', refresh_token: refresh })
      if (got instanceof Response) {
        if (got.status === 401) await forgetGoogleGrant(env, googleId)
        continue
      }
      return answer(200, {
        ...passOf(got),
        account: who,
        grant: await sealGrant(key, { r: got.refresh_token ?? refresh, a: who.id, k: 'supabase', g: googleId }),
      })
    }
    return answer(200, { consent: true })
  }

  if (what === 'renew' && typeof asked.grant === 'string') {
    const grant = await openGrant(key, asked.grant, token, env)
    // Its account's sign-in missing or run out: the grant itself may be fine.
    if (grant === 'sign-in') return answer(401, { error: 'sign-in' })
    if (!grant) return answer(401, { error: 'grant' })
    let got: Answer | null = null
    // Drive for a Google account taken back on Google's side: still signed
    // in -- a grant without it, in place of this one.
    let without: string | null = null
    if (grant.r) {
      const renewed = await fromGoogle(env, { grant_type: 'refresh_token', refresh_token: grant.r })
      if (renewed instanceof Response) {
        if (renewed.status !== 401 || grant.k !== 'google') return withCors(renewed, answer)
        without = await sealGrant(key, { a: grant.a, k: grant.k, g: grant.g })
      } else got = renewed
    }
    // Whose Google: as the grant says, or (one from before it said) Google's answer.
    const googleId = grant.g ?? personOf(got?.id_token)?.sub
    if (googleId && grant.k === 'supabase') await link(env, googleId, grant.a)
    // A Google account that's really an existing account's, never finished:
    // gone, and its person pointed to the account they already have.
    const superseded = grant.k === 'google' ? await supersededBy(env, grant.a, googleId ?? null) : null
    if (superseded) return answer(409, { error: 'existing account', how: superseded.how })
    return answer(200, {
      ...(got ? passOf(got) : {}),
      account: { id: grant.a, kind: grant.k },
      ...(without ? { grant: without } : {}),
      ...(grant.k === 'google' ? await signSession(env, grant.a) : {}),
    })
  }
  return answer(400, { error: 'body' })
}

/** Google has said who it is (`person`) and given a pass: the answer for the
 *  page, as [status, body]. An existing account connecting Drive gets its
 *  grant; someone signing in gets their Google account -- or, if this Google
 *  is an existing account's, that account to sign in to: with Google's own
 *  ID token, which Supabase signs this Google in with (linking it, if need
 *  be), where it will -- consent first, where there's none; and a grant for
 *  that account's Drive, which renews only with that account's own sign-in.
 *  A Google account's grant is its sign-in, Drive (`refresh`) or not. */
async function signedIn(env: Env, key: CryptoKey, who: Who | null, got: Answer, person: Person | null, refresh: string | null): Promise<[number, object]> {
  const grantFor = async (account: Who) => (refresh || account.kind === 'google'
    ? { grant: await sealGrant(key, { ...(refresh ? { r: refresh } : {}), a: account.id, k: account.kind, ...(person ? { g: person.sub } : {}) }) }
    : {})
  if (who?.kind === 'supabase') {
    if (person) await link(env, person.sub, who.id)
    return [200, { ...passOf(got), account: who, ...(await grantFor(who)) }]
  }
  if (!person) return [400, { error: 'identity' }]
  const existing = who ? null : await linkedTo(env, person.sub, person.email ?? null)
  if (existing) {
    if (existing.joinable && !got.id_token) return [200, { consent: true }]
    return [200, {
      ...passOf(got),
      existing,
      ...(existing.joinable && got.id_token ? { id_token: got.id_token } : {}),
      ...(await grantFor({ id: existing.account, kind: 'supabase' })),
    }]
  }
  const account: Who = { id: await accountIdFor(person.sub), kind: 'google' }
  // A Google account is that Google account's alone.
  if (who && who.id !== account.id) return [409, { error: 'another google account' }]
  await meet(env, account.id, person)
  return [200, {
    ...passOf(got),
    account: { ...account, email: person.email, name: person.name, picture: person.picture },
    ...(await grantFor(account)),
    ...(await signSession(env, account.id)),
  }]
}
type Person = NonNullable<ReturnType<typeof personOf>>

/** A pass's owner, as Google says: only one given to this app. */
async function tokenInfo(env: Env, accessToken: string): Promise<{ sub: string; email?: string; scope?: string; expires_in?: number } | null> {
  try {
    const response = await fetch(`${env.GOOGLE_TOKENINFO_URL || 'https://oauth2.googleapis.com/tokeninfo'}?access_token=${encodeURIComponent(accessToken)}`)
    if (!response.ok) return null
    const info = await response.json() as { aud?: string; azp?: string; sub?: string; email?: string; email_verified?: string | boolean; scope?: string; expires_in?: string | number }
    if (info.aud !== env.GOOGLE_CLIENT_ID && info.azp !== env.GOOGLE_CLIENT_ID) return null
    if (typeof info.sub !== 'string') return null
    const verified = info.email_verified === true || info.email_verified === 'true'
    return { sub: info.sub, email: verified ? info.email : undefined, scope: info.scope, expires_in: Number(info.expires_in) || 0 }
  } catch {
    return null
  }
}

// The grant kept here for a Google account: its refresh token, sealed to
// that account (the key is the app's secret's, as browsers' grants are).
async function sealFor(key: CryptoKey, googleId: string, refresh: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`kept:${googleId}`) }, key, new TextEncoder().encode(refresh)))
  return toBase64(new Uint8Array([...iv, ...sealed]))
}
async function openFor(key: CryptoKey, googleId: string, sealed: string): Promise<string | null> {
  try {
    const bytes = fromBase64(sealed)
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(`kept:${googleId}`) }, key, bytes.subarray(12)))
  } catch {
    return null
  }
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
