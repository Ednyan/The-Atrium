// The report form's reports and suggestions: kept in the database, not mailed,
// so they spend none of the day's mail that sign-up and reset codes need. A
// report is one request and a row or two. The operator reads them in
// Developers (src/components/FeedbackTool.tsx), only when opening it.

import { allowedNow, emailOf, isOperator, tablesIn } from './people'
import { replies, whoIs, type Env } from './who'

// At most: from one network, and from everyone, an hour. A script mustn't fill
// the database.
const FROM_A_NETWORK = 5
const FROM_EVERYONE = 30
const LISTED = 200

/** The form's, open to anyone as the form is ('' ), and the operator's: `list`,
 *  `handled`, `delete`. The sender's address is kept only when it's one known
 *  to be theirs (a confirmed or Google-verified address), never one they give. */
export async function feedback(request: Request, env: Env, what: string): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  if (!env.PEOPLE) return answer(503, { error: 'not set up' })
  const db = env.PEOPLE
  await tablesIn(db)
  if (!what) {
    const from = request.headers.get('CF-Connecting-IP') ?? 'local'
    if (!(await allowedNow(db, `feedback:${from}`, FROM_A_NETWORK)) || !(await allowedNow(db, 'feedback:all', FROM_EVERYONE))) return answer(429, { error: 'Too many reports just now. Try again in a while.' })
  }
  let asked: Record<string, unknown>
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  const text = (key: string, most: number) => (typeof asked[key] === 'string' ? (asked[key] as string).trim().slice(0, most) : '')
  const token = typeof asked.token === 'string' ? asked.token : null
  const who = await whoIs(token, env)

  if (!what) {
    const description = text('description', 5000)
    if (!description) return answer(400, { error: 'Description is required' })
    const motive = asked.motive === 'feature' || asked.motive === 'other' ? asked.motive : 'bug'
    const replyTo = who ? await emailOf(env, who) : null
    await db.prepare('insert into feedback (id, at, motive, subject, description, username, atrium, platform, reply_to) values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), Date.now(), motive, text('subject', 200), description, text('username', 80), text('atriumName', 200), text('platform', 80), replyTo)
      .run()
    return answer(200, { success: true })
  }

  if (!who || !token || !(await isOperator(env, who, token))) return answer(403, { error: 'Not allowed' })
  const id = text('id', 64)
  switch (what) {
    case 'list': {
      const { results } = await db.prepare('select * from feedback order by at desc limit ?').bind(LISTED).all()
      return answer(200, results)
    }
    case 'handled':
      if (!id) return answer(400, { error: 'body' })
      await db.prepare('update feedback set handled = ? where id = ?').bind(asked.handled ? 1 : 0, id).run()
      return answer(200, { ok: true })
    case 'delete':
      if (!id) return answer(400, { error: 'body' })
      await db.prepare('delete from feedback where id = ?').bind(id).run()
      return answer(200, { ok: true })
    default:
      return answer(404, { error: 'not found' })
  }
}
