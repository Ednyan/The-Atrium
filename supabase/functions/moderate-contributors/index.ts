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

const RESEND_FROM = 'The Atrium <contributions@mail.scenefoundry.studio>'

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

    const { action, id, reason } = await req.json()

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
          .select('id, display_name, kind, name_approved, name_rejected_reason, created_at')
          .eq('livemode', true)
          .not('display_name', 'is', null)
          .order('created_at', { ascending: false })
          .limit(200)
        if (error) throw error
        return json({ entries: data ?? [] })
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

      // Rejecting writes the reason and, if there's an address and Resend is
      // configured, says so. Someone who asked to be listed and then isn't
      // deserves to know why rather than being left to notice.
      case 'reject': {
        if (!id) return json({ error: 'Missing id' }, 400)

        const { data: row, error } = await admin
          .from('contributions')
          .update({ name_approved: false, name_rejected_reason: reason || 'Not suitable for the public list' })
          .eq('id', id)
          .select('display_name, contact_email')
          .maybeSingle()
        if (error) throw error

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
                subject: 'About the name on your contribution',
                text: [
                  'Thank you for contributing to The Digital Atrium.',
                  '',
                  `You asked to be listed as "${row.display_name}", and that name can't be shown on the public contributors list.`,
                  reason ? `Reason: ${reason}` : '',
                  '',
                  'Your contribution is unaffected, and still counts toward the month. If you would like a different name shown, reply to this email and it will be changed.',
                ].filter(Boolean).join('\n'),
              }),
            })
          } catch (mailError) {
            // The decision stands whether or not the message got out. Logged
            // rather than failed: retrying the rejection would re-reject.
            console.error('[moderate-contributors] could not send the rejection email:', mailError)
          }
        }

        return json({ ok: true })
      }

      default:
        return json({ error: 'Unknown action' }, 400)
    }
  } catch (error) {
    console.error('[moderate-contributors]', error)
    return json({ error: 'Something went wrong.' }, 500)
  }
})
