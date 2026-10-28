// The whole atrium in miniature, in a corner, while the view moves -- the
// view drawn on it as a frame. A preference, on unless turned off
// (ProfileCustomization, showMinimap).
//
// Cheap by construction. The traces are drawn into its canvas only when they
// change, at most four times a second. While the view moves, only the frame
// moves: a style write from the scene's own frame loop (LobbyScene calls
// `frame`), never a render. It shows while the view moves and goes a moment
// after it stops; pointed at, it stays. A press or a drag on it takes the
// view there -- once it's been pointed at, still, for DWELL_MS: until then
// it lets the pointer through, so a pan that starts or ends where it has
// just appeared (it shows whenever the view moves) goes on panning rather
// than jumping the view, and a trace carried across it passes by.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { boundsOf, traceBox } from '../lib/traceGeometry'
import { isPathTrace } from '../lib/pathBounds'
import { pathOutline, type PathPoint } from '../lib/pathGeometry'
import { useTranslation } from '../lib/i18n'

export interface MinimapHandle {
  /** The view now: the world point at the screen's middle, the zoom, the screen. */
  frame: (x: number, y: number, zoom: number, width: number, height: number) => void
}

const WIDTH = 208
const HEIGHT = 136
// Around the traces, so the outermost aren't on the edge.
const PAD = 8
const REDRAW_MS = 250
const STAYS_MS = 1500
const DWELL_MS = 250
// Where it sits on screen (its classes below): from the right and bottom.
const RIGHT = 16, BOTTOM = 64

const Minimap = forwardRef<MinimapHandle, { onMove: (x: number, y: number) => void }>(function Minimap({ onMove }, ref) {
  const { t } = useTranslation()
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  // World to minimap: minimap = world * scale + offset.
  const map = useRef({ scale: 0, x: 0, y: 0 })
  const last = useRef({ x: NaN, y: NaN, zoom: NaN, width: 0, height: 0 })
  const hideTimer = useRef(0)
  const pointedAt = useRef(false)

  const placeFrame = () => {
    const view = viewRef.current, { scale, x, y } = map.current, now = last.current
    if (!view || !scale || !Number.isFinite(now.zoom)) return
    const w = (now.width / now.zoom) * scale, h = (now.height / now.zoom) * scale
    view.style.transform = `translate(${now.x * scale + x - w / 2}px, ${now.y * scale + y - h / 2}px)`
    view.style.width = `${w}px`
    view.style.height = `${h}px`
  }

  // The traces, drawn again when they change -- not more often than REDRAW_MS.
  useEffect(() => {
    let timer = 0
    const draw = () => {
      timer = 0
      const canvas = canvasRef.current
      if (!canvas) return
      const ratio = window.devicePixelRatio || 1
      canvas.width = WIDTH * ratio
      canvas.height = HEIGHT * ratio
      const context = canvas.getContext('2d')!
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, WIDTH, HEIGHT)
      const boxes = useGameStore.getState().traces.map(trace => ({ trace, box: boundsOf(traceBox(trace)) }))
      if (!boxes.length) { map.current = { scale: 0, x: 0, y: 0 }; return }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const { box } of boxes) {
        minX = Math.min(minX, box.minX); minY = Math.min(minY, box.minY)
        maxX = Math.max(maxX, box.maxX); maxY = Math.max(maxY, box.maxY)
      }
      const scale = Math.min((WIDTH - PAD * 2) / Math.max(1, maxX - minX), (HEIGHT - PAD * 2) / Math.max(1, maxY - minY))
      map.current = { scale, x: (WIDTH - (maxX - minX) * scale) / 2 - minX * scale, y: (HEIGHT - (maxY - minY) * scale) / 2 - minY * scale }
      const ink = getComputedStyle(document.documentElement).getPropertyValue('--c-fg').trim() || '203 203 203'
      const { scale: k, x, y } = map.current
      for (const { trace, box } of boxes) {
        // A shape in its own colour; pictures and media a little brighter
        // than words, so the atrium's look reads even this small.
        context.globalAlpha = trace.type === 'shape' && trace.shapeColor ? 0.85 : 1
        const colour = trace.type === 'shape' && trace.shapeColor ? trace.shapeColor : `rgb(${ink} / ${trace.type === 'image' || trace.type === 'video' ? 0.55 : 0.32})`
        if (isPathTrace(trace) && (trace.shapePoints?.length ?? 0) > 1) {
          // A path as its line, not the box around it.
          context.setTransform(ratio * k, 0, 0, ratio * k, ratio * x, ratio * y)
          context.strokeStyle = colour
          context.lineWidth = Math.max(1 / k, trace.shapeOutlineWidth ?? 2)
          context.lineCap = context.lineJoin = 'round'
          context.stroke(new Path2D(pathOutline(trace.shapePoints as PathPoint[], trace.pathCurveType)))
          context.setTransform(ratio, 0, 0, ratio, 0, 0)
          continue
        }
        context.fillStyle = colour
        context.fillRect(box.minX * k + x, box.minY * k + y, Math.max(1, (box.maxX - box.minX) * k), Math.max(1, (box.maxY - box.minY) * k))
      }
      placeFrame()
    }
    draw()
    const stop = useGameStore.subscribe((state, before) => {
      if (state.traces !== before.traces && !timer) timer = window.setTimeout(draw, REDRAW_MS)
    })
    return () => { stop(); window.clearTimeout(timer) }
  }, [])

  useImperativeHandle(ref, () => ({
    frame(x, y, zoom, width, height) {
      const was = last.current
      if (x === was.x && y === was.y && zoom === was.zoom && width === was.width && height === was.height) return
      last.current = { x, y, zoom, width, height }
      placeFrame()
      // Shown while the view moves, and a moment after.
      boxRef.current?.classList.add('minimap-shown')
      window.clearTimeout(hideTimer.current)
      hideTimer.current = window.setTimeout(() => { if (!pointedAt.current) boxRef.current?.classList.remove('minimap-shown') }, STAYS_MS)
    },
  }), [])
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  // Pointed at: the pointer over it with no button held, for DWELL_MS --
  // watched on the window, as it takes no pointer until then. Its place is
  // worked out from the window's size, so a move reads no layout.
  const dragging = useRef(false)
  useEffect(() => {
    let dwell = 0
    const point = (on: boolean) => {
      const box = boxRef.current
      if (!box || pointedAt.current === on) return
      pointedAt.current = on
      box.classList.toggle('minimap-pointed', on)
      if (on) box.classList.add('minimap-shown')
      else {
        window.clearTimeout(hideTimer.current)
        hideTimer.current = window.setTimeout(() => boxRef.current?.classList.remove('minimap-shown'), STAYS_MS)
      }
    }
    const move = (e: PointerEvent) => {
      if (dragging.current) return
      const right = window.innerWidth - RIGHT, bottom = window.innerHeight - BOTTOM
      const over = e.clientX >= right - WIDTH && e.clientX <= right && e.clientY >= bottom - HEIGHT && e.clientY <= bottom
      if (!over || e.buttons) {
        window.clearTimeout(dwell)
        dwell = 0
        point(false)
      } else if (!pointedAt.current && !dwell) {
        dwell = window.setTimeout(() => { dwell = 0; point(true) }, DWELL_MS)
      }
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => { window.removeEventListener('pointermove', move); window.clearTimeout(dwell) }
  }, [])

  // A press or a drag: the view's middle to that point of the atrium.
  const goTo = (event: React.PointerEvent) => {
    const { scale, x, y } = map.current
    const rect = event.currentTarget.getBoundingClientRect()
    if (scale) onMove((event.clientX - rect.left - x) / scale, (event.clientY - rect.top - y) / scale)
  }

  return (
    <div
      ref={boxRef}
      data-hud="true"
      role="img"
      aria-label={t('atrium.minimap')}
      className="minimap fixed bottom-16 right-4 z-[9999] border border-nier-border/40 overflow-hidden cursor-crosshair touch-none"
      style={{ width: WIDTH, height: HEIGHT, backgroundColor: 'rgb(var(--c-ground) / 0.82)' }}
      onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); goTo(event) }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) goTo(event) }}
      onLostPointerCapture={() => { dragging.current = false }}
    >
      <canvas ref={canvasRef} style={{ width: WIDTH, height: HEIGHT, display: 'block' }} />
      <div ref={viewRef} className="absolute top-0 left-0 border border-nier-strong/80 pointer-events-none" style={{ backgroundColor: 'rgb(var(--c-strong) / 0.08)' }} />
    </div>
  )
})

export default Minimap
