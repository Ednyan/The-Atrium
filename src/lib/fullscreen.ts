// Fullscreen, one state for the whole app: every button (the atrium's menu,
// the welcome screen, the atrium browser) shows what is, however it was
// entered -- F11, Escape, another page's button. The window's on desktop
// (Tauri has no fullscreen event; a resize always comes with the change, so
// each re-reads it), the document's on the web. F11 toggles it anywhere.

import { useSyncExternalStore } from 'react'
import { isDesktop } from './supabase'

let full = false
const watchers = new Set<() => void>()
const set = (now: boolean) => {
  if (now === full) return
  full = now
  watchers.forEach(watch => watch())
}

let watching = false
function watch() {
  if (watching) return
  watching = true
  if (isDesktop) {
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow()
      set(await win.isFullscreen())
      await win.onResized(async () => set(await win.isFullscreen()))
    }).catch(() => { /* left as it was rather than guessed */ })
  } else {
    const read = () => set(!!document.fullscreenElement)
    read()
    document.addEventListener('fullscreenchange', read)
  }
  window.addEventListener('keydown', event => {
    if (event.key !== 'F11') return
    event.preventDefault()
    void toggleFullscreen()
  })
}

export async function toggleFullscreen(): Promise<void> {
  if (isDesktop) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const now = !(await win.isFullscreen())
    await win.setFullscreen(now)
    set(now)
  } else if (document.fullscreenElement) await document.exitFullscreen()
  else await document.documentElement.requestFullscreen()
}

/** Whether the app is fullscreen now, kept up to date. */
export function useFullscreen(): boolean {
  return useSyncExternalStore(changed => {
    watch()
    watchers.add(changed)
    return () => { watchers.delete(changed) }
  }, () => full)
}
