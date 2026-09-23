// Where the app is, and how to move it -- the one place that knows whether
// that lives in the path or the hash.
//
// The web uses real paths: digitalatrium.org/welcome, not /#/welcome. Cloudflare
// already answers every path with index.html (public/_redirects), so any of
// them can be loaded or reloaded directly, and built assets are referenced
// absolutely (/assets/...), so a deep path like /atrium/<id> finds them.
//
// The desktop app keeps the hash. It has no address bar, so nobody sees the
// difference, and reloading a path there would depend on Tauri serving
// index.html for every route -- a risk with nothing to gain.

import { isDesktop } from './supabase'

// pushState fires nothing, so moves made here announce themselves with this;
// popstate covers Back and Forward.
const ROUTE_EVENT = 'atrium:routechange'

/** The current route, e.g. "/", "/welcome", "/atrium/<id>". */
export function currentRoutePath(): string {
  if (isDesktop) return window.location.hash.slice(1) || '/'
  const path = window.location.pathname
  if (path === '' || path === '/' || path === '/index.html') return '/'
  // "/welcome/" is "/welcome": a trailing slash is a typing habit, not a page.
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/** Move to a route. Records history, so Back returns. */
export function goTo(path: string) {
  if (isDesktop) {
    window.location.hash = path
    return
  }
  // Same place: no history entry, so Back does not appear to do nothing.
  if (path !== currentRoutePath()) {
    window.history.pushState(null, '', path)
  }
  window.dispatchEvent(new Event(ROUTE_EVENT))
}

/** Call `listener` whenever the route changes, however it changed. */
export function onRouteChange(listener: () => void): () => void {
  if (isDesktop) {
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }
  // An old "#/..." link opened while already on the site only changes the
  // fragment -- no reload, so the rewrite at boot never sees it. Caught here,
  // rewritten, then treated like any other move.
  const onHash = () => {
    adoptLegacyHashRoute()
    listener()
  }
  window.addEventListener('popstate', listener)
  window.addEventListener(ROUTE_EVENT, listener)
  window.addEventListener('hashchange', onHash)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(ROUTE_EVENT, listener)
    window.removeEventListener('hashchange', onHash)
  }
}

/**
 * Rewrite an old "/#/welcome" address to "/welcome", in place.
 *
 * Every link made before the switch still says #/: bookmarks, links in emails
 * already sent, a Stripe checkout somebody is partway through, and desktop
 * apps that have not updated yet. replaceState, so the old form never becomes a
 * history entry to go Back to.
 *
 * Only "#/..." is touched. Supabase can hand back a session in the hash
 * ("#access_token=..."), and that must be left exactly where it is.
 */
export function adoptLegacyHashRoute() {
  if (isDesktop) return
  const hash = window.location.hash
  if (!hash.startsWith('#/')) return
  const target = hash.slice(1)
  window.history.replaceState(null, '', target.includes('?') ? target : target + window.location.search)
}
