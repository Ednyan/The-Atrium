// The landing page's title, made the way anything in an atrium is made: of
// traces. THE is a text trace, wearing its type's tab; DIGITAL and ATRIUM are a
// letter a trace, each in one of the atrium's own looks -- plain, sepia-edged,
// inked, a bare frame -- ATRIUM's letters in the title metal. They arrive as
// traces put down do, overshooting a little and settling (the drag feel's
// spring), lie a hair off true as hand-placed things do, and breathe. Every few
// seconds a cursor -- yours -- picks one up: the dashed selection and its
// handles hop to it and it lifts. Still, for anyone who asked for less motion.
//
// Sized by its column (cqi), so it's the same collage at any width. The words
// are the h1's label; the tiles are drawn for the eye only.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

type Look = 'plain' | 'sepia' | 'ink' | 'frame' | 'metal'
interface Tile { ch: string; look: Look; dx: number; dy: number; rot: number }

// Hand-placed, not random: the same collage on every visit.
const DIGITAL: Tile[] = [
  { ch: 'D', look: 'plain', dx: 0, dy: 0.02, rot: -1.6 },
  { ch: 'I', look: 'sepia', dx: 0, dy: -0.05, rot: 1.2 },
  { ch: 'G', look: 'ink', dx: 0, dy: 0.04, rot: -0.6 },
  { ch: 'I', look: 'plain', dx: 0, dy: -0.02, rot: 1.8 },
  { ch: 'T', look: 'frame', dx: 0, dy: 0.05, rot: -1.1 },
  { ch: 'A', look: 'plain', dx: 0, dy: -0.04, rot: 0.7 },
  { ch: 'L', look: 'sepia', dx: 0, dy: 0.03, rot: -1.4 },
]
const ATRIUM: Tile[] = [
  { ch: 'A', look: 'metal', dx: 0, dy: -0.03, rot: 1.3 },
  { ch: 'T', look: 'metal', dx: 0, dy: 0.04, rot: -0.9 },
  { ch: 'R', look: 'ink', dx: 0, dy: -0.02, rot: 1.6 },
  { ch: 'I', look: 'metal', dx: 0, dy: 0.05, rot: -1.5 },
  { ch: 'U', look: 'metal', dx: 0, dy: -0.04, rot: 0.8 },
  { ch: 'M', look: 'metal', dx: 0, dy: 0.02, rot: -0.7 },
]
// Where each comes from as it's put down, by its place: a short way off, turned.
const FROM = [[-0.6, -0.9, -14], [0.4, -1.2, 10], [-0.3, 0.9, -8], [0.7, -0.6, 12], [-0.5, 1.1, -10], [0.3, -1, 9], [-0.8, 0.7, -12]]
// The order the cursor picks them up in (indices across both words).
const HOPS = [9, 2, 12, 5, 7, 0, 10, 4, 11, 1]

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function TraceTitle({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLHeadingElement>(null)
  const tileRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [arrived, setArrived] = useState(false)
  const [hop, setHop] = useState(0)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number; size: number } | null>(null)
  const tiles = [...DIGITAL, ...ATRIUM]
  const picked = HOPS[hop % HOPS.length]

  useEffect(() => {
    const frame = requestAnimationFrame(() => setArrived(true))
    if (reduced()) return () => cancelAnimationFrame(frame)
    // The cursor waits for the letters to land, then picks one up every few seconds.
    let timer = window.setTimeout(function next() {
      setHop(h => h + 1)
      timer = window.setTimeout(next, 3400)
    }, 2600)
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer) }
  }, [])

  // Where the picked tile is, for the selection and the cursor.
  useLayoutEffect(() => {
    const measure = () => {
      const el = tileRefs.current[picked]
      if (!el) return
      // The tile's own box, unturned (offsets are the h1's: it's the nearest
      // positioned ancestor); its lie and turn are put on in em, below.
      setBox({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, size: parseFloat(getComputedStyle(el).fontSize) })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (rootRef.current) observer.observe(rootRef.current)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked])

  const tile = (t: Tile, i: number) => {
    const [fx, fy, frot] = FROM[i % FROM.length]
    return (
      <span
        key={i}
        ref={el => { tileRefs.current[i] = el }}
        className={`tt-tile ${picked === i && arrived ? 'is-picked' : ''}`}
        data-look={t.look}
        style={{
          '--i': i,
          '--rest': `translate(${t.dx}em, ${t.dy}em) rotate(${t.rot}deg)`,
          '--from': `translate(${fx}em, ${fy}em) rotate(${frot}deg)`,
        } as CSSProperties}
      >
        <span className="tt-face"><span className="tt-letter" data-ch={t.ch}>{t.ch}</span></span>
      </span>
    )
  }

  return (
    <h1 ref={rootRef} aria-label="The Digital Atrium" className={`trace-title ${arrived ? 'is-in' : ''} ${className}`}>
      <span aria-hidden="true" className="tt-row tt-the">
        <span className="tt-text-trace">
          <span className="tt-type">Text</span>
          THE
        </span>
      </span>
      <span aria-hidden="true" className="tt-row">{DIGITAL.map((t, i) => tile(t, i))}</span>
      <span aria-hidden="true" className="tt-row tt-indent">{ATRIUM.map((t, i) => tile(t, DIGITAL.length + i))}</span>
      {box && (
        <span
          aria-hidden="true"
          className={`tt-select ${arrived ? 'is-in' : ''}`}
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, fontSize: box.size, transform: `translateY(${tiles[picked].dy - 0.07}em) rotate(${tiles[picked].rot}deg)` }}
        >
          <i /><i /><i /><i />
          <span className="tt-cursor">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z" /></svg>
            <span className="tt-name">you</span>
          </span>
        </span>
      )}
    </h1>
  )
}
