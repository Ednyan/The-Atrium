// Public Drive atriums, mirrored (docs/DECENTRALIZING.md, phase 8's last part
// and phase 10, step 3): their files kept here too, by their Drive ids, so
// whoever looks at one reads it from the Atrium -- no Google robot check, no
// file locked for being read too often -- and Drive only for what isn't here.
//
// Kept by those in the atrium: its owner (who listed it, src/people.ts) puts
// its roster; its members -- as that mirrored roster has them -- their own
// saves and files, and the owner's app fills in what's missing. Read by
// anyone, as the atrium itself is: it's public, and what it holds is sealed.
// Gone when it's no longer listed (dropMirror); what its Drive no longer has,
// as its owner's app finds it ('drop').

import { tablesIn, allowedWrite } from './people'
import { dropPublic, FILE_NAME as NAME, MOST_FILE_BYTES, publicFile, putPublic, replies, sentFile, whoIs, type Env } from './who'

// The bytes one owner's public atriums take in mirrors, all together, at
// most: past it, what isn't mirrored is read from Drive, as before mirrors.
const MOST_MB = 500
const DRIVE_ID = /^[\w-]{10,128}$/
const LOBBY = /^[\w-]{1,64}$/

interface Entry { id: string; parent: string | null; name: string; folder: number; version: string; size: number }

export async function mirror(request: Request, env: Env, what: string): Promise<Response> {
  const db = env.PEOPLE
  if (!db || !env.FILES) return new Response('Not set up', { status: 503 })
  await tablesIn(db)

  // Reading, for anyone: a file, its version, a folder's listing -- of one
  // atrium's mirror.
  if (request.method === 'GET') {
    const [kind, lobby, id] = what.split('/')
    const open = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
    if (!lobby || !LOBBY.test(lobby) || !id || !DRIVE_ID.test(id)) return new Response('Drive 404', { status: 404, headers: open })
    if (kind === 'file') {
      // The app reads it from the public bucket (who.ts); here, what isn't there yet.
      const object = await publicFile(env, `m/${lobby}/${id}`)
      return object ? new Response(object.body, { headers: { ...open, 'Content-Type': 'application/octet-stream' } }) : new Response('Drive 404', { status: 404, headers: open })
    }
    if (kind === 'meta') {
      const row = await db.prepare('select version, name, parent from mirror_files where lobby = ? and id = ?').bind(lobby, id).first<Entry>()
      return row ? Response.json({ version: row.version, name: row.name, parent: row.parent }, { headers: open }) : new Response('Drive 404', { status: 404, headers: open })
    }
    if (kind === 'list') {
      const { results } = await db.prepare('select id, name, version from mirror_files where lobby = ? and parent = ?').bind(lobby, id).all<Entry>()
      return Response.json(results.map(row => ({ id: row.id, name: row.name, version: row.version })), { headers: open })
    }
    return new Response('Not found', { status: 404, headers: open })
  }

  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  if (what === 'drop') return drop(request, env, db, answer)
  if (what !== 'put') return answer(404, { error: 'what' })
  // Its head (the sign-in, which file of which atrium) and its bytes,
  // streamed on to R2 (who.ts, sentFile); a folder has none.
  const sent = await sentFile(request)
  if (!sent) return answer(400, { error: 'body' })
  const { head } = sent
  const who = await whoIs(String(head.token ?? ''), env)
  if (!who) return answer(401, { error: 'sign-in' })
  if (!(await allowedWrite(db, who.id))) return answer(429, { error: 'busy' })
  const lobby = String(head.lobby ?? ''), id = String(head.id ?? ''), name = String(head.name ?? '')
  const parent = head.parent ? String(head.parent) : null
  const version = String(head.version ?? '')
  const folder = head.folder === true || !sent.body
  if (!LOBBY.test(lobby) || !DRIVE_ID.test(id) || !NAME.test(name) || (parent && !DRIVE_ID.test(parent)) || !/^[\w.-]{1,64}$/.test(version)) return answer(400, { error: 'body' })
  if (!folder && sent.size > MOST_FILE_BYTES) return answer(413, { error: 'too big' })
  let body = folder ? null : sent.body

  // Only a listed atrium's -- and only by its owner, or a member as its
  // mirrored roster has them. Its roster itself: its owner's, or an admin's.
  const listed = await db.prepare('select roster, owner from public_atriums where lobby_id = ?').bind(lobby).first<{ roster: string; owner: string }>()
  if (!listed) return answer(404, { error: 'not public' })
  const roster = await mirroredRoster(env, lobby, listed.roster)
  const role = roster?.members?.find(member => member.user === who.id)?.role
  const isOwner = who.id === listed.owner
  if (id === listed.roster) {
    if (!isOwner && role !== 'admin') return answer(403, { error: 'Drive 403: not the roster’s' })
    if (!body) return answer(400, { error: 'body' })
    // Read whole to be checked -- a roster is small -- and kept as read.
    const text = await new Response(body).text()
    try {
      const roster = JSON.parse(text) as { members?: unknown }
      if (!Array.isArray(roster.members)) throw new Error('no members')
    } catch {
      return answer(400, { error: 'not a roster' })
    }
    body = new TextEncoder().encode(text).buffer as ArrayBuffer
  } else if (!isOwner && (!role || role === 'viewer')) {
    return answer(403, { error: 'Drive 403: not in it' })
  }

  const had = await db.prepare('select size from mirror_files where lobby = ? and id = ?').bind(lobby, id).first<Entry>()
  const size = folder ? 0 : sent.size
  const used = (await db.prepare(`select coalesce(sum(m.size), 0) as used from mirror_files m join public_atriums p on p.lobby_id = m.lobby
    where p.owner = ?`).bind(listed.owner).first<{ used: number }>())?.used ?? 0
  if (used - (had?.size ?? 0) + size > MOST_MB * 1024 * 1024) return answer(507, { error: 'quota' })
  if (body) await putPublic(env, `m/${lobby}/${id}`, body)
  await db.prepare(`insert into mirror_files (lobby, id, parent, name, folder, version, size, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict (lobby, id) do update set parent = coalesce(excluded.parent, mirror_files.parent), name = excluded.name, version = excluded.version, size = excluded.size, updated_at = excluded.updated_at`)
    .bind(lobby, id, parent, name, folder ? 1 : 0, version, size, Date.now()).run()
  return answer(200, { ok: true })
}

// What its Drive no longer has -- a file deleted, saves folded into one --
// out of an atrium's mirror (lib/driveSync, fillFolder): by its owner or an
// admin, as its roster, whose apps fill it. Never the roster itself.
const MOST_DROPPED = 90
async function drop(request: Request, env: Env, db: D1Database, answer: (status: number, body: unknown) => Response): Promise<Response> {
  let asked: Record<string, unknown>
  try { asked = await request.json() } catch { return answer(400, { error: 'body' }) }
  const who = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!who) return answer(401, { error: 'sign-in' })
  const lobby = String(asked.lobby ?? ''), ids = Array.isArray(asked.ids) ? asked.ids.map(String) : []
  if (!LOBBY.test(lobby) || !ids.length || ids.length > MOST_DROPPED || !ids.every(id => DRIVE_ID.test(id))) return answer(400, { error: 'body' })
  const listed = await db.prepare('select roster, owner from public_atriums where lobby_id = ?').bind(lobby).first<{ roster: string; owner: string }>()
  if (!listed) return answer(404, { error: 'not public' })
  const role = (await mirroredRoster(env, lobby, listed.roster))?.members?.find(member => member.user === who.id)?.role
  if (who.id !== listed.owner && role !== 'admin') return answer(403, { error: 'Drive 403: not the roster’s' })
  const some = ids.filter(id => id !== listed.roster)
  if (!some.length) return answer(200, { dropped: 0 })
  const marks = some.map(() => '?').join(',')
  await dropPublic(env, some.map(id => `m/${lobby}/${id}`))
  const done = await db.prepare(`delete from mirror_files where lobby = ? and id in (${marks})`).bind(lobby, ...some).run()
  return answer(200, { dropped: done.meta.changes })
}

async function mirroredRoster(env: Env, lobby: string, rosterId: string): Promise<{ members?: { user: string; role: string }[] } | null> {
  const object = await publicFile(env, `m/${lobby}/${rosterId}`)
  try { return object ? await object.json() : null } catch { return null }
}

/** An atrium's mirror, gone: no longer public, or deleted. */
export async function dropMirror(env: Env, lobby: string): Promise<void> {
  const db = env.PEOPLE
  if (!db || !env.FILES) return
  const { results } = await db.prepare('select id from mirror_files where lobby = ? and folder = 0').bind(lobby).all<{ id: string }>()
  for (let at = 0; at < results.length; at += 1000) await dropPublic(env, results.slice(at, at + 1000).map(row => `m/${lobby}/${row.id}`))
  await db.prepare('delete from mirror_files where lobby = ?').bind(lobby).run()
}
