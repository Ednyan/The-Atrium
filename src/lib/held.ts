// Cloud atriums held for their owners by the Atrium (workers/rooms,
// src/held.ts; docs/DECENTRALIZING.md, phase 10, step 5c): for owners who
// hadn't come back to move them out of Supabase themselves, the operator
// holds them (Developers > Cloud atriums), and the owner's app makes each a
// hosted atrium on their next visit (lib/moveToDrive, restoreHeld).
import { accountToken } from './signedIn'
import { workerUrl } from './rooms'
import { toWorker } from './worker'

async function ask<T>(what: string, body: object = {}): Promise<T> {
  const { ok, status, answer } = await toWorker<T & { error?: string }>(`/held/${what}`, body, true)
  if (!ok) throw new Error(answer?.error ?? `held ${what}: ${status}`)
  return answer as T
}

export interface Remaining { id: string; name: string; owner_user_id: string | null; is_public: boolean; created_at: string }
export interface Held { lobby_id: string; name: string; owner: string; taken_at: number; released_at: number | null; files: number; left: number }

/** The operator's: what's still in Supabase, and what's held. */
export const heldList = () => ask<{ remaining: Remaining[]; held: Held[] }>('list')

/** The operator's: one atrium held, start to end -- its manifest and rows,
 *  each of its files, then the original let go. Files already gone in
 *  Supabase are counted, not waited for. Begun again, it starts over. */
export async function holdAtrium(id: string, onFile: (done: number, of: number) => void = () => {}): Promise<{ files: number; gone: number }> {
  const { files } = await ask<{ files: number }>('take', { id })
  let gone = 0
  for (let idx = 0; idx < files; idx++) {
    const { state } = await ask<{ state: string }>('file', { id, idx })
    if (state === 'gone') gone++
    onFile(idx + 1, files)
  }
  await ask('release', { id })
  return { files, gone }
}

/** One's own held atriums. */
export const myHeld = () => ask<{ lobby_id: string; name: string }[]>('mine')

/** A part of one held for oneself: its manifest, its rows, or a file. */
export async function readHeld(id: string, part: 'manifest' | 'atrium' | number): Promise<Response> {
  const token = await accountToken()
  if (!token) throw new Error('NOT_SIGNED_IN')
  return fetch(`${workerUrl()}/held/read`, { method: 'POST', body: JSON.stringify({ token, id, part }) })
}

/** One held for oneself, as an .atrium file to keep (lib/atriumFile's
 *  format): its rows, its files inside it -- one gone already left as its
 *  address. Still held after: a copy, not a move. */
export async function heldAtriumFile(id: string): Promise<Blob> {
  const [{ atriumEnvelope }, { readAsDataUrl, ATRIUM_FILE_TYPE }] = await Promise.all([import('./atriumDownload'), import('./atriumFile')])
  const part = async (name: 'manifest' | 'atrium') => {
    const response = await readHeld(id, name)
    if (!response.ok) throw new Error(`HELD_${name.toUpperCase()}_${response.status}`)
    return response.json()
  }
  const manifest = await part('manifest') as { files: string[] }
  const { lobby, traces, layers, links, locations } = await part('atrium') as Record<string, any>
  const inside = new Map<string, string>()
  for (const [idx, url] of manifest.files.entries()) {
    const response = await readHeld(id, idx).catch(() => null)
    if (response?.ok) inside.set(url, await readAsDataUrl(await response.blob()))
  }
  const rows = (traces as Record<string, any>[]).map(row => ({ ...row, media_url: inside.get(row.media_url) ?? row.media_url, image_url: inside.get(row.image_url) ?? row.image_url }))
  const envelope = atriumEnvelope('Digital Atrium Web', { name: lobby.name, theme_settings: lobby.theme_settings ?? null, is_public: !!lobby.is_public, max_players: lobby.max_players ?? 50 },
    layers, locations, rows, links)
  return new Blob([JSON.stringify(envelope)], { type: ATRIUM_FILE_TYPE })
}

/** Whether an atrium is held, waiting for its owner -- asked by anyone
 *  opening its old address. */
export async function isHeld(id: string): Promise<boolean> {
  const response = await fetch(`${workerUrl()}/held/is/${encodeURIComponent(id)}`).catch(() => null)
  return !!response?.ok && (await response.json().catch(() => null))?.held === true
}

/** Made a hosted atrium: no longer held. */
export const heldDone = (id: string) => ask('done', { id }).then(() => {})
