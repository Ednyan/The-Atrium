// The desktop app's window as an overlay, as PureRef has it (OverlayPanel,
// in the view bar): always on top, click-through -- clicks pass to whatever
// is behind it -- and seen through: the atrium's background gone, so only
// its traces float over the desktop, and faded to an opacity, the menus with
// it or not. On top and click-through are the window's (set_overlay,
// src-tauri); what's seen through is the page's, while it's in an atrium
// (LobbyScene), the window letting the desktop show wherever the page is
// clear (Windows, for now). Not on the web.
//
// Overlay mode is any of it but on top. Its way out, from anywhere, while
// it's on: the taskbar preview's button and EXIT_SHORTCUT, held only then so
// it never takes keys from other programs otherwise -- both end it whole,
// the window seen and clickable again. Click-through has nearer ones: Ctrl+T
// in the app (PureRef's key), or switching back to the app at all.
//
// Everything but click-through is remembered -- a window that can't be
// clicked, opened, would be a trap.

import { useSyncExternalStore } from 'react'
import { isDesktop } from './supabase'
import { showToast } from './toast'
import { t } from './i18n'

export interface Overlay {
  onTop: boolean
  clickThrough: boolean
  // 0 to 1: the canvas's, or with `menusToo` the menus' as well.
  opacity: number
  clearBackground: boolean
  menusToo: boolean
}
export const EXIT_SHORTCUT = 'CommandOrControl+Alt+Shift+X'
// Seeing through is Windows' alone so far (set_overlay).
export const seeThroughHere = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)

const OFF: Overlay = { onTop: false, clickThrough: false, opacity: 1, clearBackground: false, menusToo: false }
const KEY = 'atrium.overlay'
function load(): Overlay {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || '{}')
    const opacity = Number(kept.opacity)
    return {
      ...OFF,
      onTop: kept.onTop === true,
      opacity: opacity >= 0 && opacity <= 1 ? opacity : 1,
      clearBackground: kept.clearBackground === true,
      menusToo: kept.menusToo === true,
    }
  } catch {
    return OFF
  }
}

let state = load()
const watchers = new Set<() => void>()
const subscribe = (watch: () => void) => { watchers.add(watch); return () => { watchers.delete(watch) } }
export const useOverlay = () => useSyncExternalStore(subscribe, () => state, () => state)
export const overlayNow = () => state
/** The desktop behind shows through the page. */
export const seeingThrough = (overlay: Overlay) => seeThroughHere && (overlay.opacity < 1 || overlay.clearBackground)
/** Overlay mode: anything that makes the window harder to see or reach. */
export const inOverlayMode = (overlay: Overlay) => overlay.clickThrough || seeingThrough(overlay)

let exitHeld = false
let started = false

/** The window as asked: applied, remembered, and its way out held only while
 *  it's in overlay mode. */
export async function setOverlay(change: Partial<Overlay>) {
  if (!isDesktop) return
  const was = state
  state = { ...state, ...change }
  watchers.forEach(watch => watch())
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, clickThrough: undefined })) } catch { /* this visit only */ }
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_overlay', { onTop: state.onTop, clickThrough: state.clickThrough, seeThrough: seeingThrough(state), exitLabel: t('atrium.overlay.exit') })
    .catch(error => console.warn('[overlay]', error))
  await holdExit(inOverlayMode(state))
  if (state.clickThrough !== was.clickThrough) showToast(state.clickThrough ? t('atrium.overlay.clickThroughOn') : t('atrium.overlay.clickThroughOff'))
}

/** Out of overlay mode: clickable, opaque, its background back. On top stays. */
export async function exitOverlay() {
  if (!inOverlayMode(state)) return
  await setOverlay({ clickThrough: false, opacity: 1, clearBackground: false })
  showToast(t('atrium.overlay.exited'))
}

async function holdExit(hold: boolean) {
  if (hold === exitHeld) return
  exitHeld = hold
  try {
    const shortcuts = await import('@tauri-apps/plugin-global-shortcut')
    // Let go of first, either way: a page reloaded while holding it leaves
    // it registered to the page that's gone, and taking it again would fail.
    await shortcuts.unregister(EXIT_SHORTCUT).catch(() => {})
    if (hold) await shortcuts.register(EXIT_SHORTCUT, event => { if (event.state === 'Pressed') void exitOverlay() })
  } catch (error) {
    // Taken by another program: the taskbar's button and the app still work.
    console.warn('[overlay] the shortcut', EXIT_SHORTCUT, error)
  }
}

/** Once, as the desktop app starts: the window as it was left; switching
 *  back to the app ends click-through, and the taskbar's button overlay mode. */
export function startOverlay() {
  if (!isDesktop || started) return
  started = true
  if (state.onTop || inOverlayMode(state)) void setOverlay({})
  void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && state.clickThrough) void setOverlay({ clickThrough: false })
    }),
  )
  void import('@tauri-apps/api/event').then(({ listen }) => listen('atrium-exit-overlay', () => void exitOverlay()))
}
