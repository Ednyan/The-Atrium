// Direct connections between the people in an atrium (WebRTC data channels;
// docs/DECENTRALIZING.md, phase 1): their cursors and lasers, live, browser
// to browser. WebRTC encrypts every data channel itself, and no server
// carries what flows.
//
// Introduced through the atrium's presence channel (usePresence), a message
// each way per pair: each side waits until it knows its own addresses -- the
// outward one from Google's public STUN server -- and sends them all in one.
// In each pair the user id that sorts first makes the offer, so two offers
// never cross. A pair that can't connect waits a while before trying again;
// meanwhile the presence channel's own cursor and laser messages still reach
// it, as they do anyone not connected directly.
//
// Positions go into `livePositions`, which RemoteCursors draws from every
// frame -- never into the store, whose `otherUsers` draws the whole canvas
// overlay again on every change.
//
// A connection is to a place someone is in the atrium -- their account and
// that page of theirs, `user/PAGE` -- for one account can be here more than
// once: two tabs, a phone and a PC. With one connection for the account,
// both pages answered to it, and the still one could hold it while the
// moving one's cursor stood frozen. What comes from a place is its person's.
//
// Cloudflare's relay (TURN) is the last resort: a pair that can't connect
// directly -- a strict network -- goes through it. Someone hiding their IP
// address (Profile) goes only through it, so the others see the relay's
// address. And without a pass for it (the month's budget spent), both are
// left to the presence channel, a cursor every few seconds.

import { useSyncExternalStore } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase, isLocalData, isSharedLocal } from './supabase'

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
// Longest wait for this side's addresses before sending what's known (ms).
const GATHER_MS = 2500
// An offer with no answer by then, or a pair that failed, is tried again
// after RETRY_MS -- when the roster is next looked at (usePresence).
const ANSWER_MS = 15_000
const RETRY_MS = 30_000
// Past this many, the rest are reached through the presence channel.
const MOST_LINKS = 16
// How long after opening a connection's route is looked at again.
const ROUTE_SETTLES_MS = 3000
// A link counts only while it carries something: each side says "still
// here" every HEARTBEAT_MS, and whether it hears the other. Nothing heard for
// SILENT_MS and the link no longer counts -- that person's Supabase copies
// are used again; and told they don't hear us, what we'd send them through
// the room is sent again (reaches). A link that broke without closing, either
// way, can make someone slow, never silent. Nothing for DEAD_MS, from a side
// that says it's still here, and it is let go of and made again.
const HEARTBEAT_MS = 2000
const SILENT_MS = 5000
const DEAD_MS = 20_000

/** The introduction, sent through the presence channel, to a place. */
export interface Signal { to: string; kind: 'offer' | 'answer'; sdp: string }
/** What flows directly: a cursor, with the moment it was there on the
 *  sender's clock (performance.now); a batch of laser points (lib/laser); or
 *  "still here", when there's nothing else to send. */
export type Live = { k: 'c'; x: number; y: number; t?: number } | { k: 'l'; m: unknown } | { k: 'h'; ok?: boolean }

/** Where each directly connected person's cursor is, in the world: the latest,
 *  with its moment on the clock of the place that sent it (`by`), and when it
 *  arrived here (lib/playback). */
export const livePositions = new Map<string, { x: number; y: number; t: number; at: number; by: string }>()

/** This page, among its account's places in an atrium (announced in
 *  presence; usePresence). It lasts the page: reconnecting keeps it. Not
 *  randomUUID, which isn't there over plain http (the dev server, on a phone). */
export const PAGE = Math.random().toString(36).slice(2, 12)
/** Whose a place is (`user/PAGE`). */
export const userOf = (place: string) => place.split('/')[0]
// A place's cursor, let go of with it -- unless another of theirs sent the last.
const unplace = (place: string) => { if (livePositions.get(userOf(place))?.by === place) livePositions.delete(userOf(place)) }

// A pass for the relay (supabase/functions/relay-pass), kept in this browser
// for as long as it lasts, so another atrium or a reload doesn't ask again.
// Asked for again this long before it runs out; a refusal (the month's budget
// spent) or no answer is believed this long; an answer is waited for this
// long before going on without.
const RENEW_MS = 30 * 60_000
const REFUSED_MS = 60 * 60_000
const ASK_MS = 4000
const KEPT = 'atrium.relay'
type Pass = { servers: RTCIceServer[]; until: number }
let relay: Pass | null = null
let refusedAt = -Infinity
try {
  const kept = JSON.parse(localStorage.getItem(KEPT) || 'null') as Pass | null
  if (kept && Array.isArray(kept.servers) && kept.until > Date.now()) relay = kept
  refusedAt = Number(localStorage.getItem(`${KEPT}.refused`)) || -Infinity
} catch { /* nothing kept */ }
let asking: Promise<boolean> | null = null
const relayNow = () => (relay && relay.until > Date.now() ? relay : null)

/** Whether there's a relay pass -- asking for one, or a new one, if it's
 *  time. Never on desktop: no functions there, and no one else in its atriums. */
export function askForRelay(): Promise<boolean> {
  const now = Date.now()
  if (relay && relay.until - now > RENEW_MS) return Promise.resolve(true)
  if ((isLocalData && !isSharedLocal) || !supabase || now - refusedAt < REFUSED_MS) return Promise.resolve(!!relayNow())
  return asking ??= (async () => {
    try {
      const { data, error } = await Promise.race([
        supabase.functions.invoke('relay-pass'),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('no answer')), ASK_MS)),
      ])
      const servers = !error && Array.isArray(data?.iceServers) ? data.iceServers as RTCIceServer[] : []
      const seconds = Number(data?.seconds)
      if (servers.length && seconds > 0) {
        relay = { servers, until: Date.now() + seconds * 1000 }
        try { localStorage.setItem(KEPT, JSON.stringify(relay)); localStorage.removeItem(`${KEPT}.refused`) } catch { /* this visit only */ }
      } else {
        refusedAt = Date.now()
        try { localStorage.setItem(`${KEPT}.refused`, String(refusedAt)) } catch { /* this visit only */ }
      }
    } catch {
      // No answer (offline, or the function not there): this visit waits too.
      refusedAt = Date.now()
    } finally {
      asking = null
    }
    // A pass that couldn't be renewed still holds until it runs out.
    return !!relayNow()
  })()
}

// A pass's servers, as few as do the job -- Firefox slows its search past
// four: its own STUN in place of Google's, and of the relay's ports only UDP
// 3478 and TLS on 443, which any firewall that lets the web through lets
// through too.
const fewest = (servers: RTCIceServer[]): RTCIceServer[] => servers
  .map(server => ({ ...server, urls: ([] as string[]).concat(server.urls).filter(url => /^stun:|:3478\?transport=udp|^turns:[^?]*:443\b/.test(url)) }))
  .filter(server => server.urls.length > 0)

// How a connection is made: by whichever address works -- the outward one
// from a STUN server, the relay last of all (ICE prefers the direct ones) --
// or, hiding the IP address, through the relay alone. Hiding without a pass
// finds no address at all, so a slip can only fail to connect, never show
// the address.
const rtcConfig = (): RTCConfiguration => {
  const pass = relayNow()
  return useGameStore.getState().hideMyAddress
    ? { iceServers: pass ? fewest(pass.servers) : [], iceTransportPolicy: 'relay' }
    : { iceServers: pass ? fewest(pass.servers) : ICE_SERVERS }
}

// localStorage['atrium.p2p.debug'] = '1': what each connection does, and why
// it ends, in the console -- for a network that can't be seen from here.
const debugging = (() => { try { return localStorage.getItem('atrium.p2p.debug') === '1' } catch { return false } })()
const note = (id: string, what: string) => { if (debugging) console.info(`[peers] ${id.slice(0, 8)}: ${what}`) }
// How each person's cursor and laser reach this one, said in the console
// when it changes -- once, not with every message: directly, through the
// relay, or through Supabase (the presence channel).
type Path = 'direct' | 'relay' | 'supabase'
const PATH_WORDS: Record<Path, string> = {
  direct: 'connected directly',
  relay: 'connected through the relay',
  supabase: 'through Supabase (cursor every few seconds)',
}
const paths = new Map<string, Path>()
/** `null`: gone, said nothing of. */
export function reportPath(id: string, path: Path | null) {
  if (path === null) { paths.delete(id); return }
  if (paths.get(id) === path) return
  paths.set(id, path)
  console.info(`[atrium] ${useGameStore.getState().otherUsers[id]?.username ?? id.slice(0, 8)}: ${PATH_WORDS[path]}`)
}
export const forgetPaths = () => paths.clear()
// Directly or through the relay: the pair of addresses the open connection uses.
async function reportRoute(place: string, pc: RTCPeerConnection) {
  const stats = await pc.getStats()
  let relayed: boolean | null = null
  stats.forEach(report => {
    if (report.type !== 'candidate-pair' || report.state !== 'succeeded' || !report.nominated) return
    relayed = stats.get(report.localCandidateId)?.candidateType === 'relay' || stats.get(report.remoteCandidateId)?.candidateType === 'relay'
  })
  if (relayed !== null) reportPath(userOf(place), relayed ? 'relay' : 'direct')
}

/** WebRTC is here (not in the Linux app's webview), and this person either
 *  shows their IP address or has a relay pass to hide it behind. */
export function canLink(): boolean {
  return typeof RTCPeerConnection !== 'undefined' && (!useGameStore.getState().hideMyAddress || !!relayNow())
}

// Who's connected directly right now, for whatever shows it (the online list).
let linkedNow: ReadonlySet<string> = new Set()
const watchers = new Set<() => void>()
const subscribe = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher) } }
export const useLinked = () => useSyncExternalStore(subscribe, () => linkedNow, () => linkedNow)
function publish(ids: string[]) {
  linkedNow = new Set(ids)
  watchers.forEach(watcher => watcher())
}

// Resolves once this side's addresses are all known, or GATHER_MS on.
const gathered = (pc: RTCPeerConnection) => new Promise<void>(resolve => {
  if (pc.iceGatheringState === 'complete') { resolve(); return }
  const timer = window.setTimeout(resolve, GATHER_MS)
  pc.addEventListener('icegatheringstatechange', () => {
    if (pc.iceGatheringState === 'complete') { window.clearTimeout(timer); resolve() }
  })
})

// `heardAt`: when anything last came from them; `live`: heard from lately;
// `beats`: they send "still here" (a version from before that doesn't);
// `heardBy`: they say they hear us (assumed, until they say otherwise).
interface Peer { pc: RTCPeerConnection; channel: RTCDataChannel | null; open: boolean; heardAt: number; live: boolean; beats: boolean; heardBy: boolean }

export class Mesh {
  private peers = new Map<string, Peer>()
  private failedAt = new Map<string, number>()
  private closed = false
  private beatAt = 0
  private readonly beat: number
  private readonly self: string
  // An introduction out, through the presence channel.
  private readonly post: (signal: Signal) => void
  // Something in, from someone connected directly.
  private readonly receive: (from: string, message: Live) => void

  constructor(self: string, post: (signal: Signal) => void, receive: (from: string, message: Live) => void) {
    this.self = self
    this.post = post
    this.receive = receive
    this.beat = window.setInterval(() => this.tick(), 1000)
  }

  /** Who's in the atrium now, by place: the new connected to -- and, with `prune` (the
   *  slow reconcile, whose snapshot is settled), the gone let go of. Presence's
   *  own sync events can carry a snapshot that's missing someone for a moment
   *  (usePresence, applyPresenceState): a link dropped on one of those was
   *  made again moments later, the cursor and laser stalled in between. One
   *  really gone is let go of anyway, when their side closes. */
  sync(roster: Iterable<string>, prune = false) {
    if (this.closed) return
    const here = new Set(roster)
    if (prune) {
      for (const id of [...this.peers.keys()]) {
        if (here.has(id)) continue
        // Still heard from: here, whatever presence says (forget).
        if (this.carries(id)) { note(id, 'not in presence, but still heard from: kept'); continue }
        this.drop(id, 'gone from presence')
        if (!this.linked(userOf(id))) reportPath(userOf(id), null)
      }
    }
    for (const id of here) {
      if (id === this.self || this.peers.has(id) || id < this.self) continue
      if (this.peers.size >= MOST_LINKS) break
      if (Date.now() - (this.failedAt.get(id) ?? -Infinity) < RETRY_MS) continue
      void this.offer(id)
    }
  }

  /** An introduction in, from the presence channel. */
  async signal(from: string, signal: Signal) {
    if (this.closed || signal.to !== this.self || from === this.self) return
    try {
      if (signal.kind === 'offer') {
        // Only the one sorting first offers; and a full mesh takes no more.
        if (from > this.self || (this.peers.size >= MOST_LINKS && !this.peers.has(from))) return
        // A fresh offer from someone already known: they've connected again.
        this.drop(from, 'a new offer from them')
        const peer = this.open(from)
        peer.pc.ondatachannel = event => this.wire(from, peer, event.channel)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
        await peer.pc.setLocalDescription(await peer.pc.createAnswer())
        await gathered(peer.pc)
        if (this.peers.get(from) !== peer) return
        this.post({ to: from, kind: 'answer', sdp: peer.pc.localDescription!.sdp })
        note(from, 'answered')
        // The same wait as theirs, rather than the browser's own half minute.
        window.setTimeout(() => { if (this.peers.get(from) === peer && !peer.open) this.fail(from, 'no way through') }, ANSWER_MS)
      } else {
        const peer = this.peers.get(from)
        if (peer?.pc.signalingState === 'have-local-offer') await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
      }
    } catch (error) {
      this.fail(from, `introduction failed: ${error}`)
    }
  }

  /** To everyone connected directly. */
  send(message: Live) {
    const text = JSON.stringify(message)
    for (const peer of this.peers.values()) {
      if (peer.open && peer.channel?.readyState === 'open') {
        try { peer.channel.send(text) } catch { /* closing */ }
      }
    }
  }

  /** Connected directly to the person, at any of their places, and carrying: heard from lately. */
  linked(user: string) {
    for (const place of this.peers.keys()) if (userOf(place) === user && this.carries(place)) return true
    return false
  }
  /** Connected directly both ways: carrying, and they say they hear us -- so
   *  what goes to them directly needn't go through the room too. */
  reaches(user: string) {
    for (const [place, peer] of this.peers) if (userOf(place) === user && this.carries(place) && peer.heardBy) return true
    return false
  }
  /** A connection to them under way, not open yet. */
  connecting(user: string) {
    for (const [place, peer] of this.peers) if (userOf(place) === user && !peer.open) return true
    return false
  }

  /** Each carrying connection's route looked at again (reportPath says only a change). */
  recheckRoutes() {
    for (const [id, peer] of this.peers) if (peer.open && peer.live) void reportRoute(id, peer.pc)
  }

  /** Someone gone from the atrium (their presence left), from every place. */
  forget(user: string) {
    // Presence can lose someone for a moment -- their browser's connection to
    // it reconnecting, which Safari's does when it rests a page. A link still
    // carrying something is theirs all the same: one really gone closes from
    // their side, or goes quiet and is let go of (tick). Dropped on presence
    // alone, a working link was ended here, made again by the other side, and
    // ended again, on a loop.
    for (const id of [...this.peers.keys()]) {
      if (userOf(id) !== user) continue
      if (this.carries(id)) { note(id, 'left presence, but still heard from: kept'); continue }
      this.drop(id, 'left')
    }
    if (!this.linked(user)) reportPath(user, null)
  }

  close() {
    this.closed = true
    window.clearInterval(this.beat)
    for (const id of [...this.peers.keys()]) this.drop(id, 'closing')
    forgetPaths()
    publish([])
  }

  private async offer(id: string) {
    const peer = this.open(id)
    try {
      // Unordered, never resent: a late position is skipped, not waited for.
      this.wire(id, peer, peer.pc.createDataChannel('live', { ordered: false, maxRetransmits: 0 }))
      await peer.pc.setLocalDescription(await peer.pc.createOffer())
      await gathered(peer.pc)
      if (this.peers.get(id) !== peer) return
      this.post({ to: id, kind: 'offer', sdp: peer.pc.localDescription!.sdp })
      note(id, 'offered')
      window.setTimeout(() => { if (this.peers.get(id) === peer && !peer.open) this.fail(id, 'no answer, or no way through') }, ANSWER_MS)
    } catch (error) {
      this.fail(id, `offer failed: ${error}`)
    }
  }

  private open(id: string): Peer {
    const pc = new RTCPeerConnection(rtcConfig())
    const peer: Peer = { pc, channel: null, open: false, heardAt: 0, live: false, beats: false, heardBy: true }
    this.peers.set(id, peer)
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' && this.peers.get(id) === peer) this.fail(id, 'connection failed')
    })
    return peer
  }

  private wire(id: string, peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel
    const opened = () => {
      if (peer.open) return
      peer.open = true
      peer.live = true
      peer.heardAt = performance.now()
      this.failedAt.delete(id)
      this.changed()
      note(id, 'open')
      void reportRoute(id, peer.pc)
      // The first route that works is taken at once, a better one moments later.
      window.setTimeout(() => { if (this.peers.get(id) === peer && peer.live) void reportRoute(id, peer.pc) }, ROUTE_SETTLES_MS)
    }
    channel.onopen = opened
    // The answering side's channel can come already open, and then -- in
    // Firefox -- no open event follows: unmarked, it was let go of after
    // ANSWER_MS as one that never connected, and made again, on a loop.
    if (channel.readyState === 'open') opened()
    channel.onclose = () => {
      if (this.peers.get(id) !== peer) return
      this.drop(id, 'closed by them')
      if (!this.linked(userOf(id))) reportPath(userOf(id), 'supabase')
    }
    channel.onmessage = event => {
      peer.heardAt = performance.now()
      try {
        const message = JSON.parse(event.data) as Live
        if (message.k === 'h') {
          peer.beats = true
          peer.heardBy = message.ok !== false
        }
        else this.receive(id, message)
      } catch { /* not ours */ }
    }
  }

  // Each second: "still here", and whether we hear them, to each every
  // HEARTBEAT_MS; and whether each link still carries anything.
  private tick() {
    const now = performance.now()
    if (now - this.beatAt >= HEARTBEAT_MS) {
      this.beatAt = now
      for (const peer of this.peers.values()) {
        if (!peer.open || peer.channel?.readyState !== 'open') continue
        try { peer.channel.send(JSON.stringify({ k: 'h', ok: peer.live })) } catch { /* closing */ }
      }
    }
    for (const [id, peer] of [...this.peers]) {
      if (!peer.open) continue
      const quiet = now - peer.heardAt
      if (peer.beats && quiet > DEAD_MS) { this.fail(id, `nothing heard for ${DEAD_MS / 1000} s`); continue }
      const live = quiet <= SILENT_MS
      if (live === peer.live) continue
      peer.live = live
      this.changed()
      note(id, live ? 'heard again' : `nothing heard for ${SILENT_MS / 1000} s: their Supabase copies count again`)
      if (live) void reportRoute(id, peer.pc)
      else {
        unplace(id)
        if (!this.linked(userOf(id))) reportPath(userOf(id), 'supabase')
      }
    }
  }

  private fail(id: string, why: string) {
    this.failedAt.set(id, Date.now())
    this.drop(id, `${why}; tried again in ${RETRY_MS / 1000} s`)
    if (!this.linked(userOf(id))) reportPath(userOf(id), 'supabase')
  }

  private drop(id: string, why: string) {
    const peer = this.peers.get(id)
    if (!peer) return
    note(id, `let go: ${why}`)
    this.peers.delete(id)
    try { peer.channel?.close() } catch { /* gone */ }
    peer.pc.close()
    unplace(id)
    if (peer.open) this.changed()
  }

  private carries(place: string) {
    const peer = this.peers.get(place)
    return !!peer?.open && peer.live
  }

  private changed() {
    publish([...this.peers.keys()].filter(place => this.carries(place)).map(userOf))
  }
}
