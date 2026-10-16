// A Drive atrium's files: sealed with the atrium's key, and its saves merged by clock.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  admit, changesSince, invitedWritersOf, keyFromText, KeyMissing, keyringOf, keyToText, later, merge, newAtriumKey, newIdentity, newRoster,
  newSecret, openWithSecret, placeOf, removeMember, rowsOf, sameKey, seal, sealForSecret, sealJson, snapshotOf, tick, unseal, unsealJson, unwrapWith, wrapFor, writersOf,
  type Change, type Keyring, type Merged,
} from '../src/lib/driveFormat.ts'

const ring = (...keys: CryptoKey[]): Keyring => new Map(keys.map((key, n) => [n, key]))

test('a sealed file opens with its keyring, and with nothing else', async () => {
  const key = await newAtriumKey()
  const sealed = await sealJson(ring(key), { hello: 'atrium' })
  assert.deepEqual(await unsealJson(ring(key), sealed), { hello: 'atrium' })
  // What Drive holds says nothing of what's in it.
  assert.equal(new TextDecoder().decode(sealed).includes('atrium'), false)
  // Sealed twice, two different files: nobody can tell two files hold the same.
  assert.notDeepEqual(await sealJson(ring(key), { hello: 'atrium' }), sealed)

  await assert.rejects(unseal(ring(await newAtriumKey()), sealed))
  const changed = sealed.slice()
  changed[changed.length - 1] ^= 1
  await assert.rejects(unseal(ring(key), changed))
  await assert.rejects(unseal(ring(key), new Uint8Array([9, 1, 2, 3])))
})

test('a file says which generation sealed it: the newest seals, any older one still opens', async () => {
  const [first, second] = [await newAtriumKey(), await newAtriumKey()]
  const old = await seal(ring(first), new Uint8Array([1]))
  const both = ring(first, second)
  const now = await seal(both, new Uint8Array([2]))
  assert.deepEqual(await unseal(both, old), new Uint8Array([1]))
  assert.deepEqual(await unseal(both, now), new Uint8Array([2]))
  // Without the newer generation: KeyMissing, which says which.
  await assert.rejects(unseal(ring(first), now), (e: unknown) => e instanceof KeyMissing && e.generation === 1)
})

test('a key kept as text comes back the same key', async () => {
  const key = await newAtriumKey()
  const back = await keyFromText(await keyToText(key))
  assert.deepEqual(await unseal(ring(back), await seal(ring(key), new Uint8Array([1, 2, 3]))), new Uint8Array([1, 2, 3]))
  await assert.rejects(keyFromText('short'))
})

test('a public key is the same key however its fields come back ordered', async () => {
  const { publicJwk } = await newIdentity()
  // As Postgres's jsonb hands it back: its fields in another order.
  const reordered = Object.fromEntries(Object.entries(publicJwk).reverse()) as JsonWebKey
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(publicJwk))
  assert.ok(sameKey(reordered, publicJwk))
  assert.ok(!sameKey((await newIdentity()).publicJwk, publicJwk))
  assert.ok(!sameKey(null, publicJwk))
})

test("the atrium's key, encrypted for one person, opens with their private key alone", async () => {
  const [ana, ben] = [await newIdentity(), await newIdentity()]
  const key = await newAtriumKey()
  const wrapped = await wrapFor(ana.publicJwk, key)
  const opened = await unwrapWith(ana.privateJwk, wrapped)
  assert.deepEqual(await unseal(ring(opened), await seal(ring(key), new Uint8Array([7]))), new Uint8Array([7]))
  await assert.rejects(unwrapWith(ben.privateJwk, wrapped))
})

test('members: admitted, they read every generation; removed, they read nothing new', async () => {
  const [ana, ben, cat] = [await newIdentity(), await newIdentity(), await newIdentity()]
  const key = await newAtriumKey()
  const person = (user: string, id: { publicJwk: JsonWebKey }) => ({ user, name: user, root: 'R-' + user, pub: id.publicJwk })
  let roster = await newRoster('L', 'Atrium', person('ana', ana), key)
  let keyring = ring(key)
  assert.equal((await keyringOf(roster, 'ana', ana.privateJwk)).size, 1)
  roster = await admit(roster, keyring, person('ben', ben), 'editor')
  roster = await admit(roster, keyring, person('cat', cat), 'viewer')
  assert.deepEqual(writersOf(roster).map(m => m.user), ['ana', 'ben'])
  const before = await seal(keyring, new Uint8Array([1]))

  // Ben out, and blocked: a new generation, made without him.
  ;({ roster, keyring } = await removeMember(roster, keyring, 'ben', true))
  const after = await seal(keyring, new Uint8Array([2]))
  const bens = await keyringOf(roster, 'ben', ben.privateJwk)
  assert.equal(bens.size, 0)
  const cats = await keyringOf(roster, 'cat', cat.privateJwk)
  assert.deepEqual(await unseal(cats, before), new Uint8Array([1]))
  assert.deepEqual(await unseal(cats, after), new Uint8Array([2]))
  assert.deepEqual(roster.blocked, ['ben'])
  await assert.rejects(admit(roster, keyring, person('ben', ben), 'editor'))
  // Someone new later reads the old generation too.
  const dan = await newIdentity()
  roster = await admit(roster, keyring, person('dan', dan), 'editor')
  assert.deepEqual(await unseal(await keyringOf(roster, 'dan', dan.privateJwk), before), new Uint8Array([1]))
  // The owner can't be removed.
  await assert.rejects(removeMember(roster, keyring, 'ana', false))
})

test("an invitation's secret opens every generation of the key, until someone is removed", async () => {
  const ana = await newIdentity()
  let keyring = ring(await newAtriumKey())
  let roster = await newRoster('L', 'Atrium', { user: 'ana', name: 'ana', root: 'R', pub: ana.publicJwk }, keyring.get(0)!)
  const secret = newSecret()
  roster = { ...roster, invited: [{ user: 'dan', name: 'Dan', role: 'editor', keys: await sealForSecret(secret, keyring) }, { user: 'eve', name: 'Eve', role: 'viewer', keys: await sealForSecret(newSecret(), keyring) }] }
  const sealed = await seal(keyring, new Uint8Array([5]))
  const dans = await openWithSecret(secret, roster.invited[0].keys!)
  assert.deepEqual(await unseal(dans, sealed), new Uint8Array([5]))
  await assert.rejects(openWithSecret(newSecret(), roster.invited[0].keys!))
  // In by their invitation: a place, and Dan's saves count (Eve's, a viewer's, don't).
  assert.equal(placeOf(roster, 'dan')?.role, 'editor')
  assert.deepEqual(invitedWritersOf(roster).map(i => i.user), ['dan'])
  // Someone removed: every invitation's secret cancelled -- they get in by their key pair.
  ;({ roster, keyring } = await removeMember(roster, keyring, 'eve', false))
  assert.equal(roster.invited.length, 1)
  assert.equal(roster.invited[0].keys, undefined)
  assert.equal(placeOf(roster, 'dan'), null)
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

test('where its files are in Drive is never taken for deleted', () => {
  const merged: Merged = new Map()
  merge(merged, [
    { table: 'traces', id: 't1', at: '1', row: { id: 't1', media_url: 'local://traces/L/a.png' } },
    { table: 'media', id: 'local://traces/L/a.png', at: '1', row: { id: 'local://traces/L/a.png', file: 'F1' } },
  ])
  // The working copy has no such table: compared, nothing changed.
  assert.deepEqual(changesSince(merged, { traces: [{ id: 't1', media_url: 'local://traces/L/a.png' }] }, '2'), [])
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
