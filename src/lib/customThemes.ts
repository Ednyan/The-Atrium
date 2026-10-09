// A person's own atrium themes, and which theme each person sees an atrium in.
// (The developer's special themes, shown with the presets, are lib/specialThemes.)
//
// Every theme is light or dark: a preset by its floor (Soft Sepia and
// Markerboard light, Abyss dark), one of a person's own as they mark it. What
// someone sees an atrium in is theirs alone, remembered per atrium on this
// device: the atrium's own theme until they choose -- picking a theme in the
// Atrium Themes panel, or pressing light/dark, which goes to the last theme
// of that kind they used (Markerboard or Abyss before they've used any).
// Picking a theme sets light or dark to match it. Only an owner's "Save as
// this atrium's theme" changes what everyone else sees.
//
// A person's own themes live on their account (profiles.custom_themes; the
// desktop vault's profiles row): three on the web, twelve on the desktop.
// Loaded once, kept here, and written whole a moment after each change.

import { useSyncExternalStore } from 'react'
import { supabase, isDesktop } from './supabase'
import { ATRIUM_THEMES } from './atriumThemePresets'
import { TRACE_PRESETS, defaultPresetFor } from './tracePresets'
import { specialThemesNow } from './specialThemes'
import type { ThemeSettings } from '../types/database'

export type ThemeMode = 'light' | 'dark'
export interface CustomTheme {
  id: string
  name: string
  mode: ThemeMode
  values: ThemeSettings
}

export const CUSTOM_THEME_LIMIT = isDesktop ? 12 : 3

// Light or dark by its floor.
// A theme's grid: as it says, or -- from before there was a choice -- lines,
// unless it was turned off.
export const gridStyleOf = (theme: ThemeSettings | null | undefined): 'none' | 'lines' | 'dots' =>
  theme?.gridStyle ?? (theme?.gridEnabled === false ? 'none' : 'lines')

export function modeOf(values: ThemeSettings | null | undefined): ThemeMode {
  const match = /^#?([0-9a-f]{6})$/i.exec((values?.backgroundColor ?? '#0a0a0f').trim())
  if (!match) return 'dark'
  const n = parseInt(match[1], 16)
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.5 ? 'light' : 'dark'
}

// What someone sees an atrium in: its own theme, a preset, a special theme, or
// one of theirs.
export type ThemeRef = 'atrium' | `preset:${string}` | `special:${string}` | `custom:${string}`

export const PRESETS = TRACE_PRESETS.map((preset, i) => ({
  ref: `preset:${preset.id}` as ThemeRef,
  nameKey: ATRIUM_THEMES[i].nameKey,
  descKey: ATRIUM_THEMES[i].descKey,
  values: ATRIUM_THEMES[i].values as ThemeSettings,
}))

// A ref's theme. Null when it names nothing -- one of a person's own themes,
// or a special theme, deleted.
export function themeOf(ref: ThemeRef, atrium: ThemeSettings | null | undefined, customs: CustomTheme[]): ThemeSettings | null | undefined {
  if (ref === 'atrium') return atrium
  if (ref.startsWith('preset:')) return PRESETS.find(p => p.ref === ref)?.values ?? null
  if (ref.startsWith('special:')) return specialThemesNow().find(s => `special:${s.id}` === ref)?.values ?? null
  return customs.find(c => `custom:${c.id}` === ref)?.values ?? null
}

// Marked light or dark, a person's own or a special theme; any other by its floor.
const markedMode = (ref: string, customs: CustomTheme[]) =>
  (ref.startsWith('custom:') ? customs.find(c => `custom:${c.id}` === ref)
    : ref.startsWith('special:') ? specialThemesNow().find(s => `special:${s.id}` === ref) : null)?.mode

export function themeModeOf(ref: ThemeRef, atrium: ThemeSettings | null | undefined, customs: CustomTheme[]): ThemeMode {
  return markedMode(ref, customs) ?? modeOf(themeOf(ref, atrium, customs))
}

// ---- On this device: what each atrium is seen in; the last theme of each kind ----

const viewKey = (lobbyId: string) => `atrium.view.${lobbyId}`
const lastKey = (mode: ThemeMode) => `atrium.lastTheme.${mode}`
const read = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* for this visit only */ } }
const isRef = (value: string | null): value is ThemeRef => !!value && (value === 'atrium' || /^(preset|special|custom):./.test(value))

// Null: the atrium's own theme, as nobody has chosen otherwise here.
export function readView(lobbyId: string, mode: ThemeMode): ThemeRef | null {
  const stored = read(viewKey(lobbyId))
  if (isRef(stored)) return stored
  // Before themes of one's own, pressing light/dark made an atrium follow it.
  return read(`atrium.followTheme.${lobbyId}`) === '1' ? lastThemeOf(mode) : null
}
export const writeView = (lobbyId: string, ref: ThemeRef) => write(viewKey(lobbyId), ref)

// One of your own, or a special theme, only while it's still there and still
// of that kind: marked the other way since, it's the other kind's.
export function lastThemeOf(mode: ThemeMode): ThemeRef {
  const stored = read(lastKey(mode))
  const marked = isRef(stored) && /^(custom|special):/.test(stored)
  const fits = isRef(stored) && stored !== 'atrium' && (!marked || markedMode(stored, themes) === mode)
  return fits ? stored : `preset:${defaultPresetFor(mode === 'light').id}`
}
export const rememberLast = (mode: ThemeMode, ref: ThemeRef) => { if (ref !== 'atrium') write(lastKey(mode), ref) }

// ---- The account's themes ---------------------------------------------------------

// A copy kept on this device too, so an atrium seen in one of them shows in it
// from the first frame rather than once the account has answered.
const COPY_KEY = 'atrium.customThemes'
let themes: CustomTheme[] = (() => { try { return asCustomThemes(JSON.parse(localStorage.getItem(COPY_KEY) || '[]')) } catch { return [] } })()
const watchers = new Set<() => void>()
const watch = (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn) } }
const publish = (next: CustomTheme[]) => {
  themes = next
  write(COPY_KEY, JSON.stringify(next))
  watchers.forEach(fn => fn())
}
export const useCustomThemes = () => useSyncExternalStore(watch, () => themes)
// As they are now, ahead of any render: a theme just made is picked at once.
export const customThemesNow = () => themes

export function asCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return []
  return value.filter((t): t is CustomTheme =>
    !!t && typeof t.id === 'string' && typeof t.name === 'string' && (t.mode === 'light' || t.mode === 'dark') && !!t.values && typeof t.values === 'object',
  ).slice(0, CUSTOM_THEME_LIMIT)
}

export async function loadCustomThemes(userId: string) {
  if (!supabase) return
  const { data, error } = await (supabase.from('profiles') as any).select('custom_themes').eq('id', userId).maybeSingle()
  if (!error) publish(asCustomThemes(data?.custom_themes))
}

// Changed here at once; written a moment after the last change, so dragging
// a slider is one write, not one a step.
let saveTimer: number | undefined
export function setCustomThemes(userId: string, next: CustomTheme[], onSaveFailed?: () => void) {
  publish(next.slice(0, CUSTOM_THEME_LIMIT))
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(async () => {
    if (!supabase) return
    const { error } = await (supabase.from('profiles') as any).update({ custom_themes: themes }).eq('id', userId)
    if (error) {
      console.error('Could not save your themes:', error)
      onSaveFailed?.()
    }
  }, 600)
}
