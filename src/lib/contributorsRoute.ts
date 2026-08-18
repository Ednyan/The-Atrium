// Where "back" goes from the contributors page.
//
// The page is reachable from the landing page, the welcome screen and the
// atrium browser, and returning to a screen the visitor was never on reads as
// being thrown somewhere rather than going back. The hash carries no history of
// its own here, so the origin is remembered when leaving.
//
// Session storage rather than local: it describes this visit, and a return
// destination remembered from last week would be worse than the default.

const RETURN_KEY = 'atrium_contributors_return'
const DEFAULT_RETURN = '/welcome'

export function openContributors(from: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, from)
  } catch {
    // Private browsing, or storage disabled. The default is still sensible.
  }
  window.location.hash = '/contributors'
}

export function contributorsReturnPath(): string {
  try {
    return sessionStorage.getItem(RETURN_KEY) || DEFAULT_RETURN
  } catch {
    return DEFAULT_RETURN
  }
}
