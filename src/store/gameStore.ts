import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { UserPresence, Trace, Layer } from '../types/database'
import { isDesktop } from '../lib/supabase'
import { recordTraceCreated } from '../lib/supportAppeal'
import type { TraceLink } from '../lib/traceLinks'

export type CursorState = 'default' | 'pointer' | 'grab' | 'grabbing' | 'not-allowed'

// 10 MB lobby size limit (in bytes)
export const LOBBY_SIZE_LIMIT = 10 * 1024 * 1024

// Estimate the byte size of a single trace as stored in the database
export function estimateTraceSize(trace: Trace): number {
  let size = 0
  // Core fields (approximate overhead for UUIDs, timestamps, numbers)
  size += (trace.id?.length || 36) // UUID
  size += (trace.userId?.length || 36)
  size += (trace.username?.length || 10)
  size += (trace.type?.length || 5)
  size += (trace.content?.length || 0)
  size += (trace.createdAt?.length || 24)
  size += 8 * 4 // position_x, position_y, scale, rotation (numbers ~8 bytes each)
  // Media URLs can be large (especially data URLs for drawings)
  size += (trace.mediaUrl?.length || 0)
  size += (trace.imageUrl?.length || 0)
  // Shape points (JSON array)
  if (trace.shapePoints) {
    size += JSON.stringify(trace.shapePoints).length
  }
  // All other optional string/number fields (~200 bytes overhead)
  size += 200
  return size
}

interface GameState {
  username: string
  userId: string
  position: { x: number; y: number }
  playerZIndex: number
  playerColor: string
  showTraceIndicators: boolean
  showTraceTypeLabels: boolean
  hideOwnNameTag: boolean
  hideOtherNameTags: boolean
  hideOtherCursors: boolean
  // Soft fade-out of traces as they approach the viewport edge. Purely a
  // visual preference, so it lives with the other localStorage toggles.
  traceFadeEnabled: boolean
  // Motion, 0-100 each, 0 off; set under Profile, "Animations". How a dragged
  // trace trails and settles, how much the view drifts when left alone, how
  // much traces drift on their own, and how far a thrown one glides on.
  dragBounce: number
  traceFloat: number
  traceMomentum: number
  cursorState: CursorState
  otherUsers: Record<string, UserPresence>  // Changed from Map to Record
  traces: Trace[]
  
  // Pending changes tracking - traces that have been modified but not saved to DB
  pendingChanges: Set<string>  // Set of trace IDs with unsaved changes
  deletedTraces: Set<string>   // Set of trace IDs that should be deleted on save
  isSavingChanges: boolean     // True while a saveAllChanges() call is in flight (prevents concurrent saves)

  // Server-reported lobby size (from Supabase RPC)
  serverLobbySize: number | null  // null = not yet fetched
  serverLobbySizeTraceCount: number // trace count when server size was fetched
  
  setUsername: (username: string) => void
  setUserId: (userId: string) => void
  setPosition: (x: number, y: number) => void
  setPlayerZIndex: (zIndex: number) => void
  setPlayerColor: (color: string) => void
  setShowTraceIndicators: (show: boolean) => void
  setShowTraceTypeLabels: (show: boolean) => void
  setHideOwnNameTag: (hide: boolean) => void
  setHideOtherNameTags: (hide: boolean) => void
  setHideOtherCursors: (hide: boolean) => void
  setTraceFadeEnabled: (enabled: boolean) => void
  setDragBounce: (level: number) => void
  setTraceFloat: (level: number) => void
  setTraceMomentum: (level: number) => void
  setCursorState: (state: CursorState) => void
  updateOtherUser: (userId: string, presence: UserPresence) => void
  updateOtherUserPosition: (userId: string, x: number, y: number) => void
  removeOtherUser: (userId: string) => void
  clearOtherUsers: () => void
  addTrace: (trace: Trace) => void
  removeTrace: (traceId: string) => void
  setTraces: (traces: Trace[]) => void
  clearLobbyData: () => void  // Clear all lobby-specific data
  
  // Pending changes management
  markTraceChanged: (traceId: string) => void
  markTraceDeleted: (traceId: string) => void
  unmarkTraceDeleted: (traceId: string) => void
  clearPendingChanges: () => void
  hasPendingChanges: () => boolean

  // Connections between traces. Kept like traces: edits wait for Save, in
  // pendingLinks (to write) and deletedLinks (to remove); savedLinks says
  // which already exist in the database, since the desktop shim has no
  // upsert -- a new one is inserted, a known one updated.
  links: TraceLink[]
  pendingLinks: Set<string>
  deletedLinks: Set<string>
  savedLinks: Set<string>
  // As loaded from the database: replaces them all, nothing pending.
  setLinks: (links: TraceLink[]) => void
  // A local edit: add or replace, to be written on Save.
  putLink: (link: TraceLink) => void
  // A local removal, to be deleted on Save if it was ever saved.
  dropLink: (id: string) => void
  // From someone else, live: applied unless it's being edited here.
  receiveLink: (link: TraceLink) => void
  forgetLink: (id: string) => void

  // The atrium's groups (the layers table), in no particular order -- sort
  // with inOrder (lib/order). One list for the canvas, which draws by it, and
  // the Layer panel, which edits it; each used to load a copy of its own.
  layers: Layer[]
  setLayers: (layers: Layer[]) => void
  putLayer: (layer: Layer) => void
  forgetLayer: (id: string) => void
  markLinksSaved: (ids: string[]) => void
  setIsSavingChanges: (saving: boolean) => void

  // Size limit
  setServerLobbySize: (size: number, traceCount: number) => void
  getLobbySizeBytes: () => number
  isLobbyFull: () => boolean
}

const clampLevel = (level: number) => Math.max(0, Math.min(100, Math.round(level)))

// A 0-100 setting, clamped and remembered: the state to set.
function keepLevel<K extends 'dragBounce' | 'traceFloat' | 'traceMomentum'>(key: K, level: number) {
  const clamped = clampLevel(level)
  try { localStorage.setItem(key, String(clamped)) } catch { /* kept for this session only */ }
  return { [key]: clamped } as { [P in K]: number }
}

// A 0-100 setting from localStorage, or its default when missing, unreadable
// or out of range.
function readLevel(key: string, fallback: number): number {
  try {
    const parsed = parseInt(localStorage.getItem(key) ?? '', 10)
    return Number.isFinite(parsed) ? clampLevel(parsed) : fallback
  } catch {
    return fallback
  }
}

export const useGameStore = create<GameState>((set, get) => ({
  username: '',
  userId: '',
  position: { x: 400, y: 300 },
  playerZIndex: (() => {
    const stored = localStorage.getItem('playerZIndex')
    return stored ? parseInt(stored, 10) : 1000
  })(),
  playerColor: (() => {
    const stored = localStorage.getItem('playerColor')
    return stored || '#ffffff'
  })(),
  showTraceIndicators: (() => {
    const stored = localStorage.getItem('showTraceIndicators')
    return stored !== null ? stored === 'true' : true
  })(),
  showTraceTypeLabels: (() => {
    const stored = localStorage.getItem('showTraceTypeLabels')
    return stored !== null ? stored === 'true' : false
  })(),
  hideOwnNameTag: (() => {
    const stored = localStorage.getItem('hideOwnNameTag')
    return stored !== null ? stored === 'true' : false
  })(),
  hideOtherNameTags: (() => {
    const stored = localStorage.getItem('hideOtherNameTags')
    return stored !== null ? stored === 'true' : false
  })(),
  hideOtherCursors: (() => {
    const stored = localStorage.getItem('hideOtherCursors')
    return stored !== null ? stored === 'true' : false
  })(),
  traceFadeEnabled: (() => {
    const stored = localStorage.getItem('traceFadeEnabled')
    return stored !== null ? stored === 'true' : true
  })(),
  dragBounce: readLevel('dragBounce', 50),
  traceFloat: readLevel('traceFloat', 0),
  traceMomentum: readLevel('traceMomentum', 0),
  cursorState: 'default',
  otherUsers: {},  // Changed from new Map() to {}
  traces: [],
  
  // Pending changes tracking
  pendingChanges: new Set<string>(),
  deletedTraces: new Set<string>(),
  isSavingChanges: false,

  // Server-reported lobby size
  serverLobbySize: null,
  serverLobbySizeTraceCount: 0,

  setUsername: (username) => set({ username }),
  setUserId: (userId) => set({ userId }),
  setPosition: (x, y) => set({ position: { x, y } }),
  setPlayerZIndex: (zIndex) => {
    localStorage.setItem('playerZIndex', zIndex.toString())
    set({ playerZIndex: zIndex })
  },
  setPlayerColor: (color) => {
    localStorage.setItem('playerColor', color)
    set({ playerColor: color })
  },
  setShowTraceIndicators: (show) => {
    localStorage.setItem('showTraceIndicators', String(show))
    set({ showTraceIndicators: show })
  },
  setShowTraceTypeLabels: (show) => {
    localStorage.setItem('showTraceTypeLabels', String(show))
    set({ showTraceTypeLabels: show })
  },
  setHideOwnNameTag: (hide) => {
    localStorage.setItem('hideOwnNameTag', String(hide))
    set({ hideOwnNameTag: hide })
  },
  setHideOtherNameTags: (hide) => {
    localStorage.setItem('hideOtherNameTags', String(hide))
    set({ hideOtherNameTags: hide })
  },
  setHideOtherCursors: (hide) => {
    localStorage.setItem('hideOtherCursors', String(hide))
    set({ hideOtherCursors: hide })
  },
  setTraceFadeEnabled: (enabled) => {
    localStorage.setItem('traceFadeEnabled', String(enabled))
    set({ traceFadeEnabled: enabled })
  },
  setDragBounce: (level) => set(keepLevel('dragBounce', level)),
  setTraceFloat: (level) => set(keepLevel('traceFloat', level)),
  setTraceMomentum: (level) => set(keepLevel('traceMomentum', level)),
  setCursorState: (cursorState) => set({ cursorState }),
  
  updateOtherUser: (userId, presence) =>
    set((state) => {
      return {
        otherUsers: {
          ...state.otherUsers,
          [userId]: presence
        }
      }
    }),

  // Cheap position-only merge for high-frequency cursor broadcasts -- avoids
  // clobbering username/color/joinedAt that only presence sync carries, and
  // is a no-op if this user isn't tracked yet (presence hasn't arrived).
  updateOtherUserPosition: (userId, x, y) =>
    set((state) => {
      const existing = state.otherUsers[userId]
      if (!existing) return {}
      return {
        otherUsers: {
          ...state.otherUsers,
          [userId]: { ...existing, x, y, timestamp: Date.now() }
        }
      }
    }),

  removeOtherUser: (userId) =>
    set((state) => {
      const { [userId]: removed, ...rest } = state.otherUsers
      return { otherUsers: rest }
    }),
  
  clearOtherUsers: () => set({ otherUsers: {} }),
  
  addTrace: (trace) =>
    set((state) => {
      // Check if trace already exists (for updates)
      const existingIndex = state.traces.findIndex(t => t.id === trace.id)
      
      if (existingIndex >= 0) {
        // Update existing trace
        const newTraces = [...state.traces]
        newTraces[existingIndex] = trace
        return { traces: newTraces }
      } else {
        // Counted here rather than at the dozen places that insert a trace, so
        // no creation path can be missed. Only this user's own, and only on
        // first appearance -- an edit or a realtime echo takes the update
        // branch above and never reaches this line.
        if (trace.userId && trace.userId === state.userId) {
          recordTraceCreated()
        }
        // Add new trace
        return { traces: [...state.traces, trace] }
      }
    }),
  
  removeTrace: (traceId) =>
    set((state) => {
      return { traces: state.traces.filter(t => t.id !== traceId) }
    }),
  
  setTraces: (traces) => {
    set({ traces })
  },
  
  // Clear all lobby-specific data when leaving a lobby
  clearLobbyData: () => {
    set({
      traces: [],
      links: [],
      layers: [],
      pendingLinks: new Set<string>(),
      deletedLinks: new Set<string>(),
      savedLinks: new Set<string>(),
      otherUsers: {},
      pendingChanges: new Set<string>(),
      deletedTraces: new Set<string>(),
      position: { x: 400, y: 300 },  // Reset position
      cursorState: 'default',
      serverLobbySize: null,
      serverLobbySizeTraceCount: 0,
    })
  },
  
  // Pending changes management
  markTraceChanged: (traceId) => 
    set((state) => {
      const newPending = new Set(state.pendingChanges)
      newPending.add(traceId)
      return { pendingChanges: newPending }
    }),
    
  markTraceDeleted: (traceId) =>
    set((state) => {
      const newDeleted = new Set(state.deletedTraces)
      newDeleted.add(traceId)
      // Also remove from pendingChanges since it's being deleted
      const newPending = new Set(state.pendingChanges)
      newPending.delete(traceId)
      return { deletedTraces: newDeleted, pendingChanges: newPending }
    }),

  unmarkTraceDeleted: (traceId) =>
    set((state) => {
      const newDeleted = new Set(state.deletedTraces)
      newDeleted.delete(traceId)
      return { deletedTraces: newDeleted }
    }),

  clearPendingChanges: () =>
    set({
      pendingChanges: new Set<string>(),
      deletedTraces: new Set<string>(),
      pendingLinks: new Set<string>(),
      deletedLinks: new Set<string>(),
    }),

  hasPendingChanges: () => {
    const state = get()
    return state.pendingChanges.size > 0 || state.deletedTraces.size > 0
      || state.pendingLinks.size > 0 || state.deletedLinks.size > 0
  },

  links: [],
  pendingLinks: new Set<string>(),
  deletedLinks: new Set<string>(),
  savedLinks: new Set<string>(),
  setLinks: (links) => set({
    links,
    savedLinks: new Set(links.map(l => l.id)),
    pendingLinks: new Set<string>(),
    deletedLinks: new Set<string>(),
  }),
  putLink: (link) => set((state) => {
    const pendingLinks = new Set(state.pendingLinks).add(link.id)
    const deletedLinks = new Set(state.deletedLinks)
    deletedLinks.delete(link.id)
    return { links: [...state.links.filter(l => l.id !== link.id), link], pendingLinks, deletedLinks }
  }),
  dropLink: (id) => set((state) => {
    const pendingLinks = new Set(state.pendingLinks)
    pendingLinks.delete(id)
    const deletedLinks = new Set(state.deletedLinks)
    if (state.savedLinks.has(id)) deletedLinks.add(id)
    return { links: state.links.filter(l => l.id !== id), pendingLinks, deletedLinks }
  }),
  receiveLink: (link) => set((state) => {
    if (state.pendingLinks.has(link.id) || state.deletedLinks.has(link.id)) return {}
    return {
      links: [...state.links.filter(l => l.id !== link.id), link],
      savedLinks: new Set(state.savedLinks).add(link.id),
    }
  }),
  forgetLink: (id) => set((state) => {
    if (state.pendingLinks.has(id)) return {}
    const savedLinks = new Set(state.savedLinks)
    savedLinks.delete(id)
    return { links: state.links.filter(l => l.id !== id), savedLinks }
  }),
  layers: [],
  setLayers: (layers) => set({ layers }),
  putLayer: (layer) => set((state) => ({ layers: [...state.layers.filter(l => l.id !== layer.id), layer] })),
  forgetLayer: (id) => set((state) => ({ layers: state.layers.filter(l => l.id !== id) })),
  markLinksSaved: (ids) => set((state) => {
    const savedLinks = new Set(state.savedLinks)
    for (const id of ids) savedLinks.add(id)
    return { savedLinks }
  }),

  setIsSavingChanges: (saving) => set({ isSavingChanges: saving }),

  setServerLobbySize: (size, traceCount) => set({ serverLobbySize: size, serverLobbySizeTraceCount: traceCount }),
  
  getLobbySizeBytes: () => {
    const state = get()
    // If we have a server-reported size, use it as baseline and add delta for new traces
    if (state.serverLobbySize !== null) {
      const traceDelta = state.traces.length - state.serverLobbySizeTraceCount
      if (traceDelta > 0) {
        // Estimate size of newly added traces since server fetch
        const avgTraceSize = state.serverLobbySize / Math.max(state.serverLobbySizeTraceCount, 1)
        return state.serverLobbySize + (traceDelta * avgTraceSize)
      }
      // If traces were deleted, reduce proportionally
      if (traceDelta < 0) {
        const avgTraceSize = state.serverLobbySize / Math.max(state.serverLobbySizeTraceCount, 1)
        return Math.max(0, state.serverLobbySize + (traceDelta * avgTraceSize))
      }
      return state.serverLobbySize
    }
    // Fallback to client-side estimation
    return state.traces.reduce((total, trace) => total + estimateTraceSize(trace), 0)
  },
  
  isLobbyFull: () => {
    if (isDesktop) return false
    return get().getLobbySizeBytes() >= LOBBY_SIZE_LIMIT
  },
}))

// Just these fields of the store, re-rendering only when one of them changes.
//
// useGameStore() with no selector takes all of it, and so re-renders on any
// change to any of it -- the cursor's position among them, which changes with
// every movement of the mouse. The app's root took it that way, and the
// atrium, and the trace overlay: every twitch of the mouse drew the whole app
// again, three hundred traces included.
export function useGamePick<K extends keyof GameState>(...keys: K[]): Pick<GameState, K> {
  return useGameStore(useShallow((state: GameState) => {
    const picked = {} as Pick<GameState, K>
    for (const key of keys) picked[key] = state[key]
    return picked
  }))
}
