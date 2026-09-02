// When each atrium was last opened, so the browser can list the ones somebody
// actually uses first.
//
// Kept on the device rather than in the database. A `lobby_visits` table would
// survive a reinstall and follow somebody between the web app and the desktop
// one, which is genuinely better -- but writing it needs `.upsert()`, and the
// desktop SQLite shim implements `insert` and nothing like it. A missing method
// there throws a TypeError rather than returning an error, so it escapes the
// `if (error)` check and takes down the whole calling function: the atrium
// browser, in this case. That trade is not worth a sort order.
//
// The consequence is honest and small: the order is per device, and a fresh
// install starts with everything unvisited, which falls back to newest-first --
// exactly what the list did before this existed.

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
