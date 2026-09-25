// The arithmetic of connections: where threads bend, where arrows sit.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { arrowhead, bend, boxEdge, carryLinks, curveMiddle, joins, linkRow, mapRowToLink } from '../src/lib/traceLinks.ts'

const near = (a: { x: number; y: number }, x: number, y: number) =>
  assert.ok(Math.abs(a.x - x) < 1e-9 && Math.abs(a.y - y) < 1e-9, `${a.x},${a.y} is not ${x},${y}`)

test('a thread bends to one side of its direction, by a share of its length', () => {
  near(bend(0, 0, 100, 0), 50, 14)
  // The other way round, the other side -- so A->B and B->A never overlap.
  near(bend(100, 0, 0, 0), 50, -14)
})

test('an arrow tip sits on the box border, not at the hidden centre', () => {
  assert.deepEqual(boxEdge(0, 0, 50, 20, 200, 0), { x: 50, y: 0 })
  assert.deepEqual(boxEdge(0, 0, 50, 20, 0, -100), { x: 0, y: -20 })
  // Pointing at a corner-ish angle, the nearer edge wins.
  const p = boxEdge(0, 0, 50, 20, 100, 100)
  assert.ok(Math.abs(p.y - 20) < 1e-9 && Math.abs(p.x - 20) < 1e-9)
  // Something inside the box is its own edge.
  assert.deepEqual(boxEdge(0, 0, 50, 20, 10, 5), { x: 10, y: 5 })
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
    { lobby_id: 'L', from_trace: 'A', to_trace: 'B', arrow: 'forward', color: '#fff', width: 40, label: 'hi' },
    { lobby_id: undefined, from_trace: 'C', to_trace: 'B', arrow: 'none', color: null, width: 2, label: null },
  ])
  assert.deepEqual(carryLinks(undefined, ids), [])
})
