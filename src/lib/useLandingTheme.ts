// Light or dark, for the page that faces outward.
//
// Only the landing page gets a choice. The atrium itself is a dark room by
// design -- it is a surface you place things on, and bright chrome around
// somebody's images competes with them.
//
// Dark is the default, and it is a decision rather than a fallback. This used
// to follow prefers-color-scheme, which meant the first thing half the world
// saw was the pale version of a place built to be dark -- the portal, the
// silver title and the whole NieR temperature of it read as a compromise
// there. Light is still one press away and stays chosen once it is, but
// nobody arrives in it by accident.
//
// Two states, therefore, not three. A "follow the machine" option only makes
// sense when the machine is what decides the default; once dark is the answer
// regardless, an Auto that silently means light on half of all laptops is a
// third state that contradicts the first.
//
// Where the choice is kept differs by platform, deliberately:
//
//   Web      sessionStorage -- the choice holds for the tab and the visit, and
//            the next visit opens dark again. Somebody who tried light once
//            should not have the site quietly remember that forever.
//   Desktop  localStorage -- an installed app that forgets a setting between
//            launches is broken, not opinionated.

import { useEffect, useState } from 'react'
import { isDesktop } from './supabase'

export type ResolvedTheme = 'light' | 'dark'

const KEY = 'atrium_landing_theme'

// Desktop remembers across launches; the web remembers only for this visit.
function store(): Storage | null {
  try {
    return isDesktop ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function readStored(): ResolvedTheme | null {
  try {
    const value = store()?.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

/** The theme in force, for code that needs it once rather than continuously. */
export function resolveThemeNow(): ResolvedTheme {
  return current ?? readStored() ?? 'dark'
}

// Every hook instance reads the same value and hears about every change.
//
// Without this each one kept its own copy: the switch on the welcome screen
// would update the switch on the welcome screen, and the effect at the root of
// the app that actually applies the theme would never hear about it. A control
// that changes nothing outside itself is worse than no control.
const listeners = new Set<() => void>()
let current: ResolvedTheme | null = null

function setStored(next: ResolvedTheme) {
  current = next
  try {
    store()?.setItem(KEY, next)
  } catch {
    // Private browsing, or storage refused. The choice holds for this page and
    // is forgotten, which is a smaller loss than refusing to switch at all.
  }
  listeners.forEach(listener => listener())
}

// The same value, changed in another tab.
//
// The privacy and terms pages are static HTML that open in a tab of their own
// and carry the same switch, writing this same key. Without this the app tab
// behind them kept whatever it had read at startup, so a choice made over
// there only arrived on the next reload -- which looks like a switch that does
// not work.
//
// The storage event fires for localStorage across tabs; sessionStorage is
// per-tab and so never fires one, which is correct -- a web visitor's choice
// is not meant to travel between tabs in the first place.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return
    current = event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : 'dark'
    listeners.forEach(listener => listener())
  })
}

export function useLandingTheme() {
  const [resolved, setResolvedState] = useState<ResolvedTheme>(() => resolveThemeNow())

  // Subscribed rather than owned: the value lives in the module, and this is
  // one of possibly several components watching it.
  useEffect(() => {
    const listener = () => setResolvedState(resolveThemeNow())
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  const setTheme = (next: ResolvedTheme) => setStored(next)
  const cycle = () => setTheme(resolved === 'dark' ? 'light' : 'dark')

  return { resolved, setTheme, cycle }
}
