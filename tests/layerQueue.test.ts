// Layer changes run one after another, never interleaved.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { layerChangeUnderWay, queueLayerChange } from '../src/lib/layerQueue.ts'

const tick = () => new Promise(resolve => setTimeout(resolve, 1))

test('changes run one at a time, in order, and a failure does not stop the next', async () => {
  const log: string[] = []
  const change = (name: string, fail = false) => async () => {
    log.push(`${name} start`)
    await tick()
    await tick()
    log.push(`${name} end`)
    if (fail) throw new Error(name)
    return name
  }
  assert.equal(layerChangeUnderWay(), false)
  const a = queueLayerChange(change('a'))
  const b = queueLayerChange(change('b', true))
  const c = queueLayerChange(change('c'))
  assert.equal(layerChangeUnderWay(), true)
  assert.equal(await a, 'a')
  await assert.rejects(b, /b/)
  assert.equal(await c, 'c')
  assert.deepEqual(log, ['a start', 'a end', 'b start', 'b end', 'c start', 'c end'])
  assert.equal(layerChangeUnderWay(), false)
})
