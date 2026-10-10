// The landing page's motion -- GSAP and Lenis -- fetched after the page has
// painted, so it never waits on them, and nothing else in the app loads them.
// Until they arrive (and if they never do) the page is simply still; nobody
// who asked for less motion fetches them at all.
import { useEffect, useState } from 'react'

export type LandingMotion = typeof import('./landingMotionLibs')

let loading: Promise<LandingMotion> | null = null

export function useLandingMotion(): LandingMotion | null {
  const [motion, setMotion] = useState<LandingMotion | null>(null)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let alive = true
    ;(loading ??= import('./landingMotionLibs')).then(m => { if (alive) setMotion(m) }, () => { /* offline: still */ })
    return () => { alive = false }
  }, [])
  return motion
}
