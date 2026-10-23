// Who's signed in (docs/DECENTRALIZING.md, phases 6 and 10): an existing
// account, by its Supabase sign-in, or an account the Atrium's worker holds,
// with no Supabase account at all -- a Google account (lib/drive), its grant
// the lasting sign-in, or an email account (lib/emailAccount), a renewal
// token -- the worker's session what either is known by.

import { cloudClient } from './supabase'

// `kind`: an email account's says so; a Google account's, kept before there
// were others, doesn't. An existing account's ('supabase') is only ever the
// desktop app's, signed in by the site (lib/emailAccount, linkDesktop).
export interface WorkerAccount { id: string; email: string | null; name: string | null; kind?: 'google' | 'email' | 'supabase' }
export type GoogleAccount = WorkerAccount
const ACCOUNT = 'atrium.account'
/** Fired on window as an account the worker holds signs in or out -- with
 *  why it was signed out, when that's to be said (detail.reason). */
export const ACCOUNT_EVENT = 'atrium:account'
// Why a Google account was signed out, to be said: its Google is an existing
// account's (the one to sign in to), or it's banned.
export type SignedOutReason = 'existingAccount' | 'banned'

/** The account the worker holds that's signed in here, of either kind. */
export function workerAccount(): WorkerAccount | null {
  try {
    const kept = JSON.parse(localStorage.getItem(ACCOUNT) ?? 'null') as WorkerAccount | null
    return kept && typeof kept.id === 'string' ? kept : null
  } catch {
    return null
  }
}
/** A Google account, signed in here: its Google is its sign-in. */
export function googleAccount(): GoogleAccount | null {
  const account = workerAccount()
  return account && (account.kind ?? 'google') === 'google' ? account : null
}
export function keepAccount(account: WorkerAccount | null, reason?: SignedOutReason): void {
  const was = workerAccount()?.id ?? null
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
 *  directory, the rooms. Null when no one is (or the sign-in of an account
 *  the worker holds has been taken back). */
export async function whoIsSignedIn(): Promise<{ id: string; token: string } | null> {
  const account = workerAccount()
  if (account) {
    // A Google account renews by its grant; any other, by its renewal token.
    const token = googleAccount()
      ? await (await import('./drive')).workerSession()
      : await (await import('./emailAccount')).emailSession()
    return token ? { id: account.id, token } : null
  }
  const session = (await cloudClient?.auth.getSession())?.data.session
  return session ? { id: session.user.id, token: session.access_token } : null
}
export const accountToken = async () => (await whoIsSignedIn())?.token ?? null

/** Out, whichever kind of account the worker holds is signed in here. */
export async function signOutWorkerAccount(): Promise<void> {
  const account = workerAccount()
  if (!account) return
  if (googleAccount()) (await import('./drive')).signOutGoogle()
  else (await import('./emailAccount')).signOutEmail()
}

// Asked "who's signed in" -- the app asks Supabase's auth everywhere -- an
// account the worker holds answers for itself. Only getUser: getSession is
// what Supabase's own requests are signed with, and such an account has none.
if (cloudClient?.auth) {
  const asked = cloudClient.auth.getUser.bind(cloudClient.auth)
  cloudClient.auth.getUser = async (...args: unknown[]) => {
    const account = workerAccount()
    if (!account) return asked(...args)
    return { data: { user: { id: account.id, email: account.email ?? undefined, app_metadata: {}, user_metadata: { name: account.name } } }, error: null }
  }
}
