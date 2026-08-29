// Greets somebody the first time they arrive with a confirmed account.
//
// Called by the app after a successful sign-in, not by a trigger on
// auth.users -- see the note in add_welcome_email.sql for why. The identity is
// taken from the session JWT and the address from the database, so a client can
// ask for the welcome to be considered but cannot say who it is for or where it
// goes. The one thing it does supply is which language it is showing, which is
// checked against the copy this function has and is worth nothing to an
// attacker: the most a forged value achieves is a welcome in the wrong
// language, sent to the forger's own address.
//
// That language is also recorded on the profile the first time it is seen, so
// mail sent later -- with no browser attached to ask -- still knows. See
// add_profile_language.sql.
//
// Sending twice is the failure this guards hardest against, on three counts:
// profiles.welcome_email_sent_at is claimed before the send rather than after,
// so two tabs cannot both win; the address is checked as well as the account,
// so a second account row for the same person is not a second greeting; and
// the stamp is written even when Resend refuses. A missing welcome is a small
// loss, two welcomes is the kind of thing people notice and mention.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { renderAtriumEmail } from '../_shared/atriumEmail.ts'
import { WELCOME_COPY, type WelcomeLanguage } from './copy.ts'

const RESEND_FROM = 'Digital Atrium <hello@mail.digitalatrium.org>'
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
      .select('username, display_name, language, welcome_email_sent_at')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile) return json({ sent: false, reason: 'no-profile' })

    // The language the app is showing, when it is one this mail speaks.
    // Anything else, including nothing at all, reads better in English than in
    // a language guessed from an IP address -- that is a guess about a country,
    // and country is not language.
    let asked = ''
    try {
      const body = await req.json()
      if (typeof body?.language === 'string') asked = body.language
    } catch {
      // No body, or not JSON.
    }

    // Recorded once, on the first arrival we ever see, and never overwritten.
    //
    // This runs before the already-sent checks below on purpose: accounts that
    // were welcomed before this column existed still come through here on every
    // sign-in, and this is the only chance to learn what they read. Doing it
    // after the early returns would leave every existing account English
    // forever.
    if (!profile.language && asked in WELCOME_COPY) {
      await admin
        .from('profiles')
        .update({ language: asked })
        .eq('id', user.id)
        .is('language', null)
    }

    // What the profile remembers wins over what this request claims. For the
    // welcome they are the same thing; for everything sent later there is no
    // request to ask, which is the reason the column exists.
    const language: WelcomeLanguage =
      profile.language && profile.language in WELCOME_COPY
        ? (profile.language as WelcomeLanguage)
        : asked in WELCOME_COPY
          ? (asked as WelcomeLanguage)
          : 'en'

    if (profile.welcome_email_sent_at) return json({ sent: false, reason: 'already-sent' })

    // One welcome per address, not merely per account row.
    //
    // Somebody who registers with a password and later signs in with Google
    // normally stays one account: Auth links an OAuth identity to an existing
    // user when the provider has verified the same address, and that lands on
    // the profile checked just above. "Normally" is carrying real weight in
    // that sentence. It is a property of how Auth is configured -- something
    // no file in this repo can see or promise -- and it does not hold when the
    // older account was never confirmed, which leaves a second row behind.
    //
    // So the address is checked too. What a person remembers is being written
    // to twice, not how many rows we kept.
    const { data: greetedAlready } = await admin
      .from('profiles')
      .select('id')
      .eq('email', user.email.toLowerCase())
      .not('welcome_email_sent_at', 'is', null)
      .limit(1)

    if (greetedAlready && greetedAlready.length > 0) {
      // Stamped here as well, so this is settled once instead of re-asked on
      // every sign-in for the rest of the account's life.
      await admin
        .from('profiles')
        .update({ welcome_email_sent_at: new Date().toISOString() })
        .eq('id', user.id)
      return json({ sent: false, reason: 'already-sent-to-address' })
    }

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
