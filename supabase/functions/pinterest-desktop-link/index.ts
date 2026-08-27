// Pairs a desktop install with a web account's Pinterest connection.
//
// The desktop app has no Supabase account and cannot authenticate here, so it
// needs something to present instead. Rather than hand it Pinterest's tokens --
// which would put a refresh token on somebody's disk and mean writing refresh
// a second time -- it is given an opaque link token that means only "act as
// this user, for Pinterest reads". pinterest-api accepts it in place of a JWT
// and the Pinterest tokens never leave the server.
//
// Two steps, because a code a person retypes has to be short, and a short
// secret must not live long:
//
//   create  (authenticated) -> an 8-character code, good for ten minutes, once
//   redeem  (anonymous)     -> trades that code for the long link token
//
// Both are stored hashed. The plaintext exists only in the response that
// carries it and in whatever the user pastes.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'
import { resolveLinkedUserId, sha256Hex } from '../_shared/desktopLink.ts'

const PAIRING_TTL_MS = 10 * 60 * 1000

// No I, O, 1 or 0: this gets read off one screen and typed into another, and
// the pairs people confuse are not worth the two extra bits.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function randomCode(): string {
  // Rejection-free because the alphabet is exactly 32 long: five bits per
  // character, taken from bytes without the modulo bias a 26- or 36-character
  // alphabet would introduce.
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => CODE_ALPHABET[b & 31]).join('')
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
    // job. There is no cron here, and this is the only thing that ever reads
    // the table.
    await admin
      .from('pinterest_desktop_pairings')
      .delete()
      .lt('expires_at', new Date().toISOString())

    if (action === 'create') {
      const userId = await getAuthenticatedUserId(req, admin)
      if (!userId) return json({ error: 'Not authenticated' }, 401)

      // Refuse to pair an account with nothing to share. Otherwise the desktop
      // app accepts a code, reports success, and shows an empty board list --
      // failure arriving one screen later than the mistake.
      const { data: connection } = await admin
        .from('pinterest_connections')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle()
      if (!connection) return json({ error: 'Pinterest is not connected on this account.' }, 409)

      // One live pairing per user: asking for a new code should invalidate the
      // one on the screen you just walked away from.
      await admin.from('pinterest_desktop_pairings').delete().eq('user_id', userId)

      const plain = randomCode()
      const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString()
      const { error } = await admin.from('pinterest_desktop_pairings').insert({
        code_hash: await sha256Hex(plain),
        user_id: userId,
        expires_at: expiresAt,
      })
      if (error) {
        console.error('[pinterest-desktop-link] could not store pairing:', error)
        return json({ error: 'Could not create a pairing code.' }, 500)
      }

      return json({ code: plain, expiresAt, expiresInSeconds: PAIRING_TTL_MS / 1000 })
    }

    if (action === 'redeem') {
      // Deliberately unauthenticated: the desktop app has no account to
      // authenticate with, and the code is the credential.
      const normalised = normaliseCode(code)
      if (!normalised) return json({ error: 'That code is not the right shape.' }, 400)

      const { data: pairing } = await admin
        .from('pinterest_desktop_pairings')
        .select('user_id, expires_at')
        .eq('code_hash', await sha256Hex(normalised))
        .maybeSingle()

      // One message for "wrong" and for "too late". Telling an anonymous
      // caller which of the two it was tells them whether to keep guessing.
      if (!pairing || new Date(pairing.expires_at).getTime() < Date.now()) {
        return json({ error: 'That code is not valid any more. Generate a new one.' }, 404)
      }

      // Single use, and burned before the token is minted: a code that fails
      // to produce a token is still spent.
      await admin
        .from('pinterest_desktop_pairings')
        .delete()
        .eq('code_hash', await sha256Hex(normalised))

      const token = randomToken()
      const { error } = await admin.from('pinterest_desktop_links').insert({
        token_hash: await sha256Hex(token),
        user_id: pairing.user_id,
      })
      if (error) {
        console.error('[pinterest-desktop-link] could not store link:', error)
        return json({ error: 'Could not complete the link.' }, 500)
      }

      return json({ token })
    }

    if (action === 'status') {
      // Answered for a link token rather than a JWT, because this is the one
      // question the desktop app needs before it has anything else: am I still
      // linked, and to whose Pinterest? Revoking on the web makes this return
      // linked:false, which is how the desktop app finds out.
      const userId = await resolveLinkedUserId(req, admin)
      if (!userId) return json({ linked: false, connected: false, username: null })

      const { data: connection } = await admin
        .from('pinterest_connections')
        .select('pinterest_username')
        .eq('user_id', userId)
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
