// Hearts filling the screen, as physics rather than as timing.
//
// The CSS version was three hundred and sixty independent tweens that knew
// nothing about each other: they passed through one another, never packed, and
// the moment the screen was "full" had to be guessed at with a timer. What the
// effect actually describes -- a tank filling with something buoyant -- is a
// simulation, so this is one.
//
// Canvas rather than DOM. Four hundred elements with their own transforms is
// already heavy and cannot be made to collide; four hundred circles on a canvas
// is a fraction of a frame, and the count is what makes it read as a fill.
//
// The screen reports when it is actually covered, and the colour and the words
// wait for that rather than for a number somebody tuned by eye.

import { useEffect, useRef } from 'react'

interface HeartRushProps {
  // Resolved to a real colour by the caller: canvas cannot read a CSS variable.
  color: string
  // Fired once, when the packed hearts cover the screen.
  onFilled: () => void
}

const COUNT = 620

// Upward, because they are buoyant. Everything else follows from that: they
// rise, meet the ceiling, and pack downward as more arrive underneath.
const BUOYANCY = -2600 // px/s²
const MAX_SPEED = 2200
const DAMPING = 0.86
// Two passes of pushing overlaps apart is enough at this density. More looks
// no better and costs a frame budget that a one-shot animation does not have.
const RELAX_PASSES = 2

// Coarse cells for asking how much of the screen is covered. Fine enough to
// notice gaps a person would see, coarse enough to be free.
const FILL_COLS = 26
const FILL_ROWS = 15
const FILL_THRESHOLD = 0.93

interface Heart {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  rot: number
  spin: number
  spawnAt: number
  live: boolean
}

// The ordinary heart, as a path rather than as four beziers guessed at.
//
// Drawn once and reused: Path2D takes the same 24-unit outline every icon set
// uses, so the shape is the one people recognise instead of an approximation
// of it. Its box is 24 by 24 with the centre a little below the middle, which
// is why it is translated by 12 and 12.4 rather than by half of each.
const HEART = new Path2D(
  'M12 21.35 L10.55 20.03 C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3' +
  ' c1.74 0 3.41 0.81 4.5 2.09 C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5' +
  ' c0 3.78 -3.4 6.86 -8.55 11.54 L12 21.35 Z'
)

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  const s = r / 11
  ctx.scale(s, s)
  ctx.translate(-12, -12.4)
  ctx.fill(HEART)
  ctx.restore()
}

export default function HeartRush({ color, onFilled }: HeartRushProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const filledRef = useRef(false)

  // Held in a ref rather than read from the closure.
  //
  // The caller passes an inline arrow, so its identity changes on every
  // render -- and the moment the fill fired, the parent re-rendered, the
  // effect saw a "new" callback, tore the whole simulation down and started it
  // again from nothing. That is the flicker: a screen of packed hearts
  // vanishing and a fresh rush beginning underneath the colour fading in.
  const onFilledRef = useRef(onFilled)
  onFilledRef.current = onFilled

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // A simulation cannot be "turned off" the way a transition can, so anyone
    // who asked for reduced motion gets the end of it immediately.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onFilledRef.current()
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) { onFilledRef.current(); return }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = window.innerWidth
    let height = window.innerHeight
    const size = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    window.addEventListener('resize', size)

    // Built from an index rather than at random so a replay looks the same as
    // the run it is replaying.
    const hearts: Heart[] = Array.from({ length: COUNT }, (_, i) => {
      const t = i / COUNT
      return {
        // Entering from below the screen, spread across and beyond its width so
        // the edges fill as readily as the middle.
        x: ((i * 61.803) % 100) / 100 * (width * 1.1) - width * 0.05,
        // Deep. They were queued within four hundred pixels of each other, so
        // four hundred and twenty of them were touching before they had moved
        // -- which is not a rush, it is a jam being pushed from behind.
        y: height + 120 + ((i * 137) % 2800),
        vx: (((i % 11) - 5) / 5) * 70,
        // Fast enough to clear the queue behind them rather than being
        // shouldered up by it.
        vy: -900 - (i % 9) * 70,
        // Half what they were, and there are half again as many. The gaps
        // between hearts were the size of hearts, which is what a pile of
        // large things looks like -- smaller ones nest.
        r: 11 + Math.round(t * 25) + (i % 5) * 4,
        rot: (((i * 29) % 100) / 100 - 0.5) * 0.8,
        spin: (((i % 7) - 3) / 3) * 0.9,
        spawnAt: t * 2100 + (i % 6) * 25,
        live: false,
      }
    })

    // A uniform grid, so each heart only asks its neighbours about overlaps
    // rather than asking all four hundred.
    const cell = 110
    const buckets = new Map<number, number[]>()
    const keyOf = (x: number, y: number) => ((x / cell) | 0) * 100003 + ((y / cell) | 0)

    const fill = new Uint8Array(FILL_COLS * FILL_ROWS)

    let start = 0
    let last = 0
    let frame = 0
    let raf = 0

    const step = (now: number) => {
      if (!start) { start = now; last = now }
      const elapsed = now - start
      // Capped, so a dropped frame or a backgrounded tab does not teleport
      // everything through everything else.
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now

      for (const heart of hearts) {
        if (!heart.live && elapsed >= heart.spawnAt) heart.live = true
      }

      // Integrate.
      for (const heart of hearts) {
        if (!heart.live) continue
        heart.vy += BUOYANCY * dt
        if (heart.vy < -MAX_SPEED) heart.vy = -MAX_SPEED
        heart.vx *= 1 - (1 - DAMPING) * dt * 6
        heart.vy *= 1 - (1 - DAMPING) * dt * 2
        heart.x += heart.vx * dt
        heart.y += heart.vy * dt
        heart.rot += heart.spin * dt

        if (heart.x < heart.r) { heart.x = heart.r; heart.vx = Math.abs(heart.vx) * 0.4 }
        if (heart.x > width - heart.r) { heart.x = width - heart.r; heart.vx = -Math.abs(heart.vx) * 0.4 }
        // The ceiling they pack against.
        if (heart.y < heart.r * 0.8) { heart.y = heart.r * 0.8; heart.vy = 0 }
      }

      // Separate.
      for (let pass = 0; pass < RELAX_PASSES; pass++) {
        buckets.clear()
        for (let i = 0; i < hearts.length; i++) {
          const heart = hearts[i]
          if (!heart.live) continue
          const key = keyOf(heart.x, heart.y)
          const bucket = buckets.get(key)
          if (bucket) bucket.push(i)
          else buckets.set(key, [i])
        }

        for (let i = 0; i < hearts.length; i++) {
          const a = hearts[i]
          if (!a.live) continue
          const cx = (a.x / cell) | 0
          const cy = (a.y / cell) | 0
          for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
              const bucket = buckets.get((cx + ox) * 100003 + (cy + oy))
              if (!bucket) continue
              for (const j of bucket) {
                if (j <= i) continue
                const b = hearts[j]
                const dx = b.x - a.x
                const dy = b.y - a.y
                // Hearts are wider than they are tall, so they are treated as
                // slightly flattened circles -- close enough at this scale, and
                // it keeps them from stacking into columns.
                const min = (a.r + b.r) * 0.7
                const distSq = dx * dx + dy * dy
                if (distSq >= min * min || distSq === 0) continue
                const dist = Math.sqrt(distSq)
                const push = (min - dist) / 2
                const nx = dx / dist
                const ny = dy / dist
                a.x -= nx * push
                a.y -= ny * push
                b.x += nx * push
                b.y += ny * push
                // Bleed speed only where they are actually closing on each
                // other, and gently. Damping every overlapping pair by a
                // seventh, twice a frame, crushed a heart's velocity to
                // nothing while it was still below the screen -- so it stopped
                // dead and everything behind it piled into it.
                const closing = (b.vy - a.vy) * ny + (b.vx - a.vx) * nx
                if (closing < 0) {
                  a.vy *= 0.97
                  b.vy *= 0.97
                }
              }
            }
          }
        }
      }

      // Draw.
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = color
      for (const heart of hearts) {
        if (!heart.live) continue
        drawHeart(ctx, heart.x, heart.y, heart.r, heart.rot)
      }

      // Ask how much of the screen they cover, a few times a second rather
      // than every frame.
      if (!filledRef.current && ++frame % 6 === 0) {
        fill.fill(0)
        const cw = width / FILL_COLS
        const ch = height / FILL_ROWS
        for (const heart of hearts) {
          if (!heart.live) continue
          const r = heart.r * 0.8
          const c0 = Math.max(0, ((heart.x - r) / cw) | 0)
          const c1 = Math.min(FILL_COLS - 1, ((heart.x + r) / cw) | 0)
          const r0 = Math.max(0, ((heart.y - r) / ch) | 0)
          const r1 = Math.min(FILL_ROWS - 1, ((heart.y + r) / ch) | 0)
          for (let c = c0; c <= c1; c++) {
            for (let rr = r0; rr <= r1; rr++) fill[rr * FILL_COLS + c] = 1
          }
        }
        let covered = 0
        for (let i = 0; i < fill.length; i++) covered += fill[i]
        if (covered / fill.length >= FILL_THRESHOLD) {
          filledRef.current = true
          onFilledRef.current()
        }
      }

      // Settled. The packed frame is what the colour fades in over, so it is
      // held rather than kept in motion behind it.
      if (filledRef.current && elapsed > 5200) {
        return
      }

      // A backstop. If the pack somehow never closes -- a very wide window, a
      // very slow machine -- the message must still arrive.
      if (!filledRef.current && elapsed > 4200) {
        filledRef.current = true
        onFilledRef.current()
      }

      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', size)
    }
  }, [color])

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" aria-hidden="true" />
}
