// A Drive atrium's files: sealed with the atrium's key, and its saves merged by clock.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  changesSince, keyFromText, keyToText, later, merge, newAtriumKey, rowsOf, seal, sealJson, snapshotOf, tick, unseal, unsealJson,
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

test('the working copy against what is merged: new, changed and gone rows, nothing for the same', () => {
  const merged: Merged = new Map()
  merge(merged, [change('t1', '1', { id: 't1', x: 1, style: { a: 1, b: 2 } }), change('t2', '1', { id: 't2', x: 2 }), change('t3', '1', null)])
  const changes = changesSince(merged, {
    // Same row, keys in another order: no change.
    traces: [{ style: { b: 2, a: 1 }, x: 1, id: 't1' }, { id: 't2', x: 20 }, { id: 't4', x: 4 }],
  }, '2')
  assert.deepEqual(changes.map(c => [c.id, c.row === null ? 'gone' : 'row']).sort(), [['t2', 'row'], ['t4', 'row']])
  // A row the working copy no longer has: deleted, at the new clock.
  const gone = changesSince(merged, { traces: [{ id: 't1', x: 1, style: { a: 1, b: 2 } }] }, '3')
  assert.deepEqual(gone.map(c => [c.id, c.row, c.at]), [['t2', null, '3']])
  // Taken in, the next look finds nothing.
  merge(merged, gone)
  assert.deepEqual(changesSince(merged, { traces: [{ id: 't1', x: 1, style: { a: 1, b: 2 } }] }, '4'), [])
})

test("an atrium's own row travels without what's each device's", () => {
  const merged: Merged = new Map()
  const here = { id: 'L', name: 'A', theme_settings: { x: 1 }, owner_user_id: 'me', preview_url: 'local://p', updated_at: 'now' }
  const [first] = changesSince(merged, { lobbies: [here] }, '1')
  assert.deepEqual(first.row, { id: 'L', name: 'A', theme_settings: { x: 1 } })
  merge(merged, [first])
  // Someone else owns it on their device, with their own picture: not a change.
  assert.deepEqual(changesSince(merged, { lobbies: [{ ...here, owner_user_id: 'them', preview_url: 'local://q' }] }, '2'), [])
  assert.equal(changesSince(merged, { lobbies: [{ ...here, name: 'B' }] }, '3').length, 1)
})
