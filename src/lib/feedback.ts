// Sends a "report a problem / suggest a feature" submission via the
// send-feedback Edge Function, so the reporting user never has to leave
// the page (no mailto: redirect). Web only -- desktop's `supabase` is the
// local SQLite shim (see localDb.ts's localClient), which has no
// `.functions` at all, so this always reports itself unavailable there and
// the caller (LobbyScene) falls back to a mailto: link instead.

import { supabase, isDesktop } from './supabase'

export interface FeedbackReport {
  motive: 'bug' | 'feature' | 'other'
  // User-written subject line, appended after the motive label -- e.g.
  // "Bug Report - Traces disappear on zoom". Optional; the Edge Function
  // falls back to just the motive label if left blank.
  subject?: string
  description: string
  username?: string
  atriumName?: string
}

export function canSendFeedbackDirectly(): boolean {
  return !isDesktop && !!supabase && typeof supabase.functions?.invoke === 'function'
}

export async function sendFeedbackReport(report: FeedbackReport): Promise<{ success: boolean; error?: string }> {
  if (!canSendFeedbackDirectly()) {
    return { success: false, error: 'Direct sending is not available on this platform.' }
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-feedback', {
      body: { ...report, platform: isDesktop ? 'Desktop' : 'Web' },
    })
    if (error || data?.error) {
      return { success: false, error: data?.error || error?.message || 'Failed to send report.' }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to send report.' }
  }
}
