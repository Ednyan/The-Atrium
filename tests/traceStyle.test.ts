// Copy Style / Paste Style: each trace takes what it has of another's look.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stylePatchFor, styleOf } from '../src/lib/traceStyle.ts'

const base = { id: 'x', x: 0, y: 0, userId: 'u', username: 'u', createdAt: '' }
const text = { ...base, id: 't', type: 'text', content: 'hi', borderColor: '#ff0000', showBorder: false, fontFamily: 'serif', textColor: '#00ff00', illuminate: true } as any
const drawing = { ...base, id: 'd', type: 'image', content: 'Drawing 1', strokeData: { v: 2, kind: 'drawing', ppw: 1, ops: [{ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], color: '#123456', width: 6, isEraser: false, brush: 'pencil', hardness: 0.5 }], rev: 1, fileRev: 1 } } as any
const rect = { ...base, id: 'r', type: 'shape', shapeType: 'rectangle', shapeColor: '#ff8800', shapeOutlineWidth: 5, cornerRadius: 12 } as any
const path = { ...base, id: 'p', type: 'shape', shapeType: 'path', shapeColor: '#999999', pathArrowEnd: 'triangle' } as any

test('text to a drawing: its frame, captions and light, not its font', () => {
  const patch = stylePatchFor(drawing, styleOf(text))
  assert.equal(patch.borderColor, '#ff0000')
  assert.equal(patch.showBorder, false)
  assert.equal(patch.illuminate, true)
  assert.equal('fontFamily' in patch || 'textColor' in patch, false)
})

test('a rectangle to a path: the colour and thickness both have, not corners or arrows', () => {
  const patch = stylePatchFor(path, styleOf(rect))
  assert.equal(patch.shapeColor, '#ff8800')
  assert.equal(patch.shapeOutlineWidth, 5)
  assert.equal('cornerRadius' in patch, false)
  assert.equal('pathArrowEnd' in patch, false)
})

test('a default is copied as the default, so the copy looks the same', () => {
  // The rectangle shows a border by default; the text above has it off.
  const patch = stylePatchFor(text, styleOf({ ...base, type: 'image', mediaUrl: 'https://x/a.png' } as any))
  assert.equal(patch.showBorder, true)
  // A kind's own border colour is copied as unset, for each to show its own.
  assert.equal(patch.borderColor, null)
})

test('a path to a rectangle: only what a rectangle has', () => {
  const patch = stylePatchFor(rect, styleOf(path))
  assert.equal(patch.shapeColor, '#999999')
  assert.equal('pathArrowEnd' in patch || 'pathCurveType' in patch, false)
})

test('a drawing carries its strokes; text has none', () => {
  assert.deepEqual(styleOf(drawing).strokes, { color: '#123456', width: 6, brush: 'pencil', hardness: 0.5 })
  assert.equal(styleOf(text).strokes, null)
})
