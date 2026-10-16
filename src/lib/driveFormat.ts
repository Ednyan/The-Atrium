// What a Drive atrium writes to Drive (docs/DECENTRALIZING.md, phase 5):
// every file sealed with the atrium's key, its members and what each may do,
// and the saves the files carry merged by clock. Pure -- no Drive, no page --
// so it's tested on its own.
//
// Only members can read it. The atrium's key is never sent anywhere as it is:
// each member has a key pair of their own (its private half in their own
// Google account), and the roster holds the atrium's key encrypted for each
// of them. A member removed gets a new key generation made without them, so
// they can read nothing written after.

// ---------------------------------------------------------------- the atrium's key, by generation

const ALGORITHM = { name: 'AES-GCM', length: 256 } as const

export const newAtriumKey = (): Promise<CryptoKey> => crypto.subtle.generateKey(ALGORITHM, true, ['encrypt', 'decrypt'])

// Every generation of the atrium's key this member has: the newest seals,
// any opens what it sealed.
export type Keyring = Map<number, CryptoKey>
export const newestOf = (keyring: Keyring) => Math.max(...keyring.keys())

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))

/** Bytes as base64 and back, any length: a sealed save in a room message. */
export function bytesToBase64(bytes: Uint8Array): string {
  let text = ''
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(text)
}
export const base64ToBytes = (text: string) => Uint8Array.from(atob(text), ch => ch.charCodeAt(0))

/** A key as text, for keeping in this browser. */
export const keyToText = async (key: CryptoKey) => toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)))

export async function keyFromText(text: string): Promise<CryptoKey> {
  const raw = fromBase64Url(text)
  if (raw.length !== 32) throw new Error('not an atrium key')
  return crypto.subtle.importKey('raw', raw, ALGORITHM, true, ['encrypt', 'decrypt'])
}

// ---------------------------------------------------------------- sealing

// A sealed file: this format's version, the key generation that sealed it
// (4 bytes), a fresh 12-byte nonce, then the ciphertext with its tag. Opening
// one without its generation, or one changed by anyone, throws rather than
// giving back anything.
const SEALED_V2 = 2
const GEN = 4
const NONCE = 12
const HEAD = 1 + GEN + NONCE

/** Missing the generation that sealed it: the keyring is behind (the roster moved). */
export class KeyMissing extends Error {
  readonly generation: number
  constructor(generation: number) {
    super('KEY_MISSING')
    this.generation = generation
  }
}

export async function seal(keyring: Keyring, plain: Uint8Array): Promise<Uint8Array> {
  const generation = newestOf(keyring)
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, keyring.get(generation)!, plain as BufferSource))
  const sealed = new Uint8Array(HEAD + cipher.length)
  sealed[0] = SEALED_V2
  new DataView(sealed.buffer).setUint32(1, generation)
  sealed.set(nonce, 1 + GEN)
  sealed.set(cipher, HEAD)
  return sealed
}

export async function unseal(keyring: Keyring, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed[0] !== SEALED_V2 || sealed.length < HEAD + 16) throw new Error('not a sealed atrium file')
  const generation = new DataView(sealed.buffer, sealed.byteOffset).getUint32(1)
  const key = keyring.get(generation)
  if (!key) throw new KeyMissing(generation)
  const nonce = sealed.subarray(1 + GEN, HEAD) as BufferSource
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed.subarray(HEAD) as BufferSource))
}

export const sealJson = (keyring: Keyring, value: unknown) => seal(keyring, new TextEncoder().encode(JSON.stringify(value)))
export const unsealJson = async <T>(keyring: Keyring, sealed: Uint8Array): Promise<T> => JSON.parse(new TextDecoder().decode(await unseal(keyring, sealed)))

// ---------------------------------------------------------------- a person's own key pair

// For encrypting the atrium's key to one person: ECDH (P-256). The private
// half stays with them (their Google account's hidden app folder); the public
// half is in their profile, for whoever adds them.
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const
export interface Identity { publicJwk: JsonWebKey; privateJwk: JsonWebKey }

export async function newIdentity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']) as CryptoKeyPair
  return { publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey), privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey) }
}

/** The same public key, however its fields are ordered: a profile's comes
 *  back from the database (jsonb) with them reordered. */
export const sameKey = (a: JsonWebKey | null | undefined, b: JsonWebKey | null | undefined) =>
  !!a && !!b && a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y

// The atrium's key, encrypted for one public key: with a key agreed between it
// and a one-off key pair, whose public half goes with it.
export interface Wrapped { epk: JsonWebKey; iv: string; ct: string }

const agreed = (privateKey: CryptoKey, publicKey: CryptoKey, use: KeyUsage) =>
  crypto.subtle.deriveKey({ name: 'ECDH', public: publicKey }, privateKey, ALGORITHM, false, [use])

export async function wrapFor(publicJwk: JsonWebKey, key: CryptoKey): Promise<Wrapped> {
  const oneOff = await crypto.subtle.generateKey(ECDH, true, ['deriveKey']) as CryptoKeyPair
  const theirs = await crypto.subtle.importKey('jwk', publicJwk, ECDH, true, [])
  const iv = crypto.getRandomValues(new Uint8Array(NONCE))
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await agreed(oneOff.privateKey, theirs, 'encrypt'), raw))
  return { epk: await crypto.subtle.exportKey('jwk', oneOff.publicKey), iv: bytesToBase64(iv), ct: bytesToBase64(ct) }
}

export async function unwrapWith(privateJwk: JsonWebKey, wrapped: Wrapped): Promise<CryptoKey> {
  const mine = await crypto.subtle.importKey('jwk', privateJwk, ECDH, false, ['deriveKey'])
  const theirs = await crypto.subtle.importKey('jwk', wrapped.epk, ECDH, true, [])
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(wrapped.iv) as BufferSource }, await agreed(mine, theirs, 'decrypt'), base64ToBytes(wrapped.ct) as BufferSource)
  return crypto.subtle.importKey('raw', raw, ALGORITHM, true, ['encrypt', 'decrypt'])
}

// ---------------------------------------------------------------- the clock

// A hybrid logical clock, as text that sorts as it orders: the time in ms
// (base 36, 9 places), a counter for changes within one ms or behind a clock
// that's ahead (3 places), then who. Never goes backwards on one device, and
// moves past any clock it has seen, so an edit made after reading someone's
// edit always sorts after it, whatever the two machines' clocks say. Two
// people never share one, since who is part of it.
export type Clock = string

const TIME = 9, COUNT = 3
const timeOf = (clock: Clock) => parseInt(clock.slice(0, TIME), 36)
const countOf = (clock: Clock) => parseInt(clock.slice(TIME, TIME + COUNT), 36)
const make = (time: number, count: number, who: string): Clock =>
  time.toString(36).padStart(TIME, '0') + count.toString(36).padStart(COUNT, '0') + who

/** The next clock for `who`: after `last` (theirs, or the latest seen), and at least `now`. */
export function tick(last: Clock | null, now: number, who: string): Clock {
  if (!last || now > timeOf(last)) return make(now, 0, who)
  // Past the counter's places, the next ms: the text would stop sorting.
  if (countOf(last) + 1 >= 36 ** COUNT) return make(timeOf(last) + 1, 0, who)
  return make(timeOf(last), countOf(last) + 1, who)
}

/** The later of two clocks, for keeping as the latest seen. */
export const later = (a: Clock | null, b: Clock | null): Clock | null => (!a ? b : !b ? a : a > b ? a : b)

// ---------------------------------------------------------------- saves and merging

// A change to one row of one of the atrium's tables, at a clock: the row as
// it now is, or null for deleted (kept, as a tombstone, so an older change
// arriving later can't bring the row back). `media` is no table of the
// working copy's: each row says where a file of the atrium is in Drive,
// sealed -- `{ id: its local:// address, file: its Drive id }`.
export type Table = 'lobbies' | 'traces' | 'layers' | 'trace_links' | 'lobby_locations' | 'media'
export interface Change { table: Table; id: string; at: Clock; row: Record<string, unknown> | null }

// A save file, and a snapshot: the same thing, changes -- a snapshot is
// every row's latest.
export interface DriveSave { v: 1; changes: Change[] }

// The atrium as merged so far: each row's latest change.
export type Merged = Map<string, Change>
const keyOf = (change: Pick<Change, 'table' | 'id'>) => `${change.table}/${change.id}`

/** Changes folded in, each kept only if it's later than what's there: so any
 *  order, any repeats, and any mix of saves and snapshots come out the same.
 *  Returns the changes that took (what the working copy has to apply). */
export function merge(merged: Merged, changes: Change[]): Change[] {
  const took: Change[] = []
  for (const change of changes) {
    const key = keyOf(change)
    const had = merged.get(key)
    if (had && had.at >= change.at) continue
    merged.set(key, change)
    took.push(change)
  }
  return took
}

/** The rows of a table as they stand: tombstones left out. */
export const rowsOf = (merged: Merged, table: Table) =>
  [...merged.values()].filter(change => change.table === table && change.row !== null).map(change => change.row!)

export const TABLES: Table[] = ['lobbies', 'traces', 'layers', 'trace_links', 'lobby_locations']

// Columns that are each device's own and never carried: who an atrium shows
// as its owner here (lib/browserAtriums), its own picture of it, when its row
// was last written here.
const OWN: Partial<Record<Table, string[]>> = { lobbies: ['owner_user_id', 'preview_url', 'preview_at', 'updated_at'] }
/** A row as it's carried: without its device's own columns. */
export function carried(table: Table, row: Record<string, unknown>): Record<string, unknown> {
  const own = OWN[table]
  if (!own) return row
  const out = { ...row }
  for (const column of own) delete out[column]
  return out
}
// The same row, however its keys were ordered.
const stable = (value: unknown) => JSON.stringify(value, (_, inner) =>
  inner && typeof inner === 'object' && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : inner)

/** What the working copy changed since what's merged, as changes at `at`:
 *  each row that's new or different, and each merged row it no longer has --
 *  of the tables it has; any other (media) isn't compared. */
export function changesSince(merged: Merged, current: Partial<Record<Table, Record<string, unknown>[]>>, at: Clock): Change[] {
  const changes: Change[] = []
  const here = new Set<string>()
  for (const table of TABLES) {
    for (const full of current[table] ?? []) {
      const id = String(full.id)
      const row = carried(table, full)
      here.add(keyOf({ table, id }))
      const had = merged.get(keyOf({ table, id }))
      if (!had || had.row === null || stable(had.row) !== stable(row)) changes.push({ table, id, at, row })
    }
  }
  for (const [key, had] of merged) if (had.row !== null && current[had.table] && !here.has(key)) changes.push({ table: had.table, id: had.id, at, row: null })
  return changes
}

/** Everything merged, as one snapshot (tombstones kept, so a late old save still can't revive a row). */
export const snapshotOf = (merged: Merged): DriveSave => ({ v: 1, changes: [...merged.values()] })

// ---------------------------------------------------------------- an invitation's secret

// For someone added before they had a key pair: every generation of the key,
// sealed with a one-off secret only they are given -- through the Atrium's
// invitations, readable by them alone -- so they can enter at once. The next
// owner's or admin's app to look lets them in properly (admit, by their key
// pair), and the secret is deleted.
export interface SecretSealed { iv: string; ct: string }
export const newSecret = () => crypto.getRandomValues(new Uint8Array(32))
const secretKey = (secret: Uint8Array, use: KeyUsage) => crypto.subtle.importKey('raw', secret as BufferSource, ALGORITHM, false, [use])

export async function sealForSecret(secret: Uint8Array, keyring: Keyring): Promise<SecretSealed> {
  const raw: Record<string, string> = {}
  for (const [n, key] of keyring) raw[n] = bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)))
  const iv = crypto.getRandomValues(new Uint8Array(NONCE))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await secretKey(secret, 'encrypt'), new TextEncoder().encode(JSON.stringify(raw)))
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) }
}

export async function openWithSecret(secret: Uint8Array, sealed: SecretSealed): Promise<Keyring> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(sealed.iv) as BufferSource }, await secretKey(secret, 'decrypt'), base64ToBytes(sealed.ct) as BufferSource)
  const raw = JSON.parse(new TextDecoder().decode(plain)) as Record<string, string>
  return new Map(await Promise.all(Object.entries(raw).map(async ([n, text]) =>
    [Number(n), await crypto.subtle.importKey('raw', base64ToBytes(text) as BufferSource, ALGORITHM, true, ['encrypt', 'decrypt'])] as [number, CryptoKey])))
}

// ---------------------------------------------------------------- members

// Who an atrium's members are and what each may do. The roster is a file only
// the owner and admins can write -- Google decides that, by who it's shared
// with -- readable by link, holding no addresses.
//
// owner: everything, and alone promotes admins and deletes the atrium.
// admin: adds, removes and blocks people, and sets their roles.
// editor: their saves are taken.
// viewer: reads; their saves are ignored.
export type Role = 'owner' | 'admin' | 'editor' | 'viewer'
// `root`: their own Drive folder for atriums (by link), where this atrium's
// saves of theirs are, in a folder named by its id. `grant`: for an admin,
// their permission to write the roster, so it can be taken back.
export interface Member { user: string; name: string; root: string; role: Role; pub: JsonWebKey; grant?: string }
// `keys`: the key's generations sealed with their invitation's secret, so they
// can enter before they're let in properly.
export interface Invited { user: string; name: string; role: Role; keys?: SecretSealed }
export interface Roster {
  v: 2
  lobbyId: string
  name: string
  members: Member[]
  // Added before they had a key pair: let in by the next owner's or admin's
  // app to look once they have one.
  invited: Invited[]
  blocked: string[]
  // Each generation of the atrium's key, encrypted for each member.
  keys: { n: number; for: Record<string, Wrapped> }[]
}

export const memberOf = (roster: Roster, user: string) => roster.members.find(member => member.user === user) ?? null
export const manages = (role: Role | undefined) => role === 'owner' || role === 'admin'
/** Those whose saves are taken: every member but the viewers. */
export const writersOf = (roster: Roster) => roster.members.filter(member => member.role !== 'viewer')
/** And among the invited, those in by their invitation's secret (but viewers). */
export const invitedWritersOf = (roster: Roster) => roster.invited.filter(invite => invite.keys && invite.role !== 'viewer')
/** One's place in it: a member, or someone in by their invitation. */
export const placeOf = (roster: Roster, user: string): Member | Invited | null =>
  memberOf(roster, user) ?? roster.invited.find(invite => invite.user === user && invite.keys) ?? null

/** A new roster, its owner its only member, with the key's first generation. */
export async function newRoster(lobbyId: string, name: string, owner: Omit<Member, 'role'>, key: CryptoKey): Promise<Roster> {
  return { v: 2, lobbyId, name, members: [{ ...owner, role: 'owner' }], invited: [], blocked: [], keys: [{ n: 0, for: { [owner.user]: await wrapFor(owner.pub, key) } }] }
}

/** Someone let in: a member, every generation of the key encrypted for them, out of the invited. */
export async function admit(roster: Roster, keyring: Keyring, person: Omit<Member, 'role'>, role: Role): Promise<Roster> {
  if (roster.blocked.includes(person.user)) throw new Error('BLOCKED')
  const keys = await Promise.all(roster.keys.map(async generation => {
    const key = keyring.get(generation.n)
    return key ? { ...generation, for: { ...generation.for, [person.user]: await wrapFor(person.pub, key) } } : generation
  }))
  // Let in again (a new key pair): an admin keeps the grant that's theirs to lose.
  const grant = memberOf(roster, person.user)?.grant
  return {
    ...roster,
    members: [...roster.members.filter(member => member.user !== person.user), { ...person, role, ...(grant && role === 'admin' ? { grant } : {}) }],
    invited: roster.invited.filter(invite => invite.user !== person.user),
    keys,
  }
}

/** Someone out (and, `block`ed, kept out): not a member, and a new generation
 *  of the key made without them -- returned with the keyring it joins. */
export async function removeMember(roster: Roster, keyring: Keyring, user: string, block: boolean): Promise<{ roster: Roster; keyring: Keyring }> {
  if (memberOf(roster, user)?.role === 'owner') throw new Error('the owner stays')
  const members = roster.members.filter(member => member.user !== user)
  const key = await newAtriumKey()
  const n = Math.max(...roster.keys.map(generation => generation.n)) + 1
  const wrapped: Record<string, Wrapped> = {}
  for (const member of members) wrapped[member.user] = await wrapFor(member.pub, key)
  return {
    roster: {
      ...roster,
      members,
      // Invitations' secrets cancelled too: someone removed may have seen one,
      // and it would open the new generation. Those invited get in by their
      // key pair instead, at the next owner's or admin's look.
      invited: roster.invited.filter(invite => invite.user !== user).map(({ keys: _cancelled, ...invite }) => invite),
      blocked: block && !roster.blocked.includes(user) ? [...roster.blocked, user] : roster.blocked,
      // His copies of every generation out too: no device of his can open
      // more than he already has.
      keys: [...roster.keys.map(generation => ({ ...generation, for: Object.fromEntries(Object.entries(generation.for).filter(([who]) => who !== user)) })), { n, for: wrapped }],
    },
    keyring: new Map([...keyring, [n, key]]),
  }
}

/** Every generation of the key encrypted for `user`, opened with their private key. */
export async function keyringOf(roster: Roster, user: string, privateJwk: JsonWebKey): Promise<Keyring> {
  const keyring: Keyring = new Map()
  for (const generation of roster.keys) {
    const wrapped = generation.for[user]
    if (wrapped) keyring.set(generation.n, await unwrapWith(privateJwk, wrapped))
  }
  return keyring
}
