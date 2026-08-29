// Supabase's own auth errors, said in the app's voice.
//
// Most of what Supabase returns is fine to show as-is. One is not: when a
// password fails the project's complexity policy, the message enumerates the
// alphabet --
//
//   Password should contain at least one character of each:
//   abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789.
//
// -- which is precise, unreadable, and in English no matter what language the
// rest of the screen is in. It is generated server-side from the policy, so it
// cannot be changed in the dashboard; the only place to fix it is here.
//
// Matching is on the stable prefix rather than the whole string, because the
// character classes listed vary with the policy: turning on symbols appends a
// fourth set. If the policy gains symbols, add the key for it here and say so
// in auth.passwordHint too -- the hint and the error have to agree.

import { t } from './i18n'
import type { TranslationKey } from '../locales/en'

const MAPPED: Array<{ match: RegExp; key: TranslationKey }> = [
  { match: /^Password should contain at least one character of each/i, key: 'auth.errPasswordComplexity' },
  { match: /^Password should be at least/i, key: 'auth.errPasswordShort' },
]

/**
 * The message to show for an auth failure.
 *
 * Anything unrecognised is passed through untouched: a message written for a
 * case nobody anticipated is still better than a generic one that hides it.
 */
export function friendlyAuthError(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message !== 'string' || message.length === 0) return fallback
  for (const { match, key } of MAPPED) {
    if (match.test(message)) return t(key)
  }
  return message
}
