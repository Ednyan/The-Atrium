import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ARRANGE_GAP, carriedFrameId, frameAround, frameAt, frameOfCopy, freshIds, heldBy, masonry, placeUnits, putInFrame, readingOrder, unitMiddle, unitsOf, withHeld, type FrameBox } from '../src/lib/frames.ts'

test('withHeld gives a frame with what it holds, and nothing else', () => {
  const all = [
    { id: 'f', type: 'frame' },
    { id: 'a', type: 'shape', frameId: 'f' },
    { id: 'b', type: 'shape', frameId: 'other' },
    { id: 'c', type: 'shape' },
  ]
  assert.deepEqual(withHeld([all[0]], all).map(t => t.id), ['f', 'a'])
  assert.deepEqual(withHeld([all[2]], all).map(t => t.id), ['b'])
  assert.deepEqual(withHeld([all[1], all[0]], all).map(t => t.id), ['f', 'a'])
})

test("a copy goes in its frame's copy, keeps its group's frame, or joins where it lands", () => {
  const box = (cx: number, cy: number) => ({ cx, cy, halfW: 50, halfH: 50 })
  const frames = [{ id: 'f', box: box(0, 0) }, { id: 'g', box: box(500, 0) }]
  const ids = new Map([['f', 'f2'], ['a', 'a2']])
  const held = { id: 'a', type: 'shape', frameId: 'f' }
  const elsewhere = { x: 2000, y: 2000 }
  assert.equal(frameOfCopy(held, ids, false, frames, elsewhere), 'f2')
  assert.equal(frameOfCopy({ id: 'f', type: 'frame' }, ids, false, frames, { x: 0, y: 0 }), null)
  // Its frame not copied: where it lands, wherever it came from.
  const alone = { id: 'b', type: 'shape', frameId: 'g' }
  assert.equal(frameOfCopy(alone, ids, false, frames, { x: 510, y: 0 }), 'g')
  assert.equal(frameOfCopy(alone, ids, false, frames, { x: 0, y: 0 }), 'f')
  assert.equal(frameOfCopy(alone, ids, false, frames, elsewhere), null)
  // In its original's group: where the group is, wherever it lands.
  assert.equal(frameOfCopy(alone, ids, true, frames, elsewhere), 'g')
  assert.equal(frameOfCopy({ id: 'c', type: 'shape', frameId: 'gone' }, ids, true, frames, { x: 0, y: 0 }), null)
})

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

test('an arranged frame: columns across it, each unit at the column width, in the shortest column', () => {
  const frameBox = { cx: 300, cy: 100, halfW: 300, halfH: 100 }
  const units = [
    { cx: 0, cy: 0, halfW: 50, halfH: 50 },
    { cx: 0, cy: 0, halfW: 50, halfH: 100 },
    { cx: 0, cy: 0, halfW: 100, halfH: 50 },
  ]
  const { frame: grown, placed } = masonry(frameBox, units)
  // 600 wide: two columns of (600 - 3 gaps) / 2.
  const width = (600 - 3 * ARRANGE_GAP) / 2
  assert.equal(placed[0].factor, width / 100)
  assert.equal(placed[0].cx, ARRANGE_GAP + width / 2)
  assert.equal(placed[1].cx, 2 * ARRANGE_GAP + width * 1.5)
  // The third goes under the first: its column is the shorter.
  assert.equal(placed[2].cx, placed[0].cx)
  assert.equal(placed[2].cy, ARRANGE_GAP + width + ARRANGE_GAP + width / 4)
  // The frame keeps its top and width, and ends below its tallest column.
  assert.equal(grown.cy - grown.halfH, 0)
  assert.equal(grown.halfW, 300)
  assert.equal(grown.cy + grown.halfH, ARRANGE_GAP + 2 * width + ARRANGE_GAP)
})

test('a border stays its size: the unit ends exactly the column wide', () => {
  const frameBox = { cx: 150, cy: 100, halfW: 150, halfH: 100 }
  const [{ factor }] = masonry(frameBox, [{ cx: 0, cy: 0, halfW: 52, halfH: 32, edge: 2 }]).placed
  const width = 300 - 2 * ARRANGE_GAP
  assert.ok(Math.abs((100 * factor) + 4 - width) < 1e-9)
})

test('arranging an arranged frame changes nothing, and reading order is what it reads back in', () => {
  const frameBox = { cx: 500, cy: 300, halfW: 500, halfH: 300 }
  const sizes = [[60, 40], [40, 90], [80, 50], [50, 50], [70, 30], [30, 80], [55, 65]]
  const units = sizes.map(([halfW, halfH], i) => ({ cx: i * 10, cy: i * 7, halfW, halfH }))
  const once = masonry(frameBox, units)
  const laid = units.map((u, i) => ({ cx: once.placed[i].cx, cy: once.placed[i].cy, halfW: u.halfW * once.placed[i].factor, halfH: u.halfH * once.placed[i].factor, i }))
  const again = readingOrder(laid)
  assert.deepEqual(again.map(u => u.i), laid.map(u => u.i))
  const twice = masonry(once.frame, again)
  twice.placed.forEach((p, k) => {
    assert.ok(Math.abs(p.cx - laid[k].cx) < 1e-6 && Math.abs(p.cy - laid[k].cy) < 1e-6)
    assert.ok(Math.abs(p.factor - 1) < 1e-9)
  })
  assert.deepEqual(twice.frame, once.frame)
})

test('a narrow frame is one column; an empty one is left as it is', () => {
  const narrow = { cx: 100, cy: 100, halfW: 100, halfH: 100 }
  const { placed } = masonry(narrow, [{ cx: 0, cy: 0, halfW: 10, halfH: 10 }, { cx: 0, cy: 0, halfW: 10, halfH: 10 }])
  assert.equal(placed[0].cx, placed[1].cx)
  assert.deepEqual(masonry(narrow, []).frame, narrow)
})
