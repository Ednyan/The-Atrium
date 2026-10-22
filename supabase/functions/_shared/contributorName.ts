// The name a contributor asks to be listed under, and what it may not be.
//
// No imports, like currencies.ts beside it, because both sides read it: the
// page as it's typed (src/lib/donate.ts), so a refused name is refused before
// paying, and the worker (workers/rooms/src/contributions.ts), which is what
// enforces it -- at Checkout, and when an operator writes one by hand.
//
// The automatic half of the check, the obvious cases; a person looks at
// every name before it's shown.

export const MAX_NAME_LENGTH = 40

const BANNED = /\b(fuck|shit|cunt|nigg|f[a4]g|rape|nazi|hitler)/i
const URL_LIKE = /(https?:\/\/|www\.|\.(com|net|org|io|xyz)\b)/i
// Control characters, and the bidi overrides that let text be drawn in an
// order it wasn't written in. By code point: the escapes for these are what
// gets mangled in transit.
const unrenderable = (value: string) =>
  Array.from(value).some(character => {
    const code = character.codePointAt(0) ?? 0
    return code < 0x20 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
  })

export type NameProblem = 'length' | 'banned' | 'url' | 'unrenderable'

/** What's wrong with a name, or null. No name at all is a valid choice. */
export function nameProblem(name: string): NameProblem | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > MAX_NAME_LENGTH) return 'length'
  if (BANNED.test(trimmed)) return 'banned'
  if (URL_LIKE.test(trimmed)) return 'url'
  if (unrenderable(trimmed)) return 'unrenderable'
  return null
}
