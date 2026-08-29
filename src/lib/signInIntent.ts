// Whether the session that just appeared is one the person deliberately
// started, a moment ago, on purpose.
//
// The app cannot tell that from the auth events alone, and it matters, because
// signing in and refreshing look almost identical by the time anything here
// runs. A Google sign-in leaves the site entirely and comes back to "/" with a
// session; so does opening the landing page in the morning. One should end at
// the welcome screen and the other should be left exactly where it is.
//
// Guessing from the events was tried and is written up in App.tsx: SIGNED_IN
// also fires when a tab regains focus and when a stale token refreshes, so
// somebody reading the front page got thrown to /welcome mid-scroll. The
// reliable signal is intent, recorded before the sign-in leaves, read after it
// comes back.
//
// localStorage rather than sessionStorage on purpose. Confirming an account by
// email opens the link in whatever tab the mail client feels like, which is
// usually not the one that registered -- sessionStorage would be empty there,
// which is exactly the case this exists for.

const KEY = 'atrium_sign_in_started'

// Long enough to read a confirmation email and come back; short enough that a
// flag left behind by an abandoned sign-in has expired before it could send
// somebody somewhere they did not ask to go.
const MAX_AGE_MS = 60 * 60 * 1000

export function markSignInStarted(): void {
  try {
    localStorage.setItem(KEY, String(Date.now()))
  } catch {
    // Private mode, or storage disabled. The redirect is a convenience; losing
    // it is not worth failing a sign-in over.
  }
}

// Answers once. Clearing before checking the age means a stale flag is disposed
// of by the first thing that looks at it, rather than sitting there for an hour
// waiting to be asked again.
export function consumeSignInIntent(): boolean {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    localStorage.removeItem(KEY)
    const startedAt = Number(raw)
    return Number.isFinite(startedAt) && Date.now() - startedAt < MAX_AGE_MS
  } catch {
    return false
  }
}
