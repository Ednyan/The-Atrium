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

import { useSyncExternalStore } from 'react'

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
// Longest wait for this side's addresses before sending what's known (ms).
const GATHER_MS = 2500
// An offer with no answer by then, or a pair that failed, is tried again
// after RETRY_MS -- when the roster is next looked at (usePresence).
const ANSWER_MS = 15_000
const RETRY_MS = 30_000
// Past this many, the rest are reached through the presence channel.
const MOST_LINKS = 16

/** The introduction, sent through the presence channel. */
export interface Signal { to: string; kind: 'offer' | 'answer'; sdp: string }
/** What flows directly: a cursor, or a batch of laser points (lib/laser). */
export type Live = { k: 'c'; x: number; y: number } | { k: 'l'; m: unknown }

/** Where each directly connected person's cursor is, in the world. */
export const livePositions = new Map<string, { x: number; y: number }>()

/** WebRTC is here (not in the Linux app's webview), and not switched off. */
export function canLink(): boolean {
  if (typeof RTCPeerConnection === 'undefined') return false
  try { return localStorage.getItem('atrium.p2p') !== 'off' } catch { return true }
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

interface Peer { pc: RTCPeerConnection; channel: RTCDataChannel | null; open: boolean }

export class Mesh {
  private peers = new Map<string, Peer>()
  private failedAt = new Map<string, number>()
  private closed = false
  private readonly self: string
  // An introduction out, through the presence channel.
  private readonly post: (signal: Signal) => void
  // Something in, from someone connected directly.
  private readonly receive: (from: string, message: Live) => void

  constructor(self: string, post: (signal: Signal) => void, receive: (from: string, message: Live) => void) {
    this.self = self
    this.post = post
    this.receive = receive
  }

  /** Who's in the atrium now: the new connected to, the gone let go of. */
  sync(roster: Iterable<string>) {
    if (this.closed) return
    const here = new Set(roster)
    for (const id of [...this.peers.keys()]) if (!here.has(id)) this.drop(id)
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
        this.drop(from)
        const peer = this.open(from)
        peer.pc.ondatachannel = event => this.wire(from, peer, event.channel)
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp })
        await peer.pc.setLocalDescription(await peer.pc.createAnswer())
        await gathered(peer.pc)
        if (this.peers.get(from) !== peer) return
        this.post({ to: from, kind: 'answer', sdp: peer.pc.localDescription!.sdp })
      } else {
        const peer = this.peers.get(from)
        if (peer?.pc.signalingState === 'have-local-offer') await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
      }
    } catch {
      this.fail(from)
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

  linked(id: string) { return !!this.peers.get(id)?.open }

  close() {
    this.closed = true
    for (const id of [...this.peers.keys()]) this.drop(id)
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
      window.setTimeout(() => { if (this.peers.get(id) === peer && !peer.open) this.fail(id) }, ANSWER_MS)
    } catch {
      this.fail(id)
    }
  }

  private open(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const peer: Peer = { pc, channel: null, open: false }
    this.peers.set(id, peer)
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' && this.peers.get(id) === peer) this.fail(id)
    })
    return peer
  }

  private wire(id: string, peer: Peer, channel: RTCDataChannel) {
    peer.channel = channel
    channel.onopen = () => {
      peer.open = true
      this.failedAt.delete(id)
      this.changed()
    }
    channel.onclose = () => { if (this.peers.get(id) === peer) this.drop(id) }
    channel.onmessage = event => {
      try { this.receive(id, JSON.parse(event.data)) } catch { /* not ours */ }
    }
  }

  private fail(id: string) {
    this.failedAt.set(id, Date.now())
    this.drop(id)
  }

  private drop(id: string) {
    const peer = this.peers.get(id)
    if (!peer) return
    this.peers.delete(id)
    try { peer.channel?.close() } catch { /* gone */ }
    peer.pc.close()
    livePositions.delete(id)
    if (peer.open) this.changed()
  }

  private changed() {
    publish([...this.peers].filter(([, peer]) => peer.open).map(([id]) => id))
  }
}
