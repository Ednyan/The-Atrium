// The parts of drawing's brushes that are arithmetic rather than painting.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { alphaBounds, isCustomBrush, isDrawingTrace, placePicture, placementBounds, seededRandom, stampPositions, tipAlpha } from '../src/lib/brushes.ts'

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

test('a drawing is recognised by its file, or by its label', () => {
  assert.ok(isDrawingTrace({ type: 'image', mediaUrl: 'local://traces/lobby/drawing_u_1712.png' }))
  assert.ok(isDrawingTrace({ type: 'image', mediaUrl: 'https://x.supabase.co/storage/v1/object/public/traces/l/drawing_u_1.png' }))
  assert.ok(isDrawingTrace({ type: 'image', mediaUrl: 'data:image/png;base64,AAA', content: 'freehand drawing' }))
  assert.ok(!isDrawingTrace({ type: 'image', mediaUrl: 'https://x/photos/my_drawing_room.jpg' }))
  assert.ok(!isDrawingTrace({ type: 'embed', mediaUrl: 'https://x/drawing_1.png' }))
})

test('the picture lands where the trace shows it, crop and all', () => {
  const base = { cx: 0, cy: 0, rotation: 0, flipH: false, flipV: false, width: 100, height: 50, scaleX: 2, scaleY: 2, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 }
  assert.deepEqual(placePicture(base, 200, 100), { clipW: 200, clipH: 100, x: -100, y: -50, w: 200, h: 100 })
  // Only the right half kept: the box halves and the picture slides left, so
  // what stays in view is its right half.
  assert.deepEqual(placePicture({ ...base, cropX: 0.5, cropWidth: 0.5 }, 200, 100), { clipW: 100, clipH: 100, x: -150, y: -50, w: 200, h: 100 })
  // Turned a quarter, a wide box covers a tall area.
  const b = placementBounds({ ...base, rotation: 90 }, 200, 100)
  assert.ok(Math.abs(b.maxX - 50) < 1e-9 && Math.abs(b.maxY - 100) < 1e-9)
})

test('a saved drawing is trimmed to what is left of it', () => {
  // 4x3, with ink at (1,1) and, faintly, at (2,2).
  const px = new Array(4 * 3 * 4).fill(0)
  px[(1 * 4 + 1) * 4 + 3] = 255
  px[(2 * 4 + 2) * 4 + 3] = 1
  assert.deepEqual(alphaBounds(px, 4, 3), { minX: 1, minY: 1, maxX: 3, maxY: 3 })
  assert.equal(alphaBounds(new Array(4 * 3 * 4).fill(0), 4, 3), null)
})
