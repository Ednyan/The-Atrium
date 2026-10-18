// A request to the rooms worker (workers/rooms) for what the account calls
// on -- the directory, its relay pass, the report form, a Google account's
// Pinterest: a plain request (a text body, no headers of its own, so no
// preflight), with the account's token when someone's signed in.
import { workerUrl } from './rooms'
import { accountToken } from './signedIn'

export interface WorkerAnswer<T> { ok: boolean; status: number; answer: T | null }

/** `body` to the worker's `path`. `signedIn`: someone must be (NOT_SIGNED_IN
 *  if not), and their token goes; otherwise it goes only if there is one. */
export async function toWorker<T = any>(path: string, body: object = {}, signedIn = false): Promise<WorkerAnswer<T>> {
  const url = workerUrl()
  if (!url) throw new Error('The Atrium’s server isn’t set up in this build')
  const token = await accountToken().catch(() => null)
  if (signedIn && !token) throw new Error('NOT_SIGNED_IN')
  const response = await fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify({ ...body, ...(token ? { token } : {}) }) })
  return { ok: response.ok, status: response.status, answer: await response.json().catch(() => null) }
}
