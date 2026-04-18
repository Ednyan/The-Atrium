import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Supabase credentials check (silent - logs only cause memory issues)

// Check for Tauri runtime (safe to call before any Tauri imports)
export const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// Mutable client reference. In web mode, set immediately.
// In desktop mode, set after localDb init (before React renders).
let _client: any = null

if (!isDesktop) {
  _client = supabaseUrl && supabaseAnonKey
    ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
        realtime: {
          params: {
            eventsPerSecond: 10,
          },
        },
      })
    : null
}

// ESM live binding: `export let` means importers see the latest value
export let supabase: any = _client

// Initialize local DB when running in Tauri  
export const localDbReady: Promise<void> = isDesktop
  ? import('./localDb').then(async (mod) => {
      await mod.initLocalDb()
      supabase = mod.localClient
    })
  : Promise.resolve()

export const REALTIME_CHANNEL = 'lobby-presence'
