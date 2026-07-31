import { isDesktop } from './supabase'

// Opens a link outside the app.
//
// On desktop a plain anchor or window.open navigates the webview itself,
// replacing the atrium with the linked page and leaving no way back -- there
// is no browser chrome. The shell plugin hands the URL to the system browser
// instead. Imported dynamically so the web build never pulls in a Tauri
// module it can't use.
//
// Only http(s) is followed. A trace's link is arbitrary user input that other
// people in a shared atrium will click, and schemes like file: or javascript:
// have no business being opened on their machine.
export function openExternalUrl(url: string | undefined | null) {
  if (!url) return

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return

  if (isDesktop) {
    import('@tauri-apps/plugin-shell')
      .then(({ open }) => open(parsed.href))
      .catch(() => { /* plugin unavailable -- better to do nothing than navigate away */ })
    return
  }

  // noopener so the opened page can't reach back through window.opener.
  window.open(parsed.href, '_blank', 'noopener,noreferrer')
}
