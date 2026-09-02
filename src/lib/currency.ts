// The currency a contribution is shown and made in.
//
// Same shape as i18n.ts on purpose: one value in a module, every hook
// subscribed to it, one localStorage key. Currency and language are the same
// kind of preference -- chosen once, obeyed by every screen -- and making them
// behave differently would only be a thing to remember.
//
// The table itself lives in supabase/functions/_shared/currencies.ts, because
// the Edge Function that validates the amount reads the same limits. See the
// note at the top of that file.

import { useEffect, useState } from 'react'
import {
  CURRENCIES,
  BASE_CURRENCY,
  currencyByCode,
  currencyForRegion,
  isCurrencyCode,
  minorPerUnit,
  type Currency,
  type CurrencyCode,
} from '../../supabase/functions/_shared/currencies.ts'

export { CURRENCIES, BASE_CURRENCY, currencyByCode, minorPerUnit }
export type { Currency, CurrencyCode }

const KEY = 'lobby_currency'

let current: CurrencyCode | null = null
const listeners = new Set<() => void>()

// What the browser implies, if this app offers it.
//
// The locale's region, not a geo lookup: it needs no network, no third party
// and no permission, and somebody who has set their machine to pt-BR is
// telling us something more reliable than an IP address routed through a VPN.
// It is a default, and the dropdown is right there.
function browserCurrency(): CurrencyCode {
  try {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
    for (const tag of tags) {
      if (!tag) continue
      let region: string | undefined
      try {
        region = new Intl.Locale(tag).region
      } catch {
        // A tag Intl.Locale won't parse. Fall back to reading the subtag, which
        // is where the region is in every tag that has one.
        region = tag.split('-')[1]
      }
      // Null means the region is unknown, not that it uses the base -- so the
      // walk continues to the next tag rather than settling here.
      const found = currencyForRegion(region)
      if (found) return found
    }
  } catch {
    // No navigator to ask.
  }
  return BASE_CURRENCY
}

function readStored(): CurrencyCode | null {
  try {
    const value = localStorage.getItem(KEY)
    return isCurrencyCode(value) ? value : null
  } catch {
    return null
  }
}

/** The currency in force, for code that needs it once rather than continuously. */
export function currentCurrency(): CurrencyCode {
  if (current) return current
  current = readStored() ?? browserCurrency()
  return current
}

/** True when the currency is following the browser rather than a choice. */
export function isFollowingLocale(): boolean {
  return readStored() === null
}

function announce() {
  listeners.forEach(listener => listener())
}

export function setCurrency(code: CurrencyCode) {
  current = code
  try {
    localStorage.setItem(KEY, code)
  } catch {
    // Private browsing: the choice holds for this visit.
  }
  announce()
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

// The ECB's daily reference rates, via Frankfurter, which publishes them with
// CORS open and no key. Base EUR, which is also our base, so every rate is
// used as published and no cross-rate is ever assembled here.
//
// Rates are a display concern only. What was given is recorded in the currency
// it was given in and in what it settled as -- see the contributions table --
// and none of that changes when somebody moves this dropdown.
const RATES_URL = `https://api.frankfurter.dev/v1/latest?base=${BASE_CURRENCY}&symbols=`
  + CURRENCIES.map(c => c.code).filter(c => c !== BASE_CURRENCY).join(',')
const RATES_KEY = 'lobby_fxRates'

export type Rates = Record<string, number>

let rates: Rates = { [BASE_CURRENCY]: 1 }
let ratesDate: string | null = null
let fetching: Promise<void> | null = null

/** The ECB publishes once per working day, so a date is the whole cache policy. */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function readCachedRates() {
  try {
    const raw = localStorage.getItem(RATES_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.date === 'string' && parsed.rates && typeof parsed.rates === 'object') {
      rates = { ...parsed.rates, [BASE_CURRENCY]: 1 }
      ratesDate = parsed.date
    }
  } catch {
    // Unreadable or unparseable. Treated as no cache.
  }
}
readCachedRates()

/**
 * Fetch today's rates unless they are already here.
 *
 * Never throws and never blocks a render. A failure leaves whatever rates were
 * cached -- possibly none, in which case only the base currency is exact and
 * everything else falls back to it, which is the honest failure: showing a
 * converted figure from a rate we could not get would be worse than showing
 * euros.
 */
export async function ensureRates(): Promise<void> {
  if (ratesDate === today()) return
  if (fetching) return fetching
  fetching = (async () => {
    try {
      const response = await fetch(RATES_URL)
      if (!response.ok) return
      const body = await response.json()
      if (!body || typeof body.rates !== 'object') return
      rates = { ...body.rates, [BASE_CURRENCY]: 1 }
      // The response's own date, not today's: on a weekend or a holiday the
      // ECB publishes nothing and Frankfurter answers with Friday's, and
      // storing today against Friday's numbers would hide that.
      ratesDate = typeof body.date === 'string' ? body.date : today()
      try {
        localStorage.setItem(RATES_KEY, JSON.stringify({ date: ratesDate, rates }))
      } catch {
        // Rates still hold for this visit.
      }
      announce()
    } catch {
      // Offline, blocked, or the service is down. Cached rates stand.
    } finally {
      fetching = null
    }
  })()
  return fetching
}

/** True when a figure in `code` is a real conversion rather than a fallback. */
export function haveRateFor(code: CurrencyCode): boolean {
  return code === BASE_CURRENCY || typeof rates[code] === 'number'
}

/**
 * Convert minor units in the base currency into minor units of `code`.
 *
 * Rounded to the currency's own precision, which for a zero-decimal currency
 * means whole units -- ¥1,234, never ¥1,234.56.
 */
export function fromBaseMinor(baseMinor: number, code: CurrencyCode): number {
  if (code === BASE_CURRENCY) return Math.round(baseMinor)
  const rate = rates[code]
  // No rate: hand back the base amount unchanged. Callers must pair this with
  // displayCurrency below, or they will label euros with somebody else's
  // symbol -- ten euros rendered as "$10", which is not a rounding error but a
  // false statement about what was given.
  if (typeof rate !== 'number') return Math.round(baseMinor)
  const units = (baseMinor / 100) * rate
  return Math.round(units * minorPerUnit(code))
}

/**
 * The currency a base-denominated figure can honestly be shown in.
 *
 * The chosen one when there is a rate for it, the base when there is not.
 * Falling back to euros is visibly not what was asked for, which is the point:
 * a figure that silently keeps the wrong symbol cannot be noticed.
 */
export function displayCurrency(code: CurrencyCode): CurrencyCode {
  return haveRateFor(code) ? code : BASE_CURRENCY
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * A money figure in the reader's own language.
 *
 * Intl places the symbol where the language puts it -- "1,50 €" in French,
 * "€1.50" in English -- which is the reason the table's symbol is only used
 * for the input's prefix.
 *
 * `whole` drops the fractional part, for the wall and the goal where every
 * figure is a rounded total and ".00" on all of them is noise.
 */
export function formatMoney(
  minor: number,
  code: CurrencyCode,
  { whole = false, locale }: { whole?: boolean; locale?: string } = {},
): string {
  const per = minorPerUnit(code)
  const value = minor / per
  const zeroDecimal = per === 1
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: whole || zeroDecimal ? 0 : 2,
      maximumFractionDigits: whole || zeroDecimal ? 0 : 2,
    }).format(value)
  } catch {
    // An environment without the currency data. The symbol and the number
    // still say what it is.
    const c = currencyByCode(code)
    return `${c.symbol}${whole || zeroDecimal ? Math.round(value) : value.toFixed(2)}`
  }
}

/** Format an amount held in the BASE currency, converted into `code`. */
export function formatFromBase(
  baseMinor: number,
  code: CurrencyCode,
  options: { whole?: boolean; locale?: string } = {},
): string {
  const shown = displayCurrency(code)
  return formatMoney(fromBaseMinor(baseMinor, shown), shown, options)
}

/**
 * Subscribe to the currency.
 *
 * Fetches rates on mount, the same way useTranslation fetches a catalogue: a
 * currency chosen in a previous visit still needs today's numbers.
 */
export function useCurrency() {
  const [, setTick] = useState(0)

  useEffect(() => {
    const listener = () => setTick(tick => tick + 1)
    listeners.add(listener)
    void ensureRates()
    return () => { listeners.delete(listener) }
  }, [])

  const code = currentCurrency()
  return {
    currency: code,
    currencies: CURRENCIES,
    setCurrency,
    followingLocale: isFollowingLocale(),
    /** Minor units in `currency`, formatted. */
    format: (minor: number, options?: { whole?: boolean }) => formatMoney(minor, code, options),
    /** Minor units in EUR, converted into `currency` and formatted. */
    formatBase: (baseMinor: number, options?: { whole?: boolean }) =>
      formatFromBase(baseMinor, code, options),
    fromBase: (baseMinor: number) => fromBaseMinor(baseMinor, displayCurrency(code)),
    /** What figures are actually being shown in, which is the base if today's
     *  rates could not be fetched. */
    shownIn: displayCurrency(code),
    converted: code !== BASE_CURRENCY,
    haveRate: haveRateFor(code),
  }
}
