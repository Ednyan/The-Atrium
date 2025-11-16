import { create } from 'zustand'
import type { UserPresence, Trace } from '../types/database'

interface GameState {
  username: string
  userId: string
  position: { x: number; y: number }
  playerZIndex: number
  otherUsers: Record<string, UserPresence>  // Changed from Map to Record
  traces: Trace[]
  
  setUsername: (username: string) => void
  setUserId: (userId: string) => void
  setPosition: (x: number, y: number) => void
  setPlayerZIndex: (zIndex: number) => void
  updateOtherUser: (userId: string, presence: UserPresence) => void
  removeOtherUser: (userId: string) => void
  addTrace: (trace: Trace) => void
  removeTrace: (traceId: string) => void
  setTraces: (traces: Trace[]) => void
}

export const useGameStore = create<GameState>((set) => ({
  username: '',
  userId: '',
  position: { x: 400, y: 300 },
  playerZIndex: (() => {
    const stored = localStorage.getItem('playerZIndex')
    return stored ? parseInt(stored, 10) : 1000
  })(),
  otherUsers: {},  // Changed from new Map() to {}
  traces: [],

  setUsername: (username) => set({ username }),
  setUserId: (userId) => set({ userId }),
  setPosition: (x, y) => set({ position: { x, y } }),
  setPlayerZIndex: (zIndex) => {
    localStorage.setItem('playerZIndex', zIndex.toString())
    set({ playerZIndex: zIndex })
  },
  
  updateOtherUser: (userId, presence) =>
    set((state) => {
      console.log('🔄 Store: Updated other user', userId, presence)
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
      console.log('❌ Store: Removed other user', userId)
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
        console.log('🔄 Store: Updated trace', trace.id)
        return { traces: newTraces }
      } else {
        // Add new trace
        console.log('✨ Store: Added new trace', trace.id)
        return { traces: [...state.traces, trace] }
      }
    }),
  
  removeTrace: (traceId) =>
    set((state) => {
      console.log('🗑️ Store: Removing trace', traceId)
      return { traces: state.traces.filter(t => t.id !== traceId) }
    }),
  
  setTraces: (traces) => {
    console.log('📦 Store: Set traces', traces.length, 'total')
    set({ traces })
  },
}))
