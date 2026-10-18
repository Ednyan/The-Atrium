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
//
// Kept small: now and then the owner's app folds every save it has read into
// one snapshot (`atrium.snapshot`, in the owner's folder), which says which
// saves it holds; whoever joins reads it and only the saves after it, and
// each writer's app removes its own saves once a snapshot holds them.
//
// Files (pictures, videos, documents): each sealed into the folder `files` in
// its sender's atrium folder, before the save that first needs it, which says
// where it went (a `media` row). Brought in once, into the browser's vault at
// its own local:// address -- the trace waits for it meanwhile -- and never
// downloaded again.

import * as drive from './drive'
import { clearSecret, invitationsToMe, myEntry, peopleByIds, personNamed, sendInvitation, withdrawInvitation, type Person } from './people'
import {
  admit, base64ToBytes, bytesToBase64, carried, changesSince, clockTime, clockWho, invitedWritersOf, KeyMissing, keyFromText, keyOf, keyringOf, keyToText, later, manages,
  memberOf, merge, newAtriumKey, newIdentity, newRoster, newSecret, openWithSecret, placeOf, removeMember, rowsOf, sameKey, seal, sealForSecret, sealJson, tick, unseal, writersOf,
  snapshotOf, type Change, type Clock, type DriveSave, type Identity, type Keyring, type Member, type Merged, type Role, type Roster, type Snapshot, type Table,
} from './driveFormat'
import { LOBBY_CHANGED_EVENT, tellHere, type LiveTable } from './liveChanges'
import { trackVaultWrite, vaultWriteDone } from './vaultWrites'
import { onRoomEvent, sayToRoom, sendThroughRoom } from './rooms'
import { useGameStore } from '../store/gameStore'

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
  /** Written; its id, and its version now where Drive says it. */
  write(name: string, bytes: Uint8Array, place: { parent: string } | { id: string }): Promise<{ id: string; version?: string }>
  readByLink(id: string): Promise<Uint8Array>
  /** A file's version, without downloading it. */
  version(id: string): Promise<string>
  listByLink(folder: string): Promise<Listed[]>
  readAppData(name: string): Promise<Uint8Array | null>
  writeAppData(name: string, bytes: Uint8Array): Promise<void>
  /** Shared with someone to edit, quietly; the permission's id. */
  shareWith(id: string, email: string): Promise<string>
  unshare(id: string, permission: string): Promise<void>
  noResharing(id: string): Promise<void>
  trash(id: string): Promise<void>
}
// A file as a folder's listing has it: its version, to tell it's changed.
interface Listed { id: string; name: string; version?: string }
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
// Rosters as last read, by their version, kept across reloads: a roster is
// downloaded only once it has changed -- every anonymous download counts
// toward Google's robot check, and those of everyone on one network add up.
// Its version is only details, which Google lets be read freely.
const ROSTERS = 'atrium.driveRosters'
function rostersKept(): Record<string, { version: string; roster: Roster }> {
  try { return JSON.parse(localStorage.getItem(ROSTERS) || '{}') ?? {} } catch { return {} }
}
async function readRosterAt(id: string, version: string): Promise<Roster> {
  const kept = rostersKept()[id]
  if (kept?.version === version) return kept.roster
  const roster = fromJson<Roster>(await store.readByLink(id))
  keepRoster(id, version, roster)
  return roster
}
function keepRoster(id: string, version: string, roster: Roster) {
  try { localStorage.setItem(ROSTERS, JSON.stringify({ ...rostersKept(), [id]: { version, roster } })) } catch { /* read again next time */ }
}
const readRoster = async (id: string) => readRosterAt(id, await store.version(id))

// ---------------------------------------------------------------- one's own key pair

// Made the first time one uses a Drive atrium: the pair (its private half in
// one's Google account's hidden app folder, so every device signed in to it
// has it) and one's folder for atriums, shared by link. Their public parts go
// in one's profile, for whoever adds one to an atrium.
interface Mine { user: string; identity: Identity; root: string }
const IDENTITY_FILE = 'atrium-identity.json'
const IDENTITY_HERE = 'atrium.driveIdentity'
let mine: Mine | null = null

// One's public key and folder, in the directory (lib/people) -- where whoever
// adds one finds them. Once a visit.
let identityPublished = ''
async function publishIdentity(own: Mine): Promise<void> {
  if (identityPublished === own.user) return
  await myEntry({ drive_key: own.identity.publicJwk, drive_root: own.root })
  identityPublished = own.user
}

export async function myIdentity(me: { id: string }): Promise<Mine> {
  if (mine?.user === me.id) return mine
  try {
    const here = JSON.parse(localStorage.getItem(IDENTITY_HERE) || 'null') as Mine | null
    if (here?.user === me.id) {
      mine = here
      await publishIdentity(here)
      return here
    }
  } catch { /* none kept */ }
  const kept = await store.readAppData(IDENTITY_FILE)
  let found = kept ? fromJson<{ identity: Identity; root: string }>(kept) : null
  if (!found) {
    const root = await store.createFolder('Digital Atrium')
    await store.shareByLink(root.id)
    found = { identity: await newIdentity(), root: root.id }
    await store.writeAppData(IDENTITY_FILE, asJson(found))
  }
  mine = { user: me.id, ...found }
  await publishIdentity(mine)
  try { localStorage.setItem(IDENTITY_HERE, JSON.stringify(mine)) } catch { /* fetched again next time */ }
  return mine
}

// ---------------------------------------------------------------- which atriums

// This browser's Drive atriums -- each account's own, as an atrium's
// membership is an account's: the roster's file, one's own folder in it, and
// the generations of its key one has opened. Two accounts on one browser see
// their own; one's invitation to an atrium another holds here isn't taken for
// one kept.
interface Kept { roster: string; folder: string; keys: Record<string, string>; owner?: boolean }
const KEPT = 'atrium.driveAtriums.byAccount'
// Before (2026-10-18): one list for the whole browser. Each entry is claimed
// by the account its roster, as last read here, has in it, as that account
// looks -- or by the first to look, where no roster was read.
const LEGACY = 'atrium.driveAtriums'
// Drive atriums from before members (a head and a shared key) aren't these.
const isKept = (kept: unknown): kept is Kept => typeof (kept as Kept)?.roster === 'string'
const signedInHere = () => useGameStore.getState().userId ?? ''
function stored<T>(key: string): Record<string, T> {
  try { return JSON.parse(localStorage.getItem(key) || '{}') ?? {} } catch { return {} }
}
function store_(key: string, value: object | null) {
  try { if (value && Object.keys(value).length) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key) } catch { /* this visit only */ }
}
function allKept(user = signedInHere()): Record<string, Kept> {
  if (!user) return {}
  const byAccount = stored<Record<string, Kept>>(KEPT)
  const legacy = stored<unknown>(LEGACY)
  const claimed = Object.entries(legacy).filter((entry): entry is [string, Kept] => isKept(entry[1]) && belongsTo(entry[1], user))
  if (claimed.length) {
    byAccount[user] = { ...byAccount[user], ...Object.fromEntries(claimed) }
    for (const [lobbyId] of claimed) delete legacy[lobbyId]
    store_(KEPT, byAccount)
    store_(LEGACY, legacy)
  }
  return Object.fromEntries(Object.entries(byAccount[user] ?? {}).filter(([, kept]) => isKept(kept)))
}
function belongsTo(kept: Kept, user: string): boolean {
  const roster = rostersKept()[kept.roster]?.roster
  if (!roster) return true
  // The owner's own entry (its folder, its keys) is the owner's; anyone
  // else's, someone in it -- never someone only invited, who'd take another's.
  const role = placeOf(roster, user)?.role
  return kept.owner ? role === 'owner' : !!role && role !== 'owner'
}
export const isDriveAtrium = (lobbyId: string) => lobbyId in allKept()
/** Another account's Drive atrium, held on this browser -- and not this
 *  account's: its working copy here is that account's to see and to keep. */
export function anotherAccountsDriveAtrium(lobbyId: string): boolean {
  const user = signedInHere()
  if (lobbyId in allKept(user)) return false
  return Object.entries(stored<Record<string, Kept>>(KEPT)).some(([account, kept]) => account !== user && isKept(kept?.[lobbyId]))
    || isKept(stored<unknown>(LEGACY)[lobbyId])
}
function keep(lobbyId: string, kept: Kept | null, user = signedInHere()) {
  if (!user) return
  const byAccount = stored<Record<string, Kept>>(KEPT)
  const mine = { ...byAccount[user] }
  if (kept) mine[lobbyId] = kept
  else delete mine[lobbyId]
  byAccount[user] = mine
  store_(KEPT, byAccount)
}
export const forgetDriveAtrium = (lobbyId: string) => keep(lobbyId, null)

/** Out of a Drive atrium on this browser, for the account signed in: off its
 *  list, and its working copy gone -- unless another account here still
 *  holds it, whose copy it is too. The copy's sync state goes with it. */
export async function leaveDriveAtrium(lobbyId: string): Promise<void> {
  forgetDriveAtrium(lobbyId)
  if (anotherAccountsDriveAtrium(lobbyId)) return
  const { browserEngine, forgetBrowserAtrium } = await import('./browserAtriums')
  const { error } = await (await browserEngine()).localClient.from('lobbies').delete().eq('id', lobbyId)
  if (error) throw error
  forgetBrowserAtrium(lobbyId)
}

/** Why one's out of a Drive atrium: removed from its roster, blocked, or the
 *  atrium deleted by its owner. */
export type DriveEnd = 'removed' | 'blocked' | 'deleted'
const outOf = (roster: Roster, me: string): DriveEnd | null =>
  roster.blocked.includes(me) ? 'blocked'
    : placeOf(roster, me) || roster.invited.some(invite => invite.user === me) ? null
      : 'removed'
// Found out this visit, by account: the open atrium leaves at once
// (LobbyScene), and the atrium browser lets it go.
const ended = new Map<string, DriveEnd>()
export const endedFor = (lobbyId: string, user = signedInHere()) => ended.get(`${user}/${lobbyId}`)

/** Where `me` stands in a Drive atrium held here, by its roster (read with
 *  the app's key alone, no sign-in): in, or out and why. Null if Drive can't
 *  say just now -- nothing's let go on a guess. */
export async function driveStanding(lobbyId: string, me: string): Promise<'in' | DriveEnd | null> {
  const known = ended.get(`${me}/${lobbyId}`)
  if (known) return known
  const kept = allKept(me)[lobbyId]
  if (!kept) return null
  try {
    return outOf(await readRoster(kept.roster), me) ?? 'in'
  } catch (error) {
    return /Drive 404/.test(String(error)) ? 'deleted' : null
  }
}
/** Its owner's, here: Delete takes it out of Drive; anyone else's leaves. */
export const isDriveOwner = (lobbyId: string) => !!allKept()[lobbyId]?.owner
/** Who its owner and admins are, and whether `me` may edit, as the
 *  atrium's own row has them -- from its roster as last read here (null if it
 *  hasn't been). The roster's to say, so each copy has them from it, and no
 *  save carries them (lib/driveFormat, carried). */
export function rowFromRoster(lobbyId: string, me: string): { owner_user_id: string; admin_user_ids: string[]; edit_permission_mode: 'all' | 'none' } | null {
  const kept = allKept()[lobbyId]
  const roster = kept && rostersKept()[kept.roster]?.roster
  return roster ? rowOf(roster, me) : null
}
function rowOf(roster: Roster, me: string) {
  return {
    owner_user_id: roster.members.find(member => member.role === 'owner')?.user ?? '',
    admin_user_ids: roster.members.filter(member => member.role === 'admin').map(member => member.user),
    // A viewer sees it, and changes nothing: only the owner and admins edit,
    // as an atrium whose editing is turned off has it.
    edit_permission_mode: (placeOf(roster, me)?.role === 'viewer' ? 'none' : 'all') as 'all' | 'none',
  }
}
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
  keep(lobbyId, { roster: file.id, folder, keys: await keysOf(new Map([[0, key]])), owner: true }, me.id)
  // A clean slate: what an earlier sync of this atrium kept (what it merged,
  // what it read) isn't this one's, and would stop its first save -- all of
  // it -- from ever going up.
  const local = await import('./localDb')
  await local.writeVaultJson(local.driveStatePath(lobbyId), FRESH)
}

/** The working copy of a Drive atrium joined here, made if there's none yet
 *  (`row`, its atrium's row) -- and its sync started from nothing with it: a
 *  state left by an earlier copy here would take every save as read and,
 *  against the empty copy, every row as deleted, sending that up. */
export async function makeWorkingCopy(lobbyId: string, row: Record<string, unknown>): Promise<void> {
  const local = await import('./localDb')
  const { data: had } = await local.localClient.from('lobbies').select('id').eq('id', lobbyId)
  if (had?.length) return
  await local.writeVaultJson(local.driveStatePath(lobbyId), FRESH)
  const { error } = await (local.localClient.from('lobbies') as any).insert({ ...row, id: lobbyId })
  if (error) throw error
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
export type JoinResult = { lobbyId: string; state: 'in' | 'waiting' | 'notAdded' | 'blocked'; why?: 'noSecret' | 'otherAccount' }

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
  if (member && sameKey(member.pub, own.identity.publicJwk)) {
    onStep('folder')
    const folder = await folderFor(own.root, lobbyId)
    keep(lobbyId, { roster: rosterId, folder, keys: await keysOf(await keyringOf(roster, me.id, own.identity.privateJwk)), owner: member.role === 'owner' }, me.id)
    await clearSecret(rosterId)
    return { lobbyId, state: 'in' }
  }
  // Added before one had a key pair: in at once, by the invitation's secret
  // (the Atrium's invitations, one's own alone).
  const invited = roster.invited.find(invite => invite.user === me.id)
  if (invited?.keys) {
    const secret = (await invitationsToMe()).find(row => row.roster === rosterId)?.secret
    // A secret that doesn't open it (an older invitation than the roster's): as none.
    const keyring = secret ? await openWithSecret(base64ToBytes(secret), invited.keys).catch(() => null) : null
    if (keyring) {
      onStep('folder')
      const folder = await folderFor(own.root, lobbyId)
      keep(lobbyId, { roster: rosterId, folder, keys: await keysOf(keyring), owner: false }, me.id)
      return { lobbyId, state: 'in' }
    }
  }
  // Waiting on someone who holds the key: a member with another Google
  // account's key pair, or an invitation with no secret that opens it --
  // either way, theirs to resend (or let in, next time they're in it).
  if (member) return { lobbyId, state: 'waiting', why: 'otherAccount' }
  return invited ? { lobbyId, state: 'waiting', why: 'noSecret' } : { lobbyId, state: 'notAdded' }
}

// ---------------------------------------------------------------- invitations

// One's invitations to Drive atriums, in the Atrium's directory (lib/people):
// which atrium (its roster in Drive), its name, and who added one -- shown in
// the atrium browser, so nobody needs a link. Newest first.
export interface Invitation { id: string; roster: string; lobbyId: string; name: string; from: string; at: number }
export async function myInvitations(): Promise<Invitation[]> {
  return (await invitationsToMe())
    .filter(row => !isDriveAtrium(row.lobby_id))
    .map(row => ({ id: row.id, roster: row.roster, lobbyId: row.lobby_id, name: row.name, from: row.from_name ?? '', at: row.created_at }))
}
export const declineInvitation = (id: string) => withdrawInvitation({ id }).then(() => {})
// Told to someone added, in their atrium browser: with the secret that opens
// it if they have no key pair yet. Never a second secret for an invitation
// still standing -- the roster's sealed keys answer to the first. One per
// person per atrium: sent again, it replaces the last, and is new again.
async function invite(to: string, roster: Roster, rosterId: string, secret: Uint8Array | null): Promise<void> {
  await sendInvitation({ to, roster: rosterId, lobby_id: roster.lobbyId, name: roster.name, secret: secret && bytesToBase64(secret) })
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
  let written: { version?: string }
  try {
    written = await store.write('atrium.roster', asJson(roster), { id: kept.roster })
  } catch (error) {
    if (!/Drive 40[34]/.test(String(error))) throw error
    if (!(await store.pick(kept.roster))) throw new Error('PICK_CANCELLED')
    written = await store.write('atrium.roster', asJson(roster), { id: kept.roster })
  }
  // Kept as written: who wrote it needn't download it again.
  keepRoster(kept.roster, written.version ?? await store.version(kept.roster), roster)
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
  tellRoom(lobbyId)
}

// Everyone in the atrium's room told the roster changed: through the page's
// room from inside, else said from outside for a few seconds, while the word
// gets in (lib/rooms).
function tellRoom(lobbyId: string) {
  if (session?.lobbyId === lobbyId && sendThroughRoom(ROSTER_EVENT, {})) return
  const stop = sayToRoom(lobbyId, ROSTER_EVENT, {}, ROSTER_TOLD_MS)
  window.setTimeout(stop, ROSTER_TOLD_MS * 3)
}

/** Told by the room the roster changed: looked at now -- on the word of an
 *  owner or admin only, as the room knows the sender. */
async function rosterTold(s: Session, sender: string): Promise<void> {
  if (!s.roster || !manages(memberOf(s.roster.roster, sender)?.role)) return
  if (Date.now() - s.rosterToldAt < ROSTER_TOLD_MS) return
  s.rosterToldAt = Date.now()
  await lookAtRoster(s)
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
  // A member too -- one on another Google account since -- in the role they have.
  const roster = await readRoster(kept.roster)
  const role = memberOf(roster, user)?.role ?? roster.invited.find(invite => invite.user === user)?.role ?? 'editor'
  if (role === 'owner') throw new Error('the owner needs no invitation')
  return add(lobbyId, me, await profileBy('id', user), role)
}

const profileBy = async (column: 'id' | 'username', value: string): Promise<Person> => {
  const person = column === 'id' ? (await peopleByIds([value]))[0] : await personNamed(value)
  if (!person) throw new Error('NO_SUCH_USER')
  return person
}

async function add(lobbyId: string, me: string, data: Awaited<ReturnType<typeof profileBy>>, role: Exclude<Role, 'owner'>): Promise<'in' | 'invited'> {
  let result: 'in' | 'invited' = 'invited'
  let secret: Uint8Array | null = null
  let after: Roster | null = null
  await changeRoster(lobbyId, me, async (roster, keyring) => {
    if (roster.blocked.includes(data.id)) throw new Error('BLOCKED')
    const name = data.display_name || data.username || ''
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
  await invite(data.id, after!, allKept()[lobbyId].roster, secret)
  return result
}

/** A member's role changed -- or the role someone invited comes in with.
 *  Admins' alone by the owner, with the admin's Google address: the roster
 *  shared with it to edit (or no longer) -- so a member's, once they're in. */
export async function setRole(lobbyId: string, me: string, user: string, role: Exclude<Role, 'owner'>, adminEmail?: string): Promise<void> {
  const kept = allKept()[lobbyId]
  if (!kept) throw new Error('not a Drive atrium')
  await changeRoster(lobbyId, me, async roster => {
    const member = memberOf(roster, user)
    if (!member) {
      if (role === 'admin' || !roster.invited.some(invite => invite.user === user)) throw new Error('not a member')
      return { roster: { ...roster, invited: roster.invited.map(invite => (invite.user === user ? { ...invite, role } : invite)) } }
    }
    if (member.role === 'owner') throw new Error('not a member')
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
    await withdrawInvitation({ to: user, roster: kept.roster })
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
  // Whoever's in finds it gone now.
  tellRoom(lobbyId)
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
// A save from someone the roster doesn't have: the roster looked at again, at most this often.
const ROSTER_AGAIN_MS = 10_000
// The roster changed (someone added, removed, a role), told to the room by
// the owner's or an admin's app: whoever's in looks at it now -- someone
// removed is out at once, not at their app's next look. At most this often.
const ROSTER_EVENT = 'drive-roster'
const ROSTER_TOLD_MS = 3_000
const ROOM_MOST = 40_000

interface State { merged: Change[]; seen: string[]; last: Clock | null; snapshot?: { version: string; folded: string[] } }
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
  // Those who asked to be let in and were put off, this visit.
  putOff: Set<string>
  // When a save from someone the roster didn't have last made it look again.
  rosterAskedAt: number
  rosterToldAt: number
  // One's invitation deleted, once let in properly.
  inviteCleared: boolean
  // Files: where one's own go (found or made on the first sent), those known
  // to be here, those being brought in, and those that failed to come -- tried
  // again from when, and how long it waited last.
  filesFolder: string | null
  // The owner's snapshot as last read (or written) here, and when this
  // session last wrote one.
  snapshot: { version: string; folded: Set<string> } | null
  compactedAt: number
  present: Set<string>
  fetching: Set<string>
  retry: Map<string, { at: number; wait: number }>
  local: typeof import('./localDb')
}
let session: Session | null = null

const FRESH: State = { merged: [], seen: [], last: null }
const persist = (s: Session) => s.local.writeVaultJson(s.local.driveStatePath(s.lobbyId), {
  merged: [...s.merged.values()], seen: [...s.seen], last: s.last,
  ...(s.snapshot ? { snapshot: { version: s.snapshot.version, folded: [...s.snapshot.folded] } } : {}),
} satisfies State)
// A session's tasks, one at a time: `inQueue` hands back its task's result
// (or failure); `run` only says, as the sync's own looks need.
function inQueue<T>(s: Session, task: (s: Session) => Promise<T>): Promise<T> {
  const done = s.queue.then(() => task(s))
  s.queue = done.then(() => {}, error => console.warn('[drive] sync:', error))
  return done
}
const run = (s: Session, task: (s: Session) => Promise<void>) => {
  void inQueue(s, task).catch(() => {})
  return s.queue
}

/** In step with Drive while `lobbyId` is open: up after writes, others' down every little while. */
export async function startDriveSync(lobbyId: string, me: string): Promise<void> {
  await stopDriveSync()
  const kept = allKept(me)[lobbyId]
  if (!kept) return
  const local = await import('./localDb')
  const state = await local.readVaultJson<State>(local.driveStatePath(lobbyId), FRESH)
  const merged: Merged = new Map()
  merge(merged, state.merged)
  const s: Session = {
    lobbyId, me, kept, keyring: await keyringFrom(kept), merged, seen: new Set(state.seen), last: state.last,
    queue: Promise.resolve(), roster: null, folders: new Map(), quiet: 0, looking: 0, stopHearing: () => {}, putOff: new Set(), rosterAskedAt: 0, rosterToldAt: 0, inviteCleared: false,
    filesFolder: null, present: new Set(), fetching: new Set(), retry: new Map(), local, compactedAt: 0,
    snapshot: state.snapshot ? { version: state.snapshot.version, folded: new Set(state.snapshot.folded) } : null,
  }
  session = s
  setStatus({ ended: undefined })
  local.listenToLocalWrites(() => {
    window.clearTimeout(s.quiet)
    s.quiet = window.setTimeout(() => { if (session === s) void run(s, up) }, QUIET_MS)
  })
  // Saves as they're made, from whoever's in the room.
  const stopSaves = onRoomEvent(ROOM_EVENT, (payload, sender) => { if (session === s) void run(s, x => heard(x, payload, sender)) })
  const stopAsks = onRoomEvent(ASK_EVENT, (_payload, sender) => { if (session === s) void run(s, x => asked(x, sender)) })
  const stopRoster = onRoomEvent(ROSTER_EVENT, (_payload, sender) => { if (session === s) void run(s, x => rosterTold(x, sender)) })
  s.stopHearing = () => { stopSaves(); stopAsks(); stopRoster() }
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
  setStatus({ signInNeeded: false, catchingUp: false, asking: status.asking.length ? [] : status.asking })
}

// What the open Drive atrium is doing that someone should see
// (components/DriveStatus): bringing saves in from Drive, waiting for a
// sign-in -- which needs a click, so saves wait here meanwhile; reading
// doesn't need it -- or over for this member: removed, or deleted.
export interface DriveStatus { catchingUp: boolean; signInNeeded: boolean; ended?: DriveEnd; asking: Asker[] }
export interface Asker { user: string; username: string; name: string }
let status: DriveStatus = { catchingUp: false, signInNeeded: false, asking: [] }
const statusWatchers = new Set<(status: DriveStatus) => void>()
function setStatus(change: Partial<DriveStatus>) {
  const next = { ...status, ...change }
  if (next.catchingUp === status.catchingUp && next.signInNeeded === status.signInNeeded && next.ended === status.ended && next.asking === status.asking) return
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
  const current = await s.local.atriumRows(s.lobbyId)
  const role = s.roster ? placeOf(s.roster.roster, s.me)?.role : s.kept.owner ? 'owner' : undefined
  // The atrium's own row -- its name, its theme -- is the owner's and admins'
  // to change: anyone else's change to it isn't sent (nor taken, see take).
  const changes = changesSince(s.merged, current, at).filter(change => change.table !== 'lobbies' || manages(role))
  const unsent = await unsentFiles(s, current.traces)
  if (!changes.length && !unsent.length) return
  // Kept for later: the next diff still has them.
  if (!store.canWrite()) { setStatus({ signInNeeded: true }); return }
  // Its files first: whoever takes the save finds them there.
  for (const row of await sendFiles(s, unsent)) changes.push({ table: 'media', id: row.id, at, row })
  if (!changes.length) return
  const sealed = await sealJson(s.keyring, { v: 1, changes } satisfies DriveSave)
  const file = await store.write(`${at}.save`, sealed, { parent: s.kept.folder })
  merge(s.merged, changes)
  s.last = at
  s.seen.add(file.id)
  await persist(s)
  sendThroughRoom(ROOM_EVENT, { file: file.id, ...(sealed.length <= ROOM_MOST ? { sealed: bytesToBase64(sealed) } : {}) })
}

/** A save heard in the room: taken as it came, or -- too big to come -- read
 *  from Drive now. Only from someone whose saves are taken, as the room knows
 *  who sent it: not a viewer's, nor a removed member's, who may still hold a
 *  key that opens and seals. */
async function heard(s: Session, payload: unknown, sender: string): Promise<void> {
  const { file, sealed } = (payload ?? {}) as { file?: unknown; sealed?: unknown }
  if (typeof file !== 'string' || s.seen.has(file)) return
  const roster = s.roster?.roster ?? await lookAtRoster(s)
  let role = roster && placeOf(roster, sender)?.role
  // Someone let in since this browser read the roster: its version looked at
  // again -- now and then, however many such saves come.
  if (!role && Date.now() - s.rosterAskedAt > ROSTER_AGAIN_MS) {
    s.rosterAskedAt = Date.now()
    const now = await lookAtRoster(s)
    role = now && placeOf(now, sender)?.role
  }
  if (!role || role === 'viewer') return
  if (typeof sealed !== 'string') return down(s)
  await take(s, [{ id: file, by: sender, save: fromJson<DriveSave>(await opened(s, base64ToBytes(sealed))) }])
}

/** A sealed file opened -- after reading the roster again, if it was sealed
 *  with a generation of the key made since this browser last looked. */
async function opened(s: Session, sealed: Uint8Array): Promise<Uint8Array> {
  try {
    return await unseal(s.keyring, sealed)
  } catch (error) {
    if (!(error instanceof KeyMissing)) throw error
    s.roster = null
    await lookAtRoster(s)
    return unseal(s.keyring, sealed)
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
    if (/Drive 404/.test(String(error))) { end(s, 'deleted'); return null }
    throw error
  }
  if (s.roster?.version !== version) {
    const roster = await readRosterAt(s.kept.roster, version)
    s.roster = { version, roster }
    const out = outOf(roster, s.me)
    if (out) { end(s, out); return null }
    // Who owns it, who manages it, whether one may edit: the open atrium shows them.
    await s.local.localClient.from('lobbies').update(rowOf(roster, s.me)).eq('id', s.lobbyId)
    window.dispatchEvent(new CustomEvent(LOBBY_CHANGED_EVENT, { detail: s.lobbyId }))
    // Let in properly: the invitation's secret cleared -- and the invitation
    // kept, so it's under "Shared with you" again should one leave it here.
    if (memberOf(roster, s.me) && !s.inviteCleared) {
      s.inviteCleared = true
      await clearSecret(s.kept.roster)
    }
    // Generations made since: opened with one's private key.
    if (roster.keys.some(generation => !s.keyring.has(generation.n) && generation.for[s.me])) {
      const own = mine?.user === s.me ? mine : await myIdentity({ id: s.me })
      s.keyring = await keyringOf(roster, s.me, own.identity.privateJwk)
      keep(s.lobbyId, { ...s.kept, keys: await keysOf(s.keyring) }, s.me)
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

// Out of it: nothing more synced (up), and the open atrium leaves.
function end(s: Session, why: DriveEnd) {
  ended.set(`${s.me}/${s.lobbyId}`, why)
  setStatus({ ended: why })
}

/** An owner's or admin's app, as it looks: those it added who now have a key
 *  pair let in, and members whose key pair changed (a new Google account) let
 *  in again with the new one. */
async function letIn(s: Session, roster: Roster): Promise<void> {
  const users = [...roster.invited.map(invite => invite.user), ...roster.members.map(member => member.user)]
  const profiles = new Map((await peopleByIds(users)).map(person => [person.id, person]))
  let next = roster
  for (const invite of roster.invited) {
    const profile = profiles.get(invite.user)
    if (profile?.drive_key && profile.drive_root) next = await admit(next, s.keyring, { user: invite.user, name: invite.name, root: profile.drive_root, pub: profile.drive_key }, invite.role)
  }
  for (const member of roster.members) {
    const profile = profiles.get(member.user)
    if (profile?.drive_key && !sameKey(profile.drive_key, member.pub)) {
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
  // Files that didn't come yet: those of saves taken before (in a visit that
  // ended first), and those that failed.
  await bringFiles(s, rowsOf(s.merged, 'traces').flatMap(filesOf))
  // Downloads only for what's new: the roster when its version moves, saves
  // not read yet. A look at an atrium nobody has changed downloads nothing.
  const listed = await listWriters(s, roster)
  // The owner's folder holds the snapshot, once one's been made: read when
  // it's changed, and before the saves -- those it holds aren't read.
  const owner = roster.members.find(member => member.role === 'owner')?.user
  const snapshot = listed.find(writer => writer.user === owner)?.files.find(file => file.name === SNAPSHOT)
  const unread = () => listed.flatMap(writer => writer.files.filter(file => file.name.endsWith('.save') && !s.seen.has(file.id)).map(file => ({ id: file.id, by: writer.user })))
  if ((snapshot && snapshot.version !== s.snapshot?.version) || unread().length) {
    setStatus({ catchingUp: true })
    try {
      if (snapshot && snapshot.version !== s.snapshot?.version) await takeSnapshot(s, snapshot, listed)
      const saves = unread()
      for (let at = 0; at < saves.length; at += AT_ONCE) {
        const read = await Promise.all(saves.slice(at, at + AT_ONCE).map(file => readSave(s, file.id, file.by)))
        await take(s, read.filter(save => save !== null))
      }
    } finally {
      setStatus({ catchingUp: false })
    }
  }
  await tidy(s, roster, listed)
}

/** Each writer's folder for the atrium, listed: their saves -- and, the
 *  owner's, the snapshot. */
async function listWriters(s: Session, roster: Roster): Promise<{ user: string; files: Listed[] }[]> {
  const writers: { user: string; root: string | null }[] = writersOf(roster)
  // Those in by their invitation aren't in the roster with their folder yet:
  // it's in their profile.
  const invitedHere = invitedWritersOf(roster).filter(invite => !s.folders.has(invite.user))
  if (invitedHere.length) {
    for (const person of await peopleByIds(invitedHere.map(invite => invite.user))) writers.push({ user: person.id, root: person.drive_root })
  }
  for (const invite of invitedWritersOf(roster)) if (s.folders.has(invite.user)) writers.push({ user: invite.user, root: null })
  const listed: { user: string; files: Listed[] }[] = []
  for (const writer of writers) {
    let folder = s.folders.get(writer.user)
    if (!folder) {
      if (!writer.root) continue
      folder = (await store.listByLink(writer.root)).find(file => file.name === s.lobbyId)?.id
      if (!folder) continue
      s.folders.set(writer.user, folder)
    }
    listed.push({ user: writer.user, files: await store.listByLink(folder) })
  }
  return listed
}

/** A save read from Drive -- or null, gone: removed by its writer once a
 *  snapshot held it, which this browser reads at its next look. */
async function readSave(s: Session, id: string, by: string): Promise<Saved | null> {
  try {
    return { id, by, save: fromJson<DriveSave>(await opened(s, await store.readByLink(id))) }
  } catch (error) {
    if (!/Drive 404/.test(String(error))) throw error
    s.seen.add(id)
    return null
  }
}

// ---------------------------------------------------------------- kept small

const SNAPSHOT = 'atrium.snapshot'
// A new snapshot once this many saves aren't in one, and not more often than
// this: everyone in the atrium downloads each new one.
const COMPACT_AFTER = 100
const COMPACT_EVERY_MS = 30 * 60_000
// Deletions are carried this long; an edit to the row saved before then, and
// never folded, is all that could bring the row back after.
const FORGET_MS = 30 * 24 * 60 * 60_000
// One's own saves removed at each look, at most.
const TRASH_AT_ONCE = 50

/** The owner's snapshot taken in, and what it holds counted as read. What's
 *  counted as read is kept to what's still in Drive. */
async function takeSnapshot(s: Session, file: Listed, listed: { files: Listed[] }[]): Promise<void> {
  const snapshot = fromJson<Snapshot>(await opened(s, await store.readByLink(file.id)))
  await take(s, [{ id: file.id, by: s.roster?.roster.members.find(member => member.role === 'owner')?.user ?? '', save: snapshot }])
  const inDrive = new Set(listed.flatMap(writer => writer.files.map(listedFile => listedFile.id)))
  s.seen = new Set([...[...s.seen].filter(id => inDrive.has(id)), ...snapshot.folded])
  s.snapshot = { version: file.version ?? '', folded: new Set(snapshot.folded) }
  await persist(s)
}

/** One's own saves a snapshot holds, removed: nobody needs them now. And the
 *  owner's app, once enough saves have gathered, folds all it has read into
 *  a new snapshot. */
async function tidy(s: Session, roster: Roster, listed: { user: string; files: Listed[] }[]): Promise<void> {
  if (!store.canWrite()) return
  const mine = listed.find(writer => writer.user === s.me)?.files ?? []
  const done = mine.filter(file => file.name.endsWith('.save') && s.snapshot?.folded.has(file.id)).slice(0, TRASH_AT_ONCE)
  for (const file of done) await store.trash(file.id).catch(error => console.warn('[drive] removing a folded save:', error))
  if (memberOf(roster, s.me)?.role !== 'owner' || Date.now() - s.compactedAt < COMPACT_EVERY_MS) return
  const saves = listed.flatMap(writer => writer.files).filter(file => file.name.endsWith('.save'))
  if (saves.filter(file => !s.snapshot?.folded.has(file.id)).length < COMPACT_AFTER) return
  s.compactedAt = Date.now()
  // Only saves read here: one listed and not read yet stays, for whoever reads it.
  const folded = saves.filter(file => s.seen.has(file.id)).map(file => file.id)
  const sealed = await sealJson(s.keyring, snapshotOf(s.merged, folded, Date.now() - FORGET_MS))
  const had = mine.find(file => file.name === SNAPSHOT)
  const file = await store.write(SNAPSHOT, sealed, had ? { id: had.id } : { parent: s.kept.folder })
  s.snapshot = { version: file.version ?? '', folded: new Set(folded) }
  await persist(s)
}

// A save, and whose it is: the writer whose folder it's in, or who the room
// says sent it.
interface Saved { id: string; by: string; save: DriveSave }

/** Saves read -- from Drive, or the room -- merged, and what took brought into
 *  the working copy. Changes to the atrium's own row only from its owner and
 *  admins. */
async function take(s: Session, saves: Saved[]): Promise<void> {
  // Merged apart first: the sync's memory has them only once the working copy
  // does. Ahead of the copy (bringing in failed), the next diff would take
  // what's missing from it as deleted here, and send that up.
  const merged: Merged = new Map(s.merged)
  const took = new Map<string, Change>()
  let last = s.last
  for (const { by, save } of saves) {
    const theirs = manages(s.roster ? placeOf(s.roster.roster, by)?.role : undefined) ? save.changes : save.changes.filter(change => change.table !== 'lobbies')
    for (const change of merge(merged, theirs)) took.set(`${change.table}/${change.id}`, change)
    for (const change of save.changes) last = later(last, change.at)
  }
  // Each row as it ends up merged, not as each save had it on the way.
  const changes = [...took.keys()].map(key => merged.get(key)!)
  // Their files on the way before the atrium reads them: a trace waits for
  // its file rather than showing it missing. A file sent after its trace
  // (it failed to go at first) comes for the traces that have it.
  const sentLate = new Set(changes.filter(change => change.table === 'media').map(change => change.id))
  await bringFiles(s, [
    ...changes.filter(change => change.table === 'traces').flatMap(change => filesOf(change.row)),
    ...(sentLate.size ? rowsOf(merged, 'traces').flatMap(filesOf).filter(url => sentLate.has(url)) : []),
  ], merged)
  await bringIn(s, changes)
  s.merged = merged
  s.last = last
  for (const { id } of saves) s.seen.add(id)
  await persist(s)
}

const LIVE: Partial<Record<Table, LiveTable>> = { traces: 'traces', layers: 'layers', trace_links: 'trace_links', lobby_locations: 'lobby_locations' }

async function bringIn(s: Session, changes: Change[]): Promise<void> {
  for (const table of new Set(changes.map(change => change.table))) {
    // Where files are in Drive: the sync's own, no table of the working copy's.
    if (table === 'media') continue
    const mine = changes.filter(change => change.table === table)
    let rows = mine.filter(change => change.row).map(change => change.row!) as Record<string, any>[]
    const gone = mine.filter(change => !change.row).map(change => change.id)
    // The atrium's own row keeps what's this device's (lib/driveFormat, carried).
    if (table === 'lobbies') {
      const here = (await s.local.atriumRows(s.lobbyId)).lobbies[0] ?? {}
      rows = rows.map(row => ({ ...here, ...carried('lobbies', row) }))
    }
    await s.local.takeAtriumRows(s.lobbyId, table, rows, gone)
    // Its name, its theme: the open atrium reads its row again.
    if (table === 'lobbies') window.dispatchEvent(new CustomEvent(LOBBY_CHANGED_EVENT, { detail: s.lobbyId }))
    const live = LIVE[table]
    if (live) tellHere({ t: live, ...(rows.length ? { ids: rows.map(row => String(row.id)) } : {}), ...(gone.length ? { gone } : {}) })
  }
}

// ---------------------------------------------------------------- files

// Where a trace's files are on this device: its picture, video, document.
const filesOf = (row: Record<string, unknown> | null) =>
  [row?.media_url, row?.image_url].filter((url): url is string => typeof url === 'string' && url.startsWith('local://'))
const mediaOf = (merged: Merged, url: string) => merged.get(`media/${url}`)?.row as { file?: unknown } | null | undefined

// Files sent and brought in side by side, AT_ONCE at a time.
let free = AT_ONCE
const turns: (() => void)[] = []
async function inTurn<T>(task: () => Promise<T>): Promise<T> {
  if (free > 0) free--
  else await new Promise<void>(go => turns.push(go))
  try {
    return await task()
  } finally {
    const next = turns.shift()
    if (next) next()
    else free++
  }
}

/** Files of the atrium's traces that aren't in Drive yet and are in this browser. */
async function unsentFiles(s: Session, traces: Record<string, unknown>[]): Promise<string[]> {
  const unsent: string[] = []
  for (const url of new Set(traces.flatMap(filesOf))) {
    if (mediaOf(s.merged, url)) continue
    // One just dropped in, still being written: once it's whole.
    await vaultWriteDone(url)
    if (await s.local.hasLocalFile(url)) unsent.push(url)
  }
  return unsent
}

/** Each sealed into one's folder `files`; where each went, as `media` rows.
 *  One that fails is left out, and sent with a later save. */
async function sendFiles(s: Session, urls: string[]): Promise<{ id: string; file: string }[]> {
  if (!urls.length) return []
  const folder = s.filesFolder ??= (await store.listByLink(s.kept.folder)).find(file => file.name === 'files')?.id
    ?? (await store.createFolder('files', s.kept.folder)).id
  const sent = await Promise.all(urls.map(url => inTurn(async () => {
    try {
      const bytes = await s.local.readLocalFileBytes(url)
      if (!bytes) return null
      const file = await store.write(`${crypto.randomUUID()}.media`, await seal(s.keyring, bytes), { parent: folder })
      s.present.add(url)
      return { id: url, file: file.id }
    } catch (error) {
      console.warn('[drive] sending a file:', url, error)
      return null
    }
  })))
  return sent.filter((row): row is { id: string; file: string } => !!row)
}

const RETRY_FIRST_MS = 30_000
const RETRY_MOST_MS = 10 * 60_000
/** Files in Drive and not in this browser, brought in -- started, not
 *  waited for. Each is a write in progress (lib/vaultWrites) until it's
 *  whole, so what reads it waits; once in, the atrium is told
 *  (atrium:vault-write-complete), for a trace that showed it missing. One that
 *  fails is tried again at a later look, waiting longer each time: Google's
 *  robot check passes in minutes. */
async function bringFiles(s: Session, urls: string[], merged = s.merged): Promise<void> {
  for (const url of new Set(urls)) {
    const file = mediaOf(merged, url)?.file
    if (typeof file !== 'string' || s.present.has(url) || s.fetching.has(url) || (s.retry.get(url)?.at ?? 0) > Date.now()) continue
    if (await s.local.hasLocalFile(url)) { s.present.add(url); continue }
    s.fetching.add(url)
    const fetched = inTurn(async () => {
      if (session !== s) throw new Error('left the atrium')
      await s.local.writeLocalFile(url, await opened(s, await store.readByLink(file)))
    })
    trackVaultWrite(url, fetched)
    fetched.then(() => {
      s.present.add(url)
      s.retry.delete(url)
      window.dispatchEvent(new CustomEvent('atrium:vault-write-complete', { detail: { localUrl: url, lobbyId: s.lobbyId } }))
    }, error => {
      const wait = Math.min(RETRY_MOST_MS, (s.retry.get(url)?.wait ?? RETRY_FIRST_MS / 2) * 2)
      s.retry.set(url, { at: Date.now() + wait, wait })
      console.warn('[drive] bringing a file in:', url, error)
    }).finally(() => s.fetching.delete(url))
  }
}

// ---------------------------------------------------------------- asking to be let in

// Someone with the invite link, not added: asking through the atrium's room,
// for an owner or admin in it to let them in (components/DriveStatus).
const ASK_EVENT = 'drive-ask'
const ASK_EVERY_MS = 15_000

/** From outside the atrium: asking, again every little while so whoever
 *  comes in later sees it too, until what this returns is called. */
export const askToJoin = (lobbyId: string) => sayToRoom(lobbyId, ASK_EVENT, {}, ASK_EVERY_MS)

/** An owner's or admin's app, inside: who asks, as the room knows them --
 *  not a member, not invited, not blocked, not put off -- shown until let in
 *  or put off. */
async function asked(s: Session, sender: string): Promise<void> {
  const roster = s.roster?.roster ?? await lookAtRoster(s)
  if (!roster || !manages(memberOf(roster, s.me)?.role)) return
  if (memberOf(roster, sender) || roster.invited.some(invite => invite.user === sender) || roster.blocked.includes(sender)) return
  if (s.putOff.has(sender) || status.asking.some(asker => asker.user === sender)) return
  const [person] = await peopleByIds([sender])
  if (!person?.username || session !== s) return
  setStatus({ asking: [...status.asking, { user: sender, username: person.username, name: person.display_name || person.username }] })
}

/** Let in, as an editor: added, as from the members panel. */
export async function letInAsker(user: string): Promise<void> {
  const s = session
  const asker = status.asking.find(one => one.user === user)
  if (!s || !asker) return
  await addPerson(s.lobbyId, s.me, asker.username, 'editor')
  setStatus({ asking: status.asking.filter(one => one.user !== user) })
}

/** Not now: not shown again this visit. */
export function putOffAsker(user: string): void {
  session?.putOff.add(user)
  setStatus({ asking: status.asking.filter(one => one.user !== user) })
}

// ---------------------------------------------------------------- deletions, brought back

/** A save that deleted rows its writers' older saves still hold as they were:
 *  whose, when, and how many traces and groups. */
export interface Deletion { at: Clock; by: string; when: number; traces: number; groups: number }
// What the last look found: each deleted row as it last was before it went.
let found: { lobbyId: string; before: Map<string, Change>; gone: Change[] } | null = null

/** The atrium's deletions that can be brought back, newest first -- for its
 *  owner or an admin. Reads every save in Drive, once, on asking. A save
 *  folded into a snapshot since is gone, and what only it held with it. */
export async function findDeletions(lobbyId: string, me: string): Promise<Deletion[]> {
  return withSession(lobbyId, me, async s => {
    const roster = await managed(s)
    const gone = [...s.merged.values()].filter(change => change.row === null && change.table !== 'lobbies' && change.table !== 'media')
    const goneAt = new Map(gone.map(change => [keyOf(change), change.at]))
    const before = new Map<string, Change>()
    if (gone.length) {
      const files = (await listWriters(s, roster)).flatMap(writer => writer.files
        .filter(file => file.name.endsWith('.save') || file.name === SNAPSHOT)
        .map(file => ({ id: file.id, by: writer.user })))
      for (let at = 0; at < files.length; at += AT_ONCE) {
        // One that won't open (sealed with a key this account never had) is passed over.
        const read = await Promise.all(files.slice(at, at + AT_ONCE).map(file => readSave(s, file.id, file.by).catch(() => null)))
        for (const change of read.flatMap(saved => saved?.save.changes ?? [])) {
          const key = keyOf(change)
          const deletedAt = goneAt.get(key)
          if (!change.row || !deletedAt || change.at >= deletedAt) continue
          if ((before.get(key)?.at ?? '') < change.at) before.set(key, change)
        }
      }
    }
    found = { lobbyId, before, gone }
    const bySave = new Map<Clock, Deletion>()
    for (const change of gone) {
      if (!before.has(keyOf(change))) continue
      const deletion = bySave.get(change.at) ?? { at: change.at, by: clockWho(change.at), when: clockTime(change.at), traces: 0, groups: 0 }
      if (change.table === 'traces') deletion.traces++
      if (change.table === 'layers') deletion.groups++
      bySave.set(change.at, deletion)
    }
    return [...bySave.values()].sort((a, b) => (a.at < b.at ? 1 : -1))
  })
}

/** What these saves (`ats`, from findDeletions) deleted, brought back: each
 *  row as it last was, into the working copy and up to Drive as a new save --
 *  later than the deletion, so it's back for everyone, whoever reads the saves
 *  from the start. A group a brought-back trace or group is in comes back
 *  with it. How many traces came back. */
export async function restoreDeletions(lobbyId: string, me: string, ats: Clock[]): Promise<number> {
  if (found?.lobbyId !== lobbyId) throw new Error('look for deletions first')
  const { before, gone } = found
  return withSession(lobbyId, me, async s => {
    await managed(s)
    // Only what's still deleted: another manager may have brought it back since.
    const stillGone = (key: string) => s.merged.get(key)?.row === null && before.has(key)
    const chosen = new Set(ats)
    const back = new Map(gone.filter(change => chosen.has(change.at) && stillGone(keyOf(change))).map(change => [keyOf(change), before.get(keyOf(change))!]))
    const groupOf = (change: Change) => (change.table === 'traces' ? change.row?.layer_id : change.table === 'layers' ? change.row?.parent_id : null)
    for (let grew = true; grew;) {
      grew = false
      for (const change of [...back.values()]) {
        const group = groupOf(change)
        const key = typeof group === 'string' ? `layers/${group}` : null
        if (key && !back.has(key) && stillGone(key)) { back.set(key, before.get(key)!); grew = true }
      }
    }
    const changes = [...back.values()]
    // As saves come in (take): their files on the way first, then the rows.
    await bringFiles(s, changes.filter(change => change.table === 'traces').flatMap(change => filesOf(change.row)))
    await bringIn(s, changes)
    await up(s)
    return changes.filter(change => change.table === 'traces').length
  })
}

// The roster, for its owner or an admin only.
async function managed(s: Session): Promise<Roster> {
  const roster = await lookAtRoster(s)
  if (!roster || !manages(memberOf(roster, s.me)?.role)) throw new Error('NOT_A_MANAGER')
  return roster
}

// A task in step with `lobbyId`'s sync: the open atrium's, or one started for
// it now and stopped after (as keepInDrive does), its copy brought up to date
// first.
async function withSession<T>(lobbyId: string, me: string, task: (s: Session) => Promise<T>): Promise<T> {
  if (session?.lobbyId === lobbyId) return inQueue(session, task)
  await startDriveSync(lobbyId, me)
  const s = session as Session | null
  if (!s) throw new Error('not a Drive atrium')
  try {
    return await inQueue(s, task)
  } finally {
    await stopDriveSync()
  }
}
