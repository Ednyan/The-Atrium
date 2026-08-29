// Sends a "report a problem / suggest a feature" submission from the
// in-app form directly to support, via Resend -- so the user never has to
// leave the page to open their own mail client (the fallback LobbyScene
// still uses if this call fails or isn't available, e.g. on desktop, which
// has no real Supabase Functions endpoint -- see src/lib/feedback.ts).
//
// Requires the RESEND_API_KEY secret to be set on this project
// (`supabase secrets set RESEND_API_KEY=...`) with a key from
// https://resend.com. The "from" address uses mail.digitalatrium.org, a
// domain verified in Resend, rather than Resend's shared onboarding@resend.dev
// sandbox address. reply_to is set to the caller's own verified email (from
// their session JWT, not a client-supplied field) so replying in a normal
// mail client goes straight back to them.
//
// Note that Supabase Auth's own SMTP sender -- the address on
// account-confirmation and password-reset mail -- is configured in the
// Supabase dashboard, not here, and has to be moved separately. It used to
// share mail.scenefoundry.studio with this function, so retiring that domain
// in Resend without changing the dashboard setting would break sign-up.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { renderAtriumEmail } from '../_shared/atriumEmail.ts'

const SUPPORT_EMAIL = 'thedigitalatrium@gmail.com'
const RESEND_FROM = 'The Atrium <feedback@mail.digitalatrium.org>'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { motive, subject: userSubject, description, username, atriumName, platform } = await req.json()

    if (!description || typeof description !== 'string' || !description.trim()) {
      return new Response(JSON.stringify({ error: 'Description is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('[send-feedback] RESEND_API_KEY is not configured')
      return new Response(JSON.stringify({ error: 'Email service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // reply_to comes from the caller's own session, not the client-supplied
    // username -- the username is just a display label in the email body
    // (no harm if someone lies about it), but the address replies actually
    // go to is worth deriving from a verified source.
    let replyTo: string | undefined
    const authHeader = req.headers.get('Authorization') ?? ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (jwt) {
      const admin = createAdminClient()
      const { data } = await admin.auth.getUser(jwt)
      replyTo = data?.user?.email ?? undefined
    }

    const motiveLabel = motive === 'feature' ? 'Feature Suggestion' : motive === 'other' ? 'Other' : 'Bug Report'
    const trimmedUserSubject = typeof userSubject === 'string' ? userSubject.trim() : ''
    const subject = trimmedUserSubject ? `${motiveLabel} - ${trimmedUserSubject}` : motiveLabel
    // The same card the rest of the mail uses. This one goes to support
    // rather than to a user, but a report that arrives looking like the
    // product is easier to read at a glance than a wall of plain text -- and
    // the details belong set apart from what the person actually wrote.
    const { html, text } = renderAtriumEmail({
      heading: motiveLabel,
      body: String(description).trim(),
      quote: [
        `User: ${username || 'Unknown'}`,
        `Atrium: ${atriumName || 'Unknown'}`,
        `Platform: ${platform || 'Unknown'}`,
      ].join('\n'),
      footer: 'Sent from the report form inside The Digital Atrium.',
    })

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: SUPPORT_EMAIL,
        reply_to: replyTo,
        subject,
        html,
        text,
      }),
    })

    if (!resendRes.ok) {
      const errText = await resendRes.text()
      console.error('[send-feedback] Resend API error:', resendRes.status, errText)
      return new Response(JSON.stringify({ error: 'Failed to send email' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[send-feedback] unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
