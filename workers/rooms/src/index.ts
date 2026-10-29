// The rooms atriums' people meet in (docs/DECENTRALIZING.md, phase 3): a
// Durable Object per atrium, holding a WebSocket per page open in it. What
// it carries is what the Supabase presence channel did (src/lib/rooms.ts on
// the other end): who's here, the introductions for direct connections, the
// slow cursor and the laser for anyone not connected directly, and kick
// notices. Nothing is stored; a room is only who's in it now.
//
// On Cloudflare's free plan: 100,000 requests a day, each WebSocket message
// in counted as a twentieth of one, and nothing billed past it -- requests
// just fail, and the app falls back to Supabase. Sockets hibernate between
// messages, so an idle room costs nothing.
//
// It also signs people in with Google and keeps them signed in
// (src/google.ts), and keeps the directory of who's who (src/people.ts).

import { DurableObject } from 'cloudflare:workers'
import { google } from './google'
import { auth } from './auth'
import { feedback } from './mail'
import { people, publicPreview } from './people'
import { store } from './store'
import { mirror } from './mirror'
import { pinterest } from './pinterest'
import { contributions, stripeWebhook } from './contributions'
import { ops } from './ops'
import { held } from './held'
import { themes } from './themes'
import { relay } from './relay'
import { replies, whoIs, type Env } from './who'

// What each socket keeps through hibernation (2 KB at most).
interface Seat { user: string; ref: string; meta: unknown }

// An atrium's id (a uuid in the app; anything this plain is let in).
const ATRIUM = /^\/room\/([\w-]{1,64})$/
// A message larger than this is dropped (an introduction is a few KB).
const MOST_BYTES = 64 * 1024
// What a presence may hold (the attachment's own limit is 2 KB).
const MOST_META = 1500
// Messages a socket may send in a second before it's closed: far past any
// honest use, well short of spending the day's free requests in minutes.
const MOST_PER_SECOND = 40

// Several of the app's reads in one request (src/lib/worker.ts, viaBatch):
// each answered here as if it had come alone -- its own body and sign-in,
// the same checks -- and the answers sent back in order. Only the reads a
// visit makes, a few at once: a request is one of the free day's 100,000
// whatever it holds, and this is how a visit's dozen became two or three.
const BATCHABLE = new Set(['/people/me', '/people/invites', '/people/visits', '/people/atriums', '/held/mine', '/ops/operator',
  '/pinterest/status', '/store/usage', '/store/appdata', '/themes', '/contributions/wall'])
// And, asked with GET, the hosted store's public reads by id: a file's
// version, a folder's list -- an atrium browser's cards, a sync's look at its
// writers, each was a request of its own.
const BATCHABLE_UNDER = ['/store/meta/', '/store/list/']
const batchable = (path: string, get: boolean) => BATCHABLE.has(path) || (get && BATCHABLE_UNDER.some(under => path.startsWith(under)))
// A page's start goes in one: its directory reads, and two versions for each
// of its atriums' cards.
const MOST_IN_BATCH = 32

async function batch(request: Request, env: Env): Promise<Response> {
  const { allowed, answer } = replies(request)
  if (!allowed) return answer(403, { error: 'origin' })
  const asked = await request.json().catch(() => null) as { calls?: unknown } | null
  const calls = Array.isArray(asked?.calls) ? asked.calls as { path?: unknown; body?: unknown; get?: unknown }[] : null
  if (!calls || calls.length > MOST_IN_BATCH) return answer(400, { error: 'calls' })
  // What a batch held, for `wrangler tail`: the requests a page makes are
  // counted by these, and the dashboard sees only /batch.
  console.log(JSON.stringify({ batch: calls.map(call => typeof call?.path === 'string' ? call.path.replace(/\/h\.[\w-]+$/, '/h.*') : '?') }))
  const origin = request.headers.get('Origin') ?? ''
  const answers = await Promise.all(calls.map(async call => {
    const path = typeof call?.path === 'string' ? call.path : ''
    if (!batchable(path, call?.get === true)) return { status: 400, body: { error: 'not batchable' } }
    const inner = new Request(new URL(path, request.url), call.get
      ? { method: 'GET', headers: { Origin: origin } }
      : { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(call.body ?? {}) })
    const response = await handle(inner, env).catch(() => new Response(JSON.stringify({ error: 'failed' }), { status: 500 }))
    const text = await response.text()
    try { return { status: response.status, body: JSON.parse(text) } } catch { return { status: response.status, body: text } }
  }))
  return answer(200, { answers })
}

export default { fetch: (request: Request, env: Env) => handle(request, env) }

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === '/batch') return batch(request, env)
  if (url.pathname.startsWith('/google/')) return google(request, env, url.pathname.slice('/google/'.length))
  // Email accounts (phase 10, step 4).
  if (url.pathname.startsWith('/auth/')) return auth(request, env, url.pathname.slice('/auth/'.length))
  if (url.pathname.startsWith('/people/')) return people(request, env, url.pathname.slice('/people/'.length))
  // The hosted store (phase 10).
  if (url.pathname.startsWith('/store/')) return store(request, env, url.pathname.slice('/store/'.length))
  // Public Drive atriums' mirrors (phase 10, step 3).
  if (url.pathname.startsWith('/mirror/')) return mirror(request, env, url.pathname.slice('/mirror/'.length))
  // A public atrium's picture (phase 8), for anyone.
  const picture = url.pathname.match(/^\/public\/([\w-]{1,64})\.webp$/)?.[1]
  if (picture && request.method === 'GET') return publicPreview(env, picture)
  // What the account calls on (phase 6, step 6): its relay pass, the report
  // form, a Google account's Pinterest.
  if (url.pathname === '/relay') return relay(request, env)
  if (url.pathname === '/feedback') return feedback(request, env)
  if (url.pathname.startsWith('/pinterest/')) return pinterest(request, env, url.pathname.slice('/pinterest/'.length))
  // Contributions (phase 10, step 6), Stripe's word on them, and the operator's dashboard.
  if (url.pathname.startsWith('/contributions/')) return contributions(request, env, url.pathname.slice('/contributions/'.length))
  if (url.pathname === '/stripe/webhook') return stripeWebhook(request, env)
  if (url.pathname.startsWith('/ops/')) return ops(request, env, url.pathname.slice('/ops/'.length))
  // The developer's special themes, for anyone; changed by the operator.
  if (url.pathname === '/themes' || url.pathname.startsWith('/themes/')) return themes(request, env, url.pathname.slice('/themes'.length).replace(/^\//, ''))
  // Cloud atriums held for their owners (phase 10, step 5c).
  if (url.pathname.startsWith('/held/')) return held(request, env, url.pathname.slice('/held/'.length))
  const atrium = url.pathname.match(ATRIUM)?.[1]
  if (!atrium) return new Response('Not found', { status: 404 })
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('A WebSocket only', { status: 426 })
  // A browser's WebSocket can't carry headers: the token comes as a
  // subprotocol after "atrium" -- or, from the first version of the page,
  // in the URL.
  const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(part => part.trim())
  const token = offered[0] === 'atrium' && offered[1] ? offered[1] : url.searchParams.get('token')
  const user = (await whoIs(token, env))?.id
  if (!user) return new Response('Not signed in', { status: 401 })
  const headers = new Headers(request.headers)
  headers.set('X-Atrium-User', user)
  headers.set('X-Atrium-Protocol', offered[0] === 'atrium' ? 'atrium' : '')
  return env.ROOMS.get(env.ROOMS.idFromName(atrium)).fetch(new Request(request.url, { headers }))
}

export class Room extends DurableObject<Env> {
  // Messages per socket this second; lost with hibernation, which is fine.
  private sent = new Map<WebSocket, { second: number; count: number }>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Kept alive without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const user = request.headers.get('X-Atrium-User')
    if (!user) return new Response('Not signed in', { status: 401 })
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    const seat: Seat = { user, ref: crypto.randomUUID().slice(0, 12), meta: null }
    server.serializeAttachment(seat)
    // Who's here already.
    const here = this.ctx.getWebSockets().filter(ws => ws !== server).map(ws => ws.deserializeAttachment() as Seat).filter(other => other.meta)
    server.send(JSON.stringify({ t: 'state', ref: seat.ref, list: here.map(({ user, ref, meta }) => ({ id: user, ref, meta })) }))
    // The subprotocol asked for, agreed to: a browser that offered one closes
    // a socket whose answer doesn't name it.
    const protocol = request.headers.get('X-Atrium-Protocol')
    return new Response(null, { status: 101, webSocket: client, headers: protocol ? { 'Sec-WebSocket-Protocol': protocol } : {} })
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > MOST_BYTES || this.flooding(ws)) return
    let message: { t?: unknown; p?: unknown; e?: unknown }
    try { message = JSON.parse(data) } catch { return }
    const seat = ws.deserializeAttachment() as Seat
    if (message.t === 'track') {
      if (JSON.stringify(message.p ?? null).length > MOST_META) return
      seat.meta = message.p
      ws.serializeAttachment(seat)
      this.toOthers(ws, { t: 'join', id: seat.user, ref: seat.ref, meta: seat.meta })
    } else if (message.t === 'untrack') {
      if (!seat.meta) return
      seat.meta = null
      ws.serializeAttachment(seat)
      this.toOthers(ws, { t: 'leave', id: seat.user, ref: seat.ref })
    } else if (message.t === 'b' && typeof message.e === 'string') {
      // Stamped with who really sent it: the page checks a broadcast's
      // claimed sender against this. One addressed to someone (`to`, their
      // user/page -- a direct connection's offer or answer, which says where
      // the sender can be reached) goes to that account's pages alone, never
      // to whoever else is listening.
      const to = (message.p as { to?: unknown } | null)?.to
      this.toOthers(ws, { t: 'b', e: message.e, p: message.p, u: seat.user }, typeof to === 'string' ? to.split('/')[0] : undefined)
    }
  }

  async webSocketClose(ws: WebSocket) { this.gone(ws) }
  async webSocketError(ws: WebSocket) { this.gone(ws) }

  private gone(ws: WebSocket) {
    this.sent.delete(ws)
    const seat = ws.deserializeAttachment() as Seat | null
    if (seat?.meta) this.toOthers(ws, { t: 'leave', id: seat.user, ref: seat.ref })
    try { ws.close() } catch { /* closed */ }
  }

  private toOthers(from: WebSocket, message: object, onlyUser?: string) {
    const text = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue
      if (onlyUser !== undefined && (ws.deserializeAttachment() as Seat | null)?.user !== onlyUser) continue
      try { ws.send(text) } catch { /* going */ }
    }
  }

  private flooding(ws: WebSocket) {
    const second = Math.floor(Date.now() / 1000)
    const sent = this.sent.get(ws)
    if (!sent || sent.second !== second) { this.sent.set(ws, { second, count: 1 }); return false }
    if (++sent.count <= MOST_PER_SECOND) return false
    try { ws.close(1008, 'too many messages') } catch { /* closed */ }
    return true
  }
}
