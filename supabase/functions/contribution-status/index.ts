// Asks Stripe whether a checkout session was actually paid.
//
// This exists so the app can thank someone truthfully. Checkout happens in the
// system browser -- on desktop it has to, and on web it opens in a second tab
// -- so the window the donor started from never learns how it went. Stripe's
// success_url lands on the website, which is fine for a web visitor and no use
// at all to a desktop app that is still sitting on the welcome screen.
//
// So the app keeps the session id it was given and asks here, every few
// seconds, until it gets an answer. The alternative was a custom URL scheme
// bouncing the browser back into the app, which needs a registry entry, a
// second redirect, and a permission prompt some people will dismiss -- and
// still tells the app nothing about whether money changed hands.
//
// Deliberately open, like create-contribution: a session id is unguessable and
// the only thing this reveals about one is whether it completed. Nothing here
// can change anything, and what actually gets recorded is still decided by the
// webhook, which trusts Stripe's signature rather than this call.

import { corsHeaders } from '../_shared/cors.ts'

// cs_test_… and cs_live_…, and nothing else -- this value is interpolated into
// a URL path, so it is checked rather than trusted.
const SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{8,120}$/

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
    const { sessionId } = await req.json()
    if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
      return json({ error: 'Not a session id.' }, 400)
    }

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
    if (!stripeKey) {
      console.error('[contribution-status] STRIPE_SECRET_KEY is not configured')
      return json({ error: 'Contributions are not set up yet.' }, 503)
    }

    const response = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        headers: {
          Authorization: `Bearer ${stripeKey}`,
          'Stripe-Version': '2026-07-29.dahlia',
        },
      },
    )

    // A session from the other mode, or one Stripe has forgotten. Answered as
    // gone rather than as an error: the app's only sensible response to either
    // is to stop waiting.
    if (response.status === 404) return json({ status: 'expired' })

    const session = await response.json()
    if (!response.ok) {
      console.error('[contribution-status] Stripe refused:', session?.error?.message)
      return json({ error: 'Could not check the payment.' }, 502)
    }

    // 'complete' means they finished at Checkout. That is the moment worth
    // thanking someone for, and it is not quite the same as the money having
    // settled: MB WAY and other delayed methods complete first and confirm
    // minutes later. payment_status is passed through for honesty, but the app
    // treats completion as the end of its wait -- the wall is populated by the
    // webhook either way, and nobody should be left staring at a screen until
    // a bank clears.
    return json({
      status: session.status ?? 'open',
      paid: session.payment_status === 'paid' || session.payment_status === 'no_payment_required',
    })
  } catch (error) {
    console.error('[contribution-status]', error)
    return json({ error: 'Something went wrong.' }, 500)
  }
})
