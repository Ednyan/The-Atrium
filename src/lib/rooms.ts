// The atrium's room (workers/rooms, a Cloudflare Durable Object per atrium):
// who's here, the introductions for direct connections (lib/peers), the
// slow cursor and the laser for anyone not connected directly, and kick
// notices -- what the Supabase presence channel carried, off Supabase's free
// tier and its 200 connections at once (docs/DECENTRALIZING.md, phase 3).
//
// It speaks as that channel does, for the part usePresence uses (on, subscribe,
// track, untrack, send, presenceState, unsubscribe), so presence works the same
// over either. And it is the Supabase channel whenever the room can't be had:
// none configured, the desktop app, signed out, unreachable at first, or lost
// for good -- the free plan's day spent, say. Then it hands everything it was
// given to a Supabase channel and steps aside, for the rest of the visit.
//
// localStorage['atrium.rooms']: 'off' for Supabase alone; a ws(s):// address
// for another room service (a test one).

import type { RealtimeChannel } from '@supabase/supabase-js'
import { isDesktop, supabase } from './supabase'
import { userOf } from './peers'

// ponytail: set once the room service is deployed (workers/rooms/README.md); until
// then, the Supabase channel as before.
const ROOM_URL = ''

// The first connection's wait, before Supabase is used instead; a lost one is
// tried again this many times, a little later each time, before the same.
const OPEN_MS = 4000
const RETRIES = 3
// "Still here", answered by the room without waking it: proxies close a
// silent socket, and no answer at all means the line is dead.
const PING_MS = 30_000
// What's sent while the room isn't open yet is held, this much at most, and
// sent once it is -- or handed to Supabase's channel, if it comes to that.
const MOST_HELD = 100

export function roomUrl(): string {
  if (isDesktop || typeof WebSocket === 'undefined') return ''
  let chosen: string | null = null
  try { chosen = localStorage.getItem('atrium.rooms') } catch { /* none */ }
  if (chosen === 'off') return ''
  return chosen && /^wss?:\/\//.test(chosen) ? chosen : ROOM_URL
}

type Callback = (arg: never) => void
type Listener = { type: string; event: string; callback: Callback }
// Supabase's channel as listeners are handed to it: its own `on` is typed per
// kind of event, and called as a method, so it keeps its `this`.
type Listening = { on: (type: string, filter: { event: string }, callback: Callback) => unknown }
// What the room says (workers/rooms).
type FromRoom =
  | { t: 'state'; ref: string; list: { id: string; ref: string; meta: Record<string, unknown> }[] }
  | { t: 'join'; id: string; ref: string; meta: Record<string, unknown> }
  | { t: 'leave'; id: string; ref: string }
  | { t: 'b'; e: string; p: unknown; u: string }
type Status = (status: string) => void
// What another page in the room is, by its connection.
type Seat = { id: string; meta: Record<string, unknown> }

/** The atrium's presence channel: its room, or Supabase's channel by the name
 *  and options it always had. */
export function presenceChannel(lobbyId: string, options: Parameters<NonNullable<typeof supabase>['channel']>[1]): RealtimeChannel {
  const viaSupabase = () => supabase!.channel(`lobby-${lobbyId}-presence`, options)
  const url = roomUrl()
  return (url ? new RoomChannel(url, lobbyId, viaSupabase) : viaSupabase()) as RealtimeChannel
}

class RoomChannel {
  private listeners: Listener[] = []
  private status: Status = () => {}
  private socket: WebSocket | null = null
  private others = new Map<string, Seat>()
  private held: { event: string; payload: unknown }[] = []
  private mine: Record<string, unknown> | null = null
  private ref = ''
  private opened = false
  private failures = 0
  private closed = false
  private pinger = 0
  private heardAt = 0
  // Supabase's channel, once the room is given up on.
  private fallback: RealtimeChannel | null = null
  private readonly url: string
  private readonly lobbyId: string
  private readonly viaSupabase: () => RealtimeChannel

  constructor(url: string, lobbyId: string, viaSupabase: () => RealtimeChannel) {
    this.url = url.replace(/\/$/, '')
    this.lobbyId = lobbyId
    this.viaSupabase = viaSupabase
  }

  on(type: string, filter: { event: string }, callback: Callback) {
    this.listeners.push({ type, event: filter?.event, callback })
    ;(this.fallback as unknown as Listening | null)?.on(type, filter, callback)
    return this
  }

  subscribe(status?: Status) {
    if (status) this.status = status
    void this.connect()
    return this
  }

  presenceState() {
    if (this.fallback) return this.fallback.presenceState()
    const state: Record<string, Record<string, unknown>[]> = {}
    for (const [ref, seat] of this.others) (state[seat.id] ??= []).push({ ...seat.meta, presence_ref: ref })
    // This page too, as Supabase's lists it.
    if (this.mine && this.ref && this.userId) (state[this.userId] ??= []).push({ ...this.mine, presence_ref: this.ref })
    return state
  }

  async track(meta: Record<string, unknown>) {
    if (this.fallback) return this.fallback.track(meta)
    this.mine = meta
    this.write({ t: 'track', p: meta })
    return 'ok'
  }

  async untrack() {
    if (this.fallback) return this.fallback.untrack()
    this.mine = null
    this.write({ t: 'untrack' })
    return 'ok'
  }

  async send(message: { type: string; event: string; payload: unknown }) {
    if (this.fallback) return this.fallback.send(message as Parameters<RealtimeChannel['send']>[0])
    if (this.socket?.readyState === WebSocket.OPEN && this.ref) this.write({ t: 'b', e: message.event, p: message.payload })
    else if (this.held.length < MOST_HELD) this.held.push({ event: message.event, payload: message.payload })
    return 'ok'
  }

  async unsubscribe() {
    this.closed = true
    window.clearInterval(this.pinger)
    this.socket?.close()
    return this.fallback ? this.fallback.unsubscribe() : 'ok'
  }

  // Whoever this page is signed in as (the room checks the same).
  private userId: string | null = null

  private write(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private async connect() {
    if (this.closed || this.fallback) return
    const session = (await supabase?.auth.getSession())?.data.session
    const token = session?.access_token
    this.userId = session?.user?.id ?? null
    if (!token) { this.giveUp(); return }
    // The token as a subprotocol, not in the address, where errors, logs and
    // policy reports would show it. And a socket refused outright -- Firefox
    // throws when the page's policy blocks the address -- is Supabase at once.
    let socket: WebSocket
    try {
      socket = new WebSocket(`${this.url}/room/${this.lobbyId}`, ['atrium', token])
    } catch {
      this.giveUp()
      return
    }
    this.socket = socket
    let open = false
    const late = window.setTimeout(() => { if (!open) socket.close() }, OPEN_MS)
    socket.onmessage = event => {
      this.heardAt = performance.now()
      if (event.data === 'pong') return
      let message: FromRoom
      try { message = JSON.parse(event.data) } catch { return }
      if (message.t === 'state') {
        open = true
        window.clearTimeout(late)
        this.opened = true
        this.failures = 0
        this.ref = message.ref
        this.settle(message.list)
        this.status('SUBSCRIBED')
        // Back after a drop: what this page had announced, announced again;
        // and what was said meanwhile.
        if (this.mine) this.write({ t: 'track', p: this.mine })
        for (const { event, payload } of this.held.splice(0)) this.write({ t: 'b', e: event, p: payload })
      } else this.receive(message)
    }
    socket.onclose = () => {
      window.clearTimeout(late)
      window.clearInterval(this.pinger)
      if (this.socket !== socket || this.closed) return
      this.socket = null
      // Never opened, or lost and not had back: Supabase, for the rest of the visit.
      if (!this.opened || ++this.failures > RETRIES) { this.giveUp(); return }
      window.setTimeout(() => void this.connect(), 1000 * 2 ** this.failures)
    }
    this.heardAt = performance.now()
    window.clearInterval(this.pinger)
    this.pinger = window.setInterval(() => {
      if (performance.now() - this.heardAt > 2 * PING_MS + 5000) { socket.close(); return }
      if (socket.readyState === WebSocket.OPEN) socket.send('ping')
    }, PING_MS)
  }

  // The room's list of who's here, on (re)joining: the gone left, the new joined.
  private settle(list: { id: string; ref: string; meta: Record<string, unknown> }[]) {
    const now = new Map(list.filter(seat => seat.meta).map(seat => [seat.ref, { id: seat.id, meta: seat.meta }]))
    for (const [ref, seat] of this.others) if (!now.has(ref)) { this.others.delete(ref); this.emit('presence', 'leave', { key: seat.id, leftPresences: [seat.meta] }) }
    for (const [ref, seat] of now) if (!this.others.has(ref)) { this.others.set(ref, seat); this.emit('presence', 'join', { key: seat.id, newPresences: [seat.meta] }) }
    this.emit('presence', 'sync', {})
  }

  private receive(message: FromRoom) {
    if (message.t === 'join' && typeof message.id === 'string' && message.meta) {
      this.others.set(message.ref, { id: message.id, meta: message.meta })
      this.emit('presence', 'join', { key: message.id, newPresences: [message.meta] })
      this.emit('presence', 'sync', {})
    } else if (message.t === 'leave') {
      const seat = this.others.get(message.ref)
      if (!seat) return
      this.others.delete(message.ref)
      this.emit('presence', 'leave', { key: seat.id, leftPresences: [seat.meta] })
      this.emit('presence', 'sync', {})
    } else if (message.t === 'b' && typeof message.e === 'string' && message.p && typeof message.p === 'object') {
      // Only what its real sender claims to be from (the room says who sent it).
      const payload = message.p as { userId?: unknown; from?: unknown }
      const claimed = typeof payload.userId === 'string' ? payload.userId : typeof payload.from === 'string' ? userOf(payload.from) : null
      if (claimed !== null && claimed !== message.u) return
      this.emit('broadcast', message.e, { type: 'broadcast', event: message.e, payload: message.p })
    }
  }

  // To each listener for it, the argument Supabase's channel would give.
  private emit(type: string, event: string, arg: unknown) {
    for (const listener of this.listeners) if (listener.type === type && listener.event === event) listener.callback(arg as never)
  }

  private giveUp() {
    if (this.fallback || this.closed) return
    console.info('[atrium] the room could not be reached: presence through Supabase')
    const fallback = this.viaSupabase()
    for (const { type, event, callback } of this.listeners) (fallback as unknown as Listening).on(type, { event }, callback)
    this.fallback = fallback
    // Those the room had are gone from here; Supabase's own sync brings them back.
    for (const [ref, seat] of this.others) { this.others.delete(ref); this.emit('presence', 'leave', { key: seat.id, leftPresences: [seat.meta] }) }
    fallback.subscribe(status => {
      this.status(status)
      if (status !== 'SUBSCRIBED') return
      for (const { event, payload } of this.held.splice(0)) void fallback.send({ type: 'broadcast', event, payload })
    })
  }
}
