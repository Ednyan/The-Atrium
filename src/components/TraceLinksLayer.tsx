import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { LABEL_SIZE_RANGE, arrowhead, bend, curveMiddle, restOf, visiblePart, type LinkArrow, type TraceLink } from '../lib/traceLinks'
import { ELBOW_RADIUS, elbowAtFor, elbowAxis, elbowGrip, elbowRoute, roundedPath, trimEnds } from '../lib/elbow'
import { Check, ColourField, Slider } from './ShapeStyleControls'

// Where a trace is, in world units: its centre, its box's half-size and turn
// (radians), the colour its border is drawn in (a thread's colour when it
// has none of its own), and its level (its CSS z-index).
export interface LinkEnd { x: number; y: number; hw: number; hh: number; turn: number; colour: string; z: number }

// How wide a thread is drawn, in screen pixels, and the arrowheads on it.
const lineWidth = (link: TraceLink, zoom: number) => Math.max(0.75, link.width * Math.sqrt(zoom))
const headSize = (link: TraceLink, zoom: number) => 6 + lineWidth(link, zoom) * 2
const headsTo = (link: TraceLink) => link.arrow === 'forward' || link.arrow === 'both'
const headsFrom = (link: TraceLink) => link.arrow === 'back' || link.arrow === 'both'

// A sheet the size of the view, in screen pixels, that draws nothing itself:
// no viewBox and no clip, so a thread's paths are painted as if they were
// the layer's own. An SVG boxed to its thread, with the viewBox and clip that
// takes, split the painting at every thread: zooming with 400 threads on
// screen, the browser spent 1.8s grouping it into layers against 1.1s.
// ponytail: a thread between two traces breaks the GPU's batching of their
// drawing, so with hundreds of threads on screen a zoom rasterises ~40%
// longer (400: 67 -> 50fps; 60: no difference). If that ever matters, draw a
// thread at the very bottom, together, when no trace below its level overlaps it.
const SHEET = { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' } as const

type Parts = {
  line?: SVGPathElement | null
  glow?: SVGPathElement | null
  hit?: SVGPathElement | null
  headTo?: SVGPolygonElement | null
  headFrom?: SVGPolygonElement | null
  middle?: HTMLDivElement | null
  grip?: HTMLDivElement | null
}


// The slack: each thread's bend is a point on a spring, in world units, that
// chases where the bend should be. When a trace at either end moves, the
// thread swings after it and settles with a small bounce; panning or zooming
// moves nothing in the world, so it leaves the threads still.
const SLACK = (2 * Math.PI) / 700
const SLACK_DAMPING = 0.45

/**
 * The threads between traces. Each is drawn at the level of the lower of its
 * two traces, just under it (and under its light): above everything that
 * trace is above, below both its traces. It runs from border to border, so
 * nothing of it is inside either trace, where it would only show through a
 * transparent one. React says which threads exist and how they look; where
 * they run is written straight to the SVG by layout(), after every render
 * and on every frame while any of them is still swinging -- so a thread can
 * move without re-rendering every trace.
 */
export default function TraceLinksLayer({
  links, place, offsets, zoom, worldOffset, selected, preview, canEdit, onPress, onMenu, onElbowAt, wakeRef,
}: {
  links: TraceLink[]
  place: (traceId: string) => LinkEnd | null
  // The drag feel's trail on each moving trace, in screen pixels: the threads
  // follow the trace where it's drawn, not only where it is.
  offsets: React.MutableRefObject<Map<string, { x: number; y: number }>>
  zoom: number
  worldOffset: { x: number; y: number }
  selected: Set<string>
  preview: { from: string[]; to: { x: number; y: number } } | null
  canEdit: boolean
  onPress: (id: string, e: React.PointerEvent) => void
  onMenu: (id: string, e: React.MouseEvent) => void
  // An elbow's middle run dragged to `at`; `done` when it's let go.
  onElbowAt: (id: string, at: number, done: boolean) => void
  wakeRef: React.MutableRefObject<() => void>
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const parts = useRef(new Map<string, Parts>())
  const springs = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>())
  const latest = useRef({ links, place, zoom, worldOffset })
  latest.current = { links, place, zoom, worldOffset }
  const frame = useRef(0)
  const lastTick = useRef(0)

  // What each thread was last drawn from: while that holds, it's left as
  // it is, so moving one trace redraws its threads and no others.
  const drawn = useRef(new Map<string, string>())
  // One callback per element, kept, so a render that changes nothing hands
  // React nothing to re-attach; a new element (a glow on selecting, say)
  // gets the thread drawn afresh.
  const refs = useRef(new Map<string, (el: any) => void>())
  const part = (id: string, key: keyof Parts) => {
    const name = `${id} ${key}`
    let ref = refs.current.get(name)
    if (!ref) {
      ref = (el: any) => {
        const entry = parts.current.get(id) ?? {}
        entry[key] = el
        parts.current.set(id, entry)
        drawn.current.delete(id)
      }
      refs.current.set(name, ref)
    }
    return ref
  }

  // Lays every thread out from where its traces are drawn now, first letting
  // each bend chase its rest for dt milliseconds. True while any is moving.
  const layout = (dt: number) => {
    const { links, place, zoom, worldOffset } = latest.current
    const screen = (x: number, y: number) => ({ x: x * zoom + worldOffset.x, y: y * zoom + worldOffset.y })
    let stirring = false
    for (const link of links) {
      const el = parts.current.get(link.id)
      const a = place(link.from), b = place(link.to)
      if (!el?.line || !a || !b) continue
      const oa = offsets.current.get(link.from), ob = offsets.current.get(link.to)
      if (oa || ob) stirring = true
      const ax = a.x + (oa ? oa.x / zoom : 0), ay = a.y + (oa ? oa.y / zoom : 0)
      const bx = b.x + (ob ? ob.x / zoom : 0), by = b.y + (ob ? ob.y / zoom : 0)

      // An elbow: routed between the two boxes (lib/elbow), border to
      // border, with no slack to swing.
      if (link.elbow) {
        const from = `elbow ${ax} ${ay} ${bx} ${by} ${a.hw} ${a.hh} ${b.hw} ${b.hh} ${zoom} ${worldOffset.x} ${worldOffset.y} ${link.width} ${link.arrow} ${link.elbowAt}`
        if (drawn.current.get(link.id) === from) continue
        drawn.current.set(link.id, from)
        const route = elbowRoute({ x: ax, y: ay, hw: a.hw, hh: a.hh }, { x: bx, y: by, hw: b.hw, hh: b.hh }, link.elbowAt).map(p => screen(p.x, p.y))
        const size = headSize(link, zoom)
        const d = roundedPath(trimEnds(route, headsFrom(link) ? size * 0.8 : 0, headsTo(link) ? size * 0.8 : 0), ELBOW_RADIUS * zoom)
        el.line.setAttribute('d', d)
        el.glow?.setAttribute('d', d)
        el.hit?.setAttribute('d', d)
        const n = route.length
        const head = (poly: SVGPolygonElement | null | undefined, tip: { x: number; y: number }, behind: { x: number; y: number }) => {
          if (!poly) return
          const p = arrowhead(tip.x, tip.y, behind.x, behind.y, size)
          poly.setAttribute('points', `${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]}`)
        }
        head(el.headTo, route[n - 1], route[n - 2])
        head(el.headFrom, route[0], route[1])
        const grip = elbowGrip(route)
        for (const node of [el.middle, el.grip]) {
          if (!node) continue
          node.style.left = `${grip.x}px`
          node.style.top = `${grip.y}px`
        }
        continue
      }

      const rest = restOf(link.straight, ax, ay, bx, by)
      let sp = springs.current.get(link.id)
      if (!sp) springs.current.set(link.id, sp = { x: rest.x, y: rest.y, vx: 0, vy: 0 })
      for (let left = dt; left > 0; left -= 4) {
        const h = Math.min(left, 4)
        sp.vx += (SLACK * SLACK * (rest.x - sp.x) - 2 * SLACK_DAMPING * SLACK * sp.vx) * h
        sp.vy += (SLACK * SLACK * (rest.y - sp.y) - 2 * SLACK_DAMPING * SLACK * sp.vy) * h
        sp.x += sp.vx * h
        sp.y += sp.vy * h
      }
      if (Math.hypot(rest.x - sp.x, rest.y - sp.y) * zoom > 0.1 || Math.hypot(sp.vx, sp.vy) * zoom > 0.002) stirring = true

      const sa = screen(ax, ay), sb = screen(bx, by), c = screen(sp.x, sp.y)
      const from = `${sa.x} ${sa.y} ${c.x} ${c.y} ${sb.x} ${sb.y} ${a.hw} ${a.hh} ${a.turn} ${b.hw} ${b.hh} ${b.turn} ${zoom} ${link.width} ${link.arrow} ${link.toCenter}`
      if (drawn.current.get(link.id) === from) continue
      drawn.current.set(link.id, from)
      // Border to border; an end with an arrowhead stops under its base. Or,
      // set to, centre to centre, running on under both traces -- with its
      // arrowheads still on the borders, where they can be seen.
      const size = headSize(link, zoom)
      const seen = visiblePart(
        sa.x, sa.y, c.x, c.y, sb.x, sb.y,
        { hw: a.hw * zoom, hh: a.hh * zoom, turn: a.turn }, { hw: b.hw * zoom, hh: b.hh * zoom, turn: b.turn },
        !link.toCenter && headsFrom(link) ? size * 0.8 : 0, !link.toCenter && headsTo(link) ? size * 0.8 : 0,
      )
      const d = link.toCenter
        ? `M ${sa.x} ${sa.y} Q ${c.x} ${c.y} ${sb.x} ${sb.y}`
        : seen ? `M ${seen.x0} ${seen.y0} Q ${seen.cx} ${seen.cy} ${seen.x1} ${seen.y1}` : ''
      el.line.setAttribute('d', d)
      el.glow?.setAttribute('d', d)
      el.hit?.setAttribute('d', d)
      // Arrow tips where the curve meets the border, aimed along it.
      const head = (poly: SVGPolygonElement | null | undefined, tip: { x: number; y: number; dx: number; dy: number } | undefined) => {
        if (!poly) return
        if (!tip) { poly.setAttribute('points', ''); return }
        const p = arrowhead(tip.x, tip.y, tip.x - tip.dx, tip.y - tip.dy, size)
        poly.setAttribute('points', `${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]}`)
      }
      head(el.headTo, seen?.to)
      head(el.headFrom, seen?.from)
      if (el.middle) {
        const mid = seen && !link.toCenter
          ? curveMiddle(seen.x0, seen.y0, seen.cx, seen.cy, seen.x1, seen.y1)
          : curveMiddle(sa.x, sa.y, c.x, c.y, sb.x, sb.y)
        el.middle.style.left = `${mid.x}px`
        el.middle.style.top = `${mid.y}px`
      }
    }
    return stirring
  }

  const tick = (now: number) => {
    const dt = Math.min(now - lastTick.current, 48)
    lastTick.current = now
    frame.current = layout(dt) ? requestAnimationFrame(tick) : 0
  }
  const wake = () => {
    if (frame.current) return
    lastTick.current = performance.now()
    frame.current = requestAnimationFrame(tick)
  }
  wakeRef.current = wake

  // After every render: traces may have moved, threads come or gone.
  useLayoutEffect(() => { if (layout(0)) wake() })
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const screenOf = (end: LinkEnd) => ({ x: end.x * zoom + worldOffset.x, y: end.y * zoom + worldOffset.y })

  return (
    <>
      {/* An SVG each, so each can sit at its own level among the traces;
          the one for the thread being drawn goes under them all. */}
      {links.map(link => {
        const a = place(link.from), b = place(link.to)
        if (!a || !b) return null
        const colour = link.color || a.colour
        const width = lineWidth(link, zoom)
        const isSelected = selected.has(link.id)
        return (
          <svg key={link.id} style={{ ...SHEET, zIndex: Math.min(a.z, b.z) - 2 }}>
            {isSelected && <path ref={part(link.id, 'glow')} fill="none" stroke={colour} strokeOpacity={0.25} strokeWidth={width + 8} strokeLinecap="round" />}
            <path ref={part(link.id, 'line')} fill="none" stroke={colour} strokeOpacity={isSelected ? 1 : 0.75} strokeWidth={isSelected ? width + 1 : width} strokeLinecap="round" />
            {headsTo(link) && <polygon ref={part(link.id, 'headTo')} fill={colour} />}
            {headsFrom(link) && <polygon ref={part(link.id, 'headFrom')} fill={colour} />}
            {/* Wider than it looks, and invisible, so a thin thread can still
                be hovered and clicked. Where a trace above covers it, the
                trace gets the click. */}
            <path
              ref={part(link.id, 'hit')}
              data-link={link.id}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(12, width + 10)}
              style={{ pointerEvents: 'stroke' }}
              onPointerDown={e => onPress(link.id, e)}
              onContextMenu={e => onMenu(link.id, e)}
              onPointerEnter={() => setHovered(link.id)}
              onPointerLeave={() => setHovered(h => (h === link.id ? null : h))}
            />
          </svg>
        )
      })}
      <svg style={SHEET}>
        {preview && preview.from.map(id => {
          const from = place(id)
          if (!from) return null
          const s = screenOf(from), c = bend(s.x, s.y, preview.to.x, preview.to.y)
          return (
            <path
              key={`preview-${id}`}
              d={`M ${s.x} ${s.y} Q ${c.x} ${c.y} ${preview.to.x} ${preview.to.y}`}
              fill="none" stroke={from.colour} strokeOpacity={0.8} strokeWidth={1.5} strokeDasharray="6 6"
            />
          )
        })}
      </svg>

      {/* An elbow's middle run, selected, has a grip: dragged, the run moves
          across between its ends (elbowAt). */}
      {canEdit && links.map(link => {
        if (!link.elbow || !selected.has(link.id)) return null
        const a = place(link.from), b = place(link.to)
        if (!a || !b) return null
        const across = elbowAxis({ x: a.x, y: a.y, hw: a.hw, hh: a.hh }, { x: b.x, y: b.y, hw: b.hw, hh: b.hh }) === 'x'
        return (
          <div
            key={`grip-${link.id}`}
            ref={part(link.id, 'grip')}
            data-link={link.id}
            data-elbow-grip=""
            className="absolute trace-nier-handle trace-nier-handle-edge pointer-events-auto"
            style={{ transform: 'translate(-50%, -50%)', zIndex: 999999, cursor: across ? 'ew-resize' : 'ns-resize' }}
            onPointerDown={e => {
              e.stopPropagation()
              e.preventDefault()
              const target = e.currentTarget
              target.setPointerCapture(e.pointerId)
              const at = (ev: PointerEvent) => {
                const { zoom, worldOffset, place } = latest.current
                const from = place(link.from), to = place(link.to)
                if (!from || !to) return null
                const world = { x: (ev.clientX - worldOffset.x) / zoom, y: (ev.clientY - worldOffset.y) / zoom }
                return elbowAtFor({ x: from.x, y: from.y, hw: from.hw, hh: from.hh }, { x: to.x, y: to.y, hw: to.hw, hh: to.hh }, world)
              }
              const move = (ev: PointerEvent) => { const value = at(ev); if (value !== null) onElbowAt(link.id, value, false) }
              const up = (ev: PointerEvent) => {
                target.removeEventListener('pointermove', move)
                target.removeEventListener('pointerup', up)
                target.removeEventListener('pointercancel', up)
                const value = at(ev)
                onElbowAt(link.id, value ?? link.elbowAt, true)
              }
              target.addEventListener('pointermove', move)
              target.addEventListener('pointerup', up)
              target.addEventListener('pointercancel', up)
            }}
          />
        )
      })}

      {/* At each thread's middle, its label: always, or for a thread set to
          show it on hover, while hovered or selected (how touch gets to it).
          No delete button there -- it sat in the way of taking hold of the
          thread; Delete and the thread's menu delete it. */}
      {links.map(link => {
        const showLabel = !!link.label && (!link.labelOnHover || hovered === link.id || selected.has(link.id))
        if (!showLabel) return null
        // An elbow's grip is where the label sits: selected, the label steps
        // up off it, so the grip can be seen and taken.
        const gripShown = canEdit && link.elbow && selected.has(link.id)
        return (
          <div
            key={`middle-${link.id}`}
            ref={part(link.id, 'middle')}
            data-link={link.id}
            className="absolute pointer-events-none"
            style={{ transform: gripShown ? 'translate(-50%, calc(-100% - 12px))' : 'translate(-50%, -50%)', zIndex: 999998 }}
          >
            <div
              className="tracking-wide whitespace-nowrap border font-mono"
              style={{
                color: 'rgb(var(--c-fg))',
                background: 'rgb(var(--c-ground) / 0.92)',
                borderColor: link.color || place(link.from)?.colour,
                // Its size in the world, like the thread's: the text at its
                // label size, and the box around it in proportion.
                fontSize: `${link.labelSize * zoom}px`,
                lineHeight: 1.35,
                padding: '0.15em 0.65em',
              }}
            >
              {link.label}
            </div>
          </div>
        )
      })}
    </>
  )
}

// How a thread runs: hanging in a curve, straight, or as an elbow.
type Line = 'curved' | 'straight' | 'elbow'
const lineOf = (link: TraceLink): Line => (link.elbow ? 'elbow' : link.straight ? 'straight' : 'curved')
const LINES: { line: Line; key: 'atrium.links.curved' | 'atrium.links.straight' | 'atrium.links.elbow'; patch: Partial<TraceLink> }[] = [
  { line: 'curved', key: 'atrium.links.curved', patch: { straight: false, elbow: false } },
  { line: 'straight', key: 'atrium.links.straight', patch: { straight: true, elbow: false } },
  { line: 'elbow', key: 'atrium.links.elbow', patch: { elbow: true } },
]

const ARROWS: { arrow: LinkArrow; glyph: string; key: 'atrium.links.arrowNone' | 'atrium.links.arrowForward' | 'atrium.links.arrowBack' | 'atrium.links.arrowBoth' }[] = [
  { arrow: 'none', glyph: '—', key: 'atrium.links.arrowNone' },
  { arrow: 'forward', glyph: '→', key: 'atrium.links.arrowForward' },
  { arrow: 'back', glyph: '←', key: 'atrium.links.arrowBack' },
  { arrow: 'both', glyph: '↔', key: 'atrium.links.arrowBoth' },
]

/**
 * A thread's right-click menu, for every selected thread at once: colour (or
 * back to its trace's border colour), thickness, label, arrow, delete.
 */
export function LinkMenu({ at, links, borderOf, onEdit, onDelete, onClose }: {
  at: { x: number; y: number }
  links: TraceLink[]
  borderOf: (link: TraceLink) => string
  onEdit: (patch: Partial<TraceLink>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const first = links[0]
  const ref = useRef<HTMLDivElement>(null)
  // Kept on screen: opened near the bottom or right edge, it moves in.
  const [pos, setPos] = useState(at)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) })
  }, [at.x, at.y])
  useEffect(() => {
    const press = (e: PointerEvent) => { if (!(e.target as HTMLElement)?.closest?.('[data-link-menu]')) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', press, true); window.removeEventListener('keydown', key) }
  }, [onClose])
  if (!first) return null

  return (
    <div
      ref={ref}
      data-link-menu
      data-link={first.id}
      className="fixed z-[10000100] w-[280px] max-h-[80vh] overflow-y-auto bg-nier-black border border-nier-border/60 shadow-2xl p-4 flex flex-col gap-4 pointer-events-auto font-mono"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={e => e.preventDefault()}
    >
      <ColourField label={t('atrium.links.colour')} value={first.color || borderOf(first)} onChange={colour => onEdit({ color: colour })} />
      {links.some(l => l.color) && (
        <button
          type="button"
          className="-mt-2 self-start text-[10px] tracking-[0.15em] uppercase text-nier-bg/70 hover:text-nier-strong underline underline-offset-4"
          onClick={() => onEdit({ color: null })}
        >
          {t('atrium.links.matchBorder')}
        </button>
      )}
      <Slider label={t('atrium.links.thickness', { value: first.width })} min={0.5} max={12} step={0.5} value={first.width} onChange={width => onEdit({ width })} />
      <div>
        <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.links.label')}</label>
        <input
          type="text"
          value={first.label}
          maxLength={80}
          placeholder={t('atrium.links.labelPlaceholder')}
          onChange={e => onEdit({ label: e.target.value })}
          className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60"
        />
        <div className="mt-2.5">
          <Check checked={first.labelOnHover} onChange={labelOnHover => onEdit({ labelOnHover })} label={t('atrium.links.labelOnHover')} />
        </div>
        <div className="mt-3">
          <Slider label={t('atrium.links.labelSize', { value: first.labelSize })} min={LABEL_SIZE_RANGE.min} max={LABEL_SIZE_RANGE.max} step={1} value={first.labelSize} onChange={labelSize => onEdit({ labelSize })} />
        </div>
      </div>
      <div>
        <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.links.line')}</label>
        <div className="grid grid-cols-3 gap-1">
          {LINES.map(({ line, key, patch }) => {
            const on = lineOf(first) === line
            return (
              <button
                key={line}
                type="button"
                aria-pressed={on}
                onClick={() => onEdit(patch)}
                className={`h-8 border text-[10px] tracking-[0.15em] uppercase transition-colors ${on
                  ? 'border-nier-bg bg-nier-bg/15 text-nier-strong'
                  : 'border-nier-border/40 text-nier-bg/70 hover:border-nier-border/70 hover:text-nier-strong'}`}
              >
                {t(key)}
              </button>
            )
          })}
        </div>
      </div>
      {/* An elbow always runs border to border. */}
      {!first.elbow && <div>
        <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.links.ends')}</label>
        <div className="grid grid-cols-2 gap-1">
          {([false, true] as const).map(toCenter => (
            <button
              key={String(toCenter)}
              type="button"
              aria-pressed={first.toCenter === toCenter}
              onClick={() => onEdit({ toCenter })}
              className={`h-8 border text-[10px] tracking-[0.15em] uppercase transition-colors ${first.toCenter === toCenter
                ? 'border-nier-bg bg-nier-bg/15 text-nier-strong'
                : 'border-nier-border/40 text-nier-bg/70 hover:border-nier-border/70 hover:text-nier-strong'}`}
            >
              {toCenter ? t('atrium.links.toCenter') : t('atrium.links.toBorder')}
            </button>
          ))}
        </div>
      </div>}
      <div>
        <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.links.arrow')}</label>
        <div className="grid grid-cols-4 gap-1">
          {ARROWS.map(({ arrow, glyph, key }) => (
            <button
              key={arrow}
              type="button"
              title={t(key)}
              aria-label={t(key)}
              aria-pressed={first.arrow === arrow}
              onClick={() => onEdit({ arrow })}
              className={`h-8 border text-sm transition-colors ${first.arrow === arrow
                ? 'border-nier-bg bg-nier-bg/15 text-nier-strong'
                : 'border-nier-border/40 text-nier-bg/70 hover:border-nier-border/70 hover:text-nier-strong'}`}
            >
              {glyph}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="atrium-btn w-full"
        style={{ borderColor: 'rgb(var(--c-danger) / 0.55)', color: 'rgb(var(--c-danger))' }}
        onClick={onDelete}
      >
        {links.length > 1 ? t('atrium.links.deleteMany', { count: links.length }) : t('atrium.links.delete')}
      </button>
    </div>
  )
}
