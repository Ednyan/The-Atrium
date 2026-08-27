// Proxies read-only Pinterest v5 API calls (boards, pins) on behalf of the
// calling Supabase-authenticated user. Exists because Pinterest's API
// doesn't allow direct browser calls (CORS) and the stored access/refresh
// tokens must never reach the client -- see add_pinterest_integration.sql.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'
import { ConnectionRef, connectionTable, resolveLinkedConnection } from '../_shared/desktopLink.ts'

const PINTEREST_API_BASE = 'https://api.pinterest.com/v5'
// Refresh a bit before actual expiry so a request never races an
// almost-expired token.
const REFRESH_BUFFER_MS = 60_000

async function refreshAccessToken(admin: any, ref: ConnectionRef, refreshToken: string): Promise<string> {
  const clientId = Deno.env.get('PINTEREST_CLIENT_ID')!
  const clientSecret = Deno.env.get('PINTEREST_CLIENT_SECRET')!
  const basicAuth = btoa(`${clientId}:${clientSecret}`)

  const res = await fetch(`${PINTEREST_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Pinterest token refresh failed: ${res.status} ${body}`)
  }

  const data = await res.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  const target = connectionTable(ref)
  await admin.from(target.table).update({
    access_token: data.access_token,
    // Pinterest may or may not rotate the refresh token on refresh; keep the
    // old one if a new one isn't returned.
    refresh_token: data.refresh_token ?? refreshToken,
    token_expires_at: expiresAt,
  }).eq(target.column, target.value)

  return data.access_token
}

async function getValidAccessToken(admin: any, ref: ConnectionRef): Promise<string | null> {
  const source = connectionTable(ref)
  const { data, error } = await admin
    .from(source.table)
    .select('access_token, refresh_token, token_expires_at')
    .eq(source.column, source.value)
    .maybeSingle()

  if (error || !data) return null

  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0
  const isExpiring = expiresAt - Date.now() < REFRESH_BUFFER_MS

  if (isExpiring && data.refresh_token) {
    return await refreshAccessToken(admin, ref, data.refresh_token)
  }

  return data.access_token
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const admin = createAdminClient()
    // A linked desktop install first, then an ordinary signed-in web user.
    // The desktop app has no JWT to send; the token it sends instead resolves
    // to the same user id and reaches exactly the same code below, so there is
    // no second path through this function to keep in step.
    const linked = await resolveLinkedConnection(req, admin)
    const webUserId = linked ? null : await getAuthenticatedUserId(req, admin)
    const connection: ConnectionRef | null =
      linked ?? (webUserId ? { kind: 'user', userId: webUserId } : null)
    if (!connection) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accessToken = await getValidAccessToken(admin, connection)
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Pinterest not connected' }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { action, boardId, bookmark } = await req.json()

    let pinterestUrl: string
    if (action === 'boards') {
      pinterestUrl = `${PINTEREST_API_BASE}/boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`
    } else if (action === 'pins') {
      if (!boardId) {
        return new Response(JSON.stringify({ error: 'Missing boardId' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      pinterestUrl = `${PINTEREST_API_BASE}/boards/${encodeURIComponent(boardId)}/pins?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`
    } else {
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const pinterestRes = await fetch(pinterestUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    })

    if (!pinterestRes.ok) {
      const body = await pinterestRes.text()
      console.error('[pinterest-api] Pinterest request failed:', pinterestRes.status, body)
      return new Response(JSON.stringify({ error: 'Pinterest API request failed' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await pinterestRes.json()
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[pinterest-api] unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
