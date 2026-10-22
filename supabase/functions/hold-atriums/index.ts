// The cloud atriums whose owners haven't come back, held for them by the
// Atrium (phase 10, step 5c; workers/rooms/src/held.ts). The worker asks
// this, with the platform operator's own sign-in, for what's left in
// Supabase, for an atrium's manifest -- its owner, its name, its people, its
// files -- and its rows; and, once the worker has all of it, to let the
// original go. The owner's app makes it a hosted atrium on their next visit,
// as it would have moved it from here (src/lib/moveToDrive).
//
// The operator's alone, checked on every request as moderate-contributors
// does: it reads and deletes atriums that aren't theirs, as the service role.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'

// Where an atrium's files are in Supabase Storage (the public traces bucket).
const CLOUD_FILES = '/storage/v1/object/public/traces/'
const PAGE = 1000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const admin = createAdminClient()
    const userId = await getAuthenticatedUserId(req, admin)
    if (!userId) return json({ error: 'Not signed in' }, 401)
    const { data: operator } = await admin.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle()
    if (!operator) return json({ error: 'Not allowed' }, 403)

    const { action, id } = await req.json()
    // Every row of a table for one atrium, a page at a time.
    const all = async (table: string, order = 'id') => {
      const rows: Record<string, unknown>[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin.from(table).select('*').eq('lobby_id', id).order(order).range(from, from + PAGE - 1)
        if (error) throw error
        rows.push(...(data ?? []))
        if (!data || data.length < PAGE) return rows
      }
    }

    switch (action) {
      // What's still here: each atrium, whose, how big.
      case 'list': {
        const { data, error } = await admin.from('lobbies').select('id, name, owner_user_id, is_public, created_at').order('created_at')
        if (error) throw error
        return json({ atriums: data ?? [] })
      }

      // Who it is and whose, who its people are, which files are its.
      case 'manifest': {
        if (!id) return json({ error: 'Missing id' }, 400)
        const { data: lobby, error } = await admin.from('lobbies').select('id, name, owner_user_id, is_public, admin_user_ids, edit_permission_mode').eq('id', id).maybeSingle()
        if (error) throw error
        if (!lobby) return json({ error: 'No such atrium' }, 404)
        const { data: lists, error: listsError } = await admin.from('lobby_access_lists').select('user_id, list_type').eq('lobby_id', id)
        if (listsError) throw listsError
        const people = [...new Set([...(lobby.admin_user_ids ?? []), ...(lists ?? []).map(row => row.user_id)])]
        const { data: profiles } = people.length ? await admin.from('profiles').select('id, username, display_name').in('id', people) : { data: [] }
        const traces = await all('traces')
        const files = [...new Set(traces.flatMap(row => [row.media_url, row.image_url])
          .filter((url): url is string => typeof url === 'string' && url.includes(CLOUD_FILES)))]
        return json({
          id: lobby.id,
          name: lobby.name,
          owner: lobby.owner_user_id,
          isPublic: lobby.is_public === true,
          admins: lobby.admin_user_ids ?? [],
          editMode: lobby.edit_permission_mode ?? 'all',
          lists: lists ?? [],
          names: Object.fromEntries((profiles ?? []).map(row => [row.id, row.display_name || row.username || ''])),
          files,
        })
      }

      // Its rows, as moveToDrive copies them.
      case 'export': {
        if (!id) return json({ error: 'Missing id' }, 400)
        const { data: lobby, error } = await admin.from('lobbies').select('*').eq('id', id).maybeSingle()
        if (error) throw error
        if (!lobby) return json({ error: 'No such atrium' }, 404)
        const [traces, layers, links, locations] = await Promise.all([all('traces'), all('layers'), all('trace_links'), all('lobby_locations')])
        return json({ lobby, traces, layers, links, locations })
      }

      // The original let go, once the worker holds all of it. Its rows go
      // with it (on delete cascade); its files, as moving one leaves them.
      case 'release': {
        if (!id) return json({ error: 'Missing id' }, 400)
        const { error } = await admin.from('lobbies').delete().eq('id', id)
        if (error) throw error
        return json({ ok: true })
      }

      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (error) {
    console.error('[hold-atriums]', error)
    return json({ error: (error as Error)?.message ?? 'Something went wrong.' }, 500)
  }
})
