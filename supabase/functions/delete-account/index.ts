// Deletes the calling user's account and everything that identifies them.
//
// traces/layers.user_id are plain text columns with no foreign key (see
// add_account_deletion_support.sql), so nothing would otherwise touch
// content the user created inside OTHER people's shared atriums. Per
// product decision, that content should survive for the atrium's owner/
// collaborators, just no longer attributed to the deleted account -- so
// instead of deleting those rows, we anonymize user_id/username on them.
// Content in atriums the user OWNS doesn't need separate handling here: the
// lobbies.owner_user_id -> traces/layers ON DELETE CASCADE below wipes it
// (and the anonymized rows within it) regardless.
//
// admin_user_ids (a plain uuid[] on lobbies) is cleaned up explicitly via
// the service-role-only remove_user_from_all_admin_lists() RPC, since array
// membership can't be expressed as a foreign key.
//
// Everything else (owned lobbies + their traces/layers/access-lists,
// lobby_access_lists.user_id rows, lobby_sessions, pinterest_connections,
// and the profile row itself) cascades automatically once
// admin.auth.admin.deleteUser() runs, per the FK fixes in
// add_account_deletion_support.sql.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'

// Not a real user id (real ones are UUIDs) -- just a stable marker so
// anonymized content can still be told apart from a live account if ever
// needed, without pointing back at the person who made it.
const ANONYMIZED_USER_ID = 'deleted-user'
const ANONYMIZED_USERNAME = 'Deleted User'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const admin = createAdminClient()
    const userId = await getAuthenticatedUserId(req, admin)
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const anonymize = { user_id: ANONYMIZED_USER_ID, username: ANONYMIZED_USERNAME }

    const { error: tracesError } = await admin.from('traces').update(anonymize).eq('user_id', userId)
    if (tracesError) {
      console.error('[delete-account] failed to anonymize traces:', tracesError)
    }

    const { error: layersError } = await admin.from('layers').update(anonymize).eq('user_id', userId)
    if (layersError) {
      console.error('[delete-account] failed to anonymize layers:', layersError)
    }

    const { error: adminStripError } = await admin.rpc('remove_user_from_all_admin_lists', { p_user_id: userId })
    if (adminStripError) {
      console.error('[delete-account] failed to strip admin lists:', adminStripError)
    }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId)
    if (authDeleteError) {
      console.error('[delete-account] failed to delete auth user:', authDeleteError)
      return new Response(JSON.stringify({ error: 'Failed to delete account' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[delete-account] unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
