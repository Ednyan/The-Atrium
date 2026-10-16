import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Supabase credentials check (silent - logs only cause memory issues)

// Check for Tauri runtime (safe to call before any Tauri imports)
export const isDesktop = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// Every write the web app makes goes through this fetch, and each one that
// succeeds is told to whoever listens: lib/liveChanges, which tells the
// atrium's room, so others see it without a Supabase realtime connection.
// Set later, by that module, so this one imports nothing of it.
type WriteListener = (url: string, method: string, body: unknown) => void
let onWrite: WriteListener | null = null
export const listenToWrites = (listener: WriteListener) => { onWrite = listener }
const noticingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  const method = (init?.method ?? 'GET').toUpperCase()
  if (onWrite && response.ok && method !== 'GET' && method !== 'HEAD') {
    try { onWrite(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, method, init?.body) } catch { /* never the write's problem */ }
  }
  return response
}

// Mutable client reference. In web mode, set immediately.
// In desktop mode, set after localDb init (before React renders).
let _client: any = null

if (!isDesktop) {
  _client = supabaseUrl && supabaseAnonKey
    ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
        global: { fetch: noticingFetch },
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

// The cloud's client, whatever the data client is now. What's the account's
// rather than an atrium's -- Edge Functions, Pinterest, the account's own
// calls -- goes here: inside a browser atrium, `supabase` is its engine,
// which has none of them.
export const cloudClient: any = _client
// This atrium's data lives on this device -- the desktop app's vault, or this
// browser's (lib/browserAtriums) -- not in the cloud: local files and sizes,
// no cloud limits, and the local engine's gaps (CLAUDE.md). Always so on
// desktop; on the web, while inside an atrium kept in the browser.
export let isLocalData = isDesktop
// Local, but shared: a Drive atrium (lib/driveSync), which has a room (lib/rooms)
// for who's there and their saves as they're made.
export let isSharedLocal = false
/** The data client from here on: a browser atrium's engine, or (null) the
 *  cloud's again. lib/browserAtriums decides when -- never under a write. */
export function switchDataClient(client: unknown | null, shared = false) {
  if (isDesktop) return
  supabase = client ?? cloudClient
  isLocalData = client !== null
  isSharedLocal = client !== null && shared
}

// Initialize local DB when running in Tauri  
export const localDbReady: Promise<void> = isDesktop
  ? import('./localDb').then(async (mod) => {
      await mod.initLocalDb()
      supabase = mod.localClient
    })
  : Promise.resolve()

export const REALTIME_CHANNEL = 'lobby-presence'
