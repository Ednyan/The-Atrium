// One timeline for everything that can be taken back.
//
// The atrium grew three separate answers to undo, and they do not agree:
//
//   1. TraceOverlay keeps undoStackRef/redoStackRef for traces -- added,
//      deleted, edited, moved -- a hundred deep, cleared when the atrium is
//      saved.
//   2. LobbyScene keeps drawPastRef/drawFutureRef for the drawing, holding
//      whole-canvas snapshots. TraceOverlay's Ctrl+Z explicitly steps aside
//      while drawing mode is on, so the two take turns by mode rather than by
//      order.
//   3. The layer panel keeps nothing at all. Reordering traces, moving them
//      between groups, creating and deleting groups -- none of it is
//      recorded. Ctrl+Z after a layer move therefore undoes whatever trace
//      edit happened before it, which is what makes the whole thing feel like
//      parallel systems: it is not that the wrong stack answered, it is that
//      the action was never on any stack.
//
// An action is an action. This is where they all go, in the order they
// actually happened.
//
// -- Two kinds of reversal, one interface -----------------------------------
//
// The awkward part, and the reason this holds closures rather than a tidy
// union of operation types: the app reverses two different kinds of thing.
//
// Trace edits are deferred (see CLAUDE.md) -- nothing reaches the database
// until saveAllChanges, so undoing one is an in-memory change and nothing
// else. Layer operations write immediately, so undoing one has to issue a
// compensating write and wait for it.
//
// A closure pair covers both without this module needing to know which is
// which. The cost is that entries cannot be inspected or merged automatically;
// callers that want coalescing do it before recording.
//
// -- Ordering and async ------------------------------------------------------
//
// Undo is serialised through a promise chain. Holding Ctrl+Z repeats fast, and
// a layer undo is a round trip: without this, two reversals overlap and the
// second reads state the first has not finished writing.

export interface HistoryEntry {
  // Shown nowhere yet. Kept because the first question asked of a stack like
  // this is always "what am I about to undo", and retrofitting a label onto
  // every call site later is worse than carrying one now.
  label: string
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
}

// Deep enough to cover a working session, bounded so a long one cannot grow
// without limit. Trace history has its own configurable depth and keeps it;
// this is the ceiling for everything that lives here.
const MAX_DEPTH = 200

let past: HistoryEntry[] = []
let future: HistoryEntry[] = []

// Reversals run one at a time, in order.
let chain: Promise<void> = Promise.resolve()

const listeners = new Set<() => void>()

function announce() {
  for (const listener of listeners) listener()
}

// Called after doing something, not instead of doing it.
//
// The caller performs the action itself and then says how to reverse it. That
// way a recorded entry always describes something that actually happened --
// there is no path where the history believes in a change the app never made.
export function record(entry: HistoryEntry) {
  past.push(entry)
  if (past.length > MAX_DEPTH) past.shift()
  // A new action discards the redo branch, as in every editor: once you have
  // done something else, the future you did not take is no longer reachable.
  future = []
  announce()
}

export function canUndo(): boolean {
  return past.length > 0
}

export function canRedo(): boolean {
  return future.length > 0
}

export function undo(): Promise<void> {
  chain = chain.then(async () => {
    const entry = past.pop()
    if (!entry) return
    try {
      await entry.undo()
      future.push(entry)
    } catch (error) {
      // Put it back. An entry whose reversal failed has not been reversed, and
      // dropping it would leave the stack claiming a change was undone while
      // the atrium still shows it.
      past.push(entry)
      console.error('[history] could not undo', entry.label, error)
    }
    announce()
  })
  return chain
}

export function redo(): Promise<void> {
  chain = chain.then(async () => {
    const entry = future.pop()
    if (!entry) return
    try {
      await entry.redo()
      past.push(entry)
    } catch (error) {
      future.push(entry)
      console.error('[history] could not redo', entry.label, error)
    }
    announce()
  })
  return chain
}

// Emptied when the history stops describing anything reachable: leaving an
// atrium, and saving one.
//
// Saving matters because trace edits are deferred -- the stack holds the way
// back to states that were never written, and once a save has happened those
// are gone. TraceOverlay already clears its own stack on save for exactly this
// reason.
export function clearHistory() {
  past = []
  future = []
  announce()
}

export function subscribeToHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
