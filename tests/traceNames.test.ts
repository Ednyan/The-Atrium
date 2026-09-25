// Numbered default names.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { firstFreeName, nextTextName } from '../src/lib/traceNames.ts'

const text = (n: number) => `Text ${n}`

test('the lowest number not taken, whatever the case', () => {
  assert.equal(firstFreeName([], text), 'Text 1')
  assert.equal(firstFreeName(['Text 1', 'text 2', 'Text 4'], text), 'Text 3')
  assert.equal(firstFreeName(['Group 1', null, undefined], text), 'Text 1')
})

test('only text traces count, and a batch counts itself', () => {
  const traces = [{ type: 'text', layerName: 'Text 1' }, { type: 'image', layerName: 'Text 2' }, { type: 'text', layerName: null }]
  assert.equal(nextTextName(traces, text), 'Text 2')
  assert.equal(nextTextName(traces, text, ['Text 2']), 'Text 3')
})
