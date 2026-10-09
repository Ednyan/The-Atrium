// Special themes: the developer's themes for an occasion -- Spooky for
// Halloween -- each with a window of the year (month and day, every year) in
// which a new atrium starts in it. Shown to everyone with the presets, at any
// time of year; made, changed and removed in Developers > Special themes, by
// the platform operator alone (add_special_themes.sql).
//
// Kept in the web database for both apps: read there by anyone, the desktop
// too, which asks it over plain REST (its own database is the vault). A copy
// is kept on the device, so the presets and a new atrium's theme don't wait
// on the network, and still know the last ones seen offline.

import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import type { ThemeSettings } from '../types/database'
import type { ThemeMode } from './customThemes'
import { isMonthDay, seasonalTheme } from './season'

export interface SpecialTheme {
  id: string
  name: string
  mode: ThemeMode
  values: ThemeSettings
  startsOn: string
  endsOn: string
}

// ---- The list ---------------------------------------------------------------------

const COPY_KEY = 'atrium.specialThemes'
const FIELDS = 'id,name,mode,theme_settings,starts_on,ends_on'

function asSpecialThemes(rows: unknown): SpecialTheme[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((r: any) => r && typeof r.id === 'string' && typeof r.name === 'string'
    && isMonthDay(r.starts_on) && isMonthDay(r.ends_on) && r.theme_settings && typeof r.theme_settings === 'object'
    ? [{ id: r.id, name: r.name, mode: r.mode === 'light' ? 'light' : 'dark', values: r.theme_settings, startsOn: r.starts_on, endsOn: r.ends_on } as SpecialTheme]
    : [])
}
const asRow = (t: SpecialTheme) => ({ id: t.id, name: t.name, mode: t.mode, theme_settings: t.values, starts_on: t.startsOn, ends_on: t.endsOn })

let themes: SpecialTheme[] = (() => { try { return asSpecialThemes(JSON.parse(localStorage.getItem(COPY_KEY) || '[]').map(asRow)) } catch { return [] } })()
const watchers = new Set<() => void>()
const publish = (next: SpecialTheme[]) => {
  themes = next
  try { localStorage.setItem(COPY_KEY, JSON.stringify(next)) } catch { /* for this visit only */ }
  watchers.forEach(fn => fn())
}
const watch = (fn: () => void) => {
  watchers.add(fn)
  void loadSpecialThemes()
  return () => { watchers.delete(fn) }
}
// The saved ones (the presets list, the Developers list).
export const useSpecialThemes = () => useSyncExternalStore(watch, () => themes)
// The saved ones and the developer's draft, if any: what a theme ref can name.
export const specialThemesNow = () => {
  const d = specialThemeDraft()?.theme
  return d ? [...themes.filter(t => t.id !== d.id), d] : themes
}

// The theme being made in Developers > Special themes, kept for this session:
// an atrium entered to look around in it shows it (specialThemesNow), and the
// tool has it back on return. On this device alone, and never saved by
// itself -- nor does it start a new atrium.
const DRAFT_KEY = 'atrium.specialThemes.draft'
export function specialThemeDraft(): { theme: SpecialTheme; isNew: boolean } | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
    const [theme] = asSpecialThemes(stored ? [asRow(stored.theme)] : [])
    return theme ? { theme, isNew: !!stored.isNew } : null
  } catch {
    return null
  }
}
export function setSpecialThemeDraft(draft: { theme: SpecialTheme; isNew: boolean } | null) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch { /* not kept: the tool starts empty next time */ }
}

// Asked once a visit (again after a change here); what's kept stands until it
// answers, and if it can't.
let loading: Promise<void> | null = null
export function loadSpecialThemes(): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return Promise.resolve()
  loading ??= fetch(`${url}/rest/v1/special_themes?select=${FIELDS}&order=starts_on`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    .then(async response => { if (response.ok) publish(asSpecialThemes(await response.json())) })
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
