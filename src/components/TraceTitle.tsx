// The landing page's title, put together the way anything in an atrium is:
// each letter comes in as a trace -- a frame with a trace's corner marks --
// dragged to its place, the last one by a cursor; then the frames let go and
// what's left is the plain title, nothing collaged about it.
//
// The title is ordinary text from the start, only unseen until the traces are
// down, so what they settle into is exactly it. The traces are a layer over
// it, measured off its letters (a Range per letter, the font's cap height from
// a canvas), and taken away once it shows. Straight to the title for anyone
// who asked for less motion.

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { PAN_ICON } from './AtriumInfo'

// How each word is set -- the title's, and its traces' the same.
const WORDS: { text: string; className: string; style?: CSSProperties }[] = [
  { text: 'THE', className: 'text-nier-bg/70 tracking-[0.12em] font-extralight' },
  { text: 'DIGITAL', className: 'text-nier-strong', style: { textShadow: '0 0 60px rgb(var(--c-strong) / 0.14)' } },
  { text: 'ATRIUM', className: 'tt-metal' },
]
// Where each trace is dragged from, in em: THE whole, then a letter each. The
// last is the one the cursor brings, from furthest off.
const FROM = [
  [-1.2, -0.5], [-0.9, 0.9], [0.3, -1.1], [-0.4, 1.2], [0.8, -0.9], [-0.6, -1.3], [0.5, 1], [1.1, -0.6],
  [-0.8, 1.1], [0.4, -1.2], [-0.3, 1.3], [0.9, -1], [-0.6, 0.9], [1.9, 1.5],
]
// The phases follow the animation itself -- the frames let go once the last
// trace is down, the traces go once they've faded -- since on a busy first
// load it can start late. These are only in case its events never come (ms).
const SETTLE_BY = 4500
const DONE_BY = 6500

interface Piece {
  ch: string; word: number; x: number; y: number; w: number; h: number; size: number
  capTop: number; capH: number
  // The metal's box, from this letter: ATRIUM's sheen runs across the word.
  metal?: { x: number; y: number; w: number; h: number }
}
type Phase = 'wait' | 'arrive' | 'settle' | 'done'

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export default function TraceTitle({ className = '' }: { className?: string }) {
  const rootRef = useRef<HTMLHeadingElement>(null)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [phase, setPhase] = useState<Phase>(() => reduced() ? 'done' : 'wait')
  const [pieces, setPieces] = useState<Piece[]>([])

  useLayoutEffect(() => {
    if (phase === 'done') return
    const root = rootRef.current
    if (!root) return
    const measure = () => {
      const origin = root.getBoundingClientRect()
      const range = document.createRange()
      const ctx = document.createElement('canvas').getContext('2d')
      const out: Piece[] = []
      wordRefs.current.forEach((el, word) => {
        const text = el?.firstChild
        if (!el || !(text instanceof Text)) return
        const cs = getComputedStyle(el)
        const size = parseFloat(cs.fontSize)
        let ascent = size * 0.9, cap = size * 0.7
        if (ctx) {
          ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
          const m = ctx.measureText('H')
          ascent = m.fontBoundingBoxAscent ?? ascent
          cap = m.actualBoundingBoxAscent || cap
        }
        const box = el.getBoundingClientRect()
        const spans = word === 0 ? [[0, text.length]] : [...text.data].map((_, i) => [i, i + 1])
        for (const [a, b] of spans) {
          range.setStart(text, a)
          range.setEnd(text, b)
          const r = range.getBoundingClientRect()
          out.push({
            ch: text.data.slice(a, b), word, size,
            x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height,
            capTop: ascent - cap, capH: cap,
            metal: word === 2 ? { x: box.left - r.left, y: box.top - r.top, w: box.width, h: box.height } : undefined,
          })
        }
      })
      setPieces(out)
    }
    let live = true
    let timers: number[] = []
    // Measured in the font it'll be seen in -- but not waited on for long.
    void Promise.race([document.fonts?.ready, new Promise(r => setTimeout(r, 800))]).then(() => {
      if (!live) return
      measure()
      setPhase('arrive')
      timers = [
        window.setTimeout(() => setPhase(p => p === 'arrive' ? 'settle' : p), SETTLE_BY),
        window.setTimeout(() => setPhase('done'), DONE_BY),
      ]
    })
    const observer = new ResizeObserver(() => { if (live) measure() })
    observer.observe(root)
    return () => { live = false; observer.disconnect(); timers.forEach(clearTimeout) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === 'done'])

  return (
    <h1
      ref={rootRef}
      data-phase={phase}
      className={`trace-title relative font-light leading-[0.86] tracking-[-0.02em] ${className}`}
      style={{ containerType: 'inline-size' }}
    >
      <span ref={el => { wordRefs.current[0] = el }} className={`tt-word block mb-3 ${WORDS[0].className}`} style={{ fontSize: 'clamp(1.25rem, 6.2cqi, 3rem)' }}>
        {WORDS[0].text}
      </span>
      <span className="block whitespace-nowrap" style={{ fontSize: 'clamp(2rem, 12.9cqi, 6.5rem)' }}>
        <span ref={el => { wordRefs.current[1] = el }} className={`tt-word inline-block ${WORDS[1].className}`} style={WORDS[1].style}>
          {WORDS[1].text}
        </span>{' '}
        <span ref={el => { wordRefs.current[2] = el }} className={`tt-word inline-block ${WORDS[2].className}`}>
          {WORDS[2].text}
        </span>
      </span>

      {phase !== 'done' && phase !== 'wait' && (
        <span
          aria-hidden="true"
          className="tt-pieces"
          onAnimationEnd={e => { if (e.animationName === 'tt-drag' && (e.target as Element).classList.contains('is-held')) setPhase('settle') }}
          onTransitionEnd={e => { if (e.target === e.currentTarget && e.propertyName === 'opacity') setPhase('done') }}
        >
          {pieces.map((p, i) => {
            const held = i === pieces.length - 1
            const [fx, fy] = FROM[i % FROM.length]
            const look = WORDS[p.word]
            return (
              <span
                key={i}
                className={`tt-piece ${held ? 'is-held' : ''}`}
                style={{ left: p.x, top: p.y, width: p.w, height: p.h, fontSize: p.size, '--i': i, '--from': `translate(${fx}em, ${fy}em)` } as CSSProperties}
              >
                <span className="tt-frame" style={{ top: p.capTop - p.size * 0.11, height: p.capH + p.size * 0.22 }} />
                <span
                  className={`tt-glyph ${look.className}`}
                  style={{
                    ...look.style,
                    lineHeight: `${p.h}px`,
                    ...(p.metal && { backgroundSize: `${p.metal.w}px ${p.metal.h}px`, backgroundPosition: `${p.metal.x}px ${p.metal.y}px`, backgroundRepeat: 'no-repeat' }),
                  }}
                >
                  {p.ch}
                </span>
                {held && (
                  <svg className="tt-hand" viewBox="0 0 24 24" style={{ top: p.capTop + p.capH * 0.55 }}>
                    <path d={PAN_ICON} fill="none" stroke="#ff8a3d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d={PAN_ICON} fill="none" stroke="#fff" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
            )
          })}
        </span>
      )}
    </h1>
  )
}
