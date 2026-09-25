// The drag feel: something dragged trails the pointer on a spring, leans into
// the pull, and settles with a small bounce when it stops or is let go. Shared
// by traces on the canvas and rows in the Layer panel, so the two feel alike.
//
// Only the drawing is offset. Where the thing is -- what gets saved, snapped
// and dropped -- still follows the pointer exactly; feelStep says how far from
// there to draw it, and at what angle.

export interface FeelSpring {
  x: number
  y: number
  vx: number
  vy: number
  // The largest trail this drag has reached (see feelStep).
  peak: number
  width: number
  height: number
  reach: number
  mass: number
  omega: number
}

// Damped enough that it settles with a hint of overshoot (under 3%) rather
// than a wobble.
const DAMPING = 0.75

// A spring at rest at (x, y) for something width x height, at `strength` 0-1
// (Profile > Animations > drag bounce): loose enough to trail noticeably.
export function feelSpring(x: number, y: number, width: number, height: number, strength: number): FeelSpring {
  const reach = Math.hypot(width, height) / 2 || 1
  // Bigger is heavier: from about 300px across, a thing answers the pull more
  // slowly -- its trail builds and settles over longer, to the same distance --
  // needs a longer pull before it trails at all, and leans less. A small card
  // flicks about; a large board shouldn't.
  const mass = Math.min(3, Math.max(1, reach / 150))
  const period = 80 + 200 * strength
  return { x, y, vx: 0, vy: 0, peak: 0, width, height, reach, mass, omega: (2 * Math.PI) / (period * Math.sqrt(mass)) }
}

// Back to rest at the target, trail and all -- as when Shift makes a drag rigid.
export function feelRest(sp: FeelSpring, x: number, y: number) {
  Object.assign(sp, { x, y, vx: 0, vy: 0, peak: 0 })
}

// Moves the spring dt ms toward the target (where the thing really is) and
// says how to draw it: offset from the target, lean in radians, and whether
// it's still moving.
export function feelStep(sp: FeelSpring, tx: number, ty: number, dt: number) {
  const omega = sp.omega
  for (let left = dt; left > 0; left -= 4) {
    const h = Math.min(left, 4)
    sp.vx += (omega * omega * (tx - sp.x) - 2 * DAMPING * omega * sp.vx) * h
    sp.vy += (omega * omega * (ty - sp.y) - 2 * DAMPING * omega * sp.vy) * h
    sp.x += sp.vx * h
    sp.y += sp.vy * h
  }
  const rawX = sp.x - tx, rawY = sp.y - ty
  const moving = Math.hypot(rawX, rawY) > 0.3 || Math.hypot(sp.vx, sp.vy) > 0.01
  // A minimum of momentum before any of it shows. Scaled by the largest trail
  // this drag has reached, eased in between 3 and 12 pixels (times the mass):
  // a nudge or a jittery hand never gets past the start of that, so the thing
  // just moves, and a real pull brings the full trail, lean and settle -- with
  // nothing in between ever switching on abruptly.
  sp.peak = Math.max(sp.peak, Math.hypot(rawX, rawY))
  const engage = Math.min(1, Math.max(0, (sp.peak - 3 * sp.mass) / (9 * sp.mass)))
  const k = engage * engage * (3 - 2 * engage)
  const give = k / Math.sqrt(sp.mass)
  const ox = rawX * give, oy = rawY * give
  // Leaning into the pull, as a card held by its top edge does: dragged right,
  // the trailing side swings back and it tips clockwise. Capped by size, since
  // the same tilt swings a big thing's corners much further: no corner travels
  // more than about 12 pixels. The cap is eased into on a big thing, which
  // reaches it, so its lean never stops dead; a small one keeps the hard cap
  // it rarely gets near.
  const want = (Math.max(-5, Math.min(5, (-ox * 0.15) / sp.mass)) * Math.PI) / 180
  const cap = 12 / sp.reach
  const lean = sp.mass > 1 ? cap * Math.tanh(want / cap) : Math.sign(want) * Math.min(Math.abs(want), cap)
  return { ox, oy, lean, moving }
}
