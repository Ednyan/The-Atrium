// Account deletion (web only -- desktop has no real account, everything
// lives in a local SQLite file).
//
// Two steps, both server-side. request-deletion-code emails a six-digit code;
// delete-account checks it and then does the FK-aware cleanup described in
// supabase/functions/delete-account/index.ts, and the browser signs out.
//
// Nothing here decides anything. Neither the code nor the account it belongs to
// is checked in this file: the identity comes from the session JWT on the far
// side, and the code is compared against a hash the browser never sees. This is
// transport.

import { supabase } from './supabase'

// A non-2xx arrives as a FunctionsHttpError whose `context` is the raw
// Response, with `data` null -- so on the 401 a wrong code returns, the
// function's own reason is only reachable by reading that body. Without this
// the UI could only ever say "failed".
async function reasonFrom(error: unknown, data: { error?: string } | null): Promise<string | undefined> {
  if (data?.error) return data.error
  const context = (error as { context?: Response })?.context
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.json()
      if (typeof body?.error === 'string') return body.error
    } catch {
      // Not JSON. Leave it undefined and let the caller use its generic line.
    }
  }
  return undefined
}

export interface RequestCodeResult {
  success: boolean
  // 'too_soon' carries retryAfter; the rest are plain failures.
  code?: 'too_soon' | 'email_not_configured' | 'send_failed' | string
  retryAfter?: number
  error?: string
}

export async function requestDeletionCode(): Promise<RequestCodeResult> {
  if (!supabase) return { success: false, error: 'Not connected to the server.' }

  try {
    const { data, error } = await supabase.functions.invoke('request-deletion-code', {})

    if (error || data?.error) {
      const code = await reasonFrom(error, data)
      let retryAfter: number | undefined
      if (typeof data?.retryAfter === 'number') retryAfter = data.retryAfter
      return { success: false, code, retryAfter, error: error?.message || 'Could not send the code.' }
    }

    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Could not send the code.' }
  }
}

// `code` is the function's own machine-readable reason, so the caller can put a
// translated sentence on screen rather than whatever English the transport
// happened to produce. 'invalid_code', 'code_expired' and 'code_required' are
// the three worth telling apart; anything else is a genuine failure and falls
// back to `error`.
export interface DeleteAccountResult {
  success: boolean
  code?: 'invalid_code' | 'code_expired' | 'code_required' | string
  error?: string
}

export async function deleteMyAccount(code: string): Promise<DeleteAccountResult> {
  if (!supabase) return { success: false, error: 'Not connected to the server.' }

  try {
    const { data, error } = await supabase.functions.invoke('delete-account', {
      body: { code },
    })

    if (error || data?.error) {
      return {
        success: false,
        code: await reasonFrom(error, data),
        error: error?.message || 'Failed to delete account.',
      }
    }

    await supabase.auth.signOut()
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to delete account.' }
  }
}
