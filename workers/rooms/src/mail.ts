// Mail from the Atrium, through Resend (its key a secret here, RESEND_API_KEY):
// the report form's, to support, for either kind of account; and a Google
// account's welcome, as it chooses its username (src/people.ts) -- an
// existing account's comes from Supabase (supabase/functions/send-welcome).
// The card and the welcome's words are the Supabase functions' own files,
// the same ones, not copies.

import { renderAtriumEmail } from '../../../supabase/functions/_shared/atriumEmail'
import { WELCOME_COPY, type WelcomeLanguage } from '../../../supabase/functions/send-welcome/copy'
import { emailOf } from './people'
import { outbound, replies, whoIs, type Env } from './who'

const SUPPORT = 'thedigitalatrium@gmail.com'
const FROM_FEEDBACK = 'Digital Atrium <feedback@mail.digitalatrium.org>'
const FROM_HELLO = 'Digital Atrium <hello@mail.digitalatrium.org>'
const SITE = 'https://digitalatrium.org'

interface Mail { from: string; to: string; reply_to?: string; subject: string; html: string; text: string }
async function send(env: Env, mail: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false
  const response = await fetch(outbound(env, 'https://api.resend.com/emails'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mail),
  })
  if (!response.ok) console.error('[mail] Resend refused it:', response.status, await response.text())
  return response.ok
}

/** The report form's, to support. Open to anyone, as the form is; replies go
 *  to the sender's own address only when it's one known to be theirs (a
 *  confirmed or Google-verified address), never one they give. */
export async function feedback(request: Request, env: Env): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  if (!env.RESEND_API_KEY) return answer(503, { error: 'not set up' })
  let asked: Record<string, unknown>
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  const text = (key: string, most: number) => (typeof asked[key] === 'string' ? (asked[key] as string).trim().slice(0, most) : '')
  const description = text('description', 5000)
  if (!description) return answer(400, { error: 'Description is required' })
  const who = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  const replyTo = who ? await emailOf(env, who) : null
  const motive = asked.motive === 'feature' ? 'Feature Suggestion' : asked.motive === 'other' ? 'Other' : 'Bug Report'
  const subject = text('subject', 200)
  // The same card the rest of the mail uses: a report that arrives looking
  // like the product reads at a glance, with its details set apart.
  const { html, text: plain } = renderAtriumEmail({
    heading: motive,
    body: description,
    quote: [`User: ${text('username', 80) || 'Unknown'}`, `Atrium: ${text('atriumName', 200) || 'Unknown'}`, `Platform: ${text('platform', 80) || 'Unknown'}`].join('\n'),
    footer: 'Sent from the report form inside The Digital Atrium.',
  })
  const sent = await send(env, { from: FROM_FEEDBACK, to: SUPPORT, ...(replyTo ? { reply_to: replyTo } : {}), subject: subject ? `${motive} - ${subject}` : motive, html, text: plain })
  return sent ? answer(200, { success: true }) : answer(502, { error: 'Failed to send email' })
}

/** A Google account's welcome, in the language its page shows (English if
 *  that's not one there's copy for). Never in the way: a failure is logged. */
export async function welcome(env: Env, to: string, name: string, language: unknown): Promise<void> {
  const copy = WELCOME_COPY[(typeof language === 'string' && language in WELCOME_COPY ? language : 'en') as WelcomeLanguage]
  const { html, text } = renderAtriumEmail({
    heading: copy.heading,
    body: name ? `${copy.greeting(name)}\n\n${copy.body}` : copy.body,
    action: { label: copy.action, href: SITE },
    footnote: copy.footnote,
    footer: copy.footer,
  })
  await send(env, { from: FROM_HELLO, to, subject: copy.subject, html, text }).catch(error => console.error('[mail] the welcome:', error))
}
