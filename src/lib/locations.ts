// An atrium's locations -- its saved views -- kept in the store and saved with
// everything else: each change is written a moment after it's made
// (lib/traceSave) and is one step of undo (lib/actionHistory). They used to
// be a working copy of their own with a Save and a Discard of their own.

import { useGameStore } from '../store/gameStore'
import { recordAction } from './actionHistory'
import type { LobbyLocation } from '../types/database'

export function mapLocationRow(row: any): LobbyLocation {
  return {
    id: row.id,
    createdAt: row.created_at,
    lobbyId: row.lobby_id,
    name: row.name,
    positionX: row.position_x,
    positionY: row.position_y,
    zoom: row.zoom ?? 1,
    orderIndex: row.order_index ?? 0,
    userId: row.user_id,
    isLocked: !!row.is_locked,
  }
}

// The columns a location is written with; with its id and atrium, its row.
export function locationColumns(l: LobbyLocation): Record<string, any> {
  return {
    name: l.name,
    position_x: l.positionX,
    position_y: l.positionY,
    zoom: l.zoom,
    order_index: l.orderIndex,
    is_locked: !!l.isLocked,
  }
}
export const locationRow = (l: LobbyLocation) => ({ ...locationColumns(l), id: l.id, lobby_id: l.lobbyId, user_id: l.userId ?? null, created_at: l.createdAt })

// The list made `next`: a location new or changed (a new object) to be
// written, one gone to be deleted.
function setLocationList(next: LobbyLocation[]) {
  useGameStore.setState(state => {
    const before = new Map(state.locations.map(l => [l.id, l]))
    const nextIds = new Set(next.map(l => l.id))
    const pendingLocations = new Set(state.pendingLocations)
    const deletedLocations = new Set(state.deletedLocations)
    for (const l of next) {
      if (before.get(l.id) === l) continue
      pendingLocations.add(l.id)
      deletedLocations.delete(l.id)
    }
    for (const l of state.locations) {
      if (nextIds.has(l.id)) continue
      pendingLocations.delete(l.id)
      deletedLocations.add(l.id)
    }
    return { locations: next, pendingLocations, deletedLocations }
  })
}

// Each in its place: orderIndex follows the list, a moved one a new object.
const numbered = (list: LobbyLocation[]) => list.map((l, i) => (l.orderIndex === i ? l : { ...l, orderIndex: i }))

// A change to the list, as one step of undo.
export function changeLocations(label: string, change: (list: LobbyLocation[]) => LobbyLocation[]) {
  const before = useGameStore.getState().locations
  const after = numbered(change(before))
  if (after.length === before.length && after.every((l, i) => l === before[i])) return
  setLocationList(after)
  recordAction({ label, undo: () => setLocationList(before), redo: () => setLocationList(after) })
}

// As the database has them -- loaded, or reloaded when anyone's change
// arrives over realtime -- except what's being changed here and isn't written
// yet, which stays as it is here.
export function receiveLocations(rows: LobbyLocation[]) {
  useGameStore.setState(state => {
    const { pendingLocations, deletedLocations } = state
    const local = new Map(state.locations.map(l => [l.id, l]))
    const merged = rows
      .filter(l => !deletedLocations.has(l.id))
      .map(l => (pendingLocations.has(l.id) ? local.get(l.id) ?? l : l))
    const there = new Set(merged.map(l => l.id))
    for (const l of state.locations) if (pendingLocations.has(l.id) && !there.has(l.id)) merged.push(l)
    merged.sort((a, b) => a.orderIndex - b.orderIndex)
    return { locations: merged }
  })
}
