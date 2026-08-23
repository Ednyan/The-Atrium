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
import { createAdminClient, createAnonClient, getAuthenticatedUser } from '../_shared/supabaseAdmin.ts'

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

    // The password is checked here rather than in the browser.
    //
    // A valid session JWT is all this endpoint used to require, so the
    // password prompt in Profile Settings was a gate in front of the door
    // rather than a lock in it: anyone holding the session -- someone at an
    // unlocked machine, say -- could skip the panel and call this directly.
    // Deletion is the one irreversible action in the app, so the proof has to
    // live inside the trust boundary, where no request can be shaped to
    // avoid it.
    //
    // This is not a brute-force surface worth rate-limiting on its own: you
    // need a valid session for the account before you get here, and guessing
    // the password of an account you are already signed into buys nothing.
    // (Supabase throttles repeated sign-in attempts regardless.)
    //
    // Accounts created through Google have no password to check -- requiring
    // one would lock them out of deleting their own account forever -- so the
    // check applies exactly when there is an email/password identity to check
    // against. That is read from the server's own copy of the user, never
    // from anything the caller sent.
    // Read two ways round, and default to asking.
    //
    // `(user.identities ?? []).some(p => p === 'email')` on its own decides
    // "no password required" from an absent list just as readily as from a
    // Google-only one -- so anything that left identities unpopulated would
    // turn this whole check off and report success while doing it. A control
    // whose failure mode is "silently stop checking" is not one worth having.
    //
    // So: skip the password only when the account positively says it has no
    // email identity. If both sources are silent we cannot tell, and the
    // wrong guess in that direction is unrecoverable, so we ask. The cost of
    // being wrong the other way is a Google user seeing "that is not your
    // password" and having to write in -- annoying, and reversible.
    const identities = user.identities ?? []
    const metaProviders: string[] = Array.isArray(user.app_metadata?.providers)
      ? user.app_metadata.providers
      : user.app_metadata?.provider
        ? [user.app_metadata.provider]
        : []

    const providersKnown = identities.length > 0 || metaProviders.length > 0
    const hasEmailIdentity =
      identities.some((identity: { provider: string }) => identity.provider === 'email') ||
      metaProviders.includes('email')

    const hasPassword = !providersKnown || hasEmailIdentity

    if (hasPassword) {
      let password = ''
      try {
        const body = await req.json()
        password = typeof body?.password === 'string' ? body.password : ''
      } catch {
        // No body, or not JSON. Treated as no password supplied.
      }

      if (!password) {
        return new Response(JSON.stringify({ error: 'password_required' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Signing in is the only way to verify a password: there is no
      // "check this password" API, and the service-role key deliberately
      // cannot do it -- it bypasses authentication rather than performing
      // it. The anon client is thrown away with the request, and the
      // password is never logged.
      const anon = createAnonClient()
      const { error: reauthError } = await anon.auth.signInWithPassword({
        email: user.email!,
        password,
      })
      if (reauthError) {
        return new Response(JSON.stringify({ error: 'invalid_password' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // Drop the session that check just minted, so a refresh token for this
      // account cannot outlive a delete that fails further down.
      //
      // Guarded, because this is tidying rather than the job: unguarded it
      // sits in the same try as the deletion, so a hiccup signing a session
      // out would throw to the 500 below and the account the caller just
      // proved they own would not be deleted. The token it is disposing of
      // belongs to an account that is about to stop existing anyway.
      try {
        await anon.auth.signOut()
      } catch (signOutError) {
        console.error('[delete-account] could not discard the re-auth session:', signOutError)
      }
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
