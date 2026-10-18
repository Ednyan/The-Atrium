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

import { replies, whoIs, type Env, type Who } from './who'

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
  'create index if not exists links_account on links (account)',
  'create index if not exists invites_to on invites (to_user)',
  'create index if not exists invites_from on invites (from_user)',
]
// Columns added since the tables were first made: added where they're missing.
const ADDED = ['alter table accounts add column settings text', 'alter table accounts add column name_changed_at integer']
// Made once per instance of the worker, the first time it's needed.
let made: Promise<unknown> | null = null
const tablesIn = (db: D1Database) => (made ??= (async () => {
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

const USERNAME = /^[a-zA-Z0-9_]{3,20}$/
const MOST_IDS = 200

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

/** The existing account a Google account belongs to -- known whichever way
 *  that account was made: it connected Drive with this Google (linked here),
 *  it signed up with it (Supabase's identities, by Google's id for the
 *  person -- add_account_for_google.sql), or it has the address Google has
 *  verified as this person's (by email and password, say --
 *  add_account_for_email.sql). Linked from then on, where Google's id is
 *  known. */
export async function linkedTo(env: Env, googleId: string | null, email: string | null): Promise<Existing | null> {
  if (!env.PEOPLE) return null
  await tablesIn(env.PEOPLE)
  const signedUpWithGoogle = googleId ? await supabaseAnswer(env, 'account_for_google', { p_google_id: googleId }) : null
  const seen = googleId
    ? (await env.PEOPLE.prepare('select account from links where google_id = ?').bind(googleId).first<{ account: string }>())?.account ?? null
    : null
  const byAddress = email && env.SUPABASE_WORKER_KEY ? await supabaseAnswer(env, 'account_for_email', { p_email: email, p_key: env.SUPABASE_WORKER_KEY }) : null
  const account = seen ?? signedUpWithGoogle ?? byAddress
  if (!account) return null
  if (googleId && !seen) await link(env, googleId, account)
  return {
    account,
    // How it signs in now: with this Google, through Supabase -- or with
    // its email and a password.
    how: account === signedUpWithGoogle ? 'google' : 'password',
    // Whether Supabase itself will take this Google for that account: it
    // has this Google already, or this address Google verified (Supabase
    // links an identity with the same confirmed address by itself). Not so
    // for an account known only by its Drive, under another address.
    joinable: account === signedUpWithGoogle || account === byAddress,
  }
}
/** An existing account, how its person signs in to it, and whether
 *  Supabase will sign this Google in to it. */
export interface Existing { account: string; how: 'google' | 'password'; joinable: boolean }

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
  await env.PEOPLE.batch([
    env.PEOPLE.prepare('delete from invites where to_user = ?').bind(id),
    env.PEOPLE.prepare('delete from accounts where id = ? and username is null').bind(id),
  ])
  return existing
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
  const who = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!who) return answer(401, { error: 'sign-in' })
  await tablesIn(db)
  const text = (key: string, most: number) => (typeof asked[key] === 'string' && (asked[key] as string).length <= most ? asked[key] as string : null)

  switch (what) {
    // One's own row: made if need be, and changed as asked.
    case 'me': {
      await db.prepare('insert into accounts (id, kind, created_at) values (?, ?, ?) on conflict (id) do nothing').bind(who.id, who.kind, Date.now()).run()
      const set = (asked.set ?? {}) as Record<string, unknown>
      const before = await db.prepare('select username, display_name, name_changed_at from accounts where id = ?').bind(who.id).first<{ username: string | null; display_name: string | null; name_changed_at: number | null }>()
      if ('username' in set) {
        const username = typeof set.username === 'string' ? set.username.trim() : ''
        if (!USERNAME.test(username)) return answer(400, { error: 'username' })
        // An existing account's is the one its Supabase profile has, no other.
        if (who.kind === 'supabase' && (await supabaseUsername(env, who, asked.token as string))?.toLowerCase() !== username.toLowerCase()) return answer(403, { error: 'not yours' })
        const here = await db.prepare('select id from accounts where username = ? collate nocase and id <> ?').bind(username, who.id).first()
        if (here) return answer(409, { error: 'taken' })
        if (who.kind === 'google') {
          const elsewhere = await takenInSupabase(env, username, null)
          if (elsewhere === null) return answer(503, { error: 'check' })
          if (elsewhere) return answer(409, { error: 'taken' })
        }
        await db.prepare('update accounts set username = ? where id = ?').bind(username, who.id).run()
      }
      if ('display_name' in set) {
        const name = typeof set.display_name === 'string' ? set.display_name.trim().slice(0, 50) : ''
        // A Google account's name, changed once it has one: once in so long
        // (an existing account's comes from its profile, which says).
        const changing = who.kind === 'google' && !!before?.username && (name || null) !== before.display_name
        if (changing && before?.name_changed_at && Date.now() - before.name_changed_at < NAME_EVERY_MS) {
          return answer(429, { error: 'too soon', until: before.name_changed_at + NAME_EVERY_MS })
        }
        await db.prepare('update accounts set display_name = ?, name_changed_at = ? where id = ?')
          .bind(name || null, changing ? Date.now() : before?.name_changed_at ?? null, who.id).run()
      }
      if ('settings' in set) {
        const patch = set.settings as Record<string, unknown> | null
        if (who.kind !== 'google') return answer(403, { error: 'settings' })
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return answer(400, { error: 'settings' })
        for (const [key, value] of Object.entries(patch)) if (!SETTINGS[key] || (value !== null && !SETTINGS[key](value))) return answer(400, { error: 'settings', key })
        // Merged as one statement: two settings saved at once both stay.
        await db.prepare("update accounts set settings = json_patch(coalesce(settings, '{}'), ?) where id = ?").bind(JSON.stringify(patch), who.id).run()
      }
      if ('drive_key' in set || 'drive_root' in set) {
        const key = JSON.stringify(set.drive_key ?? null)
        const root = typeof set.drive_root === 'string' ? set.drive_root : null
        if (key.length > 1000 || (root && root.length > 128)) return answer(400, { error: 'drive' })
        await db.prepare('update accounts set drive_key = ?, drive_root = ? where id = ?').bind(key === 'null' ? null : key, root, who.id).run()
      }
      const row = await db.prepare('select id, kind, username, display_name, drive_key, drive_root, email, settings, name_changed_at from accounts where id = ?').bind(who.id).first()
      return answer(200, shown(row))
    }

    // Others, by username or by their ids: what's public of them -- never their email.
    case 'find': {
      const columns = 'select id, username, display_name, drive_key, drive_root from accounts'
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

    // An invitation from oneself: one per person and atrium, the latest.
    case 'invite': {
      const to = text('to', 64), roster = text('roster', 128), lobby = text('lobby_id', 64), name = text('name', 200)
      const secret = asked.secret === null ? null : text('secret', 2000)
      if (!to || !roster || !lobby || !name || (asked.secret !== null && secret === null)) return answer(400, { error: 'body' })
      await db.prepare(`insert into invites (id, to_user, from_user, roster, lobby_id, name, secret, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict (to_user, roster) do update set from_user = excluded.from_user, lobby_id = excluded.lobby_id, name = excluded.name,
        secret = excluded.secret, created_at = excluded.created_at`)
        .bind(crypto.randomUUID(), to, who.id, roster, lobby, name, secret, Date.now()).run()
      return answer(200, { ok: true })
    }

    // One's invitations, the newest first, with who sent each.
    case 'invites': {
      const { results } = await db.prepare(`select i.id, i.from_user, i.roster, i.lobby_id, i.name, i.secret, i.created_at,
        coalesce(a.display_name, a.username) as from_name from invites i left join accounts a on a.id = i.from_user
        where i.to_user = ? order by i.created_at desc`).bind(who.id).all()
      return answer(200, results)
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

// A row as it's given: the Drive key as itself, not its text.
function shown(row: Record<string, unknown> | null) {
  if (!row) return null
  const json = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : null)
  return { ...row, drive_key: json(row.drive_key), ...('settings' in row ? { settings: json(row.settings) ?? {} } : {}) }
}

/** Whether an existing account has that username (Supabase says yes or no,
 *  add_username_taken.sql) -- `except` that account's own. Null when it
 *  couldn't be asked: the caller says so, and never gives the name. */
async function takenInSupabase(env: Env, username: string, except: string | null): Promise<boolean | null> {
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
async function supabaseUsername(env: Env, who: Who, token: string): Promise<string | null> {
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
