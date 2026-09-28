// Layer changes, undoable.
//
// A layer change -- a group made, renamed, moved or removed, traces moved
// between groups or reordered or locked from the Layer panel, a group deleted
// with its traces -- is written to the database as it's made, unlike trace
// edits, which wait for Save. So its undo is a write too. withLayerUndo runs
// a change and records what it did (lib/layerDelta) as one step in the
// atrium's history (lib/actionHistory); undo and redo apply that difference
// backwards and forwards, through the layer queue like any layer change.

import { supabase } from './supabase'
import { useGameStore } from '../store/gameStore'
import { recordAction } from './actionHistory'
import { queueLayerChange } from './layerQueue'
import { applyLayerDelta as applyDelta, deltaIsEmpty, layerDelta, reverseDelta, type LayerDelta, type LayerSnapshot } from './layerDelta'

export function snapshotLayers(): LayerSnapshot {
  const { traces, links, layers } = useGameStore.getState()
  return { traces, links, layers }
}

// Traces that arrive in the store by a layer change or its undo rather than
// by being made -- a duplicated group, a deleted one brought back. TraceOverlay
// records every trace it sees appear as an addition of its own; these it
// takes as known instead, since their step is the layer change's.
const adopted = new Set<string>()
let applying = 0
export const layerChangeAdopts = (id: string) => adopted.delete(id) || applying > 0

// Makes the store and the database what `delta` leads to (lib/layerDelta).
export async function applyLayerDelta(delta: LayerDelta): Promise<void> {
  if (!supabase) return
  applying++
  try {
    await applyDelta(delta, { db: supabase, store: () => useGameStore.getState(), adopt: id => adopted.add(id) })
  } finally {
    applying--
  }
  // Desktop has no realtime to tell the Layer panel.
  window.dispatchEvent(new Event('atrium:layers-changed'))
}

// Runs a layer change and records it, as one step, if it changed anything.
// Called inside the layer queue, as the change itself would be.
export async function withLayerUndo<T>(label: string, change: () => Promise<T>): Promise<T> {
  const before = snapshotLayers()
  applying++
  let result: T
  try {
    result = await change()
  } finally {
    applying--
  }
  const delta = layerDelta(before, snapshotLayers())
  // Traces this change made are its own, not additions to record apart.
  for (const trace of delta.tracesAdded) adopted.add(trace.id)
  if (!deltaIsEmpty(delta)) {
    const back = reverseDelta(delta)
    recordAction({
      label,
      undo: () => queueLayerChange(() => applyLayerDelta(back)),
      redo: () => queueLayerChange(() => applyLayerDelta(delta)),
    })
  }
  return result
}
