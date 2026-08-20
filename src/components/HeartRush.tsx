// Hearts falling until there is nothing else to see.
//
// This was a rigid-body simulation: hearts that collided, packed against the
// floor and filled the room from the bottom up. It worked, and every problem
// it ever had was a problem of contact -- piles that jammed, piles that
// shivered, piles that stopped short of the top. None of that is what the
// screen is meant to show. What it is meant to show is more and more of them
// until they are all there is.
//
// So they pass through each other. Nothing collides and nothing settles: they
// fall, they leave the bottom, they come back in above the top, and more join
// every frame -- so what is on screen keeps growing until the overlaps close
// it. They never stop coming. No solver, no grid, no contact, which also buys
// several times as many of them for less work than the pile cost.

import { useEffect, useRef } from 'react'

interface HeartRushProps {
  // Resolved to a real colour by the caller: canvas cannot read a CSS variable.
  color: string
  // Fired once, when the falling hearts cover the screen.
  onFilled: () => void
}

// How much heart has to be on screen at once for the overlaps to close it.
//
// Falling rather than packed, so this is instantaneous coverage rather than an
// accumulated pile: a heart covers about two thirds of its own circle, they
// fall where they fall, and roughly four screens' worth at any one moment is
// what turns into a single colour.
const COVERAGE = 4.2
const MEAN_HEART_AREA = 2100
const countFor = (width: number, height: number) =>
  Math.max(900, Math.min(6000, Math.round((width * height * COVERAGE) / MEAN_HEART_AREA)))

const MIN_R = 20
const MAX_R = 66

// The speeds the falling version was actually reaching on screen once gravity
// had done its work, kept because that pace was right. Slower ones read as
// further away and faster ones as nearer, which is the oldest trick there is
// for giving a flat thing depth.
const MIN_FALL = 700 // px/s
const MAX_FALL = 1500

// How long the fall takes to reach full rate. The ramp is what makes it read
// as arriving rather than as being switched on.
const RAMP_MS = 4200

const SPRITE_SIZES = 14
const SPRITE_ANGLES = 12

const FILL_COLS = 34
const FILL_ROWS = 20
const FILL_THRESHOLD = 0.985

const HEART = new Path2D(
  'M12 21.35 L10.55 20.03 C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3' +
  ' c1.74 0 3.41 0.81 4.5 2.09 C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5' +
  ' c0 3.78 -3.4 6.86 -8.55 11.54 L12 21.35 Z'
)

// Deterministic, so a replay is the same fall -- and unrelated to the walk
// that places them, which is the property that matters. Size and position were
// once taken from the same sequence, and every large heart fell down one side
// of the screen because of it.
function hash(n: number) {
  let x = (n * 2654435761) >>> 0
  x ^= x >>> 15
  x = (x * 2246822519) >>> 0
  x ^= x >>> 13
  return (x >>> 0) / 4294967296
}

interface Sprite {
  canvas: HTMLCanvasElement
  half: number
}

// Every heart that will ever be drawn, drawn once.
//
// Filling a bezier path is what put a ceiling on the count, and the count is
// the whole effect. Each size and angle is rendered up front and the frame
// loop only blits, which is about an order of magnitude cheaper.
function buildSprites(color: string, dpr: number): Sprite[][] {
  const sheets: Sprite[][] = []
  for (let si = 0; si < SPRITE_SIZES; si++) {
    const r = MIN_R + ((MAX_R - MIN_R) * si) / (SPRITE_SIZES - 1)
    const row: Sprite[] = []
    // The heart is 2.22r across before it is turned at all, and turned it
    // needs the diagonal of that -- at 2.2 every sprite clipped its own
    // shoulders flat.
    const box = Math.ceil(r * 3.2) + 4
    for (let ai = 0; ai < SPRITE_ANGLES; ai++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(box * dpr)
      canvas.height = Math.ceil(box * dpr)
      const c = canvas.getContext('2d')
      if (c) {
        c.setTransform(dpr, 0, 0, dpr, 0, 0)
        c.fillStyle = color
        c.translate(box / 2, box / 2)
        // A lean rather than a tumble. Nothing knocks them any more, so a full
        // circle of angles would be arbitrary; a quarter radian either side of
        // upright is enough to break up a wall of identical glyphs.
        c.rotate((ai / (SPRITE_ANGLES - 1) - 0.5) * 0.5)
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

interface Heart {
  x: number
  y: number
  fall: number
  sway: number
  phase: number
  sizeIndex: number
  angle: number
  liveAt: number
}

export default function HeartRush({ color, onFilled }: HeartRushProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const filledRef = useRef(false)

  // Held in a ref rather than read from the closure. The caller passes an
  // inline arrow, so its identity changes on every render -- and the moment
  // the fill fired, the effect saw a "new" callback and restarted the whole
  // thing underneath the colour fading in.
  const onFilledRef = useRef(onFilled)
  onFilledRef.current = onFilled

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // A fall cannot be "turned off" the way a transition can, so anyone who
    // asked for reduced motion gets the end of it immediately.
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
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    window.addEventListener('resize', size)

    const sprites = buildSprites(color, dpr)
    const count = countFor(width, height)

    const hearts: Heart[] = Array.from({ length: count }, (_, i) => {
      // Position from a golden-ratio walk, size from a hash: two questions,
      // two sequences, so neither predicts the other.
      const across = ((i * 61.803) % 100) / 100
      const sizeIndex = Math.round(Math.pow(hash(i), 1.7) * (SPRITE_SIZES - 1))
      return {
        x: across * (width * 1.12) - width * 0.06,
        // Spread far above the frame, so what arrives is already staggered
        // rather than coming in as a line.
        y: -height * (0.1 + hash(i * 13 + 5) * 2.2),
        fall: MIN_FALL + hash(i * 7 + 1) * (MAX_FALL - MIN_FALL),
        sway: (hash(i * 3 + 2) - 0.5) * 26,
        phase: hash(i * 5 + 3) * Math.PI * 2,
        sizeIndex,
        angle: Math.floor(hash(i * 11 + 7) * SPRITE_ANGLES),
        // They join in order, so the fall thickens rather than starting at
        // full rate.
        liveAt: (i / count) * RAMP_MS,
      }
    })

    const fill = new Uint8Array(FILL_COLS * FILL_ROWS)
    let start = 0
    let last = 0
    let frame = 0
    let raf = 0

    const step = (now: number) => {
      if (!start) { start = now; last = now }
      const elapsed = now - start
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now

      ctx.clearRect(0, 0, width, height)

      for (let i = 0; i < hearts.length; i++) {
        const heart = hearts[i]
        if (elapsed < heart.liveAt) continue

        heart.y += heart.fall * dt
        // Back in above the top rather than lost. The screen fills because
        // more and more are in it, and a heart that leaves for good is one
        // fewer -- this is what makes them keep coming.
        if (heart.y - 140 > height) heart.y = -140 - hash(i * 17 + 11) * 260

        const sprite = sprites[heart.sizeIndex][heart.angle]
        const x = heart.x + Math.sin(elapsed / 900 + heart.phase) * heart.sway
        ctx.drawImage(
          sprite.canvas,
          x - sprite.half,
          heart.y - sprite.half,
          sprite.half * 2,
          sprite.half * 2,
        )
      }

      // How much of the screen they cover, asked a few times a second rather
      // than every frame. Marked smaller than the heart so it under-reports:
      // fading early is by far the worse mistake.
      if (!filledRef.current && ++frame % 6 === 0) {
        fill.fill(0)
        const cw = width / FILL_COLS
        const ch = height / FILL_ROWS
        for (const heart of hearts) {
          if (elapsed < heart.liveAt) continue
          const r = (MIN_R + ((MAX_R - MIN_R) * heart.sizeIndex) / (SPRITE_SIZES - 1)) * 0.55
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

      // A backstop. On a very wide window or a slow machine the screen might
      // not close, and the thanks has to arrive either way.
      if (!filledRef.current && elapsed > RAMP_MS + 3200) {
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
