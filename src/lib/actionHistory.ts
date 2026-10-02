// Where an action done outside TraceOverlay goes to be undoable: the one
// history the atrium's Ctrl+Z walks, in the order things happened.
//
// TraceOverlay keeps that history (its undo stack) and registers itself here
// as the recorder while it's mounted. Anything else -- the Layer panel's group
// and order changes, which write to the database at once -- records a pair of
// closures, undo and redo, through recordAction. Without a recorder (nothing
// mounted to undo into) an action simply isn't recorded.

import { useSyncExternalStore } from 'react'

export interface ActionEntry {
  label: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

let recorder: ((entry: ActionEntry) => void) | null = null

// Returns the way to stop recording there -- for an effect's cleanup.
export function setActionRecorder(next: (entry: ActionEntry) => void): () => void {
  recorder = next
  return () => {
    if (recorder === next) recorder = null
  }
}

export function recordAction(entry: ActionEntry) {
  recorder?.(entry)
}

// Whether the history has a step to undo, and one to redo: set by
// TraceOverlay as it changes, read by the undo and redo buttons (LobbyScene).
let reach = { undo: false, redo: false }
const watchers = new Set<() => void>()
const watch = (fn: () => void) => {
  watchers.add(fn)
  return () => { watchers.delete(fn) }
}

export function setHistoryReach(undo: boolean, redo: boolean) {
  if (reach.undo === undo && reach.redo === redo) return
  reach = { undo, redo }
  watchers.forEach(fn => fn())
}

export const useHistoryReach = () => useSyncExternalStore(watch, () => reach)
