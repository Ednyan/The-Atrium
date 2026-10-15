// Atriums kept in this browser (docs/DECENTRALIZING.md, phase 7): the desktop
// app's local engine running in the page (lib/browserPlatform), beside the
// cloud's atriums, free and needing no server. Which atriums they are is kept
// here, so opening one of the cloud's never loads the engine.
//
// Inside one, the data client is the engine's (lib/supabase,
// switchDataClient), with the account's own sign-in still: what's made there
// is that person's. Only once every write it started is done -- new traces,
// layer changes, a save -- is the client the cloud's again, so nothing of a
// browser atrium is ever written to the cloud, nor the other way round.

import { cloudClient, supabase, switchDataClient } from './supabase'
import { useGameStore } from '../store/gameStore'

const KEY = 'atrium.browserAtriums'

export function browserAtriumIds(): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}
export const isBrowserAtrium = (lobbyId: string) => browserAtriumIds().includes(lobbyId)
export function rememberBrowserAtrium(lobbyId: string) {
  const ids = browserAtriumIds()
  if (ids.includes(lobbyId)) return
  try { localStorage.setItem(KEY, JSON.stringify([...ids, lobbyId])) } catch { /* this visit only */ }
  // Kept from the browser's clearing under storage pressure, where it agrees.
  void navigator.storage?.persist?.().catch(() => false)
}
export function forgetBrowserAtrium(lobbyId: string) {
  try { localStorage.setItem(KEY, JSON.stringify(browserAtriumIds().filter(id => id !== lobbyId))) } catch { /* this visit only */ }
}

export interface Maker { id: string; name: string; color: string }

/** Who's making things now, as the app has them: the account, or the guest. */
function currentMaker(): Maker {
  const { userId, username, playerColor } = useGameStore.getState()
  return { id: userId!, name: username || 'You', color: playerColor || '#ffffff' }
}

// Somebody using the app without an account: this browser's guest, who makes
// its atriums. Kept while they go on as one; gone once they sign in.
const GUEST_KEY = 'atrium.guest'
function keptGuest(): Maker | null {
  try {
    const guest = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null')
    return typeof guest?.id === 'string' ? guest : null
  } catch {
    return null
  }
}
export const isGuestHere = () => keptGuest() !== null
/** This browser's guest, made the first time (named `name`). */
export function browserGuest(name: string): Maker {
  const kept = keptGuest()
  if (kept) return kept
  const guest = { id: crypto.randomUUID(), name, color: '#ffffff' }
  try { localStorage.setItem(GUEST_KEY, JSON.stringify(guest)) } catch { /* this visit only */ }
  return guest
}
export function endGuest() {
  try { localStorage.removeItem(GUEST_KEY) } catch { /* nothing kept */ }
}

let inside: string | null = null
let leaving: Promise<void> | null = null

/** The browser's engine, opened (VAULT_IN_USE when another tab has it), with
 *  `maker` as who's making things in it. */
export async function browserEngine(maker = currentMaker()) {
  const local = await import('./localDb')
  await local.openBrowserVault(maker)
  return local
}

/** The client an atrium's data is with, from anywhere: the engine's for one
 *  kept in this browser, else the app's. */
export async function clientFor(lobbyId: string) {
  return isBrowserAtrium(lobbyId) ? (await browserEngine()).localClient : supabase
}

/** Into a browser atrium: its data from here on -- made by the account
 *  signed in, or by `guest`. */
export async function enterBrowserAtrium(lobbyId: string, guest: Maker | null) {
  const maker = guest ?? currentMaker()
  const local = await browserEngine(maker)
  // Whoever uses this browser owns its atriums -- one made as a guest, opened
  // signed in, is still theirs to set up.
  await local.localClient.from('lobbies').update({ owner_user_id: maker.id }).eq('id', lobbyId).neq('owner_user_id', maker.id)
  switchDataClient({
    ...local.localClient,
    // Who's signed in stays the account's; a guest is the engine's own.
    auth: !guest && cloudClient ? cloudClient.auth : local.localClient.auth,
    functions: cloudClient?.functions,
  })
  inside = lobbyId
}

/** Out of the browser atrium, if in one: once what it started writing is
 *  written, the cloud's client again. Whoever reads the cloud next waits for
 *  this (the leave, the atrium browser), and they all wait for the one. */
export function leaveBrowserAtrium(): Promise<void> {
  if (!inside) return Promise.resolve()
  return leaving ??= (async () => {
    const [{ whenTracesWritten }, { whenLayerChangesDone }, { whenSaveDone }] = await Promise.all([
      import('./traceWrites'), import('./layerQueue'), import('./traceSave'),
    ])
    await whenTracesWritten()
    await whenLayerChangesDone()
    await whenSaveDone()
    switchDataClient(null)
    inside = null
  })().finally(() => { leaving = null })
}
