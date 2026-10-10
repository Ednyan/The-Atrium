// ScrollReveal, from React Bits -- copyright (c) 2026 David Haz, under the
// licence in ./LICENSE.md. Words brighten out of a blur as the paragraph is
// scrolled into view.
//
// Adapted: GSAP comes from lib/landingMotion (and until it has, the text is
// simply there); it kills only its own triggers (the original killed every
// trigger on the page); it is one paragraph (the original put a <p> in an
// <h2>); it is measured by its top alone (the original ended as its bottom
// reached the bottom of the screen, which for a short paragraph is before it
// starts, so it snapped on rather than brightening); and Chinese and
// Japanese, written without spaces, brighten a character at a time instead of
// all at once.
import { useEffect, useMemo, useRef } from 'react'
import { useLandingMotion } from '../../lib/landingMotion'

interface ScrollRevealProps {
  children: string
  className?: string
  baseOpacity?: number
  baseRotation?: number
  blurStrength?: number
}

// Whitespace, or one character of a script written without it.
const PARTS = /(\s+|[぀-ヿ㐀-鿿豈-﫿])/

export default function ScrollReveal({ children, className = '', baseOpacity = 0.1, baseRotation = 3, blurStrength = 4 }: ScrollRevealProps) {
  const ref = useRef<HTMLParagraphElement>(null)
  const motion = useLandingMotion()

  const words = useMemo(() => children.split(PARTS).filter(Boolean).map((part, i) =>
    /^\s+$/.test(part) ? part : <span className="reveal-word" key={i}>{part}</span>,
  ), [children])

  useEffect(() => {
    const el = ref.current
    if (!motion || !el) return
    const { gsap } = motion
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { transformOrigin: '0% 50%', rotate: baseRotation }, {
        rotate: 0, ease: 'none',
        scrollTrigger: { trigger: el, start: 'top bottom', end: 'top 45%', scrub: true },
      })
      gsap.fromTo(el.querySelectorAll('.reveal-word'), { opacity: baseOpacity, filter: `blur(${blurStrength}px)` }, {
        opacity: 1, filter: 'blur(0px)', ease: 'none', stagger: 0.05,
        scrollTrigger: { trigger: el, start: 'top 90%', end: 'top 45%', scrub: true },
      })
    })
    return () => ctx.revert()
  }, [motion, words, baseOpacity, baseRotation, blurStrength])

  return <p ref={ref} className={className}>{words}</p>
}
