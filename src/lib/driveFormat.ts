// What a Drive atrium writes to Drive (docs/DECENTRALIZING.md, phase 5):
// every file sealed with the atrium's own key, and the saves they carry
// merged by clock. Pure -- no Drive, no page -- so it's tested on its own.
//
// The key is made in the owner's browser and travels only in the invite
// link's `#` part, which browsers never send to a server: Drive, the room
// and anyone who finds a file's id see ciphertext.

// ---------------------------------------------------------------- the key

const ALGORITHM = { name: 'AES-GCM', length: 256 } as const

export const newAtriumKey = (): Promise<CryptoKey> => crypto.subtle.generateKey(ALGORITHM, true, ['encrypt', 'decrypt'])

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))

/** The key as text, for an invite link's `#` and for keeping. */
export const keyToText = async (key: CryptoKey) => toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', key)))

export async function keyFromText(text: string): Promise<CryptoKey> {
  const raw = fromBase64Url(text)
  if (raw.length !== 32) throw new Error('not an atrium key')
  return crypto.subtle.importKey('raw', raw, ALGORITHM, true, ['encrypt', 'decrypt'])
}

// ---------------------------------------------------------------- sealing

// A sealed file: this format's version, a fresh 12-byte nonce, then the
// ciphertext with its tag. Opening one with the wrong key, or one changed by
// anyone, throws rather than giving back anything.
const SEALED_V1 = 1
const NONCE = 12

export async function seal(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain as BufferSource))
  const sealed = new Uint8Array(1 + NONCE + cipher.length)
  sealed[0] = SEALED_V1
  sealed.set(nonce, 1)
  sealed.set(cipher, 1 + NONCE)
  return sealed
}

export async function unseal(key: CryptoKey, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed[0] !== SEALED_V1 || sealed.length < 1 + NONCE + 16) throw new Error('not a sealed atrium file')
  const nonce = sealed.subarray(1, 1 + NONCE) as BufferSource
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed.subarray(1 + NONCE) as BufferSource))
}

export const sealJson = (key: CryptoKey, value: unknown) => seal(key, new TextEncoder().encode(JSON.stringify(value)))
export const unsealJson = async <T>(key: CryptoKey, sealed: Uint8Array): Promise<T> => JSON.parse(new TextDecoder().decode(await unseal(key, sealed)))

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
// arriving later can't bring the row back).
export type Table = 'lobbies' | 'traces' | 'layers' | 'trace_links' | 'lobby_locations'
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
 *  each row that's new or different, and each merged row it no longer has. */
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
  for (const [key, had] of merged) if (had.row !== null && !here.has(key)) changes.push({ table: had.table, id: had.id, at, row: null })
  return changes
}

/** Everything merged, as one snapshot (tombstones kept, so a late old save still can't revive a row). */
export const snapshotOf = (merged: Merged): DriveSave => ({ v: 1, changes: [...merged.values()] })
