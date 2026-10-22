// Mail from the Atrium, through Resend (its key a secret here, RESEND_API_KEY):
// the report form's, to support, for either kind of account; and a Google
// account's welcome, as it chooses its username (src/people.ts), and its
// goodbye, once it's deleted (src/google.ts) -- an existing account's come
// from Supabase (supabase/functions/send-welcome, delete-account); and the
// operator's to a contributor (src/contributions.ts). The card
// and the words are the Supabase functions' own files, the same ones, not
// copies.

import { renderAtriumEmail, renderContributorEmail, type ContributorEmail } from '../../../supabase/functions/_shared/atriumEmail'
import { GOODBYE_COPY } from '../../../supabase/functions/_shared/goodbyeCopy'
import { WELCOME_COPY } from '../../../supabase/functions/send-welcome/copy'
import { CONFIRM_COPY, RESET_COPY } from './authCopy'
import { allowedNow, emailOf, keep, tablesIn } from './people'
import { outbound, replies, whoIs, type Env } from './who'

const SUPPORT = 'thedigitalatrium@gmail.com'
// The report form's mail, at most: from one network, and from everyone, an hour.
const FEEDBACK_AN_HOUR = 5
const FEEDBACK_ALL_AN_HOUR = 30
const FROM_FEEDBACK = 'Digital Atrium <feedback@mail.digitalatrium.org>'
const FROM_HELLO = 'Digital Atrium <hello@mail.digitalatrium.org>'
const FROM_CONTRIBUTIONS = 'Digital Atrium <contributions@mail.digitalatrium.org>'
export const SITE = 'https://digitalatrium.org'

interface Mail { from: string; to: string; reply_to?: string; subject: string; html: string; text: string }
async function send(env: Env, mail: Mail): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false
  const response = await fetch(outbound(env, 'https://api.resend.com/emails'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mail),
  })
  if (!response.ok) console.error('[mail] Resend refused it:', response.status, await response.text())
  await keepCounts(env, response.headers)
  return response.ok
}

// Resend's count of the mail sent -- today's, this month's -- comes with each
// email: a key that may only send can't ask for it otherwise. Kept for the
// operator's Health (src/ops.ts), with when it was had.
export const MAIL_COUNTS = 'resend.counts'
async function keepCounts(env: Env, headers: Headers): Promise<void> {
  const count = (name: string) => (headers.get(name) === null ? null : Number(headers.get(name)))
  const daily = count('x-resend-daily-quota'), monthly = count('x-resend-monthly-quota')
  if (!env.PEOPLE || (daily === null && monthly === null)) return
  await keep(env.PEOPLE, MAIL_COUNTS, JSON.stringify({ daily, monthly, at: Date.now() })).run().catch(error => console.error('[mail] its counts:', error))
}

/** The report form's, to support. Open to anyone, as the form is; replies go
 *  to the sender's own address only when it's one known to be theirs (a
 *  confirmed or Google-verified address), never one they give. */
export async function feedback(request: Request, env: Env): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  if (!env.RESEND_API_KEY) return answer(503, { error: 'not set up' })
  // So many an hour from a network, and from everyone: a script mustn't spend
  // the day's mail, which sign-up and reset codes need.
  if (env.PEOPLE) {
    await tablesIn(env.PEOPLE)
    const from = request.headers.get('CF-Connecting-IP') ?? 'local'
    if (!(await allowedNow(env.PEOPLE, `feedback:${from}`, FEEDBACK_AN_HOUR)) || !(await allowedNow(env.PEOPLE, 'feedback:all', FEEDBACK_ALL_AN_HOUR))) return answer(429, { error: 'Too many reports just now. Try again in a while.' })
  }
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

/** A Google account's welcome, and its goodbye: in the language its page
 *  shows (English if there's no copy in it). Never in the way: a failure is
 *  logged. */
export const welcome = (env: Env, to: string, name: string, language: unknown) => greet(env, to, name, WELCOME_COPY, language)
export const goodbye = (env: Env, to: string, name: string, language: unknown) => greet(env, to, name, GOODBYE_COPY, language)

/** An email account's code (src/auth.ts): confirming its address, or a
 *  forgotten password -- in the language its page shows. Never in the way:
 *  a failure is logged, and another code can be asked for. */
export async function authCode(env: Env, to: string, purpose: 'confirm' | 'reset', code: string, language: unknown): Promise<void> {
  const copies = purpose === 'confirm' ? CONFIRM_COPY : RESET_COPY
  const copy = copies[typeof language === 'string' && language in copies ? language : 'en']
  const { html, text } = renderAtriumEmail({ heading: copy.heading, body: copy.body, quote: code, footnote: copy.footnote, footer: copy.footer })
  await send(env, { from: FROM_HELLO, to, subject: copy.subject(code), html, text }).catch(error => console.error('[mail] a code:', error))
}

interface Greeting { subject: string; heading: string; greeting: (name: string) => string; body: string; action: string; footnote: string; footer: string }
async function greet(env: Env, to: string, name: string, copies: Record<string, Greeting>, language: unknown): Promise<void> {
  const copy = copies[typeof language === 'string' && language in copies ? language : 'en']
  const { html, text } = renderAtriumEmail({
    heading: copy.heading,
    body: name ? `${copy.greeting(name)}\n\n${copy.body}` : copy.body,
    action: { label: copy.action, href: SITE },
    footnote: copy.footnote,
    footer: copy.footer,
  })
  await send(env, { from: FROM_HELLO, to, subject: copy.subject, html, text }).catch(error => console.error(`[mail] ${copy.subject}:`, error))
}

/** To someone who contributed (src/contributions.ts), from the operator:
 *  replies reach support. Whether it went. */
export function toContributor(env: Env, to: string, subject: string, card: ContributorEmail): Promise<boolean> {
  return send(env, { from: FROM_CONTRIBUTIONS, to, reply_to: SUPPORT, subject, ...renderContributorEmail(card) })
    .catch(error => { console.error(`[mail] ${subject}:`, error); return false })
}
