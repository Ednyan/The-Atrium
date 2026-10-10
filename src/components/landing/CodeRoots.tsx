// The Atrium's roots: its own code, growing down the page's margins as it's
// read -- the files most connected to the rest (scripts/make-code-roots.mjs,
// from the graph graphify keeps), sized by how much is in them, threaded to
// the ones they call on, and gathering at the end into the way to the code
// history. Drawn from `from` (the top of a chapter) down to `to` (the button).
//
// Decorative: hidden from screen readers, and not drawn where the margins
// are too narrow to hold it. Drawn whole without motion.

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useLandingMotion } from '../../lib/landingMotion'
import roots from './codeRoots.json'

// `both`: a root down each margin -- or, where the right one would run
// into the section rail, the left alone. `reach`: half the button's width.
interface Layout { width: number; top: number; height: number; side: number; labels: boolean; both: boolean; reach: number }
type Pt = [number, number]

// Smooth through points (Catmull-Rom, as cubic curves).
function through(points: Pt[]): string {
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)]
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }
  return d
}

export default function CodeRoots({ host, from, to }: { host: RefObject<HTMLElement>; from: RefObject<HTMLElement>; to: RefObject<HTMLElement> }) {
  const motion = useLandingMotion()
  const [layout, setLayout] = useState<Layout | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  // Measured again whenever the page's height or width changes.
  useEffect(() => {
    const page = host.current
    if (!page) return
    const measure = () => {
      const a = from.current, b = to.current
      if (!a || !b) return
      const base = page.getBoundingClientRect()
      const width = page.clientWidth
      // The space either side of the page's widest content (1400px).
      const margin = (width - 1400) / 2
      // The same test as the paragraph about them (WhyChapter).
      if (!window.matchMedia('(min-width: 1100px)').matches) { setLayout(null); return }
      const top = a.getBoundingClientRect().top - base.top
      const end = b.getBoundingClientRect()
      setLayout({
        width, top,
        height: end.top + end.height / 2 - base.top - top,
        side: Math.max(22, Math.min(140, margin * 0.5)),
        labels: margin > 170,
        both: margin > 90,
        reach: end.width / 2 + 14,
      })
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(page)
    return () => watch.disconnect()
  }, [host, from, to])

  const drawing = useMemo(() => {
    if (!layout) return null
    const { width, height, side, both, reach } = layout
    const wave = (y: number, s: number) => side * s + Math.sin(y / 210 + s) * 10
    const xAt = (left: boolean, y: number) => (left ? wave(y, 1) : width - wave(y, 1.3))
    const files = roots.files
    const turn = height - 110
    const first = 160, last = height - 300
    // A root: down its margin to the button's level, then turning in along
    // it, through the empty space beside the button, to its side.
    const root = (left: boolean): string => {
      const pts: Pt[] = []
      for (let y = 0; y < turn; y += 120) pts.push([xAt(left, y), y])
      pts.push([xAt(left, turn), turn])
      const x = xAt(left, turn), toward = left ? 1 : -1
      return `${through(pts)} Q${x},${height} ${x + toward * 110},${height} L${width / 2 - toward * reach},${height}`
    }
    // The files, in turn down the margins.
    const nodes = files.map((file, i) => {
      const left = !both || i % 2 === 0
      const place = both ? Math.floor(i / 2) : i, places = both ? Math.ceil(files.length / 2) : files.length
      const y = first + (place / Math.max(1, places - 1)) * (last - first)
      return { ...file, left, x: xAt(left, y), y, r: 1.6 + Math.sqrt(file.size) * 0.32 }
    })
    // Their calls on each other, on the same side and not too far apart.
    const branches = roots.links
      .filter(([a, b]) => nodes[a].left === nodes[b].left && Math.abs(nodes[a].y - nodes[b].y) < 1100)
      .slice(0, 70)
      .map(([a, b, w]) => {
        const p = nodes[a], q = nodes[b], out = p.left ? -1 : 1
        const reach = Math.min(110, 26 + w * 2.2)
        const midY = (p.y + q.y) / 2
        return { d: `M${p.x},${p.y} Q${(p.x + q.x) / 2 + out * reach},${midY} ${q.x},${q.y}`, low: Math.max(p.y, q.y), weight: w }
      })
    return { left: root(true), right: both ? root(false) : null, nodes, branches }
  }, [layout])

  // Grown with the scroll: each root drawn as far as the page has been read,
  // a file and its threads appearing as the root reaches them.
  useEffect(() => {
    const el = svg.current
    if (!el || !drawing || !layout) return
    const mains = [...el.querySelectorAll<SVGPathElement>('.root-main')]
    const lengths = mains.map(p => p.getTotalLength())
    mains.forEach((p, i) => { p.style.strokeDasharray = `${lengths[i]}` })
    const parts = [...el.querySelectorAll<SVGElement>('[data-at]')]
    const grow = (progress: number) => {
      mains.forEach((p, i) => { p.style.strokeDashoffset = `${lengths[i] * (1 - progress)}` })
      const reached = progress * layout.height
      for (const part of parts) part.classList.toggle('is-reached', Number(part.dataset.at) <= reached)
    }
    if (!motion) { grow(1); return }
    const trigger = motion.ScrollTrigger.create({ trigger: el, start: 'top 75%', end: 'bottom 55%', onUpdate: self => grow(self.progress) })
    grow(trigger.progress)
    return () => trigger.kill()
  }, [motion, drawing, layout])

  if (!layout || !drawing) return null
  return (
    <svg
      ref={svg}
      aria-hidden="true"
      className="code-roots absolute left-0 pointer-events-none"
      style={{ top: layout.top, width: layout.width, height: layout.height }}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
    >
      {drawing.branches.map((b, i) => (
        <path key={i} d={b.d} data-at={b.low} className="root-branch" style={{ strokeOpacity: Math.min(0.5, 0.12 + b.weight / 40) }} />
      ))}
      <path d={drawing.left} className="root-main" />
      {drawing.right && <path d={drawing.right} className="root-main" />}
      {drawing.nodes.map(n => (
        <g key={n.path} data-at={n.y} className="root-node">
          <circle cx={n.x} cy={n.y} r={n.r} />
          {layout.labels && (
            <text x={n.left ? n.x + n.r + 8 : n.x - n.r - 8} y={n.y + 3} textAnchor={n.left ? 'start' : 'end'}>{n.name}</text>
          )}
        </g>
      ))}
    </svg>
  )
}
