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

// The set Stripe will actually take from this account. CNY and BRL were here
// and are not in it -- a currency the checkout page refuses is worse than one
// that was never offered.
export type CurrencyCode =
  | 'EUR' | 'CHF' | 'GBP' | 'JPY' | 'USD'
  | 'AUD' | 'CAD' | 'CZK' | 'DKK' | 'HKD' | 'HUF'
  | 'NOK' | 'NZD' | 'PLN' | 'RON' | 'SEK' | 'SGD' | 'ZAR'

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
  /**
   * A step the amount in minor units has to land on.
   *
   * HUF is Stripe's other special case: it is not zero-decimal, so amounts are
   * still given in fillér, but Stripe requires the value to be evenly
   * divisible by 100 -- whole forint, written in hundredths. An amount that is
   * not is rejected at the API, which a donor experiences as a checkout page
   * that will not open, with no reason given.
   *
   * Every preset and both limits for such a currency are multiples of this,
   * and a typed amount is checked against it.
   */
  step?: number
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

// Presets are round numbers in each currency at roughly the euro amounts they
// replace, not conversions of them: "50 kr" is a donation and "41.87 kr" is an
// exchange rate somebody is being asked to read. The maxima are typo guards at
// roughly 5000 euros, so they need no precision and will not need revisiting as
// rates move.
export const CURRENCIES: Currency[] = [
  { code: 'EUR', symbol: '€',   presets: [300, 500, 1000, 2500],        presetsMonthly: [100, 300, 500, 1000],      min: 100,   max: 500000 },
  { code: 'USD', symbol: '$',   presets: [300, 500, 1000, 2500],        presetsMonthly: [100, 300, 500, 1000],      min: 100,   max: 500000 },
  { code: 'GBP', symbol: '£',   presets: [300, 500, 1000, 2000],        presetsMonthly: [100, 300, 500, 1000],      min: 100,   max: 500000 },
  { code: 'CHF', symbol: 'CHF', presets: [300, 500, 1000, 2500],        presetsMonthly: [100, 300, 500, 1000],      min: 100,   max: 500000 },
  { code: 'AUD', symbol: 'A$',  presets: [500, 1000, 2000, 5000],       presetsMonthly: [200, 500, 1000, 2000],     min: 200,   max: 900000 },
  { code: 'CAD', symbol: 'C$',  presets: [500, 1000, 2000, 5000],       presetsMonthly: [200, 500, 1000, 2000],     min: 200,   max: 800000 },
  { code: 'NZD', symbol: 'NZ$', presets: [500, 1000, 2000, 5000],       presetsMonthly: [200, 500, 1000, 2000],     min: 200,   max: 1000000 },
  { code: 'SGD', symbol: 'S$',  presets: [500, 1000, 2000, 5000],       presetsMonthly: [200, 500, 1000, 2000],     min: 150,   max: 800000 },
  { code: 'HKD', symbol: 'HK$', presets: [2500, 5000, 10000, 20000],    presetsMonthly: [1000, 2500, 5000, 10000],  min: 1000,  max: 4500000 },
  { code: 'DKK', symbol: 'kr',  presets: [2500, 5000, 10000, 20000],    presetsMonthly: [1000, 2500, 5000, 10000],  min: 800,   max: 3700000 },
  { code: 'NOK', symbol: 'kr',  presets: [5000, 10000, 20000, 50000],   presetsMonthly: [1000, 2500, 5000, 10000],  min: 1000,  max: 5800000 },
  { code: 'SEK', symbol: 'kr',  presets: [5000, 10000, 20000, 50000],   presetsMonthly: [1000, 2500, 5000, 10000],  min: 1000,  max: 5500000 },
  { code: 'CZK', symbol: 'Kč',  presets: [10000, 20000, 50000, 100000], presetsMonthly: [2500, 5000, 10000, 25000], min: 2500,  max: 12000000 },
  { code: 'PLN', symbol: 'zł',  presets: [1500, 2500, 5000, 10000],     presetsMonthly: [500, 1000, 2500, 5000],    min: 500,   max: 2100000 },
  { code: 'RON', symbol: 'lei', presets: [1500, 2500, 5000, 10000],     presetsMonthly: [500, 1000, 2500, 5000],    min: 500,   max: 2500000 },
  { code: 'ZAR', symbol: 'R',   presets: [5000, 10000, 20000, 50000],   presetsMonthly: [2000, 5000, 10000, 20000], min: 2000,  max: 10000000 },

  // Zero-decimal: these are yen, not sen. 500 here is ¥500, and sending it to
  // Stripe as if it had cents would charge ¥50,000.
  { code: 'JPY', symbol: '¥',   presets: [500, 1000, 2000, 5000],       presetsMonthly: [200, 500, 1000, 2000],     min: 100,   max: 900000, zeroDecimal: true },

  // Not zero-decimal, but Stripe requires HUF amounts to be divisible by 100 --
  // whole forint written in fillér. Every figure on this line is.
  { code: 'HUF', symbol: 'Ft',  presets: [100000, 200000, 500000, 1000000], presetsMonthly: [50000, 100000, 200000, 500000], min: 40000, max: 200000000, step: 100 },
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
 * Whether an amount in minor units is one Stripe will accept for this currency.
 *
 * Only HUF has anything to say here, and it is worth catching before the
 * request rather than after: Stripe rejects an indivisible HUF amount at the
 * API, which a donor experiences as a checkout page that will not open.
 */
export function isAllowedStep(amountMinor: number, code: CurrencyCode): boolean {
  const step = currencyByCode(code).step
  if (!step) return true
  return amountMinor % step === 0
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
  CH: 'CHF', LI: 'CHF',
  AU: 'AUD',
  CA: 'CAD',
  NZ: 'NZD',
  SG: 'SGD',
  HK: 'HKD',
  DK: 'DKK', GL: 'DKK', FO: 'DKK',
  NO: 'NOK', SJ: 'NOK',
  SE: 'SEK',
  CZ: 'CZK',
  PL: 'PLN',
  RO: 'RON',
  HU: 'HUF',
  ZA: 'ZAR',
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
