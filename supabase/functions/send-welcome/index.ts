// Greets somebody the first time they arrive with a confirmed account.
//
// Called by the app after a successful sign-in, not by a trigger on
// auth.users -- see the note in add_welcome_email.sql for why. The caller
// supplies nothing that matters: the user is taken from the session JWT, and
// everything else is read from the database. A client can ask for the welcome
// to be considered; it cannot say who it is for or what address it goes to.
//
// Sending twice is the failure this guards hardest against. profiles.
// welcome_email_sent_at is checked before sending and stamped after, and the
// stamp is written even if Resend fails -- a missing welcome is a small loss,
// two welcomes is the kind of thing people notice and mention.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { renderAtriumEmail } from '../_shared/atriumEmail.ts'
import { WELCOME_COPY, type WelcomeLanguage } from './copy.ts'

const RESEND_FROM = 'The Atrium <hello@mail.digitalatrium.org>'
const SITE = 'https://digitalatrium.org'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Not authenticated' }, 401)

    const admin = createAdminClient()
    const { data: userData, error: userError } = await admin.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )
    const user = userData?.user
    if (userError || !user) return json({ error: 'Not authenticated' }, 401)

    // Unconfirmed accounts are not welcomed. An email sign-up reaches this
    // function only after the link is clicked; a Google sign-in is confirmed
    // from the start.
    if (!user.email_confirmed_at || !user.email) return json({ sent: false, reason: 'unconfirmed' })

    const { data: profile } = await admin
      .from('profiles')
      .select('username, display_name, welcome_email_sent_at')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile) return json({ sent: false, reason: 'no-profile' })
    if (profile.welcome_email_sent_at) return json({ sent: false, reason: 'already-sent' })

    // Claimed before the send, not after. Two tabs opening at once would
    // otherwise both read null and both send.
    const { error: claimError } = await admin
      .from('profiles')
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('id', user.id)
      .is('welcome_email_sent_at', null)
    if (claimError) return json({ sent: false, reason: 'claim-failed' })

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) return json({ sent: false, reason: 'email-not-configured' })

    // The language the app is showing, when it is one this mail speaks.
    // Anything else, including nothing at all, reads better in English than in
    // a language guessed from an IP address.
    let language: WelcomeLanguage = 'en'
    try {
      const body = await req.json()
      const asked = typeof body?.language === 'string' ? body.language : ''
      if (asked in WELCOME_COPY) language = asked as WelcomeLanguage
    } catch {
      // No body, or not JSON. English.
    }

    const copy = WELCOME_COPY[language]
    const name = (profile.display_name || profile.username || '').trim()

    const { html, text } = renderAtriumEmail({
      heading: copy.heading,
      body: name ? `${copy.greeting(name)}\n\n${copy.body}` : copy.body,
      action: { label: copy.action, href: SITE },
      footnote: copy.footnote,
      footer: copy.footer,
    })

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: user.email,
        subject: copy.subject,
        html,
        text,
      }),
    })

    if (!response.ok) {
      // The stamp stays. Retrying on the next load would send to somebody who
      // may well have received the first attempt anyway, and a duplicate is
      // worse than a miss.
      console.error('[send-welcome] Resend refused the message:', response.status, await response.text())
      return json({ sent: false, reason: 'send-failed' })
    }

    return json({ sent: true })
  } catch (error) {
    console.error('[send-welcome]', error)
    return json({ error: 'Unexpected error' }, 500)
  }
})
