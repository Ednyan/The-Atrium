// What language the app is in.
//
// Built on the same shape as the theme preference (useLandingTheme.ts): one
// value in a module, every hook subscribed to it, one localStorage key, and
// the same value read by the static privacy/terms pages. Choosing a language
// on one screen chooses it on all of them, including inside an atrium, even
// though only a few screens carry the control.
//
// Three states, like the theme. No stored value means "follow the browser",
// which is not the same as having picked whatever the browser is set to today:
// somebody who installs a Portuguese system next month should get Portuguese
// without going to look for a setting.
//
// Two rules make translating this app safe to do a surface at a time:
//
//   1. A key with no translation falls back to English, never to the key.
//      A half-finished language reads as a half-translated app rather than a
//      broken one, so a language can ship the moment any of it is useful.
//   2. Catalogues load on demand. English is compiled in because it is the
//      fallback and has to be there synchronously; every other language is a
//      separate chunk fetched when it is chosen, so eleven languages cost a
//      first-time visitor nothing.

import { useEffect, useState } from 'react'
import { en, type Catalogue, type TranslationKey } from '../locales/en'

export type LanguageCode =
  | 'en' | 'es' | 'pt-BR' | 'pt-PT' | 'it' | 'fr' | 'de'
  | 'ja' | 'hi' | 'zh' | 'ru' | 'ko'

export interface Language {
  code: LanguageCode
  // What the language calls itself. A picker listing "Japanese" is a picker
  // for people who already read English; 日本語 is how somebody finds their
  // own language in a list.
  endonym: string
  english: string
}

// Every language the app intends to speak, in the order they are offered.
// English first because it is the original; the rest by how many people the
// app is likely to reach in them.
export const LANGUAGES: Language[] = [
  { code: 'en', endonym: 'English', english: 'English' },
  { code: 'es', endonym: 'Español', english: 'Spanish' },
  // Two distinct catalogues, not one hedging between them -- Guardar/Salvar,
  // Ecrã/Tela and the "a carregar" / "carregando" gerund split are different
  // enough that a single Portuguese would have been the wrong choice for
  // whichever half of its readers it wasn't written for.
  { code: 'pt-BR', endonym: 'Português (Brasil)', english: 'Portuguese (Brazil)' },
  { code: 'pt-PT', endonym: 'Português (Portugal)', english: 'Portuguese (Portugal)' },
  { code: 'fr', endonym: 'Français', english: 'French' },
  { code: 'de', endonym: 'Deutsch', english: 'German' },
  { code: 'it', endonym: 'Italiano', english: 'Italian' },
  { code: 'ru', endonym: 'Русский', english: 'Russian' },
  { code: 'zh', endonym: '中文', english: 'Chinese' },
  { code: 'ja', endonym: '日本語', english: 'Japanese' },
  { code: 'ko', endonym: '한국어', english: 'Korean' },
  { code: 'hi', endonym: 'हिन्दी', english: 'Hindi' },
]

// Adding a language is two lines: write src/locales/<code>.ts as a partial
// copy of en.ts, and register its loader here. Nothing else in the app needs
// to know. A language with no entry here simply isn't offered yet, which is
// why the picker only shows what actually exists.
const loaders: Partial<Record<LanguageCode, () => Promise<{ default: Catalogue }>>> = {
  es: () => import('../locales/es'),
  'pt-BR': () => import('../locales/pt-BR'),
  'pt-PT': () => import('../locales/pt-PT'),
  fr: () => import('../locales/fr'),
  de: () => import('../locales/de'),
  it: () => import('../locales/it'),
  ru: () => import('../locales/ru'),
  zh: () => import('../locales/zh'),
}

const KEY = 'atrium_language'

const catalogues: Partial<Record<LanguageCode, Catalogue>> = { en }
const listeners = new Set<() => void>()
let current: LanguageCode | null = null

/** The languages that can actually be chosen right now. */
export function availableLanguages(): Language[] {
  return LANGUAGES.filter(language => language.code === 'en' || loaders[language.code])
}

function isAvailable(code: string): code is LanguageCode {
  return availableLanguages().some(language => language.code === code)
}

// Portugal, Angola, Mozambique, Cape Verde, Guinea-Bissau, São Tomé and
// Timor-Leste write European Portuguese; a bare 'pt' with no region, or any
// region not in that set, defaults to Brazilian -- the far larger audience
// online, and the one a region-less tag most likely means.
const EUROPEAN_PORTUGUESE_REGIONS = new Set(['pt', 'ao', 'mz', 'cv', 'gw', 'st', 'tl'])

// What the browser is asking for, if the app speaks it. navigator.languages is
// in preference order, and entries are tags like 'pt-BR' or 'de-AT' -- for
// every language but Portuguese the region is discarded and only the part
// before the dash is matched, since the app doesn't otherwise split a
// language by country and offering somebody nothing because of a region
// subtag would be a silly reason to fall back to English.
function browserLanguage(): LanguageCode {
  try {
    const wanted = navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language]
    for (const tag of wanted) {
      const [base, region] = (tag || '').toLowerCase().split('-')
      if (base === 'pt') {
        const code = EUROPEAN_PORTUGUESE_REGIONS.has(region ?? '') ? 'pt-PT' : 'pt-BR'
        if (isAvailable(code)) return code
        continue
      }
      if (isAvailable(base)) return base
    }
  } catch {
    // No navigator to ask.
  }
  return 'en'
}

function readStored(): LanguageCode | null {
  try {
    const value = localStorage.getItem(KEY)
    return value && isAvailable(value) ? value : null
  } catch {
    return null
  }
}

/** The language in force, for code that needs it once rather than continuously. */
export function currentLanguage(): LanguageCode {
  if (current) return current
  current = readStored() ?? browserLanguage()
  return current
}

/** True when the language is following the browser rather than a choice. */
export function isFollowingBrowser(): boolean {
  return readStored() === null
}

function announce() {
  try {
    document.documentElement.lang = currentLanguage()
  } catch {
    // Not in a document.
  }
  listeners.forEach(listener => listener())
}

// Fetches a catalogue if it isn't already here, then tells everybody. Failure
// is not fatal: the language stays selected and every string falls back to
// English, which is a worse app but a working one.
async function load(code: LanguageCode) {
  if (catalogues[code]) return
  const loader = loaders[code]
  if (!loader) return
  try {
    const module = await loader()
    catalogues[code] = module.default
  } catch {
    // Offline, or a chunk that failed to fetch. English carries it.
  }
  announce()
}

export function setLanguage(code: LanguageCode | 'browser') {
  if (code === 'browser') {
    current = browserLanguage()
    try {
      localStorage.removeItem(KEY)
    } catch {
      // Private browsing: the choice holds for this visit.
    }
  } else {
    current = code
    try {
      localStorage.setItem(KEY, code)
    } catch {
      // Same.
    }
  }
  announce()
  void load(currentLanguage())
}

/**
 * Look up a string.
 *
 * Falls back through the chosen language, then English, then the key itself --
 * and the last of those should never be reached, because the key type comes
 * from the English catalogue.
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const chosen = catalogues[currentLanguage()]
  const value = (chosen && chosen[key]) ?? en[key] ?? key
  if (!vars) return value
  return value.replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name]) : whole,
  )
}

/**
 * Which plural form the current language wants for a count.
 *
 * "1 contribution" / "2 contributions" is an English-shaped question, and
 * asking it that way gets Russian wrong: it takes one form for 1, another for
 * 2-4, and a third for 5 and up, so a single "add an s" rule mislabels three
 * numbers in every ten. Intl.PluralRules already knows every language's rule,
 * so this asks it rather than encoding a guess.
 *
 * Collapsed to three slots, because that is as many as any language this app
 * speaks distinguishes: `other` and `many` share a key, which is the same
 * string in each of them.
 */
export function pluralCategory(count: number): 'one' | 'few' | 'many' {
  try {
    const category = new Intl.PluralRules(currentLanguage()).select(count)
    if (category === 'one') return 'one'
    if (category === 'few') return 'few'
    return 'many'
  } catch {
    // An environment without Intl, or a tag it dislikes: English's rule.
    return count === 1 ? 'one' : 'many'
  }
}

// The document's lang picks the font stack for the script (see --font-ui in
// index.css), so it has to be right from the first paint rather than from
// whenever the first catalogue finishes loading -- otherwise a Chinese reader
// gets one frame of the system's last-resort face before it corrects.
if (typeof document !== 'undefined') {
  try {
    document.documentElement.lang = currentLanguage()
  } catch {
    // Not in a document.
  }
}

// The static privacy and terms pages write this same key, and both live in
// their own tab. Without this an open app tab would keep whatever it read at
// startup -- the same trap the theme switch fell into.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return
    current = event.newValue && isAvailable(event.newValue) ? event.newValue : browserLanguage()
    announce()
    void load(currentLanguage())
  })
}

/**
 * Subscribe to the language.
 *
 * Returns `t` rather than the catalogue, so a component re-renders when the
 * language changes without having to know how lookup works.
 */
export function useTranslation() {
  const [, setTick] = useState(0)

  useEffect(() => {
    const listener = () => setTick(tick => tick + 1)
    listeners.add(listener)
    // A language chosen in a previous visit still needs its catalogue fetched.
    void load(currentLanguage())
    return () => { listeners.delete(listener) }
  }, [])

  return {
    t,
    language: currentLanguage(),
    followingBrowser: isFollowingBrowser(),
    setLanguage,
    languages: availableLanguages(),
  }
}
