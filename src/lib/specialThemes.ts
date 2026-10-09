// Special themes: the developer's themes -- Spooky for Halloween -- each
// either all year or with a window of the year (month and day, every year)
// in which it's shown with the presets and a new atrium starts in it; and
// any can be hidden from everyone until it's ready. A row can also be the
// developer's version of one of the three built-in presets (`preset`): its
// look, or its being hidden, in place of the one in the code. Made, changed
// and removed in Developers > Special themes, by the platform operator alone
// (add_special_themes.sql, special_themes_hidden.sql).
//
// Kept in the web database for both apps: read there by anyone, the desktop
// too, which asks it over plain REST (its own database is the vault). A copy
// is kept on the device, so the presets and a new atrium's theme don't wait
// on the network, and still know the last ones seen offline.

import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import type { ThemeSettings } from '../types/database'
import type { ThemeMode } from './customThemes'
import { isMonthDay, seasonalTheme, shownOn } from './season'

export const BUILT_IN = ['sepia', 'abyss', 'markerboard'] as const
export type BuiltIn = typeof BUILT_IN[number]

export interface SpecialTheme {
  id: string
  name: string
  mode: ThemeMode
  values: ThemeSettings
  // 'MM-DD'; both null for all year.
  startsOn: string | null
  endsOn: string | null
  hidden: boolean
  preset?: BuiltIn
}

// What someone picks it as: a built-in preset, or a special theme.
export const refOf = (t: SpecialTheme) => (t.preset ? `preset:${t.preset}` : `special:${t.id}`) as `preset:${string}` | `special:${string}`

// ---- The list ---------------------------------------------------------------------

const COPY_KEY = 'atrium.specialThemes'
const FIELDS = 'id,name,mode,theme_settings,starts_on,ends_on,hidden,preset'

function asSpecialThemes(rows: unknown): SpecialTheme[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((r: any) => {
    const window = isMonthDay(r?.starts_on) && isMonthDay(r?.ends_on) ? [r.starts_on, r.ends_on] : r?.starts_on == null && r?.ends_on == null ? [null, null] : null
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string' || !window || !r.theme_settings || typeof r.theme_settings !== 'object') return []
    return [{
      id: r.id, name: r.name, mode: r.mode === 'light' ? 'light' : 'dark', values: r.theme_settings,
      startsOn: window[0], endsOn: window[1], hidden: r.hidden === true,
      ...(BUILT_IN.includes(r.preset) ? { preset: r.preset } : {}),
    } as SpecialTheme]
  })
}
const asRow = (t: SpecialTheme) => ({
  id: t.id, name: t.name, mode: t.mode, theme_settings: t.values, starts_on: t.startsOn, ends_on: t.endsOn, hidden: t.hidden, preset: t.preset ?? null,
})

let themes: SpecialTheme[] = (() => { try { return asSpecialThemes(JSON.parse(localStorage.getItem(COPY_KEY) || '[]').map(asRow)) } catch { return [] } })()
const watchers = new Set<() => void>()
const publish = (next: SpecialTheme[]) => {
  themes = next
  try { localStorage.setItem(COPY_KEY, JSON.stringify(next)) } catch { /* for this visit only */ }
  watchers.forEach(fn => fn())
}
// Asked again every hour for as long as the app is open (the desktop app
// stays open for days), from the first time anything shows them.
let hourly = 0
const watch = (fn: () => void) => {
  watchers.add(fn)
  void loadSpecialThemes()
  hourly ||= window.setInterval(() => { void loadSpecialThemes(true) }, REFRESH_MS)
  return () => { watchers.delete(fn) }
}
// The saved ones, all of them: the Developers list, and what the presets list
// is made from (shownSpecialThemes).
export const useSpecialThemes = () => useSyncExternalStore(watch, () => themes)
// Those people see today: not built-in presets' rows, not hidden, all year or
// in their window. Today's, so one whose window has closed is gone.
export const shownSpecialThemes = (list: SpecialTheme[], date = new Date()) => shownOn(list.filter(t => !t.preset), date)
// With the developer's draft, if any, standing in for the saved one -- shown
// to them however it's set, as they look around in it.
const withDraft = (list: SpecialTheme[]) => {
  const d = specialThemeDraft()?.theme
  return d ? [...list.filter(t => t.id !== d.id && (!d.preset || t.preset !== d.preset)), d] : list
}
// What a special: ref can name now.
export const specialThemesNow = () => withDraft(shownSpecialThemes(themes))
// The developer's version of a built-in preset, if there is one (hidden or not).
export const presetRowNow = (preset: string) => withDraft(themes).find(t => t.preset === preset) ?? null

// The theme being made in Developers > Special themes, kept for this session
// while it has changes not saved: an atrium entered to look around in it shows
// it (specialThemesNow), and the tool has it back on return. On this device
// alone, and never saved by itself -- nor does it start a new atrium.
//
// It keeps the saved theme it was made from (`base`), and stands only while
// that is still the saved one: once the theme has been saved, changed
// elsewhere (the SQL editor, another device) or removed, the draft is stale
// and the saved theme shows. (It used to stand for the whole session, so a
// theme changed in the database kept showing as it had been.)
const DRAFT_KEY = 'atrium.specialThemes.draft'
export function specialThemeDraft(): { theme: SpecialTheme; isNew: boolean } | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
    const [theme] = asSpecialThemes(stored ? [asRow(stored.theme)] : [])
    if (!theme) return null
    if (!stored.isNew && JSON.stringify(themes.find(t => t.id === theme.id) ?? null) !== JSON.stringify(stored.base ?? null)) return null
    return { theme, isNew: !!stored.isNew }
  } catch {
    return null
  }
}
export function setSpecialThemeDraft(draft: { theme: SpecialTheme; isNew: boolean; base: SpecialTheme | null } | null) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch { /* not kept: the tool starts empty next time */ }
}

// Asked when first needed (and again after a change here); what's kept
// stands until it answers, and if it can't.
//
// And again once it's an hour old (`again`: the hourly timer), so a theme made
// or changed meanwhile -- a new occasion, Spooky's picture -- reaches an app
// left open within the hour. A list that hasn't changed isn't announced again:
// the atrium would rebuild its theme, particles and all, for nothing.
const REFRESH_MS = 60 * 60 * 1000
let loading: Promise<void> | null = null
let loadedAt = 0
export function loadSpecialThemes(again = false): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return Promise.resolve()
  if (loading && !again && Date.now() - loadedAt < REFRESH_MS) return loading
  loadedAt = Date.now()
  loading = fetch(`${url}/rest/v1/special_themes?select=${FIELDS}&order=starts_on`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    .then(async response => {
      if (!response.ok) return
      const next = asSpecialThemes(await response.json())
      if (JSON.stringify(next) !== JSON.stringify(themes)) publish(next)
    })
    .catch(() => { /* offline: the kept copy stands */ })
  return loading
}

// The theme a new atrium starts in today, if any: waiting a moment for the
// list, so a first visit in season still gets it, but never long.
export async function seasonalThemeNow(): Promise<SpecialTheme | null> {
  await Promise.race([loadSpecialThemes(), new Promise(resolve => setTimeout(resolve, 1500))])
  return seasonalTheme(themes, new Date())
}

// ---- Changes: the operator's, on the web (RLS refuses anyone else) -----------------

export async function saveSpecialTheme(theme: SpecialTheme): Promise<string | null> {
  if (!supabase) return 'No database'
  const { error } = await (supabase.from('special_themes') as any).upsert({ ...asRow(theme), updated_at: new Date().toISOString() })
  if (error) return error.message || 'Could not save'
  publish(themes.some(t => t.id === theme.id) ? themes.map(t => (t.id === theme.id ? theme : t)) : [...themes, theme])
  return null
}

export async function deleteSpecialTheme(id: string): Promise<string | null> {
  if (!supabase) return 'No database'
  const { error } = await (supabase.from('special_themes') as any).delete().eq('id', id)
  if (error) return error.message || 'Could not delete'
  publish(themes.filter(t => t.id !== id))
  return null
}
