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

import { DurableObject } from 'cloudflare:workers'

interface Env {
  ROOMS: DurableObjectNamespace<Room>
  // Whose a sign-in token is: Supabase Auth is asked once per connection.
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
}

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const atrium = url.pathname.match(ATRIUM)?.[1]
    if (!atrium) return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('A WebSocket only', { status: 426 })
    // A browser's WebSocket can't carry headers: the token comes in the URL.
    const user = await whoIs(url.searchParams.get('token'), env)
    if (!user) return new Response('Not signed in', { status: 401 })
    const headers = new Headers(request.headers)
    headers.set('X-Atrium-User', user)
    return env.ROOMS.get(env.ROOMS.idFromName(atrium)).fetch(new Request(request.url, { headers }))
  },
}

async function whoIs(token: string | null, env: Env): Promise<string | null> {
  if (!token) return null
  try {
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY } })
    if (!response.ok) return null
    const user = await response.json() as { id?: unknown }
    return typeof user.id === 'string' ? user.id : null
  } catch {
    return null
  }
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
    return new Response(null, { status: 101, webSocket: client })
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
      // claimed sender against this.
      this.toOthers(ws, { t: 'b', e: message.e, p: message.p, u: seat.user })
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

  private toOthers(from: WebSocket, message: object) {
    const text = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue
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
