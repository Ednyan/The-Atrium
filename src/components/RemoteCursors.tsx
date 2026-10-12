// Other people's cursors, in TraceOverlay's world layer. Who's here -- name,
// colour -- from the store; where they are, every frame, written straight onto
// the element, so a cursor moving never draws anything else again:
// - connected directly (lib/peers' livePositions), its path played back as it
//   was made, by the sender's clock (lib/playback) -- even, through a jittery
//   network, and as little behind as that allows;
// - else glided to where the presence channel last put it, every few seconds.

import { useEffect, useRef } from 'react'
import type { UserPresence } from '../types/database'
import { livePositions } from '../lib/peers'
import { Playback } from '../lib/playback'
import { cursorEdgeOn, hexToRgb } from '../lib/cursorLook'

// How long a cursor takes to glide to where the presence channel puts it.
const GLIDE_MS = 100

interface Track {
  // Connected directly: its recent positions, on the sender's clock, and when
  // to show them. Null through the channel.
  path: { x: number; y: number; t: number }[] | null
  playback: Playback
  // Through the channel: the glide under way, and where it was last put.
  from: { x: number; y: number }
  to: { x: number; y: number }
  start: number
  put: { x: number; y: number }
  // Where it's drawn, and the transform that says so.
  x: number
  y: number
  at: string
}

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
  const shown = useRef(new Map<string, Track>())
  const anyone = Object.keys(users).length > 0

  useEffect(() => {
    if (!anyone) return
    let frame = requestAnimationFrame(function step() {
      frame = requestAnimationFrame(step)
      const { users, zoom, worldOffset } = latest.current
      const now = performance.now()
      for (const [id, element] of elements.current) {
        const user = users[id]
        if (!user) continue
        const live = livePositions.get(id)
        let track = shown.current.get(id)
        if (!track) {
          const { x, y } = live ?? user
          track = { path: null, playback: new Playback(), from: { x, y }, to: { x, y }, start: 0, put: { x: user.x, y: user.y }, x, y, at: '' }
          shown.current.set(id, track)
        }
        if (live) {
          if (!track.path) { track.path = []; track.playback = new Playback() }
          const path = track.path
          // Their clock started again (a reload): so does the playback.
          if (live.t < (path[path.length - 1]?.t ?? -Infinity)) { path.length = 0; track.playback = new Playback() }
          if (live.t !== path[path.length - 1]?.t) {
            path.push({ x: live.x, y: live.y, t: live.t })
            track.playback.heard(live.t, live.at)
          }
          // The moment of theirs shown now, between the two positions around it.
          const moment = now - track.playback.lag()
          while (path.length > 2 && path[1].t <= moment) path.shift()
          const [a, b] = path
          const k = !b || moment <= a.t ? (moment <= a.t ? 0 : 1) : Math.min(1, (moment - a.t) / (b.t - a.t))
          const end = b ?? a
          track.x = a.x + (end.x - a.x) * k
          track.y = a.y + (end.y - a.y) * k
        } else {
          // No longer direct: stays where it is until the channel moves it.
          if (track.path) {
            track.path = null
            track.from = track.to = { x: track.x, y: track.y }
            track.put = { x: user.x, y: user.y }
          }
          if (user.x !== track.put.x || user.y !== track.put.y) {
            track.from = { x: track.x, y: track.y }
            track.to = track.put = { x: user.x, y: user.y }
            track.start = now
          }
          const k = Math.min(1, (now - track.start) / GLIDE_MS)
          track.x = track.from.x + (track.to.x - track.from.x) * k
          track.y = track.from.y + (track.to.y - track.from.y) * k
        }
        const at = `translate(${(track.x * zoom + worldOffset.x).toFixed(1)}px, ${(track.y * zoom + worldOffset.y).toFixed(1)}px)`
        // Written only when it moved: a still cursor costs nothing.
        if (track.at !== at) element.style.transform = at
        track.at = at
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
