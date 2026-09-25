// Layer changes, one at a time.
//
// A layer change is several writes in a row -- make a group, then move each
// trace into it; renumber the groups, then every trace inside each -- and
// nothing stopped a second one starting while the first was part-way through.
// Ctrl+G pressed twice made the same group twice and split the traces between
// the two; a second drag during a reorder renumbered from a list the first was
// still rewriting.
//
// Every layer change goes through queueLayerChange and starts only once the one
// before it has finished, failed or not. So each works from the atrium as the
// last one left it -- which holds only if it reads state when it runs
// (useGameStore.getState(), a ref), not what a component captured when clicked.
//
// Never await a queued change from inside another: it waits for the one
// running, which is waiting for it. Compose the unqueued functions instead.

let tail: Promise<unknown> = Promise.resolve()
let unfinished = 0

export function queueLayerChange<T>(change: () => Promise<T>): Promise<T> {
  unfinished++
  const run = tail.then(change, change).finally(() => { unfinished-- })
  tail = run.catch(() => {})
  return run
}

// For gestures that mean "do this once", like Ctrl+G: a second press while a
// change is still under way is dropped rather than queued. Queued, it would
// make a second group and move everything out of the first into it.
export function layerChangeUnderWay(): boolean {
  return unfinished > 0
}
