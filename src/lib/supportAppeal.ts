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

// Notices that the app is running a different version than last time.
//
// This replaces asking UpdateChecker to remember, which never worked: that
// call sat after downloadAndInstall, and on Windows the installer replaces the
// running process, so the line after it is not reliably reached. The app was
// gone before it could write anything down.
//
// Comparing versions at startup needs nothing to survive an install. Whatever
// happened -- the in-app updater, an installer run by hand, a reinstall -- the
// binary that comes up is either the one that was here before or it is not,
// and it can see which for itself.
//
// The stored version is per install, in local storage, like everything else
// here. A first run records the version and asks nothing: there is no update
// to thank anyone for, and greeting a new arrival with an appeal is exactly
// what the rest of this file exists to avoid.
const VERSION_KEY = 'atrium_last_version_v1'

export function noteVersionSeen(version: string) {
  if (!version) return
  let previous: string | null = null
  try {
    previous = localStorage.getItem(VERSION_KEY)
    localStorage.setItem(VERSION_KEY, version)
  } catch {
    return
  }
  if (!previous || previous === version) return

  // Set regardless of the silence a donation buys.
  //
  // Deliberate, and asked for: on desktop there is no account, so what this
  // file knows about somebody's contributions is only what happened on this
  // machine -- a donation made from the web, or from another computer, is
  // invisible here. Suppressing the ask on that basis would be acting on an
  // answer nobody gave. A version arriving is the one moment worth asking on
  // regardless, and it happens rarely enough to be fair.
  write({ ...read(), remindNextLaunch: true, silentUntil: 0 })
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
