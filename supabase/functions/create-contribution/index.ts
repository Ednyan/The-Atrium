// Creates a Stripe Checkout Session for a contribution and hands back its URL
// for the browser to go to.
//
// The session is built here rather than in the client, which is why the app
// never needs a Stripe key of any kind: the browser posts an amount and gets
// back a URL. It also means the amount is validated somewhere the user can't
// edit -- a price the client could set is a price anyone can set to zero.
//
// No Products or Prices exist in the dashboard. Checkout accepts an inline
// price_data per session, including a recurring block, so the amount someone
// chooses becomes the price on the spot. Pre-made tiers would only get in the
// way of "any amount, in any of the currencies offered".
//
// Deliberately open to anyone, signed in or not. Requiring an account to give
// money would lose more contributions than it protects, and there is nothing
// here worth protecting: the endpoint creates a payment page and returns a
// link, and everything that matters is decided later by the webhook, which
// trusts Stripe's signature rather than this call.

import { corsHeaders } from '../_shared/cors.ts'
import {
  BASE_CURRENCY,
  currencyByCode,
  isCurrencyCode,
  minorPerUnit,
} from '../_shared/currencies.ts'

const MAX_NAME_LENGTH = 40

// Rejected the moment it's typed, so nobody discovers their chosen name was
// refused only after paying. This is the automatic half of the check -- the
// obvious cases -- and the whole point is that it is followed by a person
// looking. It is not, and can't be, a substitute for that.
const BANNED_NAME_PATTERN = /\b(fuck|shit|cunt|nigg|f[a4]g|rape|nazi|hitler)/i
const URL_LIKE_PATTERN = /(https?:\/\/|www\.|\.(com|net|org|io|xyz)\b)/i

function nameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return null // no name is a valid choice
  if (trimmed.length > MAX_NAME_LENGTH) return `Names are limited to ${MAX_NAME_LENGTH} characters.`
  if (BANNED_NAME_PATTERN.test(trimmed)) return "That name can't be used here."
  if (URL_LIKE_PATTERN.test(trimmed)) return "Names can't contain web addresses."
  // Control characters and the bidi overrides that let text be drawn in an
  // order it isn't written in.
  if (/[\u0000-\u001F\u202A-\u202E\u2066-\u2069]/.test(trimmed)) return "That name contains characters that can't be shown."
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    const { amountCents, monthly, displayName, currency } = await req.json()

    // An unknown or missing currency is the base, not an error: an older client
    // that has not been reloaded since this shipped posts no currency at all,
    // and it was sending euros.
    const code = isCurrencyCode(currency) ? currency : BASE_CURRENCY
    const money = currencyByCode(code)
    const per = minorPerUnit(code)

    // Minor units throughout, which for a zero-decimal currency is the unit
    // itself. The limits come from the same table the client offers its presets
    // from, so the two cannot disagree about what is allowed.
    const amount = Math.round(Number(amountCents))
    if (!Number.isFinite(amount) || amount < money.min || amount > money.max) {
      return json({
        error: `Choose an amount between ${money.symbol}${money.min / per} and ${money.symbol}${money.max / per}.`,
      }, 400)
    }

    const name = typeof displayName === 'string' ? displayName.trim() : ''
    const problem = nameProblem(name)
    if (problem) return json({ error: problem }, 400)

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    const siteUrl = Deno.env.get('SITE_URL')
    if (!stripeKey || !siteUrl) {
      console.error('[create-contribution] STRIPE_SECRET_KEY or SITE_URL is not configured')
      return json({ error: 'Contributions are not set up yet.' }, 503)
    }

    // Stripe's API is form-encoded, including nested keys. Written out rather
    // than pulling in the SDK: this is one request, and the SDK is a large
    // dependency for a function that makes exactly one call.
    const form = new URLSearchParams()
    form.set('mode', monthly ? 'subscription' : 'payment')
    form.set('success_url', `${siteUrl}/#/contributed`)
    form.set('cancel_url', `${siteUrl}/#/welcome`)
    form.set('line_items[0][quantity]', '1')
    form.set('line_items[0][price_data][currency]', code.toLowerCase())
    form.set('line_items[0][price_data][unit_amount]', String(amount))
    form.set('line_items[0][price_data][product_data][name]',
      monthly ? 'Monthly contribution to The Digital Atrium' : 'Contribution to The Digital Atrium')
    if (monthly) {
      form.set('line_items[0][price_data][recurring][interval]', 'month')
    }

    // Carried on the session and echoed back on every event the webhook sees,
    // so the name travels with the payment rather than needing to be looked up
    // or trusted from a second call.
    form.set('metadata[display_name]', name)
    form.set('metadata[kind]', monthly ? 'monthly' : 'one_time')
    // Subscriptions raise invoices, and invoice.paid carries the subscription's
    // metadata rather than the session's -- so the same fields have to be set
    // in both places or every renewal after the first would arrive anonymous.
    if (monthly) {
      form.set('subscription_data[metadata][display_name]', name)
      form.set('subscription_data[metadata][kind]', 'monthly')
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // Pinned to the version the webhook endpoint was created against, so
        // both halves speak the same shapes.
        'Stripe-Version': '2026-07-29.dahlia',
      },
      body: form.toString(),
    })

    const session = await response.json()
    if (!response.ok) {
      console.error('[create-contribution] Stripe rejected the session:', session?.error?.message)
      return json({ error: 'Could not start the contribution. Please try again.' }, 502)
    }

    // The id goes back with the URL so the app can ask later whether this
    // session was paid. Checkout happens in a browser the app cannot see into
    // -- this is the thread that leads back (see contribution-status).
    return json({ url: session.url, sessionId: session.id })
  } catch (error) {
    console.error('[create-contribution]', error)
    return json({ error: 'Something went wrong.' }, 500)
  }
})
