// Exchanges a Pinterest OAuth authorization code for access/refresh tokens
// and stores them against the calling (Supabase-authenticated) user. The
// Client Secret lives only here (as a Supabase secret), never on the
// client -- see PINTEREST_SETUP.md for how to configure it.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'
import { PAIRING_TTL_MS, randomPairingCode, sha256Hex } from '../_shared/desktopLink.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const admin = createAdminClient()
    const { code, redirectUri, mode } = await req.json()

    // 'desktop' is deliberately unauthenticated. A desktop-only user has no
    // Atrium account, and Pinterest never required them to have one -- the
    // account was only ever involved because the connection table is keyed by
    // one. This mode stores the connection against nothing and hands back a
    // pairing code the desktop app trades for a link token.
    const desktopMode = mode === 'desktop'
    const userId = desktopMode ? null : await getAuthenticatedUserId(req, admin)
    if (!desktopMode && !userId) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!code || !redirectUri) {
      return new Response(JSON.stringify({ error: 'Missing code or redirectUri' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const clientId = Deno.env.get('PINTEREST_CLIENT_ID')
    const clientSecret = Deno.env.get('PINTEREST_CLIENT_SECRET')
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Pinterest app not configured on the server' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Pinterest's v5 token endpoint authenticates the app via HTTP Basic
    // auth (client_id:client_secret), not body-embedded credentials.
    const basicAuth = btoa(`${clientId}:${clientSecret}`)
    const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    })

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text()
      console.error('[pinterest-oauth-exchange] token exchange failed:', tokenRes.status, errBody)
      return new Response(JSON.stringify({ error: 'Pinterest rejected the authorization code' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const tokenData = await tokenRes.json()
    const { access_token, refresh_token, expires_in } = tokenData

    // Fetch the connected Pinterest account's username for display purposes.
    let pinterestUsername: string | null = null
    try {
      const accountRes = await fetch('https://api.pinterest.com/v5/user_account', {
        headers: { 'Authorization': `Bearer ${access_token}` },
      })
      if (accountRes.ok) {
        const account = await accountRes.json()
        pinterestUsername = account.username ?? null
      }
    } catch (err) {
      console.error('[pinterest-oauth-exchange] failed to fetch account info:', err)
      // Non-fatal -- the connection still works without a display name.
    }

    const expiresAt = new Date(Date.now() + expires_in * 1000).toISOString()

    if (desktopMode) {
      const { data: standalone, error: standaloneError } = await admin
        .from('pinterest_standalone_connections')
        .insert({
          access_token,
          refresh_token: refresh_token ?? null,
          token_expires_at: expiresAt,
          pinterest_username: pinterestUsername,
        })
        .select('id')
        .single()

      if (standaloneError || !standalone) {
        console.error('[pinterest-oauth-exchange] failed to store connection:', standaloneError)
        return new Response(JSON.stringify({ error: 'Failed to save connection' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Minted here rather than by pinterest-desktop-link, because this is the
      // moment the connection exists and there is nobody authenticated to ask
      // for a code afterwards.
      const plain = randomPairingCode()
      const { error: pairingError } = await admin.from('pinterest_desktop_pairings').insert({
        code_hash: await sha256Hex(plain),
        standalone_id: standalone.id,
        expires_at: new Date(Date.now() + PAIRING_TTL_MS).toISOString(),
      })

      if (pairingError) {
        console.error('[pinterest-oauth-exchange] failed to create pairing:', pairingError)
        return new Response(JSON.stringify({ error: 'Failed to prepare the code' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(
        JSON.stringify({ success: true, username: pinterestUsername, code: plain }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const { error: upsertError } = await admin.from('pinterest_connections').upsert({
      user_id: userId,
      access_token,
      refresh_token: refresh_token ?? null,
      token_expires_at: expiresAt,
      pinterest_username: pinterestUsername,
      connected_at: new Date().toISOString(),
    })

    if (upsertError) {
      console.error('[pinterest-oauth-exchange] failed to store connection:', upsertError)
      return new Response(JSON.stringify({ error: 'Failed to save connection' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, username: pinterestUsername }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[pinterest-oauth-exchange] unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
