// Which settings each kind of trace has, and what a mixed selection offers.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { BATCH_SETTINGS, has, kindOf, settingsOf, SETTINGS } from '../src/lib/traceKinds.ts'

const text = { id: 't', type: 'text' }
const rect = { id: 'r', type: 'shape', shapeType: 'rectangle' }
const path = { id: 'p', type: 'shape', shapeType: 'path' }
const drawing = { id: 'd', type: 'image', content: 'freehand drawing', mediaUrl: 'https://x/drawing_u_1.png' }
const photo = { id: 'i', type: 'image', mediaUrl: 'https://x/photo.jpg' }
const frame = { id: 'f', type: 'frame' }

test('each trace is its kind', () => {
  assert.deepEqual([text, rect, path, drawing, photo, frame].map(kindOf), ['text', 'shape', 'path', 'drawing', 'image', 'frame'])
})

test('a shape has an outline, not a border; a frame has no captions', () => {
  assert.equal(has(rect, 'shape'), true)
  assert.equal(has(rect, 'frame'), false)
  assert.equal(has(path, 'line'), true)
  assert.equal(has(frame, 'captions'), false)
  assert.equal(has({ type: 'audio' }, 'frame'), true)
  assert.equal(has({ type: 'retired-kind' }, 'light'), false)
})

test('a mixed selection: every setting any of them has, each for those that have it', () => {
  const sections = settingsOf([text, rect, drawing, photo])
  const shown = Object.fromEntries(sections.map(s => [s.setting, s.targets.map(t => t.id).join('')]))
  assert.deepEqual(shown, { strokes: 'd', shape: 'r', font: 't', frame: 'tdi', captions: 'tdi', light: 'trdi' })
  // In Batch Edit's order, and never a per-trace one.
  assert.deepEqual(sections.map(s => s.setting), BATCH_SETTINGS.filter(s => s in shown))
  assert.equal(sections.some(s => s.setting === 'link'), false)
})

test('every kind can at least give off light', () => {
  for (const [kind, settings] of Object.entries(SETTINGS)) assert.ok(settings.includes('light'), kind)
})
