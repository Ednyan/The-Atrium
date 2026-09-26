// A flip mirrors what a trace shows; its crop cuts the flipped picture.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cropClip, flipInBox } from '../src/lib/traceFlip.ts'

test('an unflipped trace is left alone', () => {
  assert.equal(flipInBox({}), '')
  assert.equal(cropClip({}), undefined)
  assert.equal(cropClip({ cropWidth: 1, cropHeight: 1 }), undefined)
})

test('a flip mirrors the content within its own box', () => {
  assert.equal(flipInBox({ flipHorizontal: true }), 'translate(100%, 0%) scale(-1, 1)')
  assert.equal(flipInBox({ flipVertical: true }), 'translate(0%, 100%) scale(1, -1)')
})

test('the crop is mirrored with the content, so it cuts where it is seen', () => {
  // Keeping the left 30% (as seen): inset from the right, unflipped...
  assert.equal(cropClip({ cropX: 0, cropWidth: 0.3 }), 'inset(0% 70% 0% 0%)')
  // ...and from the left of the content once it is turned over.
  assert.equal(cropClip({ cropX: 0, cropWidth: 0.3, flipHorizontal: true }), 'inset(0% 0% 0% 70%)')
  // A crop of the height alone is a crop too.
  assert.equal(cropClip({ cropY: 0.25, cropHeight: 0.5, flipVertical: true }), 'inset(25% 0% 25% 0%)')
})
