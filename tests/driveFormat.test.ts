// A Drive atrium's files: sealed with the atrium's key, and its saves merged by clock.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  keyFromText, keyToText, later, merge, newAtriumKey, rowsOf, seal, sealJson, snapshotOf, tick, unseal, unsealJson,
  type Change, type Merged,
} from '../src/lib/driveFormat.ts'

test('a sealed file opens with its key, and with nothing else', async () => {
  const key = await newAtriumKey()
  const sealed = await sealJson(key, { hello: 'atrium' })
  assert.deepEqual(await unsealJson(key, sealed), { hello: 'atrium' })
  // What Drive holds says nothing of what's in it.
  assert.equal(new TextDecoder().decode(sealed).includes('atrium'), false)
  // Sealed twice, two different files: nobody can tell two files hold the same.
  assert.notDeepEqual(await sealJson(key, { hello: 'atrium' }), sealed)

  await assert.rejects(unseal(await newAtriumKey(), sealed))
  const changed = sealed.slice()
  changed[changed.length - 1] ^= 1
  await assert.rejects(unseal(key, changed))
  await assert.rejects(unseal(key, new Uint8Array([9, 1, 2, 3])))
})

test("the key travels as text, as an invite link's # carries it", async () => {
  const key = await newAtriumKey()
  const text = await keyToText(key)
  assert.match(text, /^[A-Za-z0-9_-]{43}$/)
  const back = await keyFromText(text)
  assert.deepEqual(await unseal(back, await seal(key, new Uint8Array([1, 2, 3]))), new Uint8Array([1, 2, 3]))
  await assert.rejects(keyFromText('short'))
})

test('the clock sorts as it orders, and never goes back', () => {
  const a = tick(null, 1000, 'ana')
  const b = tick(a, 1000, 'ana') // the same ms
  const c = tick(b, 900, 'ana') // a clock set back
  const d = tick(c, 2000, 'ana')
  assert.ok(a < b && b < c && c < d)
  // Ben's machine is behind, but he has seen Ana's latest: his edit comes after.
  const ben = tick(later(null, d), 1500, 'ben')
  assert.ok(ben > d)
  // Past the counter's places, the next ms -- still sorting.
  let clock = tick(null, 5000, 'x')
  for (let i = 0; i < 36 ** 3 + 5; i++) {
    const next = tick(clock, 5000, 'x')
    assert.ok(next > clock)
    clock = next
  }
})

const change = (id: string, at: string, row: Record<string, unknown> | null, table: Change['table'] = 'traces'): Change => ({ table, id, at, row })

test('the latest change to a row wins, whatever order saves arrive in', () => {
  const saves = [
    [change('t1', '1', { x: 1 }), change('t2', '1', { x: 2 })],
    [change('t1', '3', { x: 30 })],
    [change('t1', '2', { x: 20 }), change('t2', '4', null)],
  ]
  const results = [[0, 1, 2], [2, 1, 0], [1, 0, 2, 1, 2]].map(order => {
    const merged: Merged = new Map()
    for (const i of order) merge(merged, saves[i])
    return JSON.stringify(rowsOf(merged, 'traces'))
  })
  assert.equal(new Set(results).size, 1)
  assert.equal(results[0], JSON.stringify([{ x: 30 }]))
})

test('a deletion holds against an older change arriving after it, through a snapshot too', () => {
  const merged: Merged = new Map()
  merge(merged, [change('t1', '5', null)])
  assert.deepEqual(merge(merged, [change('t1', '4', { x: 1 })]), [])
  assert.deepEqual(rowsOf(merged, 'traces'), [])

  // Folded into a snapshot and opened elsewhere: still deleted.
  const elsewhere: Merged = new Map()
  merge(elsewhere, snapshotOf(merged).changes)
  merge(elsewhere, [change('t1', '4', { x: 1 })])
  assert.deepEqual(rowsOf(elsewhere, 'traces'), [])
  // A later edit does bring it back -- someone chose to.
  merge(elsewhere, [change('t1', '6', { x: 2 })])
  assert.deepEqual(rowsOf(elsewhere, 'traces'), [{ x: 2 }])
})

test('merging says what took, and tables are apart', () => {
  const merged: Merged = new Map()
  assert.equal(merge(merged, [change('a', '1', { n: 1 }), change('a', '1', { n: 1 }, 'layers')]).length, 2)
  assert.equal(merge(merged, [change('a', '1', { n: 1 })]).length, 0)
  assert.deepEqual(rowsOf(merged, 'layers'), [{ n: 1 }])
})
