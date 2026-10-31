// Would people buy the paid plan? The Pricing section asks, and Health counts the
// answers (src/ops.ts): those with an account and guests apart. One answer per
// account, or per browser for a guest, changeable. Who answered isn't kept: only
// a hash of it, enough to count each once.

import { allowedNow, tablesIn } from './people'
import { replies, whoIs, type Env } from './who'

// From one network, an hour: past any honest change of mind.
const FROM_A_NETWORK = 20
const GUEST = /^[\w-]{16,64}$/

export async function interest(request: Request, env: Env): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  if (!env.PEOPLE) return answer(503, { error: 'not set up' })
  const db = env.PEOPLE
  await tablesIn(db)
  if (!(await allowedNow(db, `interest:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, FROM_A_NETWORK))) return answer(429, { error: 'Too many answers just now.' })
  let asked: Record<string, unknown>
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  if (asked.answer !== 'yes' && asked.answer !== 'no') return answer(400, { error: 'answer' })
  const who = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!who && !(typeof asked.guest === 'string' && GUEST.test(asked.guest))) return answer(400, { error: 'guest' })
  const kind = who ? 'account' : 'guest'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}:${who ? who.id : asked.guest}`))
  const voter = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  await db.prepare('insert into plan_interest (voter, kind, answer, at) values (?, ?, ?, ?) on conflict (voter) do update set answer = excluded.answer, at = excluded.at')
    .bind(voter, kind, asked.answer, Date.now()).run()
  return answer(200, { ok: true })
}
