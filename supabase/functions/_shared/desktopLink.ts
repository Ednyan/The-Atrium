// How the desktop app says who it is.
//
// It has no Supabase account and so no JWT. Instead it presents a link token
// issued by pinterest-desktop-link, which stands for "act as this user, for
// Pinterest reads" and nothing else. Stored hashed, so a database backup
// yields nothing that can be replayed.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const LINK_TOKEN_HEADER = 'x-atrium-link-token'

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// The user a link token stands for, or null. Returns null for a missing
// header too, so a caller can fall through to ordinary JWT authentication.
export async function resolveLinkedUserId(
  req: Request,
  admin: SupabaseClient,
): Promise<string | null> {
  const token = req.headers.get(LINK_TOKEN_HEADER)
  if (!token) return null

  const tokenHash = await sha256Hex(token)
  const { data } = await admin
    .from('pinterest_desktop_links')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (!data) return null

  // Not awaited: this is for the owner's benefit when reviewing what is
  // linked, and a slow write here should not slow down a board list.
  void admin
    .from('pinterest_desktop_links')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)

  return data.user_id
}
