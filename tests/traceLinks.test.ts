// The arithmetic of connections: where threads bend, where arrows sit.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { arrowhead, bend, carryLinks, curveEntry, curveMiddle, joins, linkRow, mapRowToLink, restOf, threadCrosses, visiblePart } from '../src/lib/traceLinks.ts'

const near = (a: { x: number; y: number }, x: number, y: number) =>
  assert.ok(Math.abs(a.x - x) < 1e-9 && Math.abs(a.y - y) < 1e-9, `${a.x},${a.y} is not ${x},${y}`)

test('a thread hangs: below the line either way round, straight when one end is above the other', () => {
  near(bend(0, 0, 100, 0), 50, 14)
  near(bend(100, 0, 0, 0), 50, 14)
  near(bend(0, 0, 100, 60), 50, 44)
  near(bend(0, 0, 0, 100), 0, 50)
  near(restOf(true, 0, 0, 100, 0), 50, 0)
})

test('an arrow sits where the curve itself enters the box, heading as the curve does', () => {
  // Straight: on the border, head-on.
  const s = curveEntry(-200, 0, -100, 0, 0, 0, 50, 20)!
  assert.ok(Math.abs(s.x + 50) < 1e-4 && Math.abs(s.y) < 1e-9 && s.dx > 0 && s.dy === 0)
  // Bent: where the curve crosses the border (-50, 10.5), aimed along the
  // curve -- not at (-50, 14) on the line from the centre toward the bend.
  const b = bend(-200, 0, 0, 0)
  const e = curveEntry(-200, 0, b.x, b.y, 0, 0, 50, 20)!
  assert.ok(Math.abs(e.x + 50) < 1e-4 && Math.abs(e.y - 10.5) < 1e-4, `${e.x},${e.y}`)
  assert.ok(Math.abs(e.dy / e.dx + 0.14) < 1e-4)
  // Turned a quarter, the box is 20 wide along the thread.
  assert.ok(Math.abs(curveEntry(-200, 0, -100, 0, 0, 0, 50, 20, Math.PI / 2)!.x + 20) < 1e-4)
  // Starting inside the box: no room for an arrow.
  assert.equal(curveEntry(-10, 0, -5, 0, 0, 0, 50, 20), null)
})

test('a thread shows only between the two borders, and stays on its curve', () => {
  const box = { hw: 50, hh: 20, turn: 0 }
  // Straight, between boxes centred at -200 and 0: from -150 to -50.
  const s = visiblePart(-200, 0, -100, 0, 0, 0, box, box)!
  near({ x: s.x0, y: s.y0 }, -150, 0)
  near({ x: s.x1, y: s.y1 }, -50, 0)
  // An arrowhead's worth off the end that has one.
  const t = visiblePart(-200, 0, -100, 0, 0, 0, box, box, 0, 10)!
  assert.ok(Math.abs(t.x1 + 60) < 1e-3, `${t.x1}`)
  // Bent: the piece is a curve of its own that lies on the whole one --
  // its middle is on it, and it starts and ends on the borders.
  const b = bend(-300, 0, 0, 0)
  const c = visiblePart(-300, 0, b.x, b.y, 0, 0, box, box)!
  assert.ok(Math.abs(c.x0 + 250) < 1e-4 && Math.abs(c.x1 + 50) < 1e-4, `${c.x0} ${c.x1}`)
  const mid = curveMiddle(c.x0, c.y0, c.cx, c.cy, c.x1, c.y1)
  // The whole curve's x is linear in t here (the bend is midway), so the
  // point on it at that x must have the same y.
  const tm = (mid.x + 300) / 300, um = 1 - tm
  assert.ok(Math.abs(mid.y - (2 * um * tm * b.y)) < 1e-4, `${mid.y}`)
  // Overlapping traces: nothing between them shows.
  assert.equal(visiblePart(-60, 0, -30, 0, 0, 0, box, box), null)
})

// The cost of drawing a thread border to border, per frame while threads
// move: two edge searches each. Measured, not guessed.
test('finding the borders is cheap enough to do for every thread every frame', () => {
  const box = { hw: 120, hh: 80, turn: 0.3 }
  const start = performance.now()
  let n = 0
  for (let i = 0; i < 20000; i++) {
    const ax = -800 + (i % 97), b = bend(ax, 40, 600, -(i % 53))
    if (visiblePart(ax, 40, b.x, b.y, 600, -(i % 53), box, box, 6, 6)) n++
  }
  const perThread = (performance.now() - start) / 20000
  assert.equal(n, 20000)
  // Well under a microsecond or two on a laptop; this bound only catches a
  // blow-up (500 threads in under 5ms).
  assert.ok(perThread < 0.01, `${(perThread * 1000).toFixed(2)} microseconds a thread`)
  console.log(`visiblePart: ${(perThread * 1000).toFixed(2)} microseconds a thread`)
})

test('an arrowhead points from where the curve comes in', () => {
  const [tx, ty, x1, , x2] = arrowhead(10, 0, 0, 0, 4)
  assert.equal(tx, 10); assert.equal(ty, 0)
  assert.equal(x1, 6); assert.equal(x2, 6)
})

test('the middle of the curve is where its label goes', () => {
  assert.deepEqual(curveMiddle(0, 0, 50, 20, 100, 0), { x: 50, y: 10 })
})

test('a pair is joined whichever way round, and rows round-trip', () => {
  const link = mapRowToLink({ id: 'l', lobby_id: 'x', from_trace: 'a', to_trace: 'b', arrow: 'sideways', color: '', width: 0, label: null })
  assert.ok(joins(link, 'a', 'b') && joins(link, 'b', 'a') && !joins(link, 'a', 'c'))
  // Unknown arrow, empty colour and a bad width fall back to the defaults.
  assert.equal(link.arrow, 'none'); assert.equal(link.color, null); assert.equal(link.width, 2)
  assert.equal(linkRow({ ...link, label: '' }).label, null)
  // Border to border unless set otherwise, and the setting round-trips.
  assert.equal(link.toCenter, false)
  assert.equal(mapRowToLink(linkRow({ ...link, toCenter: true })).toCenter, true)
})

test('carried threads follow their traces to new ids, and nothing else comes', () => {
  const ids = new Map([['a', 'A'], ['b', 'B'], ['c', 'C']])
  const rows = carryLinks([
    { id: 'x', lobby_id: 'L', from_trace: 'a', to_trace: 'b', arrow: 'forward', color: '#fff', width: 99, label: 'hi' },
    { from_trace: 'b', to_trace: 'a' }, // the same two traces again
    { from_trace: 'a', to_trace: 'gone' }, // its other end didn't arrive
    { from_trace: 'c', to_trace: 'b', arrow: 'sideways', label: 7 },
  ], ids)
  assert.deepEqual(rows, [
    { lobby_id: 'L', from_trace: 'A', to_trace: 'B', arrow: 'forward', color: '#fff', width: 40, label: 'hi', label_on_hover: false, straight: false, to_center: false },
    { lobby_id: undefined, from_trace: 'C', to_trace: 'B', arrow: 'none', color: null, width: 2, label: null, label_on_hover: false, straight: false, to_center: false },
  ])
  assert.deepEqual(carryLinks(undefined, ids), [])
})

test('an area takes a thread it crosses anywhere, but not where it runs under its traces', () => {
  const box = (x: number, y: number, r: number) => ({ left: x - r, top: y - r, right: x + r, bottom: y + r })
  const a = box(0, 0, 50), b = box(1000, 0, 50)
  // A thin strip across it, well away from the middle.
  assert.ok(threadCrosses(a, b, { left: 200, top: -500, right: 230, bottom: 500 }))
  // Its middle, bowed off the straight line (half as far as its bend point).
  assert.ok(threadCrosses(a, b, box(500, 70, 20)))
  // Only one trace, where the thread is hidden beneath it.
  assert.ok(!threadCrosses(a, b, box(0, 0, 60)))
  // Nowhere near.
  assert.ok(!threadCrosses(a, b, box(500, -300, 50)))
})
