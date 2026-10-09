// Dashed and dotted lines: the same dashes at any zoom.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dashArray } from '../src/lib/strokeStyle.ts'

test('a pattern grows and shrinks with the zoom, never by its own rule', () => {
  for (const style of ['dashed', 'dotted'] as const) {
    for (const width of [0.5, 2, 8]) {
      const atOne = dashArray(style, width, 1)!
      for (const zoom of [0.15, 0.4, 1.4]) {
        assert.deepEqual(dashArray(style, width, zoom), atOne.map(n => n * zoom), `${style} ${width} @${zoom}`)
      }
    }
  }
  assert.equal(dashArray('solid', 2, 0.5), null)
})
