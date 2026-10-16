// A Drive atrium (docs/DECENTRALIZING.md, phase 5): an atrium kept in this
// browser (lib/browserAtriums) and in step with a folder in Google Drive.
//
// Up: once the working copy has been written, what changed since what's
// merged (lib/driveFormat, changesSince) goes to Drive as one sealed save, in
// this person's own folder, which is shared by link.
// Down: each member's folder is listed with the app's key; saves not read yet
// are read, opened and merged, and the changes that took are written into the
// working copy and handed to the open atrium (lib/liveChanges, tellHere).
//
// One at a time, and up before down: what comes down never lands while a diff
// is being taken, and an edit made here reaches Drive before the next pull
// can be told it's older.

import * as drive from './drive'
import {
  changesSince, keyFromText, keyToText, later, merge, newAtriumKey, sealJson, tick, unsealJson,
  type Change, type Clock, type DriveSave, type Merged, type Table,
} from './driveFormat'
import { tellHere, type LiveTable } from './liveChanges'

/** What the sync needs of Drive: lib/drive, or a stand-in (the harness). */
export interface DriveStore {
  /** Can write now, without asking anyone to sign in. */
  canWrite(): boolean
  createFolder(name: string, parent?: string): Promise<{ id: string }>
  shareByLink(id: string): Promise<void>
  write(name: string, bytes: Uint8Array, place: { parent: string } | { id: string }): Promise<{ id: string }>
  readByLink(id: string): Promise<Uint8Array>
  listByLink(folder: string): Promise<{ id: string; name: string }[]>
}
const googleDrive: DriveStore = {
  canWrite: drive.hasDriveToken,
  createFolder: drive.createFolder,
  shareByLink: drive.shareByLink,
  write: (name, bytes, place) => drive.writeFile(name, new Blob([bytes as BlobPart]), place),
  readByLink: async id => new Uint8Array(await (await drive.readByLink(id)).arrayBuffer()),
  listByLink: drive.listByLink,
}
let store: DriveStore = googleDrive
export const useDriveStore = (next: DriveStore) => { store = next }

// ---------------------------------------------------------------- which atriums

// This browser's Drive atriums: their head file, this person's folder in
// them, and their key. In localStorage beside lib/browserAtriums' list.
interface Kept { head: string; folder: string; key: string }
const KEPT = 'atrium.driveAtriums'
function allKept(): Record<string, Kept> {
  try { return JSON.parse(localStorage.getItem(KEPT) || '{}') ?? {} } catch { return {} }
}
export const isDriveAtrium = (lobbyId: string) => lobbyId in allKept()
function keep(lobbyId: string, kept: Kept | null) {
  const all = allKept()
  if (kept) all[lobbyId] = kept
  else delete all[lobbyId]
  try { localStorage.setItem(KEPT, JSON.stringify(all)) } catch { /* this visit only */ }
}
export const forgetDriveAtrium = (lobbyId: string) => keep(lobbyId, null)

// The head: the atrium's own id and who's in it -- whose folders to read.
interface Member { user: string; name: string; folder: string }
interface Head { v: 1; lobbyId: string; members: Member[] }

/** A new Drive atrium, of the atrium kept in this browser as `lobbyId`: its
 *  folder shared by link, its key, its head. Its first save, all of it, goes
 *  up when it's opened (startDriveSync). */
export async function createDriveAtrium(lobbyId: string, name: string, me: { id: string; name: string }): Promise<void> {
  const key = await newAtriumKey()
  const folder = await store.createFolder(`${name} (Digital Atrium)`)
  await store.shareByLink(folder.id)
  const head: Head = { v: 1, lobbyId, members: [{ user: me.id, name: me.name, folder: folder.id }] }
  const headFile = await store.write('atrium.head', await sealJson(key, head), { parent: folder.id })
  keep(lobbyId, { head: headFile.id, folder: folder.id, key: await keyToText(key) })
}

// ---------------------------------------------------------------- in step, while open

// How long after the last write a save goes up, and how often others' are looked for.
const QUIET_MS = 1500
const LOOK_MS = 20_000
// Saves read side by side.
const AT_ONCE = 6

interface State { merged: Change[]; seen: string[]; last: Clock | null }
interface Session {
  lobbyId: string
  me: string
  kept: Kept
  key: CryptoKey
  merged: Merged
  seen: Set<string>
  last: Clock | null
  queue: Promise<void>
  quiet: number
  looking: number
  local: typeof import('./localDb')
}
let session: Session | null = null

const statePath = (lobbyId: string) => ['drive', `${lobbyId}.json`]
const persist = (s: Session) => s.local.writeVaultJson(statePath(s.lobbyId), { merged: [...s.merged.values()], seen: [...s.seen], last: s.last } satisfies State)
const run = (s: Session, task: (s: Session) => Promise<void>) => {
  s.queue = s.queue.then(() => task(s)).catch(error => console.warn('[drive] sync:', error))
  return s.queue
}

/** In step with Drive while `lobbyId` is open: up after writes, others' down every little while. */
export async function startDriveSync(lobbyId: string, me: string): Promise<void> {
  await stopDriveSync()
  const kept = allKept()[lobbyId]
  if (!kept) return
  const local = await import('./localDb')
  const state = await local.readVaultJson<State>(statePath(lobbyId), { merged: [], seen: [], last: null })
  const merged: Merged = new Map()
  merge(merged, state.merged)
  const s: Session = {
    lobbyId, me, kept, key: await keyFromText(kept.key), merged, seen: new Set(state.seen), last: state.last,
    queue: Promise.resolve(), quiet: 0, looking: 0, local,
  }
  session = s
  local.listenToLocalWrites(() => {
    window.clearTimeout(s.quiet)
    s.quiet = window.setTimeout(() => { if (session === s) void run(s, up) }, QUIET_MS)
  })
  const both = async (x: Session) => { await up(x); await down(x) }
  void run(s, both)
  s.looking = window.setInterval(() => { if (session === s) void run(s, both) }, LOOK_MS)
}

/** Out of step: what was left to go up goes, then nothing more. */
export async function stopDriveSync(): Promise<void> {
  const s = session
  if (!s) return
  session = null
  window.clearTimeout(s.quiet)
  window.clearInterval(s.looking)
  s.local.listenToLocalWrites(null)
  await run(s, up)
  needSignIn(false)
}

// Writing needs Google's sign-in, which needs a click: while it's missing,
// saves wait here and a button asks (components/DriveReconnect). Reading
// doesn't need it -- everything is read by link.
let signInNeeded = false
const signInWatchers = new Set<(needed: boolean) => void>()
function needSignIn(needed: boolean) {
  if (signInNeeded === needed) return
  signInNeeded = needed
  signInWatchers.forEach(watcher => watcher(needed))
}
export function watchDriveSignIn(watcher: (needed: boolean) => void): () => void {
  signInWatchers.add(watcher)
  watcher(signInNeeded)
  return () => { signInWatchers.delete(watcher) }
}
/** On a click: Google's window, then what waited goes up. */
export async function reconnectDrive(): Promise<void> {
  await drive.driveToken()
  needSignIn(false)
  await syncNow()
}

/** Now, rather than at the next look: up, then down. For tests and a "sync now". */
export const syncNow = () => (session ? run(session, async s => { await up(s); await down(s) }) : Promise.resolve())

async function up(s: Session): Promise<void> {
  const at = tick(s.last, Date.now(), s.me)
  const changes = changesSince(s.merged, await s.local.atriumRows(s.lobbyId), at)
  if (!changes.length) return
  // Kept for later: the next diff still has them.
  if (!store.canWrite()) { needSignIn(true); return }
  const save: DriveSave = { v: 1, changes }
  const file = await store.write(`${at}.save`, await sealJson(s.key, save), { parent: s.kept.folder })
  merge(s.merged, changes)
  s.last = at
  s.seen.add(file.id)
  await persist(s)
}

async function down(s: Session): Promise<void> {
  const head = await unsealJson<Head>(s.key, await store.readByLink(s.kept.head))
  const unread: { id: string }[] = []
  for (const member of head.members) {
    for (const file of await store.listByLink(member.folder)) if (file.name.endsWith('.save') && !s.seen.has(file.id)) unread.push(file)
  }
  if (!unread.length) return
  const took = new Map<string, Change>()
  for (let at = 0; at < unread.length; at += AT_ONCE) {
    const saves = await Promise.all(unread.slice(at, at + AT_ONCE).map(async file =>
      ({ id: file.id, save: await unsealJson<DriveSave>(s.key, await store.readByLink(file.id)) })))
    for (const { id, save } of saves) {
      for (const change of merge(s.merged, save.changes)) took.set(`${change.table}/${change.id}`, change)
      for (const change of save.changes) s.last = later(s.last, change.at)
      s.seen.add(id)
    }
  }
  // Each row as it ends up merged, not as each save had it on the way.
  await bringIn(s, [...took.keys()].map(key => s.merged.get(key)!))
  await persist(s)
}

const LIVE: Partial<Record<Table, LiveTable>> = { traces: 'traces', layers: 'layers', trace_links: 'trace_links', lobby_locations: 'lobby_locations' }

async function bringIn(s: Session, changes: Change[]): Promise<void> {
  for (const table of new Set(changes.map(change => change.table))) {
    const mine = changes.filter(change => change.table === table)
    let rows = mine.filter(change => change.row).map(change => change.row!) as Record<string, any>[]
    const gone = mine.filter(change => !change.row).map(change => change.id)
    // The atrium's own row keeps what's this device's (lib/driveFormat, carried).
    if (table === 'lobbies') {
      const here = (await s.local.atriumRows(s.lobbyId)).lobbies[0] ?? {}
      rows = rows.map(row => ({ ...here, ...row }))
    }
    await s.local.takeAtriumRows(s.lobbyId, table, rows, gone)
    const live = LIVE[table]
    if (live) tellHere({ t: live, ...(rows.length ? { ids: rows.map(row => String(row.id)) } : {}), ...(gone.length ? { gone } : {}) })
  }
}
