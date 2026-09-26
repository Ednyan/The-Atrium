import type React from 'react'

// Rotation handles: a crescent around each corner of a box, turned with it,
// drawn like the other handles -- a dark face, a light edge, a dark ring
// outside it. All four do the same -- turn the box about its centre -- so
// whichever corner is nearest is the one to take.
//
// The crescent is a circle centred on the corner with a larger one taken out
// of it, set back toward the box: thickest out along the diagonal, tapering
// to a point either side, clear of the scale handle on the corner.

// Outer radius, and how far the inner edge stays from the corner (the scale
// handle reaches 8.5 along the diagonal), both in screen pixels.
const R = 15
const INNER = 10.5
// How far round either side of the diagonal the tips reach, in degrees.
const REACH = 75

// Drawn pointing up; the corners turn it outward. The inner circle, centred
// `s` back from the corner, passes through both tips.
const CRESCENT = (() => {
  const a = (REACH * Math.PI) / 180
  const tx = R * Math.sin(a), ty = -R * Math.cos(a)
  const s = (R * R - INNER * INNER) / (2 * (INNER - R * Math.cos(a)))
  const r = s + INNER
  return `M ${-tx} ${ty} A ${R} ${R} 0 0 1 ${tx} ${ty} A ${r} ${r} 0 0 0 ${-tx} ${ty} Z`
})()
const SIZE = 2 * (R + 6)
const CORNERS = [
  { key: 'tr', x: 1, y: -1, turn: 45 },
  { key: 'br', x: 1, y: 1, turn: 135 },
  { key: 'bl', x: -1, y: 1, turn: 225 },
  { key: 'tl', x: -1, y: -1, turn: 315 },
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
              <g className="trace-rotate-handle-body">
                <path className="trace-rotate-handle-ring" d={CRESCENT} />
                <path className="trace-rotate-handle-face" d={CRESCENT} />
                <path className="trace-rotate-handle-hit" d={CRESCENT} onMouseDown={onMouseDown} onTouchStart={onTouchStart} />
              </g>
            </g>
          </svg>
        )
      })}
    </>
  )
}
