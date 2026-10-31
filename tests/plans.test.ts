// What a payer leaves and how many are needed.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { appealDue } from '../src/lib/supportAppeal.ts'
import { leftAMonth, leftPerPayer, MERCHANT_OF_RECORD, payersNeeded, PRICE_MONTHLY, PRICE_YEARLY, RUNNING_COSTS, STRIPE, YEARLY_A_MONTH, YEARLY_SAVES_OVER } from '../src/lib/plans.ts'

const near = (got: number, want: number, by = 0.01) => assert.ok(Math.abs(got - want) <= by, `${got} is not ${want}`)

test('a €4 month by card leaves about €2.60', () => {
  near(leftAMonth(4, 1, STRIPE), 2.60)
})

test('the yearly plan leaves less a month, for fewer fees', () => {
  near(leftAMonth(40, 12, STRIPE), 2.29)
  assert.ok(leftAMonth(40, 12, STRIPE) < leftAMonth(4, 1, STRIPE))
})

test('a merchant of record costs more per payment than card fees alone', () => {
  assert.ok(leftPerPayer(PRICE_MONTHLY, PRICE_YEARLY, MERCHANT_OF_RECORD) < leftPerPayer(PRICE_MONTHLY, PRICE_YEARLY, STRIPE))
})

test('payers needed: more for dearer ways of running it, and rounded up', () => {
  const per = leftPerPayer(PRICE_MONTHLY, PRICE_YEARLY, MERCHANT_OF_RECORD)
  const needed = RUNNING_COSTS.map(cost => payersNeeded(cost.yearly, per))
  assert.deepEqual([...needed].sort((a, b) => a - b), needed)
  assert.equal(payersNeeded(1200, 2.1), 50)
})

test('the yearly plan is the better deal, by what the page says', () => {
  near(YEARLY_A_MONTH, 3.33)
  // €40 against €48 saves 16.7%.
  assert.equal(YEARLY_SAVES_OVER, 15)
  assert.ok(1 - PRICE_YEARLY / (PRICE_MONTHLY * 12) > YEARLY_SAVES_OVER / 100)
  assert.ok(YEARLY_A_MONTH < PRICE_MONTHLY)
})

test('free people count: a smaller paying share needs more payers', () => {
  assert.ok(payersNeeded(12000, 2.3, 0.0025) > payersNeeded(12000, 2.3, 0.01))
})

test('the donation card: a silence holds over everything, even a new version', () => {
  const asked = { firstUseAt: 1, tracesCreated: 99, silentUntil: 0, remindNextLaunch: true }
  assert.equal(appealDue(asked, 1000), true)
  assert.equal(appealDue({ ...asked, silentUntil: 2000 }, 1000), false)
  assert.equal(appealDue({ ...asked, silentUntil: 500 }, 1000), true)
  assert.equal(appealDue({ firstUseAt: 0, tracesCreated: 0, silentUntil: 0, remindNextLaunch: false }, 1000), false)
})
