// Account deletion (web only -- desktop has no real account, everything
// lives in a local SQLite file). Calls the delete-account Edge Function,
// which does the FK-aware cleanup described in
// supabase/functions/delete-account/index.ts, then signs the browser out.

import { supabase } from './supabase'

export async function deleteMyAccount(): Promise<{ success: boolean; error?: string }> {
  if (!supabase) return { success: false, error: 'Not connected to the server.' }

  try {
    const { data, error } = await supabase.functions.invoke('delete-account', {})
    if (error || data?.error) {
      return { success: false, error: data?.error || error?.message || 'Failed to delete account.' }
    }
    await supabase.auth.signOut()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete account.' }
  }
}
