import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into every
// deployed Edge Function's environment by Supabase -- nothing to configure
// manually for these two. The service-role key bypasses RLS entirely, which
// is required here since pinterest_connections denies all direct client
// access (see add_pinterest_integration.sql).
export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Verifies the caller's Supabase session JWT (forwarded from the frontend's
// Authorization header) and returns their user id, or null if missing/invalid.
export async function getAuthenticatedUserId(req: Request, admin: SupabaseClient): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return null

  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data.user) return null
  return data.user.id
}
