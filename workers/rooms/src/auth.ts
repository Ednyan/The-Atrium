// Email accounts (docs/DECENTRALIZING.md, phase 10, step 4): signing up and
// in, staying signed in, a forgotten password, a new one, deletion -- by the
// worker, its mail by Resend. A Google account's sign-in is Google's
// (src/google.ts); an email account's is its address (or username) and
// password, checked here.
//
// The password never comes here. The page stretches it -- PBKDF2, 600,000
// rounds of SHA-256 (OWASP's figure), with a salt of the account's own -- and
// sends what that makes, the key; kept here is SHA-256 of the key under a salt
// of the worker's, the verifier. The stretching is the page's because a worker
// on Cloudflare's free plan has 10 ms of CPU a request, and a proper password
// hash takes far more: done there, a stolen database still costs 600,000
// rounds a guess, account by account. The key is as good as the password to
// whoever holds it -- as a password sent would be -- and travels only here.
//
// Two salts an account, two verifiers: one for signing in with its address,
// one with its username. The salt is the first thing a page asks for, before
// any password; one salt for both would answer "is this address that
// username's?" to anyone who asked for both. A login that doesn't exist gets
// a salt all the same -- made from its name with the worker's key, the very
// one a new account would get -- so asking says nothing of who has an account.
//
// Existing accounts (Supabase's) stay signed in by Supabase until the cutover
// (step 7): their credential is copied here as they sign in there (adopt), so
// the cutover needs no export of Supabase's hashes, and no reset for anyone
// who came back meanwhile. Only a password sign-in of the last minutes may do
// it: a session alone, stolen, can't set a password here.

import { authCode, goodbye, welcome } from './mail'
import { forgetAccount, isBanned, meetExisting, supabaseUsername, takenInSupabase, tablesIn, USERNAME, allowedNow } from './people'
import { dropOwnFiles } from './store'
import { fromBase64, fromUrl, keyFrom, replies, signSession, toBase64, whoIs, type Env, type Who } from './who'

// The page's stretching: its rounds, for accounts made from now on (each
// login keeps its own, so this can rise).
const ROUNDS = 600_000
const SALT_BYTES = 16
const KEY_BYTES = 32
// Staying signed in: a renewal token, each use moving its end this far on.
const STAY_MS = 90 * 24 * 60 * 60_000
// Codes mailed (confirming an address, a forgotten password): how long one
// holds, how many tries it takes, and how soon another may be sent.
const CODE_MS = 15 * 60_000
const CODE_TRIES = 5
const CODE_EVERY_MS = 60_000
// And so many a day an account, from however many networks: each new code
// starts its tries again, so this is what bounds guessing one -- 8 codes, 40
// tries, against a million.
const CODES_A_DAY = 8
const DAY_MS = 24 * 60 * 60 * 1000
// An address never confirmed: its account let go after this, its username free.
const UNCONFIRMED_MS = 24 * 60 * 60_000
// The desktop app signed in by the site: how long its code holds, how many
// links a network may ask for and how many codes an account may try, an hour.
const LINK_MS = 10 * 60_000
const LINKS_AN_HOUR = 10
const LINK_TRIES_AN_HOUR = 20
// Its code: eight of these, none mistaken for another (no 0/O, 1/I/L).
const LINK_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
// Wrong passwords: this many, then a wait that doubles with each more, to this.
const FREE_TRIES = 5
const LONGEST_WAIT_MS = 60 * 60_000
// An existing account's credential copied here: only with a password sign-in this recent.
const ADOPT_WITHIN_MS = 10 * 60_000
// Sign-ups and codes asked for, from one address in an hour.
const HOUR_MS = 60 * 60_000
const SIGNUPS_AN_HOUR = 5
const CODES_AN_HOUR = 10

type Form = 'email' | 'name'
interface Login {
  account: string; email: string; seal: string; rounds: number
  email_salt: string; email_verifier: string; name_salt: string | null; name_verifier: string | null
  confirmed_at: number | null; failures: number; locked_until: number | null; created_at: number
}
interface Account { id: string; kind: string; username: string | null; display_name: string | null; email: string | null }

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,63}$/
const formOf = (login: string): Form => (login.includes('@') ? 'email' : 'name')
const lower = (text: string) => text.trim().toLowerCase()

export async function auth(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  const db = env.PEOPLE
  // Sessions are signed with the app's secret (who.ts): none, no sign-ins.
  if (!db || !env.GOOGLE_CLIENT_SECRET) return answer(503, { error: 'not set up' })
  let asked: Record<string, unknown>
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  await tablesIn(db)
  // Whose network is asking (Cloudflare says), for what's throttled.
  const from = request.headers.get('CF-Connecting-IP') ?? 'local'
  const text = (key: string, most: number) => (typeof asked[key] === 'string' && (asked[key] as string).length <= most ? (asked[key] as string).trim() : null)
  // A key or salt as the page sends it: base64 of exactly so many bytes.
  const bytes = (key: string, length: number) => {
    try {
      const value = typeof asked[key] === 'string' ? fromBase64(asked[key] as string) : null
      return value && value.length === length ? value : null
    } catch {
      return null
    }
  }
  // Signed in: a session, and who it's for -- an email account's, or any
  // account's on the desktop app (link).
  const signedIn = async (account: Account, refresh?: string) => ({
    ...(await signSession(env, account.id, account.kind as Who['kind'])),
    refresh: refresh ?? await newRefresh(db, account.id),
    account: shown(account),
  })

  switch (what) {
    // The salt to stretch a password with, for an address or a username.
    case 'salt': {
      const login = text('login', 320)
      if (!login) return answer(400, { error: 'body' })
      const form = formOf(login)
      const found = await loginBy(db, login)
      const salt = form === 'email' ? found?.email_salt : found?.name_salt
      return answer(200, { salt: salt ?? await saltFor(env, form, login), rounds: found?.rounds ?? ROUNDS })
    }

    // A new account: its address, its username, and a key for each way of
    // signing in. Kept unconfirmed until the code mailed to the address comes back.
    case 'signup': {
      const email = text('email', 320)
      const username = text('username', 40)
      const keys = { email: bytes('email_key', KEY_BYTES), name: bytes('name_key', KEY_BYTES) }
      const salts = { email: bytes('email_salt', SALT_BYTES), name: bytes('name_salt', SALT_BYTES) }
      if (!email || !EMAIL.test(email) || !username || !USERNAME.test(username) || !keys.email || !keys.name || !salts.email || !salts.name) return answer(400, { error: 'body' })
      if (!(await allowedNow(db, `signup:${from}`, SIGNUPS_AN_HOUR))) return answer(429, { error: 'wait' })
      await dropUnconfirmed(db, email, username)
      // An address is one account's: here (an email account's, a Google
      // account's), or an existing account's in Supabase. A Google account
      // only once it's finished (a username chosen): one left at its
      // username screen holds nothing, and goes as this address is confirmed.
      if (await db.prepare('select 1 from logins where email = ? collate nocase').bind(email).first()) return answer(409, { error: 'email' })
      if (await db.prepare("select 1 from accounts where email = ? collate nocase and kind = 'google' and username is not null").bind(email).first()) return answer(409, { error: 'google' })
      const existing = await existingAccountFor(env, email)
      if (existing === undefined) return answer(503, { error: 'check' })
      if (existing) return answer(409, { error: 'email' })
      if (await db.prepare('select 1 from accounts where username = ? collate nocase').bind(username).first()) return answer(409, { error: 'username' })
      const elsewhere = await takenInSupabase(env, username, null)
      if (elsewhere === null) return answer(503, { error: 'check' })
      if (elsewhere) return answer(409, { error: 'username' })
      const id = crypto.randomUUID()
      const seal = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
      const now = Date.now()
      await db.batch([
        db.prepare(`insert into accounts (id, kind, username, email, created_at) values (?, 'email', ?, ?, ?)`).bind(id, username, email, now),
        db.prepare(`insert into logins (account, email, seal, rounds, email_salt, email_verifier, name_salt, name_verifier, failures, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .bind(id, email, toBase64(seal), ROUNDS, toBase64(salts.email), await verifierOf(seal, keys.email), toBase64(salts.name), await verifierOf(seal, keys.name), now, now),
      ])
      await mailCode(env, db, id, email, 'confirm', asked.language)
      return answer(200, { ok: true })
    }

    // The code mailed to a new account's address: confirmed, and signed in.
    case 'confirm': {
      const email = text('email', 320), code = text('code', 12)
      if (!email || !code) return answer(400, { error: 'body' })
      const found = await loginBy(db, email)
      if (!found || found.confirmed_at) return answer(400, { error: 'code' })
      const checked = await useCode(db, found.account, 'confirm', code)
      if (checked !== 'ok') return answer(checked === 'tries' ? 429 : 400, { error: 'code' })
      await db.prepare('update logins set confirmed_at = ?, updated_at = ? where account = ?').bind(Date.now(), Date.now(), found.account).run()
      // Its address this account's now: a Google account left unfinished
      // with it (no username) is let go -- one address, one account.
      const { results: unfinished } = await db.prepare("select id from accounts where email = ? collate nocase and kind = 'google' and username is null").bind(found.email).all<{ id: string }>()
      for (const { id } of unfinished) await forgetAccount(db, id, true)
      const account = await accountOf(db, found.account)
      if (!account) return answer(400, { error: 'code' })
      await welcome(env, found.email, account.display_name || account.username || '', asked.language)
      return answer(200, await signedIn(account))
    }

    // Another code, for an address not confirmed yet -- or for a forgotten
    // password (`purpose` reset). The same answer whether or not there's
    // anything to send, and at most one a minute.
    case 'code': {
      const email = text('email', 320)
      const purpose = asked.purpose === 'reset' ? 'reset' : 'confirm'
      if (!email) return answer(400, { error: 'body' })
      if (!(await allowedNow(db, `code:${from}`, CODES_AN_HOUR))) return answer(429, { error: 'wait' })
      const found = await loginBy(db, email)
      const account = found ? await accountOf(db, found.account) : null
      // A reset only for an email account's password; an existing account's
      // is Supabase's until the cutover (its own mail, from there).
      const fits = found && account && (purpose === 'confirm' ? !found.confirmed_at : found.confirmed_at && account.kind === 'email')
      if (fits && !(await isBanned(env, found.account))) await mailCode(env, db, found.account, found.email, purpose, asked.language)
      return answer(200, { ok: true })
    }

    // A forgotten password: the code mailed, and the new key for signing in
    // with the address. Its page knows the address alone, so the username's
    // key is gone till the page sets it, as it does next (with `password`,
    // and the username this gives). Every other sign-in of the account's ends.
    case 'reset': {
      const email = text('email', 320), code = text('code', 12)
      const keys = { email: bytes('email_key', KEY_BYTES), name: bytes('name_key', KEY_BYTES) }
      if (!email || !code || !keys.email) return answer(400, { error: 'body' })
      const found = await loginBy(db, email)
      const account = found ? await accountOf(db, found.account) : null
      if (!found || !account || account.kind !== 'email') return answer(400, { error: 'code' })
      const checked = await useCode(db, found.account, 'reset', code)
      if (checked !== 'ok') return answer(checked === 'tries' ? 429 : 400, { error: 'code' })
      await setKeys(db, found, keys)
      await db.prepare('delete from refresh_tokens where account = ?').bind(found.account).run()
      return answer(200, await signedIn(account))
    }

    // Signing in: an address or a username, and the key for it. An email
    // account gets its session; an existing account is only told it's right
    // (Supabase signs it in, until the cutover).
    case 'signin': {
      const login = text('login', 320)
      const key = bytes('key', KEY_BYTES)
      if (!login || !key) return answer(400, { error: 'body' })
      const found = await loginBy(db, login)
      if (!found) return answer(401, { error: 'login' })
      if (found.locked_until && Date.now() < found.locked_until) return answer(429, { error: 'wait', until: found.locked_until })
      const verifier = formOf(login) === 'email' ? found.email_verifier : found.name_verifier
      if (!verifier || !same(verifier, await verifierOf(fromBase64(found.seal), key))) {
        const failures = found.failures + 1
        const wait = failures < FREE_TRIES ? null : Date.now() + Math.min(LONGEST_WAIT_MS, 60_000 * 2 ** (failures - FREE_TRIES))
        await db.prepare('update logins set failures = ?, locked_until = ? where account = ?').bind(failures, wait, found.account).run()
        return answer(401, { error: 'login' })
      }
      if (found.failures) await db.prepare('update logins set failures = 0, locked_until = null where account = ?').bind(found.account).run()
      // Said only to whoever has the password: not confirmed, banned.
      if (!found.confirmed_at) return answer(403, { error: 'unconfirmed', email: found.email })
      if (await isBanned(env, found.account)) return answer(403, { error: 'banned' })
      const account = await accountOf(db, found.account)
      if (!account) return answer(401, { error: 'login' })
      if (account.kind !== 'email') return answer(200, { verified: true, account: shown(account) })
      return answer(200, await signedIn(account))
    }

    // Staying signed in: a new session for the renewal token, which runs on.
    case 'renew': {
      const refresh = text('refresh', 100)
      if (!refresh) return answer(400, { error: 'body' })
      const hash = await digest(refresh)
      const held = await db.prepare('select account, expires_at from refresh_tokens where hash = ?').bind(hash).first<{ account: string; expires_at: number }>()
      if (!held || Date.now() > held.expires_at) return answer(401, { error: 'renew' })
      if (await isBanned(env, held.account)) return answer(403, { error: 'banned' })
      // An email account's, or one the desktop app was given (link).
      const account = await accountOf(db, held.account)
      if (!account) return answer(401, { error: 'renew' })
      await db.prepare('update refresh_tokens set used_at = ?, expires_at = ? where hash = ?').bind(Date.now(), Date.now() + STAY_MS, hash).run()
      return answer(200, await signedIn(account, refresh))
    }

    // The desktop app signed in by the site (docs/DECENTRALIZING.md, step 8).
    // Google's and Supabase's sign-ins can't be shown in its own window, so it
    // asks for a link -- a code it shows, a secret it keeps -- and opens the
    // site, where whoever's signed in there approves that code (link-approve).
    // The app then takes a renewal token of its own, for any kind of account,
    // and the Google grant the site holds for it, if any, for Drive
    // (link-take). Asking someone to approve a code of one's own is how this
    // is phished: the site says to approve only the code one's own app shows.
    case 'link': {
      if (!(await allowedNow(db, `link:${from}`, LINKS_AN_HOUR, HOUR_MS))) return answer(429, { error: 'wait' })
      const device = secret()
      const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => LINK_LETTERS[byte % LINK_LETTERS.length]).join('')
      await db.batch([
        db.prepare('delete from desktop_links where created_at < ?').bind(Date.now() - LINK_MS),
        db.prepare('insert into desktop_links (device, code, created_at) values (?, ?, ?)').bind(await digest(device), code, Date.now()),
      ])
      return answer(200, { device, code, until: Date.now() + LINK_MS })
    }
    case 'link-approve': {
      const who = await whoIs(text('token', 4000), env)
      if (!who) return answer(401, { error: 'sign-in' })
      if (!(await allowedNow(db, `link-try:${who.id}`, LINK_TRIES_AN_HOUR, HOUR_MS))) return answer(429, { error: 'wait' })
      const code = (text('code', 20) ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      const grant = text('grant', 4000)
      // An existing account the worker hasn't met yet: met now, with the
      // site's Supabase sign-in -- the app's own session can't take its profile in.
      if (who.kind === 'supabase') await meetExisting(env, db, who, text('token', 4000)!)
      const approved = await db.prepare('update desktop_links set account = ?, google_grant = ? where code = ? and account is null and created_at > ?')
        .bind(who.id, grant, code, Date.now() - LINK_MS).run()
      return approved.meta.changes ? answer(200, { ok: true }) : answer(404, { error: 'code' })
    }
    case 'link-take': {
      const device = text('device', 100)
      if (!device) return answer(400, { error: 'body' })
      const hash = await digest(device)
      const link = await db.prepare('select account, google_grant, created_at from desktop_links where device = ?').bind(hash)
        .first<{ account: string | null; google_grant: string | null; created_at: number }>()
      if (!link || Date.now() - link.created_at > LINK_MS) return answer(410, { error: 'gone' })
      if (!link.account) return answer(202, { waiting: true })
      // Taken once.
      await db.prepare('delete from desktop_links where device = ?').bind(hash).run()
      if (await isBanned(env, link.account)) return answer(403, { error: 'banned' })
      const account = await accountOf(db, link.account)
      if (!account) return answer(410, { error: 'gone' })
      return answer(200, { ...(await signedIn(account)), ...(link.google_grant ? { grant: link.google_grant } : {}) })
    }

    // Signed out here: the renewal token no use from now on.
    case 'signout': {
      const refresh = text('refresh', 100)
      if (refresh) await db.prepare('delete from refresh_tokens where hash = ?').bind(await digest(refresh)).run()
      return answer(200, { ok: true })
    }

    // A new password, with the one it replaces: every other sign-in ends,
    // this one goes on (a new renewal token).
    case 'password': {
      const who = await whoIs(text('token', 2000), env)
      const old = bytes('key', KEY_BYTES)
      const keys = { email: bytes('email_key', KEY_BYTES), name: bytes('name_key', KEY_BYTES) }
      if (!who || who.kind !== 'email') return answer(401, { error: 'sign-in' })
      if (!old || !keys.email || !keys.name) return answer(400, { error: 'body' })
      const found = await db.prepare('select * from logins where account = ?').bind(who.id).first<Login>()
      if (!found || !same(found.email_verifier, await verifierOf(fromBase64(found.seal), old))) return answer(403, { error: 'password' })
      await setKeys(db, found, keys)
      await db.prepare('delete from refresh_tokens where account = ?').bind(who.id).run()
      const account = await accountOf(db, who.id)
      return account ? answer(200, await signedIn(account)) : answer(401, { error: 'sign-in' })
    }

    // An existing account's credential, copied here as it signs in to
    // Supabase -- with a password, minutes ago, as Supabase's own token says
    // -- or as its password changes there. Its keys made with the salts this
    // gave for its address and username.
    case 'adopt': {
      const token = text('token', 4000)
      const who = await whoIs(token, env)
      const keys = { email: bytes('email_key', KEY_BYTES), name: bytes('name_key', KEY_BYTES) }
      const salts = { email: bytes('email_salt', SALT_BYTES), name: bytes('name_salt', SALT_BYTES) }
      if (!who || who.kind !== 'supabase' || !who.email) return answer(401, { error: 'sign-in' })
      if (!keys.email || !keys.name || !salts.email || !salts.name) return answer(400, { error: 'body' })
      if (!passwordJustNow(token!)) return answer(403, { error: 'recent' })
      // Its address another login's here: an email account's, confirmed, is
      // that account's -- Supabase knows nothing of it, and isn't asked to
      // decide. Anything else holding it (one never confirmed, another
      // existing account's from before an address changed) gives it up.
      const other = await db.prepare(`select l.account, l.confirmed_at, a.kind from logins l left join accounts a on a.id = l.account
        where l.email = ? collate nocase and l.account <> ?`).bind(who.email, who.id).first<{ account: string; confirmed_at: number | null; kind: string | null }>()
      if (other?.confirmed_at && other.kind === 'email') return answer(409, { error: 'email' })
      if (other) await forgetLogin(db, other.account)
      const now = Date.now()
      const seal = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
      // Its keys were stretched with the rounds its salts came with: its own, if it has a login here.
      const rounds = (await db.prepare('select rounds from logins where account = ?').bind(who.id).first<{ rounds: number }>())?.rounds ?? ROUNDS
      await db.batch([
        db.prepare('insert into accounts (id, kind, created_at) values (?, ?, ?) on conflict (id) do nothing').bind(who.id, 'supabase', now),
        db.prepare(`insert into logins (account, email, seal, rounds, email_salt, email_verifier, name_salt, name_verifier, confirmed_at, failures, created_at, updated_at)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
          on conflict (account) do update set email = excluded.email, seal = excluded.seal, rounds = excluded.rounds,
            email_salt = excluded.email_salt, email_verifier = excluded.email_verifier, name_salt = excluded.name_salt,
            name_verifier = excluded.name_verifier, confirmed_at = excluded.confirmed_at, failures = 0, locked_until = null, updated_at = excluded.updated_at`)
          .bind(who.id, who.email, toBase64(seal), rounds, toBase64(salts.email), await verifierOf(seal, keys.email), toBase64(salts.name), await verifierOf(seal, keys.name), now, now, now),
      ])
      // Its username, as its profile has it, for signing in with: the
      // directory's row may never have been given one.
      const username = await supabaseUsername(env, who, token!)
      if (username) await db.prepare(`update accounts set username = ? where id = ? and username is null
        and not exists (select 1 from accounts where username = ? collate nocase and id <> ?)`).bind(username, who.id, username, who.id).run()
      return answer(200, { ok: true })
    }

    // An existing account deleted (Supabase's delete-account): its
    // credential here goes with it, before the session that asks does.
    case 'forget': {
      const who = await whoIs(text('token', 4000), env)
      if (!who || who.kind !== 'supabase') return answer(401, { error: 'sign-in' })
      await forgetLogin(db, who.id)
      return answer(200, { ok: true })
    }

    // An email account deleted, on its own say-so: its session, and its
    // password once more -- so a session left open somewhere can't. Its
    // directory entry, its files in the Atrium's cloud, its sign-ins: gone.
    // A goodbye, to the address it had.
    case 'delete': {
      const who = await whoIs(text('token', 2000), env)
      const key = bytes('key', KEY_BYTES)
      if (!who || who.kind !== 'email') return answer(401, { error: 'sign-in' })
      if (!key) return answer(400, { error: 'body' })
      const found = await db.prepare('select * from logins where account = ?').bind(who.id).first<Login>()
      if (!found || !same(found.email_verifier, await verifierOf(fromBase64(found.seal), key))) return answer(403, { error: 'password' })
      const account = await accountOf(db, who.id)
      await dropOwnFiles(env, who.id)
      await forgetLogin(db, who.id)
      await forgetAccount(db, who.id)
      if (account) await goodbyeTo(env, found.email, account, asked.language)
      return answer(200, { deleted: true })
    }
  }
  return answer(404, { error: 'what' })
}

// ---------------------------------------------------------------- pieces

const shown = (account: Account) => ({ id: account.id, kind: account.kind, email: account.email, username: account.username, name: account.display_name || account.username })

const loginBy = async (db: D1Database, login: string) => (formOf(login) === 'email'
  ? db.prepare('select * from logins where email = ? collate nocase').bind(login.trim()).first<Login>()
  : db.prepare('select l.* from logins l join accounts a on a.id = l.account where a.username = ? collate nocase').bind(login.trim()).first<Login>())

const accountOf = async (db: D1Database, id: string) =>
  db.prepare('select a.id, a.kind, a.username, a.display_name, coalesce(a.email, l.email) as email from accounts a left join logins l on l.account = a.id where a.id = ?').bind(id).first<Account>()

/** The salt a login has if it's new: its name under the worker's key. */
async function saltFor(env: Env, form: Form, login: string): Promise<string> {
  const key = await keyFrom(env.GOOGLE_CLIENT_SECRET!, 'atrium login salt', 'HMAC', ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${form}:${lower(login)}`)))
  return toBase64(mac.subarray(0, SALT_BYTES))
}

const digest = async (text: string | Uint8Array) =>
  toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof text === 'string' ? new TextEncoder().encode(text) : text)))
const verifierOf = (seal: Uint8Array, key: Uint8Array) => digest(new Uint8Array([...seal, ...key]))

/** Two verifiers compared without a shortcut: as long whatever's alike. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let differ = 0
  for (let i = 0; i < a.length; i++) differ |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return differ === 0
}

/** New keys for an account's password: a new seal, and each way of signing
 *  in -- the username's none, if none is given (a reset's). */
async function setKeys(db: D1Database, found: Login, keys: { email: Uint8Array | null; name: Uint8Array | null }): Promise<void> {
  const seal = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  await db.prepare('update logins set seal = ?, email_verifier = ?, name_verifier = ?, failures = 0, locked_until = null, updated_at = ? where account = ?')
    .bind(toBase64(seal), await verifierOf(seal, keys.email!), keys.name ? await verifierOf(seal, keys.name) : null, Date.now(), found.account).run()
}

// 32 random bytes, base64url: a renewal token, a desktop link's secret.
const secret = () => toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function newRefresh(db: D1Database, account: string): Promise<string> {
  const refresh = secret()
  const now = Date.now()
  await db.prepare('insert into refresh_tokens (hash, account, created_at, used_at, expires_at) values (?, ?, ?, ?, ?)').bind(await digest(refresh), account, now, now, now + STAY_MS).run()
  return refresh
}

/** Six digits, every one as likely. */
function sixDigits(): string {
  const cut = 0xffffffff - (0xffffffff % 1_000_000)
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1))
    if (n < cut) return String(n % 1_000_000).padStart(6, '0')
  }
}

/** A code mailed for an account's address -- unless one went less than a minute ago. */
async function mailCode(env: Env, db: D1Database, account: string, email: string, purpose: 'confirm' | 'reset', language: unknown): Promise<void> {
  const held = await db.prepare('select sent_at from auth_codes where account = ? and purpose = ?').bind(account, purpose).first<{ sent_at: number }>()
  if (held && Date.now() - held.sent_at < CODE_EVERY_MS) return
  if (!(await allowedNow(db, `codes:${account}`, CODES_A_DAY, DAY_MS))) return
  const code = sixDigits()
  await db.prepare(`insert into auth_codes (account, purpose, hash, sent_at, expires_at, tries) values (?, ?, ?, ?, ?, 0)
    on conflict (account, purpose) do update set hash = excluded.hash, sent_at = excluded.sent_at, expires_at = excluded.expires_at, tries = 0`)
    .bind(account, purpose, await digest(`${account}:${purpose}:${code}`), Date.now(), Date.now() + CODE_MS).run()
  await authCode(env, email, purpose, code, language)
}

/** A code given back: right (and used up), wrong, or tried too often. */
async function useCode(db: D1Database, account: string, purpose: 'confirm' | 'reset', code: string): Promise<'ok' | 'wrong' | 'tries'> {
  const held = await db.prepare('select hash, expires_at, tries from auth_codes where account = ? and purpose = ?').bind(account, purpose).first<{ hash: string; expires_at: number; tries: number }>()
  if (!held || Date.now() > held.expires_at) return 'wrong'
  if (held.tries >= CODE_TRIES) return 'tries'
  if (!same(held.hash, await digest(`${account}:${purpose}:${code.replace(/\s/g, '')}`))) {
    await db.prepare('update auth_codes set tries = tries + 1 where account = ? and purpose = ?').bind(account, purpose).run()
    return 'wrong'
  }
  await db.prepare('delete from auth_codes where account = ? and purpose = ?').bind(account, purpose).run()
  return 'ok'
}

/** Accounts never confirmed that stand in a sign-up's way, let go: any
 *  holding its address -- whoever confirms the code mailed to it is its owner,
 *  so a sign-up left unconfirmed can't keep the address from them -- and any
 *  a day old holding its username. */
async function dropUnconfirmed(db: D1Database, email: string, username: string): Promise<void> {
  const { results } = await db.prepare(`select l.account from logins l join accounts a on a.id = l.account
    where l.confirmed_at is null and (l.email = ? collate nocase or (a.username = ? collate nocase and l.created_at < ?))`)
    .bind(email, username, Date.now() - UNCONFIRMED_MS).all<{ account: string }>()
  for (const { account } of results) {
    await forgetLogin(db, account)
    await forgetAccount(db, account)
  }
}

async function forgetLogin(db: D1Database, account: string): Promise<void> {
  await db.batch([
    db.prepare('delete from logins where account = ?').bind(account),
    db.prepare('delete from refresh_tokens where account = ?').bind(account),
    db.prepare('delete from auth_codes where account = ?').bind(account),
  ])
}

/** An existing account's id for an address, by Supabase (add_account_for_email.sql):
 *  null for none, undefined where it couldn't say. */
async function existingAccountFor(env: Env, email: string): Promise<string | null | undefined> {
  if (!env.SUPABASE_WORKER_KEY) return undefined
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/account_for_email`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_email: email, p_key: env.SUPABASE_WORKER_KEY }),
    })
    if (!response.ok) return undefined
    const account = await response.json()
    return typeof account === 'string' ? account : null
  } catch {
    return undefined
  }
}

/** Whether a Supabase token comes from a password sign-in (or a reset's
 *  link) of the last minutes, as its own claims say. Asked only of a token
 *  Supabase has just accepted (whoIs). */
function passwordJustNow(token: string): boolean {
  try {
    const claims = JSON.parse(new TextDecoder().decode(fromUrl(token.split('.')[1] ?? ''))) as { amr?: { method?: unknown; timestamp?: unknown }[] }
    return (claims.amr ?? []).some(entry => (entry.method === 'password' || entry.method === 'recovery') && typeof entry.timestamp === 'number' && Date.now() - entry.timestamp * 1000 < ADOPT_WITHIN_MS)
  } catch {
    return false
  }
}

const goodbyeTo = (env: Env, email: string, account: Account, language: unknown) =>
  goodbye(env, email, account.display_name || account.username || '', language)


