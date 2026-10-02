// Sizes in the unit they've reached, written as the language writes them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSize } from '../src/lib/size.ts'

test('each size in the unit it has reached', () => {
  assert.equal(formatSize(0, 'en'), '0 byte')
  assert.equal(formatSize(512, 'en'), '512 byte')
  assert.equal(formatSize(1536, 'en'), '1.5 kB')
  assert.equal(formatSize(12.4 * 1024 * 1024, 'en'), '12.4 MB')
  assert.equal(formatSize(3.25 * 1024 ** 3, 'en'), '3.25 GB')
  assert.equal(formatSize(5 * 1024 ** 4, 'en'), '5,120 GB')
})

test("in the language's own units", () => {
  // French puts a narrow no-break space before the unit.
  assert.match(formatSize(12.4 * 1024 * 1024, 'fr'), /^12,4\sMo$/)
})
