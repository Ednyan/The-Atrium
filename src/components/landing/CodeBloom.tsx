// The way to the code history, in bloom: the communities graphify finds in
// the Atrium's code (scripts/make-code-roots.mjs), in graphify's own colours,
// each a tree of its symbols branching out from the button. Grown from it
// once it's in view; then, now and then, a pulse runs back along each trunk
// into the button. The space round the button and its caption is kept clear.
//
// Decorative: hidden from screen readers. Drawn whole without motion.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useLandingMotion } from '../../lib/landingMotion'
import roots from './codeRoots.json'

interface Box { x: number; y: number; w: number; h: number }
interface Measure { w: number; h: number; button: Box; clear: Box }

const boxIn = (el: Element, base: DOMRect): Box => {
  const r = el.getBoundingClientRect()
  return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height }
}
const inside = (x: number, y: number, b: Box, pad: number) => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad
// A gentle curve from a to b, bent to one side or the other.
const bend = (ax: number, ay: number, bx: number, by: number, side: number) => {
  const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay
  return `M${ax},${ay} Q${mx - dy * 0.14 * side},${my + dx * 0.14 * side} ${bx},${by}`
}

export default function CodeBloom({ stage, button, clear }: { stage: RefObject<HTMLElement>; button: RefObject<HTMLElement>; clear: RefObject<HTMLElement> }) {
  const motion = useLandingMotion()
  const [measure, setMeasure] = useState<Measure | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const grown = useRef(false)

  useEffect(() => {
    const el = stage.current
    if (!el || !button.current || !clear.current) return
    const update = () => {
      const base = el.getBoundingClientRect()
      if (!button.current || !clear.current) return
      setMeasure({ w: base.width, h: base.height, button: boxIn(button.current, base), clear: boxIn(clear.current, base) })
    }
    update()
    const watch = new ResizeObserver(update)
    watch.observe(el)
    watch.observe(clear.current)
    return () => watch.disconnect()
  }, [stage, button, clear])

  const drawing = useMemo(() => {
    if (!measure) return null
    const { w, h, button: b, clear: c } = measure
    const ox = b.x + b.w / 2, oy = b.y + b.h / 2
    const sx = w * 0.47, sy = h * 0.46
    const { groups, nodes, cross } = roots.bloom
    const at = nodes.map(([x, y]) => [ox + x * sx, oy + y * sy] as const)
    const kept = nodes.map((_, i) => !inside(at[i][0], at[i][1], c, 14))
    const scale = Math.max(0.75, Math.min(1.2, Math.min(w, h * 1.6) / 1100))
    // Where a trunk leaves the button: its edge, on the way to the root.
    const leave = (tx: number, ty: number) => {
      const dx = tx - ox, dy = ty - oy
      const t = Math.min((b.w / 2 + 3) / Math.abs(dx || 1e-6), (b.h / 2 + 3) / Math.abs(dy || 1e-6))
      return [ox + dx * t, oy + dy * t] as const
    }
    const lines = nodes.flatMap(([, , g, parent, depth], i) => {
      if (!kept[i]) return []
      const [x, y] = at[i]
      if (parent === -1) {
        const [sx0, sy0] = leave(x, y)
        return [{ d: bend(sx0, sy0, x, y, i % 2 ? 1 : -1), color: groups[g].color, depth: 0, trunk: true }]
      }
      if (!kept[parent]) return []
      return [{ d: bend(at[parent][0], at[parent][1], x, y, (i * 7) % 3 === 0 ? -1 : 1), color: groups[g].color, depth: depth + 1, trunk: false }]
    })
    const across = cross
      .filter(([i, j]) => kept[i] && kept[j])
      .map(([i, j]) => bend(at[i][0], at[i][1], at[j][0], at[j][1], 1))
    const dots = nodes.flatMap(([, , g, parent, depth, r], i) => (kept[i] ? [{ x: at[i][0], y: at[i][1], r: r * scale, color: groups[g].color, depth: depth + 1, root: parent === -1 }] : []))
    const labels = w >= 900
      ? nodes.flatMap(([, , g, parent], i) => (parent === -1 && kept[i] ? [{ x: at[i][0], y: at[i][1], name: groups[g].name, color: groups[g].color, right: at[i][0] >= ox }] : []))
      : []
    return { lines, across, dots, labels, deepest: Math.max(...lines.map(l => l.depth)) }
  }, [measure])

  // Grown once, outward from the button, when it's well in view.
  useEffect(() => {
    const el = svg.current
    if (!motion || !el || !drawing) return
    if (grown.current) { el.classList.add('is-grown'); return }
    const { gsap, ScrollTrigger } = motion
    const paths = [...el.querySelectorAll<SVGPathElement>('.bloom-line')]
    paths.forEach(p => { const n = p.getTotalLength(); p.style.strokeDasharray = `${n}`; p.style.strokeDashoffset = `${n}` })
    const dots = el.querySelectorAll('.bloom-dot, .bloom-label')
    gsap.set(dots, { opacity: 0, scale: 0, transformOrigin: 'center' })
    gsap.set(el.querySelector('.bloom-across'), { opacity: 0 })
    const tl = gsap.timeline({ paused: true, onComplete: () => { grown.current = true; el.classList.add('is-grown') } })
    for (let d = 0; d <= drawing.deepest; d++) {
      tl.to(paths.filter(p => Number(p.dataset.depth) === d), { strokeDashoffset: 0, duration: 0.6, ease: 'power2.out', stagger: 0.012 }, d * 0.3)
      tl.to(el.querySelectorAll(`[data-depth="${d}"].bloom-dot, [data-depth="${d}"].bloom-label`), { opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2.2)', stagger: 0.006 }, d * 0.3 + 0.4)
    }
    tl.to(el.querySelector('.bloom-across'), { opacity: 1, duration: 1.2 }, '-=0.6')
    const trigger = ScrollTrigger.create({ trigger: el, start: 'top 65%', once: true, onEnter: () => tl.play() })
    return () => { trigger.kill(); tl.kill() }
  }, [motion, drawing])

  if (!measure || !drawing) return null
  return (
    <svg ref={svg} aria-hidden="true" className={`code-bloom absolute inset-0 w-full h-full pointer-events-none ${motion ? '' : 'is-still'}`} viewBox={`0 0 ${measure.w} ${measure.h}`}>
      <g className="bloom-across">
        {drawing.across.map((d, i) => <path key={i} d={d} />)}
      </g>
      {drawing.lines.map((l, i) => (
        <path key={i} d={l.d} data-depth={l.depth} className={`bloom-line ${l.trunk ? 'is-trunk' : ''}`} style={{ stroke: l.color }} />
      ))}
      {drawing.lines.filter(l => l.trunk).map((l, i) => (
        <path key={i} d={l.d} className="bloom-flow" style={{ stroke: l.color, animationDelay: `${-(i * 0.73) % 3.2}s` }} />
      ))}
      {drawing.dots.map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r={dot.r} data-depth={dot.depth} className={`bloom-dot ${dot.root ? 'is-root' : ''}`} style={{ fill: dot.color, color: dot.color }} />
      ))}
      {drawing.labels.map(label => (
        <text key={label.name} x={label.x + (label.right ? 12 : -12)} y={label.y + 3.5} textAnchor={label.right ? 'start' : 'end'} data-depth={1} className="bloom-label" style={{ fill: label.color }}>{label.name}</text>
      ))}
    </svg>
  )
}
