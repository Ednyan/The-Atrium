import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resizeCursor, resizedScales } from '../src/lib/traceGeometry.ts'
import { fittedTextBox } from '../src/lib/textFit.ts'

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`)

test('a side follows the pointer along the box, turned or not', () => {
  near(resizedScales('r', 50, 0, 100, 40, 1, 1, 0).scaleX, 1.5)
  // Turned a quarter, its right side faces down the screen: pulled down, it grows.
  const turned = resizedScales('r', 0, 50, 100, 40, 1, 1, Math.PI / 2)
  near(turned.scaleX, 1.5)
  near(turned.scaleY, 1)
  // Pulled across the screen instead, it doesn't.
  near(resizedScales('r', 50, 0, 100, 40, 1, 1, Math.PI / 2).scaleX, 1)
})

test('a corner keeps the shape and follows the pointer along its diagonal', () => {
  // The bottom-right corner, pulled out along the diagonal by its own length: twice the size.
  const out = resizedScales('br', 100, 40, 100, 40, 1, 1, 0)
  near(out.scaleX, 2)
  near(out.scaleY, 2)
  // Turned half round, its bottom-right corner is up and to the left.
  const flipped = resizedScales('br', -100, -40, 100, 40, 1, 1, Math.PI)
  near(flipped.scaleX, 2)
  near(flipped.scaleY, 2)
})

test('the cursor turns with the handle', () => {
  assert.equal(resizeCursor('r', 0), 'ew-resize')
  assert.equal(resizeCursor('t', 0), 'ns-resize')
  assert.equal(resizeCursor('br', 0), 'nwse-resize')
  assert.equal(resizeCursor('tr', 0), 'nesw-resize')
  // Turned a quarter: the right side faces down, the top-left corner up and right.
  assert.equal(resizeCursor('r', 90), 'ns-resize')
  assert.equal(resizeCursor('tl', 90), 'nesw-resize')
  // Turned an eighth: a corner points straight across.
  assert.equal(resizeCursor('br', 45), 'ns-resize')
  assert.equal(resizeCursor('tl', -45), 'ew-resize')
})

test('a text set to a fixed size, or filling its box, keeps its box when its font changes', () => {
  const text = { content: 'hello', width: 300, height: 90, fontFamily: 'serif' }
  assert.equal(fittedTextBox({ ...text, textScaleWithBox: false }), null)
  assert.equal(fittedTextBox({ ...text, textFit: true }), null)
  // Any other keeps a box its text still fits in (measured as fitting here, with no canvas).
  assert.equal(fittedTextBox(text), null)
})
