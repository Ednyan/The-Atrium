// The plans: what each gives, what a payer leaves, and how many
// payers each way of running the Atrium needs. Shown only to the operator for
// now (Developers > Plans): nothing here limits or charges anyone yet.

import type { TranslationKey } from '../locales/en'

export interface Plan {
  cloudAtriums: number
  cloudMb: number
  fileMb: number
  mirrorMb: number
  ownTemplates: boolean
}

export const FREE_PLAN: Plan = { cloudAtriums: 1, cloudMb: 50, fileMb: 25, mirrorMb: 100, ownTemplates: false }
export const PAID_PLAN: Plan = { cloudAtriums: 10, cloudMb: 20000, fileMb: 200, mirrorMb: 1000, ownTemplates: true }

const size = (mb: number) => (mb >= 1000 ? `${mb / 1000} GB` : `${mb} MB`)

// A value that's a word rather than a number, and its word.
const PLAN_WORDS: Record<string, TranslationKey> = {
  yes: 'plans.yes', no: 'plans.no', unlimited: 'plans.unlimited',
}
export const planValue = (shown: string, t: (key: TranslationKey) => string) => (PLAN_WORDS[shown] ? t(PLAN_WORDS[shown]) : shown)

// What each plan gives, for showing: a label, then free's and paid's.
export function planFeatures(): [TranslationKey, string, string][] {
  return [
    ['plans.row.atriums', String(FREE_PLAN.cloudAtriums), String(PAID_PLAN.cloudAtriums)],
    ['plans.row.space', size(FREE_PLAN.cloudMb), size(PAID_PLAN.cloudMb)],
    ['plans.row.file', size(FREE_PLAN.fileMb), size(PAID_PLAN.fileMb)],
    ['plans.row.mirror', size(FREE_PLAN.mirrorMb), size(PAID_PLAN.mirrorMb)],
    ['plans.row.elsewhere', 'unlimited', 'unlimited'],
    ['plans.row.rooms', 'yes', 'yes'],
    ['plans.row.own', 'no', 'yes'],
  ]
}

export const PRICE_MONTHLY = 4
export const PRICE_YEARLY = 40
// What the yearly plan comes to: a month, and the share it saves over a year of
// the monthly one, rounded down to a 5 so "over" stays true.
export const YEARLY_A_MONTH = PRICE_YEARLY / 12
export const YEARLY_SAVES_OVER = Math.floor((1 - PRICE_YEARLY / (PRICE_MONTHLY * 12)) * 20) * 5

// How a payment is taken, each as a share of the price and a fixed part, in euros.
export const STRIPE = { share: 0.015 + 0.007 + 0.005, fixed: 0.25 } // card, Billing, Tax; EEA cards
export const MERCHANT_OF_RECORD = { share: 0.05, fixed: 0.46 } // Paddle's 5% + $0.50

const VAT = 0.21 // About the EU's average; each buyer's country's own rate applies.
const USE_A_MONTH = 0.355 // A payer's own use, at most: 20 GB full (€0.28 in R2), saves, relay.
const YEARLY_SHARE = 0.4 // Of payers, assumed.
const LOST = 0.05 // Refunds, disputes, dearer cards from outside the EEA, assumed.
const FREE_PERSON_A_MONTH = 0.001 // All services together, at list prices.

/** What one payment leaves, a month: after VAT, fees and the payer's own use. */
export function leftAMonth(price: number, months: number, fees: { share: number; fixed: number }): number {
  const withoutVat = price / (1 + VAT)
  const fee = price * fees.share + fees.fixed
  return (withoutVat - fee) / months - USE_A_MONTH
}

/** What a payer leaves a month, monthly and yearly payers together. */
export function leftPerPayer(monthly: number, yearly: number, fees: { share: number; fixed: number }): number {
  return ((1 - YEARLY_SHARE) * leftAMonth(monthly, 1, fees) + YEARLY_SHARE * leftAMonth(yearly, 12, fees)) * (1 - LOST)
}

/** Payers needed to cover `yearlyCost`, when `payingShare` of monthly users pay,
 *  each of them carrying the free people behind them. */
export function payersNeeded(yearlyCost: number, perPayer: number, payingShare = 0.01): number {
  return Math.ceil(yearlyCost / 12 / (perPayer - FREE_PERSON_A_MONTH / payingShare))
}

// What a Portuguese company costs a year, before anything is paid out as
// profit. Estimates, to be replaced by real quotes.
const BASE = 2700 /* accountant, €225 a month */ + 200 /* invoicing, complaints book */ + 300 /* bank, insurance, sundries */
export const RUNNING_COSTS = [
  { id: 'other-job', yearly: BASE }, // Unpaid manager, covered by another job: no contributions.
  { id: 'unpaid', yearly: BASE + Math.round(537.13 * 0.3475 * 12) }, // Unpaid manager, no other cover: on 1 IAS.
  { id: 'minimum-wage', yearly: BASE + Math.round(920 * 14 * 1.2375) }, // Paying oneself the minimum wage.
  { id: 'living', yearly: BASE + Math.round(2000 * 14 * 1.2375) }, // €2,000 gross, 14 times a year.
] as const
