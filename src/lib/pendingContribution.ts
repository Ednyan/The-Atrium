// Waiting for a donation to come back.
//
// Checkout opens outside the app -- it has to on desktop, where there is no
// browser chrome to return through, and it opens in a second tab on web. Either
// way the window someone started from is left knowing nothing, and Stripe's
// success_url lands somewhere else entirely. Without this, a desktop donor pays
// and the app they paid for never acknowledges it.
//
// So the session id is written down before the browser opens, and polled until
// Stripe says it completed. Two consequences worth stating:
//
//   - It is kept in local storage, not in memory, so closing the app in the
//     middle of paying doesn't lose the thanks. It is picked up on next launch.
//   - Completion is recorded but not consumed here. The app decides *when* the
//     thanks is safe to show -- never over an open atrium, which would navigate
//     away from unsaved traces -- and clears the record at that point.

import { fetchContributionStatus } from './donate'

const KEY = 'atrium_pending_contribution_v1'
const STARTED_EVENT = 'atrium:contribution-started'

// Long enough for a slow bank app or a payment finished on a phone, short
// enough that a session abandoned at lunch isn't still being polled at dinner.
const GIVE_UP_MS = 45 * 60 * 1000

// Quick while they are likely still at the payment page, then slow. Nearly
// every donation resolves inside the first minute; the long tail is someone who
// wandered off, and polling them every four seconds for three quarters of an
// hour would be rude to both Stripe and the battery.
const EAGER_UNTIL_MS = 2 * 60 * 1000
const EAGER_INTERVAL_MS = 4000
const PATIENT_INTERVAL_MS = 15000

interface Pending {
  sessionId: string
  // The name they asked to be listed under, kept so the thanks can use it.
  // It exists nowhere else the client can reach -- it travels to Stripe as
  // session metadata and comes back only in the webhook.
  displayName: string
  startedAt: number
  // Set when Stripe confirmed. Kept until the app has actually shown the
  // thanks, so it can wait for the right moment without losing it.
  completed: boolean
}

function read(): Pending | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.sessionId !== 'string' || !parsed.sessionId) return null
    return {
      sessionId: parsed.sessionId,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
      completed: parsed.completed === true,
    }
  } catch {
    return null
  }
}

function write(pending: Pending | null) {
  try {
    if (pending) localStorage.setItem(KEY, JSON.stringify(pending))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage disabled or full. The donation still happened and Stripe still
    // emailed a receipt; only the in-app thanks is lost.
  }
}

// Called the moment checkout is handed to the browser, before anything can go
// wrong with the window it was opened from.
export function rememberPendingContribution(sessionId: string, displayName = '') {
  if (!sessionId) return
  write({ sessionId, displayName, startedAt: Date.now(), completed: false })
  // The watcher lives at the top of the app and the panel that starts a
  // donation is four components away from it. An event is the shortest honest
  // line between them, and means the watcher can sleep until this fires
  // instead of polling storage forever on the chance that it might.
  window.dispatchEvent(new Event(STARTED_EVENT))
}

// True if a confirmed donation is waiting to be acknowledged. Does not clear
// it -- asking is not showing.
export function hasCompletedContribution(): boolean {
  return read()?.completed === true
}

// Claims the thanks: returns true once, and never again for the same donation.
// Called at the point the app is actually about to show it.
// Returns the name they chose, or an empty string for an anonymous gift --
// and null when there is nothing to claim. Distinguishing "no name" from "no
// donation" is the whole reason this returns what it does rather than a
// boolean.
export function takeCompletedContribution(): { displayName: string } | null {
  const pending = read()
  if (!pending?.completed) return null
  write(null)
  return { displayName: pending.displayName }
}

// Polls until there is an answer, then calls back. Returns a teardown.
//
// The loop only runs while something is pending: it starts on the event above,
// stops when the question is answered, and does nothing at all the rest of the
// time. It also checks whenever the window regains focus, which on desktop is
// exactly the moment someone finishes paying and clicks back onto the app --
// the thanks should be there when they arrive, not fifteen seconds later.
export function watchPendingContribution(onCompleted: () => void): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let checking = false

  const check = async () => {
    if (stopped || checking) return

    const pending = read()
    // Nothing to wait for, or already answered and waiting to be shown. Either
    // way there is no question left for Stripe, and no loop worth running.
    if (!pending || pending.completed) return

    if (Date.now() - pending.startedAt > GIVE_UP_MS) {
      write(null)
      return
    }

    checking = true
    const status = await fetchContributionStatus(pending.sessionId)
    checking = false
    if (stopped) return

    if (status === 'complete') {
      // Re-read: a second donation may have replaced the record while this
      // request was in flight.
      const current = read()
      if (current?.sessionId === pending.sessionId) {
        write({ ...current, completed: true })
        onCompleted()
      }
      return
    }

    // 'expired' is a final no. 'open' and 'unknown' both mean ask again --
    // unknown because a failed request says nothing about the payment.
    if (status === 'expired') {
      write(null)
      return
    }

    if (timer) clearTimeout(timer)
    const elapsed = Date.now() - pending.startedAt
    timer = setTimeout(check, elapsed < EAGER_UNTIL_MS ? EAGER_INTERVAL_MS : PATIENT_INTERVAL_MS)
  }

  const existing = read()
  if (existing?.completed) {
    // Confirmed on an earlier run and never shown -- the app was closed before
    // it could be. Hand it over as soon as anyone is listening.
    onCompleted()
  } else if (existing) {
    void check()
  }

  window.addEventListener(STARTED_EVENT, check)
  window.addEventListener('focus', check)
  window.addEventListener('online', check)

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    window.removeEventListener(STARTED_EVENT, check)
    window.removeEventListener('focus', check)
    window.removeEventListener('online', check)
  }
}
