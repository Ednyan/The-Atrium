import type React from 'react'

// Rotation handles: a crescent around each corner of a box, turned with it,
// drawn like the other handles -- a dark face, a light edge, a dark ring
// outside it. All four do the same -- turn the box about its centre -- so
// whichever corner is nearest is the one to take.
//
// The crescent is a circle with a slightly smaller one taken out of it, set
// back toward the box: a moon, as a moon is drawn -- thickest out along the
// diagonal, curling round to a point either side. It sits a little out from
// the corner, clear of the scale handle there (which reaches 8.5 along the
// diagonal), with about as much room at its tips as at its middle.

// All in screen pixels: the moon's radius, how thick it is at its thickest,
// and how far out along the diagonal its centre sits.
const R = 11
const THICK = 0.37 * R
const OUT = 6.5
// How far round either side of the diagonal the tips reach, in degrees: past
// a half-circle, so it curls like a moon rather than lying flat like a bow.
const REACH = 106

// Drawn pointing up, about its own centre; the corners turn it outward. The
// inner circle, centred `s` back toward the box, passes through both tips.
const CRESCENT = (() => {
  const a = (REACH * Math.PI) / 180
  const tx = R * Math.sin(a), ty = -R * Math.cos(a)
  const k = R - THICK
  const s = (R * R - k * k) / (2 * (k - R * Math.cos(a)))
  const r = s + k
  const outerLarge = 2 * REACH > 180 ? 1 : 0
  const innerLarge = 2 * Math.atan2(tx, s - ty) > Math.PI ? 1 : 0
  return `M ${-tx} ${ty} A ${R} ${R} 0 ${outerLarge} 1 ${tx} ${ty} A ${r} ${r} 0 ${innerLarge} 0 ${-tx} ${ty} Z`
})()
const SIZE = 2 * Math.ceil((OUT + R + 3) * 1.14)
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
            <g transform={`rotate(${rotation + corner.turn}) translate(0 ${-OUT})`}>
              {/* Grows on hover about the moon's own centre. */}
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
