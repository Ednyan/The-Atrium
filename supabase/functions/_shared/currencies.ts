// The currencies a contribution can be made in.
//
// This file lives in _shared and has NO imports, deliberately, because both
// sides read it: the browser (src/lib/currency.ts) and the Edge Function that
// validates the amount before it reaches Stripe. A currency the client offers
// but the server rejects is a donation that fails at the checkout page, and a
// limit written down twice is a limit that will eventually disagree with
// itself -- so it is written once and imported with its .ts extension, which
// Deno requires and allowImportingTsExtensions permits.
//
// EUR is the base. Stripe settles into it, contributions.settled_eur_cents
// records what actually arrived in it, and the ECB publishes its rates against
// it -- so every conversion in the app is one multiplication from a rate
// somebody else computed, never a cross-rate assembled here.

export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'JPY' | 'CNY' | 'BRL' | 'CHF'

export interface Currency {
  code: CurrencyCode
  /** For the amount field's prefix. Everywhere else Intl picks the symbol, so
   *  it lands where that language actually puts it. */
  symbol: string
  /**
   * Currencies with no minor unit, where Stripe's unit_amount is whole yen
   * rather than hundredths.
   *
   * Getting this wrong is not a rounding error, it is a factor of a hundred:
   * ¥1,000 sent as if it had cents charges ¥100,000. Every amount in this app
   * is in MINOR units, and for these that means the unit itself.
   */
  zeroDecimal?: boolean
  /** Offered as buttons. Round numbers in each currency rather than a
   *  conversion of the euro ones, because "$5" is a donation and "$5.79" is an
   *  exchange rate someone is being asked to look at. */
  presets: number[]
  /** The same, for a monthly contribution, where the sensible figures are
   *  smaller: what somebody gives once is not what they give every month. */
  presetsMonthly: number[]
  /** Minor units. A floor that means something locally, and a ceiling that is
   *  a typo guard rather than a policy. */
  min: number
  max: number
}

export const CURRENCIES: Currency[] = [
  { code: 'EUR', symbol: '€',   presets: [300, 500, 1000, 2500],     presetsMonthly: [100, 300, 500, 1000],   min: 100,  max: 500000 },
  { code: 'USD', symbol: '$',   presets: [300, 500, 1000, 2500],     presetsMonthly: [100, 300, 500, 1000],   min: 100,  max: 500000 },
  { code: 'GBP', symbol: '£',   presets: [300, 500, 1000, 2000],     presetsMonthly: [100, 300, 500, 1000],   min: 100,  max: 500000 },
  { code: 'CHF', symbol: 'CHF', presets: [300, 500, 1000, 2500],     presetsMonthly: [100, 300, 500, 1000],   min: 100,  max: 500000 },
  { code: 'BRL', symbol: 'R$',  presets: [1500, 2500, 5000, 10000],  presetsMonthly: [500, 1000, 2500, 5000], min: 500,  max: 2500000 },
  { code: 'CNY', symbol: '¥',   presets: [2000, 5000, 10000, 20000], presetsMonthly: [1000, 2000, 5000, 10000], min: 1000, max: 3500000 },
  // Zero-decimal: these are yen, not sen. 500 here is ¥500, and sending it to
  // Stripe as if it had cents would charge ¥50,000.
  { code: 'JPY', symbol: '¥',   presets: [500, 1000, 2000, 5000],    presetsMonthly: [200, 500, 1000, 2000],  min: 100,  max: 700000, zeroDecimal: true },
]

export const BASE_CURRENCY: CurrencyCode = 'EUR'

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCIES.some(c => c.code === value)
}

export function currencyByCode(code: CurrencyCode): Currency {
  const found = CURRENCIES.find(c => c.code === code)
  // Callers pass a code that came through isCurrencyCode; this is the
  // impossible branch, and returning the base is better than throwing inside a
  // render.
  return found ?? CURRENCIES[0]
}

/** How many minor units make one unit: 100, or 1 where there is no minor unit. */
export function minorPerUnit(code: CurrencyCode): number {
  return currencyByCode(code).zeroDecimal ? 1 : 100
}

/**
 * The region-to-currency table behind the default.
 *
 * Only regions whose currency this app actually offers. Anywhere else falls
 * back to the base rather than being shown a near-miss: somebody in Norway is
 * better served by a price in euros than by one in dollars.
 */
const REGION_CURRENCY: Record<string, CurrencyCode> = {
  // The euro area, which is the default anyway but is listed so the table
  // reads as a statement rather than an omission.
  AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR', FR: 'EUR',
  DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR', LT: 'EUR', LU: 'EUR',
  MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR', SI: 'EUR', ES: 'EUR',

  US: 'USD', EC: 'USD', SV: 'USD', PA: 'USD', PR: 'USD',
  GB: 'GBP',
  JP: 'JPY',
  CN: 'CNY',
  BR: 'BRL',
  CH: 'CHF', LI: 'CHF',
}

/**
 * The currency for a region code, or null where there is nothing to say.
 *
 * Null rather than the base, so a caller walking a list of locales can tell
 * "this region uses the euro" from "this region is unknown" and keep looking.
 * Collapsing the two would stop the walk at the first unrecognised tag.
 */
export function currencyForRegion(region: string | undefined | null): CurrencyCode | null {
  if (!region) return null
  return REGION_CURRENCY[region.toUpperCase()] ?? null
}
