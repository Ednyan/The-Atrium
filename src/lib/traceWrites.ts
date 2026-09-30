// A new trace, there at once.
//
// Made in the store the moment it's asked for and written to the database
// behind it -- as Excalidraw makes things: nothing waits on the round trip to
// appear, which on the web was most of the time between letting go of a
// dragged-out shape and seeing it. Its id is made here, so the row it becomes
// is the same trace. A write that fails takes it away again and says why
// (onFailed).
//
// Whatever writes to trace rows straight away waits for these first
// (whenTracesWritten): the layer queue and Save do, so neither ever updates a
// row that isn't there yet.

import { supabase } from './supabase'
import { useGameStore } from '../store/gameStore'
import { mapRowToTrace } from '../hooks/useTraces'
import { waitBeforeLayerChanges } from './layerQueue'
import type { Trace } from '../types/database'

const writing = new Set<Promise<void>>()

export function whenTracesWritten(): Promise<void> {
  return Promise.all([...writing]).then(() => undefined)
}
waitBeforeLayerChanges(whenTracesWritten)

// `row` as the database has it (column names), without an id. The trace, as
// it now is in the store.
export function insertTrace(row: Record<string, any>, onFailed: (message: string) => void): Trace {
  const full = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() }
  const trace = mapRowToTrace(full)
  useGameStore.getState().addTrace(trace)
  if (supabase) {
    const write: Promise<void> = (async () => {
      const { error } = await (supabase.from('traces') as any).insert(full)
      if (error) {
        useGameStore.getState().removeTrace(trace.id)
        onFailed(error.message ?? String(error))
      }
    })().finally(() => { writing.delete(write) })
    writing.add(write)
  }
  return trace
}
