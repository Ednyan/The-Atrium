// The laser pointer, as Excalidraw's: a line that follows the pointer while it's
// held and fades a moment after, drawn for everyone in the atrium. Nothing is
// saved. Its colour and an optional particle effect are each person's own,
// kept on this device.
//
// Points are in the world, so a trail stays on what it points at as the view
// moves. They go out over the presence channel (hooks/usePresence) a few at a
// time -- at most twenty messages a second, and only while pointing.

export type LaserEffect = 'none' | 'sparks' | 'embers' | 'stardust'
export const LASER_EFFECTS: LaserEffect[] = ['none', 'sparks', 'embers', 'stardust']

export interface LaserSettings { color: string; effect: LaserEffect }
const DEFAULT_SETTINGS: LaserSettings = { color: '#ff3b3b', effect: 'none' }
const SETTINGS_KEY = 'atrium.laser'

export function loadLaserSettings(): LaserSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return {
      color: /^#[0-9a-f]{6}$/i.test(stored?.color) ? stored.color : DEFAULT_SETTINGS.color,
      effect: LASER_EFFECTS.includes(stored?.effect) ? stored.effect : DEFAULT_SETTINGS.effect,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}
export function saveLaserSettings(settings: LaserSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* kept for this visit only */ }
}

// How long a point of the trail lasts, and so how long it takes to fade.
export const TRAIL_MS = 900

export interface LaserPoint { x: number; y: number; t: number }
export interface LaserTrail { color: string; effect: LaserEffect; points: LaserPoint[]; seen: number }

// What's received from others: their trails, by who's pointing. Read by
// LaserLayer each frame; points older than the trail drop off as it draws.
export const remoteTrails = new Map<string, LaserTrail>()
let wake: (() => void) | null = null
// LaserLayer, to be woken when something arrives while it's idle.
export const onLaserActivity = (fn: (() => void) | null) => { wake = fn }

// What a batch looks like on the wire: points as [x, y, ms before sending].
export interface LaserMessage { userId: string; color: string; effect: LaserEffect; points: [number, number, number][] }

export function receiveLaser(message: LaserMessage) {
  if (!message || typeof message.userId !== 'string' || !Array.isArray(message.points)) return
  const now = performance.now()
  const trail = remoteTrails.get(message.userId) ?? { color: '#ff3b3b', effect: 'none' as LaserEffect, points: [], seen: now }
  trail.color = /^#[0-9a-f]{6}$/i.test(message.color) ? message.color : trail.color
  trail.effect = LASER_EFFECTS.includes(message.effect) ? message.effect : 'none'
  trail.seen = now
  for (const p of message.points.slice(0, 64)) {
    if (!Array.isArray(p) || !p.every(Number.isFinite)) continue
    trail.points.push({ x: p[0], y: p[1], t: now - Math.max(0, Math.min(500, p[2])) })
  }
  remoteTrails.set(message.userId, trail)
  wake?.()
}

// How a batch is sent: set by the presence hook while it's connected.
let sender: ((message: Omit<LaserMessage, 'userId'>) => void) | null = null
export const setLaserSender = (fn: typeof sender) => { sender = fn }
export const sendLaser = (message: Omit<LaserMessage, 'userId'>) => sender?.(message)
