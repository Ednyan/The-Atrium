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
  const sent = { ...body, ...(token ? { token } : {}) }
  const response = (await viaBatch(path, sent)) ?? await fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(sent) })
  return { ok: response.ok, status: response.status, answer: await response.json().catch(() => null) }
}

// ---------------------------------------------------------------- reads, together

// The reads a visit makes -- one's profile, invitations, visits, held
// atriums, whether one's the operator, Pinterest, storage, settings, the
// themes, the wall -- go to the worker together: each waits BATCH_MS for
// others, and those gathered go as one request (workers/rooms, /batch),
// answered there as if each had come alone. A request is one of the free
// day's 100,000 whatever it holds: a visit's dozen became two or three.
//
// Reads only, each path's own test saying which bodies are: a batch that
// reached the worker but whose answer was lost is sent again call by call,
// and a write would be made twice. A batch that fails -- an older worker
// without /batch, the network -- leaves each call to go alone, as before.
const READS: Record<string, (body: Record<string, unknown>) => boolean> = {
  '/people/me': body => !('set' in body),
  '/people/invites': () => true,
  '/people/visits': body => !('visits' in body),
  '/people/atriums': () => true,
  '/held/mine': () => true,
  '/ops/operator': () => true,
  '/pinterest/status': () => true,
  '/store/usage': () => true,
  '/store/appdata': body => !('bytes' in body),
  '/themes': () => true,
  '/contributions/wall': () => true,
}
const BATCH_MS = 40
// The worker takes this many in one.
const MOST_IN_BATCH = 16
let waiting: { path: string; body?: object; get: boolean; done: (response: Response | null) => void }[] = []
let noBatches = false

/** `path`'s answer, asked together with the other reads made about now --
 *  or null, for the caller to ask alone: not a read, or the batch failed.
 *  `get`: asked with GET, as the public reads are. */
export function viaBatch(path: string, body?: Record<string, unknown>, get = false): Promise<Response | null> {
  const url = workerUrl()
  const read = READS[path]
  if (!url || noBatches || !read || !read(body ?? {})) return Promise.resolve(null)
  return new Promise(done => {
    waiting.push({ path, body, get, done })
    if (waiting.length === 1) window.setTimeout(() => void sendBatch(url), BATCH_MS)
  })
}

async function sendBatch(url: string) {
  const calls = waiting
  waiting = []
  for (let at = 0; at < calls.length; at += MOST_IN_BATCH) {
    const some = calls.slice(at, at + MOST_IN_BATCH)
    try {
      const response = await fetch(`${url}/batch`, { method: 'POST', body: JSON.stringify({ calls: some.map(({ path, body, get }) => ({ path, body, get })) }) })
      if (response.status === 404) noBatches = true
      if (!response.ok) throw new Error(`batch ${response.status}`)
      const { answers } = await response.json() as { answers: { status: number; body: unknown }[] }
      some.forEach((call, i) => {
        const answer = answers[i]
        call.done(answer ? new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status: answer.status }) : null)
      })
    } catch {
      some.forEach(call => call.done(null))
    }
  }
}
