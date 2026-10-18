// Sends a "report a problem / suggest a feature" submission via the
// send-feedback Edge Function, so the reporting user never has to leave
// the page (no mailto: redirect). Web only -- desktop's `supabase` is the
// local SQLite shim (see localDb.ts's localClient), which has no
// `.functions` at all, so this always reports itself unavailable there and
// the caller (LobbyScene) falls back to a mailto: link instead.

import { isDesktop } from './supabase'
import { workerUrl } from './rooms'
import { toWorker } from './worker'
import { t } from './i18n'

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
  return !isDesktop && !!workerUrl()
}

export async function sendFeedbackReport(report: FeedbackReport): Promise<{ success: boolean; error?: string }> {
  if (!canSendFeedbackDirectly()) {
    return { success: false, error: 'Direct sending is not available on this platform.' }
  }

  try {
    // The worker's (workers/rooms, mail): replies go to the sender's own
    // address only where it's known to be theirs.
    const { ok, answer } = await toWorker('/feedback', { ...report, platform: 'Web' })
    if (!ok || answer?.error) {
      return { success: false, error: answer?.error || t('report.sendFailed') }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || t('report.sendFailed') }
  }
}
