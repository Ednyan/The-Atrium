// Deletes the calling user's account and everything that identifies them.
//
// Requires a confirmation code, emailed by request-deletion-code and checked
// below. See add_account_deletion_codes.sql for why that replaced the password
// check for every account rather than only for the Google ones that had none.
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
import { createAdminClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts'
import { MAX_ATTEMPTS, hashCode, hashesMatch } from '../_shared/deletionCode.ts'

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
    const user = await getAuthenticatedUser(req, admin)
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userId = user.id

    // The confirmation code is checked here rather than in the browser.
    //
    // A valid session JWT is all this endpoint used to require, so a prompt in
    // Profile Settings was a gate in front of the door rather than a lock in
    // it: anyone holding the session -- someone at an unlocked machine, say --
    // could skip the panel and call this directly. Deletion is the one
    // irreversible action in the app, so the proof has to live inside the
    // trust boundary, where no request can be shaped to avoid it.
    //
    // This used to be the account password. That was sound and covered half
    // the accounts: Google accounts have none, so they had no second proof at
    // all -- anyone at an unlocked machine could delete one outright. Now
    // everybody proves the same thing, control of the mailbox, and there is one
    // path to keep correct instead of two. It is not weaker for accounts that
    // do have a password, either: anybody holding the mailbox could already
    // reset that password and take the account.
    let code = ''
    try {
      const body = await req.json()
      code = typeof body?.code === 'string' ? body.code.trim() : ''
    } catch {
      // No body, or not JSON. Treated as no code supplied.
    }

    const { data: pending } = code
      ? await admin
          .from('account_deletion_codes')
          .select('code_hash, expires_at, attempts')
          .eq('user_id', userId)
          .maybeSingle()
      : { data: null }

    if (!code || !pending) {
      return new Response(JSON.stringify({ error: 'code_required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Expired and exhausted are reported the same way, because the answer is
    // the same -- ask for a new one -- and because distinguishing them would
    // tell somebody grinding codes which wall they hit.
    const expired = new Date(pending.expires_at).getTime() < Date.now()
    if (expired || pending.attempts >= MAX_ATTEMPTS) {
      await admin.from('account_deletion_codes').delete().eq('user_id', userId)
      return new Response(JSON.stringify({ error: 'code_expired' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!hashesMatch(await hashCode(userId, code), pending.code_hash)) {
      // Counted, not just refused. Six digits is a million guesses, which is
      // nothing to a script already holding the session; the count is what
      // makes that a dead end. Getting a fresh code costs an email to the
      // account's owner, so grinding this is never quiet.
      await admin
        .from('account_deletion_codes')
        .update({ attempts: pending.attempts + 1 })
        .eq('user_id', userId)
      return new Response(JSON.stringify({ error: 'invalid_code' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Spent the moment it is accepted, so it cannot be replayed if something
    // below fails and the caller tries again.
    await admin.from('account_deletion_codes').delete().eq('user_id', userId)

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
