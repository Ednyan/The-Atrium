// When to ask for support, and when to leave someone alone.
//
// Stored per install, in local storage, so the web and desktop apps keep
// entirely separate counters and neither can nag on the other's behalf.
//
// The whole design here is about asking rarely. An appeal that appears before
// someone has anything invested reads as a toll booth; one that reappears after
// being declined reads as nagging. So it asks only after real use, only at
// launch, and every answer buys a meaningful silence.

const STORAGE_KEY = 'atrium_support_appeal_v1'

const REQUIRED_TRACES = 20
const REQUIRED_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000
const SILENCE_AFTER_DONATION_MS = 90 * DAY_MS

// Stripe is live and the checkout function is deployed, so the appeal has
// somewhere to send people. Left as a single switch: if contributions ever need
// turning off, this is the one line, and every other path already treats an
// absent endpoint as "say nothing" rather than as an error.
export const DONATIONS_ENABLED = true

interface AppealState {
  firstUseAt: number
  tracesCreated: number
  // Silence until this timestamp. Set after a donation.
  silentUntil: number
  // "Remind me later" -- show again on the next launch, regardless of counters,
  // since they were already met when it was asked.
  remindNextLaunch: boolean
}

const FRESH: AppealState = {
  firstUseAt: 0,
  tracesCreated: 0,
  silentUntil: 0,
  remindNextLaunch: false,
}

function read(): AppealState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...FRESH }
    const parsed = JSON.parse(raw)
    return {
      firstUseAt: Number(parsed.firstUseAt) || 0,
      tracesCreated: Number(parsed.tracesCreated) || 0,
      silentUntil: Number(parsed.silentUntil) || 0,
      remindNextLaunch: !!parsed.remindNextLaunch,
    }
  } catch {
    return { ...FRESH }
  }
}

function write(state: AppealState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Local storage full or disabled: the appeal simply never fires, which is
    // the right way for this particular feature to fail.
  }
}

// Called once when the app starts, so "14 days since first use" has a start.
export function noteAppStarted() {
  const state = read()
  if (state.firstUseAt === 0) {
    write({ ...state, firstUseAt: Date.now() })
  }
}

// Hooked into the store rather than the dozen places that insert a trace, so
// no creation path can be forgotten. Counts only traces this user made, and
// only the first time each appears -- an edit or a realtime echo updates an
// existing trace rather than adding one, and doesn't reach here.
export function recordTraceCreated() {
  const state = read()
  write({ ...state, tracesCreated: state.tracesCreated + 1 })
}

// An update has just been installed, so ask on the way back in.
//
// Called from UpdateChecker immediately before the relaunch, which makes the
// next launch the one that follows new work landing -- the moment somebody has
// just been given something is a fair moment to ask, and it is the only moment
// in this file that is not about counting.
//
// Reuses remindNextLaunch rather than adding a second flag, because it already
// means precisely this: show on the next launch, whatever the counters say.
// Note where shouldShowAppeal tests it -- after silentUntil, never before. A
// recent donor is not asked again because a new version shipped; they already
// answered, and shipping is not a reason to re-open the question.
export function noteUpdateInstalled() {
  const state = read()
  write({ ...state, remindNextLaunch: true })
}

// Evaluated once per launch. Returning to the welcome screen after leaving an
// atrium is not a new launch, and the appeal must never appear over the canvas.
let evaluatedThisSession = false

export function shouldShowAppeal(): boolean {
  if (!DONATIONS_ENABLED) return false
  if (evaluatedThisSession) return false
  evaluatedThisSession = true

  const state = read()
  const now = Date.now()

  if (now < state.silentUntil) return false
  if (state.remindNextLaunch) return true

  const longEnough = state.firstUseAt > 0 && now - state.firstUseAt >= REQUIRED_DAYS * DAY_MS
  return longEnough && state.tracesCreated >= REQUIRED_TRACES
}

export type AppealResponse = 'donated' | 'not_now' | 'remind_later'

export function recordAppealResponse(response: AppealResponse) {
  const state = read()

  switch (response) {
    case 'donated':
      write({ ...state, silentUntil: Date.now() + SILENCE_AFTER_DONATION_MS, remindNextLaunch: false })
      break

    // Both counters restart, so it takes another fortnight and another twenty
    // traces before the question comes back. "No" should mean no for a while.
    case 'not_now':
      write({ ...state, firstUseAt: Date.now(), tracesCreated: 0, remindNextLaunch: false })
      break

    case 'remind_later':
      write({ ...state, remindNextLaunch: true })
      break
  }
}
