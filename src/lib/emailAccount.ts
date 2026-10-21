// Email accounts (docs/DECENTRALIZING.md, phase 10, step 4): the page's side
// of the worker's (workers/rooms/src/auth.ts). The password is stretched
// here -- PBKDF2 over the salt the worker gives, as many rounds as it says --
// and never sent; what's sent is the key that makes. The account is kept as a
// Google account is (lib/signedIn), with a renewal token that keeps it signed
// in, and an hour's session from it at a time.
//
// Existing accounts are Supabase's until the cutover: signed in there as
// ever, their credential copied to the worker as they do (adopt), so they
// sign in on the worker's word alone once Supabase is gone.

import { workerUrl } from './rooms'
import { keepAccount, workerAccount, type SignedOutReason } from './signedIn'
import { currentLanguage } from './i18n'

const REFRESH = 'atrium.refresh'
// This page's session, for the worker: an hour's, renewed a minute early.
let session: { value: string; until: number } | null = null
let renewing: Promise<string | null> | null = null

interface Shown { id: string; kind: string; email: string | null; username: string | null; name: string | null }
interface Answer {
  session?: string; until?: number; refresh?: string; account?: Shown
  verified?: boolean; error?: string; email?: string; ok?: boolean; deleted?: boolean
}

// A plain request (a string body, no headers of its own): no preflight.
async function ask(what: string, body: object): Promise<{ status: number; body: Answer }> {
  const response = await fetch(`${workerUrl()}/auth/${what}`, { method: 'POST', body: JSON.stringify(body) })
  return { status: response.status, body: await response.json().catch(() => ({})) }
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), ch => ch.charCodeAt(0))
const toBase64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))

/** The password stretched into a key: PBKDF2 with SHA-256, the salt and the
 *  rounds the worker gave -- the slow part, done here. */
async function stretch(password: string, salt: string, rounds: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  return toBase64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations: rounds }, material, 256))
}
async function saltOf(login: string): Promise<{ salt: string; rounds: number }> {
  const { status, body } = await ask('salt', { login })
  if (status !== 200 || typeof (body as { salt?: unknown }).salt !== 'string') throw new Error('AUTH_DOWN')
  return body as unknown as { salt: string; rounds: number }
}
/** The key for signing in with this address or username. */
export async function keyFor(login: string, password: string): Promise<string> {
  const { salt, rounds } = await saltOf(login)
  return stretch(password, salt, rounds)
}
/** Keys for both ways of signing in, and the salts they were made with. */
async function keysFor(email: string, username: string, password: string) {
  const [forEmail, forName] = await Promise.all([saltOf(email), saltOf(username)])
  const [emailKey, nameKey] = await Promise.all([stretch(password, forEmail.salt, forEmail.rounds), stretch(password, forName.salt, forName.rounds)])
  return { email_salt: forEmail.salt, name_salt: forName.salt, email_key: emailKey, name_key: nameKey }
}

// Signed in as an email account: its session, its renewal token, and the
// account itself kept (lib/signedIn says so to the app).
function signedIn(answer: Answer): Shown {
  if (answer.session && answer.until) session = { value: answer.session, until: answer.until }
  try { if (answer.refresh) localStorage.setItem(REFRESH, answer.refresh) } catch { /* this visit only */ }
  const account = answer.account!
  keepAccount({ id: account.id, email: account.email, name: account.name, kind: 'email' })
  return account
}

/** What went wrong, by name, for the page to say. */
const failed = (code: string, more: object = {}) => Object.assign(new Error(code), more)

/** The rule a new password is held to -- here, as the worker never sees one:
 *  six characters or more, a lowercase letter, an uppercase letter, a digit
 *  (what existing accounts' passwords were held to by Supabase). */
export const strongEnough = (password: string) =>
  password.length >= 6 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)

/** A new account: kept unconfirmed until its code comes back (confirm). */
export async function signUp(email: string, username: string, password: string): Promise<void> {
  if (!strongEnough(password)) throw failed('WEAK_PASSWORD')
  const { status, body } = await ask('signup', { email, username, ...(await keysFor(email, username, password)), language: currentLanguage() })
  if (status === 200) return
  // Taken: the username, the address by a Google account (signed in to with Google), or by another account.
  if (status === 409) throw failed(body.error === 'username' ? 'USERNAME_TAKEN' : body.error === 'google' ? 'EMAIL_GOOGLE' : 'EMAIL_TAKEN')
  if (status === 429) throw failed('TOO_MANY')
  throw failed(status === 503 ? 'CHECK' : 'SIGNUP_FAILED')
}

/** The code mailed to a new account's address: confirmed, and signed in. */
export async function confirmEmail(email: string, code: string): Promise<void> {
  const { status, body } = await ask('confirm', { email, code, language: currentLanguage() })
  if (status === 200) { signedIn(body); return }
  throw failed(status === 429 ? 'TOO_MANY_TRIES' : 'WRONG_CODE')
}

/** Another code: an address's confirmation, or a forgotten password's. */
export async function sendCode(email: string, purpose: 'confirm' | 'reset'): Promise<void> {
  const { status } = await ask('code', { email, purpose, language: currentLanguage() })
  if (status === 429) throw failed('TOO_MANY')
}

/** Signing in by the worker. An email account: signed in. An existing
 *  account it knows: right, and its address (Supabase signs it in, until
 *  the cutover). Anything else: not here -- an existing account Supabase
 *  alone knows yet, or a wrong password, which only Supabase can tell apart. */
export type SignIn = { kind: 'email' } | { kind: 'existing'; email: string } | { kind: 'unknown' }
export async function signIn(login: string, password: string): Promise<SignIn> {
  const { status, body } = await ask('signin', { login, key: await keyFor(login, password) })
  if (status === 200 && body.account?.kind === 'email' && body.session) { signedIn(body); return { kind: 'email' } }
  if (status === 200 && body.verified && body.account?.email) return { kind: 'existing', email: body.account.email }
  if (status === 403 && body.error === 'unconfirmed') throw failed('UNCONFIRMED', { email: body.email })
  if (status === 403 && body.error === 'banned') throw failed('BANNED')
  if (status === 429) throw failed('WAIT')
  return { kind: 'unknown' }
}

/** An existing account's credential copied to the worker, as it signs in to
 *  Supabase with its password (or changes it there): Supabase's token,
 *  minutes old, says whose. Quietly: the cutover is the only thing it's for,
 *  and the next sign-in tries again. */
export async function adopt(supabaseToken: string, email: string, username: string, password: string): Promise<void> {
  try {
    const { status } = await ask('adopt', { token: supabaseToken, ...(await keysFor(email, username, password)) })
    if (status !== 200) console.warn('[account] its credential not copied yet:', status)
  } catch (error) {
    console.warn('[account] its credential not copied yet:', error)
  }
}

/** A forgotten password: the code, and the new one -- signed in, then the
 *  username's key set too (the reset knew the address alone). */
export async function resetPassword(email: string, code: string, password: string): Promise<void> {
  if (!strongEnough(password)) throw failed('WEAK_PASSWORD')
  const emailKey = await keyFor(email, password)
  const { status, body } = await ask('reset', { email, code, email_key: emailKey })
  if (status !== 200) throw failed(status === 429 ? 'TOO_MANY_TRIES' : 'WRONG_CODE')
  const account = signedIn(body)
  if (account.username) await setKeys(emailKey, account.email ?? email, account.username, password)
}

/** A new password, with the one it replaces. Every other sign-in ends. */
export async function changePassword(current: string, next: string): Promise<void> {
  if (!strongEnough(next)) throw failed('WEAK_PASSWORD')
  const account = workerAccount()
  if (account?.kind !== 'email' || !account.email) throw failed('NOT_SIGNED_IN')
  const { username } = await me()
  await setKeys(await keyFor(account.email, current), account.email, username, next)
}
async function setKeys(currentKey: string, email: string, username: string, password: string): Promise<void> {
  const token = await emailSession()
  const keys = await keysFor(email, username, password)
  const { status, body } = await ask('password', { token, key: currentKey, email_key: keys.email_key, name_key: keys.name_key })
  if (status === 403) throw failed('WRONG_PASSWORD')
  if (status !== 200) throw failed('PASSWORD_FAILED')
  signedIn(body)
}
async function me(): Promise<{ username: string }> {
  const { myEntry } = await import('./people')
  const entry = await myEntry()
  if (!entry.username) throw failed('NOT_SIGNED_IN')
  return { username: entry.username }
}

/** The account deleted, with its password once more: everything of it at
 *  the worker gone, and this browser signed out. */
export async function deleteEmailAccount(password: string): Promise<void> {
  const account = workerAccount()
  if (account?.kind !== 'email' || !account.email) throw failed('NOT_SIGNED_IN')
  const { status } = await ask('delete', { token: await emailSession(), key: await keyFor(account.email, password), language: currentLanguage() })
  if (status === 403) throw failed('WRONG_PASSWORD')
  if (status !== 200) throw failed('DELETE_FAILED')
  forget()
}

/** An existing account deleted (Supabase's way): its credential at the worker goes too. */
export async function forgetCopy(supabaseToken: string): Promise<void> {
  await ask('forget', { token: supabaseToken }).catch(() => {})
}

/** This page's session for the worker -- renewed from the token kept here,
 *  once at a time, whoever asks. Null if it can't be. */
export async function emailSession(): Promise<string | null> {
  if (session && Date.now() < session.until - 60_000) return session.value
  return renewing ??= renew().finally(() => { renewing = null })
}
async function renew(): Promise<string | null> {
  let refresh: string | null = null
  try { refresh = localStorage.getItem(REFRESH) } catch { /* none */ }
  if (!refresh) return null
  const answer = await ask('renew', { refresh }).catch(() => null)
  // Offline, or the worker's day spent: still signed in, asked again later.
  if (!answer) return null
  if (answer.status === 200) { signedIn(answer.body); return session?.value ?? null }
  // Ended elsewhere (a new password, deleted) or banned: out, and why.
  if (answer.status === 401 || answer.status === 403) forget(answer.status === 403 ? 'banned' : undefined)
  return null
}

/** Out: the renewal token no use from now on, nothing of the account kept. */
export function signOutEmail(): void {
  let refresh: string | null = null
  try { refresh = localStorage.getItem(REFRESH) } catch { /* none */ }
  if (refresh) void ask('signout', { refresh }).catch(() => {})
  forget()
}
function forget(reason?: SignedOutReason): void {
  session = null
  try { localStorage.removeItem(REFRESH) } catch { /* gone with the visit */ }
  keepAccount(null, reason)
}
