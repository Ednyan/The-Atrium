// A drawing stroke painted from what's kept of it (lib/brushes StrokeData),
// at the density it's seen at -- where its picture file is only as sharp as
// the zoom it was drawn at. TraceOverlay shows this instead of the picture
// only when the stroke is seen closer than that, so a view full of strokes
// costs nothing more than it did.
//
// Not in the frame the zoom changes, though. Painted again whenever the
// density it needed crossed a power of two, every stroke in view repainted all
// of itself in that one frame: hundreds of strokes stalled every step of a
// zoom. Now, until a new painting is ready, the canvas keeps what it had,
// stretched -- or the first time, the drawing's own file stands in -- and the
// painting is done once the zoom has settled, a few milliseconds a frame,
// every stroke's in one queue, then put in whole. A change to the drawing
// itself (a stroke drawn) is painted at once, as it always was.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { paintStrokeData, paintStrokeOp, type StrokeData } from '../lib/brushes'

const BUDGET_MS = 6
const SETTLE_MS = 150

interface Job {
  ops: StrokeData['ops']
  density: number
  off: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  next: number
  done: () => void
}
const jobs = new Map<HTMLCanvasElement, Job>()
let scheduled = false

function work() {
  scheduled = false
  const end = performance.now() + BUDGET_MS
  for (const [canvas, job] of jobs) {
    while (job.next < job.ops.length && performance.now() < end) paintStrokeOp(job.ctx, job.ops[job.next++], job.density)
    if (job.next < job.ops.length) break
    // Painted: put in whole, in one go.
    jobs.delete(canvas)
    canvas.width = job.off.width
    canvas.height = job.off.height
    canvas.getContext('2d')?.drawImage(job.off, 0, 0)
    job.done()
  }
  if (jobs.size > 0) {
    scheduled = true
    requestAnimationFrame(work)
  }
}

function paintSoon(canvas: HTMLCanvasElement, data: StrokeData, width: number, height: number, density: number, done: () => void) {
  const off = document.createElement('canvas')
  off.width = Math.max(1, Math.round(width * density))
  off.height = Math.max(1, Math.round(height * density))
  const ctx = off.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  jobs.set(canvas, { ops: data.ops, density, off, ctx, next: 0, done })
  if (!scheduled) {
    scheduled = true
    requestAnimationFrame(work)
  }
}

export default function StrokeCanvas({ data, width, height, density, standIn, style }: {
  data: StrokeData
  width: number
  height: number
  density: number
  // The drawing's file, shown until the first painting is ready.
  standIn?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  // What the canvas holds now: none yet, or a painting of this data at this
  // density and size.
  const painted = useRef<{ data: StrokeData; density: number; width: number; height: number } | null>(null)
  const [ready, setReady] = useState(false)

  // The drawing changed: painted now, before the frame is shown, so a stroke
  // just drawn never appears late. Not the first time when its file can stand
  // in, up to date -- that one is painted soon (below).
  useLayoutEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    if (!painted.current && standIn && data.rev === data.fileRev) return
    jobs.delete(canvas)
    canvas.width = Math.max(1, Math.round(width * density))
    canvas.height = Math.max(1, Math.round(height * density))
    paintStrokeData(ctx, data, density)
    painted.current = { data, density, width, height }
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // The density it's seen at, or its size, changed: painted again once that
  // has settled, in the queue.
  useEffect(() => {
    const canvas = ref.current
    const was = painted.current
    if (!canvas || (was && was.data === data && was.density === density && was.width === width && was.height === height)) return
    const timer = window.setTimeout(() => paintSoon(canvas, data, width, height, density, () => {
      painted.current = { data, density, width, height }
      setReady(true)
    }), was ? SETTLE_MS : 0)
    return () => window.clearTimeout(timer)
  }, [data, width, height, density])

  useEffect(() => {
    const canvas = ref.current
    return () => { if (canvas) jobs.delete(canvas) }
  }, [])

  return (
    <>
      {standIn && !ready && (
        <img src={standIn} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none" style={style} />
      )}
      <canvas ref={ref} data-stroke-canvas={ready ? 'painted' : 'waiting'} className="w-full h-full pointer-events-none select-none" style={style} />
    </>
  )
}
