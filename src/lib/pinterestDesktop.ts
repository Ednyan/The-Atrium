// The desktop half of the Pinterest link.
//
// Desktop's `supabase` is the local SQLite shim: no auth session, and no
// .functions at all. So every call here is a plain fetch to the Edge Function
// URL, carrying the anon key (which is what satisfies Supabase's own JWT check
// on the way in) and the link token that says which account to act as.
//
// The link token is the only credential stored locally, and it buys exactly one
// thing: read access to that account's Pinterest boards. It is not a session --
// it cannot touch atriums, contributions, or anything else.

const LINK_TOKEN_KEY = 'atrium_pinterest_link_token'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

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
  return !!SUPABASE_URL && !!ANON_KEY
}

async function callFunction(
  name: string,
  body: Record<string, unknown>,
  options: { withLinkToken?: boolean } = {},
): Promise<any> {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('This build has no server configured.')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Both, because Supabase checks the one and the gateway the other. The
    // anon key is public by design -- it is already in the web bundle.
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
  }

  if (options.withLinkToken) {
    const token = getDesktopLinkToken()
    if (!token) throw new Error('This app is not linked to a Pinterest account yet.')
    headers['x-atrium-link-token'] = token
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Request failed (${res.status}).`)
  }
  return data
}

// Trades the code shown on the web app for the long-lived token, and keeps it.
export async function redeemPinterestPairingCode(code: string): Promise<void> {
  const data = await callFunction('pinterest-desktop-link', { action: 'redeem', code })
  if (!data?.token) throw new Error('The server did not return a link token.')
  setDesktopLinkToken(data.token)
}

export async function getDesktopPinterestStatus(): Promise<{ connected: boolean; username: string | null }> {
  if (!getDesktopLinkToken()) return { connected: false, username: null }
  try {
    const data = await callFunction('pinterest-desktop-link', { action: 'status' }, { withLinkToken: true })
    // Revoked on the web, or Pinterest disconnected there. Forgetting the
    // token here keeps the two ends honest instead of retrying a dead link
    // on every visit.
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

// Hands the token back before forgetting it, so the row on the server goes too
// rather than lingering as access nobody remembers granting.
export async function unlinkDesktopPinterest(): Promise<void> {
  try {
    await callFunction('pinterest-desktop-link', { action: 'unlink' }, { withLinkToken: true })
  } catch {
    // Even if the server could not be reached, stop using it locally.
  }
  clearDesktopLinkToken()
}

export async function callPinterestApiAsLinkedDesktop(body: Record<string, unknown>): Promise<any> {
  return callFunction('pinterest-api', body, { withLinkToken: true })
}
