// Saving changes -- traces, connections, locations -- when Save is pressed
// (or Ctrl+S), and only then: leaving or closing with changes unsaved asks
// first, and Don't Save puts the atrium back as it was last saved. The undo
// history is the one timeline -- an undo is a change like any other, saved
// the same way -- and it outlasts a save.

import { isDesktop, supabase } from './supabase'
import { useGameStore } from '../store/gameStore'
import { showToast } from './toast'
import { t, tCount } from './i18n'
import { linkRow } from './traceLinks'
import { whenTracesWritten } from './traceWrites'
import { traceColumns, traceRow } from './traceInsert'
import { locationColumns, locationRow, mapLocationRow, receiveLocations } from './locations'
import { mapRowToLink } from './traceLinks'
import { fetchAllLobbyTraces, mapRowToTrace } from '../hooks/useTraces'
import { adoptTraces } from './layerUndo'
import type { LobbyLocation, Trace } from '../types/database'
import type { TraceLink } from './traceLinks'

// Fired on window whenever a save completes. TraceOverlay drops its local
// drag-preview overrides then, so the store -- and so other people's edits
// arriving over realtime -- is what's drawn.
export const TRACE_SAVE_COMPLETED_EVENT = 'trace-save-completed'

type Db = NonNullable<typeof supabase>

// A row written as it now is: updated, or -- gone since, deleted and the
// deletion undone -- put back whole. .select() so a refused update can't pass
// for a written one: RLS doesn't raise on a forbidden UPDATE, it matches
// nothing, and the insert after it then fails on the row that is there.
async function writeRow(db: Db, table: string, id: string, columns: Record<string, any>, whole: () => Record<string, any>): Promise<boolean> {
  const { data, error } = await (db.from(table) as any).update(columns).eq('id', id).select('id')
  if (error) return false
  if (Array.isArray(data) && data.length > 0) return true
  return !(await (db.from(table) as any).insert(whole())).error
}

// What was written leaves the sets of what's to be written -- unless it changed
// again while it was being written. Every change puts a new object for the
// trace (connection, location) in the store, so the same object means no
// change since.
type Written = {
  traces: Trace[]; deleted: string[]; gone: string[]
  links: TraceLink[]; deletedLinks: string[]; goneLinks: string[]
  locations: LobbyLocation[]; deletedLocations: string[]
}
function settle(written: Written) {
  useGameStore.setState(state => {
    const traceNow = new Map(state.traces.map(tr => [tr.id, tr]))
    const linkNow = new Map(state.links.map(l => [l.id, l]))
    const locationNow = new Map(state.locations.map(l => [l.id, l]))
    const pendingChanges = new Set(state.pendingChanges)
    for (const trace of written.traces) if (traceNow.get(trace.id) === trace) pendingChanges.delete(trace.id)
    // Marked changed, but not there to write: nothing to do for it.
    for (const id of written.gone) if (!traceNow.has(id)) pendingChanges.delete(id)
    const pendingLinks = new Set(state.pendingLinks)
    for (const link of written.links) if (linkNow.get(link.id) === link) pendingLinks.delete(link.id)
    for (const id of written.goneLinks) if (!linkNow.has(id)) pendingLinks.delete(id)
    const deletedTraces = new Set(state.deletedTraces)
    for (const id of written.deleted) deletedTraces.delete(id)
    const deletedLinks = new Set(state.deletedLinks)
    for (const id of written.deletedLinks) deletedLinks.delete(id)
    const savedLinks = new Set(state.savedLinks)
    for (const link of written.links) savedLinks.add(link.id)
    const pendingLocations = new Set(state.pendingLocations)
    for (const l of written.locations) if (locationNow.get(l.id) === l) pendingLocations.delete(l.id)
    const deletedLocations = new Set(state.deletedLocations)
    for (const id of written.deletedLocations) deletedLocations.delete(id)
    return { pendingChanges, pendingLinks, deletedTraces, deletedLinks, savedLinks, pendingLocations, deletedLocations }
  })
}

// Said once when saving starts failing, not at every retry after.
let failing = false
function failed(message: string) {
  if (!failing) showToast(message)
  failing = true
  useGameStore.getState().setSaveFailed(true)
}

async function write(): Promise<boolean> {
  const store = useGameStore.getState()
  if (!supabase || !store.hasPendingChanges()) return true
  const db = supabase
  store.setIsSavingChanges(true)
  try {
    // Taken before anything is awaited: leaving an atrium clears the store,
    // and the save that leaving starts must still have what it's to write.
    const { pendingChanges, deletedTraces, traces, pendingLinks, deletedLinks, links, savedLinks, locations, pendingLocations, deletedLocations } = useGameStore.getState()
    // New traces still on their way to the database first (lib/traceWrites):
    // an update to a row not there yet would put it there twice.
    await whenTracesWritten()
    const changed = traces.filter(tr => pendingChanges.has(tr.id))
    const gone = [...pendingChanges].filter(id => !changed.some(tr => tr.id === id))
    const linksChanged = links.filter(l => pendingLinks.has(l.id))
    const goneLinks = [...pendingLinks].filter(id => !linksChanged.some(l => l.id === id))
    const deleted = [...deletedTraces]
    const linksDeleted = [...deletedLinks]
    const locationsChanged = locations.filter(l => pendingLocations.has(l.id))
    const locationsDeleted = [...deletedLocations]

    // Connections removed before their traces: on the web a trace's deletion
    // takes its connections with it anyway, but the desktop shim doesn't
    // cascade.
    const linksGoneOk = await Promise.all(linksDeleted.map(async id => !(await (db.from('trace_links') as any).delete().eq('id', id)).error))
    const deletedOk = await Promise.all(deleted.map(async id => !(await (db.from('traces') as any).delete().eq('id', id)).error))
    const tracesOk = await Promise.all(changed.map(trace => writeRow(db, 'traces', trace.id, traceColumns(trace), () => traceRow(trace))))
    // Connections after their traces, so a connection put back has both ends.
    const linksOk = await Promise.all(linksChanged.map(async link => {
      const row = linkRow(link)
      if (!savedLinks.has(link.id)) return !(await (db.from('trace_links') as any).insert(row)).error
      const { id: _id, ...fields } = row
      return writeRow(db, 'trace_links', link.id, fields, () => row)
    }))
    const locationsGoneOk = await Promise.all(locationsDeleted.map(async id => !(await (db.from('lobby_locations') as any).delete().eq('id', id)).error))
    const locationsOk = await Promise.all(locationsChanged.map(l => writeRow(db, 'lobby_locations', l.id, locationColumns(l), () => locationRow(l))))

    settle({
      traces: changed.filter((_, i) => tracesOk[i]),
      deleted: deleted.filter((_, i) => deletedOk[i]),
      links: linksChanged.filter((_, i) => linksOk[i]),
      deletedLinks: linksDeleted.filter((_, i) => linksGoneOk[i]),
      gone,
      goneLinks,
      locations: locationsChanged.filter((_, i) => locationsOk[i]),
      deletedLocations: locationsDeleted.filter((_, i) => locationsGoneOk[i]),
    })
    const refused = [tracesOk, deletedOk, linksOk, linksGoneOk, locationsOk, locationsGoneOk].flat().filter(ok => !ok).length
    if (refused > 0) {
      // Left to be written: the next try may get through, and they're the
      // user's work either way.
      failed(tCount('atrium.error.changesRefused', refused))
      return false
    }
    failing = false
    useGameStore.getState().setSaveFailed(false)
    window.dispatchEvent(new CustomEvent(TRACE_SAVE_COMPLETED_EVENT))
    return true
  } catch (error) {
    console.error('[save] could not save:', error)
    failed(t('atrium.hud.notSaved'))
    return false
  } finally {
    useGameStore.getState().setIsSavingChanges(false)
  }
}

// Everything changed up to now written, after any save already under way:
// whether all of it was. For Save, Ctrl+S, and leaving or closing.
let inFlight: Promise<boolean> | null = null
export function saveAllChanges(): Promise<boolean> {
  if (inFlight) return inFlight.then(() => saveAllChanges())
  const saving = write().finally(() => { inFlight = null })
  inFlight = saving
  return saving
}

// ---- Don't Save ------------------------------------------------------------------

// Fired on window once changes are discarded: TraceOverlay's history goes with
// them, its steps being from a state that is no longer there.
// Auto-save (User Preferences; off unless turned on -- Save is pressed by
// default): what's waiting is written `everyMs` after the first change made
// since the last save (the preference's interval), never in the middle of a
// drag, and at once when the window is hidden or the atrium left. A save that
// fails is tried again, further apart each time, until one gets through or
// Save is pressed.
const RETRY_MS = [5_000, 15_000, 30_000, 60_000]

export function startAutosave(everyMs: number): () => void {
  let timer: number | undefined
  let dirtySince: number | null = null
  let failures = 0
  let held = false

  const schedule = () => {
    window.clearTimeout(timer)
    if (dirtySince === null) dirtySince = Date.now()
    timer = window.setTimeout(run, Math.max(0, dirtySince + everyMs - Date.now()))
  }
  const retry = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(run, RETRY_MS[Math.min(failures, RETRY_MS.length) - 1])
  }
  const run = async () => {
    if (!useGameStore.getState().hasPendingChanges()) { dirtySince = null; return }
    if (held) return // the release saves
    dirtySince = null
    const ok = await saveAllChanges()
    failures = ok ? 0 : failures + 1
    if (!ok) retry()
    else if (useGameStore.getState().hasPendingChanges()) schedule()
  }

  const stopWatching = useGameStore.subscribe((state, prev) => {
    // Saved after all -- Save pressed, or Ctrl+S: back to saving as it goes.
    if (prev.saveFailed && !state.saveFailed) failures = 0
    if (failures > 0) return // the retry has it
    if (state.pendingChanges !== prev.pendingChanges || state.deletedTraces !== prev.deletedTraces
      || state.pendingLinks !== prev.pendingLinks || state.deletedLinks !== prev.deletedLinks
      || state.pendingLocations !== prev.pendingLocations || state.deletedLocations !== prev.deletedLocations) {
      if (state.hasPendingChanges()) schedule()
    }
  })
  const press = () => { held = true }
  const release = () => {
    if (!held) return
    held = false
    if (useGameStore.getState().hasPendingChanges() && failures === 0) schedule()
  }
  // The window hidden: now, not after the quiet.
  const hidden = () => {
    if (document.visibilityState !== 'hidden') return
    window.clearTimeout(timer)
    held = false
    void run()
  }
  window.addEventListener('pointerdown', press, true)
  window.addEventListener('pointerup', release, true)
  window.addEventListener('pointercancel', release, true)
  // A release outside the window may never arrive.
  window.addEventListener('blur', release)
  document.addEventListener('visibilitychange', hidden)
  if (useGameStore.getState().hasPendingChanges()) schedule()

  // Turned off, or the atrium left some other way than its Leave button
  // (which saves first): what's waiting is written all the same.
  return () => {
    window.clearTimeout(timer)
    if (useGameStore.getState().hasPendingChanges()) void saveAllChanges()
    stopWatching()
    window.removeEventListener('pointerdown', press, true)
    window.removeEventListener('pointerup', release, true)
    window.removeEventListener('pointercancel', release, true)
    window.removeEventListener('blur', release)
    document.removeEventListener('visibilitychange', hidden)
  }
}

export const TRACE_DISCARD_COMPLETED_EVENT = 'trace-discard-completed'

// Back to what was last saved: what's waiting to be written is dropped, and
// the atrium's traces, connections and locations read again. The whole
// atrium, not a capped page -- this replaces them all, and a truncated read
// would drop everything past the cap. Groups and drawn strokes are written
// as they're made (lib/layerQueue, lib/drawingFiles), so they stay.
export async function discardAllChanges(lobbyId: string): Promise<boolean> {
  const store = useGameStore.getState()
  if (!supabase || store.isSavingChanges || !store.hasPendingChanges()) return false
  try {
    const [rows, links, places] = await Promise.all([
      fetchAllLobbyTraces(supabase, lobbyId),
      (supabase.from('trace_links') as any).select('*').eq('lobby_id', lobbyId),
      (supabase.from('lobby_locations') as any).select('*').eq('lobby_id', lobbyId).order('order_index', { ascending: true }),
    ])
    if (!rows) return false
    const traces = rows.map(mapRowToTrace)
    // Desktop: each local file's URL worked out before it's drawn, as on entry.
    if (isDesktop) {
      const { resolveLocalStreamUrl } = await import('./localDb')
      const local = new Set(traces.flatMap(tr => [tr.mediaUrl, tr.imageUrl]).filter((url): url is string => !!url?.startsWith('local://')))
      await Promise.allSettled([...local].map(url => resolveLocalStreamUrl(url)))
    }
    useGameStore.getState().clearPendingChanges()
    // Brought back, not made now: kept out of the undo history.
    adoptTraces(traces.map(tr => tr.id))
    useGameStore.getState().setTraces(traces)
    // Left as they are if they can't be read.
    if (!links.error && Array.isArray(links.data)) useGameStore.getState().setLinks(links.data.map(mapRowToLink))
    if (!places.error && Array.isArray(places.data)) receiveLocations(places.data.map(mapLocationRow))
    useGameStore.getState().setSaveFailed(false)
    window.dispatchEvent(new CustomEvent(TRACE_DISCARD_COMPLETED_EVENT))
    return true
  } catch (err) {
    console.error('[discard] could not read the atrium back:', err)
    return false
  }
}
