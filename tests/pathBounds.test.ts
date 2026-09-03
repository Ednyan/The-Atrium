// The measurement four different places got wrong.
//
// A path stores only its points; its x/y/width/height stay wherever it was
// created. Measuring one from those describes a rectangle the path has left,
// and that mistake shipped four times -- the selection box, the group bounds,
// the marquee hit test, and the nine drag handles -- each found by somebody
// using the app rather than by anything here.
//
// pathWorldBounds is now the single answer, so this is the file that has to
// hold.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pathWorldBounds, isPathTrace } from '../src/lib/pathBounds.ts'

test('measures the extent of the points', () => {
  const box = pathWorldBounds([
    { x: 10, y: 20 },
    { x: 50, y: 5 },
    { x: 30, y: 40 },
  ])
  assert.deepEqual(box, { minX: 10, minY: 5, maxX: 50, maxY: 40 })
})

test('grows by half the stroke on every side, so the box holds the line', () => {
  const box = pathWorldBounds([{ x: 0, y: 0 }, { x: 100, y: 100 }], 10)
  assert.deepEqual(box, { minX: -5, minY: -5, maxX: 105, maxY: 105 })
})

test('no stroke given means the bare point extent', () => {
  // getGroupBounds relies on this: those bounds anchor a group scale, and
  // widening the box by half a stroke would move the anchor.
  const box = pathWorldBounds([{ x: 0, y: 0 }, { x: 10, y: 10 }])
  assert.deepEqual(box, { minX: 0, minY: 0, maxX: 10, maxY: 10 })
})

test('a single point is a box with no area, not null', () => {
  const box = pathWorldBounds([{ x: 7, y: 9 }])
  assert.deepEqual(box, { minX: 7, minY: 9, maxX: 7, maxY: 9 })
})

test('negative coordinates are not clamped', () => {
  const box = pathWorldBounds([{ x: -100, y: -50 }, { x: -10, y: -5 }])
  assert.deepEqual(box, { minX: -100, minY: -50, maxX: -10, maxY: -5 })
})

test('no points, null, and undefined all mean no box', () => {
  assert.equal(pathWorldBounds([]), null)
  assert.equal(pathWorldBounds(null), null)
  assert.equal(pathWorldBounds(undefined), null)
})

test('one bad coordinate is skipped, and the rest of the path still measures', () => {
  // Every comparison against NaN is false, so such a point never becomes the
  // minimum or the maximum and is simply passed over. Better than refusing the
  // whole path: one corrupt point should not make a drawing unselectable.
  assert.deepEqual(
    pathWorldBounds([{ x: 0, y: 0 }, { x: NaN, y: 10 }]),
    { minX: 0, minY: 0, maxX: 0, maxY: 10 },
  )
})

test('a path with no usable coordinate is no box, not a box spanning everything', () => {
  // What the isFinite guard is for. Without it the sentinels survive the loop
  // and the result is Infinity in every direction -- which, as a hit test,
  // selects the entire atrium.
  assert.equal(pathWorldBounds([{ x: NaN, y: NaN }]), null)
  assert.equal(pathWorldBounds([{ x: Infinity, y: 0 }, { x: NaN, y: NaN }]), null)
})

test('isPathTrace is true only for a shape whose shapeType is path', () => {
  assert.equal(isPathTrace({ type: 'shape', shapeType: 'path' }), true)
  assert.equal(isPathTrace({ type: 'shape', shapeType: 'rectangle' }), false)
  assert.equal(isPathTrace({ type: 'image' }), false)
  assert.equal(isPathTrace({}), false)
})

test('the centre a caller derives from the box is the centre of the line', () => {
  // How every one of the four call sites uses it: centre for placement, span
  // for size. Written out here because that arithmetic is what was wrong.
  const points = [{ x: 100, y: 200 }, { x: 300, y: 400 }]
  const box = pathWorldBounds(points)!
  assert.equal((box.minX + box.maxX) / 2, 200)
  assert.equal((box.minY + box.maxY) / 2, 300)
  assert.equal(box.maxX - box.minX, 200)
  assert.equal(box.maxY - box.minY, 200)
})
