// Starting a contribution: ask the worker (workers/rooms, contributions.ts)
// for a Checkout URL -- or, until the operator moves the record off Supabase,
// the Edge Function, as the worker then says (409).
//
// The app holds no Stripe key of any kind, publishable included. It posts an
// amount and gets back a link. Everything that decides whether money was
// actually received happens later, in the webhook, which trusts Stripe's
// signature rather than anything that passed through here.

import type { CurrencyCode } from './currency'
import { MAX_NAME_LENGTH, nameProblem } from '../../supabase/functions/_shared/contributorName.ts'
import { workerUrl } from './rooms'

// Each call's Edge Function, and the worker's name for it.
const FUNCTION_URL = 'create-contribution'
const STATUS_FUNCTION_URL = 'contribution-status'
const AT_WORKER: Record<string, string> = { [FUNCTION_URL]: 'checkout', [STATUS_FUNCTION_URL]: 'status' }

// The rules the worker enforces (supabase/functions/_shared/contributorName),
// run here as the user types so a refused name is refused before paying.

// Returns a catalogue key rather than a sentence: this runs in lib/, where
// there is no hook to read the language from, and the caller is the one that
// can translate. MAX_NAME_LENGTH rides along because the number belongs to
// the rule, not to whoever translates the sentence around it.
export type NameProblem =
  | { key: 'donate.errNameLength'; max: number }
  | { key: 'donate.errNameBanned' | 'donate.errNameUrl' | 'donate.errNameUnrenderable' }

const PROBLEM_KEYS = {
  banned: 'donate.errNameBanned',
  url: 'donate.errNameUrl',
  unrenderable: 'donate.errNameUnrenderable',
} as const

export function checkDisplayName(name: string): NameProblem | null {
  const problem = nameProblem(name)
  if (!problem) return null
  return problem === 'length' ? { key: 'donate.errNameLength', max: MAX_NAME_LENGTH } : { key: PROBLEM_KEYS[problem] }
}

export interface ContributionRequest {
  /**
   * Minor units of `currency` -- cents, or whole yen where the currency has no
   * minor unit. The server validates it against the same table the panel took
   * its presets from.
   */
  amountCents: number
  monthly: boolean
  displayName: string
  /** Omitted by a client that predates the currency picker, and read as the
   *  base there, which is what such a client was sending. */
  currency?: CurrencyCode
}

// Called directly rather than through supabase.functions, which desktop's
// SQLite shim doesn't have at all -- and this has to work identically on both
// platforms, since a desktop user can contribute just as easily as a web one.
export async function startContribution(
  request: ContributionRequest,
): Promise<{ url: string; sessionId: string } | { error: string }> {
  if (!workerUrl() && (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY)) {
    return { error: 'Contributions are not available in this build.' }
  }

  try {
    const body = await callFunction(FUNCTION_URL, request)
    if (!body?.url) {
      return { error: body?.error || 'Could not open the payment page. Please try again.' }
    }

    return { url: body.url, sessionId: String(body.sessionId ?? '') }
  } catch {
    // Offline, blocked, or the function isn't deployed. All the same to someone
    // trying to give money: it didn't work, try later.
    return { error: 'Could not reach the payment service. Check your connection and try again.' }
  }
}

export type ContributionStatus = 'open' | 'complete' | 'expired' | 'unknown'

// Whether a session has been paid yet. 'unknown' means the question could not
// be asked -- no network, no endpoint, a bad gateway -- and is deliberately
// distinct from 'open', because one means keep waiting and the other means we
// learned nothing. A donor who paid on a train should still be thanked when
// the train comes out of the tunnel.
export async function fetchContributionStatus(sessionId: string): Promise<ContributionStatus> {
  try {
    const body = await callFunction(STATUS_FUNCTION_URL, { sessionId })
    const status = body?.status
    return status === 'complete' || status === 'expired' || status === 'open' ? status : 'unknown'
  } catch {
    return 'unknown'
  }
}

// Both calls are the same shape: JSON to the worker -- a plain request, so no
// preflight -- or to a function, carrying the anon key as the project token.
// Throws only when the request itself failed; an error answered still
// returns its body, since the message in it is better than anything invented
// here.
async function callFunction(name: string, payload: unknown): Promise<any> {
  const worker = workerUrl()
  if (worker) {
    const response = await fetch(`${worker}/contributions/${AT_WORKER[name]}`, { method: 'POST', body: JSON.stringify(payload) })
    if (response.status !== 409) return answered(response)
  }

  const baseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!baseUrl || !anonKey) throw new Error('not configured')

  return answered(await fetch(`${baseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify(payload),
  }))
}

async function answered(response: Response): Promise<any> {
  const body = await response.json().catch(() => null)
  if (!response.ok && !body?.error) throw new Error(String(response.status))
  return body
}
