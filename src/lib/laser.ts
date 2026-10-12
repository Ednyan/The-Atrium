// The laser pointer, as Excalidraw's: a line that follows the pointer while it's
// held and fades a moment after, drawn for everyone in the atrium. Nothing is
// saved. Its colour and an optional particle effect are each person's own,
// kept on this device.
//
// Points are in the world, so a trail stays on what it points at as the view
// moves. They go out a few at a time, only while pointing (hooks/usePresence):
// directly (lib/peers) every frame; over the presence channel, for anyone not
// connected directly, gathered into four messages a second -- the project's
// realtime budget -- and played a quarter of a second behind.

import { Playback, RESTART_MS } from './playback'

export type LaserEffect = 'none' | 'sparks' | 'embers' | 'stardust'
export const LASER_EFFECTS: LaserEffect[] = ['none', 'sparks', 'embers', 'stardust']

// How long a point of the trail lasts, and so how long it takes to fade: a
// short trail or a long one, each person's choice -- sent with their points,
// so everyone sees the trail as long as it was meant.
export const TRAIL_MIN_MS = 250
export const TRAIL_MAX_MS = 4000
const TRAIL_DEFAULT_MS = 900
const trailOf = (ms: unknown) => (typeof ms === 'number' && Number.isFinite(ms) ? Math.min(TRAIL_MAX_MS, Math.max(TRAIL_MIN_MS, ms)) : TRAIL_DEFAULT_MS)

export interface LaserSettings { color: string; effect: LaserEffect; trail: number }
const DEFAULT_SETTINGS: LaserSettings = { color: '#ff3b3b', effect: 'none', trail: TRAIL_DEFAULT_MS }
const SETTINGS_KEY = 'atrium.laser'

export function loadLaserSettings(): LaserSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return {
      color: /^#[0-9a-f]{6}$/i.test(stored?.color) ? stored.color : DEFAULT_SETTINGS.color,
      effect: LASER_EFFECTS.includes(stored?.effect) ? stored.effect : DEFAULT_SETTINGS.effect,
      trail: trailOf(stored?.trail),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}
export function saveLaserSettings(settings: LaserSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* kept for this visit only */ }
}

// `start`: the first point of a stroke, not joined to the one before it.
export interface LaserPoint { x: number; y: number; t: number; start?: boolean }
// `playback`: when to show what arrives (lib/playback); `sent`, the latest
// batch's moment.
export interface LaserTrail { color: string; effect: LaserEffect; trail: number; points: LaserPoint[]; seen: number; playback?: Playback; sent?: number }

// What's received from others: their trails, by who's pointing. Read by
// LaserLayer each frame; points older than the trail drop off as it draws.
export const remoteTrails = new Map<string, LaserTrail>()
let wake: (() => void) | null = null
// LaserLayer, to be woken when something arrives while it's idle.
export const onLaserActivity = (fn: (() => void) | null) => { wake = fn }

// How often the points drawn are sent, a batch at a time: every frame to
// those connected directly; through the presence channel, the batches since
// its last message gathered into one this often (channelBatches).
export const SEND_EVERY_MS = 16
export const CHANNEL_EVERY_MS = 250
// Someone else's trail is played as it was drawn, point by point at the pace
// it was made, rather than a batch at once when it arrives -- which moved it
// in jumps. When: lib/playback, from `sent`; for a version from before that,
// 100 ms behind, as it was then.
const PLAYBACK_MS = 100
// The most points a message carries, and receiveLaser reads.
const MOST_POINTS = 64

// What a batch looks like on the wire: points as [x, y, ms before sending],
// and a fourth number, 1, on a stroke's first; `sent`, when, on the sender's
// clock (performance.now). That number, `sent` and `trail` are missing from
// versions from before them -- which, given them, read the first three and
// pass over the rest.
export interface LaserMessage { userId: string; color: string; effect: LaserEffect; trail?: number; sent?: number; points: number[][] }

export function receiveLaser(message: LaserMessage) {
  if (!message || typeof message.userId !== 'string' || !Array.isArray(message.points)) return
  const now = performance.now()
  const trail = remoteTrails.get(message.userId) ?? { color: '#ff3b3b', effect: 'none' as LaserEffect, trail: TRAIL_DEFAULT_MS, points: [], seen: now }
  trail.color = /^#[0-9a-f]{6}$/i.test(message.color) ? message.color : trail.color
  trail.effect = LASER_EFFECTS.includes(message.effect) ? message.effect : 'none'
  trail.trail = trailOf(message.trail)
  trail.seen = now
  const sent = Number(message.sent)
  const points = message.points.slice(0, MOST_POINTS).filter(p => Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite))
  // Each point's moment, on the sender's clock or (before `sent`) on ours.
  const made = (p: number[]) => (Number.isFinite(sent) ? sent : now) - Math.max(0, Math.min(500, p[2]))
  if (Number.isFinite(sent)) {
    // Overtaken on the way (a direct link keeps no order): its moment has
    // passed, and drawn now it would turn the line back.
    const latest = trail.sent ?? -Infinity
    if (sent <= latest && latest - sent < RESTART_MS) return
    if (sent < latest) trail.playback = undefined
    trail.sent = sent
    // Room for a whole channel message's points: they span CHANNEL_EVERY_MS.
    trail.playback ??= new Playback(CHANNEL_EVERY_MS + 50)
    for (const p of points) trail.playback.heard(made(p), now)
  }
  const lag = Number.isFinite(sent) ? trail.playback!.lag() : PLAYBACK_MS
  // Its moment may be still to come: LaserLayer shows only those whose has.
  for (const p of points) trail.points.push({ x: p[0], y: p[1], t: made(p) + lag, start: p[3] === 1 })
  remoteTrails.set(message.userId, trail)
  wake?.()
}

// How a batch is sent: set by the presence hook while it's connected.
let sender: ((message: Omit<LaserMessage, 'userId'>) => void) | null = null
export const setLaserSender = (fn: typeof sender) => { sender = fn }
export const sendLaser = (message: Omit<LaserMessage, 'userId'>) => sender?.(message)

/** The presence channel's share: the batches made since its last message,
 *  taken as one -- each point's age counted again from when it goes, and at
 *  most MOST_POINTS of them (every so many kept, a stroke's first always). */
export function channelBatches() {
  let latest: Omit<LaserMessage, 'userId'> | null = null
  let held: { p: number[]; made: number }[] = []
  return {
    add(message: Omit<LaserMessage, 'userId'>) {
      latest = message
      const sent = message.sent ?? performance.now()
      for (const p of message.points) held.push({ p, made: sent - p[2] })
    },
    take(): Omit<LaserMessage, 'userId'> | null {
      if (!latest || held.length === 0) return null
      const now = performance.now()
      const every = Math.ceil(held.length / (MOST_POINTS - 4))
      const kept = held.length <= MOST_POINTS ? held : held.filter(({ p }, i) => p[3] === 1 || i % every === 0 || i === held.length - 1)
      const message = { ...latest, sent: Math.round(now), points: kept.map(({ p, made }) => [p[0], p[1], Math.round(now - made), ...p.slice(3)]) }
      latest = null
      held = []
      return message
    },
  }
}
