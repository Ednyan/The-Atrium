// The deletion code, generated in one function and checked in another.
//
// Both live here so they cannot drift: a hash written one way and read another
// fails closed, which looks exactly like "the code is wrong" and would be
// miserable to diagnose from the outside.

export const CODE_TTL_MINUTES = 10
export const MAX_ATTEMPTS = 5
// A new code cannot be asked for more often than this. Without it, anybody
// holding a session could use the endpoint to post mail to the account owner
// repeatedly.
export const RESEND_COOLDOWN_SECONDS = 60

// Six digits, drawn from the platform CSPRNG rather than Math.random -- which
// is seeded predictably and would make the code guessable in bulk.
//
// The loop is rejection sampling, not superstition. 2^32 is not a multiple of
// a million, so a bare `% 1_000_000` would make the lowest 967,296 codes very
// slightly likelier than the rest. Discarding the short tail costs one extra
// draw about once in fifty thousand and removes the bias entirely.
export function generateCode(): string {
  const buffer = new Uint32Array(1)
  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]
  } while (value >= 4_294_000_000)
  return String(value % 1_000_000).padStart(6, '0')
}

// Salted with the user id, so the same six digits issued to two people do not
// produce the same hash, and a stolen hash cannot be replayed against another
// account.
export async function hashCode(userId: string, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}:${code}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

// Compared in constant time. The attempt counter is the real defence here, so
// this is closer to hygiene than necessity -- but a comparison that returns
// early on the first differing character leaks where it differed, and writing
// the careful version costs three lines.
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return difference === 0
}
