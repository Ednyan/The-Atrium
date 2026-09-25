// The drag feel: a nudge doesn't trail, a pull does, and it always settles.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { feelSpring, feelStep } from '../src/lib/dragFeel.ts'

const run = (speed: number, width = 200, height = 120) => {
  const sp = feelSpring(0, 0, width, height, 0.5)
  let most = 0, lean = 0, moving = true
  for (let t = 0; t <= 1500; t += 16) {
    const target = Math.min(t, 250) * speed
    const step = feelStep(sp, target, 0, 16)
    most = Math.max(most, Math.abs(step.ox))
    lean = Math.max(lean, Math.abs(step.lean))
    moving = step.moving
  }
  return { most, lean, moving }
}

test('a nudge does not trail, a real pull does, and both come to rest', () => {
  const nudge = run(0.02)
  assert.equal(nudge.most, 0)
  assert.equal(nudge.moving, false)
  const pull = run(1.2)
  assert.ok(pull.most > 20, `${pull.most}`)
  assert.equal(pull.moving, false)
})

test('the lean stays within five degrees, and a big thing leans less', () => {
  const small = run(1.2)
  const big = run(1.2, 900, 700)
  assert.ok(small.lean <= (5 * Math.PI) / 180 + 1e-9)
  assert.ok(big.lean < small.lean)
})
