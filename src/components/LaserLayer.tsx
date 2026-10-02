// The laser pointer's canvas (lib/laser): over the traces, under the HUD.
// While the laser is in hand it takes the left button -- a held drag draws the
// trail, a dot in its colour stands for the pointer -- and lets everything
// else through (the wheel zooms, the middle button pans, both window-wide).
// Out of hand it takes nothing, and still draws other people's trails.
//
// It draws only while something is there to draw: a trail, a particle, the
// pointer's dot. Otherwise no frame is asked for at all.

import { useEffect, useRef } from 'react'
import { onLaserActivity, remoteTrails, sendLaser, type LaserEffect, type LaserPoint, type LaserSettings } from '../lib/laser'

type View = { x: number; y: number; zoom: number }

// A particle, in the world like the trail: velocity in world units a second.
interface Particle {
  x: number; y: number; vx: number; vy: number; gravity: number
  age: number; life: number; size: number; color: string; kind: Exclude<LaserEffect, 'none'>; seed: number
}

const MAX_PARTICLES = 500
const SEND_EVERY_MS = 50

// A colour some way toward white, for the hot core of the line and sparks.
function toward(hex: string, white: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * white)
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`
}

function spawn(into: Particle[], kind: LaserEffect, at: { x: number; y: number }, travelled: number, color: string, zoom: number) {
  if (kind === 'none') return
  // Screen units, so an effect looks the same at any zoom.
  const px = 1 / zoom
  const count = kind === 'sparks' ? Math.min(4, 1 + Math.floor(travelled / 6)) : Math.min(2, 1 + Math.floor(travelled / 12))
  for (let i = 0; i < count && into.length < MAX_PARTICLES; i++) {
    const angle = Math.random() * Math.PI * 2
    if (kind === 'sparks') {
      const speed = (80 + Math.random() * 160) * px
      into.push({ x: at.x, y: at.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 60 * px, gravity: 600 * px, age: 0, life: 350 + Math.random() * 300, size: 1.8, color, kind, seed: Math.random() * 10 })
    } else if (kind === 'embers') {
      into.push({ x: at.x + (Math.random() - 0.5) * 6 * px, y: at.y, vx: (Math.random() - 0.5) * 30 * px, vy: -(40 + Math.random() * 50) * px, gravity: -20 * px, age: 0, life: 800 + Math.random() * 600, size: 2 + Math.random() * 1.6, color, kind, seed: Math.random() * 10 })
    } else {
      into.push({ x: at.x + (Math.random() - 0.5) * 10 * px, y: at.y + (Math.random() - 0.5) * 10 * px, vx: Math.cos(angle) * 8 * px, vy: Math.sin(angle) * 8 * px, gravity: 0, age: 0, life: 900 + Math.random() * 700, size: 2.6 + Math.random() * 2.4, color, kind, seed: Math.random() * 10 })
    }
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, points: LaserPoint[], color: string, trail: number, now: number, v: View, dpr: number) {
  if (points.length === 0) return
  const sx = (p: LaserPoint) => (p.x * v.zoom + v.x) * dpr
  const sy = (p: LaserPoint) => (p.y * v.zoom + v.y) * dpr
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // A glow in the colour, then a hotter core: thick and bright at the head,
  // thinning and fading toward the tail.
  for (const [pass, white] of [[0, 0], [1, 0.75]] as const) {
    ctx.strokeStyle = pass === 0 ? color : toward(color, white)
    ctx.shadowColor = color
    for (let i = 1; i < points.length; i++) {
      const f = Math.max(0, 1 - (now - points[i].t) / trail)
      if (f <= 0) continue
      ctx.globalAlpha = f
      ctx.shadowBlur = pass === 0 ? 14 * f * dpr : 0
      ctx.lineWidth = (pass === 0 ? 1.5 + 4.5 * f : 0.6 + 1.6 * f) * dpr
      ctx.beginPath()
      ctx.moveTo(sx(points[i - 1]), sy(points[i - 1]))
      ctx.lineTo(sx(points[i]), sy(points[i]))
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, v: View, dpr: number) {
  const fade = 1 - p.age / p.life
  const x = (p.x * v.zoom + v.x) * dpr
  const y = (p.y * v.zoom + v.y) * dpr
  const r = p.size * dpr
  if (p.kind === 'sparks') {
    // A short streak along its way.
    ctx.globalAlpha = fade
    ctx.strokeStyle = toward(p.color, 0.7)
    ctx.lineWidth = r
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x - p.vx * v.zoom * 0.035 * dpr, y - p.vy * v.zoom * 0.035 * dpr)
    ctx.stroke()
  } else if (p.kind === 'embers') {
    // A soft glowing mote, flickering as it rises.
    ctx.globalAlpha = fade * (0.65 + 0.35 * Math.sin(p.age * 0.03 + p.seed))
    ctx.fillStyle = toward(p.color, 0.3)
    ctx.shadowColor = p.color
    ctx.shadowBlur = 8 * dpr
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  } else {
    // A four-pointed star, twinkling.
    ctx.globalAlpha = fade * (0.35 + 0.65 * Math.abs(Math.sin(p.age * 0.012 + p.seed)))
    ctx.fillStyle = toward(p.color, 0.55)
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4
      const d = i % 2 === 0 ? r : r * 0.28
      ctx.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d)
    }
    ctx.closePath()
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

export default function LaserLayer({ active, settings, view, onPointerInside }: {
  active: boolean
  settings: LaserSettings
  view: () => View
  // Whether the pointer is over it, laser in hand: the atrium's own cursor
  // steps aside for the laser's dot.
  onPointerInside: (inside: boolean) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const local = useRef<LaserPoint[]>([])
  const outbox = useRef<LaserPoint[]>([])
  const particles = useRef<Particle[]>([])
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const held = useRef(false)
  const frame = useRef<number | null>(null)
  const lastFrame = useRef(0)
  // How far into each person's trail particles have been made.
  const spawnedTo = useRef(new Map<string, number>())
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const activeRef = useRef(active)
  activeRef.current = active
  const viewRef = useRef(view)
  viewRef.current = view
  const still = useRef(typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

  const draw = () => {
    frame.current = null
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(window.innerWidth * dpr) || canvas.height !== Math.round(window.innerHeight * dpr)) {
      canvas.width = Math.round(window.innerWidth * dpr)
      canvas.height = Math.round(window.innerHeight * dpr)
    }
    const now = performance.now()
    const dt = Math.min(64, lastFrame.current ? now - lastFrame.current : 16)
    lastFrame.current = now
    const v = viewRef.current()
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Other people's trails, and the particles their effects make.
    for (const [userId, trail] of remoteTrails) {
      trail.points = trail.points.filter(p => now - p.t < trail.trail)
      if (!still.current && trail.effect !== 'none') {
        const from = spawnedTo.current.get(userId) ?? 0
        for (let i = 1; i < trail.points.length; i++) {
          const p = trail.points[i]
          if (p.t <= from) continue
          const q = trail.points[i - 1]
          spawn(particles.current, trail.effect, p, Math.hypot(p.x - q.x, p.y - q.y) * v.zoom, trail.color, v.zoom)
        }
        spawnedTo.current.set(userId, trail.points[trail.points.length - 1]?.t ?? from)
      }
      if (trail.points.length === 0 && now - trail.seen > trail.trail) {
        remoteTrails.delete(userId)
        spawnedTo.current.delete(userId)
        continue
      }
      drawTrail(ctx, trail.points, trail.color, trail.trail, now, v, dpr)
    }
    // This person's.
    const mine = settingsRef.current
    local.current = local.current.filter(p => now - p.t < mine.trail)
    drawTrail(ctx, local.current, mine.color, mine.trail, now, v, dpr)

    const alive: Particle[] = []
    for (const p of particles.current) {
      p.age += dt
      if (p.age >= p.life) continue
      p.vy += p.gravity * (dt / 1000)
      p.x += p.vx * (dt / 1000)
      p.y += p.vy * (dt / 1000)
      drawParticle(ctx, p, v, dpr)
      alive.push(p)
    }
    particles.current = alive

    // The pointer, as a dot in the laser's colour.
    if (activeRef.current && pointer.current) {
      const { color } = settingsRef.current
      ctx.fillStyle = toward(color, 0.5)
      ctx.shadowColor = color
      ctx.shadowBlur = 12 * dpr
      ctx.beginPath()
      ctx.arc(pointer.current.x * dpr, pointer.current.y * dpr, (held.current ? 4 : 3) * dpr, 0, Math.PI * 2)
      ctx.fill()
      ctx.shadowBlur = 0
    }

    const busy = local.current.length > 0 || alive.length > 0 || remoteTrails.size > 0 || (activeRef.current && !!pointer.current)
    if (busy) frame.current = requestAnimationFrame(draw)
    else lastFrame.current = 0
  }
  const kick = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(draw)
  }

  useEffect(() => {
    onLaserActivity(kick)
    return () => {
      onLaserActivity(null)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])
  // Put away: the dot goes.
  useEffect(() => {
    if (!active) {
      held.current = false
      pointer.current = null
    }
    kick()
  }, [active])

  // Out to the others a few points at a time while pointing.
  const flush = () => {
    if (outbox.current.length === 0) return
    const now = performance.now()
    const { color, effect, trail } = settingsRef.current
    sendLaser({ color, effect, trail, points: outbox.current.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(now - p.t)]) })
    outbox.current = []
  }
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(flush, SEND_EVERY_MS)
    return () => {
      window.clearInterval(timer)
      flush()
    }
  }, [active])

  const add = (clientX: number, clientY: number) => {
    const v = viewRef.current()
    const at = { x: (clientX - v.x) / v.zoom, y: (clientY - v.y) / v.zoom, t: performance.now() }
    const prev = local.current[local.current.length - 1]
    if (prev && Math.hypot(at.x - prev.x, at.y - prev.y) * v.zoom < 1) return
    local.current.push(at)
    outbox.current.push(at)
    if (!still.current) spawn(particles.current, settingsRef.current.effect, at, prev ? Math.hypot(at.x - prev.x, at.y - prev.y) * v.zoom : 0, settingsRef.current.color, v.zoom)
  }

  return (
    <canvas
      ref={canvasRef}
      data-laser=""
      className="fixed inset-0 z-[9998]"
      style={{ width: '100vw', height: '100vh', pointerEvents: active ? 'auto' : 'none', cursor: active ? 'none' : undefined, touchAction: active ? 'none' : undefined }}
      onPointerEnter={() => { if (active) onPointerInside(true) }}
      onPointerLeave={() => {
        onPointerInside(false)
        pointer.current = null
        kick()
      }}
      onPointerDown={e => {
        if (!active || !e.isPrimary || e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        held.current = true
        pointer.current = { x: e.clientX, y: e.clientY }
        add(e.clientX, e.clientY)
        kick()
      }}
      onPointerMove={e => {
        if (!active || !e.isPrimary) return
        pointer.current = { x: e.clientX, y: e.clientY }
        if (held.current) {
          // Every sample the pointer gave, not just the last of the frame:
          // a fast flick is a line, not a few dots.
          const samples = e.nativeEvent.getCoalescedEvents?.() ?? []
          for (const s of samples.length ? samples : [e.nativeEvent]) add(s.clientX, s.clientY)
        }
        kick()
      }}
      onPointerUp={e => {
        if (!e.isPrimary) return
        held.current = false
        flush()
        kick()
      }}
      onPointerCancel={() => {
        held.current = false
        flush()
      }}
    />
  )
}
