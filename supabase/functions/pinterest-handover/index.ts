// Pinterest connections handed over to the Atrium's worker (phase 10, step 6;
// workers/rooms/src/pinterest.ts), which keeps them from then on: an existing
// account's (asked with its own sign-in), or a desktop app's link (asked with
// its link token). Tokens leave here for the worker alone -- it shows the
// worker's key, which Supabase checks as account_for_email does, against the
// hash it keeps (add_account_for_email.sql): asked of the operator's own
// address, the answer is theirs only if the key is right. Handed over, a
// connection is gone from here, so only one place renews it.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts'
import { sha256Hex } from '../_shared/desktopLink.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  try {
    const admin = createAdminClient()

    // The worker's key, or nothing at all.
    const key = req.headers.get('x-worker-key') ?? ''
    const { data: operators } = await admin.from('platform_admins').select('user_id').limit(1)
    const operatorId = operators?.[0]?.user_id
    const { data: operator } = operatorId ? await admin.auth.admin.getUserById(operatorId) : { data: { user: null } }
    const { data: vouched } = key && operator?.user?.email
      ? await admin.rpc('account_for_email', { p_email: operator.user.email, p_key: key })
      : { data: null }
    if (!vouched || vouched !== operatorId) return json({ error: 'Not allowed' }, 403)

    const { link } = await req.json().catch(() => ({}))
    const tokens = (row: Record<string, any> | null) => row && {
      access_token: row.access_token, refresh_token: row.refresh_token ?? null, token_expires_at: row.token_expires_at ?? null, pinterest_username: row.pinterest_username ?? null,
    }

    // A desktop app's link: its connection, the account's or its own.
    if (typeof link === 'string' && link) {
      const tokenHash = await sha256Hex(link)
      const { data: linked } = await admin.from('pinterest_desktop_links').select('user_id, standalone_id').eq('token_hash', tokenHash).maybeSingle()
      if (!linked) return json({ none: true })
      const table = linked.standalone_id ? 'pinterest_standalone_connections' : 'pinterest_connections'
      const { data: row } = await admin.from(table).select('*').eq(linked.standalone_id ? 'id' : 'user_id', linked.standalone_id ?? linked.user_id).maybeSingle()
      await admin.from('pinterest_desktop_links').delete().eq('token_hash', tokenHash)
      if (linked.standalone_id) await admin.from('pinterest_standalone_connections').delete().eq('id', linked.standalone_id)
      return json(tokens(row) ?? { none: true })
    }

    // An existing account's own.
    const user = await getAuthenticatedUser(req, admin)
    if (!user) return json({ error: 'Not signed in' }, 401)
    const { data: row } = await admin.from('pinterest_connections').select('*').eq('user_id', user.id).maybeSingle()
    if (!row) return json({ none: true })
    await admin.from('pinterest_connections').delete().eq('user_id', user.id)
    return json(tokens(row))
  } catch (error) {
    console.error('[pinterest-handover]', error)
    return json({ error: (error as Error)?.message ?? 'Something went wrong.' }, 500)
  }
})
