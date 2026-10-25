// The hosted store (docs/DECENTRALIZING.md, phase 10): files kept by the
// Atrium itself, for atriums hosted on Cloudflare -- what Google Drive is for
// a Drive atrium, behind the same interface on the page (lib/hostedStore,
// lib/driveSync's DriveStore). Bytes in R2; folders, names, versions and
// owners in D1.
//
//   Reading      anyone with an id: ids are random, and what an atrium keeps
//                is sealed with its keys (lib/driveFormat), as Drive's
//                "anyone with the link".
//   Writing      a file's owner -- or someone it's shared with (an atrium's
//                admin, its roster) -- and new files only in one's own
//                folders. Within one's quota of bytes.
//   App data     each account's own small files (its key pair), private to it.
//
// Errors are said as Drive says them (404, 403), which the page's sync knows.

import { tablesIn, allowedWrite } from './people'
import { FILE_NAME as NAME, fromBase64, MOST_FILE_BYTES, replies, sentFile, toBase64, whoIs, type Env } from './who'

// An account's bytes, everything it owns together, unless the worker says
// otherwise (STORE_QUOTA_MB); one file's, at most.
const QUOTA_MB = 50
// Hosted atriums one owns, at most: each is one roster of one's own.
const MOST_ATRIUMS = 3
const ROSTER = 'atrium.roster'
const atriumsOwned = async (db: D1Database, account: string) =>
  (await db.prepare('select count(*) as n from store_files where owner = ? and name = ? and folder = 0').bind(account, ROSTER).first<{ n: number }>())?.n ?? 0
const MOST_APPDATA_BYTES = 16 * 1024
// A hosted id: marked, as no Drive id can be (Drive's are letters, digits, - and _).
const ID = /^h\.[A-Za-z0-9_-]{20,40}$/

interface Row { id: string; parent: string | null; name: string; owner: string; folder: number; version: number; size: number }

const newId = () => 'h.' + toBase64(crypto.getRandomValues(new Uint8Array(18))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const quotaOf = (env: Env) => Math.max(1, Number(env.STORE_QUOTA_MB) || QUOTA_MB) * 1024 * 1024

export async function store(request: Request, env: Env, what: string): Promise<Response> {
  const db = env.PEOPLE, files = env.FILES
  if (!db || !files) return new Response('Not set up', { status: 503 })
  await tablesIn(db)

  // Reading, for anyone: a file's bytes, a file's version, a folder's listing.
  if (request.method === 'GET') {
    const [kind, id] = what.split('/')
    const open = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }
    if (!id || !ID.test(id)) return new Response('Drive 404', { status: 404, headers: open })
    if (kind === 'file') {
      const object = await files.get(`f/${id}`)
      if (!object) return new Response('Drive 404', { status: 404, headers: open })
      return new Response(object.body, { headers: { ...open, 'Content-Type': 'application/octet-stream' } })
    }
    if (kind === 'meta') {
      const row = await db.prepare('select version, name, parent from store_files where id = ?').bind(id).first<Row>()
      return row ? Response.json({ version: String(row.version), name: row.name, parent: row.parent }, { headers: open }) : new Response('Drive 404', { status: 404, headers: open })
    }
    if (kind === 'list') {
      const { results } = await db.prepare('select id, name, version from store_files where parent = ?').bind(id).all<Row>()
      return Response.json(results.map(row => ({ id: row.id, name: row.name, version: String(row.version) })), { headers: open })
    }
    return new Response('Not found', { status: 404, headers: open })
  }

  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })

  // A file written: its head (the sign-in, where it goes) and its bytes,
  // streamed on to R2 (who.ts, sentFile) -- a plain request, sent without
  // asking first.
  if (what === 'write') {
    const sent = await sentFile(request)
    if (!sent) return answer(400, { error: 'body' })
    const { head, size, body } = sent
    const who = await whoIs(String(head.token ?? ''), env)
    if (!who) return answer(401, { error: 'sign-in' })
    if (!(await allowedWrite(db, who.id))) return answer(429, { error: 'busy' })
    const name = String(head.name ?? '')
    const parent = head.parent ? String(head.parent) : null
    const id = head.id ? String(head.id) : null
    if (!body || !NAME.test(name) || (!parent === !id)) return answer(400, { error: 'body' })
    if (size > MOST_FILE_BYTES) return answer(413, { error: 'too big' })
    let row: Row | null = null
    if (id) {
      row = await db.prepare('select * from store_files where id = ? and folder = 0').bind(id).first<Row>()
      if (!row) return answer(404, { error: 'Drive 404' })
      if (row.owner !== who.id && !(await sharedWith(db, id, who.id))) return answer(403, { error: 'Drive 403: not yours' })
    } else {
      const folder = await db.prepare('select owner from store_files where id = ? and folder = 1').bind(parent).first<Row>()
      if (!folder) return answer(404, { error: 'Drive 404' })
      if (folder.owner !== who.id) return answer(403, { error: 'Drive 403: not your folder' })
      // A new atrium is a new roster: three of one's own at most.
      if (name === ROSTER && await atriumsOwned(db, who.id) >= MOST_ATRIUMS) return answer(403, { error: 'too many atriums' })
    }
    // Whose bytes these are: the file's owner, whoever writes it.
    const owner = row?.owner ?? who.id
    const used = (await db.prepare('select coalesce(sum(size), 0) as used from store_files where owner = ?').bind(owner).first<{ used: number }>())?.used ?? 0
    if (used - (row?.size ?? 0) + size > quotaOf(env)) return answer(507, { error: 'quota' })
    const fileId = row?.id ?? newId()
    await files.put(`f/${fileId}`, body)
    const now = Date.now()
    const written = row
      ? db.prepare('update store_files set version = version + 1, size = ?, name = ?, updated_at = ? where id = ? returning version').bind(size, name, now, fileId)
      : db.prepare('insert into store_files (id, parent, name, owner, folder, version, size, created_at, updated_at) values (?, ?, ?, ?, 0, 1, ?, ?, ?) returning version')
        .bind(fileId, parent, name, owner, size, now, now)
    const version = (await written.first<Row>())?.version ?? 1
    return answer(200, { id: fileId, version: String(version) })
  }

  let asked: Record<string, unknown>
  try { asked = await request.json() } catch { return answer(400, { error: 'body' }) }
  const who = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!who) return answer(401, { error: 'sign-in' })
  // What changes something, as many times an hour as any honest use: the free plan's rows are everyone's.
  if (what !== 'usage' && !(what === 'appdata' && typeof asked.bytes !== 'string') && !(await allowedWrite(db, who.id))) return answer(429, { error: 'busy' })
  const text = (key: string, test: RegExp) => (typeof asked[key] === 'string' && test.test(asked[key] as string) ? asked[key] as string : null)

  switch (what) {
    // A folder: in one of one's own, or -- with no parent -- one's own root.
    case 'folder': {
      const name = text('name', NAME), parent = asked.parent == null ? null : text('parent', ID)
      if (!name || (asked.parent != null && !parent)) return answer(400, { error: 'body' })
      if (parent) {
        const folder = await db.prepare('select owner from store_files where id = ? and folder = 1').bind(parent).first<Row>()
        if (!folder) return answer(404, { error: 'Drive 404' })
        if (folder.owner !== who.id) return answer(403, { error: 'Drive 403: not your folder' })
      }
      const id = newId(), now = Date.now()
      await db.prepare('insert into store_files (id, parent, name, owner, folder, version, size, created_at, updated_at) values (?, ?, ?, ?, 1, 1, 0, ?, ?)')
        .bind(id, parent, name, who.id, now, now).run()
      return answer(200, { id })
    }

    // Deleted for good, a folder with all in it: one's own only.
    case 'remove': {
      const id = text('id', ID)
      if (!id) return answer(400, { error: 'body' })
      const row = await db.prepare('select owner from store_files where id = ?').bind(id).first<Row>()
      if (!row) return answer(404, { error: 'Drive 404' })
      if (row.owner !== who.id) return answer(403, { error: 'Drive 403: not yours' })
      const gone = await descendants(db, id)
      await dropFiles(db, files, gone)
      return answer(200, { removed: gone.length })
    }

    // Someone else let write one of one's files (an admin, the roster), and
    // no longer: by account. The account is what's given back as the share.
    case 'share':
    case 'unshare': {
      const id = text('id', ID), account = text('account', /^[\w-]{1,64}$/)
      if (!id || !account) return answer(400, { error: 'body' })
      const row = await db.prepare('select owner from store_files where id = ?').bind(id).first<Row>()
      if (!row) return answer(404, { error: 'Drive 404' })
      if (row.owner !== who.id) return answer(403, { error: 'Drive 403: not yours' })
      if (what === 'share') await db.prepare('insert into store_shares (file, account) values (?, ?) on conflict do nothing').bind(id, account).run()
      else await db.prepare('delete from store_shares where file = ? and account = ?').bind(id, account).run()
      return answer(200, { share: account })
    }

    // One's own app data: small, private, by name.
    case 'appdata': {
      const name = text('name', NAME)
      if (!name) return answer(400, { error: 'body' })
      if (typeof asked.bytes === 'string') {
        const bytes = fromBase64(asked.bytes)
        if (bytes.length > MOST_APPDATA_BYTES) return answer(413, { error: 'too big' })
        await db.prepare('insert into store_appdata (account, name, bytes, updated_at) values (?, ?, ?, ?) on conflict (account, name) do update set bytes = excluded.bytes, updated_at = excluded.updated_at')
          .bind(who.id, name, asked.bytes, Date.now()).run()
        return answer(200, { ok: true })
      }
      const row = await db.prepare('select bytes from store_appdata where account = ? and name = ?').bind(who.id, name).first<{ bytes: string }>()
      return answer(200, { bytes: row?.bytes ?? null })
    }

    // What one uses of one's quota, and of one's hosted atriums.
    case 'usage': {
      const used = (await db.prepare('select coalesce(sum(size), 0) as used from store_files where owner = ?').bind(who.id).first<{ used: number }>())?.used ?? 0
      return answer(200, { usage: used, limit: quotaOf(env), atriums: await atriumsOwned(db, who.id), most: MOST_ATRIUMS })
    }
  }
  return answer(404, { error: 'what' })
}

const sharedWith = async (db: D1Database, file: string, account: string) =>
  !!(await db.prepare('select 1 from store_shares where file = ? and account = ?').bind(file, account).first())

/** A file or folder and, a folder, everything under it. */
/** Whether an invitation may join by itself: its atrium was the sender's in
 *  the hosted store -- one's folder for it is named by its id, its roster in
 *  it -- and the one it's to is in that roster, a member or invited (a hosted
 *  atrium moved into its owner's Drive, lib/driveSync moveHostedToDrive). */
export async function hostedMember(env: Env, from: string, lobby: string, to: string): Promise<boolean> {
  const db = env.PEOPLE, files = env.FILES
  if (!db || !files) return false
  const row = await db.prepare(`select r.id from store_files f join store_files r on r.parent = f.id
    where f.name = ? and f.owner = ? and f.folder = 1 and r.name = ? and r.folder = 0`).bind(lobby, from, ROSTER).first<{ id: string }>()
  const object = row && await files.get(`f/${row.id}`)
  if (!object) return false
  const roster = await object.json<{ lobbyId?: string; members?: { user: string; role: string }[]; invited?: { user: string }[] }>().catch(() => null)
  return !!roster && roster.lobbyId === lobby && (!!roster.members?.some(member => member.user === to && member.role !== 'owner') || !!roster.invited?.some(invited => invited.user === to))
}

/** Files gone for good: their bytes, their rows, whom they were shared with. */
async function dropFiles(db: D1Database, files: R2Bucket, ids: string[]): Promise<void> {
  for (let at = 0; at < ids.length; at += 100) {
    const some = ids.slice(at, at + 100)
    await files.delete(some.map(each => `f/${each}`))
    const marks = some.map(() => '?').join(',')
    await db.batch([
      db.prepare(`delete from store_files where id in (${marks})`).bind(...some),
      db.prepare(`delete from store_shares where file in (${marks})`).bind(...some),
    ])
  }
}

/** An account deleted: everything it keeps in the hosted store -- its files,
 *  its app data -- and what it was let write of others'. */
export async function dropOwnFiles(env: Env, account: string): Promise<void> {
  const db = env.PEOPLE
  if (!db) return
  await tablesIn(db)
  const { results } = await db.prepare('select id from store_files where owner = ?').bind(account).all<{ id: string }>()
  if (env.FILES) await dropFiles(db, env.FILES, results.map(row => row.id))
  await db.batch([
    db.prepare('delete from store_appdata where account = ?').bind(account),
    db.prepare('delete from store_shares where account = ?').bind(account),
  ])
}

async function descendants(db: D1Database, id: string): Promise<string[]> {
  const all = [id]
  for (let at = 0; at < all.length; at++) {
    const { results } = await db.prepare('select id from store_files where parent = ?').bind(all[at]).all<{ id: string }>()
    all.push(...results.map(row => row.id))
  }
  return all
}
