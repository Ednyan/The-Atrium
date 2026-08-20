// Two settings that were kept per atrium and should never have been.
//
// Undo depth and the shape a batch is arranged in are habits, not properties
// of a room: somebody who wants forty steps of undo wants them everywhere, and
// nobody sets a placement shape per atrium on purpose. They were stored under
// lobby_<id>_..., so every new atrium silently reset them to the defaults.
//
// The old keys are still read when the new one is absent, so whatever was set
// in the atrium somebody is standing in carries over the first time rather
// than being thrown away.

const UNDO_KEY = 'atrium_undo_depth'
const SHAPE_KEY = 'atrium_packing_shape'

export const DEFAULT_UNDO_DEPTH = 25
export const MAX_UNDO_DEPTH = 100
export type PackingShape = 'square' | 'circle'

function read(key: string, legacy: string | null): string | null {
  try {
    const value = localStorage.getItem(key)
    if (value !== null) return value
    return legacy ? localStorage.getItem(legacy) : null
  } catch {
    return null
  }
}

export function readUndoDepth(lobbyId?: string): number {
  const raw = read(UNDO_KEY, lobbyId ? `lobby_${lobbyId}_undoDepth` : null)
  const parsed = raw === null ? NaN : parseInt(raw, 10)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_UNDO_DEPTH, parsed)) : DEFAULT_UNDO_DEPTH
}

export function writeUndoDepth(depth: number) {
  try {
    localStorage.setItem(UNDO_KEY, String(depth))
  } catch {
    // A setting that cannot be remembered still applies for this session.
  }
}

export function readPackingShape(lobbyId?: string): PackingShape {
  const raw = read(SHAPE_KEY, lobbyId ? `lobby_${lobbyId}_packingShape` : null)
  return raw === 'circle' ? 'circle' : 'square'
}

export function writePackingShape(shape: PackingShape) {
  try {
    localStorage.setItem(SHAPE_KEY, shape)
  } catch {
    // Same.
  }
}
