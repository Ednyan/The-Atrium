// Turns the code a desktop install was shown into a token it can use.
//
// The desktop app has no Supabase account and cannot authenticate here, so it
// needs something to present instead. Rather than hand it Pinterest's tokens --
// which would put a refresh token on somebody's disk and mean writing refresh
// a second time -- it is given an opaque link token that stands for "read these
// Pinterest boards" and nothing else. pinterest-api accepts it in place of a
// JWT, and the Pinterest tokens never leave the server.
//
// The code itself is minted by pinterest-oauth-exchange, at the moment the
// connection is made, on a page that requires no account. There used to be a
// second way in -- a signed-in web user could mint a code from their own
// connection -- which was two routes to the same place and one more thing to
// keep working. The account-free one covers it.
//
// Codes and tokens are stored hashed. The plaintext exists only in the response
// that carries it and in whatever the user types.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { CODE_LENGTH, PAIRING_TTL_MS, connectionTable, randomPairingCode, resolveLinkedConnection, sha256Hex } from '../_shared/desktopLink.ts'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Typed by hand, so accept what a person plausibly types: any case, and any
// spacing or dashes they add to keep their place.
function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return cleaned.length === CODE_LENGTH ? cleaned : null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const admin = createAdminClient()
    const { action, code } = await req.json()

    // Expired pairings are cleared on the way past rather than by a scheduled
    // job. There is no cron here, and nothing else reads the table.
    await admin
      .from('pinterest_desktop_pairings')
      .delete()
      .lt('expires_at', new Date().toISOString())

    if (action === 'redeem') {
      // Deliberately unauthenticated: the desktop app has no account to
      // authenticate with, and the code is the credential.
      const normalised = normaliseCode(code)
      if (!normalised) return json({ error: 'That code is not the right shape.' }, 400)

      const { data: pairing } = await admin
        .from('pinterest_desktop_pairings')
        .select('user_id, standalone_id, expires_at')
        .eq('code_hash', await sha256Hex(normalised))
        .maybeSingle()

      // One message for "wrong" and for "too late". Telling an anonymous
      // caller which of the two it was tells them whether to keep guessing.
      if (!pairing || new Date(pairing.expires_at).getTime() < Date.now()) {
        return json({ error: 'That code is not valid any more. Generate a new one.' }, 404)
      }

      // The link is created BEFORE the code is burned, which is the opposite
      // of what it looks like it should be.
      //
      // Deleting the pairing first fires the prune trigger, which removes a
      // standalone connection the moment nothing references it -- and between
      // the delete and the insert, nothing does. It deleted the connection
      // that had just been made, and the insert then failed its foreign key:
      // "Could not complete the link", from a function that had done
      // everything right except the order.
      //
      // Creating the link first means the trigger always finds a reference and
      // leaves the connection alone. The cost is that a code whose burn fails
      // could be redeemed twice; it expires in ten minutes either way, which
      // is a far smaller problem than destroying the connection.
      const token = randomToken()
      const { error } = await admin.from('pinterest_desktop_links').insert({
        token_hash: await sha256Hex(token),
        // Carries whichever owner the pairing had. The CHECK constraint
        // refuses anything claiming both or neither.
        user_id: pairing.standalone_id ? null : pairing.user_id,
        standalone_id: pairing.standalone_id ?? null,
      })
      if (error) {
        console.error('[pinterest-desktop-link] could not store link:', error)
        return json({ error: 'Could not complete the link.' }, 500)
      }

      // Single use.
      await admin
        .from('pinterest_desktop_pairings')
        .delete()
        .eq('code_hash', await sha256Hex(normalised))

      return json({ token })
    }

    if (action === 'status') {
      // Answered for a link token rather than a JWT, because this is the one
      // question the desktop app needs before it has anything else: am I still
      // linked, and to whose Pinterest? Revoking on the web makes this return
      // linked:false, which is how the desktop app finds out.
      const ref = await resolveLinkedConnection(req, admin)
      if (!ref) return json({ linked: false, connected: false, username: null })

      const source = connectionTable(ref)
      const { data: connection } = await admin
        .from(source.table)
        .select('pinterest_username')
        .eq(source.column, source.value)
        .maybeSingle()

      return json({
        linked: true,
        connected: !!connection,
        username: connection?.pinterest_username ?? null,
      })
    }

    if (action === 'unlink') {
      // Lets the desktop app hand its own token back, so "Disconnect" there
      // actually severs the link rather than only forgetting it locally.
      const token = req.headers.get('x-atrium-link-token')
      if (token) {
        await admin
          .from('pinterest_desktop_links')
          .delete()
          .eq('token_hash', await sha256Hex(token))
      }
      return json({ ok: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('[pinterest-desktop-link] unexpected error:', err)
    return json({ error: 'Unexpected server error' }, 500)
  }
})
