// The currency table, which two sides read: the panel takes its presets and
// limits from it, and the Edge Function validates against the same numbers. A
// currency the client offers and the server rejects is a donation that dies on
// the checkout page.
//
// Writing twenty rows by hand is exactly the job a check like this is for. The
// first run of it found two -- NOK and SEK had a monthly preset below their own
// minimum, so the first button on that row could never be pressed.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CURRENCIES,
  BASE_CURRENCY,
  currencyByCode,
  currencyForRegion,
  isAllowedStep,
  isCurrencyCode,
  minorPerUnit,
} from '../supabase/functions/_shared/currencies.ts'

test('every code is unique', () => {
  const codes = CURRENCIES.map(c => c.code)
  assert.equal(new Set(codes).size, codes.length)
})

test('the base currency is in the table', () => {
  assert.ok(CURRENCIES.some(c => c.code === BASE_CURRENCY))
})

test('every preset is inside its own minimum and maximum', () => {
  for (const money of CURRENCIES) {
    for (const preset of [...money.presets, ...money.presetsMonthly]) {
      assert.ok(
        preset >= money.min,
        `${money.code}: preset ${preset} is below its minimum ${money.min}`,
      )
      assert.ok(
        preset <= money.max,
        `${money.code}: preset ${preset} is above its maximum ${money.max}`,
      )
    }
  }
})

test('every currency offers four presets of each kind', () => {
  for (const money of CURRENCIES) {
    assert.equal(money.presets.length, 4, `${money.code} one-time presets`)
    assert.equal(money.presetsMonthly.length, 4, `${money.code} monthly presets`)
  }
})

test('presets ascend, so the row reads left to right', () => {
  for (const money of CURRENCIES) {
    for (const list of [money.presets, money.presetsMonthly]) {
      const sorted = [...list].sort((a, b) => a - b)
      assert.deepEqual(list, sorted, `${money.code} presets are out of order`)
    }
  }
})

test('a stepped currency has every figure on its step', () => {
  // HUF is the only one. Stripe rejects an amount that is not divisible by 100
  // for it, at the API, which a donor sees as a checkout page that will not
  // open and is told nothing about.
  for (const money of CURRENCIES) {
    if (!money.step) continue
    for (const value of [money.min, money.max, ...money.presets, ...money.presetsMonthly]) {
      assert.equal(
        value % money.step, 0,
        `${money.code}: ${value} is not divisible by ${money.step}`,
      )
    }
  }
})

test('minorPerUnit is 1 for a zero-decimal currency and 100 otherwise', () => {
  for (const money of CURRENCIES) {
    assert.equal(minorPerUnit(money.code), money.zeroDecimal ? 1 : 100)
  }
})

test('yen amounts are yen, not sen', () => {
  // The factor-of-a-hundred error: a ¥1,000 preset sent as if it had cents
  // charges ¥100,000.
  assert.equal(minorPerUnit('JPY'), 1)
  const jpy = currencyByCode('JPY')
  assert.ok(jpy.presets.every(p => p >= 100 && p <= 10000), 'JPY presets look like sen')
})

test('isCurrencyCode accepts every code in the table and nothing else', () => {
  for (const money of CURRENCIES) assert.equal(isCurrencyCode(money.code), true)
  for (const bad of ['eur', 'XXX', '', null, undefined, 42, {}]) {
    assert.equal(isCurrencyCode(bad), false, `accepted ${String(bad)}`)
  }
})

test('currencyByCode returns the row asked for', () => {
  for (const money of CURRENCIES) {
    assert.equal(currencyByCode(money.code).code, money.code)
  }
})

test('isAllowedStep only ever rejects a stepped currency', () => {
  for (const money of CURRENCIES) {
    if (money.step) continue
    assert.equal(isAllowedStep(1, money.code), true)
    assert.equal(isAllowedStep(137, money.code), true)
  }
  assert.equal(isAllowedStep(100000, 'HUF'), true)
  assert.equal(isAllowedStep(100050, 'HUF'), false)
})

test('every region maps to a currency the table actually offers', () => {
  // A region pointing at a currency that has been removed would default
  // somebody to a picker entry that is not there.
  for (const region of ['US', 'GB', 'JP', 'CN', 'BR', 'DE', 'PT', 'CH', 'HU', 'ZA']) {
    const code = currencyForRegion(region)
    assert.ok(code, `${region} maps to nothing`)
    assert.ok(isCurrencyCode(code), `${region} maps to ${code}, which is not offered`)
  }
})

test('an unknown region is null, not the base currency', () => {
  // The picker walks the browser's locales; collapsing "unknown" into "euro"
  // would stop that walk at the first tag it did not recognise.
  assert.equal(currencyForRegion('ZZ'), null)
  assert.equal(currencyForRegion(undefined), null)
  assert.equal(currencyForRegion(''), null)
})

test('the ECB publishes a rate for every non-base currency', () => {
  // Not a network call: this is the list the app asks Frankfurter for, checked
  // against what the ECB actually publishes. A currency missing from it falls
  // back to showing euros, silently.
  const ECB_DAILY = new Set([
    'USD', 'JPY', 'BGN', 'CZK', 'DKK', 'GBP', 'HUF', 'PLN', 'RON', 'SEK',
    'CHF', 'ISK', 'NOK', 'TRY', 'AUD', 'BRL', 'CAD', 'CNY', 'HKD', 'IDR',
    'ILS', 'INR', 'KRW', 'MXN', 'MYR', 'NZD', 'PHP', 'SGD', 'THB', 'ZAR',
  ])
  for (const money of CURRENCIES) {
    if (money.code === BASE_CURRENCY) continue
    assert.ok(
      ECB_DAILY.has(money.code),
      `${money.code} has no ECB reference rate, so it would show euros instead`,
    )
  }
})
