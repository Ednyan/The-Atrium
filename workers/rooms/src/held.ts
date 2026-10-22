// Cloud atriums held for their owners (phase 10, step 5c). An atrium moves
// out of Supabase on its owner's next visit -- only their app can seal its
// hosted copy (src/lib/moveToDrive in the app). For owners who haven't come
// back, the platform's operator holds what's left: its rows, its files and
// who its people were, kept here in R2, unsealed as Supabase kept them, and
// the original let go. The owner's app makes each a hosted atrium on their
// next visit, its people invited back, joining by themselves (people.ts,
// heldMember); then it's no longer held.
//
//   list     the operator's: what's left in Supabase, and what's held
//   take     the operator's: an atrium's manifest and rows, from Supabase
//            (supabase/functions/hold-atriums, with the operator's sign-in)
//   file     the operator's: one of its files, Supabase's storage to R2 --
//            one a request, so an atrium of any size stays inside a
//            request's limits
//   release  the operator's: the original let go, once all of it is here
//   mine     an owner's held atriums
//   read     its manifest, rows or a file, to its owner (or the operator)
//   done     its owner's: made a hosted atrium, so no longer held

import { isOperator, tablesIn, UUID } from './people'
import { replies, whoIs, type Env } from './who'

// Where Supabase keeps an atrium's files (the public traces bucket).
const CLOUD_FILES = '/storage/v1/object/public/traces/'
const atriumKey = (lobby: string) => `held/${lobby}/atrium.json`
const fileKey = (lobby: string, idx: number) => `held/${lobby}/files/${idx}`

interface Manifest {
  id: string; name: string; owner: string | null; isPublic: boolean; admins: string[]; editMode: string
  lists: { user_id: string; list_type: string }[]; names: Record<string, string>; files: string[]
}

export async function held(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  const db = env.PEOPLE, files = env.FILES
  if (!db || !files) return answer(503, { error: 'not set up' })
  let asked: Record<string, unknown>
  try { asked = await request.json() } catch { return answer(400, { error: 'body' }) }
  const token = typeof asked.token === 'string' ? asked.token : ''
  const who = await whoIs(token, env)
  if (!who) return answer(401, { error: 'sign-in' })
  await tablesIn(db)
  const id = typeof asked.id === 'string' && UUID.test(asked.id) ? asked.id.toLowerCase() : null
  const operator = () => isOperator(env, who, token)
  // Supabase's side, asked with the operator's own sign-in.
  const fromSupabase = (action: string) => fetch(`${env.SUPABASE_URL}/functions/v1/hold-atriums`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
  })
  const refused = async (response: Response) => answer(502, { error: `Supabase: ${((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? response.status}` })

  switch (what) {
    case 'list': {
      if (!(await operator())) return answer(403, { error: 'Not allowed' })
      const response = await fromSupabase('list')
      if (!response.ok) return refused(response)
      const { atriums } = await response.json() as { atriums: unknown[] }
      const { results } = await db.prepare(`select h.lobby_id, h.name, h.owner, h.taken_at, h.released_at, count(f.idx) as files,
        coalesce(sum(f.state is null), 0) as left from held_atriums h left join held_files f on f.lobby = h.lobby_id group by h.lobby_id order by h.taken_at`).all()
      return answer(200, { remaining: atriums, held: results })
    }

    case 'take': {
      if (!(await operator())) return answer(403, { error: 'Not allowed' })
      if (who.kind !== 'supabase') return answer(400, { error: 'Sign in with the operator account Supabase knows.' })
      if (!id) return answer(400, { error: 'body' })
      const manifestResponse = await fromSupabase('manifest')
      if (!manifestResponse.ok) return refused(manifestResponse)
      const manifest = await manifestResponse.json() as Manifest
      if (!manifest.owner) return answer(409, { error: 'It has no owner to hold it for.' })
      const rows = await fromSupabase('export')
      if (!rows.ok) return refused(rows)
      // Kept as it came, not parsed: its traces can be many.
      await files.put(atriumKey(id), await rows.arrayBuffer())
      await db.batch([
        db.prepare(`insert into held_atriums (lobby_id, owner, name, manifest, taken_at, released_at) values (?, ?, ?, ?, ?, null)
          on conflict (lobby_id) do update set owner = excluded.owner, name = excluded.name, manifest = excluded.manifest, taken_at = excluded.taken_at`)
          .bind(id, manifest.owner, manifest.name, JSON.stringify(manifest), Date.now()),
        db.prepare('delete from held_files where lobby = ?').bind(id),
        ...manifest.files.map((url, idx) => db.prepare('insert into held_files (lobby, idx, url) values (?, ?, ?)').bind(id, idx, url)),
      ])
      return answer(200, { files: manifest.files.length })
    }

    // One file, streamed from Supabase's storage into R2. One that's gone
    // there already is said so -- not waited for.
    case 'file': {
      if (!(await operator())) return answer(403, { error: 'Not allowed' })
      const idx = Number(asked.idx)
      if (!id || !Number.isInteger(idx)) return answer(400, { error: 'body' })
      const row = await db.prepare('select url, state from held_files where lobby = ? and idx = ?').bind(id, idx).first<{ url: string; state: string | null }>()
      if (!row) return answer(404, { error: 'no such file' })
      if (row.state) return answer(200, { state: row.state })
      if (!row.url.startsWith(`${env.SUPABASE_URL}${CLOUD_FILES}`)) return answer(400, { error: 'not Supabase’s' })
      const response = await fetch(row.url)
      let state = 'gone', size = 0
      if (response.ok) {
        // Streamed when its length is known as it arrives -- not when it came
        // compressed, which the length counts and the body doesn't.
        const length = Number(response.headers.get('Content-Length'))
        const streamed = Number.isFinite(length) && length >= 0 && !response.headers.get('Content-Encoding') && response.body
        const body = streamed || await response.arrayBuffer()
        const kept = await files.put(fileKey(id, idx), body, { httpMetadata: { contentType: response.headers.get('Content-Type') ?? undefined } })
        state = 'kept'
        size = kept.size
      } else if (response.status !== 404 && response.status !== 400) {
        return answer(502, { error: `Supabase's storage: ${response.status}` })
      }
      await db.prepare('update held_files set state = ?, size = ? where lobby = ? and idx = ?').bind(state, size, id, idx).run()
      return answer(200, { state })
    }

    case 'release': {
      if (!(await operator())) return answer(403, { error: 'Not allowed' })
      if (!id) return answer(400, { error: 'body' })
      const left = await db.prepare('select count(*) as n from held_files where lobby = ? and state is null').bind(id).first<{ n: number }>()
      const kept = await db.prepare('select 1 from held_atriums where lobby_id = ?').bind(id).first()
      if (!kept || (left?.n ?? 0) > 0) return answer(409, { error: 'Not all of it is held yet.' })
      const response = await fromSupabase('release')
      if (!response.ok) return refused(response)
      await db.prepare('update held_atriums set released_at = ? where lobby_id = ?').bind(Date.now(), id).run()
      return answer(200, { ok: true })
    }

    case 'mine': {
      const { results } = await db.prepare('select lobby_id, name from held_atriums where owner = ? and released_at is not null order by taken_at').bind(who.id).all()
      return answer(200, results)
    }

    case 'read': {
      if (!id) return answer(400, { error: 'body' })
      const row = await db.prepare('select owner, manifest from held_atriums where lobby_id = ?').bind(id).first<{ owner: string; manifest: string }>()
      if (!row) return answer(404, { error: 'not held' })
      if (row.owner !== who.id && !(await operator())) return answer(403, { error: 'Not yours' })
      if (asked.part === 'manifest') return answer(200, JSON.parse(row.manifest))
      const idx = Number(asked.part)
      const object = await files.get(asked.part === 'atrium' ? atriumKey(id) : Number.isInteger(idx) ? fileKey(id, idx) : '')
      if (!object) return answer(404, { error: 'gone' })
      const origin = request.headers.get('Origin') ?? ''
      return new Response(object.body, { headers: { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream' } })
    }

    case 'done': {
      if (!id) return answer(400, { error: 'body' })
      const row = await db.prepare('select owner from held_atriums where lobby_id = ?').bind(id).first<{ owner: string }>()
      if (!row) return answer(200, { ok: true })
      if (row.owner !== who.id) return answer(403, { error: 'Not yours' })
      const { results } = await db.prepare('select idx from held_files where lobby = ?').bind(id).all<{ idx: number }>()
      const keys = [atriumKey(id), ...results.map(file => fileKey(id, file.idx))]
      for (let at = 0; at < keys.length; at += 1000) await files.delete(keys.slice(at, at + 1000))
      await db.batch([db.prepare('delete from held_files where lobby = ?').bind(id), db.prepare('delete from held_atriums where lobby_id = ?').bind(id)])
      return answer(200, { ok: true })
    }
  }
  return answer(404, { error: 'what' })
}

/** Whether an invitation may join by itself: its atrium is held for the one
 *  sending it, and the one it's to was among its people (an admin,
 *  whitelisted, or an editor) -- as the operator's hold took them from
 *  Supabase. */
export async function heldMember(db: D1Database, from: string, lobby: string, to: string): Promise<boolean> {
  const row = await db.prepare('select manifest from held_atriums where lobby_id = ? and owner = ?').bind(lobby.toLowerCase(), from).first<{ manifest: string }>()
  if (!row) return false
  const manifest = JSON.parse(row.manifest) as Manifest
  return manifest.admins.includes(to) || manifest.lists.some(entry => entry.user_id === to && (entry.list_type === 'whitelist' || entry.list_type === 'editor'))
}
