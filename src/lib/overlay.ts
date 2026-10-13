// The desktop app's window as an overlay, as PureRef has it (OverlayPanel,
// in the view bar): always on top, click-through -- clicks pass to whatever
// is behind it -- and seen through at an opacity (Windows, for now). Applied
// by one native command (set_overlay, src-tauri). Not on the web.
//
// Click-through leaves the window deaf to the mouse, so there are ways back
// that don't need it: Ctrl+T in the app (PureRef's key -- the app has to be
// switched to first, as in PureRef), switching back to the app at all
// (Alt+Tab, the taskbar), and EXIT_SHORTCUT, from anywhere. That one is
// registered with the system only while click-through is on, so it never
// takes keys from other programs otherwise.
//
// On top and the opacity are remembered; click-through never is -- a window
// that can't be clicked, opened, would be a trap.

import { useSyncExternalStore } from 'react'
import { isDesktop } from './supabase'
import { showToast } from './toast'
import { t } from './i18n'

export interface Overlay { onTop: boolean; clickThrough: boolean; opacity: number }
export const EXIT_SHORTCUT = 'CommandOrControl+Alt+Shift+X'
export const MIN_OPACITY = 0.1
// Native opacity is Windows' alone so far (set_window_opacity).
export const opacityHere = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)

const KEY = 'atrium.overlay'
function load(): Overlay {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || '{}')
    const opacity = Number(kept.opacity)
    return { onTop: kept.onTop === true, clickThrough: false, opacity: opacity >= MIN_OPACITY && opacity <= 1 ? opacity : 1 }
  } catch {
    return { onTop: false, clickThrough: false, opacity: 1 }
  }
}

let state = load()
const watchers = new Set<() => void>()
const subscribe = (watch: () => void) => { watchers.add(watch); return () => { watchers.delete(watch) } }
export const useOverlay = () => useSyncExternalStore(subscribe, () => state, () => state)
export const overlayNow = () => state

let exitHeld = false
let started = false

/** The window as asked: applied, remembered, and its way back from
 *  click-through held only while it's on. */
export async function setOverlay(change: Partial<Overlay>) {
  if (!isDesktop) return
  const was = state
  state = { ...state, ...change }
  watchers.forEach(watch => watch())
  try { localStorage.setItem(KEY, JSON.stringify({ onTop: state.onTop, opacity: state.opacity })) } catch { /* this visit only */ }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_overlay', { onTop: state.onTop, clickThrough: state.clickThrough, opacity: opacityHere ? state.opacity : 1 })
    .catch(error => console.warn('[overlay]', error))
  if (state.clickThrough !== was.clickThrough) {
    await holdExit(state.clickThrough)
    showToast(state.clickThrough ? t('atrium.overlay.clickThroughOn') : t('atrium.overlay.clickThroughOff'))
  }
}

async function holdExit(hold: boolean) {
  if (hold === exitHeld) return
  try {
    const shortcuts = await import('@tauri-apps/plugin-global-shortcut')
    if (hold) await shortcuts.register(EXIT_SHORTCUT, event => { if (event.state === 'Pressed') void setOverlay({ clickThrough: false }) })
    else await shortcuts.unregister(EXIT_SHORTCUT)
    exitHeld = hold
  } catch (error) {
    // Taken by another program: the app and switching back still work.
    console.warn('[overlay] the shortcut', EXIT_SHORTCUT, error)
  }
}

/** Once, as the desktop app starts on an atrium: on top and the opacity as
 *  they were left, and switching back to the app ends click-through. */
export function startOverlay() {
  if (!isDesktop || started) return
  started = true
  if (state.onTop || state.opacity < 1) void setOverlay({})
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && state.clickThrough) void setOverlay({ clickThrough: false })
    }),
  )
}
