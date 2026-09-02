// When each atrium was last opened, so the browser can list the ones somebody
// actually uses first.
//
// Two stores, on purpose.
//
// The device always keeps its own copy in localStorage, and that copy is what
// the sort reads. It needs no network, no account and no round trip, and it is
// the whole story on desktop, where a vault lives on one machine and the order
// is expected to be that machine's.
//
// The web app additionally mirrors it to `lobby_visits`, so somebody signing in
// from another browser finds the order they left. Every call to that table is
// behind `!isDesktop`: writing it needs `.upsert()`, and the SQLite shim
// implements `insert` and nothing resembling it -- a missing method there
// throws a TypeError rather than returning an error, escapes the `if (error)`
// check, and takes down the calling function, which here would be the atrium
// browser itself.
//
// Remote is merged INTO local rather than read alongside it, so there is still
// exactly one thing the sort consults and no question of which wins. The merge
// keeps whichever timestamp is later.

import { supabase, isDesktop } from './supabase'

const KEY = 'lobby_recentAtriums'

// Enough that nobody reaches it by using the app, small enough that the entry
// cannot grow without bound as atriums are created and deleted.
const MAX_ENTRIES = 200

type Visits = Record<string, number>

function read(): Visits {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    // Anything that isn't a finite number is dropped rather than trusted: this
    // value is sorted on, and a NaN in a comparator scrambles the whole list.
    const clean: Visits = {}
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === 'number' && Number.isFinite(at)) clean[id] = at
    }
    return clean
  } catch {
    return {}
  }
}

/** Record that an atrium was opened just now. */
export function markAtriumVisited(lobbyId: string) {
  if (!lobbyId) return
  try {
    const visits = read()
    visits[lobbyId] = Date.now()

    // Trim oldest-first when it grows past the cap.
    const ids = Object.keys(visits)
    if (ids.length > MAX_ENTRIES) {
      const keep = ids
        .sort((a, b) => visits[b] - visits[a])
        .slice(0, MAX_ENTRIES)
      const trimmed: Visits = {}
      for (const id of keep) trimmed[id] = visits[id]
      localStorage.setItem(KEY, JSON.stringify(trimmed))
      return
    }

    localStorage.setItem(KEY, JSON.stringify(visits))
  } catch {
    // Storage disabled or full. The list falls back to newest-first, which is
    // where it started.
  }

  // After the local write, never instead of it.
  void pushVisit(lobbyId)
}

/** When an atrium was last opened, or 0 if it never has been on this device. */
export function atriumVisitedAt(lobbyId: string): number {
  return read()[lobbyId] ?? 0
}

/**
 * Sort a list so the most recently opened come first.
 *
 * Anything never opened here keeps the order it arrived in, after everything
 * that has been -- which for the atrium browser means newest-first, since that
 * is how the query returns them. Reads storage once rather than once per
 * comparison, because a comparator is called O(n log n) times.
 */
export function sortByLastVisited<T>(items: T[], idOf: (item: T) => string): T[] {
  const visits = read()
  return items
    .map((item, index) => ({ item, index, at: visits[idOf(item)] ?? 0 }))
    .sort((a, b) => (b.at - a.at) || (a.index - b.index))
    .map(entry => entry.item)
}

// ---------------------------------------------------------------------------
// The web's synced copy
// ---------------------------------------------------------------------------

/**
 * Mirror one visit to the database.
 *
 * Fire and forget, and silent on failure: the local copy has already been
 * written by the time this runs, so the sort is correct on this device whatever
 * happens here. Being unable to sync is not worth interrupting somebody
 * entering an atrium.
 */
async function pushVisit(lobbyId: string) {
  if (isDesktop || !supabase) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase
      .from('lobby_visits')
      .upsert(
        { user_id: user.id, lobby_id: lobbyId, visited_at: new Date().toISOString() },
        // Both halves of the primary key. Without naming it the upsert inserts
        // a second row per visit instead of replacing the one that is there.
        { onConflict: 'user_id,lobby_id' },
      )
  } catch {
    // Offline, signed out, or the table has not been created yet. The local
    // order stands.
  }
}

/**
 * Fold this account's stored visits into the local copy.
 *
 * Called before the browser sorts. Later timestamp wins, so a visit made on
 * this device since the last sync is not undone by an older remote one, and a
 * visit made in another browser arrives.
 */
export async function mergeRemoteVisits(): Promise<void> {
  if (isDesktop || !supabase) return
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase
      .from('lobby_visits')
      .select('lobby_id,visited_at')
      .eq('user_id', user.id)
    if (error || !Array.isArray(data)) return

    const visits = read()
    let changed = false
    for (const row of data) {
      const at = Date.parse(row.visited_at)
      if (!Number.isFinite(at)) continue
      if (at > (visits[row.lobby_id] ?? 0)) {
        visits[row.lobby_id] = at
        changed = true
      }
    }
    if (changed) localStorage.setItem(KEY, JSON.stringify(visits))
  } catch {
    // Same as above: the local order stands.
  }
}
