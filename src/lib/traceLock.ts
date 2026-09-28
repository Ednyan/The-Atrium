// Whether a trace is locked: kept where it is, not moved, sized or turned.
//
// "Ignore clicks" -- a trace the pointer went straight through, for
// backgrounds -- is gone as an option; locking does that job, and a locked
// trace can still be selected to unlock it (its lock button). A trace set to
// ignore clicks before counts as locked, so it stays where it was put rather
// than coming loose, and unlocking clears both.
import type { Trace } from '../types/database'

export const isLockedTrace = (trace: Pick<Trace, 'isLocked' | 'ignoreClicks'>) => !!(trace.isLocked || trace.ignoreClicks)

// What unlocking writes.
export const UNLOCKED: Partial<Trace> = { isLocked: false, ignoreClicks: false }
