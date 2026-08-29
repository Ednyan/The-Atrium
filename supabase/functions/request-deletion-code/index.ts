// Issues the code that delete-account will ask for.
//
// Split from delete-account on purpose. That function's whole job is to be the
// one place deletion can happen, and it is easier to keep that true when it has
// exactly one job. This one only ever writes a hash and sends an email; it
// cannot delete anything.
//
// The identity comes from the session JWT and the address from the database, so
// a caller can ask for a code but cannot choose whose account it is for or
// where it lands. The worst a stranger holding somebody's session achieves is
// sending that person an email telling them their account is being deleted --
// which is a warning, not an attack.

import { corsHeaders } from '../_shared/cors.ts'
import { createAdminClient } from '../_shared/supabaseAdmin.ts'
import { renderAtriumEmail } from '../_shared/atriumEmail.ts'
import {
  CODE_TTL_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  generateCode,
  hashCode,
} from '../_shared/deletionCode.ts'
import { DELETION_CODE_COPY, type DeletionCodeLanguage } from './copy.ts'

const RESEND_FROM = 'Digital Atrium <hello@mail.digitalatrium.org>'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'not_authenticated' }, 401)

    const admin = createAdminClient()
    const { data: userData, error: userError } = await admin.auth.getUser(
      authHeader.replace('Bearer ', ''),
    )
    const user = userData?.user
    if (userError || !user?.email) return json({ error: 'not_authenticated' }, 401)

    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      // Reported rather than swallowed. If the code cannot be sent, the account
      // cannot be deleted at all, and telling somebody their code is on the way
      // when no mail exists would strand them in a dialog that never accepts
      // anything.
      console.error('[request-deletion-code] RESEND_API_KEY is not configured')
      return json({ error: 'email_not_configured' }, 503)
    }

    const { data: existing } = await admin
      .from('account_deletion_codes')
      .select('created_at')
      .eq('user_id', user.id)
      .maybeSingle()

    // One code a minute. Without this, anyone holding a session could use the
    // button as a way to post mail to the account's owner over and over.
    if (existing?.created_at) {
      const age = (Date.now() - new Date(existing.created_at).getTime()) / 1000
      if (age < RESEND_COOLDOWN_SECONDS) {
        return json({ error: 'too_soon', retryAfter: Math.ceil(RESEND_COOLDOWN_SECONDS - age) }, 429)
      }
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('username, display_name, language')
      .eq('id', user.id)
      .maybeSingle()

    const code = generateCode()
    const codeHash = await hashCode(user.id, code)
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString()

    // Stored before it is sent. The other order risks a code arriving in
    // somebody's inbox that the database never heard of, which reads as the
    // system being broken at the exact moment they are trying to leave.
    //
    // The upsert replaces any previous row, so asking again invalidates the
    // code before it and resets the attempt count -- which is right: a fresh
    // code should not inherit the failed guesses of an old one, and it cannot
    // be used to reset the counter either, because getting a new one costs a
    // new email to the owner.
    const { error: writeError } = await admin
      .from('account_deletion_codes')
      .upsert({
        user_id: user.id,
        code_hash: codeHash,
        expires_at: expiresAt,
        attempts: 0,
        created_at: new Date().toISOString(),
      })
    if (writeError) {
      console.error('[request-deletion-code] could not store the code:', writeError)
      return json({ error: 'unexpected' }, 500)
    }

    const language: DeletionCodeLanguage =
      profile?.language && profile.language in DELETION_CODE_COPY
        ? (profile.language as DeletionCodeLanguage)
        : 'en'
    const copy = DELETION_CODE_COPY[language]
    const name = (profile?.display_name || profile?.username || '').trim()

    const { html, text } = renderAtriumEmail({
      heading: copy.heading,
      body: name ? `${copy.greeting(name)}\n\n${copy.body}` : copy.body,
      // Set apart from the message, and spaced so it can be read off a screen
      // in one go rather than transcribed digit by digit.
      quote: code.split('').join(' '),
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
      console.error('[request-deletion-code] Resend refused the message:', response.status, await response.text())
      // The row is cleared, so the next attempt is not blocked by the cooldown
      // on a code nobody ever received.
      await admin.from('account_deletion_codes').delete().eq('user_id', user.id)
      return json({ error: 'send_failed' }, 502)
    }

    return json({ ok: true, expiresInMinutes: CODE_TTL_MINUTES })
  } catch (error) {
    console.error('[request-deletion-code]', error)
    return json({ error: 'unexpected' }, 500)
  }
})
