// The hosted store (workers/rooms, src/store.ts; docs/DECENTRALIZING.md,
// phase 10): files the Atrium keeps itself, for atriums hosted on Cloudflare.
// Behind the same interface Google Drive is (lib/driveSync's DriveStore), so
// an atrium kept here works as a Drive atrium does -- its roster, its sealed
// saves and files, its room.
//
// Its ids carry a mark no Drive id can (Drive's are letters, digits, - and _):
// an invitation's roster, a member's folder, a file, each says by itself
// which store it's in (lib/driveSync, storeOf).
//
// Reading is anyone's, by id, as Drive's "anyone with the link" -- a guest's
// too. Writing is the signed-in account's own, and its errors are said as
// Drive says them ("Drive 404", "Drive 403"), which the sync knows.
import { accountToken } from './signedIn'
import { workerUrl } from './rooms'
import { viaBatch } from './worker'
import { base64ToBytes, bytesToBase64 } from './driveFormat'
import { keptSpace } from './drive'
import type { DriveStore } from './driveSync'

export const HOSTED_MARK = 'h.'
export const isHostedId = (id: string) => id.startsWith(HOSTED_MARK)

const at = (path: string) => `${workerUrl()}/store/${path}`

const failed = async (response: Response) => new Error(`Drive ${response.status}: ${(await response.json().catch(() => null))?.error ?? response.statusText}`)

// A read: anyone's, by id.
async function read(path: string): Promise<Response> {
  const response = await fetch(at(path))
  if (!response.ok) throw new Error(`Drive ${response.status}: ${path}`)
  return response
}

export interface HostedUsage { usage: number; limit: number; atriums: number; most: number }
/** The store, as whoever `token` says is signed in: the page's account
 *  (hostedStore), or -- a test playing several people -- each one's. */
export function hostedStoreFor(token: () => Promise<string | null>): DriveStore & { usage(): Promise<HostedUsage> } {
  const signedInToken = async () => {
    const value = await token().catch(() => null)
    if (!value) throw new Error('NOT_SIGNED_IN')
    return value
  }
  // A change, with one's sign-in: a plain request (a text body), sent without asking first.
  async function ask<T>(what: string, body: object): Promise<T> {
    const sent = { ...body, token: await signedInToken() }
    // Reads go with others about then (lib/worker, viaBatch).
    const response = (await viaBatch(`/store/${what}`, sent)) ?? await fetch(at(what), { method: 'POST', body: JSON.stringify(sent) })
    if (!response.ok) throw await failed(response)
    return response.json()
  }
  return {
    // Writing needs a sign-in, which a write says if it's missing: nothing
    // waits on a window here, as Google's does.
    canWrite: () => true,
    signIn: async () => { await signedInToken() },
    pick: async id => id,
    createFolder: (name, parent) => ask<{ id: string }>('folder', { name, ...(parent ? { parent } : {}) }),
    // Shared by its id already, and only its owner shares it on.
    shareByLink: async () => {},
    noResharing: async () => {},
    // A line of JSON -- the sign-in, where it goes -- then the bytes, which
    // the worker streams on as they come (workers/rooms, who.ts sentFile):
    // also a plain request.
    write: async (name, bytes, place) => {
      const head = JSON.stringify({ token: await signedInToken(), name, ...place })
      const response = await fetch(at('write'), { method: 'POST', body: new Blob([`${head}\n`, bytes as BlobPart]) })
      if (!response.ok) throw await failed(response)
      return response.json()
    },
    readByLink: async id => new Uint8Array(await (await read(`file/${id}`)).arrayBuffer()),
    version: async id => (await (await read(`meta/${id}`)).json()).version,
    listByLink: async folder => (await read(`list/${folder}`)).json(),
    readAppData: async name => {
      const { bytes } = await ask<{ bytes: string | null }>('appdata', { name })
      return bytes ? base64ToBytes(bytes) : null
    },
    writeAppData: async (name, bytes) => { await ask('appdata', { name, bytes: bytesToBase64(bytes) }) },
    // An admin let write the roster: by their account, which is the share.
    shareWith: async (id, to) => (await ask<{ share: string }>('share', { id, account: to.account })).share,
    unshare: async (id, share) => { await ask('unshare', { id, account: share }) },
    remove: async id => { await ask('remove', { id }) },
    /** One's hosted bytes and one's quota; the hosted atriums one owns, and how many one may. */
    usage: () => ask<HostedUsage>('usage', {}),
  }
}
export const hostedStore = hostedStoreFor(accountToken)
// One's space in it, of one's quota, for the atrium one's in.
// ponytail: not keyed by account -- a switch of account in the same page is
// shown the last one's until its next look (each atrium opened looks).
export const hostedSpace = keptSpace(() => 'account', () => hostedStore.usage())
