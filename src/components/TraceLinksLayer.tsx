import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { arrowhead, bend, curveEntry, curveMiddle, restOf, type LinkArrow, type TraceLink } from '../lib/traceLinks'
import { Check, ColourField, Slider } from './ShapeStyleControls'

// Where a trace is, in world units: its centre, its box's half-size and turn
// (radians), and the colour its border is drawn in (a thread's colour when it
// has none of its own).
export interface LinkEnd { x: number; y: number; hw: number; hh: number; turn: number; colour: string }

type Parts = {
  line?: SVGPathElement | null
  glow?: SVGPathElement | null
  hit?: SVGPathElement | null
  headTo?: SVGPolygonElement | null
  headFrom?: SVGPolygonElement | null
  middle?: HTMLDivElement | null
}

// The slack: each thread's bend is a point on a spring, in world units, that
// chases where the bend should be. When a trace at either end moves, the
// thread swings after it and settles with a small bounce; panning or zooming
// moves nothing in the world, so it leaves the threads still.
const SLACK = (2 * Math.PI) / 700
const SLACK_DAMPING = 0.45

/**
 * The threads between traces, under every trace. React says which threads
 * exist and how they look; where they run is written straight to the SVG by
 * layout(), after every render and on every frame while any of them is still
 * swinging -- so a thread can move without re-rendering every trace.
 */
export default function TraceLinksLayer({
  links, place, offsets, zoom, worldOffset, selected, primary, preview, canEdit, onPress, onMenu, onDelete, wakeRef,
}: {
  links: TraceLink[]
  place: (traceId: string) => LinkEnd | null
  // The drag feel's trail on each moving trace, in screen pixels: the threads
  // follow the trace where it's drawn, not only where it is.
  offsets: React.MutableRefObject<Map<string, { x: number; y: number }>>
  zoom: number
  worldOffset: { x: number; y: number }
  selected: Set<string>
  primary: string | null
  preview: { from: string[]; to: { x: number; y: number } } | null
  canEdit: boolean
  onPress: (id: string, e: React.PointerEvent) => void
  onMenu: (id: string, e: React.MouseEvent) => void
  onDelete: () => void
  wakeRef: React.MutableRefObject<() => void>
}) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState<string | null>(null)
  const parts = useRef(new Map<string, Parts>())
  const springs = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>())
  const latest = useRef({ links, place, zoom, worldOffset })
  latest.current = { links, place, zoom, worldOffset }
  const frame = useRef(0)
  const lastTick = useRef(0)

  const part = (id: string, key: keyof Parts) => (el: any) => {
    const entry = parts.current.get(id) ?? {}
    entry[key] = el
    parts.current.set(id, entry)
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
      const d = `M ${sa.x} ${sa.y} Q ${c.x} ${c.y} ${sb.x} ${sb.y}`
      el.line.setAttribute('d', d)
      el.glow?.setAttribute('d', d)
      el.hit?.setAttribute('d', d)
      // Arrow tips where the curve meets the border, aimed along it.
      const head = (poly: SVGPolygonElement | null | undefined, end: LinkEnd, at: { x: number; y: number }, from: { x: number; y: number }) => {
        if (!poly) return
        const tip = curveEntry(from.x, from.y, c.x, c.y, at.x, at.y, end.hw * zoom, end.hh * zoom, end.turn)
        if (!tip) { poly.setAttribute('points', ''); return }
        const p = arrowhead(tip.x, tip.y, tip.x - tip.dx, tip.y - tip.dy, 6 + Math.max(0.75, link.width * Math.sqrt(zoom)) * 2)
        poly.setAttribute('points', `${p[0]},${p[1]} ${p[2]},${p[3]} ${p[4]},${p[5]}`)
      }
      head(el.headTo, b, sb, sa)
      head(el.headFrom, a, sa, sb)
      if (el.middle) {
        const mid = curveMiddle(sa.x, sa.y, c.x, c.y, sb.x, sb.y)
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
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
        {links.map(link => {
          const a = place(link.from)
          if (!a || !place(link.to)) return null
          const colour = link.color || a.colour
          const width = Math.max(0.75, link.width * Math.sqrt(zoom))
          const isSelected = selected.has(link.id)
          return (
            <g key={link.id}>
              {isSelected && <path ref={part(link.id, 'glow')} fill="none" stroke={colour} strokeOpacity={0.25} strokeWidth={width + 8} strokeLinecap="round" />}
              <path ref={part(link.id, 'line')} fill="none" stroke={colour} strokeOpacity={isSelected ? 1 : 0.75} strokeWidth={isSelected ? width + 1 : width} strokeLinecap="round" />
              {(link.arrow === 'forward' || link.arrow === 'both') && <polygon ref={part(link.id, 'headTo')} fill={colour} />}
              {(link.arrow === 'back' || link.arrow === 'both') && <polygon ref={part(link.id, 'headFrom')} fill={colour} />}
              {/* Wider than it looks, and invisible, so a thin thread can still
                  be hovered and clicked. Where it runs under a trace, the trace
                  gets the click. */}
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
            </g>
          )
        })}
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

      {/* At each thread's middle: its label -- always, or for a thread set to
          show it on hover, while hovered or selected (how touch gets to it) --
          and on the one last clicked, the delete button. */}
      {links.map(link => {
        const showLabel = !!link.label && (!link.labelOnHover || hovered === link.id || selected.has(link.id))
        const showDelete = canEdit && primary === link.id
        if (!showLabel && !showDelete) return null
        return (
          <div
            key={`middle-${link.id}`}
            ref={part(link.id, 'middle')}
            data-link={link.id}
            className="absolute flex flex-col items-center gap-1.5 pointer-events-none"
            style={{ transform: 'translate(-50%, -50%)', zIndex: 999998 }}
          >
            {showLabel && (
              <div
                className="px-2 py-0.5 text-[11px] tracking-wide whitespace-nowrap border font-mono"
                style={{ color: 'rgb(var(--c-fg))', background: 'rgb(var(--c-ground) / 0.92)', borderColor: link.color || place(link.from)?.colour }}
              >
                {link.label}
              </div>
            )}
            {showDelete && (
              <button
                className="pointer-events-auto px-2.5 py-1 text-[10px] tracking-[0.18em] uppercase border transition-colors"
                style={{ color: 'rgb(var(--c-danger))', background: 'rgb(var(--c-ground) / 0.94)', borderColor: 'rgb(var(--c-danger) / 0.55)' }}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onDelete() }}
              >
                ✕ {selected.size > 1 ? t('atrium.links.deleteMany', { count: selected.size }) : t('atrium.links.delete')}
              </button>
            )}
          </div>
        )
      })}
    </>
  )
}

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
      </div>
      <div>
        <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.links.line')}</label>
        <div className="grid grid-cols-2 gap-1">
          {([false, true] as const).map(straight => (
            <button
              key={String(straight)}
              type="button"
              aria-pressed={first.straight === straight}
              onClick={() => onEdit({ straight })}
              className={`h-8 border text-[10px] tracking-[0.15em] uppercase transition-colors ${first.straight === straight
                ? 'border-nier-bg bg-nier-bg/15 text-nier-strong'
                : 'border-nier-border/40 text-nier-bg/70 hover:border-nier-border/70 hover:text-nier-strong'}`}
            >
              {straight ? t('atrium.links.straight') : t('atrium.links.curved')}
            </button>
          ))}
        </div>
      </div>
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
