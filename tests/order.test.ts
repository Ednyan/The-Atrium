// Stacking order: fractional keys, and the drawing order built from them.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compareOrder, drawRanks, inOrder, isValidOrderKey, keyAt, keyBetween, keysBetween, keysFromNumbers, keysOnTop } from '../src/lib/order.ts'

test('keys between two others match the published algorithm', () => {
  const cases: [string | null, string | null, string][] = [
    [null, null, 'a0'],
    ['a0', null, 'a1'],
    [null, 'a0', 'Zz'],
    ['a0', 'a1', 'a0V'],
    ['a1', 'a2', 'a1V'],
    ['Zz', 'a0', 'ZzV'],
    ['Zz', 'a1', 'a0'],
    ['bzz', null, 'c000'],
    ['a0', 'a0V', 'a0G'],
    ['a0', 'a0G', 'a08'],
    ['b125', 'b129', 'b127'],
    ['a0', 'a1V', 'a1'],
  ]
  for (const [a, b, want] of cases) assert.equal(keyBetween(a, b), want, `${a} .. ${b}`)
  assert.throws(() => keyBetween('a1', 'a0'))
  assert.throws(() => keyBetween('a1', 'a1'))
})

test('the migration\'s keys ("c" and three digits of the rank) are valid, ordered and extendable', () => {
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
  const key = (n: number) => 'c' + digits[Math.floor(n / 3844) % 62] + digits[Math.floor(n / 62) % 62] + digits[n % 62]
  const keys = Array.from({ length: 300 }, (_, i) => key(i))
  for (const k of keys) assert.ok(isValidOrderKey(k), k)
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i - 1] < keys[i], `${keys[i - 1]} < ${keys[i]}`)
  const between = keyBetween(keys[61], keys[62])
  assert.ok(keys[61] < between && between < keys[62])
  assert.ok(keyBetween(keys[299], null) > keys[299])
})

test('inserting anywhere, thousands of times, keeps every key valid and in order', () => {
  let seed = 7
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let list: { id: string; orderKey: string }[] = []
  for (let i = 0; i < 3000; i++) {
    const index = Math.floor(random() * (list.length + 1))
    const key = keyAt(list, index)!
    list.push({ id: `t${i}`, orderKey: key })
    const sorted = inOrder(list)
    // It landed where it was put.
    assert.equal(sorted[index].id, `t${i}`)
    list = sorted
  }
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].orderKey < list[i].orderKey)
  for (const item of list) assert.ok(isValidOrderKey(item.orderKey), item.orderKey)
})

test('the same spot over and over (always to the bottom, always under the top) stays valid', () => {
  let bottom: string | null = null
  let top = 'a0'
  for (let i = 0; i < 500; i++) {
    bottom = keyBetween(null, bottom ?? top)
    const under = keyBetween(bottom, top)
    assert.ok(bottom < under && under < top)
    top = under
    assert.ok(isValidOrderKey(bottom) && isValidOrderKey(top))
  }
  // Short enough to store.
  assert.ok(top.length < 120, `${top.length}`)
})

test('several keys at once are spread in order between their bounds', () => {
  const five = keysBetween(null, null, 5)
  assert.equal(five.length, 5)
  for (let i = 1; i < 5; i++) assert.ok(five[i - 1] < five[i])
  const inside = keysBetween('a0', 'a1', 10)
  assert.ok(inside.every(k => 'a0' < k && k < 'a1'))
  for (let i = 1; i < 10; i++) assert.ok(inside[i - 1] < inside[i])
  assert.deepEqual(keysOnTop([{ id: 'x', orderKey: 'a3' }, { id: 'y', orderKey: null }], 2), ['a4', 'a5'])
})

test('ties go by id, and a thing without a key sits on top', () => {
  assert.ok(compareOrder({ id: 'a', orderKey: 'a0' }, { id: 'b', orderKey: 'a0' }) < 0)
  assert.ok(compareOrder({ id: 'a', orderKey: null }, { id: 'b', orderKey: 'z0' }) > 0)
  // Two with the same key leave no room between them: said so, not guessed at.
  assert.equal(keyAt([{ id: 'a', orderKey: 'a0' }, { id: 'b', orderKey: 'a0' }], 1), null)
})

test('the drawing order: ungrouped at the bottom, then each group from the bottom up', () => {
  const layers = [{ id: 'top', orderKey: 'a2' }, { id: 'bottom', orderKey: 'a1' }]
  const traces = [
    { id: 't-top-2', layerId: 'top', orderKey: 'a1' },
    { id: 't-top-1', layerId: 'top', orderKey: 'a0' },
    { id: 'loose', layerId: null, orderKey: 'z0' },
    { id: 't-bottom', layerId: 'bottom', orderKey: 'a5' },
    { id: 'orphan', layerId: 'gone', orderKey: 'a0' },
  ]
  const ranks = drawRanks(traces, layers)
  const order = [...ranks.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
  assert.deepEqual(order, ['orphan', 'loose', 't-bottom', 't-top-1', 't-top-2'])
})

test('rows from an older export are keyed in the order of their numbers, group by group', () => {
  const rows = [
    { id: 'b', group: 'g', z: 205 }, { id: 'a', group: 'g', z: 201 },
    { id: 'y', group: null, z: 3 }, { id: 'x', group: null, z: 1 },
  ]
  const keys = keysFromNumbers(rows, r => r.z, r => r.group)
  const ordered = (group: string | null) => inOrder(rows.filter(r => r.group === group).map(r => ({ id: r.id, orderKey: keys.get(r)! }))).map(r => r.id)
  assert.deepEqual(ordered('g'), ['a', 'b'])
  assert.deepEqual(ordered(null), ['x', 'y'])
})
