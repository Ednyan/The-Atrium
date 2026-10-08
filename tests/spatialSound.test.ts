// Spatial sound: how a trace is heard from where it is on screen.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { heardAt } from '../src/lib/spatialSound.ts'

test('in view: as it is, centred; out of view: quieter with distance, from its side', () => {
  assert.deepEqual(heardAt(100, 100, 1000, 800), { volume: 1, pan: 0 })
  assert.deepEqual(heardAt(999, 799, 1000, 800), { volume: 1, pan: 0 })
  const right = heardAt(1250, 400, 1000, 800)
  assert.ok(right.volume < 1 && right.volume > 0.7 && right.pan === 0.5, JSON.stringify(right))
  const left = heardAt(-600, 400, 1000, 800)
  assert.equal(left.pan, -1)
  assert.ok(left.volume < right.volume)
  // Straight above: quieter, from the middle.
  const above = heardAt(500, -300, 1000, 800)
  assert.equal(above.pan, 0)
  assert.ok(above.volume < 1)
  // A screen and a half away: silent.
  assert.equal(heardAt(1000 + 1500, 400, 1000, 800).volume, 0)
})
