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

// A client with no more rights than the browser has. Used where a function
// needs to act *as the user* rather than over them -- verifying a password by
// signing in with it, for one, which the service-role key cannot do because
// it bypasses authentication rather than performing it.
//
// SUPABASE_ANON_KEY is auto-injected alongside the other two.
export function createAnonClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Verifies the caller's Supabase session JWT (forwarded from the frontend's
// Authorization header) and returns the user, or null if missing/invalid.
//
// The whole user rather than the id, for callers that need the email to
// re-authenticate them or the identity list to know how they signed up.
export async function getAuthenticatedUser(req: Request, admin: SupabaseClient) {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return null

  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data.user) return null
  return data.user
}

// Verifies the caller's Supabase session JWT (forwarded from the frontend's
// Authorization header) and returns their user id, or null if missing/invalid.
export async function getAuthenticatedUserId(req: Request, admin: SupabaseClient): Promise<string | null> {
  const user = await getAuthenticatedUser(req, admin)
  return user?.id ?? null
}
