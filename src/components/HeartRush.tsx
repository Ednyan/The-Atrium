// Hearts filling the screen, as physics rather than as timing.
//
// They fall from above the frame, land, and pack upward as more come down on
// top of them -- a tank filling with something light poured into it.
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

// How many it takes to close a screen.
//
// The first estimate was far short. A heart covers about two thirds of the
// circle it sits in, the pile leaves gaps between them, and the fill is only
// ever as tall as what has landed -- so a screen wants something like three
// and a half times its own area in hearts, not two and a half.
//
// That is thousands of them, which is the real constraint: filling a path
// three thousand times a frame is too slow, so they are stamped from
// pre-drawn sprites instead (see SPRITES). Once drawing is a blit, the count
// stops being the thing that limits this.
//
// Counted from the viewport, so a wide monitor gets what it needs and a laptop
// is not asked to simulate four thousand for nothing.
const COVERAGE = 3.5
const MEAN_HEART_AREA = 2100
const countFor = (width: number, height: number) =>
  Math.max(700, Math.min(4200, Math.round((width * height * COVERAGE) / MEAN_HEART_AREA)))

// Down, because they fall. Everything else follows: they drop, meet the floor,
// and pack upward as more land on top of them -- which is the tank filling.
const GRAVITY = 2600 // px/s²
const MAX_SPEED = 2200
const DAMPING = 0.86
// Two passes of pushing overlaps apart is enough at this density. More looks
// no better and costs a frame budget that a one-shot animation does not have.
const RELAX_PASSES = 2

// Coarse cells for asking how much of the screen is covered. Fine enough to
// notice gaps a person would see, coarse enough to be free.
const FILL_COLS = 26
const FILL_ROWS = 15
const FILL_THRESHOLD = 0.9

interface Heart {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  // Which pre-drawn sprite this one is: a size row and an angle within it.
  sizeIndex: number
  angle: number
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

// Every heart that will ever be drawn, drawn once.
//
// Filling a bezier path thousands of times a frame is what put a ceiling on
// the count, and the count is the whole effect. Each size and angle is
// rendered to its own small canvas up front, and the frame loop only blits --
// which is roughly an order of magnitude cheaper and is why there can now be
// four thousand of them instead of six hundred.
//
// Angles rather than a live rotation for the same reason: a rotated draw costs
// a transform per heart, and nobody can tell twelve angles from a continuum
// when the things are tumbling into a pile.
const SPRITE_SIZES = 14
const SPRITE_ANGLES = 12

interface Sprite {
  canvas: HTMLCanvasElement
  half: number
}

function buildSprites(color: string, dpr: number, minR: number, maxR: number): Sprite[][] {
  const sheets: Sprite[][] = []
  for (let si = 0; si < SPRITE_SIZES; si++) {
    const r = minR + ((maxR - minR) * si) / (SPRITE_SIZES - 1)
    const row: Sprite[] = []
    // Room for the shape at any angle, plus a pixel so nothing clips.
    const box = Math.ceil(r * 2.2) + 2
    for (let ai = 0; ai < SPRITE_ANGLES; ai++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(box * dpr)
      canvas.height = Math.ceil(box * dpr)
      const c = canvas.getContext('2d')
      if (c) {
        c.setTransform(dpr, 0, 0, dpr, 0, 0)
        c.fillStyle = color
        c.translate(box / 2, box / 2)
        c.rotate((ai / SPRITE_ANGLES) * Math.PI * 2)
        const scale = r / 9
        c.scale(scale, scale)
        c.translate(-12, -12.4)
        c.fill(HEART)
      }
      row.push({ canvas, half: box / 2 })
    }
    sheets.push(row)
  }
  return sheets
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
    const count = countFor(width, height)
    // The smallest are still a heart somebody can see rather than a speck, and
    // the range is narrow enough that the pile reads as one material.
    const MIN_R = 20
    const MAX_R = 66
    const sprites = buildSprites(color, dpr, MIN_R, MAX_R)
    const hearts: Heart[] = Array.from({ length: count }, (_, i) => {
      const t = i / count
      // A golden-ratio walk again, skewed so small ones outnumber large --
      // small hearts take the gaps large ones leave, and a mixed pile is
      // denser than a uniform one.
      const spread = ((i * 61.803) % 100) / 100
      const sizeIndex = Math.round(Math.pow(spread, 1.7) * (SPRITE_SIZES - 1))
      return {
        // Entering from above the screen, spread across and beyond its width so
        // the edges fill as readily as the middle.
        x: ((i * 61.803) % 100) / 100 * (width * 1.1) - width * 0.05,
        // Deep. Queued within a few hundred pixels of each other they would be
        // touching before they had moved -- which is not a fall, it is a jam
        // being shoved from behind.
        y: -120 - ((i * 137) % 2800),
        vx: (((i % 11) - 5) / 5) * 70,
        // Fast enough to clear the queue above them rather than being
        // shouldered down by it.
        vy: 900 + (i % 9) * 70,
        // Size from its own sequence, not from its place in the queue.
        //
        // It was derived from the same t that sets the spawn time, so every
        // small heart fell first and every large one last -- the pile arrived
        // sorted. A separate walk over the same index mixes them: at any
        // moment what is falling is a handful of each.
        r: MIN_R + (sizeIndex / (SPRITE_SIZES - 1)) * (MAX_R - MIN_R),
        sizeIndex,
        angle: (i * 5) % SPRITE_ANGLES,
        spawnAt: t * 2400 + (i % 6) * 18,
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

      // Gravity fades as the pile forms.
      //
      // Held constant, it goes on crushing everything into the floor long
      // after there is anywhere to go, and the solver spends every frame
      // undoing overlaps that gravity puts straight back -- which is the
      // shivering. Once the room is full there is nothing left to pull on.
      const pull = GRAVITY * Math.max(0, 1 - elapsed / 3400)

      // Integrate.
      for (const heart of hearts) {
        if (!heart.live) continue
        heart.vy += pull * dt
        if (heart.vy > MAX_SPEED) heart.vy = MAX_SPEED
        heart.vx *= 1 - (1 - DAMPING) * dt * 6
        heart.vy *= 1 - (1 - DAMPING) * dt * 2
        // Anything barely moving is put to sleep. A heart trembling half a
        // pixel a frame inside a pile is not settling, it is vibrating, and
        // hundreds of them doing it at once is what reads as a glitch.
        if (Math.abs(heart.vx) < 9 && Math.abs(heart.vy) < 9) {
          heart.vx = 0
          heart.vy = 0
        }

        heart.x += heart.vx * dt
        heart.y += heart.vy * dt

        if (heart.x < heart.r) { heart.x = heart.r; heart.vx = Math.abs(heart.vx) * 0.4 }
        if (heart.x > width - heart.r) { heart.x = width - heart.r; heart.vx = -Math.abs(heart.vx) * 0.4 }
        // The floor they pack against.
        if (heart.y > height - heart.r * 0.8) { heart.y = height - heart.r * 0.8; heart.vy = 0 }
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
      for (const heart of hearts) {
        if (!heart.live) continue
        const sprite = sprites[heart.sizeIndex][heart.angle]
        ctx.drawImage(
          sprite.canvas,
          heart.x - sprite.half,
          heart.y - sprite.half,
          sprite.half * 2,
          sprite.half * 2,
        )
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
      if (filledRef.current && elapsed > 4600) {
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
