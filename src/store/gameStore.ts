import { create } from 'zustand'
import type { UserPresence, Trace } from '../types/database'

export type CursorState = 'default' | 'pointer' | 'grab' | 'grabbing' | 'not-allowed'

interface GameState {
  username: string
  userId: string
  position: { x: number; y: number }
  playerZIndex: number
  playerColor: string
  cursorState: CursorState
  otherUsers: Record<string, UserPresence>  // Changed from Map to Record
  traces: Trace[]
  
  // Pending changes tracking - traces that have been modified but not saved to DB
  pendingChanges: Set<string>  // Set of trace IDs with unsaved changes
  deletedTraces: Set<string>   // Set of trace IDs that should be deleted on save
  
  setUsername: (username: string) => void
  setUserId: (userId: string) => void
  setPosition: (x: number, y: number) => void
  setPlayerZIndex: (zIndex: number) => void
  setPlayerColor: (color: string) => void
  setCursorState: (state: CursorState) => void
  updateOtherUser: (userId: string, presence: UserPresence) => void
  removeOtherUser: (userId: string) => void
  addTrace: (trace: Trace) => void
  removeTrace: (traceId: string) => void
  setTraces: (traces: Trace[]) => void
  
  // Pending changes management
  markTraceChanged: (traceId: string) => void
  markTraceDeleted: (traceId: string) => void
  clearPendingChanges: () => void
  hasPendingChanges: () => boolean
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
  cursorState: 'default',
  otherUsers: {},  // Changed from new Map() to {}
  traces: [],
  
  // Pending changes tracking
  pendingChanges: new Set<string>(),
  deletedTraces: new Set<string>(),

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
}))
