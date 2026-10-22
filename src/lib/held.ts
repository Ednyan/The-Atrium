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

/** Made a hosted atrium: no longer held. */
export const heldDone = (id: string) => ask('done', { id }).then(() => {})
