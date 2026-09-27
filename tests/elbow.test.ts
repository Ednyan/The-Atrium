import { test } from 'node:test'
import assert from 'node:assert/strict'

import { elbowAtFor, elbowGrip, elbowRoute, elbowThrough, lineCrosses, lineMiddle, roundedPath, trimEnds } from '../src/lib/elbow.ts'
import { alignedHandle, curvePath, handlesAt, pointBetween, snapToBorder, borderMarks, boxHolds } from '../src/lib/pathGeometry.ts'

const box = (x: number, y: number, hw = 50, hh = 30) => ({ x, y, hw, hh })

test('an elbow between boxes side by side leaves and enters their facing sides, turning halfway', () => {
  assert.deepEqual(elbowRoute(box(0, 0), box(300, 100), 0.5), [
    { x: 50, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }, { x: 250, y: 100 },
  ])
  // To the left: the other sides.
  assert.deepEqual(elbowRoute(box(0, 0), box(-300, 0), 0.5), [{ x: -50, y: 0 }, { x: -250, y: 0 }])
})

test('boxes one above the other are joined top and bottom; the middle run goes where `at` says', () => {
  const route = elbowRoute(box(0, 0), box(40, 300), 0.25)
  assert.deepEqual(route, [{ x: 0, y: 30 }, { x: 0, y: 90 }, { x: 40, y: 90 }, { x: 40, y: 270 }])
  assert.deepEqual(elbowGrip(route), { x: 20, y: 90 })
})

test('dragging the middle run: `at` from the pointer, and back again', () => {
  const a = box(0, 0), b = box(300, 100)
  const at = elbowAtFor(a, b, { x: 200, y: 999 })
  assert.equal(at, 0.75)
  assert.equal(elbowRoute(a, b, at)[1].x, 200)
})

test('an elbow through placed points turns at right angles and never doubles back at a point', () => {
  const route = elbowThrough([{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 200 }])
  assert.deepEqual(route, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 200 }])
  for (let i = 1; i < route.length; i++) {
    assert.ok(route[i].x === route[i - 1].x || route[i].y === route[i - 1].y, `run ${i} is straight`)
  }
})

test('corners are rounded by the radius, less where a run is short', () => {
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10), 'M 0 0 L 90 0 Q 100 0 100 10 L 100 100')
  assert.equal(roundedPath([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 100 }], 10), 'M 0 0 L 2 0 Q 4 0 4 2 L 4 100')
})

test('ends drawn back for arrowheads, never past the next point', () => {
  assert.deepEqual(trimEnds([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], 10, 20), [{ x: 10, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }])
  assert.deepEqual(trimEnds([{ x: 0, y: 0 }, { x: 10, y: 0 }], 30, 30), [{ x: 5, y: 0 }, { x: 5, y: 0 }])
})

test('a line crosses an area it runs through, or not', () => {
  const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]
  assert.equal(lineCrosses(route, { left: 90, top: 40, right: 110, bottom: 60 }), true)
  assert.equal(lineCrosses(route, { left: 10, top: 10, right: 80, bottom: 90 }), false)
  assert.deepEqual(lineMiddle(route), { x: 100, y: 0 })
})

test("unset handles lie along the run from the point before to the point after, in line", () => {
  const points = [{ x: 0, y: 0 }, { x: 60, y: 60 }, { x: 120, y: 0 }]
  const { cp1, cp2 } = handlesAt(points, 1)
  assert.deepEqual(cp1, { x: 40, y: 60 })
  assert.deepEqual(cp2, { x: 80, y: 60 })
  assert.match(curvePath(points), /^M 0 0 C /)
})

test('moving one handle turns the other to stay in line, at its own length', () => {
  const other = alignedHandle({ x: 0, y: 0 }, { x: 0, y: -10 }, { x: 30, y: 0 })
  assert.ok(Math.abs(other.x) < 1e-9 && Math.abs(other.y - 30) < 1e-9)
})

test('a point is added halfway along the line drawn between two points', () => {
  const points = [{ x: 0, y: 0 }, { x: 100, y: 40 }]
  assert.deepEqual(pointBetween(points, 'straight', 0), { x: 50, y: 20 })
  // An elbow: halfway along its two runs.
  assert.deepEqual(pointBetween(points, 'elbow', 0), { x: 70, y: 0 })
  assert.deepEqual(pointBetween([{ x: 0, y: 0 }, { x: 90, y: 0 }], 'bezier', 0), { x: 45, y: 0 })
})

test("a point dragged over a box lands on its border, and on a corner or a side's middle when near one", () => {
  const b = { cx: 0, cy: 0, halfW: 100, halfH: 50, rotation: 0 }
  assert.deepEqual(snapToBorder(b, { x: 30, y: 45 }, 5), { x: 30, y: 50 })
  assert.deepEqual(snapToBorder(b, { x: 96, y: 47 }, 10), { x: 100, y: 50 })
  assert.deepEqual(snapToBorder(b, { x: 3, y: -40 }, 10), { x: 0, y: -50 })
  // Turned a quarter: its long sides run up and down.
  const turned = snapToBorder({ ...b, rotation: 90 }, { x: 45, y: 30 }, 5)
  assert.ok(Math.abs(turned.x - 50) < 1e-9 && Math.abs(turned.y - 30) < 1e-9, JSON.stringify(turned))
  assert.equal(borderMarks(b).length, 8)
})

test('a round trace is snapped to its outline, not its box', () => {
  const c = { cx: 0, cy: 0, halfW: 50, halfH: 50, rotation: 0, round: true }
  const near = (p: { x: number; y: number }, x: number, y: number) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9
  // From inside, out along the way it lies from the middle.
  const out = snapToBorder(c, { x: 10, y: 10 }, 0)
  assert.ok(near(out, 50 * Math.SQRT1_2, 50 * Math.SQRT1_2), JSON.stringify(out))
  // Near the top, onto the top.
  assert.ok(near(snapToBorder(c, { x: 4, y: -44 }, 10), 0, -50))
  // Never onto the corner of its box.
  assert.ok(!borderMarks(c).some(p => near(p, 50, 50)))
  assert.ok(boxHolds(c, { x: 55, y: 0 }, 6) && !boxHolds(c, { x: 55, y: 0 }))
})
