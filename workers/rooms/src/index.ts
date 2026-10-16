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
// It also keeps Drive atriums signed in to Google (google, below).

import { DurableObject } from 'cloudflare:workers'

interface Env {
  ROOMS: DurableObjectNamespace<Room>
  // Whose a sign-in token is: Supabase Auth is asked once per connection.
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  // Google sign-in for Drive atriums: the app's client id (wrangler.toml)
  // and secret (a secret). Without the secret, the app asks Google itself.
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  // Google's token address; another only in a local test.
  GOOGLE_TOKEN_URL?: string
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
    if (url.pathname === '/google/grant' || url.pathname === '/google/renew') return google(request, env, url.pathname.slice('/google/'.length))
    const atrium = url.pathname.match(ATRIUM)?.[1]
    if (!atrium) return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('A WebSocket only', { status: 426 })
    // A browser's WebSocket can't carry headers: the token comes as a
    // subprotocol after "atrium" -- or, from the first version of the page,
    // in the URL.
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(part => part.trim())
    const token = offered[0] === 'atrium' && offered[1] ? offered[1] : url.searchParams.get('token')
    const user = await whoIs(token, env)
    if (!user) return new Response('Not signed in', { status: 401 })
    const headers = new Headers(request.headers)
    headers.set('X-Atrium-User', user)
    headers.set('X-Atrium-Protocol', offered[0] === 'atrium' ? 'atrium' : '')
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

// ---------------------------------------------------------------- Google

// Drive atriums stay signed in to Google (src/lib/drive.ts). Google's pass
// lasts an hour, and in a browser only a click can ask for another; so a
// browser asks once, in Google's code flow, and this turns the code into a
// pass and a renewal grant -- which takes the app's secret, kept here. The
// grant never rests here: it goes back to the browser sealed with a key only
// this worker has, bound to whose it is, and comes back with each renewal,
// with that person's sign-in. Plain requests (a text body, no headers of
// their own): a browser sends them without asking first, so a renewal is one
// request an hour per person saving.
const ORIGINS = /^(https:\/\/(www\.)?digitalatrium\.org|http:\/\/(localhost|127\.0\.0\.1):\d+)$/

async function google(request: Request, env: Env, what: string): Promise<Response> {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = ORIGINS.test(origin)
  const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) },
  })
  if (request.method !== 'POST' || !allowed) return answer(403, { error: 'origin' })
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return answer(503, { error: 'not set up' })
  let asked: { token?: unknown; code?: unknown; grant?: unknown }
  try {
    asked = await request.json()
  } catch {
    return answer(400, { error: 'body' })
  }
  const user = await whoIs(typeof asked.token === 'string' ? asked.token : null, env)
  if (!user) return answer(401, { error: 'sign-in' })
  const key = await grantKey(env.GOOGLE_CLIENT_SECRET)
  let form: Record<string, string>
  if (what === 'grant' && typeof asked.code === 'string') {
    // A code from Google's window in popup mode is exchanged with this address.
    form = { grant_type: 'authorization_code', code: asked.code, redirect_uri: 'postmessage' }
  } else if (what === 'renew' && typeof asked.grant === 'string') {
    const refresh = await unsealGrant(key, asked.grant, user)
    if (!refresh) return answer(401, { error: 'grant' })
    form = { grant_type: 'refresh_token', refresh_token: refresh }
  } else {
    return answer(400, { error: 'body' })
  }
  const response = await fetch(env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ ...form, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET }),
  })
  const got = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; scope?: string; refresh_token?: string; error?: string }
  // Taken back (the person removed the app's access), or a code already used.
  if (got.error === 'invalid_grant') return answer(401, { error: 'grant' })
  if (!response.ok || !got.access_token) return answer(502, { error: 'google', detail: got.error })
  return answer(200, {
    access_token: got.access_token,
    expires_in: got.expires_in,
    scope: got.scope,
    ...(got.refresh_token ? { grant: await sealGrant(key, got.refresh_token, user) } : {}),
  })
}

// The key grants are sealed with: made from the app's secret, so a new secret
// makes every grant useless, and each browser asks once again.
const grantKey = async (secret: string) =>
  crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`atrium drive grant\n${secret}`)), 'AES-GCM', false, ['encrypt', 'decrypt'])

async function sealGrant(key: CryptoKey, refresh: string, user: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(user) }, key, new TextEncoder().encode(refresh)))
  return btoa(String.fromCharCode(...iv, ...sealed))
}

// Null for anything not sealed here for this person.
async function unsealGrant(key: CryptoKey, grant: string, user: string): Promise<string | null> {
  try {
    const bytes = Uint8Array.from(atob(grant), c => c.charCodeAt(0))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: new TextEncoder().encode(user) }, key, bytes.subarray(12))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
