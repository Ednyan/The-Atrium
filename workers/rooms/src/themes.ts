// The developer's special themes (src/lib/specialThemes in the app): read by
// anyone, the desktop too -- each all year or in a window of the year, or a
// built-in preset made over -- and made, changed and removed by the
// platform's operator alone (Developers > Special themes).
//
// Moved from Supabase (phase 10, step 6): copied from its special_themes the
// first time they're asked for here, and kept here from then on. Until that
// copy is made, the list isn't given (503): the app keeps the one it has,
// rather than taking an empty one for the truth.

import { SITE } from './mail'
import { isOperator, keep, setting, tablesIn } from './people'
import { replies, whoIs, type Env } from './who'

const COPIED = 'themes.from_supabase'
const COLUMNS = 'id, name, mode, theme_settings, starts_on, ends_on, hidden, preset'
const BUILT_IN = ['sepia', 'abyss', 'markerboard']
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MOST_SETTINGS = 64 * 1024
// Kept at the edge a while, dropped as one changes (here; elsewhere, at most this old).
const FRESH_S = 300
const LIST_KEY = `${SITE}/themes`

interface Row { id: string; name: string; mode: string; theme_settings: string; starts_on: string | null; ends_on: string | null; hidden: number; preset: string | null }
const shown = (row: Row) => ({ ...row, theme_settings: JSON.parse(row.theme_settings), hidden: !!row.hidden })
const open = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers } })

export async function themes(request: Request, env: Env, what: string): Promise<Response> {
  const db = env.PEOPLE
  if (!db) return open(503, { error: 'not set up' })
  await tablesIn(db)

  if (request.method === 'GET' && what === '') {
    const kept = await caches.default.match(LIST_KEY).catch(() => undefined)
    if (kept) return kept
    if (!(await setting(db, COPIED)) && !(await copyFromSupabase(env, db))) return open(503, { error: 'not copied yet' })
    const { results } = await db.prepare(`select ${COLUMNS} from special_themes order by starts_on`).all<Row>()
    const answer = open(200, results.map(shown), { 'Cache-Control': `s-maxage=${FRESH_S}` })
    await caches.default.put(LIST_KEY, answer.clone()).catch(() => {})
    return answer
  }

  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  let asked: Record<string, any>
  try { asked = await request.json() } catch { return answer(400, { error: 'body' }) }
  const who = await whoIs(asked.token, env)
  if (!who) return answer(401, { error: 'Not signed in' })
  if (!(await isOperator(env, who, asked.token))) return answer(403, { error: 'Not allowed' })
  // Copied first, or a save now would be overwritten by nothing -- and the
  // copy, made later, would bring back what was deleted meanwhile.
  if (!(await setting(db, COPIED)) && !(await copyFromSupabase(env, db))) return answer(503, { error: 'Supabase’s themes not copied yet' })

  if (what === 'save') {
    const theme = asked.theme ?? {}
    const settings = JSON.stringify(theme.theme_settings ?? null)
    const window = theme.starts_on == null && theme.ends_on == null ? [null, null]
      : MONTH_DAY.test(theme.starts_on) && MONTH_DAY.test(theme.ends_on) ? [theme.starts_on, theme.ends_on] : null
    if (typeof theme.id !== 'string' || !/^[\w-]{1,64}$/.test(theme.id) || typeof theme.name !== 'string' || !theme.name.trim() || theme.name.length > 40
      || !['light', 'dark'].includes(theme.mode) || !theme.theme_settings || typeof theme.theme_settings !== 'object' || settings.length > MOST_SETTINGS
      || !window || (theme.preset != null && !BUILT_IN.includes(theme.preset))) return answer(400, { error: 'That theme can’t be saved.' })
    await db.prepare(`insert into special_themes (${COLUMNS}, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict (id) do update set name = excluded.name, mode = excluded.mode, theme_settings = excluded.theme_settings, starts_on = excluded.starts_on,
      ends_on = excluded.ends_on, hidden = excluded.hidden, preset = excluded.preset, updated_at = excluded.updated_at`)
      .bind(theme.id, theme.name.trim(), theme.mode, settings, window[0], window[1], theme.hidden === true ? 1 : 0, theme.preset ?? null, Date.now()).run()
  } else if (what === 'delete') {
    if (typeof asked.id !== 'string') return answer(400, { error: 'body' })
    await db.prepare('delete from special_themes where id = ?').bind(asked.id).run()
  } else {
    return answer(404, { error: 'what' })
  }
  await caches.default.delete(LIST_KEY).catch(() => false)
  return answer(200, { ok: true })
}

// Supabase's special themes, read as anyone may, kept here. Whether it was.
async function copyFromSupabase(env: Env, db: D1Database): Promise<boolean> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/special_themes?select=${COLUMNS.replace(/ /g, '')}`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
  }).catch(() => null)
  if (!response?.ok) return false
  const rows = await response.json().catch(() => null) as Record<string, any>[] | null
  if (!Array.isArray(rows)) return false
  await db.batch([
    ...rows.map(row => db.prepare(`insert into special_themes (${COLUMNS}, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do nothing`)
      .bind(row.id, row.name, row.mode === 'light' ? 'light' : 'dark', JSON.stringify(row.theme_settings ?? {}), row.starts_on ?? null, row.ends_on ?? null,
        row.hidden === true ? 1 : 0, row.preset ?? null, Date.now())),
    keep(db, COPIED, Date.now()),
  ])
  return true
}
