// Others' saves, live: an atrium's traces, groups, links and locations as
// others change them -- through the atrium's room (lib/rooms) while it has
// one, so nobody holds a Supabase realtime connection for them (Supabase's
// free tier allows 200 at once, for the whole app); through Supabase's change
// feed otherwise, as before (docs/DECENTRALIZING.md, phase 3, step 2).
//
// Telling: every write the web app makes goes through one fetch (lib/supabase,
// listenToWrites), and one that succeeded on these tables is announced in the
// room -- which rows, by id, or the whole table when the write didn't say. Rows
// a deleted trace takes with it (its links: on delete cascade) are announced
// as the links table changing.
//
// Hearing: the rows are read again from the database, this atrium's only, one
// read at a time per table so a later read never lands before an earlier one,
// and handed to the table's own code. The database stays the record, and what
// anyone may read is still its rules': an announcement only says where to look.
//
// A write made by someone whose room couldn't be reached isn't announced; the
// others see it on their next visit.

import { listenToWrites } from './supabase'
import { onRoomEvent, roomStatus, roomUrl, sendThroughRoom, watchRooms } from './rooms'

export type LiveTable = 'traces' | 'layers' | 'trace_links' | 'lobby_locations'
/** Rows changed (`ids`), rows gone (`gone`), or anything at all (`all`). */
export interface Change { t: LiveTable; ids?: string[]; gone?: string[]; all?: boolean }

const TABLES = new Set<string>(['traces', 'layers', 'trace_links', 'lobby_locations'])
// Ids per announcement, under the room's 64 KB a message.
const IDS_PER_MESSAGE = 500
// How long an atrium waits to be given a room before using the change feed.
const ROOM_WAIT_MS = 6000
// Tried before everyone has it: localStorage['atrium.livesaves'] = 'room' to
// hear saves through the room in this browser, 'feed' for Supabase's feed.
// Saves are announced in the room either way.
const VIA_ROOM_BY_DEFAULT = false
function viaRoom() {
  try {
    const chosen = localStorage.getItem('atrium.livesaves')
    return chosen === 'room' || (chosen !== 'feed' && VIA_ROOM_BY_DEFAULT)
  } catch {
    return VIA_ROOM_BY_DEFAULT
  }
}

/** What a successful write changed, read from its request. */
export function changeOf(url: string, method: string, body: unknown): Change | null {
  let where: URL
  try { where = new URL(url) } catch { return null }
  const table = where.pathname.match(/\/rest\/v1\/([a-z_]+)$/)?.[1]
  if (!table || !TABLES.has(table)) return null
  const t = table as LiveTable
  const ids = idsIn(where.searchParams.get('id'))
  if (method === 'DELETE') return ids ? { t, gone: ids } : { t, all: true }
  if (method === 'PATCH') return ids ? { t, ids } : { t, all: true }
  if (method === 'POST') {
    try {
      const rows = JSON.parse(typeof body === 'string' ? body : '')
      const written = (Array.isArray(rows) ? rows : [rows]).map(row => row?.id)
      if (written.length && written.every(id => typeof id === 'string')) return { t, ids: written }
    } catch { /* not JSON rows */ }
    return { t, all: true }
  }
  return null
}

// PostgREST's id filter: `eq.<id>` or `in.(<id>,<id>)`, values maybe quoted.
function idsIn(filter: string | null): string[] | null {
  if (!filter) return null
  if (filter.startsWith('eq.')) return [filter.slice(3)]
  const list = filter.match(/^in\.\((.*)\)$/)?.[1]
  return list === undefined ? null : list.split(',').map(id => id.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)
}

/** Announce a change in the room in use, in pieces small enough for it. */
function announce(change: Change) {
  const pieces: Change[] = []
  for (const key of ['ids', 'gone'] as const) {
    const ids = change[key]
    for (let at = 0; ids && at < ids.length; at += IDS_PER_MESSAGE) pieces.push({ t: change.t, [key]: ids.slice(at, at + IDS_PER_MESSAGE) })
  }
  if (change.all) pieces.push({ t: change.t, all: true })
  // A trace deleted takes its links with it, in the database itself.
  if (change.t === 'traces' && change.gone?.length) pieces.push({ t: 'trace_links', all: true })
  for (const piece of pieces) if (!sendThroughRoom('changes', piece)) return
}

// Writes close together told as one: a save writes a row a request, and a
// group of traces moved should arrive moved, all at once -- not a trace at a
// time. Told QUIET_MS after the last, or MOST_WAIT_MS after the first. Each
// row as its last write left it: changed, or gone.
const QUIET_MS = 120
const MOST_WAIT_MS = 1500
const gathered = new Map<LiveTable, { rows: Map<string, 'ids' | 'gone'>; all: boolean }>()
let quiet = 0
let firstAt = 0
function gather(change: Change) {
  const table = gathered.get(change.t) ?? { rows: new Map(), all: false }
  gathered.set(change.t, table)
  for (const id of change.ids ?? []) table.rows.set(id, 'ids')
  for (const id of change.gone ?? []) table.rows.set(id, 'gone')
  if (change.all) table.all = true
  const now = performance.now()
  if (!firstAt) firstAt = now
  window.clearTimeout(quiet)
  quiet = window.setTimeout(tell, Math.max(0, Math.min(QUIET_MS, firstAt + MOST_WAIT_MS - now)))
}
function tell() {
  firstAt = 0
  for (const [t, { rows, all }] of gathered) {
    const ids = [...rows].filter(([, last]) => last === 'ids').map(([id]) => id)
    const gone = [...rows].filter(([, last]) => last === 'gone').map(([id]) => id)
    announce({ t, ...(ids.length ? { ids } : {}), ...(gone.length ? { gone } : {}), ...(all ? { all } : {}) })
  }
  gathered.clear()
}

listenToWrites((url, method, body) => {
  const change = changeOf(url, method, body)
  if (change) gather(change)
})

/** Keep an atrium's table live: `feed` subscribes to Supabase's change feed
 *  (returning how to stop), used whenever the atrium has no room; `apply`
 *  takes what the room says changed. Returns how to stop altogether. */
export function liveTable(lobbyId: string, table: LiveTable, feed: () => () => void, apply: (change: Change) => void | Promise<void>) {
  let stopFeed: (() => void) | null = null
  let waited = false
  // One change at a time: a later read never lands before an earlier one.
  let queue = Promise.resolve()
  const stopHearing = onRoomEvent('changes', payload => {
    const change = payload as Change
    // Not while the feed carries it, nor from another atrium's room.
    if (!change || change.t !== table || stopFeed || roomStatus(lobbyId) === null) return
    queue = queue.then(() => apply(change)).catch(() => {})
  })
  const choose = () => {
    const status = roomStatus(lobbyId)
    // The room, or a room on its way: no feed. None at all once the wait is
    // over, or one given up on: the feed.
    const useFeed = !roomUrl() || !viaRoom() || status === 'gone' || (status === null && waited)
    if (useFeed && !stopFeed) stopFeed = feed()
    else if (!useFeed && stopFeed) { stopFeed(); stopFeed = null }
  }
  const timer = window.setTimeout(() => { waited = true; choose() }, ROOM_WAIT_MS)
  const stopWatching = watchRooms(choose)
  choose()
  return () => {
    window.clearTimeout(timer)
    stopWatching()
    stopHearing()
    stopFeed?.()
  }
}

/** Rows of this atrium's `table` by id, read in pieces short enough for a URL. */
export async function readRows(client: any, table: LiveTable, lobbyId: string, ids: string[]): Promise<any[]> {
  const pieces: string[][] = []
  for (let at = 0; at < ids.length; at += 100) pieces.push(ids.slice(at, at + 100))
  // Side by side, then handed over together.
  const read = await Promise.all(pieces.map(async piece => {
    const { data, error } = await client.from(table).select('*').eq('lobby_id', lobbyId).in('id', piece)
    if (error) throw error
    return data ?? []
  }))
  return read.flat()
}
