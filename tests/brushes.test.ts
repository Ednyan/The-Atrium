// The parts of drawing's brushes that are arithmetic rather than painting.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isCustomBrush, seededRandom, stampPositions, tipAlpha } from '../src/lib/brushes.ts'

test('stamps land at the spacing, whatever the segments are', () => {
  const xs = (points: { x: number; y: number }[]) => stampPositions(points, () => 2).map(s => s.x)
  assert.deepEqual(xs([{ x: 0, y: 0 }, { x: 10, y: 0 }]), [0, 2, 4, 6, 8, 10])
  // The same line in three uneven pieces, one of them no length at all.
  assert.deepEqual(xs([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 0 }, { x: 10, y: 0 }]), [0, 2, 4, 6, 8, 10])
  assert.deepEqual(xs([{ x: 5, y: 5 }]), [5])
})

test('pressure is carried along the line to each stamp', () => {
  const stamps = stampPositions([{ x: 0, y: 0, p: 0 }, { x: 4, y: 0, p: 1 }], () => 2)
  assert.deepEqual(stamps.map(s => s.p), [0, 0.5, 1])
})

test('a seeded stroke paints the same every time', () => {
  const a = seededRandom(42)
  const b = seededRandom(42)
  const first = [a(), a(), a()]
  assert.deepEqual([b(), b(), b()], first)
  assert.ok(first.every(v => v >= 0 && v < 1))
})

test('an opaque picture is read by darkness, a transparent one by its alpha', () => {
  // Black and white, no transparency: the black is the ink.
  assert.deepEqual([...tipAlpha([0, 0, 0, 255, 255, 255, 255, 255])], [255, 255, 255, 255, 255, 255, 255, 0])
  // A white shape on transparent keeps its shape, white or not.
  assert.deepEqual([...tipAlpha([255, 255, 255, 255, 0, 0, 0, 0])], [255, 255, 255, 255, 255, 255, 255, 0])
})

test('only well-formed brushes are taken back from the vault', () => {
  const tip = 'data:image/png;base64,iVBORw0KGgo='
  assert.ok(isCustomBrush({ id: 'a1-b2', name: 'Leaf', tip }))
  assert.ok(!isCustomBrush({ id: 'a1', name: 'Leaf', tip: 'data:image/png;base64,x");background:url(evil' }))
  assert.ok(!isCustomBrush({ id: '../x', name: 'Leaf', tip }))
  assert.ok(!isCustomBrush(null))
})
