// Records contributions from Stripe, and nothing else writes to that table.
//
// Two rules shape everything here.
//
// First: trust the signature, not the request. Anyone can post JSON to this
// URL. The only thing separating a real payment from an invented one is
// Stripe's signature over the raw body, so it is verified before the body is so
// much as parsed -- and the raw text, not a re-serialised object, is what gets
// verified. Re-encoding JSON changes bytes and breaks the comparison.
//
// Second: a completed checkout is not money. Multibanco, bank transfers and
// vouchers hand the payer a reference and settle hours or days later, or never.
// Those sessions complete with payment_status "unpaid", and counting them would
// put money on the progress bar that may never arrive. So a row is written when
// a payment is paid, whenever that turns out to be.

import { createAdminClient } from '../_shared/supabaseAdmin.ts'

const STRIPE_API = 'https://api.stripe.com/v1'
const STRIPE_VERSION = '2026-07-29.dahlia'
const SIGNATURE_TOLERANCE_SECONDS = 300

// Stripe signs "timestamp.body" with the endpoint secret. Rebuilt and compared
// here rather than with the SDK, which wants Node crypto that Deno handles
// awkwardly -- and this is twenty lines that can be read and checked.
async function signatureIsValid(rawBody: string, header: string, secret: string): Promise<boolean> {
  const parts: Record<string, string> = {}
  for (const piece of header.split(',')) {
    const index = piece.indexOf('=')
    if (index > 0) parts[piece.slice(0, index).trim()] = piece.slice(index + 1).trim()
  }

  const timestamp = parts['t']
  const signature = parts['v1']
  if (!timestamp || !signature) return false

  // Replay window. Without it a captured request stays valid forever.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + '.' + rawBody))
  const expected = Array.from(new Uint8Array(mac))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')

  // Constant time: a comparison that returns early leaks the correct prefix one
  // byte at a time to anyone willing to measure.
  if (expected.length !== signature.length) return false
  let difference = 0
  for (let i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return difference === 0
}

async function stripeGet(path: string, key: string): Promise<any> {
  const response = await fetch(STRIPE_API + '/' + path, {
    headers: { Authorization: 'Bearer ' + key, 'Stripe-Version': STRIPE_VERSION },
  })
  if (!response.ok) throw new Error('Stripe GET ' + path + ' returned ' + response.status)
  return response.json()
}

// What the payment actually settled as, in the account's own currency.
//
// The charge says what the donor paid -- 20 USD stays 20 USD -- while the
// balance transaction says what landed after conversion. The monthly goal is in
// euros, so it has to count the second. Asking Stripe rather than converting
// here means no exchange rate is ever guessed.
async function settledEurCents(paymentIntentId: string, key: string): Promise<number | null> {
  try {
    const intent = await stripeGet('payment_intents/' + paymentIntentId + '?expand[]=latest_charge', key)
    const charge = intent?.latest_charge
    const balanceTransactionId = typeof charge?.balance_transaction === 'string'
      ? charge.balance_transaction
      : charge?.balance_transaction?.id
    if (!balanceTransactionId) return null

    const balanceTransaction = await stripeGet('balance_transactions/' + balanceTransactionId, key)

    // Not in euros, which means this account did not convert the payment: it
    // holds a balance in the currency it was paid in. There is no euro figure
    // to record, and inventing one from a rate looked up now is exactly what
    // this function exists to avoid.
    //
    // The caller stores 0, and 0 is invisible -- it counts nothing toward the
    // monthly goal and shows the contributor as having given nothing. So it is
    // said loudly here, because the alternative is a contribution that quietly
    // does not exist. If this appears, the fix is on the Stripe account: settle
    // these currencies into the euro balance rather than holding them.
    if (balanceTransaction?.currency !== 'eur') {
      console.error(
        '[stripe-webhook] payment settled in ' + balanceTransaction?.currency +
        ', not eur -- recording 0 euros for balance transaction ' + balanceTransactionId +
        '. This contribution will not count toward the monthly goal.',
      )
      return null
    }
    // `amount`, not `net`: the processing fee is the cost of collecting the
    // money, not something the contributor didn't give.
    return Number(balanceTransaction.amount) || null
  } catch (error) {
    console.error('[stripe-webhook] could not resolve the settled amount:', error)
    return null
  }
}

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secret || !stripeKey) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY is not configured')
    return new Response('not configured', { status: 503 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''
  if (!(await signatureIsValid(rawBody, signature, secret))) {
    return new Response('bad signature', { status: 400 })
  }

  const event = JSON.parse(rawBody)
  const admin = createAdminClient()

  // Anything deliberately ignored still answers 200. A non-2xx tells Stripe to
  // retry, and retrying an event this endpoint has decided to skip just repeats
  // the same decision every few minutes for days.
  const ok = () => new Response('ok', { status: 200 })

  try {
    switch (event.type) {
      // A card, wallet or PayPal payment is paid the moment it completes. A
      // delayed method completes here as "unpaid" and is left alone on purpose
      // -- it comes back later as async_payment_succeeded.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object
        if (session.payment_status !== 'paid') return ok()
        // Subscriptions are recorded from invoice.paid instead, so the first
        // month isn't counted twice -- once here and once by its own invoice.
        if (session.mode === 'subscription') return ok()

        const settled = session.payment_intent
          ? await settledEurCents(session.payment_intent, stripeKey)
          : null

        const { error } = await admin.from('contributions').insert({
          amount_cents: session.amount_total,
          currency: session.currency ?? 'eur',
          settled_eur_cents: settled ?? (session.currency === 'eur' ? session.amount_total : 0),
          kind: 'one_time',
          display_name: session.metadata?.display_name?.trim() || null,
          contact_email: session.customer_details?.email ?? null,
          stripe_event_id: event.id,
          stripe_payment_id: session.payment_intent ?? session.id,
          // Stripe says so on every event. The public views count only live
          // rows, so test payments and the sample event from the webhook page
          // land here without putting money on the bar that nobody gave.
          livemode: event.livemode === true,
        })
        if (error) throw error
        return ok()
      }

      // Every month of a subscription, including the first. This is what makes a
      // monthly supporter count toward each month's bar rather than only the
      // month they signed up in.
      case 'invoice.paid': {
        const invoice = event.data.object

        // Stripe restructured the Invoice object, and the fields this used to
        // read are simply absent now: subscription and its metadata moved under
        // `parent`, and payment_intent left the payload entirely. Reading the
        // old shape meant this bailed on the first line, answered 200, and
        // recorded nothing -- a subscription that looked delivered and wasn't.
        //
        // Both shapes are accepted rather than only the new one. The endpoint is
        // pinned to an API version, but events can arrive from an older pin
        // after a rotation, and being wrong here is silent.
        const subscriptionDetails = invoice.parent?.subscription_details
          ?? invoice.subscription_details
        const subscriptionId = subscriptionDetails?.subscription ?? invoice.subscription
        if (!subscriptionId) return ok()
        if (Number(invoice.amount_paid) <= 0) return ok()

        // The payment moved too, into a list that isn't expanded in the event,
        // so it has to be fetched. Falls back to the invoice's own currency and
        // amount if it can't be resolved, which is exact for euro invoices --
        // the common case -- and only approximate for the rest.
        let paymentIntentId: string | null = invoice.payment_intent ?? null
        if (!paymentIntentId) {
          try {
            const expanded = await stripeGet('invoices/' + invoice.id + '?expand[]=payments', stripeKey)
            paymentIntentId = expanded?.payments?.data?.[0]?.payment?.payment_intent ?? null
          } catch (error) {
            console.error('[stripe-webhook] could not expand the invoice payments:', error)
          }
        }

        const settled = paymentIntentId
          ? await settledEurCents(paymentIntentId, stripeKey)
          : null

        // The invoice carries the subscription's metadata rather than the
        // original checkout session's, which is why the same fields are set in
        // both places when the session is created.
        const metadata = subscriptionDetails?.metadata ?? {}

        // What this subscription looked like last month.
        //
        // A renewal is the same person under the same name, already judged.
        // Reading the name from the subscription's metadata instead meant two
        // things went wrong: the operator was asked to approve the same person
        // twelve times a year, and a name they had corrected reverted on the
        // next invoice -- splitting one contributor into two traces, because
        // the wall groups by name.
        //
        // So the previous row decides. The database is the record; Stripe's
        // metadata is only what the name was at checkout.
        const { data: previous } = await admin
          .from('contributions')
          .select('display_name, name_approved, name_rejected_reason')
          .eq('stripe_subscription_id', subscriptionId)
          .eq('livemode', event.livemode === true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        const metadataName = typeof metadata.display_name === 'string'
          ? metadata.display_name.trim() || null
          : null

        const row = {
          amount_cents: invoice.amount_paid,
          currency: invoice.currency ?? 'eur',
          settled_eur_cents: settled ?? (invoice.currency === 'eur' ? invoice.amount_paid : 0),
          kind: 'monthly',
          // Inherited when there is something to inherit -- which is every
          // renewal. The first payment of a subscription finds nothing and
          // falls back to the metadata, unapproved, exactly as before.
          display_name: previous ? previous.display_name : metadataName,
          name_approved: previous ? previous.name_approved === true : false,
          name_rejected_reason: previous ? previous.name_rejected_reason : null,
          contact_email: invoice.customer_email ?? null,
          stripe_event_id: event.id,
          stripe_payment_id: paymentIntentId ?? invoice.id,
          stripe_subscription_id: subscriptionId,
          livemode: event.livemode === true,
        }

        const { error } = await admin.from('contributions').insert(row)

        // The column is added by its own migration, and a function deploys the
        // moment it is pushed. If a renewal lands in between, refusing the
        // insert would lose a payment over a column that only makes moderation
        // tidier -- so it is written without it and the money is recorded.
        // Harmless once the migration has run; this branch stops being reached.
        if (error && /stripe_subscription_id/.test(error.message ?? '')) {
          console.error('[stripe-webhook] stripe_subscription_id column missing; recording without it')
          const { stripe_subscription_id: _omitted, ...withoutColumn } = row
          const { error: retryError } = await admin.from('contributions').insert(withoutColumn)
          if (retryError) throw retryError
          return ok()
        }

        if (error) throw error
        return ok()
      }

      // Marked rather than deleted, so the history stays honest while the
      // totals and the public list stop counting it.
      case 'charge.refunded': {
        const charge = event.data.object
        const paymentId = charge.payment_intent ?? charge.id
        if (paymentId) {
          await admin.from('contributions').update({ refunded: true }).eq('stripe_payment_id', paymentId)
        }
        return ok()
      }

      default:
        return ok()
    }
  } catch (error: any) {
    // A duplicate is the expected outcome of Stripe redelivering an event,
    // which it does by design. The unique constraint on stripe_event_id is what
    // makes that safe, and reaching it means the work was already done.
    const message = String(error?.message ?? '')
    if (error?.code === '23505' || /duplicate key/i.test(message)) return ok()

    console.error('[stripe-webhook]', event?.type, error)
    // A genuine failure answers non-2xx so Stripe retries and the payment isn't
    // quietly lost.
    return new Response('error', { status: 500 })
  }
})
