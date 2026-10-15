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

import { cloudClient, switchDataClient } from './supabase'

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
}
export function forgetBrowserAtrium(lobbyId: string) {
  try { localStorage.setItem(KEY, JSON.stringify(browserAtriumIds().filter(id => id !== lobbyId))) } catch { /* this visit only */ }
}

export interface Maker { id: string; name: string; color: string }

let inside: string | null = null

/** Into a browser atrium: the engine opened (VAULT_IN_USE when another tab
 *  has it), and its data from here on. */
export async function enterBrowserAtrium(lobbyId: string, maker: Maker, signedIn: boolean) {
  const local = await import('./localDb')
  await local.openBrowserVault(maker)
  switchDataClient({
    ...local.localClient,
    // Who's signed in stays the account's; a guest is the engine's own.
    auth: signedIn && cloudClient ? cloudClient.auth : local.localClient.auth,
    functions: cloudClient?.functions,
  })
  inside = lobbyId
}

/** Out of the browser atrium, if in one: once what it started writing is
 *  written, the cloud's client again. */
export async function leaveBrowserAtrium() {
  if (!inside) return
  const [{ whenTracesWritten }, { whenLayerChangesDone }, { whenSaveDone }] = await Promise.all([
    import('./traceWrites'), import('./layerQueue'), import('./traceSave'),
  ])
  await whenTracesWritten()
  await whenLayerChangesDone()
  await whenSaveDone()
  switchDataClient(null)
  inside = null
}
