// Approving the names contributors asked to be listed under.
//
// The check that matters is here, not in the interface. Hiding a button stops
// nobody: anyone can call this URL directly, so every request re-establishes
// who is asking from their session token and confirms they are in
// platform_admins before doing anything at all.
//
// It runs as the service role because the contributions table denies the
// client outright -- RLS is on with no policies, so even the operator cannot
// read it from a browser. That is deliberate. It also keeps contributors'
// email addresses on the server: the moderation list returns a name and an id,
// never an address, because approving a name does not require seeing who wrote
// it.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient, getAuthenticatedUserId } from '../_shared/supabaseAdmin.ts'
import { renderContributorEmail } from '../_shared/contributorEmail.ts'

// Sent from the verified domain, because that is what Resend can sign for and
// what will not be dropped: a Gmail address cannot be a sending identity here,
// and mail claiming to be from one would fail Gmail's own DMARC policy.
//
// Replies are a different question, and these messages invite them -- so they
// are pointed at the address a person actually reads. Without this, "reply to
// this email" meant replying into a domain that receives nothing.
const RESEND_FROM = 'The Atrium <contributions@mail.scenefoundry.studio>'
const RESEND_REPLY_TO = 'thedigitalatrium@gmail.com'

// The same rules create-contribution applies. An edit must not be able to put
// something on the wall that the front door would have refused.
const BANNED_NAME_PATTERN = /\b(fuck|shit|cunt|nigg|f[a4]g|rape|nazi|hitler)/i
const URL_LIKE_PATTERN = /(https?:\/\/|www\.|\.(com|net|org|io|xyz)\b)/i
const MAX_NAME_LENGTH = 40

function nameProblem(name: string): string | null {
  if (name.length === 0) return null
  if (name.length > MAX_NAME_LENGTH) return `Names are limited to ${MAX_NAME_LENGTH} characters.`
  if (BANNED_NAME_PATTERN.test(name)) return "That name can't be used here."
  if (URL_LIKE_PATTERN.test(name)) return "Names can't contain web addresses."
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
    const admin = createAdminClient()

    const userId = await getAuthenticatedUserId(req, admin)
    if (!userId) return json({ error: 'Not signed in' }, 401)

    const { data: operator } = await admin
      .from('platform_admins')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    // Same answer for "not an operator" as for "no such endpoint" would be
    // tidier, but an honest 403 is more useful to the one person who should be
    // here and tells everyone else nothing they couldn't already guess.
    if (!operator) return json({ error: 'Not allowed' }, 403)

    const { action, id, reason, refund, displayName, amountEur, createdAt, message } = await req.json()

    switch (action) {
      // Everything still waiting on a decision. Rejected names keep their
      // reason and stay in the list, so a decision can be revisited -- and so
      // the same name arriving again is recognisable.
      //
      // Live rows only. A name typed during a test payment is not a real
      // person asking to be listed, and the public views would refuse it
      // anyway -- so putting it in front of the operator only invites a
      // decision that means nothing, on a name nobody chose in earnest.
      case 'list': {
        const { data, error } = await admin
          .from('contributions')
          .select('id, display_name, kind, name_approved, name_rejected_reason, hidden, refunded, settled_eur_cents, created_at')
          .eq('livemode', true)
          .not('display_name', 'is', null)
          .order('created_at', { ascending: false })
          .limit(200)
        if (error) throw error
        return json({ entries: data ?? [] })
      }

      // Off the wall, still counted. Distinct from a rejection: this one was
      // shown and then taken down, and unhide puts it back.
      case 'hide':
      case 'unhide': {
        if (!id) return json({ error: 'Missing id' }, 400)
        const { error } = await admin
          .from('contributions')
          .update({ hidden: action === 'hide' })
          .eq('id', id)
        if (error) throw error
        return json({ ok: true })
      }

      // Gone entirely, including from the totals. The confirmation is in the
      // interface, because this is the one action here with nothing behind it
      // -- the row is the record, and Stripe's copy is not something this app
      // can read back into place.
      case 'delete': {
        if (!id) return json({ error: 'Missing id' }, 400)
        const { error } = await admin.from('contributions').delete().eq('id', id)
        if (error) throw error
        return json({ ok: true })
      }

      // Correcting what is displayed. Only the three fields the wall shows, and
      // only ones sent -- an omitted field is left alone rather than nulled.
      case 'edit': {
        if (!id) return json({ error: 'Missing id' }, 400)

        const patch: Record<string, unknown> = {}

        if (typeof displayName === 'string') {
          const trimmed = displayName.trim()
          const problem = nameProblem(trimmed)
          if (problem) return json({ error: problem }, 400)
          patch.display_name = trimmed || null
        }

        if (amountEur !== undefined && amountEur !== null) {
          const euros = Number(amountEur)
          if (!Number.isFinite(euros) || euros < 0) return json({ error: 'That amount is not a number.' }, 400)
          // Both, so the wall and the bar agree. They are separate columns
          // because one is what the donor paid and the other is what settled in
          // euros; an operator correcting a display has no way to distinguish
          // them, so the correction applies to both.
          patch.amount_cents = Math.round(euros * 100) || 1
          patch.settled_eur_cents = Math.round(euros * 100)
        }

        if (typeof createdAt === 'string' && createdAt.trim()) {
          const when = new Date(createdAt)
          if (Number.isNaN(when.getTime())) return json({ error: 'That date could not be read.' }, 400)
          patch.created_at = when.toISOString()
        }

        if (Object.keys(patch).length === 0) return json({ error: 'Nothing to change' }, 400)

        // A rename applies to the whole contributor, not to one payment.
        //
        // The wall groups by name, so a trace showing 60 euros is every row
        // carrying that name. Renaming one of them used to leave the rest
        // behind under the old name -- which did not correct the trace, it
        // split it in two and divided the money between them.
        //
        // Amount and date stay on the row they were edited on: those describe
        // one payment, and correcting one is not a statement about the others.
        let renamed = 0
        if (patch.display_name !== undefined) {
          const { data: target } = await admin
            .from('contributions')
            .select('display_name, livemode')
            .eq('id', id)
            .maybeSingle()

          const previousName = target?.display_name?.trim()
          if (previousName) {
            const { data: siblings, error: renameError } = await admin
              .from('contributions')
              .update({ display_name: patch.display_name })
              .eq('display_name', previousName)
              .eq('livemode', target?.livemode === true)
              .neq('id', id)
              .select('id')
            if (renameError) throw renameError
            renamed = siblings?.length ?? 0
          }
        }

        const { error } = await admin.from('contributions').update(patch).eq('id', id)
        if (error) throw error
        // Reported so the operator knows a rename reached the rest of the
        // contributor's history rather than only the row they clicked.
        return json({ ok: true, renamed })
      }

      case 'approve': {
        if (!id) return json({ error: 'Missing id' }, 400)
        const { error } = await admin
          .from('contributions')
          .update({ name_approved: true, name_rejected_reason: null })
          .eq('id', id)
        if (error) throw error
        return json({ ok: true })
      }

      // Writing to a contributor before deciding anything.
      //
      // The case this exists for: two people have asked for the same name, and
      // the second one needs to choose another. Rejecting them outright would
      // be the wrong answer -- they have done nothing wrong, they were simply
      // second -- so this asks the question and leaves the row waiting.
      //
      // The address is whatever Stripe recorded for the payment. That is the
      // only one there is: donating needs no account, so most rows have no user
      // behind them, and the payer's email is what both cases have in common.
      //
      // Nothing about the address comes back in the response. This function has
      // never handed contributors' email addresses to the browser and does not
      // start here: the operator needs to send a message, not to see who they
      // are sending it to.
      case 'message': {
        if (!id) return json({ error: 'Missing id' }, 400)

        const body = typeof message === 'string' ? message.trim() : ''
        if (!body) return json({ error: 'Nothing to send.' }, 400)
        if (body.length > 4000) return json({ error: 'That message is too long to send.' }, 400)

        const { data: row, error } = await admin
          .from('contributions')
          .select('display_name, contact_email')
          .eq('id', id)
          .maybeSingle()
        if (error) throw error
        if (!row) return json({ error: 'No such contribution.' }, 404)
        if (!row.contact_email) {
          return json({ error: 'Stripe recorded no address for this payment, so there is nowhere to write.' }, 400)
        }

        const resendKey = Deno.env.get('RESEND_API_KEY')
        if (!resendKey) return json({ error: 'Email is not configured on this project.' }, 503)

        // Unlike the rejection mail, a failure here is reported rather than
        // logged and swallowed. Rejecting stands whether or not the message got
        // out; a message that did not send has accomplished nothing at all, and
        // the operator needs to know that rather than believing it was sent.
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: RESEND_FROM,
            to: row.contact_email,
            reply_to: RESEND_REPLY_TO,
            subject: 'About the name on your contribution',
            ...renderContributorEmail({
              heading: 'About your name',
              body,
              footnote: [
                `You asked to be listed as "${row.display_name}". Your contribution is unaffected and still counts toward the month.`,
                `Reply to this email and it reaches ${RESEND_REPLY_TO}.`,
              ].join('\n'),
            }),
          }),
        })

        if (!response.ok) {
          console.error('[moderate-contributors] Resend refused the message:', response.status, await response.text())
          return json({ error: 'The message could not be sent.' }, 502)
        }

        return json({ ok: true })
      }

      // Rejecting writes the reason and, if there's an address and Resend is
      // configured, says so. Someone who asked to be listed and then isn't
      // deserves to know why rather than being left to notice.
      case 'reject': {
        if (!id) return json({ error: 'Missing id' }, 400)

        const { data: row, error } = await admin
          .from('contributions')
          .update({ name_approved: false, name_rejected_reason: reason || 'Not suitable for the public list' })
          .eq('id', id)
          .select('display_name, contact_email, stripe_payment_id, refunded')
          .maybeSingle()
        if (error) throw error

        // Refunding from here rather than the dashboard, when asked. A name
        // that can't be published is sometimes a contribution nobody wants to
        // keep, and making that a two-system errand is how it gets forgotten.
        let refunded = false
        let refundError = ''
        if (refund && row?.stripe_payment_id && !row.refunded) {
          const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
          if (!stripeKey) {
            refundError = 'Stripe is not configured on this project.'
          } else {
            try {
              const form = new URLSearchParams()
              form.set('payment_intent', row.stripe_payment_id)
              const response = await fetch('https://api.stripe.com/v1/refunds', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${stripeKey}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: form.toString(),
              })
              const result = await response.json()
              if (!response.ok) throw new Error(result?.error?.message ?? 'refund refused')
              refunded = true
              // Marked here as well as by the webhook. The webhook is what
              // makes a dashboard refund count, but waiting for it would leave
              // the operator looking at a row that still says it was paid.
              await admin.from('contributions').update({ refunded: true }).eq('id', id)
            } catch (error: any) {
              refundError = error?.message ?? 'The refund could not be made.'
              console.error('[moderate-contributors] refund failed:', error)
            }
          }
        }

        const resendKey = Deno.env.get('RESEND_API_KEY')
        if (resendKey && row?.contact_email) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: RESEND_FROM,
                to: row.contact_email,
                reply_to: RESEND_REPLY_TO,
                subject: 'About the name on your contribution',
                ...renderContributorEmail({
                  heading: 'About your name',
                  body: [
                    'Thank you for contributing to The Digital Atrium.',
                    '',
                    `You asked to be listed as "${row.display_name}", and that name can't be shown on the public contributors list.`,
                  ].join('\n'),
                  quote: reason || undefined,
                  footnote: [
                    'Your contribution is unaffected, and still counts toward the month.',
                    `If you would like a different name shown, reply to this email and it will be changed.`,
                  ].join('\n'),
                }),
              }),
            })
          } catch (mailError) {
            // The decision stands whether or not the message got out. Logged
            // rather than failed: retrying the rejection would re-reject.
            console.error('[moderate-contributors] could not send the rejection email:', mailError)
          }
        }

        return json({ ok: true, refunded, refundError })
      }

      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (error) {
    console.error('[moderate-contributors]', error)
    return json({ error: 'Something went wrong.' }, 500)
  }
})
