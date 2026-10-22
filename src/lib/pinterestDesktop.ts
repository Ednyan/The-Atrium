// The desktop half of the Pinterest link.
//
// The desktop app has no account to sign in with, so its Pinterest is linked
// through the website: connected there on its behalf, which shows a short
// code; the code traded here for a link token. Every call is a plain request
// to the Atrium's worker (workers/rooms, pinterest), carrying that token in
// its body -- the one credential kept on the device. It buys exactly one
// thing: read access to that Pinterest's boards. It is not a session -- it
// cannot touch atriums, contributions, or anything else. A link made before
// (by Supabase's functions) is taken over by the worker the first time it's used.

import { workerUrl } from './rooms'

const LINK_TOKEN_KEY = 'atrium_pinterest_link_token'

export function getDesktopLinkToken(): string | null {
  try {
    return localStorage.getItem(LINK_TOKEN_KEY)
  } catch {
    return null
  }
}

function setDesktopLinkToken(token: string) {
  try {
    localStorage.setItem(LINK_TOKEN_KEY, token)
  } catch {
    // Storage disabled. The link simply will not survive a restart.
  }
}

export function clearDesktopLinkToken() {
  try {
    localStorage.removeItem(LINK_TOKEN_KEY)
  } catch {
    // Nothing to do -- there was nothing readable to clear.
  }
}

export function isPinterestDesktopReachable(): boolean {
  return !!workerUrl()
}

async function callWorker(what: string, body: Record<string, unknown>, options: { withLinkToken?: boolean } = {}): Promise<any> {
  const url = workerUrl()
  if (!url) throw new Error('This build has no server configured.')
  let link: string | null = null
  if (options.withLinkToken) {
    link = getDesktopLinkToken()
    if (!link) throw new Error('This app is not linked to a Pinterest account yet.')
  }
  const res = await fetch(`${url}/pinterest/${what}`, { method: 'POST', body: JSON.stringify({ ...body, ...(link ? { link } : {}) }) })
  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Request failed (${res.status}).`)
  }
  return data
}

// Trades the code shown on the website for the long-lived token, and keeps it.
export async function redeemPinterestPairingCode(code: string): Promise<void> {
  const data = await callWorker('link', { code })
  if (!data?.token) throw new Error('The server did not return a link token.')
  setDesktopLinkToken(data.token)
}

export async function getDesktopPinterestStatus(): Promise<{ connected: boolean; username: string | null }> {
  if (!getDesktopLinkToken()) return { connected: false, username: null }
  try {
    const data = await callWorker('status', {}, { withLinkToken: true })
    // Unlinked, or never known: forgetting the token here keeps the two ends
    // honest instead of retrying a dead link on every visit.
    if (!data?.linked) {
      clearDesktopLinkToken()
      return { connected: false, username: null }
    }
    return { connected: !!data.connected, username: data.username ?? null }
  } catch {
    // Offline, most likely. Not a reason to throw the token away.
    return { connected: false, username: null }
  }
}

// Hands the token back before forgetting it, so the connection on the server
// goes too rather than lingering as access nobody remembers granting.
export async function unlinkDesktopPinterest(): Promise<void> {
  try {
    await callWorker('unlink', {}, { withLinkToken: true })
  } catch {
    // Even if the server could not be reached, stop using it locally.
  }
  clearDesktopLinkToken()
}

export async function callPinterestApiAsLinkedDesktop(body: Record<string, unknown>): Promise<any> {
  return callWorker('api', body, { withLinkToken: true })
}
