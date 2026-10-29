// A request to the rooms worker (workers/rooms) for what the account calls
// on -- the directory, its relay pass, the report form, a Google account's
// Pinterest: a plain request (a text body, no headers of its own, so no
// preflight), with the account's token when someone's signed in.
import { filesUrl, workerUrl } from './rooms'
import { accountToken } from './signedIn'

export interface WorkerAnswer<T> { ok: boolean; status: number; answer: T | null }

/** `body` to the worker's `path`. `signedIn`: someone must be (NOT_SIGNED_IN
 *  if not), and their token goes; otherwise it goes only if there is one. */
/** `keepalive`: sent even as the page closes (a small body). */
export async function toWorker<T = any>(path: string, body: object = {}, signedIn = false, keepalive = false): Promise<WorkerAnswer<T>> {
  const url = workerUrl()
  if (!url) throw new Error('The Atrium’s server isn’t set up in this build')
  const token = await accountToken().catch(() => null)
  if (signedIn && !token) throw new Error('NOT_SIGNED_IN')
  const sent = { ...body, ...(token ? { token } : {}) }
  const response = (await viaBatch(path, sent)) ?? await fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(sent), keepalive })
  return { ok: response.ok, status: response.status, answer: await response.json().catch(() => null) }
}

/** A public file (lib/rooms filesUrl): its answer, or null for the caller to
 *  ask the worker -- not there yet (the worker puts it there as it answers),
 *  older than `freshMs`, or not reachable. */
export async function fromFiles(path: string, freshMs = Infinity, signal?: AbortSignal): Promise<Response | null> {
  const url = filesUrl()
  if (!url) return null
  const response = await fetch(`${url}/${path}`, { cache: 'no-store', signal }).catch(() => null)
  if (!response?.ok) return null
  return freshMs === Infinity || Date.now() - Date.parse(response.headers.get('Last-Modified') ?? '') < freshMs ? response : null
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
  '/people/asks': () => true,
  '/held/mine': () => true,
  '/ops/operator': () => true,
  '/pinterest/status': () => true,
  '/store/usage': () => true,
  '/store/appdata': body => !('bytes' in body),
  '/themes': () => true,
  '/contributions/wall': () => true,
}
// The hosted store's public reads by id, asked with GET (lib/hostedStore):
// a file's version, a folder's list.
const READ_UNDER = ['/store/meta/', '/store/list/']
const readTest = (path: string, get: boolean) => READS[path] ?? (get && READ_UNDER.some(under => path.startsWith(under)) ? () => true : undefined)
// When a batch goes: once the reads have paused this long -- or this long
// after the first, whatever comes. A page's reads start one after another, a
// hundred or two milliseconds apart (its parts mount, each asks): sent
// 40ms after each first, a load of the atrium browser was eight requests;
// gathered so, two.
const QUIET_MS = 250
const MOST_WAIT_MS = 700
// The worker takes this many in one -- 16, one older than 2026-10-29, which
// says so ('calls') and is sent them 16 at a time from then on.
let mostInBatch = 32
let waiting: { path: string; body?: object; get: boolean; done: (response: Response | null) => void }[] = []
let firstAt = 0, timer = 0
let noBatches = false
// Held (holdReads): the reads gathered go once it's let go of.
let holds = 0

// The directory's answers -- one's profile, invitations, the atriums listed,
// one's visits and held atriums, storage, the themes -- kept for the visit:
// a page asked for them again and again (the browser loaded twice on
// opening, and again on coming back from an atrium), each time a request.
// What's changed elsewhere meanwhile -- an invitation sent, an atrium made
// public -- shows on a reload; half an hour at most, for a desktop app left
// open for days. Anything written through the worker forgets them all
// (forgetReads), so one's own change is never answered from before it. Not
// the store's versions and lists: a roster changed, told through the room,
// is read anew.
const KEEP_MS = 30 * 60_000
const KEPT_PATHS = new Set(['/people/me', '/people/invites', '/people/visits', '/people/atriums', '/held/mine', '/ops/operator', '/pinterest/status', '/store/usage', '/themes', '/contributions/wall'])
type Answer = { status: number; body: string }
const kept = new Map<string, Answer & { at: number }>()
// Those on their way: asked again meanwhile, the same answer, not a second ask.
const coming = new Map<string, Promise<Answer | null>>()
// Moved on by each forgetting: an answer to a read asked before a write isn't kept.
let era = 0
// A path's kind: its first part (/people, /store, /held...).
const kindOf = (path: string) => path.split('/')[1] ?? ''
// What a write changes, where that's narrower than its kind.
const CHANGES: Record<string, string[]> = {
  '/people/clear': ['/people/invites'],
  // One's own ask to be let in: nothing one reads.
  '/people/ask': [],
  '/people/visits': ['/people/visits'],
  '/people/me': ['/people/me'],
  '/people/publish': ['/people/atriums'],
  '/people/unpublish': ['/people/atriums'],
}
/** The directory answers `path`'s write may have changed let go of: those
 *  CHANGES names, else all of its kind -- a /held write, one's held atriums;
 *  a /store write, one's storage. Not every answer: an invitation's secret
 *  cleared, as an atrium is first opened, had them all asked again. With no
 *  path, all of them. */
export const forgetReads = (path?: string) => {
  const changed = path === undefined ? null : CHANGES[path]
  const goes = (key: string) => path === undefined || (changed ? changed.includes(key.split(' ')[0]) : kindOf(key) === kindOf(path))
  for (const key of [...kept.keys()]) if (goes(key)) kept.delete(key)
  for (const key of [...coming.keys()]) if (goes(key)) coming.delete(key)
  era++
}
const asResponse = (answer: Answer) => new Response(answer.body, { status: answer.status })

/** `path`'s answer, asked together with the other reads made about now --
 *  or null, for the caller to ask alone: not a read, or the batch failed.
 *  `get`: asked with GET, as the public reads are. A call that isn't a read
 *  is a write (or may be): what's kept is forgotten. */
export function viaBatch(path: string, body?: Record<string, unknown>, get = false): Promise<Response | null> {
  const url = workerUrl()
  const read = readTest(path, get)
  if (!read || !read(body ?? {})) {
    forgetReads(path)
    return Promise.resolve(null)
  }
  if (!url || noBatches) return Promise.resolve(null)
  const key = KEPT_PATHS.has(path) ? `${path} ${JSON.stringify(body ?? {})}` : null
  if (key) {
    const had = kept.get(key)
    if (had && Date.now() - had.at < KEEP_MS) return Promise.resolve(asResponse(had))
    const on = coming.get(key)
    if (on) return on.then(answer => answer && asResponse(answer))
  }
  const asked = new Promise<Response | null>(done => {
    const now = Date.now()
    if (!waiting.length) firstAt = now
    waiting.push({ path, body, get, done })
    window.clearTimeout(timer)
    if (!holds) timer = window.setTimeout(() => void sendBatch(url), Math.min(QUIET_MS, firstAt + MOST_WAIT_MS - now))
  })
  if (key) {
    const askedIn = era
    const answer = asked.then(async response => (response?.ok ? { status: response.status, body: await response.clone().text() } : null))
    coming.set(key, answer)
    void answer.then(got => {
      if (coming.get(key) === answer) coming.delete(key)
      if (got && askedIn === era) kept.set(key, { ...got, at: Date.now() })
    })
  }
  return asked
}

// The directory's reads a page of the atrium browser makes as it opens --
// one's profile, invitations, visits, held atriums, whether one's the
// operator, Pinterest, storage -- asked all at
// once, in one request, and kept (KEPT_PATHS): each of its parts, asking as
// it mounts, is answered from them, or from the answer on its way. Asked by
// its parts alone, they went in four or five requests, one after another.
// Each as its part asks it: the body {} and one's token (toWorker, hostedStore).
// Not the atriums listed nor the themes: public files (fromFiles).
const AHEAD = ['/people/me', '/people/invites', '/people/visits', '/held/mine', '/ops/operator', '/pinterest/status', '/store/usage']
export async function askAhead(): Promise<void> {
  const url = workerUrl()
  const token = await accountToken().catch(() => null)
  if (!url || !token || noBatches) return
  for (const path of AHEAD) void viaBatch(path, { token })
  // Gathered already: sent now -- unless held, for what else the screen asks.
  if (!holds) sendNow()
}

const sendNow = () => {
  window.clearTimeout(timer)
  const url = workerUrl()
  if (url && waiting.length) void sendBatch(url)
}

// What a screen asks the worker for as it starts -- its parts each at their
// own moment, the last once something of its own has loaded (the atrium
// browser's cards, from this browser's store) -- held, and sent together, in
// one request, once it's let go of; a moment at most, whatever happens.
const HOLD_MOST_MS = 2000
/** Reads asked from now on are held until the function given back is called. */
export function holdReads(): () => void {
  holds++
  let released = false
  const release = () => {
    if (released) return
    released = true
    if (--holds === 0) sendNow()
  }
  window.setTimeout(release, HOLD_MOST_MS)
  return release
}

async function sendBatch(url: string) {
  const calls = waiting
  waiting = []
  for (let at = 0; at < calls.length;) {
    const some = calls.slice(at, at + mostInBatch)
    try {
      const response = await fetch(`${url}/batch`, { method: 'POST', body: JSON.stringify({ calls: some.map(({ path, body, get }) => ({ path, body, get })) }) })
      if (response.status === 404) noBatches = true
      // A worker that takes 16 at most: these again, 16 at a time.
      if (response.status === 400 && some.length > 16 && (await response.clone().json().catch(() => null))?.error === 'calls') {
        mostInBatch = 16
        continue
      }
      if (!response.ok) throw new Error(`batch ${response.status}`)
      const { answers } = await response.json() as { answers: { status: number; body: unknown }[] }
      some.forEach((call, i) => {
        const answer = answers[i]
        // One a worker older than this page doesn't take in a batch: alone.
        const refused = answer?.status === 400 && (answer.body as { error?: string } | null)?.error === 'not batchable'
        call.done(answer && !refused ? new Response(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body), { status: answer.status }) : null)
      })
    } catch {
      some.forEach(call => call.done(null))
    }
    at += some.length
  }
}
