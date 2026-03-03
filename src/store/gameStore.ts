import { create } from 'zustand'
import type { UserPresence, Trace } from '../types/database'

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
  cursorState: CursorState
  otherUsers: Record<string, UserPresence>  // Changed from Map to Record
  traces: Trace[]
  
  // Pending changes tracking - traces that have been modified but not saved to DB
  pendingChanges: Set<string>  // Set of trace IDs with unsaved changes
  deletedTraces: Set<string>   // Set of trace IDs that should be deleted on save
  
  // Server-reported lobby size (from Supabase RPC)
  serverLobbySize: number | null  // null = not yet fetched
  serverLobbySizeTraceCount: number // trace count when server size was fetched
  
  setUsername: (username: string) => void
  setUserId: (userId: string) => void
  setPosition: (x: number, y: number) => void
  setPlayerZIndex: (zIndex: number) => void
  setPlayerColor: (color: string) => void
  setShowTraceIndicators: (show: boolean) => void
  setCursorState: (state: CursorState) => void
  updateOtherUser: (userId: string, presence: UserPresence) => void
  removeOtherUser: (userId: string) => void
  clearOtherUsers: () => void
  addTrace: (trace: Trace) => void
  removeTrace: (traceId: string) => void
  setTraces: (traces: Trace[]) => void
  clearLobbyData: () => void  // Clear all lobby-specific data
  
  // Pending changes management
  markTraceChanged: (traceId: string) => void
  markTraceDeleted: (traceId: string) => void
  clearPendingChanges: () => void
  hasPendingChanges: () => boolean
  
  // Size limit
  setServerLobbySize: (size: number, traceCount: number) => void
  getLobbySizeBytes: () => number
  isLobbyFull: () => boolean
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
  cursorState: 'default',
  otherUsers: {},  // Changed from new Map() to {}
  traces: [],
  
  // Pending changes tracking
  pendingChanges: new Set<string>(),
  deletedTraces: new Set<string>(),
  
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
    
  clearPendingChanges: () =>
    set({ pendingChanges: new Set<string>(), deletedTraces: new Set<string>() }),
    
  hasPendingChanges: () => {
    const state = get()
    return state.pendingChanges.size > 0 || state.deletedTraces.size > 0
  },
  
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
    return get().getLobbySizeBytes() >= LOBBY_SIZE_LIMIT
  },
}))
