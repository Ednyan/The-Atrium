// Public Drive atriums, mirrored by the Atrium (workers/rooms, src/mirror.ts;
// docs/DECENTRALIZING.md, phase 10, step 3): their files kept there too, by
// their Drive ids, so whoever looks at one reads it from the Atrium -- no
// Google robot check, no file locked for being read too often -- and from
// Drive only what the mirror lacks. Kept by those in the atrium (lib/
// driveSync): each writer's own writes, and the owner's app fills what's
// missing.
import { accountToken } from './signedIn'
import { workerUrl } from './rooms'
import { fromFiles } from './worker'
import type { DriveStore } from './driveSync'

const at = (path: string) => `${workerUrl()}/mirror/${path}`
export interface Mirrored { id: string; name: string; version: string }

/** Kept in an atrium's mirror: a file, with its bytes -- or a folder,
 *  without -- by its Drive id, where it is, its name and its version. False
 *  if it couldn't be: Drive has it anyway. */
export async function mirrorPut(lobbyId: string, entry: { id: string; parent: string | null; name: string; version?: string; bytes?: Uint8Array }): Promise<boolean> {
  const token = await accountToken().catch(() => null)
  if (!token) return false
  // A line of JSON -- the sign-in, which file it is -- then its bytes, a
  // folder none (workers/rooms, who.ts sentFile).
  const head = JSON.stringify({ token, lobby: lobbyId, id: entry.id, name: entry.name, version: entry.version || '1',
    ...(entry.parent ? { parent: entry.parent } : {}), ...(entry.bytes ? {} : { folder: true }) })
  const body = new Blob(entry.bytes ? [`${head}\n`, entry.bytes as BlobPart] : [`${head}\n`])
  const response = await fetch(at('put'), { method: 'POST', body }).catch(() => null)
  return !!response?.ok
}

/** Out of an atrium's mirror: what its Drive no longer has (lib/driveSync,
 *  fillFolder) -- its owner's or an admin's. */
export async function mirrorDrop(lobbyId: string, ids: string[]): Promise<void> {
  const token = await accountToken().catch(() => null)
  // So many at once, as the worker takes them (workers/rooms, mirror.ts drop).
  for (let from = 0; token && from < ids.length; from += 90) {
    await fetch(at('drop'), { method: 'POST', body: JSON.stringify({ token, lobby: lobbyId, ids: ids.slice(from, from + 90) }) }).catch(() => null)
  }
}

/** A folder, as the mirror has it ([] for none). */
export async function mirrorList(lobbyId: string, folder: string): Promise<Mirrored[]> {
  const response = await fetch(at(`list/${lobbyId}/${folder}`)).catch(() => null)
  return response?.ok ? response.json() : []
}

/** A public atrium read through its mirror first, and Drive for what it
 *  lacks -- a viewer's (lib/driveSync). */
export function mirroredStore(lobbyId: string, drive: DriveStore): DriveStore {
  const get = (kind: string, id: string) => fetch(at(`${kind}/${lobbyId}/${id}`)).catch(() => null)
  return {
    ...drive,
    version: async id => { const response = await get('meta', id); return response?.ok ? (await response.json()).version : drive.version(id) },
    readByLink: async id => { const response = await fromFiles(`m/${lobbyId}/${id}`) ?? await get('file', id); return response?.ok ? new Uint8Array(await response.arrayBuffer()) : drive.readByLink(id) },
    listByLink: async folder => { const listed = await mirrorList(lobbyId, folder); return listed.length ? listed : drive.listByLink(folder) },
  }
}
