// The directory: who's who among the Atrium's people, for atriums kept in
// Google Drive -- someone found by username, their key and their folder, and
// the invitations they're sent. One place for both kinds of account
// (src/who.ts), so each can add the other. Usernames are unique across both:
// a Google account can't take an existing account's (Supabase is asked).
//
// Cloudflare D1, free: 5 GB, 5 million rows read and 100,000 written a day.
// Nothing an atrium holds is here -- only who's who, and which atrium (its
// roster file in Drive) someone's been invited to. And a Google account's own
// settings (its colour, its themes): private, as its email is -- an existing
// account keeps them in its Supabase profile.

import { welcome } from './mail'
import { dropMirror } from './mirror'
import { fromBase64, replies, whoIs, type Env, type Who } from './who'

const TABLES = [
  `create table if not exists accounts (
    id text primary key, kind text not null, username text unique collate nocase, display_name text,
    drive_key text, drive_root text, email text, created_at integer not null, settings text, name_changed_at integer)`,
  `create table if not exists invites (
    id text primary key, to_user text not null, from_user text not null, roster text not null, lobby_id text not null,
    name text not null, secret text, created_at integer not null, unique (to_user, roster))`,
  // Which existing account a Google account is the same person as: seen
  // when the existing account connected its Google Drive.
  'create table if not exists links (google_id text primary key, account text not null, created_at integer not null)',
  // Each Google account's grant (its refresh token, sealed -- src/google.ts):
  // so it consents once, not at each sign-in on each browser.
  'create table if not exists google_grants (google_id text primary key, sealed text not null, updated_at integer not null)',
  // Accounts banned by the platform's operator: refused everything the
  // worker runs (who.ts, whoIs; google.ts, signing in and renewing). Its
  // username and kind as they were, for the operator's list.
  'create table if not exists bans (account text primary key, username text, kind text not null, reason text, by_account text not null, at integer not null)',
  // A Google account's Pinterest connection (src/pinterest.ts): its tokens, sealed.
  'create table if not exists pinterest (account text primary key, sealed text not null, username text, updated_at integer not null)',
  // Drive atriums made public by their owners (phase 8): where to find each
  // -- its roster in Drive, which says whether it's public and holds its
  // keys if so -- its name, and its picture. Listed in everyone's atrium
  // browser. A listing only points: an atrium whose roster isn't public
  // opens for no one, whatever's listed.
  `create table if not exists public_atriums (
    lobby_id text primary key, roster text not null, name text not null, owner text not null,
    preview blob, preview_at integer, listed_at integer not null, updated_at integer not null)`,
  'create index if not exists public_atriums_owner on public_atriums (owner)',
  // The hosted store (src/store.ts): its files and folders, who else may
  // write which, and each account's own app data.
  `create table if not exists store_files (
    id text primary key, parent text, name text not null, owner text not null, folder integer not null,
    version integer not null, size integer not null, created_at integer not null, updated_at integer not null)`,
  'create index if not exists store_files_parent on store_files (parent)',
  'create index if not exists store_files_owner on store_files (owner)',
  'create table if not exists store_shares (file text not null, account text not null, primary key (file, account))',
  'create table if not exists store_appdata (account text not null, name text not null, bytes text not null, updated_at integer not null, primary key (account, name))',
  // Public Drive atriums' mirrors (src/mirror.ts): their files by Drive id.
  `create table if not exists mirror_files (
    lobby text not null, id text not null, parent text, name text not null, folder integer not null,
    version text not null, size integer not null, updated_at integer not null, primary key (lobby, id))`,
  'create index if not exists mirror_files_parent on mirror_files (lobby, parent)',
  // Email accounts (src/auth.ts): each one's sign-in -- its address, and for
  // each way of signing in (address, username) the salt its page stretches
  // the password with and the verifier of what that makes -- its renewal
  // tokens (by their hash), and the codes mailed to it (by theirs).
  `create table if not exists logins (
    account text primary key, email text not null unique collate nocase, seal text not null, rounds integer not null,
    email_salt text not null, email_verifier text not null, name_salt text, name_verifier text,
    confirmed_at integer, failures integer not null default 0, locked_until integer, created_at integer not null, updated_at integer not null)`,
  'create table if not exists refresh_tokens (hash text primary key, account text not null, created_at integer not null, used_at integer not null, expires_at integer not null)',
  'create index if not exists refresh_tokens_account on refresh_tokens (account)',
  `create table if not exists auth_codes (account text not null, purpose text not null, hash text not null, sent_at integer not null,
    expires_at integer not null, tries integer not null default 0, primary key (account, purpose))`,
  // How often something that mails, or that anyone may ask, has been asked of
  // late, by whom (src/auth.ts, throttled).
  'create table if not exists throttle (key text primary key, count integer not null, since integer not null)',
  'create index if not exists links_account on links (account)',
  'create index if not exists invites_to on invites (to_user)',
  'create index if not exists invites_from on invites (from_user)',
]
// Columns added since the tables were first made: added where they're missing.
const ADDED = ['alter table accounts add column settings text', 'alter table accounts add column name_changed_at integer',
  // One's folder for atriums in the hosted store (phase 10), as drive_root is in Drive.
  'alter table accounts add column hosted_root text',
  // An invitation that joins by itself (phase 10): one's cloud atrium moved,
  // its people with it -- vouched for by Supabase (cloudMember).
  'alter table invites add column auto integer']
// Made once per instance of the worker, the first time it's needed.
let made: Promise<unknown> | null = null
export const tablesIn = (db: D1Database) => (made ??= (async () => {
  await db.batch(TABLES.map(sql => db.prepare(sql)))
  for (const sql of ADDED) await db.prepare(sql).run().catch(error => { if (!/duplicate column/i.test(String(error))) throw error })
})().catch(error => { made = null; throw error }))

// A Google account's own settings, each as it may be (null: no longer kept).
const SETTINGS: Record<string, (value: unknown) => boolean> = {
  player_color: value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value),
  custom_themes: value => Array.isArray(value) && value.length <= 12 && JSON.stringify(value).length <= 32_000,
}
// A display name changes once in this long, as an existing account's does on the web.
const NAME_EVERY_MS = 15 * 24 * 60 * 60 * 1000

export const USERNAME = /^[a-zA-Z0-9_]{3,20}$/
const MOST_IDS = 200
// Public atriums: how many one account lists, how many the list gives, and
// how big a picture may be (a card's, WebP).
const MOST_PUBLIC_EACH = 50
const MOST_PUBLIC_LISTED = 500
const MOST_PREVIEW_BYTES = 300 * 1024
const DRIVE_ID = /^[\w-]{10,128}$/

/** A Google account's grant, kept (sealed), replaced, or forgotten (its
 *  access taken back). */
export async function keepGoogleGrant(env: Env, googleId: string, sealed: string): Promise<void> {
  if (!env.PEOPLE) return
  await tablesIn(env.PEOPLE)
  await env.PEOPLE.prepare('insert into google_grants (google_id, sealed, updated_at) values (?, ?, ?) on conflict (google_id) do update set sealed = excluded.sealed, updated_at = excluded.updated_at')
    .bind(googleId, sealed, Date.now()).run()
}
export async function googleGrantFor(env: Env, googleId: string): Promise<string | null> {
  if (!env.PEOPLE) return null
  await tablesIn(env.PEOPLE)
  return (await env.PEOPLE.prepare('select sealed from google_grants where google_id = ?').bind(googleId).first<{ sealed: string }>())?.sealed ?? null
}
export async function forgetGoogleGrant(env: Env, googleId: string): Promise<void> {
  if (!env.PEOPLE) return
  await env.PEOPLE.prepare('delete from google_grants where google_id = ?').bind(googleId).run()
}
/** The Google accounts an existing account is linked with, the latest first. */
export async function linkedGoogleIds(env: Env, account: string): Promise<string[]> {
  if (!env.PEOPLE) return []
  await tablesIn(env.PEOPLE)
  const { results } = await env.PEOPLE.prepare('select google_id from links where account = ? order by created_at desc').bind(account).all<{ google_id: string }>()
  return results.map(row => row.google_id)
}

/** An existing account's own Google account, as it connected Drive with it. */
export async function link(env: Env, googleId: string, account: string): Promise<void> {
  if (!env.PEOPLE) return
  await tablesIn(env.PEOPLE)
  await env.PEOPLE.prepare('insert into links (google_id, account, created_at) values (?, ?, ?) on conflict (google_id) do update set account = excluded.account')
    .bind(googleId, account, Date.now()).run()
}

/** The existing account a Google sign-in is -- the same person by Google's
 *  own word, and only so: it signed up with this Google (Supabase's
 *  identities, by Google's id for the person -- add_account_for_google.sql),
 *  or it has the address Google verified as this person's (made with email
 *  and a password, say -- add_account_for_email.sql); Supabase signs this
 *  Google in to it either way. A Google under another address is another
 *  account (the user's rule, 2026-10-18) -- even one an existing account
 *  connected its Drive with: that link is the Drive's (resume), not who's
 *  who. Linked from then on, where Google's id is known. */
export async function linkedTo(env: Env, googleId: string | null, email: string | null): Promise<Existing | null> {
  if (!env.PEOPLE) return null
  await tablesIn(env.PEOPLE)
  // An email account's address, confirmed (src/auth.ts): that account -- its password signs in to it.
  const emailAccount = email ? await env.PEOPLE.prepare(`select l.account from logins l join accounts a on a.id = l.account
    where l.email = ? collate nocase and l.confirmed_at is not null and a.kind = 'email'`).bind(email).first<{ account: string }>() : null
  if (emailAccount) return { account: emailAccount.account, how: 'password', kind: 'email' }
  const signedUpWithGoogle = googleId ? await supabaseAnswer(env, 'account_for_google', { p_google_id: googleId }) : null
  const byAddress = email && env.SUPABASE_WORKER_KEY ? await supabaseAnswer(env, 'account_for_email', { p_email: email, p_key: env.SUPABASE_WORKER_KEY }) : null
  const account = signedUpWithGoogle ?? byAddress
  if (!account) return null
  // Written only when it's new: reads are far cheaper than writes here.
  const seen = googleId ? (await env.PEOPLE.prepare('select account from links where google_id = ?').bind(googleId).first<{ account: string }>())?.account : null
  if (googleId && seen !== account) await link(env, googleId, account)
  // How it signs in now: with this Google, through Supabase -- or with its
  // email and a password (and this Google too, once Supabase has linked it).
  return { account, how: account === signedUpWithGoogle ? 'google' : 'password' }
}
/** An existing account, and how its person signs in to it. */
export interface Existing { account: string; how: 'google' | 'password'; kind?: 'email' }

/** A Google account made for someone whose Google is an existing account's
 *  -- made before the worker asked, or by an existing account signing up
 *  with that Google since -- and never finished (no username): not kept. Its
 *  row and invitations go, and the existing account it is, is returned. A
 *  finished one stays as it is. */
export async function supersededBy(env: Env, id: string, googleId: string | null): Promise<Existing | null> {
  if (!env.PEOPLE) return null
  await tablesIn(env.PEOPLE)
  const row = await env.PEOPLE.prepare('select username, email from accounts where id = ?').bind(id).first<{ username: string | null; email: string | null }>()
  if (row?.username) return null
  // Its email as it signed in (Google-verified): known even where its grant
  // is from before grants said whose Google they are.
  const existing = await linkedTo(env, googleId, row?.email ?? null)
  if (!existing) return null
  await forgetAccount(env.PEOPLE, id, true)
  return existing
}

/** Whether an invitation may join by itself: its atrium is a Supabase cloud
 *  atrium the sender owns, and the one it's to was on its lists there -- an
 *  admin, whitelisted, or an editor. Asked of Supabase with the sender's own
 *  sign-in (its rules let an owner read their atrium's lists). Anything else
 *  -- a Google account's, an atrium already gone, an answer that didn't come
 *  -- is an ordinary invitation: joining is then the invited person's call. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
async function cloudMember(env: Env, token: string, from: string, lobby: string, to: string): Promise<boolean> {
  if (!UUID.test(lobby) || !UUID.test(to) || typeof token !== 'string') return false
  const rows = async <T>(path: string): Promise<T[]> => {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }).catch(() => null)
    return response?.ok ? response.json() as Promise<T[]> : []
  }
  const [atrium] = await rows<{ owner_user_id: string; admin_user_ids: string[] | null }>(`lobbies?id=eq.${lobby}&select=owner_user_id,admin_user_ids`)
  if (!atrium || atrium.owner_user_id !== from) return false
  if (atrium.admin_user_ids?.includes(to)) return true
  const lists = await rows<{ list_type: string }>(`lobby_access_lists?lobby_id=eq.${lobby}&user_id=eq.${to}&select=list_type`)
  return lists.some(row => row.list_type === 'whitelist' || row.list_type === 'editor')
}

/** A Google account, gone from the directory: its row, the invitations to
 *  and from it, its Pinterest -- or, `unfinished`, only while it has no
 *  username (one chosen meanwhile keeps it). */
export async function forgetAccount(db: D1Database, id: string, unfinished = false): Promise<void> {
  await tablesIn(db)
  await db.batch([
    db.prepare('delete from invites where to_user = ? or from_user = ?').bind(id, id),
    db.prepare('delete from pinterest where account = ?').bind(id),
    db.prepare(`delete from accounts where id = ?${unfinished ? ' and username is null' : ''}`).bind(id),
  ])
}

// Whether an account is banned, as the directory said a minute ago at most:
// every request asks, and most would otherwise read it. (Another instance of
// the worker sees a ban within the minute.)
const BAN_FRESH_MS = 60_000
const bansSeen = new Map<string, { banned: boolean; at: number }>()
export async function isBanned(env: Env, id: string): Promise<boolean> {
  if (!env.PEOPLE) return false
  const seen = bansSeen.get(id)
  if (seen && Date.now() - seen.at < BAN_FRESH_MS) return seen.banned
  await tablesIn(env.PEOPLE)
  const banned = !!(await env.PEOPLE.prepare('select 1 from bans where account = ?').bind(id).first())
  // ponytail: one map per instance, emptied whole past 10,000 -- an LRU if instances ever live long with many people.
  if (bansSeen.size > 10_000) bansSeen.clear()
  bansSeen.set(id, { banned, at: Date.now() })
  return banned
}

// The platform's operator (add_platform_admin.sql), as Supabase says --
// asked with their own sign-in.
async function isOperator(env: Env, who: Who, token: string): Promise<boolean> {
  if (who.kind !== 'supabase') return false
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/is_platform_admin`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    return response.ok && (await response.json()) === true
  } catch {
    return false
  }
}

/** Whether an account's row is here (a Google account deleted, or taken for
 *  a duplicate, has none). */
export const accountKept = async (db: D1Database, id: string) => {
  await tablesIn(db)
  return !!(await db.prepare('select 1 from accounts where id = ?').bind(id).first())
}

/** Whose address replies may go to: an existing account's, as Supabase has
 *  confirmed it; a Google account's, as Google verified it (kept here). */
export async function emailOf(env: Env, who: Who): Promise<string | null> {
  if (who.kind === 'supabase') return who.email ?? null
  if (!env.PEOPLE) return null
  await tablesIn(env.PEOPLE)
  return (await env.PEOPLE.prepare('select email from accounts where id = ?').bind(who.id).first<{ email: string | null }>())?.email ?? null
}

// An account id from one of Supabase's functions, or null -- also where it
// can't answer (the function not made yet): the account is then made as before.
async function supabaseAnswer(env: Env, fn: 'account_for_google' | 'account_for_email', args: Record<string, string>): Promise<string | null> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    const account = response.ok ? await response.json() : null
    return typeof account === 'string' ? account : null
  } catch {
    return null
  }
}

/** A Google account that has just signed in, known here from then on. */
export async function meet(env: Env, id: string, person: { email?: string; name?: string }): Promise<void> {
  if (!env.PEOPLE) return
  await tablesIn(env.PEOPLE)
  await env.PEOPLE.prepare(`insert into accounts (id, kind, email, display_name, created_at) values (?, 'google', ?, ?, ?)
    on conflict (id) do update set email = excluded.email`)
    .bind(id, person.email ?? null, (person.name ?? '').slice(0, 50) || null, Date.now()).run()
}

export async function people(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  const db = env.PEOPLE
  if (!db) return answer(503, { error: 'not set up' })
  let asked: Record<string, unknown>
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  // Whether a username is free, asked before there's an account to ask with
  // (a sign-up): here, or an existing account's. `mine`: whose own name it
  // may be. Usernames are shown to everyone anyway.
  if (what === 'available') {
    const username = typeof asked.username === 'string' ? asked.username.trim() : ''
    if (!USERNAME.test(username)) return answer(200, { available: false })
    await tablesIn(db)
    const here = await db.prepare('select id from accounts where username = ? collate nocase').bind(username).first<{ id: string }>()
    const mine = typeof asked.mine === 'string' ? asked.mine : null
    if (here && here.id !== mine) return answer(200, { available: false })
    const elsewhere = await takenInSupabase(env, username, mine)
    // Not answered: said so, never taken for free.
    if (elsewhere === null) return answer(503, { error: 'check' })
    return answer(200, { available: !elsewhere })
  }
  // The public atriums, for anyone -- a guest too: the newest first, but
  // those of banned accounts.
  if (what === 'atriums') {
    await tablesIn(db)
    const { results } = await db.prepare(`select p.lobby_id, p.roster, p.name, p.owner, coalesce(a.display_name, a.username) as owner_name,
      p.preview_at, p.updated_at from public_atriums p left join accounts a on a.id = p.owner
      where p.owner not in (select account from bans) order by p.updated_at desc limit ?`).bind(MOST_PUBLIC_LISTED).all()
    return answer(200, results)
  }
  const who = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!who) return answer(401, { error: 'sign-in' })
  await tablesIn(db)
  const text = (key: string, most: number) => (typeof asked[key] === 'string' && (asked[key] as string).length <= most ? asked[key] as string : null)

  switch (what) {
    // One's own row: made if need be, and changed as asked.
    case 'me': {
      // An existing account's row is made as it first publishes itself. A
      // Google account's is made as it signs in (google.ts, meet): gone --
      // deleted, or taken for a duplicate -- a session from before can't make
      // it again.
      if (who.kind === 'supabase') await db.prepare('insert into accounts (id, kind, created_at) values (?, ?, ?) on conflict (id) do nothing').bind(who.id, who.kind, Date.now()).run()
      else if (!await accountKept(db, who.id)) return answer(401, { error: 'gone' })
      const set = (asked.set ?? {}) as Record<string, unknown>
      const before = await db.prepare('select username, display_name, name_changed_at from accounts where id = ?').bind(who.id).first<{ username: string | null; display_name: string | null; name_changed_at: number | null }>()
      if ('username' in set) {
        const username = typeof set.username === 'string' ? set.username.trim() : ''
        if (!USERNAME.test(username)) return answer(400, { error: 'username' })
        // An existing account's is the one its Supabase profile has, no other.
        if (who.kind === 'supabase' && (await supabaseUsername(env, who, asked.token as string))?.toLowerCase() !== username.toLowerCase()) return answer(403, { error: 'not yours' })
        const here = await db.prepare('select id from accounts where username = ? collate nocase and id <> ?').bind(username, who.id).first()
        if (here) return answer(409, { error: 'taken' })
        if (who.kind !== 'supabase') {
          const elsewhere = await takenInSupabase(env, username, null)
          if (elsewhere === null) return answer(503, { error: 'check' })
          if (elsewhere) return answer(409, { error: 'taken' })
        }
        await db.prepare('update accounts set username = ? where id = ?').bind(username, who.id).run()
        // A Google account's first: finished, and welcomed, once -- in the
        // language its page shows (`language`).
        if (who.kind === 'google' && !before?.username) {
          const email = await emailOf(env, who)
          if (email) await welcome(env, email, typeof set.display_name === 'string' ? set.display_name : username, asked.language)
        }
      }
      if ('display_name' in set) {
        const name = typeof set.display_name === 'string' ? set.display_name.trim().slice(0, 50) : ''
        // A Google account's name, changed once it has one: once in so long
        // (an existing account's comes from its profile, which says).
        const changing = who.kind !== 'supabase' && !!before?.username && (name || null) !== before.display_name
        if (changing && before?.name_changed_at && Date.now() - before.name_changed_at < NAME_EVERY_MS) {
          return answer(429, { error: 'too soon', until: before.name_changed_at + NAME_EVERY_MS })
        }
        await db.prepare('update accounts set display_name = ?, name_changed_at = ? where id = ?')
          .bind(name || null, changing ? Date.now() : before?.name_changed_at ?? null, who.id).run()
      }
      if ('settings' in set) {
        const patch = set.settings as Record<string, unknown> | null
        if (who.kind === 'supabase') return answer(403, { error: 'settings' })
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return answer(400, { error: 'settings' })
        for (const [key, value] of Object.entries(patch)) if (!SETTINGS[key] || (value !== null && !SETTINGS[key](value))) return answer(400, { error: 'settings', key })
        // Merged as one statement: two settings saved at once both stay.
        await db.prepare("update accounts set settings = json_patch(coalesce(settings, '{}'), ?) where id = ?").bind(JSON.stringify(patch), who.id).run()
      }
      if ('hosted_root' in set) {
        const root = typeof set.hosted_root === 'string' && /^h\.[\w-]{20,40}$/.test(set.hosted_root) ? set.hosted_root : null
        await db.prepare('update accounts set hosted_root = ? where id = ?').bind(root, who.id).run()
      }
      if ('drive_key' in set || 'drive_root' in set) {
        const key = JSON.stringify(set.drive_key ?? null)
        const root = typeof set.drive_root === 'string' ? set.drive_root : null
        if (key.length > 1000 || (root && root.length > 128)) return answer(400, { error: 'drive' })
        await db.prepare('update accounts set drive_key = ?, drive_root = ? where id = ?').bind(key === 'null' ? null : key, root, who.id).run()
      }
      const row = await db.prepare('select id, kind, username, display_name, drive_key, drive_root, hosted_root, email, settings, name_changed_at from accounts where id = ?').bind(who.id).first()
      return answer(200, shown(row))
    }

    // Others, by username or by their ids: what's public of them -- never their email.
    case 'find': {
      const columns = 'select id, username, display_name, drive_key, drive_root, hosted_root from accounts'
      const username = text('username', 40)
      if (username !== null) {
        const row = await db.prepare(`${columns} where username = ? collate nocase`).bind(username.trim().replace(/^@/, '')).first()
        return answer(200, row ? [shown(row)] : [])
      }
      const ids = Array.isArray(asked.ids) ? (asked.ids as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, MOST_IDS) : []
      if (!ids.length) return answer(200, [])
      const { results } = await db.prepare(`${columns} where id in (${ids.map(() => '?').join(',')})`).bind(...ids).all()
      return answer(200, results.map(shown))
    }

    // An invitation from oneself: one per person and atrium, the latest -- and
    // replaced only by whoever sent it: anyone knowing a roster's id could
    // otherwise put their own secret (or none) over someone else's.
    case 'invite': {
      const to = text('to', 64), roster = text('roster', 128), lobby = text('lobby_id', 64), name = text('name', 200)
      const secret = asked.secret === null ? null : text('secret', 2000)
      if (!to || !roster || !lobby || !name || (asked.secret !== null && secret === null)) return answer(400, { error: 'body' })
      // Joining by itself, asked: granted only as cloudMember says.
      const auto = asked.auto === true && await cloudMember(env, asked.token as string, who.id, lobby, to) ? 1 : 0
      await db.prepare(`insert into invites (id, to_user, from_user, roster, lobby_id, name, secret, created_at, auto) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (to_user, roster) do update set lobby_id = excluded.lobby_id, name = excluded.name,
        secret = excluded.secret, created_at = excluded.created_at, auto = excluded.auto
        where invites.from_user = excluded.from_user`)
        .bind(crypto.randomUUID(), to, who.id, roster, lobby, name, secret, Date.now(), auto).run()
      return answer(200, { ok: true, auto: !!auto })
    }

    // One's invitations, the newest first, with who sent each.
    // The platform's operator's: bans. An account banned by its username --
    // a Google account's, or an existing account's (in the directory, or
    // else as Supabase knows it); its Supabase half is the operator's app's
    // to ask for (supabase/functions/ban-account). Unbanned; and the list.
    case 'ban':
    case 'unban':
    case 'bans': {
      if (!(await isOperator(env, who, asked.token as string))) return answer(403, { error: 'Not allowed' })
      if (what === 'bans') {
        const { results } = await db.prepare('select account, username, kind, reason, at from bans order by at desc').all()
        return answer(200, results)
      }
      if (what === 'unban') {
        const account = text('account', 64)
        if (!account) return answer(400, { error: 'body' })
        const row = await db.prepare('select kind from bans where account = ?').bind(account).first<{ kind: string }>()
        await db.prepare('delete from bans where account = ?').bind(account).run()
        bansSeen.delete(account)
        return answer(200, { account, kind: row?.kind ?? null })
      }
      const username = text('username', 40)?.trim().replace(/^@/, '')
      if (!username) return answer(400, { error: 'body' })
      let found = await db.prepare('select id, kind, username from accounts where username = ? collate nocase').bind(username).first<{ id: string; kind: string; username: string }>()
      if (!found) {
        const response = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id,username`, {
          headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${asked.token as string}` },
        }).catch(() => null)
        const rows = response?.ok ? await response.json() as { id: string; username: string }[] : []
        if (rows[0]) found = { id: rows[0].id, kind: 'supabase', username: rows[0].username }
      }
      if (!found) return answer(404, { error: 'No such account' })
      if (found.id === who.id) return answer(400, { error: 'Not oneself' })
      await db.prepare(`insert into bans (account, username, kind, reason, by_account, at) values (?, ?, ?, ?, ?, ?)
        on conflict (account) do update set reason = excluded.reason, by_account = excluded.by_account, at = excluded.at`)
        .bind(found.id, found.username, found.kind, text('reason', 500) || null, who.id, Date.now()).run()
      bansSeen.delete(found.id)
      return answer(200, { account: found.id, kind: found.kind, username: found.username })
    }

    case 'invites': {
      const { results } = await db.prepare(`select i.id, i.from_user, i.roster, i.lobby_id, i.name, i.secret, i.created_at, i.auto,
        coalesce(a.display_name, a.username) as from_name from invites i left join accounts a on a.id = i.from_user
        where i.to_user = ? order by i.created_at desc`).bind(who.id).all()
      return answer(200, results)
    }

    // One's Drive atrium listed as public, or its listing brought up to date
    // (its name, its picture): its owner's -- whoever listed it first. The
    // roster it names says whether it really is (lib/driveSync).
    case 'publish': {
      const lobby = text('lobby_id', 64), roster = text('roster', 128), name = text('name', 100)?.trim()
      if (!lobby || !roster || !DRIVE_ID.test(roster) || !name) return answer(400, { error: 'body' })
      let preview: Uint8Array | null = null
      if (typeof asked.preview === 'string') {
        try { preview = fromBase64(asked.preview) } catch { return answer(400, { error: 'preview' }) }
        const webp = preview.length >= 12 && String.fromCharCode(...preview.slice(0, 4)) === 'RIFF' && String.fromCharCode(...preview.slice(8, 12)) === 'WEBP'
        if (!webp || preview.length > MOST_PREVIEW_BYTES) return answer(400, { error: 'preview' })
      }
      const had = await db.prepare('select owner from public_atriums where lobby_id = ?').bind(lobby).first<{ owner: string }>()
      if (had && had.owner !== who.id) return answer(403, { error: 'not yours' })
      if (!had) {
        const listed = await db.prepare('select count(*) as n from public_atriums where owner = ?').bind(who.id).first<{ n: number }>()
        if ((listed?.n ?? 0) >= MOST_PUBLIC_EACH) return answer(429, { error: 'too many' })
      }
      const now = Date.now()
      await db.prepare(`insert into public_atriums (lobby_id, roster, name, owner, preview, preview_at, listed_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (lobby_id) do update set roster = excluded.roster, name = excluded.name, updated_at = excluded.updated_at,
        preview = coalesce(excluded.preview, public_atriums.preview), preview_at = coalesce(excluded.preview_at, public_atriums.preview_at)
        where public_atriums.owner = excluded.owner`)
        .bind(lobby, roster, name, who.id, preview, preview ? now : null, now, now).run()
      return answer(200, { ok: true })
    }
    // Off the list: by its owner, or the platform's operator.
    case 'unpublish': {
      const lobby = text('lobby_id', 64)
      if (!lobby) return answer(400, { error: 'body' })
      const done = await db.prepare('delete from public_atriums where lobby_id = ? and owner = ?').bind(lobby, who.id).run()
      const taken = done.meta.changes || (await isOperator(env, who, asked.token as string) && (await db.prepare('delete from public_atriums where lobby_id = ?').bind(lobby).run()).meta.changes)
      // Its mirror goes with its listing.
      if (taken) await dropMirror(env, lobby)
      return answer(200, { ok: true })
    }

    // One's invitation's secret gone, once let in properly: the invitation
    // kept, to open the atrium again from another browser.
    case 'clear': {
      const roster = text('roster', 128)
      if (!roster) return answer(400, { error: 'body' })
      await db.prepare('update invites set secret = null where to_user = ? and roster = ?').bind(who.id, roster).run()
      return answer(200, { ok: true })
    }

    // An invitation removed, by whom it's to or from: by its id, or by whom and which atrium.
    case 'uninvite': {
      const id = text('id', 64), to = text('to', 64), roster = text('roster', 128)
      if (id) await db.prepare('delete from invites where id = ? and (to_user = ? or from_user = ?)').bind(id, who.id, who.id).run()
      else if (to && roster) await db.prepare('delete from invites where to_user = ? and roster = ? and (to_user = ? or from_user = ?)').bind(to, roster, who.id, who.id).run()
      else return answer(400, { error: 'body' })
      return answer(200, { ok: true })
    }
  }
  return answer(404, { error: 'what' })
}

/** A public atrium's picture, for anyone's <img>: addressed with its time
 *  (`?v=`), so it's cached for good and a new one is a new address. */
export async function publicPreview(env: Env, lobbyId: string): Promise<Response> {
  if (!env.PEOPLE) return new Response('Not set up', { status: 503 })
  await tablesIn(env.PEOPLE)
  const row = await env.PEOPLE.prepare('select preview from public_atriums where lobby_id = ?').bind(lobbyId).first<{ preview: ArrayBuffer | number[] | null }>()
  if (!row?.preview) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(row.preview), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' },
  })
}

// A row as it's given: the Drive key as itself, not its text.
function shown(row: Record<string, unknown> | null) {
  if (!row) return null
  const json = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : null)
  return { ...row, drive_key: json(row.drive_key), ...('settings' in row ? { settings: json(row.settings) ?? {} } : {}) }
}

/** Whether an existing account has that username (Supabase says yes or no,
 *  add_username_taken.sql) -- `except` that account's own. Null when it
 *  couldn't be asked: the caller says so, and never gives the name. */
export async function takenInSupabase(env: Env, username: string, except: string | null): Promise<boolean | null> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/username_taken`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_username: username, ...(except && /^[0-9a-f-]{36}$/i.test(except) ? { p_except: except } : {}) }),
    })
    const answer = response.ok ? await response.json() : null
    return typeof answer === 'boolean' ? answer : null
  } catch {
    return null
  }
}

/** An existing account's username, as its own profile has it -- read with
 *  its own sign-in. */
export async function supabaseUsername(env: Env, who: Who, token: string): Promise<string | null> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(who.id)}&select=username`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    })
    const rows = response.ok ? await response.json() as { username?: unknown }[] : []
    return typeof rows[0]?.username === 'string' ? rows[0].username : null
  } catch {
    return null
  }
}
