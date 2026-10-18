// Who's signed in (docs/DECENTRALIZING.md, phase 6): an existing account, by
// its Supabase sign-in, or a Google account -- one with no Supabase account
// at all, signed in through the Atrium's worker (lib/drive), its grant the
// lasting sign-in and the worker's session what it's known by.

import { cloudClient } from './supabase'

export interface GoogleAccount { id: string; email: string | null; name: string | null }
const ACCOUNT = 'atrium.account'
/** Fired on window as a Google account signs in or out -- with why it was
 *  signed out, when that's to be said (detail.reason). */
export const ACCOUNT_EVENT = 'atrium:account'
// Why a Google account was signed out, to be said: its Google is an existing
// account's (the one to sign in to), or it's banned.
export type SignedOutReason = 'existingAccount' | 'banned'

export function googleAccount(): GoogleAccount | null {
  try {
    const kept = JSON.parse(localStorage.getItem(ACCOUNT) ?? 'null') as GoogleAccount | null
    return kept && typeof kept.id === 'string' ? kept : null
  } catch {
    return null
  }
}
export function keepGoogleAccount(account: GoogleAccount | null, reason?: SignedOutReason): void {
  const was = googleAccount()?.id ?? null
  try {
    if (account) localStorage.setItem(ACCOUNT, JSON.stringify(account))
    else localStorage.removeItem(ACCOUNT)
  } catch { /* this visit only */ }
  // Said only when who's signed in changes (or why they were signed out):
  // the same account kept again -- its Drive connected, say -- isn't a
  // sign-in, and the app mustn't take it for one (App moves to /welcome).
  if ((account?.id ?? null) !== was || reason) window.dispatchEvent(new CustomEvent(ACCOUNT_EVENT, { detail: { reason } }))
}

/** Who's signed in, and the token the worker knows them by -- the
 *  directory, the rooms. Null when no one is (or a Google account's
 *  sign-in has been taken back). */
export async function whoIsSignedIn(): Promise<{ id: string; token: string } | null> {
  const google = googleAccount()
  if (google) {
    const token = await (await import('./drive')).workerSession()
    return token ? { id: google.id, token } : null
  }
  const session = (await cloudClient?.auth.getSession())?.data.session
  return session ? { id: session.user.id, token: session.access_token } : null
}
export const accountToken = async () => (await whoIsSignedIn())?.token ?? null

// Asked "who's signed in" -- the app asks Supabase's auth everywhere -- a
// Google account answers for itself. Only getUser: getSession is what
// Supabase's own requests are signed with, and a Google account has none.
if (cloudClient?.auth) {
  const asked = cloudClient.auth.getUser.bind(cloudClient.auth)
  cloudClient.auth.getUser = async (...args: unknown[]) => {
    const google = googleAccount()
    if (!google) return asked(...args)
    return { data: { user: { id: google.id, email: google.email ?? undefined, app_metadata: {}, user_metadata: { name: google.name } } }, error: null }
  }
}
