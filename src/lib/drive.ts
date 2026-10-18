// Google Drive for atriums (docs/DECENTRALIZING.md, phase 4): signing in with
// Google for Drive, and the Drive calls an atrium kept there needs. Web only
// for now -- the desktop needs a client of its own and a loopback sign-in.
//
// Both are public by design -- they end up in the page -- and come from the
// build's environment (.env here, Cloudflare's build variables live), as
// Supabase's and Pinterest's do: kept out of the repository, and changed
// without a commit. What guards them is Google's list of sites the client may
// sign in from, and the key's restriction to this site and these APIs. (The
// client *secret* is never here: the rooms worker holds it, to keep a browser
// signed in -- see driveToken.)
import { workerUrl } from './rooms'
import { cloudClient, isDesktop } from './supabase'
import { googleAccount, keepGoogleAccount, type GoogleAccount, type SignedOutReason } from './signedIn'

export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
// The Picker's key (APIs & Services > Credentials).
export const GOOGLE_API_KEY = (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? ''
// The project's number, which a client id starts with. The Picker grants
// what's picked to the app by it.
export const GOOGLE_PROJECT_NUMBER = GOOGLE_CLIENT_ID.split('-')[0]

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file'
const SCOPES = `openid email profile ${DRIVE_FILE} https://www.googleapis.com/auth/drive.appdata`
export const FOLDER = 'application/vnd.google-apps.folder'

const loaded = new Map<string, Promise<void>>()
function script(src: string): Promise<void> {
  let once = loaded.get(src)
  if (!once) {
    once = new Promise((resolve, reject) => {
      const tag = document.createElement('script')
      tag.src = src
      tag.async = true
      tag.onload = () => resolve()
      tag.onerror = () => { loaded.delete(src); reject(new Error(`couldn't load ${src}`)) }
      document.head.appendChild(tag)
    })
    loaded.set(src, once)
  }
  return once
}
/** Google's sign-in library, fetched ahead: a popup must open while the click
 *  that asked for it still counts. (Already on the page, it's taken as is.) */
export const loadGoogleSignIn = () => ((window as any).google?.accounts ? Promise.resolve() : script('https://accounts.google.com/gsi/client'))

// Google's pass lasts an hour, and in a browser only a click can open
// Google's window to ask for another. So a browser asks once, in Google's
// code flow; the rooms worker (workers/rooms, google), which holds the app's
// secret, turns the code into a pass and a renewal grant -- sealed so only
// the worker can use it, and only for this account -- and renews the pass
// with it from then on, no window, no click. Without the worker (not set up,
// or failing), the window asks for an hour's pass, as before.
//
// Signing in asks Google only who one is; Drive is asked for the first time
// it's used -- a Drive atrium made or joined, on that click. So a pass, and a
// grant, may or may not reach Drive (`drive`).
let token: { value: string; until: number; drive: boolean } | null = null
// A Google account's: the worker's word for who it is, from the same answers.
let session: { value: string; until: number } | null = null
let renewing: Promise<string> | null = null
let renewal: Promise<boolean> | null = null
const fresh = (held: { until: number } | null) => !!held && Date.now() < held.until - 60_000
const GRANT = 'atrium.driveGrant'
// `drive` false: a grant that renews a Google account's sign-in, not Drive.
// (Grants from before 2026-10-18 all reach Drive, and don't say.)
interface Grant { user: string; grant: string; drive?: boolean }
function grantKept(): Grant | null {
  try { return JSON.parse(localStorage.getItem(GRANT) ?? 'null') } catch { return null }
}
function keepGrant(grant: Grant | null) {
  try { if (grant) localStorage.setItem(GRANT, JSON.stringify(grant)); else localStorage.removeItem(GRANT) } catch { /* this visit only */ }
  connectionChanged()
}
/** Said whenever Drive's connection may have changed: the atrium browser's
 *  indicator (components/DriveConnection) looks again. */
export const DRIVE_CONNECTION_EVENT = 'atrium:drive-connection'
const connectionChanged = () => window.dispatchEvent(new Event(DRIVE_CONNECTION_EVENT))
// For this page: the worker failed at renewing (the button asks instead), or
// at taking a code (the window asks for an hour's pass instead).
let renewFailed = false
let codeFailed = false
const grantServer = workerUrl

/** Google accounts are being tried (phase 6), with Drive atriums: testers
 *  only, by localStorage['atrium.drivespike'] = 'on'. */
export const driveTesting = !isDesktop && (() => { try { return localStorage.getItem('atrium.drivespike') === 'on' } catch { return false } })()

/** A Drive access token: renewed by the worker when this browser has a
 *  grant that reaches Drive, else Google's window (a click's), once. */
export function driveToken(): Promise<string> {
  if (fresh(token) && token!.drive) return Promise.resolve(token!.value)
  return renewing ??= newToken().finally(() => { renewing = null })
}

const reachesDrive = (grant: Grant | null) => !!grant && grant.drive !== false
/** Signed in to Drive now, or able to be without asking: Google's window
 *  can't open without a click, so whoever needs it otherwise asks for one
 *  (lib/driveSync). */
export const hasDriveToken = () => (fresh(token) && token!.drive) || (!renewFailed && !!grantServer() && reachesDrive(grantKept()))

type Answer = {
  access_token?: string; expires_in?: number; scope?: string; grant?: string; session?: string; until?: number
  account?: { id: string; kind: 'google' | 'supabase'; email?: string; name?: string }
  // An existing account's Google kept no grant at the worker (resume); or,
  // signing in, this Google is an existing account's.
  consent?: boolean
  existing?: { account: string; how: 'google' | 'password'; joinable: boolean }
}
const took = (answer: Answer) => {
  if (answer.access_token) {
    token = { value: answer.access_token, until: Date.now() + Number(answer.expires_in) * 1000, drive: allowed(answer.scope) }
    connectionChanged()
  }
  if (answer.session && answer.until) session = { value: answer.session, until: answer.until }
  return token?.value ?? ''
}
const drivePass = () => (fresh(token) && token!.drive ? token!.value : null)

// Who asks: a Google account -- its grant is its sign-in, and its session
// the worker's word for it -- or an existing account, by its Supabase sign-in.
type Asker = { user: string; token: string | null; google: boolean }
async function whoAsks(): Promise<Asker | null> {
  const google = googleAccount()
  if (google) return { user: google.id, token: fresh(session) ? session!.value : null, google: true }
  const signedIn = (await cloudClient?.auth.getSession())?.data.session
  return signedIn ? { user: signedIn.user.id as string, token: signedIn.access_token as string, google: false } : null
}

async function newToken(): Promise<string> {
  const me = await whoAsks()
  if (me && reachesDrive(grantKept()) && await renewOnce(me) && drivePass()) return drivePass()!
  if (me && !me.google && me.token && await resume(me) && drivePass()) return drivePass()!
  // Drive asked for: Google's window, on this click. A Google account's, as
  // that account: with its session, for the worker to hold it to its own
  // Google.
  if (me?.google && !fresh(session)) await renewOnce(me)
  return askGoogle(me?.google ? { ...me, token: fresh(session) ? session!.value : null } : me)
}

// The pass (and a Google account's session) renewed from the grant kept here,
// with no window -- one renewal at a time, whoever asks. False if it can't
// be: none kept, or it failed.
const renewOnce = (me: Asker) => renewal ??= renew(me).finally(() => { renewal = null })
async function renew(me: Asker): Promise<boolean> {
  const kept = grantKept()
  if (kept?.user !== me.user || renewFailed) return false
  try {
    const answer = await askWorker('renew', { grant: kept.grant, ...(me.token && !me.google ? { token: me.token } : {}) })
    // Drive taken back on Google's side: a grant without it, in its place.
    if (answer.grant) keepGrant({ user: kept.user, grant: answer.grant, drive: false })
    took(answer)
    return true
  } catch (error) {
    // A Google account that's really an existing account's (the worker
    // knows): out, and pointed to that account.
    if ((error as Error).message === 'EXISTING_ACCOUNT') {
      signOutGoogle('existingAccount')
      return false
    }
    // Taken back on Google's side, or not this worker's: asked again -- for a
    // Google account, that's signing in again. Anything else (offline, the
    // worker's day spent): the button, this visit.
    if ((error as { refused?: boolean }).refused) {
      keepGrant(null)
      if (googleAccount()) signOutGoogle()
    } else renewFailed = true
    console.warn('[drive] renewing:', error)
    return false
  }
}

// An existing account on a browser without its grant: the grant the worker
// keeps for its Google, with no window. False if it keeps none.
async function resume(me: Asker): Promise<boolean> {
  try {
    const answer = await askWorker('resume', { token: me.token })
    if (answer.consent || !answer.access_token) return false
    keep(answer)
    return true
  } catch (error) {
    console.warn('[drive] resuming:', error)
    return false
  }
}

/** A Google account's session for the worker -- the directory, the rooms --
 *  renewed without a window. Null if it can't be. */
export async function workerSession(): Promise<string | null> {
  if (fresh(session)) return session!.value
  const google = googleAccount()
  if (!google) return null
  await renewOnce({ user: google.id, token: null, google: true })
  return fresh(session) ? session!.value : null
}

/** Signing in with Google: the ID token from Google's own button
 *  (renderGoogleButton) -- one click, asking only who one is; Drive is asked
 *  for later, where it's used. Then a Google account, with no Supabase
 *  account at all -- or, if this Google is an existing account's, that
 *  account to sign in to: by Supabase, with that same ID token, where it will. */
export type GoogleSignIn =
  | { kind: 'google'; account: GoogleAccount }
  | { kind: 'existing'; account: string; how: 'google' | 'password'; joinable: boolean }
export async function signInWithGoogle(idToken: string): Promise<GoogleSignIn> {
  const answer = await askWorker('identity', { id_token: idToken })
  if (answer.existing) {
    // Its grant (Drive given before) is that account's, renewing only with its own sign-in.
    if (answer.grant) keepGrant({ user: answer.existing.account, grant: answer.grant, drive: allowed(answer.scope) })
    took(answer)
    return { kind: 'existing', ...answer.existing }
  }
  keep(answer)
  const account = googleAccount()
  if (!account) throw new Error('Google sign-in failed')
  return { kind: 'google', account }
}
/** Drive given back (components/DriveConnection): Google forgets this app's
 *  access -- on every device -- and nothing here can renew it. A Google
 *  account stays signed in, with a grant that doesn't reach Drive; Drive is
 *  asked for again where it's used. */
export async function disconnectDrive(): Promise<void> {
  const me = await whoAsks()
  if (!me) return
  const kept = grantKept()
  const answer = await askWorker('disconnect', { ...(kept?.user === me.user ? { grant: kept.grant } : {}), ...(me.token && !me.google ? { token: me.token } : {}) })
  token = null
  keepGrant(me.google && answer.grant ? { user: me.user, grant: answer.grant, drive: false } : null)
}

/** The Google account deleted, on a sign-in with its Google just now
 *  (`idToken`, from Google's button): Google told to forget this app, the
 *  account gone from the directory -- and this browser signed out. What it
 *  keeps in its Google Drive stays there, its own. */
export async function deleteGoogleAccount(idToken: string): Promise<void> {
  const google = googleAccount()
  const session = await workerSession()
  if (!google || !session) throw new Error('NOT_SIGNED_IN')
  const kept = grantKept()
  await askWorker('delete', { token: session, id_token: idToken, ...(kept?.user === google.id ? { grant: kept.grant } : {}) })
  signOutGoogle()
}

/** Out: the Google account, its grant and its passes -- and why, if it's
 *  to be said. */
export function signOutGoogle(reason?: SignedOutReason): void {
  token = null
  session = null
  keepGrant(null)
  keepGoogleAccount(null, reason)
}

// A plain request (a string body, no headers of its own): no preflight.
async function askWorker(what: 'grant' | 'renew' | 'identity' | 'resume' | 'disconnect' | 'delete', body: object): Promise<Answer> {
  const response = await fetch(`${grantServer()}/google/${what}`, { method: 'POST', body: JSON.stringify(body) })
  const answer = await response.json().catch(() => ({}))
  // A Google account that's an existing account's (refused at renewal).
  if (answer.error === 'existing account') throw new Error('EXISTING_ACCOUNT')
  if (!response.ok) throw Object.assign(new Error(`Google sign-in ${response.status}: ${answer.error ?? ''}`), { refused: answer.error === 'grant', status: response.status })
  return answer
}

// The worker's answer kept: the account it's for -- a Google account, if no
// one was signed in -- its grant, and its pass.
function keep(answer: Answer) {
  const account = answer.account
  if (account?.kind === 'google') keepGoogleAccount({ id: account.id, email: account.email ?? null, name: account.name ?? null })
  if (answer.grant && account) keepGrant({ user: account.id, grant: answer.grant, drive: allowed(answer.scope) })
  renewFailed = false
  took(answer)
}

// Drive's permission, as granted: each can be unticked on Google's screen.
function allowed(scope: unknown): boolean {
  return typeof scope === 'string' && scope.split(' ').includes(DRIVE_FILE)
}
const closed = (reject: (error: Error) => void) => (error: any) => reject(new Error(error?.message || error?.type || 'sign-in closed'))
async function googleAccounts() {
  if (!GOOGLE_CLIENT_ID) throw new Error("Google sign-in isn't set up in this build (VITE_GOOGLE_CLIENT_ID)")
  await loadGoogleSignIn()
  return (window as any).google.accounts
}
const oauth2 = async () => (await googleAccounts()).oauth2

// Google's button calls one handler a page: the latest button's.
let toCredential: (idToken: string) => void = () => {}
let buttonsReady = false
/** Google's "Sign in with Google" button, drawn by Google (its own frame) in
 *  `box`, in `locale`: one click, and its ID token to `onCredential`. */
export async function renderGoogleButton(box: HTMLElement, locale: string, onCredential: (idToken: string) => void): Promise<void> {
  const { id } = await googleAccounts()
  toCredential = onCredential
  if (!buttonsReady) {
    id.initialize({ client_id: GOOGLE_CLIENT_ID, ux_mode: 'popup', callback: (answer: { credential?: string }) => { if (answer.credential) toCredential(answer.credential) } })
    buttonsReady = true
  }
  id.renderButton(box, { type: 'standard', theme: 'filled_black', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'center', width: Math.min(400, Math.max(200, box.clientWidth)), locale })
}

/** Google's window that asks for Drive (the code flow, which always shows
 *  its consent screen): a code for the worker to turn into a grant. */
async function googleCode(): Promise<string> {
  const client = await oauth2()
  return new Promise<string>((resolve, reject) => {
    client.initCodeClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      ux_mode: 'popup',
      callback: (answer: any) => {
        if (answer.error) return reject(new Error(answer.error_description || answer.error))
        if (!allowed(answer.scope)) return reject(new Error('Drive access was not allowed'))
        resolve(answer.code)
      },
      error_callback: closed(reject),
    }).requestCode()
  })
}

/** Google's window without its consent screen, once consent is given (the
 *  token flow, prompt ''): a pass, of `scope`. */
async function googlePass(scope: string): Promise<string> {
  const client = await oauth2()
  return new Promise<string>((resolve, reject) => {
    client.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      callback: (answer: any) => (answer.error ? reject(new Error(answer.error_description || answer.error)) : resolve(answer.access_token)),
      error_callback: closed(reject),
    }).requestAccessToken({ prompt: '' })
  })
}

async function askGoogle(me: Asker | null): Promise<string> {
  if (grantServer() && !codeFailed) return takeCode(await googleCode(), me)
  // Without the worker: an hour's pass for Drive, no account.
  if (!me) throw new Error("Google sign-in isn't available right now")
  return took({ access_token: await googlePass(SCOPES), expires_in: 3600, scope: SCOPES })
}

/** Google's code for Drive, from its window, turned into a pass and a grant
 *  by the worker, for whoever's signed in -- the worker refusing a Google
 *  account another Google's Drive. */
async function takeCode(code: string, me: Asker | null): Promise<string> {
  let answer: Answer
  try {
    answer = await askWorker('grant', { code, ...(me?.token ? { token: me.token } : {}) })
  } catch (error) {
    // The worker can't yet (no secret set, or out of reach): the next click
    // asks Google for an hour's pass.
    const status = (error as { status?: number }).status
    if (!status || status === 503) codeFailed = true
    throw error
  }
  // Drive for whoever's signed in -- never another account in its place
  // (another Google chosen in the window, without a session to refuse it).
  if (me && (answer.existing || answer.account?.id !== me.user)) throw new Error('Choose the Google account you signed in with')
  keep(answer)
  return token!.value
}

/** Calls tried again on a rate limit or Google's own failure, further apart
 *  each time (Drive's guidance), since the last sign-in. */
export let driveRetries = 0

/** A Drive API call (`upload` for the upload endpoint), as the person signed in. */
export async function drive(path: string, init: RequestInit = {}, upload = false): Promise<Response> {
  const base = upload ? 'https://www.googleapis.com/upload/drive/v3/' : 'https://www.googleapis.com/drive/v3/'
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(base + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await driveToken()}` } })
    const again = response.status === 429 || response.status >= 500
      || (response.status === 403 && /rateLimitExceeded/.test(await response.clone().text()))
    if (!again || attempt >= 5) {
      if (!response.ok) throw new Error(`Drive ${response.status}: ${(await response.text()).slice(0, 300)}`)
      return response
    }
    driveRetries++
    await new Promise(wait => setTimeout(wait, 2 ** attempt * 500 + Math.random() * 500))
  }
}

export interface DriveFile { id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string; version?: string }
const FIELDS = 'id,name,mimeType,size,modifiedTime,version'

export async function createFolder(name: string, parent?: string): Promise<DriveFile> {
  const response = await drive(`files?fields=${FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent && { parents: [parent] }) }),
  })
  return response.json()
}

/** A file written whole: made in `parent`, or (`id`) replaced. Up to 5 MB --
 *  bigger needs Drive's resumable upload. */
export async function writeFile(name: string, content: Blob, place: { parent: string } | { id: string }): Promise<DriveFile> {
  if (content.size > MULTIPART_MOST) return writeLargeFile(name, content, place)
  const boundary = `atrium${crypto.randomUUID()}`
  const meta = 'parent' in place ? { name, parents: [place.parent] } : { name }
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ])
  const response = await drive(
    'parent' in place ? `files?uploadType=multipart&fields=${FIELDS}` : `files/${place.id}?uploadType=multipart&fields=${FIELDS}`,
    { method: 'parent' in place ? 'POST' : 'PATCH', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
    true,
  )
  return response.json()
}

// Drive takes a file with its details in one request up to 5 MB; anything
// bigger (a video) goes as a resumable upload: its details first, then the
// file, to the address Drive answers with.
const MULTIPART_MOST = 5 * 1024 * 1024
async function writeLargeFile(name: string, content: Blob, place: { parent: string } | { id: string }): Promise<DriveFile> {
  const meta = 'parent' in place ? { name, parents: [place.parent] } : { name }
  const started = await drive(
    'parent' in place ? `files?uploadType=resumable&fields=${FIELDS}` : `files/${place.id}?uploadType=resumable&fields=${FIELDS}`,
    {
      method: 'parent' in place ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': content.type || 'application/octet-stream' },
      body: JSON.stringify(meta),
    },
    true,
  )
  const address = started.headers.get('Location')
  if (!address) throw new Error('Drive gave no upload address')
  // ponytail: one request for the whole file; sent in pieces, resumed after a failure, if big videos fail on poor connections.
  const response = await fetch(address, { method: 'PUT', body: content })
  if (!response.ok) throw new Error(`Drive ${response.status}: ${(await response.text()).slice(0, 300)}`)
  return response.json()
}

export const readFile = async (id: string): Promise<Blob> => (await drive(`files/${id}?alt=media`)).blob()

/** What's known of a file without reading it: the cheap call a change check makes. */
export const fileInfo = async (id: string): Promise<DriveFile> => (await drive(`files/${id}?fields=${FIELDS}`)).json()

// Every page of a folder's listing: Drive gives 1000 files a page at most.
async function everyPage(id: string, read: (query: string) => Promise<{ files?: DriveFile[]; nextPageToken?: string }>): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${id}' in parents and trashed = false`)
  const files: DriveFile[] = []
  let page = ''
  do {
    const answer = await read(`files?q=${q}&fields=nextPageToken,files(${FIELDS})&pageSize=1000${page && `&pageToken=${encodeURIComponent(page)}`}`)
    files.push(...(answer.files ?? []))
    page = answer.nextPageToken ?? ''
  } while (page)
  return files
}

export const listFolder = (id: string): Promise<DriveFile[]> => everyPage(id, async query => (await drive(query)).json())

/** Shared with someone by their Google address; Google emails them unless
 *  `quietly`. The permission's id, to take it back (unshare). */
export async function shareWith(id: string, email: string, role: 'reader' | 'writer', quietly = false): Promise<string> {
  const response = await drive(`files/${id}/permissions?sendNotificationEmail=${!quietly}&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  })
  return (await response.json()).id
}

export async function unshare(id: string, permission: string): Promise<void> {
  await drive(`files/${id}/permissions/${permission}`, { method: 'DELETE' })
}

/** Those it's shared with to edit can't share it on: only its owner can. */
export async function noResharing(id: string): Promise<void> {
  await drive(`files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ writersCanShare: false }) })
}

export async function trash(id: string): Promise<void> {
  await drive(`files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
}

/** A file in the app's hidden folder of the signed-in account's Drive, by
 *  name; null if there's none. Signed in, so no robot check. */
export async function readAppData(name: string): Promise<Blob | null> {
  const found = await appDataFile(name)
  return found ? (await drive(`files/${found}?alt=media`)).blob() : null
}
export async function writeAppData(name: string, content: Blob): Promise<void> {
  const found = await appDataFile(name)
  await writeFile(name, content, found ? { id: found } : { parent: 'appDataFolder' })
}
async function appDataFile(name: string): Promise<string | null> {
  const q = encodeURIComponent(`name = '${name}'`)
  return (await (await drive(`files?spaces=appDataFolder&q=${q}&fields=files(id)`)).json()).files?.[0]?.id ?? null
}

/** Readable by anyone who has its id -- Drive's "anyone with the link". */
export async function shareByLink(id: string): Promise<void> {
  await drive(`files/${id}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  })
}

/** A file shared by link, read with the app's key alone: no one signed in, so
 *  nothing drive.file has to have granted. */
export async function readByLink(id: string): Promise<Blob> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${GOOGLE_API_KEY}`)
  if (!response.ok) throw new Error(`Drive ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response.blob()
}

/** A file shared by link's version, read with the key alone -- its details,
 *  not its contents. Google lets details be read freely, but counts
 *  anonymous downloads, and answers too many of them from one network with a
 *  robot check (seen 2026-10-16): so content is downloaded only once it has
 *  changed. */
export async function versionByLink(id: string): Promise<string> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=version&key=${GOOGLE_API_KEY}`)
  if (!response.ok) throw new Error(`Drive ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return (await response.json()).version
}

/** What's in a folder shared by link, listed with the app's key alone. */
export const listByLink = (id: string): Promise<DriveFile[]> => everyPage(id, async query => {
  const response = await fetch(`https://www.googleapis.com/drive/v3/${query}&key=${GOOGLE_API_KEY}`)
  if (!response.ok) throw new Error(`Drive ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return response.json()
})

export const whoAmI = async (): Promise<{ displayName: string; emailAddress: string }> =>
  (await (await drive('about?fields=user(displayName,emailAddress)')).json()).user

/** One file, chosen through the Picker -- shown that file alone. Picking it
 *  is what lets the app open it under drive.file: the head of a Drive
 *  atrium, for someone joining it. */
export async function pickFile(id: string): Promise<string | null> {
  if (!GOOGLE_API_KEY) throw new Error("the Picker isn't set up in this build (VITE_GOOGLE_API_KEY)")
  const oauth = await driveToken()
  await script('https://apis.google.com/js/api.js')
  const gapi = (window as any).gapi
  await new Promise<void>(done => gapi.load('picker', done))
  const { picker } = (window as any).google
  return new Promise(resolve => {
    new picker.PickerBuilder()
      .addView(new picker.DocsView().setFileIds(id))
      .setOAuthToken(oauth)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_PROJECT_NUMBER)
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs[0].id)
        else if (data.action === picker.Action.CANCEL) resolve(null)
      })
      .build()
      .setVisible(true)
  })
}

/** A folder chosen through Google's Picker -- how someone a folder was shared
 *  with gives the app access to it, which drive.file asks for. */
export async function pickFolder(): Promise<DriveFile | null> {
  if (!GOOGLE_API_KEY) throw new Error("the Picker isn't set up in this build (VITE_GOOGLE_API_KEY)")
  const oauth = await driveToken()
  await script('https://apis.google.com/js/api.js')
  const gapi = (window as any).gapi
  await new Promise<void>(done => gapi.load('picker', done))
  const { picker } = (window as any).google
  return new Promise(resolve => {
    new picker.PickerBuilder()
      .addView(new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setOwnedByMe(false))
      .setOAuthToken(oauth)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_PROJECT_NUMBER)
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) resolve({ id: data.docs[0].id, name: data.docs[0].name })
        else if (data.action === picker.Action.CANCEL) resolve(null)
      })
      .build()
      .setVisible(true)
  })
}
