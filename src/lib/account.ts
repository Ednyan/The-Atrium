// Account deletion (web only -- desktop has no real account, everything
// lives in a local SQLite file). Calls the delete-account Edge Function,
// which does the FK-aware cleanup described in
// supabase/functions/delete-account/index.ts, then signs the browser out.

import { supabase } from './supabase'

// `code` is the function's own machine-readable reason, so the caller can put
// a translated sentence on screen rather than whatever English the transport
// happened to produce. 'invalid_password' and 'password_required' are the two
// worth telling apart; anything else is a genuine failure and falls back to
// `error`.
export interface DeleteAccountResult {
  success: boolean
  code?: 'invalid_password' | 'password_required' | string
  error?: string
}

// The password is verified by the Edge Function, not here -- see the comment
// in supabase/functions/delete-account/index.ts. It is passed through
// untouched; accounts created through Google have none, and the function
// decides that from its own copy of the user rather than from this argument.
export async function deleteMyAccount(password: string): Promise<DeleteAccountResult> {
  if (!supabase) return { success: false, error: 'Not connected to the server.' }

  try {
    const { data, error } = await supabase.functions.invoke('delete-account', {
      body: { password },
    })

    if (error || data?.error) {
      // A non-2xx arrives as a FunctionsHttpError whose `context` is the raw
      // Response, and `data` is null -- so on the 401 that a wrong password
      // returns, the function's own code is only reachable by reading that
      // body. Without this the UI could only ever say "failed".
      let code: string | undefined = data?.error
      if (!code) {
        const context = (error as { context?: Response })?.context
        if (context && typeof context.json === 'function') {
          try {
            const body = await context.json()
            if (typeof body?.error === 'string') code = body.error
          } catch {
            // Not JSON. Leave code undefined and use the generic message.
          }
        }
      }
      return { success: false, code, error: error?.message || 'Failed to delete account.' }
    }

    await supabase.auth.signOut()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete account.' }
  }
}
