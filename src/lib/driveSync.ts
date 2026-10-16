// A Drive atrium (docs/DECENTRALIZING.md, phase 5): an atrium kept in this
// browser (lib/browserAtriums) and in step with Google Drive, readable by its
// members alone.
//
// Where it is: each person has a folder for atriums in their own Drive,
// shared by link, and in it a folder per atrium, named by its id, holding
// their saves to it, sealed. The owner's also holds the roster
// (lib/driveFormat): who's a member, their roles, and the atrium's key
// encrypted for each. Only the owner and admins can write the roster --
// Google decides that, by who it's shared with.
//
// Up: once the working copy has been written, what changed since what's
// merged goes to Drive as one sealed save, and through the room to whoever's
// there. Down: the roster when it has moved, then each writer's folder,
// listed with the app's key; saves not read yet are read, opened, merged, and
// what took is written into the working copy and handed to the open atrium
// (lib/liveChanges, tellHere). The owner's and admins' apps also let in whom
// they've added, once those people have a key pair.
//
// One at a time, so what comes down never lands while a diff is taken; and
// down before up -- the user's rule, the first save wins.

import * as drive from './drive'
import { cloudClient } from './supabase'
import {
  admit, base64ToBytes, bytesToBase64, changesSince, invitedWritersOf, KeyMissing, keyFromText, keyringOf, keyToText, later, manages,
  memberOf, merge, newAtriumKey, newIdentity, newRoster, newSecret, openWithSecret, placeOf, removeMember, sealForSecret, sealJson, tick, unsealJson, writersOf,
  type Change, type Clock, type DriveSave, type Identity, type Keyring, type Member, type Merged, type Role, type Roster, type Table,
} from './driveFormat'
import { tellHere, type LiveTable } from './liveChanges'
import { onRoomEvent, sendThroughRoom } from './rooms'

/** What the sync needs of Drive: lib/drive, or a stand-in (the harness). */
export interface DriveStore {
  /** Can write now, without asking anyone to sign in. */
  canWrite(): boolean
  /** Google's window, on a click. */
  signIn(): Promise<void>
  /** One file picked in the Picker, so the app may open it; null if not. */
  pick(id: string): Promise<string | null>
  createFolder(name: string, parent?: string): Promise<{ id: string }>
  shareByLink(id: string): Promise<void>
  write(name: string, bytes: Uint8Array, place: { parent: string } | { id: string }): Promise<{ id: string }>
  readByLink(id: string): Promise<Uint8Array>
  /** A file's version, without downloading it. */
  version(id: string): Promise<string>
  listByLink(folder: string): Promise<{ id: string; name: string }[]>
  readAppData(name: string): Promise<Uint8Array | null>
  writeAppData(name: string, bytes: Uint8Array): Promise<void>
  /** Shared with someone to edit, quietly; the permission's id. */
  shareWith(id: string, email: string): Promise<string>
  unshare(id: string, permission: string): Promise<void>
  noResharing(id: string): Promise<void>
  trash(id: string): Promise<void>
}
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())
const googleDrive: DriveStore = {
  canWrite: drive.hasDriveToken,
  signIn: async () => { await drive.driveToken() },
  pick: drive.pickFile,
  createFolder: drive.createFolder,
  shareByLink: drive.shareByLink,
  write: (name, bytes, place) => drive.writeFile(name, new Blob([bytes as BlobPart]), place),
  readByLink: async id => bytesOf(await drive.readByLink(id)),
  version: drive.versionByLink,
  listByLink: drive.listByLink,
  readAppData: async name => { const blob = await drive.readAppData(name); return blob && bytesOf(blob) },
  writeAppData: (name, bytes) => drive.writeAppData(name, new Blob([bytes as BlobPart])),
  shareWith: (id, email) => drive.shareWith(id, email, 'writer', true),
  unshare: drive.unshare,
  noResharing: drive.noResharing,
  trash: drive.trash,
}
let store: DriveStore = googleDrive
export const useDriveStore = (next: DriveStore) => { store = next }

const asJson = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const fromJson = <T>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes))
const readRoster = async (id: string) => fromJson<Roster>(await store.readByLink(id))

// ---------------------------------------------------------------- one's own key pair

// Made the first time one uses a Drive atrium: the pair (its private half in
// one's Google account's hidden app folder, so every device signed in to it
// has it) and one's folder for atriums, shared by link. Their public parts go
// in one's profile, for whoever adds one to an atrium.
interface Mine { user: string; identity: Identity; root: string }
const IDENTITY_FILE = 'atrium-identity.json'
const IDENTITY_HERE = 'atrium.driveIdentity'
let mine: Mine | null = null

export async function myIdentity(me: { id: string }): Promise<Mine> {
  if (mine?.user === me.id) return mine
  try {
    const here = JSON.parse(localStorage.getItem(IDENTITY_HERE) || 'null') as Mine | null
    if (here?.user === me.id) return (mine = here)
  } catch { /* none kept */ }
  const kept = await store.readAppData(IDENTITY_FILE)
  let found = kept ? fromJson<{ identity: Identity; root: string }>(kept) : null
  if (!found) {
    const root = await store.createFolder('Digital Atrium')
    await store.shareByLink(root.id)
    found = { identity: await newIdentity(), root: root.id }
    await store.writeAppData(IDENTITY_FILE, asJson(found))
  }
  const { error } = await (cloudClient.from('profiles') as any).update({ drive_key: found.identity.publicJwk, drive_root: found.root }).eq('id', me.id)
  if (error) throw new Error(/drive_key|drive_root/.test(error.message ?? '') ? 'DB_UPDATE_NEEDED' : error.message)
  mine = { user: me.id, ...found }
  try { localStorage.setItem(IDENTITY_HERE, JSON.stringify(mine)) } catch { /* fetched again next time */ }
  return mine
}

// ---------------------------------------------------------------- which atriums

// This browser's Drive atriums: the roster's file, one's own folder in it,
// and the generations of its key one has opened.
interface Kept { roster: string; folder: string; keys: Record<string, string>; owner?: boolean }
const KEPT = 'atrium.driveAtriums'
function allKept(): Record<string, Kept> {
  try {
    const all = JSON.parse(localStorage.getItem(KEPT) || '{}') ?? {}
    // Drive atriums from before members (a head and a shared key) aren't these.
    return Object.fromEntries(Object.entries(all).filter(([, kept]) => typeof (kept as Kept)?.roster === 'string')) as Record<string, Kept>
  } catch {
    return {}
  }
}
export const isDriveAtrium = (lobbyId: string) => lobbyId in allKept()
function keep(lobbyId: string, kept: Kept | null) {
  const all = allKept()
  if (kept) all[lobbyId] = kept
  else delete all[lobbyId]
  try { localStorage.setItem(KEPT, JSON.stringify(all)) } catch { /* this visit only */ }
}
export const forgetDriveAtrium = (lobbyId: string) => keep(lobbyId, null)
/** Its owner's, here: Delete takes it out of Drive; anyone else's leaves. */
export const isDriveOwner = (lobbyId: string) => !!allKept()[lobbyId]?.owner
/** Google's window, if need be, first thing on a click (it can't open later). */
export const ensureSignedIn = () => store.signIn()

async function keyringFrom(kept: Kept): Promise<Keyring> {
  return new Map(await Promise.all(Object.entries(kept.keys).map(async ([n, text]) => [Number(n), await keyFromText(text)] as [number, CryptoKey])))
}
async function keysOf(keyring: Keyring): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all([...keyring].map(async ([n, key]) => [String(n), await keyToText(key)])))
}

/** One's folder for this atrium in one's folder for atriums: found, or made. */
async function folderFor(root: string, lobbyId: string): Promise<string> {
  const there = (await store.listByLink(root)).find(file => file.name === lobbyId)
  return there?.id ?? (await store.createFolder(lobbyId, root)).id
}

/** A new Drive atrium, of the atrium kept in this browser as `lobbyId`: its
 *  owner's folder, its first key, its roster. Its first save, all of it, goes
 *  up when it's opened (startDriveSync). Signed in to Google already. */
export async function createDriveAtrium(lobbyId: string, name: string, me: { id: string; name: string }): Promise<void> {
  const own = await myIdentity(me)
  const key = await newAtriumKey()
  const folder = await folderFor(own.root, lobbyId)
  const roster = await newRoster(lobbyId, name, { user: me.id, name: me.name, root: own.root, pub: own.identity.publicJwk }, key)
  const file = await store.write('atrium.roster', asJson(roster), { parent: folder })
  // Admins it's shared with to edit can't share it on: only the owner makes admins.
  await store.noResharing(file.id)
  keep(lobbyId, { roster: file.id, folder, keys: await keysOf(new Map([[0, key]])), owner: true })
  // A clean slate: what an earlier sync of this atrium kept (what it merged,
  // what it read) isn't this one's, and would stop its first save -- all of
  // it -- from ever going up.
  await (await import('./localDb')).writeVaultJson(statePath(lobbyId), { merged: [], seen: [], last: null } satisfies State)
}

/** An atrium kept in this browser, kept in Drive too, at any time: made a
 *  Drive atrium, and all of it sent up now rather than when it's next opened. */
export async function keepInDrive(lobbyId: string, name: string, me: { id: string; name: string }): Promise<void> {
  await createDriveAtrium(lobbyId, name, me)
  await startDriveSync(lobbyId, me.id)
  await syncNow()
  await stopDriveSync()
}

// ---------------------------------------------------------------- invites and joining

// An invite names the roster only: whoever has it sees the atrium's name, and
// gets in only as someone added (addPerson).
export const INVITE_PREFIX = '#join='
export function inviteLink(lobbyId: string): string | null {
  const kept = allKept()[lobbyId]
  return kept ? `${location.origin}/browse${INVITE_PREFIX}${kept.roster}` : null
}
export function inviteIn(hash: string): string | null {
  return hash.startsWith(INVITE_PREFIX) && hash.length > INVITE_PREFIX.length ? hash.slice(INVITE_PREFIX.length) : null
}
/** The roster's version, without downloading it: what someone waiting to be
 *  let in watches -- a download every few seconds is what Google's robot
 *  check answers. */
export const rosterVersion = (rosterId: string) => store.version(rosterId)

/** What an invite is to: read by link, no one signed in. */
export async function readInvite(rosterId: string): Promise<{ lobbyId: string; name: string; owner: string }> {
  const roster = await readRoster(rosterId)
  return { lobbyId: roster.lobbyId, name: roster.name, owner: roster.members.find(member => member.role === 'owner')?.name ?? '' }
}

/** How far a join has got, to say while it's under way. */
export type JoinStep = 'signIn' | 'keys' | 'folder'
/** In: a member. Waiting: added, and let in by the next owner's or admin's
 *  app to look (now that one has a key pair). Not added, or blocked. */
export type JoinResult = { lobbyId: string; state: 'in' | 'waiting' | 'notAdded' | 'blocked' }

/** Into an atrium one's been added to: signed in, one's key pair, and -- a
 *  member -- one's folder for it, and its key. Again, while waiting, until in. */
export async function joinDriveAtrium(rosterId: string, me: { id: string; name: string }, onStep: (step: JoinStep) => void = () => {}): Promise<JoinResult> {
  onStep('signIn')
  await store.signIn()
  onStep('keys')
  const own = await myIdentity(me)
  const roster = await readRoster(rosterId)
  const lobbyId = roster.lobbyId
  if (roster.blocked.includes(me.id)) return { lobbyId, state: 'blocked' }
  const member = memberOf(roster, me.id)
  // A member with this key pair (one made elsewhere waits to be let in again).
  if (member && JSON.stringify(member.pub) === JSON.stringify(own.identity.publicJwk)) {
    onStep('folder')
    const folder = await folderFor(own.root, lobbyId)
    keep(lobbyId, { roster: rosterId, folder, keys: await keysOf(await keyringOf(roster, me.id, own.identity.privateJwk)), owner: member.role === 'owner' })
    return { lobbyId, state: 'in' }
  }
  // Added before one had a key pair: in at once, by the invitation's secret
  // (the Atrium's invitations, one's own alone).
  const invited = roster.invited.find(invite => invite.user === me.id)
  if (invited?.keys) {
    const { data } = await (cloudClient.from('drive_invites') as any).select('secret').eq('to_user', me.id).eq('roster', rosterId).maybeSingle()
    if (data?.secret) {
      const keyring = await openWithSecret(base64ToBytes(data.secret), invited.keys)
      onStep('folder')
      const folder = await folderFor(own.root, lobbyId)
      keep(lobbyId, { roster: rosterId, folder, keys: await keysOf(keyring), owner: false })
      return { lobbyId, state: 'in' }
    }
  }
  return { lobbyId, state: member || invited ? 'waiting' : 'notAdded' }
}

// ---------------------------------------------------------------- invitations

// One's invitations to Drive atriums, in the Atrium's own small table: which
// atrium (its roster in Drive), its name, and who added one -- shown in the
// atrium browser, so nobody needs a link (add_drive_invites.sql).
export interface Invitation { id: string; roster: string; lobbyId: string; name: string; from: string }
export async function myInvitations(me: string): Promise<Invitation[]> {
  const { data, error } = await (cloudClient.from('drive_invites') as any).select('id, roster, lobby_id, name, from_user').eq('to_user', me)
  if (error || !data?.length) return []
  const { data: senders } = await (cloudClient.from('profiles') as any).select('id, username, display_name').in('id', [...new Set(data.map((row: any) => row.from_user))])
  const names = new Map<string, string>((senders ?? []).map((row: any) => [row.id, row.display_name || row.username]))
  return data
    .filter((row: any) => !isDriveAtrium(row.lobby_id))
    .map((row: any) => ({ id: row.id, roster: row.roster, lobbyId: row.lobby_id, name: row.name, from: names.get(row.from_user) ?? '' }))
}
export async function declineInvitation(id: string): Promise<void> {
  await (cloudClient.from('drive_invites') as any).delete().eq('id', id)
}
// Told to someone added, in their atrium browser: with the secret that opens
// it if they have no key pair yet. Never a second secret for an invitation
// still standing -- the roster's sealed keys answer to the first.
async function invite(to: string, from: string, roster: Roster, rosterId: string, secret: Uint8Array | null): Promise<void> {
  const table = cloudClient.from('drive_invites') as any
  const { error } = await table.upsert({ to_user: to, from_user: from, roster: rosterId, lobby_id: roster.lobbyId, name: roster.name, secret: secret && bytesToBase64(secret) }, { onConflict: 'to_user,roster' })
  if (error) throw new Error(/drive_invites/.test(error.message ?? '') ? 'DB_UPDATE_NEEDED' : error.message)
}

// ---------------------------------------------------------------- members: adding, roles, removing

/** The roster as it stands, and one's role in it. */
export async function driveMembers(lobbyId: string, me: string): Promise<{ roster: Roster; role: Role | null }> {
  const kept = allKept()[lobbyId]
  if (!kept) throw new Error('not a Drive atrium')
  const roster = await readRoster(kept.roster)
  return { roster, role: memberOf(roster, me)?.role ?? null }
}

// The roster rewritten, by its owner or an admin: Google refuses anyone else.
// An admin's app opens it once through the Picker (drive.file opens nothing
// else) -- asked on their first change.
async function writeRoster(kept: Kept, roster: Roster): Promise<void> {
  try {
    await store.write('atrium.roster', asJson(roster), { id: kept.roster })
  } catch (error) {
    if (!/Drive 40[34]/.test(String(error))) throw error
    if (!(await store.pick(kept.roster))) throw new Error('PICK_CANCELLED')
    await store.write('atrium.roster', asJson(roster), { id: kept.roster })
  }
}

// A change to the roster: read fresh, changed, written, and the keys this
// browser holds kept up with it.
async function changeRoster(lobbyId: string, me: string, change: (roster: Roster, keyring: Keyring) => Promise<{ roster: Roster; keyring?: Keyring }>): Promise<void> {
  const kept = allKept()[lobbyId]
  if (!kept) throw new Error('not a Drive atrium')
  const roster = await readRoster(kept.roster)
  if (!manages(memberOf(roster, me)?.role)) throw new Error('NOT_A_MANAGER')
  const keyring = await keyringFrom(kept)
  const next = await change(roster, keyring)
  await writeRoster(kept, next.roster)
  if (next.keyring) keep(lobbyId, { ...kept, keys: await keysOf(next.keyring) })
  if (session?.lobbyId === lobbyId) {
    session.roster = null
    if (next.keyring) session.keyring = next.keyring
  }
}

/** Someone added, by their username: let in now if they have a key pair,
 *  else invited -- let in by the next owner's or admin's app to look once
 *  they've opened the invite. */
export async function addPerson(lobbyId: string, me: string, username: string, role: Exclude<Role, 'owner'>): Promise<'in' | 'invited'> {
  return add(lobbyId, me, await profileBy('username', username.trim().replace(/^@/, '')), role)
}

/** Their invitation sent again: let in now if they've a key pair since, else a
 *  fresh secret -- for someone invited before invitations carried one. */
export async function resendInvitation(lobbyId: string, me: string, user: string): Promise<'in' | 'invited'> {
  const kept = allKept()[lobbyId]
  if (!kept) throw new Error('not a Drive atrium')
  const invited = (await readRoster(kept.roster)).invited.find(invite => invite.user === user)
  return add(lobbyId, me, await profileBy('id', user), invited?.role === 'viewer' ? 'viewer' : 'editor')
}

const profileBy = async (column: 'id' | 'username', value: string) => {
  const { data, error } = await (cloudClient.from('profiles') as any).select('id, username, display_name, drive_key, drive_root').eq(column, value).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('NO_SUCH_USER')
  return data as { id: string; username: string; display_name: string | null; drive_key: JsonWebKey | null; drive_root: string | null }
}

async function add(lobbyId: string, me: string, data: Awaited<ReturnType<typeof profileBy>>, role: Exclude<Role, 'owner'>): Promise<'in' | 'invited'> {
  let result: 'in' | 'invited' = 'invited'
  let secret: Uint8Array | null = null
  let after: Roster | null = null
  await changeRoster(lobbyId, me, async (roster, keyring) => {
    if (roster.blocked.includes(data.id)) throw new Error('BLOCKED')
    const name = data.display_name || data.username
    if (data.drive_key && data.drive_root) {
      result = 'in'
      return { roster: (after = await admit(roster, keyring, { user: data.id, name, root: data.drive_root, pub: data.drive_key }, role)) }
    }
    // No key pair yet: the key sealed with a fresh secret their invitation
    // carries, so they can enter at once.
    secret = newSecret()
    const sealed = await sealForSecret(secret, keyring)
    return { roster: (after = { ...roster, invited: [...roster.invited.filter(invite => invite.user !== data.id), { user: data.id, name, role, keys: sealed }] }) }
  })
  await invite(data.id, me, after!, allKept()[lobbyId].roster, secret)
  return result
}

/** A member's role changed. Admins' alone by the owner, with the admin's
 *  Google address: the roster shared with it to edit (or no longer). */
export async function setRole(lobbyId: string, me: string, user: string, role: Exclude<Role, 'owner'>, adminEmail?: string): Promise<void> {
  const kept = allKept()[lobbyId]
  if (!kept) throw new Error('not a Drive atrium')
  await changeRoster(lobbyId, me, async roster => {
    const member = memberOf(roster, user)
    if (!member || member.role === 'owner') throw new Error('not a member')
    const owner = memberOf(roster, me)?.role === 'owner'
    if ((role === 'admin' || member.role === 'admin') && !owner) throw new Error('OWNER_ONLY')
    let grant = member.grant
    if (role === 'admin' && member.role !== 'admin') {
      if (!adminEmail) throw new Error('ADMIN_EMAIL_NEEDED')
      grant = await store.shareWith(kept.roster, adminEmail)
    } else if (role !== 'admin' && member.grant) {
      await store.unshare(kept.roster, member.grant)
      grant = undefined
    }
    const changed: Member = { ...member, role, grant }
    if (!grant) delete changed.grant
    return { roster: { ...roster, members: roster.members.map(m => (m.user === user ? changed : m)) } }
  })
}

/** Someone out -- and, blocked, kept out: a new generation of the key, made
 *  without them, so they can read nothing written from now on. */
export async function removePerson(lobbyId: string, me: string, user: string, block: boolean): Promise<void> {
  const kept = allKept()[lobbyId]
  if (!kept) throw new Error('not a Drive atrium')
  await changeRoster(lobbyId, me, async (roster, keyring) => {
    const member = memberOf(roster, user)
    if (member?.role === 'admin' && memberOf(roster, me)?.role !== 'owner') throw new Error('OWNER_ONLY')
    if (member?.grant) await store.unshare(kept.roster, member.grant)
    // Their invitation, if one stands: gone.
    await (cloudClient.from('drive_invites') as any).delete().eq('to_user', user).eq('roster', kept.roster)
    const invited = roster.invited.find(invite => invite.user === user)
    if (!member && !invited?.keys) {
      // Only invited, and never able to read it: off the list (and blocked, if so).
      return { roster: { ...roster, invited: roster.invited.filter(invite => invite.user !== user), blocked: block ? [...new Set([...roster.blocked, user])] : roster.blocked } }
    }
    // A member, or in by their invitation: a new generation, made without them.
    return removeMember(roster, keyring, user, block)
  })
}

/** The owner's: its folder in Drive gone -- the roster and the owner's saves
 *  -- and with it the atrium, for everyone. */
export async function deleteDriveAtrium(lobbyId: string): Promise<void> {
  const kept = allKept()[lobbyId]
  if (kept) await store.trash(kept.folder)
  forgetDriveAtrium(lobbyId)
}

// ---------------------------------------------------------------- in step, while open

// How long after the last write a save goes up, and how often Drive is looked at.
const QUIET_MS = 1500
const LOOK_MS = 20_000
// Saves read side by side.
const AT_ONCE = 6
// A save goes through the room as itself up to this many bytes, sealed (the
// room carries ciphertext); bigger, it says only which file to read.
const ROOM_EVENT = 'drive-save'
const ROOM_MOST = 40_000

interface State { merged: Change[]; seen: string[]; last: Clock | null }
interface Session {
  lobbyId: string
  me: string
  kept: Kept
  keyring: Keyring
  merged: Merged
  seen: Set<string>
  last: Clock | null
  queue: Promise<void>
  // The roster as last read, and its version: read again once that moves.
  roster: { version: string; roster: Roster } | null
  // Each writer's folder for this atrium, once found.
  folders: Map<string, string>
  quiet: number
  looking: number
  stopHearing: () => void
  // One's invitation deleted, once let in properly.
  inviteCleared: boolean
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
    lobbyId, me, kept, keyring: await keyringFrom(kept), merged, seen: new Set(state.seen), last: state.last,
    queue: Promise.resolve(), roster: null, folders: new Map(), quiet: 0, looking: 0, stopHearing: () => {}, inviteCleared: false, local,
  }
  session = s
  setStatus({ ended: undefined })
  local.listenToLocalWrites(() => {
    window.clearTimeout(s.quiet)
    s.quiet = window.setTimeout(() => { if (session === s) void run(s, up) }, QUIET_MS)
  })
  // Saves as they're made, from whoever's in the room.
  s.stopHearing = onRoomEvent(ROOM_EVENT, payload => { if (session === s) void run(s, x => heard(x, payload)) })
  const both = async (x: Session) => { await down(x); await up(x) }
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
  s.stopHearing()
  s.local.listenToLocalWrites(null)
  await run(s, up)
  setStatus({ signInNeeded: false, catchingUp: false })
}

// What the open Drive atrium is doing that someone should see
// (components/DriveStatus): bringing saves in from Drive, waiting for a
// sign-in -- which needs a click, so saves wait here meanwhile; reading
// doesn't need it -- or over for this member: removed, or deleted.
export interface DriveStatus { catchingUp: boolean; signInNeeded: boolean; ended?: 'removed' | 'deleted' }
let status: DriveStatus = { catchingUp: false, signInNeeded: false }
const statusWatchers = new Set<(status: DriveStatus) => void>()
function setStatus(change: Partial<DriveStatus>) {
  const next = { ...status, ...change }
  if (next.catchingUp === status.catchingUp && next.signInNeeded === status.signInNeeded && next.ended === status.ended) return
  status = next
  statusWatchers.forEach(watcher => watcher(status))
}
export function watchDriveStatus(watcher: (status: DriveStatus) => void): () => void {
  statusWatchers.add(watcher)
  watcher(status)
  return () => { statusWatchers.delete(watcher) }
}
/** On a click: Google's window, then what waited goes up. */
export async function reconnectDrive(): Promise<void> {
  await store.signIn()
  setStatus({ signInNeeded: false })
  await syncNow()
}

/** Now, rather than at the next look: down, then up. For tests and a "sync now". */
export const syncNow = () => (session ? run(session, async s => { await down(s); await up(s) }) : Promise.resolve())

async function up(s: Session): Promise<void> {
  if (status.ended) return
  // A viewer's saves aren't taken: none made.
  if (s.roster && placeOf(s.roster.roster, s.me)?.role === 'viewer') return
  const at = tick(s.last, Date.now(), s.me)
  const changes = changesSince(s.merged, await s.local.atriumRows(s.lobbyId), at)
  if (!changes.length) return
  // Kept for later: the next diff still has them.
  if (!store.canWrite()) { setStatus({ signInNeeded: true }); return }
  const sealed = await sealJson(s.keyring, { v: 1, changes } satisfies DriveSave)
  const file = await store.write(`${at}.save`, sealed, { parent: s.kept.folder })
  merge(s.merged, changes)
  s.last = at
  s.seen.add(file.id)
  await persist(s)
  sendThroughRoom(ROOM_EVENT, { file: file.id, ...(sealed.length <= ROOM_MOST ? { sealed: bytesToBase64(sealed) } : {}) })
}

/** A save heard in the room: taken as it came, or -- too big to come -- read from Drive now. */
async function heard(s: Session, payload: unknown): Promise<void> {
  const { file, sealed } = (payload ?? {}) as { file?: unknown; sealed?: unknown }
  if (typeof file !== 'string' || s.seen.has(file)) return
  if (typeof sealed !== 'string') return down(s)
  await take(s, [{ id: file, save: await opened(s, base64ToBytes(sealed)) }])
}

/** A sealed save opened -- after reading the roster again, if it was sealed
 *  with a generation of the key made since this browser last looked. */
async function opened(s: Session, sealed: Uint8Array): Promise<DriveSave> {
  try {
    return await unsealJson<DriveSave>(s.keyring, sealed)
  } catch (error) {
    if (!(error instanceof KeyMissing)) throw error
    s.roster = null
    await lookAtRoster(s)
    return unsealJson<DriveSave>(s.keyring, sealed)
  }
}

/** The roster, read again once its version has moved: who's in, one's keys,
 *  whether one is still a member, and -- for an owner or admin -- whom to let in. */
async function lookAtRoster(s: Session): Promise<Roster | null> {
  let version: string
  try {
    version = await store.version(s.kept.roster)
  } catch (error) {
    // Gone: the owner deleted it.
    if (/Drive 404/.test(String(error))) { setStatus({ ended: 'deleted' }); return null }
    throw error
  }
  if (s.roster?.version !== version) {
    const roster = await readRoster(s.kept.roster)
    s.roster = { version, roster }
    if (!placeOf(roster, s.me) && !roster.invited.some(invite => invite.user === s.me)) { setStatus({ ended: 'removed' }); return null }
    // Let in properly: the invitation, and any secret it held, deleted.
    if (memberOf(roster, s.me) && !s.inviteCleared) {
      s.inviteCleared = true
      await (cloudClient.from('drive_invites') as any).delete().eq('to_user', s.me).eq('roster', s.kept.roster)
    }
    // Generations made since: opened with one's private key.
    if (roster.keys.some(generation => !s.keyring.has(generation.n) && generation.for[s.me])) {
      const own = mine?.user === s.me ? mine : await myIdentity({ id: s.me })
      s.keyring = await keyringOf(roster, s.me, own.identity.privateJwk)
      keep(s.lobbyId, { ...s.kept, keys: await keysOf(s.keyring) })
    }
  }
  // Whom to let in -- looked for at every look, not only when the roster
  // moves: someone invited makes their key pair in their profile, which the
  // roster doesn't show.
  const roster = s.roster.roster
  if (manages(memberOf(roster, s.me)?.role) && roster.invited.length) await letIn(s, roster)
  // As it was read: those just let in are read this look too (by their
  // invitation's folder), and the next look reads the roster written.
  return roster
}

/** An owner's or admin's app, as it looks: those it added who now have a key
 *  pair let in, and members whose key pair changed (a new Google account) let
 *  in again with the new one. */
async function letIn(s: Session, roster: Roster): Promise<void> {
  const users = [...roster.invited.map(invite => invite.user), ...roster.members.map(member => member.user)]
  const { data } = await (cloudClient.from('profiles') as any).select('id, drive_key, drive_root').in('id', users)
  const profiles = new Map<string, { drive_key: JsonWebKey | null; drive_root: string | null }>((data ?? []).map((row: any) => [row.id, row]))
  let next = roster
  for (const invite of roster.invited) {
    const profile = profiles.get(invite.user)
    if (profile?.drive_key && profile.drive_root) next = await admit(next, s.keyring, { user: invite.user, name: invite.name, root: profile.drive_root, pub: profile.drive_key }, invite.role)
  }
  for (const member of roster.members) {
    const profile = profiles.get(member.user)
    if (profile?.drive_key && JSON.stringify(profile.drive_key) !== JSON.stringify(member.pub)) {
      next = await admit(next, s.keyring, { user: member.user, name: member.name, root: profile.drive_root ?? member.root, pub: profile.drive_key }, member.role)
    }
  }
  if (next === roster) return
  // Not signed in to Google on this page (it doesn't outlast a reload): the
  // button asks, and the click lets them in.
  if (!store.canWrite()) { setStatus({ signInNeeded: true }); return }
  try {
    await writeRoster(s.kept, next)
    s.roster = null
  } catch (error) {
    // An admin who hasn't opened the roster yet: their first change in the members panel asks.
    console.warn('[drive] letting in:', error)
  }
}

async function down(s: Session): Promise<void> {
  const roster = await lookAtRoster(s)
  if (!roster) return
  // Downloads only for what's new: the roster when its version moves, saves
  // not read yet. A look at an atrium nobody has changed downloads nothing.
  const unread: { id: string }[] = []
  const writers: { user: string; root: string | null }[] = writersOf(roster)
  // Those in by their invitation aren't in the roster with their folder yet:
  // it's in their profile.
  const invitedHere = invitedWritersOf(roster).filter(invite => !s.folders.has(invite.user))
  if (invitedHere.length) {
    const { data } = await (cloudClient.from('profiles') as any).select('id, drive_root').in('id', invitedHere.map(invite => invite.user))
    for (const row of data ?? []) writers.push({ user: row.id, root: row.drive_root })
  }
  for (const invite of invitedWritersOf(roster)) if (s.folders.has(invite.user)) writers.push({ user: invite.user, root: null })
  for (const writer of writers) {
    let folder = s.folders.get(writer.user)
    if (!folder) {
      if (!writer.root) continue
      folder = (await store.listByLink(writer.root)).find(file => file.name === s.lobbyId)?.id
      if (!folder) continue
      s.folders.set(writer.user, folder)
    }
    for (const file of await store.listByLink(folder)) if (file.name.endsWith('.save') && !s.seen.has(file.id)) unread.push(file)
  }
  if (!unread.length) return
  setStatus({ catchingUp: true })
  try {
    for (let at = 0; at < unread.length; at += AT_ONCE) {
      await take(s, await Promise.all(unread.slice(at, at + AT_ONCE).map(async file =>
        ({ id: file.id, save: await opened(s, await store.readByLink(file.id)) }))))
    }
  } finally {
    setStatus({ catchingUp: false })
  }
}

/** Saves read -- from Drive, or the room -- merged, and what took brought into the working copy. */
async function take(s: Session, saves: { id: string; save: DriveSave }[]): Promise<void> {
  const took = new Map<string, Change>()
  for (const { id, save } of saves) {
    for (const change of merge(s.merged, save.changes)) took.set(`${change.table}/${change.id}`, change)
    for (const change of save.changes) s.last = later(s.last, change.at)
    s.seen.add(id)
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
