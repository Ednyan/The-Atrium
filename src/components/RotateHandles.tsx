import type React from 'react'

// Rotation handles: a curved arrow around each corner of a box, turned with
// it. All four do the same -- turn the box about its centre -- so whichever
// corner is nearest is the one to take.
//
// Each arc is centred on its corner, bulging outward, so it wraps the corner
// without covering the scale handle on it. Only the arc takes the pointer
// (a wide invisible stroke along it); the middle is the corner handle's.

const R = 17
const SPAN = 150
const SIZE = 2 * (R + 10)
// A point on the circle, at an angle in degrees (screen: y down, clockwise).
const on = (deg: number, r = R) => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)]
// Drawn for the top-right corner, whose outside is up and to the right
// (-45deg); the others are it turned by a quarter each.
const [sx, sy] = on(-45 - SPAN / 2)
const [ex, ey] = on(-45 + SPAN / 2)
const ARC = `M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}`
// The arrowhead at the arc's clockwise end, pointing on around the circle.
const END = -45 + SPAN / 2
const HEAD = (() => {
  const rad = (END * Math.PI) / 180
  const tx = -Math.sin(rad), ty = Math.cos(rad)
  const [px, py] = on(END)
  const [ox, oy] = on(END, 4.5)
  const tip = [px + tx * 6, py + ty * 6]
  return `${tip[0]},${tip[1]} ${px + ox},${py + oy} ${px - ox},${py - oy}`
})()
const CORNERS = [
  { key: 'tr', x: 1, y: -1, turn: 0 },
  { key: 'br', x: 1, y: 1, turn: 90 },
  { key: 'bl', x: -1, y: 1, turn: 180 },
  { key: 'tl', x: -1, y: -1, turn: 270 },
] as const

export default function RotateHandles({ cx, cy, halfW, halfH, rotation, zIndex, onMouseDown, onTouchStart }: {
  // The box, in screen pixels: its centre, half-size and turn in degrees.
  cx: number
  cy: number
  halfW: number
  halfH: number
  rotation: number
  zIndex: number
  onMouseDown: (e: React.MouseEvent) => void
  onTouchStart: (e: React.TouchEvent) => void
}) {
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  return (
    <>
      {CORNERS.map(corner => {
        const x = corner.x * halfW, y = corner.y * halfH
        return (
          <svg
            key={corner.key}
            data-trace-element="true"
            data-keeps-size=""
            className="trace-rotate-handle absolute pointer-events-none"
            width={SIZE}
            height={SIZE}
            viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
            style={{ left: cx + x * cos - y * sin, top: cy + x * sin + y * cos, transform: 'translate(-50%, -50%)', zIndex, overflow: 'visible' }}
          >
            <g transform={`rotate(${rotation + corner.turn})`}>
              <path className="trace-rotate-handle-halo" d={ARC} />
              <polygon className="trace-rotate-handle-halo" points={HEAD} />
              <path className="trace-rotate-handle-line" d={ARC} />
              <polygon className="trace-rotate-handle-head" points={HEAD} />
              <path className="trace-rotate-handle-hit" d={ARC} onMouseDown={onMouseDown} onTouchStart={onTouchStart} />
            </g>
          </svg>
        )
      })}
    </>
  )
}
