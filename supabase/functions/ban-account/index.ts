// An existing account banned from the Atrium, or no longer, in Supabase Auth:
// banned, it can't sign in, nor renew a sign-in it has (Supabase refuses both
// while ban_duration runs). The ban itself -- for everything the rooms worker
// runs: Google sign-in, the directory, the rooms, its functions -- is the
// worker's (workers/rooms/src/people.ts, bans); this is its Supabase half,
// which the operator's app asks for once the worker has the ban.
//
// The platform's operator's alone (platform_admins), as moderate-contributors
// is: the identity from the session JWT, checked against that table here.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'

// As good as for good: Supabase takes a duration, not "forever".
const BANNED_FOR = '876000h'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const admin = createAdminClient()
    const userId = await getAuthenticatedUserId(req, admin)
    if (!userId) return json({ error: 'Not signed in' }, 401)
    const { data: operator } = await admin.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle()
    if (!operator) return json({ error: 'Not allowed' }, 403)

    const { action, id } = await req.json().catch(() => ({}))
    if ((action !== 'ban' && action !== 'unban') || typeof id !== 'string' || !id) return json({ error: 'body' }, 400)
    if (id === userId) return json({ error: 'Not oneself' }, 400)

    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: action === 'ban' ? BANNED_FOR : 'none' })
    if (error) {
      console.error(`[ban-account] ${action}:`, error)
      return json({ error: error.message }, 400)
    }
    return json({ ok: true })
  } catch (error) {
    console.error('[ban-account]', error)
    return json({ error: 'Unexpected server error' }, 500)
  }
})
