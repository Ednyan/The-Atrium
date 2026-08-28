// Pinterest OAuth connect flow + read API access, proxied through Supabase
// Edge Functions (pinterest-oauth-exchange, pinterest-api) so the Client
// Secret and stored access/refresh tokens never reach the browser. Web only
// for now -- desktop OAuth needs a custom URL scheme/deep-link plugin this
// app doesn't have yet.

import { supabase } from './supabase'
import { showToast } from './toast'
import { isDesktop } from './supabase'
import {
  callPinterestApiAsLinkedDesktop,
  getDesktopPinterestStatus,
  unlinkDesktopPinterest,
} from './pinterestDesktop'

const PINTEREST_AUTHORIZE_URL = 'https://www.pinterest.com/oauth/'
// Read-only scopes only -- boards/pins for import, plus the account's own
// username for display. These fall under Pinterest's "Trial access" tier
// and shouldn't need their app-review process.
const PINTEREST_SCOPES = 'boards:read,pins:read,user_accounts:read'
const OAUTH_STATE_KEY = 'pinterest_oauth_state'

// Client ID is not sensitive (it's the public half of the OAuth flow, sent
// straight to Pinterest in a browser redirect) -- safe to ship in the
// frontend bundle. The Client Secret lives only in the
// pinterest-oauth-exchange Edge Function's environment.
const CLIENT_ID = import.meta.env.VITE_PINTEREST_CLIENT_ID as string | undefined

export function isPinterestConfigured(): boolean {
  return !!CLIENT_ID
}

// One fixed URI, so there is one thing to register.
//
// This was origin + pathname, which is whatever route the user happened to be
// on when they pressed Connect -- /welcome, /login, or / -- and Pinterest
// requires a byte-for-byte match against a registered value. That meant every
// route somebody might connect from had to be registered separately, and the
// first one that was not failed with an OAuth error that says nothing useful.
//
// The root is safe to come back to because the callback is not route-bound:
// App.tsx picks up ?code= on mount, wherever the app has landed.
// Where to put the user back after Pinterest has finished with them.
//
// This app routes on the HASH -- an atrium is #/atrium/<id> -- and a fragment
// never survives an OAuth round trip: it is not sent to the server and not
// returned in the redirect. So connecting from inside an atrium came back to
// the bare origin and landed on the landing page, having quietly lost the only
// part of the URL that said where you were.
//
// Session storage, for the same reason the contributors page uses it: it
// describes this visit, and a destination remembered from last week would be
// worse than the default.
// Marks an OAuth round trip as belonging to a desktop app rather than to
// whoever is signed in here. Set before leaving, read on the way back -- the
// callback lands on a fresh page load with nothing else to tell it apart.
const DESKTOP_MODE_KEY = 'atrium_pinterest_desktop_mode'
const DESKTOP_CODE_KEY = 'atrium_pinterest_desktop_code'
// Announced as well as stored: the page is put back on screen BEFORE the
// exchange finishes, so it mounts, finds no code yet, and would otherwise sit
// there having already looked once.
export const DESKTOP_CODE_EVENT = 'atrium-pinterest-desktop-code'

const RETURN_KEY = 'atrium_pinterest_return'
const DEFAULT_RETURN = '#/welcome'

function rememberPinterestReturn() {
  try {
    sessionStorage.setItem(RETURN_KEY, window.location.hash || DEFAULT_RETURN)
  } catch {
    // Private browsing, or storage disabled. The default is still sensible.
  }
}

// Restores the hash and clears it, so a later reload is an ordinary page load
// rather than a second trip back to wherever this once pointed.
function restorePinterestReturn() {
  let target = DEFAULT_RETURN
  try {
    target = sessionStorage.getItem(RETURN_KEY) || DEFAULT_RETURN
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    // Keep the default.
  }
  if (window.location.hash !== target) {
    window.location.hash = target
  }
}

export function getPinterestRedirectUri(): string {
  return window.location.origin + '/'
}

// Connects Pinterest on behalf of a desktop app, with nobody signed in here.
//
// The page this runs on requires no account: the desktop app sent its user to
// the browser precisely because it has no https origin of its own for Pinterest
// to return to, and requiring an Atrium login on the way would be asking them
// to make an account to reach their own boards.
export function beginDesktopPinterestConnect() {
  try {
    sessionStorage.setItem(DESKTOP_MODE_KEY, '1')
    sessionStorage.removeItem(DESKTOP_CODE_KEY)
  } catch {
    // Without storage the callback cannot tell this apart from an ordinary
    // connect, so stop rather than silently connecting the wrong thing.
    showToast('This browser is blocking site storage, which this needs.')
    return
  }
  initiatePinterestConnect()
}

// Whether an OAuth round trip is in flight on a desktop app's behalf. Read
// without clearing: the callback still has to consume the flag itself, and
// this only decides whether to run the callback at all on a page where nobody
// is signed in.
export function hasPendingDesktopPinterestFlow(): boolean {
  try {
    return sessionStorage.getItem(DESKTOP_MODE_KEY) === '1'
  } catch {
    return false
  }
}

// The code minted for a desktop app, if the last callback produced one.
// Cleared as it is read: it is shown once, on the screen it returns to.
export function takeDesktopPairingCode(): string | null {
  try {
    const code = sessionStorage.getItem(DESKTOP_CODE_KEY)
    if (code) sessionStorage.removeItem(DESKTOP_CODE_KEY)
    return code
  } catch {
    return null
  }
}

export function initiatePinterestConnect() {
  if (!CLIENT_ID) {
    showToast('Pinterest is not configured on this build yet.')
    return
  }
  const state = crypto.randomUUID()
  sessionStorage.setItem(OAUTH_STATE_KEY, state)
  rememberPinterestReturn()

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: getPinterestRedirectUri(),
    response_type: 'code',
    scope: PINTEREST_SCOPES,
    state,
  })

  window.location.href = `${PINTEREST_AUTHORIZE_URL}?${params.toString()}`
}

export interface PinterestCallbackResult {
  handled: boolean
  success?: boolean
  username?: string | null
  error?: string
  // True when this round trip was on behalf of a desktop app: the page shows a
  // code rather than announcing a connection of its own.
  desktop?: boolean
}

// Call once on app boot (see App.tsx). If the URL carries a Pinterest OAuth
// redirect (?code=...&state=...), exchanges it via the Edge Function and
// strips the query string immediately so a page refresh can't replay a
// used/invalid code. No-ops (handled: false) for any other page load.
export async function handlePinterestCallback(): Promise<PinterestCallbackResult> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const oauthError = params.get('error')

  if (!code && !oauthError) return { handled: false }

  const cleanUrl = window.location.pathname + window.location.hash
  window.history.replaceState({}, '', cleanUrl)

  // Restored before any of the outcomes below, so a refusal or a failed
  // exchange puts you back where you were too. Being dropped on the landing
  // page is a poor way to be told something went wrong.
  restorePinterestReturn()

  if (oauthError) {
    return { handled: true, success: false, error: 'Pinterest authorization was cancelled or denied.' }
  }

  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY)
  sessionStorage.removeItem(OAUTH_STATE_KEY)
  if (!expectedState || state !== expectedState) {
    return { handled: true, success: false, error: 'Pinterest sign-in could not be verified. Please try connecting again.' }
  }

  if (!supabase) {
    return { handled: true, success: false, error: 'Not connected to the server.' }
  }

  try {
    let desktopMode = false
    try {
      desktopMode = sessionStorage.getItem(DESKTOP_MODE_KEY) === '1'
    } catch {
      // Treated as an ordinary connect.
    }

    const { data, error } = await supabase.functions.invoke('pinterest-oauth-exchange', {
      body: { code, redirectUri: getPinterestRedirectUri(), ...(desktopMode ? { mode: 'desktop' } : {}) },
    })
    // Cleared only now, not when it was read. The link page is already on
    // screen by this point -- the route is restored before the exchange -- and
    // it decides whether to show "finishing" or the Connect button by whether
    // this flag is still set. Clearing it early made the page offer to start
    // again for the moment before the code arrived.
    if (desktopMode) {
      try {
        sessionStorage.removeItem(DESKTOP_MODE_KEY)
      } catch {
        // Nothing readable to clear.
      }
    }

    if (error || data?.error) {
      return { handled: true, success: false, error: data?.error || error?.message || 'Failed to connect Pinterest.' }
    }

    // A desktop connection belongs to no account, so there is nothing here to
    // show as "connected" -- what comes back is the code to carry across.
    if (desktopMode && data?.code) {
      try {
        sessionStorage.setItem(DESKTOP_CODE_KEY, data.code)
      } catch {
        return { handled: true, success: false, error: 'Could not hold on to the code. Try again.' }
      }
      window.dispatchEvent(new CustomEvent(DESKTOP_CODE_EVENT, { detail: data.code }))
    }

    return { handled: true, success: true, username: data?.username ?? null, desktop: desktopMode }
  } catch (err: any) {
    return { handled: true, success: false, error: err?.message || 'Failed to connect Pinterest.' }
  }
}

export async function getPinterestConnectionStatus(): Promise<{ connected: boolean; username: string | null }> {
  if (isDesktop) return getDesktopPinterestStatus()
  if (!supabase) return { connected: false, username: null }
  const { data, error } = await supabase.rpc('get_pinterest_connection_status')
  if (error || !data || data.length === 0) return { connected: false, username: null }
  return { connected: !!data[0].connected, username: data[0].pinterest_username ?? null }
}

export async function disconnectPinterest(): Promise<void> {
  // On desktop this severs the link rather than disconnecting Pinterest
  // itself: the connection belongs to the web account, and one machine
  // unlinking should not sign the account out everywhere.
  if (isDesktop) return unlinkDesktopPinterest()
  if (!supabase) return
  await supabase.rpc('disconnect_pinterest')
}

export interface PinterestBoard {
  id: string
  name: string
  pinCount: number
  thumbnailUrl: string | null
}

export interface PinterestPin {
  id: string
  title: string
  description: string
  imageUrl: string
  imageWidth: number
  imageHeight: number
  // Link back to the pin's own page on pinterest.com -- used as the
  // click-through target for the link-card fallback (not the raw image URL).
  pinUrl: string
}

async function callPinterestApi(body: Record<string, unknown>): Promise<any> {
  // Desktop has no session to invoke with, and its client shim has no
  // .functions at all -- calling it would throw a TypeError straight past
  // every error check in the caller. It presents its link token over plain
  // fetch instead, and reaches the same Edge Function.
  if (isDesktop) return callPinterestApiAsLinkedDesktop(body)
  if (!supabase) throw new Error('Not connected to the server.')
  const { data, error } = await supabase.functions.invoke('pinterest-api', { body })
  if (error) throw new Error(error.message || 'Pinterest request failed.')
  if (data?.error) throw new Error(data.error)
  return data
}

export async function fetchPinterestBoards(): Promise<PinterestBoard[]> {
  const boards: PinterestBoard[] = []
  let bookmark: string | undefined
  // Pinterest paginates at 100/page; loop until exhausted. Bounded at 20
  // pages (2000 boards) as a sanity cap, not a realistic ceiling.
  for (let i = 0; i < 20; i++) {
    const data = await callPinterestApi({ action: 'boards', bookmark })
    for (const b of data.items ?? []) {
      boards.push({
        id: b.id,
        name: b.name,
        pinCount: b.pin_count ?? 0,
        thumbnailUrl: b.media?.image_cover_url ?? b.media?.pin_thumbnail_urls?.[0] ?? null,
      })
    }
    bookmark = data.bookmark ?? undefined
    if (!bookmark) break
  }
  return boards
}

// Prefers a mid-size image variant (fast to load, still sharp) over the
// full original. Pinterest's v5 pin objects key sizes like '150x150',
// '400x300', '600x', '1200x', 'orig'.
function pickBestImage(images: Record<string, { url: string; width: number; height: number }> | undefined) {
  if (!images) return null
  const preferredOrder = ['600x', '400x300', '1200x', 'orig', '150x150']
  for (const key of preferredOrder) {
    if (images[key]) return images[key]
  }
  return Object.values(images)[0] ?? null
}

export async function fetchPinterestBoardPins(boardId: string, onProgress?: (fetchedSoFar: number) => void): Promise<PinterestPin[]> {
  const pins: PinterestPin[] = []
  let bookmark: string | undefined
  // Bounded at 100 pages (up to 10,000 pins) as a sanity cap.
  for (let i = 0; i < 100; i++) {
    const data = await callPinterestApi({ action: 'pins', boardId, bookmark })
    for (const p of data.items ?? []) {
      const image = pickBestImage(p.media?.images)
      if (!image) continue
      pins.push({
        id: p.id,
        title: p.title || '',
        description: p.description || '',
        imageUrl: image.url,
        imageWidth: image.width,
        imageHeight: image.height,
        pinUrl: p.link || `https://www.pinterest.com/pin/${p.id}/`,
      })
    }
    onProgress?.(pins.length)
    bookmark = data.bookmark ?? undefined
    if (!bookmark) break
  }
  return pins
}
