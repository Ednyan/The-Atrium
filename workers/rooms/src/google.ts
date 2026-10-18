// Signing in with Google, and Drive (src/lib/drive.ts in the app). Google's
// pass lasts an hour, and in a browser only a click can ask for another; so a
// browser asks once, in Google's code flow, and this turns the code into a
// pass and a renewal grant -- which takes the app's secret, kept here. The
// grant never rests here: it goes back to the browser sealed with a key only
// this worker has, holding whose it is, and comes back with each renewal.
//
// Signing in is Google's "Sign in with Google" button: one click, and its ID
// token, checked here, says who one is -- nothing of Drive, which is asked
// for when it's first used (a Drive atrium made or joined). So a Google
// account's grant may hold no Google renewal at all -- it's then the
// worker's own word that the browser is signed in, renewing the session alone.
//
// Whose: an existing account (a Supabase sign-in comes with the code, and
// with each renewal), or a Google account, whose id is made from Google's
// for the person -- and who gets the worker's own session with each pass
// (src/who.ts), which is how they're known to the rooms and the directory.

import { goodbye } from './mail'
import { accountKept, forgetAccount, forgetGoogleGrant, googleGrantFor, keepGoogleGrant, link, linkedGoogleIds, linkedTo, meet, supersededBy } from './people'
import { accountIdFor, fromBase64, fromUrl, keyFrom, personOf, replies, signSession, toBase64, whoIs, type Env, type Who } from './who'

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
  let asked: { token?: unknown; code?: unknown; grant?: unknown; id_token?: unknown; language?: unknown }
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

  // Signing in: Google's ID token, from its button, checked here. An
  // existing account is signed in to by Supabase with that same token. With
  // the grant kept here for this Google (Drive given before, anywhere),
  // renewed: its Drive on this browser at once. That failing, signed in all
  // the same -- Drive is asked for again where it's used.
  if (what === 'identity' && typeof asked.id_token === 'string') {
    const person = await idTokenPerson(env, asked.id_token)
    if (!person) return answer(401, { error: 'google' })
    const kept = await googleGrantFor(env, person.sub)
    const refresh = kept ? await openFor(key, person.sub, kept) : null
    if (refresh) {
      const got = await fromGoogle(env, { grant_type: 'refresh_token', refresh_token: refresh })
      if (!(got instanceof Response)) {
        const [status, body] = await signedIn(env, key, who, got, person, got.refresh_token ?? refresh)
        return answer(status, body)
      }
      // Taken back on Google's side: not kept.
      if (got.status === 401) await forgetGoogleGrant(env, person.sub)
    }
    const [status, body] = await signedIn(env, key, who, {}, person, null)
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

  // Drive given back: Google told to forget this app's access (its renewals
  // revoked -- on every device), and none kept here. A Google account stays
  // signed in: a grant without Drive, in place of the one it had. Drive is
  // asked for again where it's used.
  if (what === 'disconnect') {
    const grant = typeof asked.grant === 'string' ? await openGrant(key, asked.grant, token, env) : null
    if (grant === 'sign-in') return answer(401, { error: 'sign-in' })
    if (!grant && who?.kind !== 'supabase') return answer(401, { error: 'grant' })
    const googleIds = new Set(grant?.g ? [grant.g] : [])
    if (who?.kind === 'supabase') for (const googleId of await linkedGoogleIds(env, who.id)) googleIds.add(googleId)
    await giveBack(env, key, googleIds, grant?.r ? [grant.r] : [])
    return answer(200, grant?.k === 'google' ? { grant: await sealGrant(key, { a: grant.a, k: grant.k, g: grant.g }) } : {})
  }

  // A Google account deleted, on its own say-so: its session, and a sign-in
  // with its Google just now (Google's button, once more) -- so a session
  // left open somewhere can't do it. Google told to forget this app, and the
  // account gone from the directory. What it keeps in its own Google Drive
  // stays its own.
  if (what === 'delete') {
    if (who?.kind !== 'google') return answer(403, { error: 'not a Google account' })
    const person = typeof asked.id_token === 'string' ? await idTokenPerson(env, asked.id_token, CONFIRM_WITHIN_MS) : null
    if (!person || await accountIdFor(person.sub) !== who.id) return answer(403, { error: 'confirm' })
    const grant = typeof asked.grant === 'string' ? await openGrant(key, asked.grant, token, env) : null
    await giveBack(env, key, [person.sub], grant && grant !== 'sign-in' && grant.r ? [grant.r] : [])
    // Whom to say goodbye to, read before the row goes: once it has, said.
    const row = env.PEOPLE ? await env.PEOPLE.prepare('select email, username, display_name from accounts where id = ?').bind(who.id).first<{ email: string | null; username: string | null; display_name: string | null }>() : null
    if (env.PEOPLE) await forgetAccount(env.PEOPLE, who.id)
    if (row?.email) await goodbye(env, row.email, row.display_name || row.username || '', asked.language)
    return answer(200, { deleted: true })
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
    // A Google account deleted: its grant renews nothing (the browser signs out).
    if (grant.k === 'google' && env.PEOPLE && !await accountKept(env.PEOPLE, grant.a)) return answer(401, { error: 'grant' })
    return answer(200, {
      ...(got ? passOf(got) : {}),
      account: { id: grant.a, kind: grant.k },
      ...(without ? { grant: without } : {}),
      ...(grant.k === 'google' ? await signSession(env, grant.a) : {}),
    })
  }
  return answer(400, { error: 'body' })
}

/** Google has said who it is (`person`): the answer for the page, as
 *  [status, body]. An existing account connecting Drive gets its grant;
 *  someone signing in gets their Google account -- or, if this Google is an
 *  existing account's, that account to sign in to: with Google's own ID
 *  token, which Supabase signs this Google in with (linking it, if need be),
 *  where it will; and a grant for that account's Drive, which renews only
 *  with that account's own sign-in. A Google account's grant is its sign-in,
 *  Drive (`refresh`) or not. */
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
    return [200, {
      ...passOf(got),
      existing,
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

// Google told to forget this app's access for these Googles -- every renewal
// kept for them here, and any the browser's grant holds -- and none kept.
async function giveBack(env: Env, key: CryptoKey, googleIds: Iterable<string>, held: string[]): Promise<void> {
  const renewals = new Set(held)
  for (const googleId of googleIds) {
    const kept = await googleGrantFor(env, googleId)
    const refresh = kept ? await openFor(key, googleId, kept) : null
    if (refresh) renewals.add(refresh)
    await forgetGoogleGrant(env, googleId)
  }
  await Promise.all([...renewals].map(refresh => fetch(env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: refresh }) })))
}

// A sign-in that confirms something (a deletion): this recent, at most.
const CONFIRM_WITHIN_MS = 10 * 60 * 1000

/** Google's ID token, checked here: signed by Google, given to this app, not
 *  run out -- and, `within`, issued no longer ago than that. Its person (the
 *  address only if Google verified it), or null. */
async function idTokenPerson(env: Env, idToken: string, within?: number): Promise<Person | null> {
  const [head, body, signature] = idToken.split('.')
  if (!head || !body || !signature) return null
  try {
    const header = JSON.parse(new TextDecoder().decode(fromUrl(head))) as { alg?: unknown; kid?: unknown }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null
    const key = await googleKey(env, header.kid)
    if (!key || !await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromUrl(signature), new TextEncoder().encode(`${head}.${body}`))) return null
    const claims = JSON.parse(new TextDecoder().decode(fromUrl(body))) as { iss?: unknown; aud?: unknown; exp?: unknown; iat?: unknown }
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return null
    if (claims.aud !== env.GOOGLE_CLIENT_ID || typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) return null
    if (within && (typeof claims.iat !== 'number' || Date.now() - claims.iat * 1000 > within)) return null
    return personOf(idToken)
  } catch {
    return null
  }
}

// Google's keys for its ID tokens, kept as long as Google says they hold --
// fetched again sooner for a key not among them (Google's turned over), but
// at most once a minute, whatever tokens come.
let certs: { keys: Map<string, CryptoKey>; until: number; at: number } | null = null
async function googleKey(env: Env, kid: string): Promise<CryptoKey | null> {
  const stale = !certs || Date.now() > certs.until
  if (stale || (!certs!.keys.has(kid) && Date.now() - certs!.at > 60_000)) {
    const response = await fetch(env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs')
    if (!response.ok) return certs?.keys.get(kid) ?? null
    const { keys } = await response.json() as { keys: (JsonWebKey & { kid: string })[] }
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 3600)
    certs = {
      keys: new Map(await Promise.all(keys.map(async jwk => [jwk.kid, await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])] as const))),
      until: Date.now() + maxAge * 1000,
      at: Date.now(),
    }
  }
  return certs!.keys.get(kid) ?? null
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
