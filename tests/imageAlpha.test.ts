import { test } from 'node:test'
import assert from 'node:assert/strict'

import { anyTransparent } from '../src/lib/imageAlpha.ts'

test('one see-through pixel is enough, an opaque picture is not', () => {
  assert.equal(anyTransparent([10, 20, 30, 255, 40, 50, 60, 255]), false)
  assert.equal(anyTransparent([10, 20, 30, 255, 0, 0, 0, 0]), true)
  assert.equal(anyTransparent([10, 20, 30, 254]), true)
})
