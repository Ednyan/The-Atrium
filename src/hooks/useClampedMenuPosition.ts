import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

// Keeps a context menu fully on screen, the way a desktop OS does: open at the
// cursor, but shift back inside the viewport rather than letting the menu run
// off the edge where its lower entries can't be reached.
//
// Measures the rendered element instead of taking a width/height as an
// argument. These menus vary a lot -- entries appear per trace type, per
// selection size, per permission -- so any fixed guess is wrong for most of
// them. The call sites that tried previously each hardcoded different numbers
// (180/220/195 in one, a width constant in another, nothing at all in the
// third), and none of them handled a menu opened near the bottom.
//
// useLayoutEffect, not useEffect: it runs before the browser paints, so the
// menu is never visible at the unclamped position first.
export function useClampedMenuPosition(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
): { x: number; y: number } {
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      setPos({ x, y })
      return
    }

    const MARGIN = 8
    const { width, height } = el.getBoundingClientRect()

    // Math.max last, so a menu taller or wider than the viewport pins to the
    // top-left corner and scrolls (the menus set their own max-height) rather
    // than being pushed off the opposite edge by the clamp meant to save it.
    setPos({
      x: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    })
  }, [ref, x, y])

  return pos
}
