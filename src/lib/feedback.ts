// A "report a problem / suggest a feature" submission, to the worker, which
// keeps it in the database (workers/rooms, feedback.ts) -- the reporting user
// never leaves the page, on the web or on desktop. If the worker can't be
// reached, the form falls back to a mailto: link (ReportFeedbackModal). The
// operator reads them in Developers (FeedbackTool).

import { isDesktop } from './supabase'
import { workerUrl } from './rooms'
import { toWorker } from './worker'
import { t } from './i18n'

export interface FeedbackReport {
  motive: 'bug' | 'feature' | 'other'
  // User-written subject line, appended after the motive label -- e.g.
  // "Bug Report - Traces disappear on zoom". Optional.
  subject?: string
  description: string
  username?: string
  atriumName?: string
}

export function canSendFeedbackDirectly(): boolean {
  return !!workerUrl()
}

export async function sendFeedbackReport(report: FeedbackReport): Promise<{ success: boolean; error?: string }> {
  if (!canSendFeedbackDirectly()) {
    return { success: false, error: 'Direct sending is not available on this platform.' }
  }

  try {
    const { ok, answer } = await toWorker('/feedback', { ...report, platform: isDesktop ? 'Desktop' : 'Web' })
    if (!ok || answer?.error) {
      return { success: false, error: answer?.error || t('report.sendFailed') }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message || t('report.sendFailed') }
  }
}

// The operator's.
export interface FeedbackEntry {
  id: string
  at: number
  motive: FeedbackReport['motive']
  subject: string | null
  description: string
  username: string | null
  atrium: string | null
  platform: string | null
  reply_to: string | null
  handled: number
}

async function ask<T>(what: 'list' | 'handled' | 'delete', body: object = {}): Promise<T> {
  const { ok, answer } = await toWorker<T & { error?: string }>(`/feedback/${what}`, body)
  if (!ok) throw new Error(answer?.error || t('report.sendFailed'))
  return answer as T
}

export const listFeedback = () => ask<FeedbackEntry[]>('list')
export const setFeedbackHandled = (id: string, handled: boolean) => ask('handled', { id, handled })
export const deleteFeedback = (id: string) => ask('delete', { id })
