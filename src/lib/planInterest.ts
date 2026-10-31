// "Would you buy this plan?" (landing/PricingChapter): one answer per account, or
// per browser for a guest, changeable, and counted in Developers > Health
// (workers/rooms, interest.ts). Nothing but the answer and a random id for a
// guest goes anywhere.

import { toWorker } from './worker'

export type PlanAnswer = 'yes' | 'no'

const ANSWER_KEY = 'atrium.plan.interest'
const GUEST_KEY = 'atrium.plan.interest.guest'

export function myPlanAnswer(): PlanAnswer | null {
  try {
    const kept = localStorage.getItem(ANSWER_KEY)
    return kept === 'yes' || kept === 'no' ? kept : null
  } catch { return null }
}

function guestId(): string {
  try {
    const kept = localStorage.getItem(GUEST_KEY)
    if (kept) return kept
    const fresh = crypto.randomUUID()
    localStorage.setItem(GUEST_KEY, fresh)
    return fresh
  } catch { return crypto.randomUUID() }
}

/** Sent, then kept here. Throws if it couldn't be. */
export async function sendPlanAnswer(answer: PlanAnswer): Promise<void> {
  const { ok } = await toWorker('/interest', { answer, guest: guestId() })
  if (!ok) throw new Error('not sent')
  try { localStorage.setItem(ANSWER_KEY, answer) } catch { /* for this visit, then */ }
}
