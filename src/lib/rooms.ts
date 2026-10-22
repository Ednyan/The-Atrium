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
import { supabase, isLocalData, isSharedLocal } from './supabase'
import { userOf } from './peers'
import { whoIsSignedIn } from './signedIn'

// The room service (workers/rooms), on the site's own domain.
const ROOM_URL = 'wss://rooms.digitalatrium.org'

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
  if ((isLocalData && !isSharedLocal) || typeof WebSocket === 'undefined') return ''
  return roomServer()
}

/** The room service's address, wherever one is (localStorage atrium.rooms
 *  chooses another, or 'off'); '' if none. It also keeps Drive atriums
 *  signed in to Google (lib/drive). */
export function roomServer(): string {
  return roomsChosen() === 'off' ? '' : workerAt()
}

/** The worker's address for what isn't a room -- Google sign-in, the
 *  directory -- as http(s): another if atrium.rooms names one, and this one
 *  even with the rooms turned off. */
export const workerUrl = () => workerAt().replace(/^ws/, 'http')

const roomsChosen = () => { try { return localStorage.getItem('atrium.rooms') } catch { return null } }
function workerAt(): string {
  const chosen = roomsChosen()
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

// The room in use now, for what isn't presence (lib/liveChanges): which
// atrium's, and whether it's being reached ('trying': joining, or back after a
// drop), there ('live'), or given up on ('gone', Supabase's channel instead).
export type RoomStatus = 'trying' | 'live' | 'gone'
let inUse: { lobbyId: string; status: RoomStatus; room: RoomChannel } | null = null
const statusWatchers = new Set<() => void>()
// Each told what was said and who said it, as the room stamps it.
const roomListeners = new Map<string, Set<(payload: unknown, sender: string) => void>>()
// What an atrium's room is called: its id, unless something names it
// otherwise -- lib/driveSync, from the atrium's key, so that only its people
// can find it. Its id alone then names its door (DOOR), where someone not in
// it asks to be.
let nameOf: (lobbyId: string) => Promise<string> = async lobbyId => lobbyId
export const nameRoomsBy = (namer: typeof nameOf) => { nameOf = namer }
/** A room asked for at its door: its id alone, whatever names it. */
export const DOOR = true
/** The atrium's room in use moved to what its name is now (a new generation
 *  of its key): those in the old one gone from here, the new one joined. */
export const rejoinRoom = (lobbyId: string) => { if (inUse?.lobbyId === lobbyId) inUse.room.rejoin() }
function setStatus(room: RoomChannel, lobbyId: string, status: RoomStatus | null) {
  // A word said from outside (sayToRoom) isn't the room in use.
  if (room.aside) return
  if (status === null) {
    if (inUse?.room !== room) return
    inUse = null
  } else inUse = { lobbyId, status, room }
  statusWatchers.forEach(watch => watch())
}
/** How the atrium's room is doing; null while it has none. */
export const roomStatus = (lobbyId: string): RoomStatus | null => (inUse?.lobbyId === lobbyId ? inUse.status : null)
export function watchRooms(watch: () => void) {
  statusWatchers.add(watch)
  return () => { statusWatchers.delete(watch) }
}
/** To everyone else in the room in use -- held while it's being reached
 *  again. False when there's none to say it in. */
export function sendThroughRoom(event: string, payload: unknown): boolean {
  if (!inUse || inUse.status === 'gone') return false
  void inUse.room.send({ type: 'broadcast', event, payload })
  return true
}
/** What others in the room say of `event`, and who said it -- as the room
 *  knows them by their sign-in, not as they claim. */
export function onRoomEvent(event: string, listener: (payload: unknown, sender: string) => void) {
  const listeners = roomListeners.get(event) ?? new Set()
  roomListeners.set(event, listeners)
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** A word to an atrium's room from outside it -- not present in it, hearing
 *  nothing back -- said again every `everyMs`, so whoever comes in later
 *  hears it too, until what this returns is called. At its `door`, if so. */
export function sayToRoom(lobbyId: string, event: string, payload: unknown, everyMs: number, door = false): () => void {
  const url = roomServer()
  if (!url || typeof WebSocket === 'undefined') return () => {}
  const room = new RoomChannel(url, lobbyId, name => supabase!.channel(`lobby-${name}-presence`, {}), true, door)
  room.subscribe()
  const say = () => void room.send({ type: 'broadcast', event, payload })
  say()
  const again = window.setInterval(say, everyMs)
  return () => {
    window.clearInterval(again)
    void room.unsubscribe()
  }
}

/** At an atrium's door, unseen, while what this returns isn't called: what's
 *  said there reaches onRoomEvent's listeners, as the room's does. */
export function listenAtDoor(lobbyId: string): () => void {
  const url = roomServer()
  if (!url || typeof WebSocket === 'undefined') return () => {}
  const room = new RoomChannel(url, lobbyId, name => supabase!.channel(`lobby-${name}-presence`, {}), true, DOOR)
  room.subscribe()
  return () => void room.unsubscribe()
}

/** The atrium's presence channel: its room, or Supabase's channel by the name
 *  and options it always had. */
export function presenceChannel(lobbyId: string, options: Parameters<NonNullable<typeof supabase>['channel']>[1]): RealtimeChannel {
  const viaSupabase = (name: string) => supabase!.channel(`lobby-${name}-presence`, options)
  const url = roomUrl()
  return (url ? new RoomChannel(url, lobbyId, viaSupabase) : viaSupabase(lobbyId)) as RealtimeChannel
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
  private readonly viaSupabase: (name: string) => RealtimeChannel
  // What the room is called, as of the last connection (nameOf).
  private name = ''

  // `aside`: a connection of its own beside the room in use, if any (sayToRoom).
  // `door`: the atrium's door, not its room.
  constructor(url: string, lobbyId: string, viaSupabase: (name: string) => RealtimeChannel, readonly aside = false, private readonly door = false) {
    this.url = url.replace(/\/$/, '')
    this.lobbyId = lobbyId
    this.viaSupabase = viaSupabase
    setStatus(this, lobbyId, 'trying')
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
    setStatus(this, this.lobbyId, null)
    window.clearInterval(this.pinger)
    this.socket?.close()
    return this.fallback ? this.fallback.unsubscribe() : 'ok'
  }

  /** Into the room its name says now, out of the one it's in. */
  rejoin() {
    const socket = this.socket
    if (this.closed || this.fallback || !socket) return
    // Its closing is no failure: nothing waits on it.
    this.socket = null
    this.ref = ''
    socket.close()
    this.settle([])
    void this.connect()
  }

  // Whoever this page is signed in as (the room checks the same).
  private userId: string | null = null

  private write(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private async connect() {
    if (this.closed || this.fallback) return
    this.name = this.door ? this.lobbyId : await nameOf(this.lobbyId)
    // Whoever's signed in: an existing account's Supabase sign-in, or a
    // Google account's session from the worker (lib/signedIn).
    const who = await whoIsSignedIn()
    const token = who?.token
    // Another connection made meanwhile (rejoin, twice) is the one kept.
    if (this.closed || this.socket) return
    this.userId = who?.id ?? null
    if (!token) { this.giveUp(); return }
    // The token as a subprotocol, not in the address, where errors, logs and
    // policy reports would show it. And a socket refused outright -- Firefox
    // throws when the page's policy blocks the address -- is Supabase at once.
    let socket: WebSocket
    try {
      socket = new WebSocket(`${this.url}/room/${this.name}`, ['atrium', token])
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
        setStatus(this, this.lobbyId, 'live')
        this.status('SUBSCRIBED')
        // Back after a drop: what this page had announced, announced again;
        // and what was said meanwhile.
        if (this.mine) this.write({ t: 'track', p: this.mine })
        for (const { event, payload } of this.held.splice(0)) this.write({ t: 'b', e: event, p: payload })
      } else this.receive(message)
    }
    socket.onclose = () => {
      window.clearTimeout(late)
      if (this.socket !== socket || this.closed) return
      window.clearInterval(this.pinger)
      this.socket = null
      // Never opened, or lost and not had back: Supabase, for the rest of the visit.
      if (!this.opened || ++this.failures > RETRIES) { this.giveUp(); return }
      setStatus(this, this.lobbyId, 'trying')
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
      // With who really sent it, for a message whose sender is what matters (a kick).
      this.emit('broadcast', message.e, { type: 'broadcast', event: message.e, payload: message.p, sender: message.u })
      roomListeners.get(message.e)?.forEach(listener => listener(message.p, message.u))
    }
  }

  // To each listener for it, the argument Supabase's channel would give.
  private emit(type: string, event: string, arg: unknown) {
    for (const listener of this.listeners) if (listener.type === type && listener.event === event) listener.callback(arg as never)
  }

  private giveUp() {
    if (this.fallback || this.closed) return
    console.info('[atrium] the room could not be reached: presence through Supabase')
    setStatus(this, this.lobbyId, 'gone')
    const fallback = this.viaSupabase(this.name || this.lobbyId)
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
