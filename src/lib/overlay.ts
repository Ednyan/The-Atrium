// The desktop app's window as an overlay, as PureRef has it (OverlayPanel,
// in the view bar): always on top, click-through -- clicks pass to whatever
// is behind it, the menus' own kept for them if asked -- the menus hidden,
// and seen through: the atrium's background gone, so only its traces float
// over the desktop, and the canvas faded to an opacity. On top and
// click-through are the window's (set_overlay, src-tauri); the rest is the
// page's, while it's in an atrium (LobbyScene), the window letting the
// desktop show wherever the page is clear (Windows, for now). Not on the web.
//
// Overlay mode is any of it but on top. Coming back to the app -- Alt+Tab,
// the taskbar, anything but a click inside it -- ends click-through and
// brings the menus back (PureRef's way back is the same switch, then Ctrl+T).
// And from anywhere, while it's on: the taskbar preview's button and
// EXIT_SHORTCUT, held only then so it never takes keys from other programs
// otherwise -- both end it whole, the window seen and clickable again.
//
// Remembered: on top, the opacity, the background, the menus kept clickable.
// Never click-through or hidden menus -- a window that opens unreachable
// would be a trap.

import { useSyncExternalStore } from 'react'
import { isDesktop } from './supabase'
import { showToast } from './toast'
import { t } from './i18n'
import { isCanvasTarget } from './editableTarget'

export interface Overlay {
  onTop: boolean
  clickThrough: boolean
  // Through click-through, the menus still take the pointer.
  menusClickable: boolean
  hideMenus: boolean
  // 0 to 1: the canvas's.
  opacity: number
  clearBackground: boolean
}
export const EXIT_SHORTCUT = 'CommandOrControl+Alt+Shift+X'
// Seeing through, and menus kept clickable, are Windows' alone so far.
export const seeThroughHere = typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent)

const OFF: Overlay = { onTop: false, clickThrough: false, menusClickable: true, hideMenus: false, opacity: 1, clearBackground: false }
const KEY = 'atrium.overlay'
function load(): Overlay {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || '{}')
    const opacity = Number(kept.opacity)
    return {
      ...OFF,
      onTop: kept.onTop === true,
      menusClickable: kept.menusClickable !== false,
      opacity: opacity >= 0 && opacity <= 1 ? opacity : 1,
      clearBackground: kept.clearBackground === true,
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
export const inOverlayMode = (overlay: Overlay) => overlay.clickThrough || overlay.hideMenus || seeingThrough(overlay)

let exitHeld = false
let started = false

/** The window as asked: applied, remembered, and its way out held only while
 *  it's in overlay mode. */
export async function setOverlay(change: Partial<Overlay>) {
  if (!isDesktop) return
  const was = state
  state = { ...state, ...change }
  watchers.forEach(watch => watch())
  try {
    localStorage.setItem(KEY, JSON.stringify({ onTop: state.onTop, menusClickable: state.menusClickable, opacity: state.opacity, clearBackground: state.clearBackground }))
  } catch { /* this visit only */ }
  // Stopped before the window is set, so its last word is set_overlay's.
  keepMenus(false)
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_overlay', { onTop: state.onTop, clickThrough: state.clickThrough, seeThrough: seeingThrough(state), exitLabel: t('atrium.overlay.exit') })
    .catch(error => console.warn('[overlay]', error))
  keepMenus(state.clickThrough && state.menusClickable && seeThroughHere)
  await holdExit(inOverlayMode(state))
  if (state.clickThrough !== was.clickThrough) showToast(state.clickThrough ? t('atrium.overlay.clickThroughOn') : t('atrium.overlay.clickThroughOff'))
  else if (state.hideMenus && !was.hideMenus) showToast(t('atrium.overlay.menusHidden'))
}

/** Out of overlay mode: clickable, opaque, its menus and background back.
 *  On top stays. */
export async function exitOverlay() {
  if (!inOverlayMode(state)) return
  await setOverlay({ clickThrough: false, hideMenus: false, opacity: 1, clearBackground: false })
  showToast(t('atrium.overlay.exited'))
}

// The menus kept clickable through click-through: the window can't hear the
// pointer then, so where it is is asked of it, and the window takes the
// pointer while it's over the interface (isCanvasTarget, as a press on the
// canvas tells), and lets it through anywhere else.
const MASK_EVERY_MS = 40
let maskRun = 0
function keepMenus(on: boolean) {
  const run = ++maskRun
  if (!on) return
  let passing = true
  const look = async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    while (run === maskRun) {
      const at = await invoke<[number, number] | null>('overlay_pointer').catch(() => null)
      // Off the page -- the title bar, the frame -- the window keeps the
      // pointer too, so it can still be moved and closed.
      const under = at && document.elementFromPoint(at[0], at[1])
      const pass = !at || (!!under && isCanvasTarget(under))
      if (run !== maskRun) return
      if (pass !== passing) {
        passing = pass
        await invoke('set_click_through', { on: pass }).catch(() => {})
      }
      await new Promise(resolve => window.setTimeout(resolve, MASK_EVERY_MS))
    }
  }
  void look()
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

/** Once, as the desktop app starts: the window as it was left; coming back
 *  to the app ends click-through and hidden menus (src-tauri tells a click
 *  inside it from a switch back), and the taskbar's button overlay mode. */
export function startOverlay() {
  if (!isDesktop || started) return
  started = true
  if (state.onTop || inOverlayMode(state)) void setOverlay({})
  void import('@tauri-apps/api/event').then(({ listen }) => {
    void listen<boolean>('atrium-focus', ({ payload: byClick }) => {
      if (!byClick && (state.clickThrough || state.hideMenus)) void setOverlay({ clickThrough: false, hideMenus: false })
    })
    void listen('atrium-exit-overlay', () => void exitOverlay())
  })
}
