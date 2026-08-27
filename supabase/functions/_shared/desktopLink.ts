// How the desktop app says who it is.
//
// It has no Supabase account and so no JWT. Instead it presents a link token
// issued by pinterest-desktop-link, which stands for "act as this user, for
// Pinterest reads" and nothing else. Stored hashed, so a database backup
// yields nothing that can be replayed.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const LINK_TOKEN_HEADER = 'x-atrium-link-token'

// No I, O, 1 or 0: this is read off one screen and typed into another, and the
// pairs people confuse are not worth the two extra bits.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 8
export const PAIRING_TTL_MS = 10 * 60 * 1000

export function randomPairingCode(): string {
  // Rejection-free because the alphabet is exactly 32 long: five bits per
  // character, without the modulo bias a 26- or 36-character one would bring.
  const bytes = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => CODE_ALPHABET[b & 31]).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// Which connection a link token stands for.
//
// Two kinds, because a desktop install can either borrow a web account's
// connection or own one outright -- see add_pinterest_standalone_link.sql. A
// row carries exactly one of the two, enforced by a CHECK constraint, so this
// never has to decide between them.
export type ConnectionRef =
  | { kind: 'user'; userId: string }
  | { kind: 'standalone'; standaloneId: string }

// Where a connection of each kind actually lives.
export function connectionTable(ref: ConnectionRef): { table: string; column: string; value: string } {
  return ref.kind === 'user'
    ? { table: 'pinterest_connections', column: 'user_id', value: ref.userId }
    : { table: 'pinterest_standalone_connections', column: 'id', value: ref.standaloneId }
}

// The connection a link token stands for, or null. Returns null for a missing
// header too, so a caller can fall through to ordinary JWT authentication.
export async function resolveLinkedConnection(
  req: Request,
  admin: SupabaseClient,
): Promise<ConnectionRef | null> {
  const token = req.headers.get(LINK_TOKEN_HEADER)
  if (!token) return null

  const tokenHash = await sha256Hex(token)
  const { data } = await admin
    .from('pinterest_desktop_links')
    .select('user_id, standalone_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (!data) return null

  // Not awaited: this is for the owner's benefit when reviewing what is
  // linked, and a slow write here should not slow down a board list.
  void admin
    .from('pinterest_desktop_links')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', tokenHash)

  return data.standalone_id
    ? { kind: 'standalone', standaloneId: data.standalone_id }
    : { kind: 'user', userId: data.user_id }
}
