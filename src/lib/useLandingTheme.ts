// Light or dark, for the page that faces outward.
//
// Only the landing page gets a choice. The atrium itself is a dark room by
// design -- it is a surface you place things on, and bright chrome around
// somebody's images competes with them. A website is the opposite situation:
// it is mostly text, most of the web is light, and arriving at a black page
// reads as a statement whether or not one was intended.
//
// Three states rather than two. "System" is the default and is not the same as
// having picked the mode the system currently happens to be in: someone whose
// machine turns dark at sunset should turn with it, and that only works if the
// absence of a choice is itself recorded.

import { useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const KEY = 'atrium_landing_theme'
const QUERY = '(prefers-color-scheme: dark)'

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function systemTheme(): ResolvedTheme {
  try {
    return window.matchMedia(QUERY).matches ? 'dark' : 'light'
  } catch {
    // Nothing to ask. Dark is the app's own temperature, so it is the safer
    // guess for anyone arriving from inside it.
    return 'dark'
  }
}

// The same answer, for code that needs it once rather than continuously --
// an event handler deciding what a new atrium should look like, for instance.
export function resolveThemeNow(): ResolvedTheme {
  const preference = current ?? readPreference()
  return preference === 'system' ? systemTheme() : preference
}

// Every hook instance reads the same value and hears about every change.
//
// Without this each one kept its own copy: the switch on the welcome screen
// would update the switch on the welcome screen, and the effect at the root of
// the app that actually applies the theme would never hear about it. A control
// that changes nothing outside itself is worse than no control.
const listeners = new Set<() => void>()
let current: ThemePreference | null = null

function setStored(next: ThemePreference) {
  current = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Private browsing. The choice holds for this visit and is forgotten,
    // which is a smaller loss than refusing to switch at all.
  }
  listeners.forEach(listener => listener())
}

export function useLandingTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => current ?? readPreference())
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)

  // Followed live, not read once. Someone whose machine switches at sunset
  // should see the page switch with it rather than on their next visit.
  useEffect(() => {
    let media: MediaQueryList
    try {
      media = window.matchMedia(QUERY)
    } catch {
      return
    }
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme = preference === 'system' ? system : preference

  // Subscribed rather than owned: the value lives in the module, and this is
  // one of possibly several components watching it.
  useEffect(() => {
    const listener = () => setPreferenceState(current ?? readPreference())
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  const setPreference = (next: ThemePreference) => setStored(next)

  // Cycles the way a three-state control should read: whatever you are looking
  // at now, its opposite, then back to following the machine.
  const cycle = () => setPreference(preference === 'system' ? (system === 'dark' ? 'light' : 'dark') : 'system')

  return { preference, resolved, setPreference, cycle }
}
