// Whether the app is in front: its window focused and not minimised, as well
// as each platform can say. A browser says so by the page's visibility and
// focus. The desktop app's WebView2 says neither -- minimised or behind
// another app, the page stays "visible" and focused -- so there the window's
// own state is watched (Tauri). Watched once, from the first that asks.

import { isDesktop } from './supabase'

export interface Front { focused: boolean; minimised: boolean }

let front: Front = { focused: true, minimised: false }
const listeners = new Set<(front: Front) => void>()
let watching = false

function watch() {
  if (watching) return
  watching = true
  const tell = (next: Front) => {
    front = next
    listeners.forEach(listener => listener(front))
  }
  if (!isDesktop) {
    const read = () => tell({ focused: document.visibilityState === 'visible' && document.hasFocus(), minimised: document.visibilityState !== 'visible' })
    window.addEventListener('focus', read)
    window.addEventListener('blur', read)
    document.addEventListener('visibilitychange', read)
    read()
    return
  }
  void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow()
    const read = async (focused?: boolean) => tell({
      focused: focused ?? await win.isFocused().catch(() => true),
      minimised: await win.isMinimized().catch(() => false),
    })
    await win.onFocusChanged(({ payload }) => void read(payload))
    await win.onResized(() => void read())
    // As it is now: opened behind another app, it was never focused, and no change says so.
    void read()
    // A change of focus can go unheard -- after long behind other windows,
    // the app came back slowed (BACKGROUND_FPS) and stayed so, quickening
    // only while moved about, until the atrium was opened again. So while
    // it believes itself behind, any use of it asks again, and so does a
    // look every few seconds.
    let askedAt = 0
    const ask = () => {
      if (front.focused && !front.minimised) return
      const now = performance.now()
      if (now - askedAt < 500) return
      askedAt = now
      void read()
    }
    for (const event of ['focus', 'pointerdown', 'keydown', 'wheel', 'pointermove'] as const) {
      window.addEventListener(event, ask, { capture: true, passive: true })
    }
    window.setInterval(ask, 2000)
  })
}

/** In front now: focused, not minimised. */
export function inFront(): boolean {
  watch()
  return front.focused && !front.minimised
}

/** `listener` told now and at every change; the returned function stops it. */
export function onFront(listener: (front: Front) => void): () => void {
  watch()
  listeners.add(listener)
  listener(front)
  return () => { listeners.delete(listener) }
}
