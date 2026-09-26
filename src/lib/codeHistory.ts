// The code history (public/code-history), opened from the landing page without
// leaving it.
//
// Going there as another document, the slide was a cross-document view
// transition: Firefox has none, and Chrome held the landing page frozen while
// the new one loaded, then jumped. So the page is loaded ahead instead -- when
// the band is hovered or focused -- into a hidden frame over this one, where it
// waits to be shown (see "embedded" in scripts/graph-growth.html). Opening it
// is then a view transition within this document, which Firefox has too:
// nothing loads during the slide, and Back slides home to the landing page as
// it was left, scrolled where it was, instead of loading the app again.
//
// The address says /code-history/ while it shows, so a reload -- or a link to
// it -- gets the page on its own, and that is also where this falls back to if
// the frame never answers. The desktop app keeps the plain link: its policy
// lets nothing frame its pages.

import { isDesktop } from './supabase'

const PATH = '/code-history/'
// How long an opening waits for the page before going to it the plain way.
const READY_TIMEOUT_MS = 4000

let frame: HTMLIFrameElement | null = null
let ready: Promise<boolean> = Promise.resolve(false)
let markReady = () => {}
// Whether the address says it should show, and whether it does.
let wanted = false
let shown = false
let landingTitle = ''

/** Load the page ahead, unseen, so opening it is immediate. */
export function preloadCodeHistory() {
  if (isDesktop || frame) return
  frame = document.createElement('iframe')
  frame.src = PATH
  frame.title = 'Code history'
  frame.className = 'code-history-frame'
  frame.inert = true
  ready = new Promise(resolve => { markReady = () => resolve(true) })
  document.body.append(frame)
}

/** Open it, for a click on a link to it. False where the link should just be followed. */
export function openCodeHistory(): boolean {
  if (isDesktop) return false
  if (!wanted) {
    history.pushState(null, '', PATH)
    void sync()
  }
  return true
}

/** Follow Back and Forward, and the page's own Back, while the landing page is up. Returns the teardown. */
export function watchCodeHistory(): () => void {
  if (isDesktop) return () => {}
  addEventListener('popstate', sync)
  addEventListener('message', onMessage)
  return () => {
    removeEventListener('popstate', sync)
    removeEventListener('message', onMessage)
    if (shown) setShown(false)
    wanted = false
    removeFrame()
  }
}

function onMessage(e: MessageEvent) {
  if (!frame || e.source !== frame.contentWindow) return
  if (e.data === 'code-history:ready') markReady()
  if (e.data === 'code-history:back') history.back()
}

async function sync() {
  const want = location.pathname.startsWith('/code-history')
  if (want === wanted) return
  wanted = want
  if (want) {
    preloadCodeHistory()
    const answered = await Promise.race([ready, new Promise<false>(r => setTimeout(r, READY_TIMEOUT_MS, false))])
    // Back, while it loaded.
    if (!wanted || shown) return
    if (!answered) {
      location.reload()
      return
    }
    await slide('forward', () => setShown(true))
    // Started once in place: its first frames draw the whole graph, work that
    // would otherwise land mid-slide. Until then it is its still first frame.
    if (shown) frame?.contentWindow?.postMessage('code-history:show', location.origin)
  } else if (shown) {
    // Gone as the slide starts -- a snapshot of it is what slides -- so it
    // draws nothing under the slide, and the next visit starts it over, as a
    // visit would.
    await slide('back', () => { setShown(false); removeFrame() })
  }
}

function setShown(on: boolean) {
  if (!frame) return
  shown = on
  const landing = document.getElementById('root')
  landing?.toggleAttribute('inert', on)
  // Hidden too, so nothing on it spends frames under the code history.
  if (landing) landing.style.visibility = on ? 'hidden' : ''
  frame.inert = !on
  frame.classList.toggle('is-open', on)
  if (on) {
    landingTitle = document.title
    document.title = frame.contentDocument?.title || landingTitle
    frame.focus()
  } else {
    document.title = landingTitle
  }
}

function removeFrame() {
  frame?.remove()
  frame = null
}

// The two pages side by side, sliding one way or the other (index.css). The
// snapshots are what move, so the landing page's fixed parts go with it, and
// the motion is the compositor's alone.
function slide(direction: 'forward' | 'back', update: () => void): Promise<void> {
  if (!document.startViewTransition) {
    update()
    return Promise.resolve()
  }
  const root = document.documentElement
  root.dataset.slide = direction
  return document.startViewTransition(update).finished.finally(() => { delete root.dataset.slide })
}
