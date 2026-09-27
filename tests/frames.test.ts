import { test } from 'node:test'
import assert from 'node:assert/strict'

import { carriedFrameId, frameAround, frameAt, freshIds, heldBy, placeUnits, putInFrame, unitMiddle, unitsOf, type FrameBox } from '../src/lib/frames.ts'

type T = { id: string; type: string; layerId?: string | null; frameId?: string | null; box: FrameBox }
const trace = (id: string, cx: number, cy: number, extra: Partial<T> = {}): T =>
  ({ id, type: 'text', box: { cx, cy, halfW: 10, halfH: 10 }, ...extra })
const boxOf = (t: T) => t.box
const frame = (id: string, cx: number, cy: number, halfW: number, halfH: number): T =>
  ({ id, type: 'frame', box: { cx, cy, halfW, halfH } })
const framesOf = (traces: T[]) => traces.filter(t => t.type === 'frame').map(t => ({ id: t.id, box: t.box }))

test('a point is in the smallest frame that holds it', () => {
  const frames = framesOf([frame('big', 0, 0, 500, 500), frame('small', 100, 100, 50, 50)])
  assert.equal(frameAt(frames, 100, 100), 'small')
  assert.equal(frameAt(frames, -300, 0), 'big')
  assert.equal(frameAt(frames, 900, 0), null)
})

test('a group is one unit; frames are none; a trace in a group that is gone is on its own', () => {
  const traces = [trace('a', 0, 0, { layerId: 'G' }), trace('b', 50, 0, { layerId: 'G' }), trace('c', 0, 0, { layerId: 'gone' }), frame('F', 0, 0, 100, 100)]
  const units = unitsOf(traces, new Set(['G']))
  assert.deepEqual(units.map(u => u.map(t => t.id)), [['a', 'b'], ['c']])
  assert.deepEqual(unitsOf(traces, new Set(['G']), new Set(['b'])).map(u => u.map(t => t.id)), [['a', 'b']])
})

test('a unit is placed by the middle of all of it', () => {
  const unit = [trace('a', 0, 0), trace('b', 100, 0)]
  assert.deepEqual(unitMiddle(unit, boxOf), { x: 50, y: 0 })
})

test('dropped into a frame it joins; taken out it leaves; only changes are returned', () => {
  const F = frame('F', 0, 0, 100, 100)
  const inside = trace('in', 20, 20)
  const outside = trace('out', 500, 0, { frameId: 'F' })
  const staying = trace('stay', -20, 0, { frameId: 'F' })
  const changes = placeUnits([[inside], [outside], [staying]], framesOf([F]), boxOf)
  assert.deepEqual([...changes], [['in', 'F'], ['out', null]])
})

test('a group half in a frame goes where its middle is, whole', () => {
  const F = frame('F', 0, 0, 100, 100)
  // Two traces in, one far out: the middle of the three is out.
  const group = [trace('a', 0, 0, { layerId: 'G' }), trace('b', 50, 0, { layerId: 'G' }), trace('c', 400, 0, { layerId: 'G' })]
  assert.deepEqual([...placeUnits([group], framesOf([F]), boxOf)], [])
  const near = [trace('a', 0, 0, { layerId: 'G' }), trace('b', 50, 0, { layerId: 'G' }), trace('c', 120, 0, { layerId: 'G' })]
  assert.deepEqual([...placeUnits([near], framesOf([F]), boxOf)], [['a', 'F'], ['b', 'F'], ['c', 'F']])
})

test('a moved trace naming a deleted frame has it cleared', () => {
  const orphan = trace('o', 900, 900, { frameId: 'deleted' })
  assert.deepEqual([...placeUnits([[orphan]], [], boxOf)], [['o', null]])
})

test('a moving frame carries what it holds, and only that', () => {
  const traces = [frame('F', 0, 0, 100, 100), trace('a', 0, 0, { frameId: 'F' }), trace('b', 0, 0), trace('c', 0, 0, { frameId: 'other' })]
  assert.deepEqual(heldBy(new Set(['F']), traces).map(t => t.id), ['a'])
})

test('wrapping puts every unit in the new frame, whatever it was in', () => {
  const units = [[trace('a', 0, 0, { frameId: 'old' })], [trace('b', 0, 0, { frameId: 'W' })]]
  assert.deepEqual([...putInFrame(units, 'W')], [['a', 'W']])
})

test('a frame around boxes holds them with room to spare', () => {
  const box = frameAround([{ cx: 0, cy: 0, halfW: 10, halfH: 10 }, { cx: 100, cy: 50, halfW: 10, halfH: 10 }], 40)
  assert.deepEqual(box, { cx: 50, cy: 25, halfW: 100, halfH: 75 })
})

test('carried into another atrium, a frame_id follows its frame to the new id', () => {
  let n = 0
  const ids = freshIds([{ id: 'F' }, { id: 'a' }, {}], () => `new${++n}`)
  assert.equal(carriedFrameId('F', ids), 'new1')
  assert.equal(carriedFrameId('missing', ids), null)
  assert.equal(carriedFrameId(null, ids), null)
})
