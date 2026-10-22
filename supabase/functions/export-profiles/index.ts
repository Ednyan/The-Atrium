// Every account's profile, for the Atrium's worker to keep (phase 10, step 6;
// workers/rooms/src/people.ts 'profiles'). The worker asks with the platform
// operator's own sign-in; it's the operator's alone, checked here on every
// request as moderate-contributors does. What a profile shows anyway --
// username, display name, colour, themes -- never an address.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'

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

    const profiles: unknown[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin.from('profiles')
        .select('id, username, display_name, display_name_last_changed, player_color, custom_themes, username_chosen')
        .order('id').range(from, from + PAGE - 1)
      if (error) throw error
      profiles.push(...(data ?? []))
      if (!data || data.length < PAGE) break
    }
    return json({ profiles })
  } catch (error) {
    console.error('[export-profiles]', error)
    return json({ error: (error as Error)?.message ?? 'Something went wrong.' }, 500)
  }
})
