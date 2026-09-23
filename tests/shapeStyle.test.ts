// The one description of a shape's look that the create panel, the customize
// panel and the placement preview now share.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  colourToNumber,
  sameShapeDraft,
  shapeStyleColumns,
  shapeStyleOf,
  type ShapeDraft,
} from '../src/lib/shapeStyle.ts'

test('a bare trace gets the defaults the renderer uses', () => {
  const style = shapeStyleOf({})
  assert.equal(style.shapeType, 'rectangle')
  assert.equal(style.shapeColor, '#3b82f6')
  assert.equal(style.shapeOpacity, 1)
  assert.equal(style.shapeOutlineOnly, false)
  assert.equal(style.shapeOutlineWidth, 2)
  assert.equal(style.cornerRadius, 0)
  assert.equal(style.pathArrowStart, 'none')
})

test('a path defaults to grey, not blue', () => {
  assert.equal(shapeStyleOf({ shapeType: 'path' }).shapeColor, '#9ca3af')
})

test('values that are set survive, including falsy ones', () => {
  const style = shapeStyleOf({ shapeOpacity: 0, cornerRadius: 0, shapeNoFill: true, shapeOutlineWidth: 12 })
  assert.equal(style.shapeOpacity, 0)
  assert.equal(style.shapeNoFill, true)
  assert.equal(style.shapeOutlineWidth, 12)
})

test('every style field reaches a database column', () => {
  // A field missing here is one the create panel shows but never saves.
  const style = shapeStyleOf({ shapeOutlineColor: '#ff0000' })
  const columns = shapeStyleColumns(style)
  assert.equal(Object.keys(columns).length, Object.keys(style).length)
  assert.equal(columns.shape_outline_color, '#ff0000')
  assert.equal(columns.shape_outline_only, false)
  assert.equal(columns.path_curve_type, 'straight')
})

test('drafts that draw the same compare equal, and any difference does not', () => {
  const a: ShapeDraft = { ...shapeStyleOf({}), width: 200, height: 100 }
  assert.equal(sameShapeDraft(a, { ...a }), true)
  assert.equal(sameShapeDraft(a, { ...a, shapeColor: '#000000' }), false)
  assert.equal(sameShapeDraft(a, { ...a, width: 201 }), false)
  assert.equal(sameShapeDraft(null, null), true)
  assert.equal(sameShapeDraft(a, null), false)
})

test('colours become the numbers Pixi takes', () => {
  assert.equal(colourToNumber('#ff0000'), 0xff0000)
  assert.equal(colourToNumber('#38f'), 0x3388ff)
  assert.equal(colourToNumber('ABCDEF'), 0xabcdef)
  // Anything unparseable draws blue rather than black or nothing.
  assert.equal(colourToNumber('#nope'), 0x3b82f6)
  assert.equal(colourToNumber(undefined), 0x3b82f6)
})
