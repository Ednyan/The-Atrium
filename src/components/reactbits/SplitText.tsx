// SplitText, from React Bits -- copyright (c) 2026 David Haz, under the
// licence in ./LICENSE.md. The letters rise into place, one after another,
// as the text comes into view.
//
// Adapted: GSAP comes from lib/landingMotion (and until it has, the text is
// simply there); triggered once through ScrollTrigger's defaults rather than
// a threshold and margin of its own; and keyed by its text, because the split
// replaces the text React wrote -- a new language would otherwise be written
// into a node no longer on the page.
import { createElement, useEffect, useRef } from 'react'
import { useLandingMotion } from '../../lib/landingMotion'

interface SplitTextProps {
  text: string
  className?: string
  tag?: 'h1' | 'h2' | 'h3' | 'p' | 'span'
  // Between one letter and the next, in ms.
  delay?: number
  duration?: number
  ease?: string
  from?: gsap.TweenVars
  to?: gsap.TweenVars
  start?: string
}

export default function SplitText({
  text, className = '', tag = 'p', delay = 50, duration = 1.25, ease = 'power3.out',
  from = { opacity: 0, y: 40 }, to = { opacity: 1, y: 0 }, start = 'top 85%',
}: SplitTextProps) {
  const ref = useRef<HTMLElement>(null)
  const motion = useLandingMotion()
  // By value: an object written inline is a new one every render.
  const fromKey = JSON.stringify(from), toKey = JSON.stringify(to)

  useEffect(() => {
    const el = ref.current
    if (!motion || !el) return
    const { gsap, SplitText: Splitter } = motion
    // Inside the context, so reverting it puts the text back whole.
    const ctx = gsap.context(() => {
      Splitter.create(el, {
        type: 'chars',
        smartWrap: true,
        onSplit: self => gsap.fromTo(self.chars, JSON.parse(fromKey), {
          ...JSON.parse(toKey), duration, ease, stagger: delay / 1000,
          scrollTrigger: { trigger: el, start, once: true },
        }),
      })
    })
    return () => ctx.revert()
  }, [motion, text, delay, duration, ease, fromKey, toKey, start])

  return createElement(tag, { key: text, ref, className }, text)
}
