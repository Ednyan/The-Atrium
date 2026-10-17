// The directory: who's who among the Atrium's people, for atriums kept in
// Google Drive -- someone found by username, their key and their folder, and
// the invitations they're sent. One place for both kinds of account
// (src/who.ts), so each can add the other. Usernames are unique across both:
// a Google account can't take an existing account's (Supabase is asked).
//
// Cloudflare D1, free: 5 GB, 5 million rows read and 100,000 written a day.
// Nothing an atrium holds is here -- only who's who, and which atrium (its
// roster file in Drive) someone's been invited to.

import { replies, whoIs, type Env, type Who } from './who'

const TABLES = [
  `create table if not exists accounts (
    id text primary key, kind text not null, username text unique collate nocase, display_name text,
    drive_key text, drive_root text, email text, created_at integer not null)`,
  `create table if not exists invites (
    id text primary key, to_user text not null, from_user text not null, roster text not null, lobby_id text not null,
    name text not null, secret text, created_at integer not null, unique (to_user, roster))`,
  'create index if not exists invites_to on invites (to_user)',
  'create index if not exists invites_from on invites (from_user)',
]
// Made once per instance of the worker, the first time it's needed.
let made: Promise<unknown> | null = null
const tablesIn = (db: D1Database) => (made ??= db.batch(TABLES.map(sql => db.prepare(sql))).catch(error => { made = null; throw error }))

const USERNAME = /^[a-zA-Z0-9_]{3,20}$/
const MOST_IDS = 200

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
  const who = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!who) return answer(401, { error: 'sign-in' })
  await tablesIn(db)
  const text = (key: string, most: number) => (typeof asked[key] === 'string' && (asked[key] as string).length <= most ? asked[key] as string : null)

  switch (what) {
    // One's own row: made if need be, and changed as asked.
    case 'me': {
      await db.prepare('insert into accounts (id, kind, created_at) values (?, ?, ?) on conflict (id) do nothing').bind(who.id, who.kind, Date.now()).run()
      const set = (asked.set ?? {}) as Record<string, unknown>
      if ('username' in set) {
        const username = typeof set.username === 'string' ? set.username.trim() : ''
        if (!USERNAME.test(username)) return answer(400, { error: 'username' })
        // An existing account's is the one its Supabase profile has, no other.
        if (who.kind === 'supabase' && (await supabaseUsername(env, who, asked.token as string))?.toLowerCase() !== username.toLowerCase()) return answer(403, { error: 'not yours' })
        const here = await db.prepare('select id from accounts where username = ? collate nocase and id <> ?').bind(username, who.id).first()
        if (here || (who.kind === 'google' && await takenInSupabase(env, username))) return answer(409, { error: 'taken' })
        await db.prepare('update accounts set username = ? where id = ?').bind(username, who.id).run()
      }
      if ('display_name' in set) {
        const name = typeof set.display_name === 'string' ? set.display_name.trim().slice(0, 50) : ''
        await db.prepare('update accounts set display_name = ? where id = ?').bind(name || null, who.id).run()
      }
      if ('drive_key' in set || 'drive_root' in set) {
        const key = JSON.stringify(set.drive_key ?? null)
        const root = typeof set.drive_root === 'string' ? set.drive_root : null
        if (key.length > 1000 || (root && root.length > 128)) return answer(400, { error: 'drive' })
        await db.prepare('update accounts set drive_key = ?, drive_root = ? where id = ?').bind(key === 'null' ? null : key, root, who.id).run()
      }
      const row = await db.prepare('select id, kind, username, display_name, drive_key, drive_root, email from accounts where id = ?').bind(who.id).first()
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
  return { ...row, drive_key: typeof row.drive_key === 'string' ? JSON.parse(row.drive_key) : null }
}

/** Whether an existing account has that username (Supabase says yes or no,
 *  add_username_taken.sql). Unknown counts as taken: a username can't be
 *  given twice. */
async function takenInSupabase(env: Env, username: string): Promise<boolean> {
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/username_taken`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_username: username }),
    })
    return !response.ok || (await response.json()) !== false
  } catch {
    return true
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
