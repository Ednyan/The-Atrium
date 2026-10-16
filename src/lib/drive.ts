// Google Drive for atriums (docs/DECENTRALIZING.md, phase 4): signing in with
// Google for Drive, and the Drive calls an atrium kept there needs. Web only
// for now -- the desktop needs a client of its own and a loopback sign-in.
//
// Both are public by design -- they end up in the page -- and come from the
// build's environment (.env here, Cloudflare's build variables live), as
// Supabase's and Pinterest's do: kept out of the repository, and changed
// without a commit. What guards them is Google's list of sites the client may
// sign in from, and the key's restriction to this site and these APIs. (The
// client *secret* is never here, and isn't needed: a browser signs in
// without one.)
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
/** Google's sign-in library, fetched ahead: a popup must open while the click that asked for it still counts. */
export const loadGoogleSignIn = () => script('https://accounts.google.com/gsi/client')

let token: { value: string; until: number } | null = null

/** A Drive access token: Google's popup the first time in a session (consent
 *  the first time ever), then silent until it's about to run out. Tokens
 *  live an hour, and nothing outlives the page. */
export async function driveToken(): Promise<string> {
  if (token && Date.now() < token.until - 60_000) return token.value
  if (!GOOGLE_CLIENT_ID) throw new Error("Google sign-in isn't set up in this build (VITE_GOOGLE_CLIENT_ID)")
  await loadGoogleSignIn()
  const { oauth2 } = (window as any).google.accounts
  return new Promise((resolve, reject) => {
    oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (answer: any) => {
        if (answer.error) return reject(new Error(answer.error_description || answer.error))
        // Each permission can be unticked on Google's screen.
        if (!oauth2.hasGrantedAllScopes(answer, DRIVE_FILE)) return reject(new Error('Drive access was not allowed'))
        token = { value: answer.access_token, until: Date.now() + Number(answer.expires_in) * 1000 }
        resolve(token.value)
      },
      error_callback: (error: any) => reject(new Error(error?.message || error?.type || 'sign-in closed')),
    }).requestAccessToken({ prompt: '' })
  })
}

/** Signed in to Drive now, without asking: Google's window can't open
 *  without a click, so whoever needs it otherwise asks for one (lib/driveSync). */
export const hasDriveToken = () => !!token && Date.now() < token.until - 60_000

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

export const readFile = async (id: string): Promise<Blob> => (await drive(`files/${id}?alt=media`)).blob()

/** What's known of a file without reading it: the cheap call a change check makes. */
export const fileInfo = async (id: string): Promise<DriveFile> => (await drive(`files/${id}?fields=${FIELDS}`)).json()

export async function listFolder(id: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${id}' in parents and trashed = false`)
  return (await (await drive(`files?q=${q}&fields=files(${FIELDS})&pageSize=1000`)).json()).files ?? []
}

/** Shared with someone by their Google address; Google emails them unless `quietly`. */
export async function shareWith(id: string, email: string, role: 'reader' | 'writer', quietly = false): Promise<void> {
  await drive(`files/${id}/permissions?sendNotificationEmail=${!quietly}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role, emailAddress: email }),
  })
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

/** What's in a folder shared by link, listed with the app's key alone. */
export async function listByLink(id: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${id}' in parents and trashed = false`)
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(${FIELDS})&pageSize=1000&key=${GOOGLE_API_KEY}`)
  if (!response.ok) throw new Error(`Drive ${response.status}: ${(await response.text()).slice(0, 200)}`)
  return (await response.json()).files ?? []
}

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
