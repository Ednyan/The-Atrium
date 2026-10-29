// One light that glides to the row pointed at or focused (index.css,
// menu-glide), rather than each row lighting up on its own: the welcome
// screen's column, the right-click menus and their flyouts. The light is kept
// where it was as it fades, so it comes back from there.

import { useRef, useState, type CSSProperties } from 'react'

// `rows`: what a row is, inside the host. The host must be positioned: a
// row's place is added up to it through its offset parents, so a row inside
// a wrapper, or a scaled column, is placed right -- and a row in a flyout of
// its own (fixed, so the chain never reaches this host) is left to that one.
// `ref`: the host's own, where it has one already (a menu kept on screen by it).
export function useMenuGlide(rows: string, ref?: React.RefObject<HTMLDivElement>) {
  const ownRef = useRef<HTMLDivElement>(null)
  const hostRef = ref ?? ownRef
  const [glide, setGlide] = useState({ top: 0, height: 0, danger: false, on: false })
  const to = (target: EventTarget) => {
    const host = hostRef.current
    const row = (target as HTMLElement).closest?.(rows) as HTMLElement | null
    if (!host || !row || (row as HTMLButtonElement).disabled) return
    let top = 0, el: HTMLElement | null = row
    while (el && el !== host) { top += el.offsetTop; el = el.offsetParent as HTMLElement | null }
    if (el !== host) return
    setGlide({ top, height: row.offsetHeight, danger: row.hasAttribute('data-danger') || row.classList.contains('menu-row-danger'), on: true })
  }
  const off = () => setGlide(was => ({ ...was, on: false }))
  const host = {
    ref: hostRef,
    onMouseOver: (event: React.MouseEvent) => to(event.target),
    onFocus: (event: React.FocusEvent) => to(event.target),
    onMouseLeave: off,
    onBlur: off,
  }
  // No margin: a column's spacing gives every child after the first one this
  // too, and it put the light a gap below its row.
  const style: CSSProperties = { transform: `translateY(${glide.top}px)`, height: glide.height, opacity: glide.on ? 1 : 0, margin: 0 }
  const light = <span aria-hidden="true" className="menu-glide" data-danger={glide.danger || undefined} style={style} />
  return { host, light }
}
