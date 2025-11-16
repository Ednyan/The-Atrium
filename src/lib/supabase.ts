import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Supabase credentials not found. Using mock mode.')
  console.warn('Make sure you have a .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY')
} else {
  console.log('✅ Supabase client initializing...')
  console.log('📡 URL:', supabaseUrl)
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null

export const REALTIME_CHANNEL = 'lobby-presence'

if (supabase) {
  console.log('✅ Supabase client created successfully')
}
