// Transient in-app confirmations, in the app's own visual language rather
// than the browser's alert() -- which on desktop renders as a native Windows
// dialog that has to be dismissed, and on web blocks the page.
//
// A CustomEvent rather than context or props: the callers (the in-atrium HUD
// and the atrium browser) live in different trees with no common ancestor
// below App, and this matches the pattern already used for settings changes
// (lobby-zoom-sensitivity-changed and friends).

export const TOAST_EVENT = 'atrium-toast'

export function showToast(message: string) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: message }))
}
