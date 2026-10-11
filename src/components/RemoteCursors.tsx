// Other people's cursors, in TraceOverlay's world layer. Who's here -- name,
// colour -- from the store; where they are, every frame: from a direct
// connection (lib/peers' livePositions) when there is one, else where the
// presence channel last put them. Eased toward it and written straight onto
// the element, so a cursor moving never draws anything else again.

import { useEffect, useRef } from 'react'
import type { UserPresence } from '../types/database'
import { livePositions } from '../lib/peers'
import { cursorEdgeOn, hexToRgb } from '../lib/cursorLook'

// How much of the way to where it is a cursor goes each frame.
const EASE = 0.35

export default function RemoteCursors({ users, zoom, worldOffset, hideNames, atriumBackground, zIndex }: {
  users: Record<string, UserPresence>
  zoom: number
  worldOffset: { x: number; y: number }
  hideNames: boolean
  atriumBackground: string | undefined
  zIndex: number
}) {
  const elements = useRef(new Map<string, HTMLDivElement>())
  // Read by the frame loop: the latest of each, without restarting it.
  const latest = useRef({ users, zoom, worldOffset })
  latest.current = { users, zoom, worldOffset }
  const shown = useRef(new Map<string, { x: number; y: number; at: string }>())
  const anyone = Object.keys(users).length > 0

  useEffect(() => {
    if (!anyone) return
    let frame = requestAnimationFrame(function step() {
      frame = requestAnimationFrame(step)
      const { users, zoom, worldOffset } = latest.current
      for (const [id, element] of elements.current) {
        const user = users[id]
        if (!user) continue
        const target = livePositions.get(id) ?? user
        const last = shown.current.get(id)
        const x = last ? last.x + (target.x - last.x) * EASE : target.x
        const y = last ? last.y + (target.y - last.y) * EASE : target.y
        const at = `translate(${(x * zoom + worldOffset.x).toFixed(1)}px, ${(y * zoom + worldOffset.y).toFixed(1)}px)`
        // Written only when it moved: a still cursor costs nothing.
        if (last?.at !== at) element.style.transform = at
        shown.current.set(id, { x, y, at })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [anyone])

  const edge = cursorEdgeOn(atriumBackground)
  return (
    <>
      {Object.entries(users).map(([id, user]) => {
        const color = user.playerColor || '#ffffff'
        const rgb = hexToRgb(color)
        // Where it was last drawn, for the first frame and every redraw.
        const at = shown.current.get(id)?.at ?? `translate(${user.x * zoom + worldOffset.x}px, ${user.y * zoom + worldOffset.y}px)`
        return (
          <div
            key={id}
            ref={element => { if (element) elements.current.set(id, element); else { elements.current.delete(id); shown.current.delete(id) } }}
            style={{ position: 'absolute', left: 0, top: 0, transform: at, pointerEvents: 'none', zIndex, willChange: 'transform' }}
          >
            <svg width={20 * zoom} height={20 * zoom} viewBox="0 0 24 24" style={{ transform: 'translate(-2px, -2px)' }}>
              <path
                d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                fill={color}
                stroke={edge}
                strokeWidth="1.5"
              />
            </svg>
            {/* A dark colour gets a light glow instead of one of its own, which
                would sink into a dark atrium (as your own cursor's label). */}
            {!hideNames && (() => {
              const dark = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b < 90
              return (
                <div
                  style={{
                    position: 'absolute',
                    top: 16 * zoom,
                    left: 10 * zoom,
                    color,
                    fontSize: `${10 * zoom}px`,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    textShadow: dark
                      ? '0 0 5px rgba(255,255,255,0.9), 0 0 2px rgba(255,255,255,0.9)'
                      : `0 0 6px rgba(${rgb.r},${rgb.g},${rgb.b},0.4), 0 2px 4px rgba(0,0,0,0.8)`,
                    WebkitTextStroke: dark ? '0.5px rgba(255,255,255,0.6)' : undefined,
                    letterSpacing: '0.5px',
                    background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.6)',
                    border: dark ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
                    padding: '2px 5px',
                    borderRadius: '3px',
                  }}
                >
                  {user.username}
                </div>
              )
            })()}
          </div>
        )
      })}
    </>
  )
}
