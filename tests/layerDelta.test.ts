import test from 'node:test'
import assert from 'node:assert/strict'
import { deltaIsEmpty, layerDelta, reverseDelta } from '../src/lib/layerDelta.ts'

const trace = (id: string, extra: Record<string, unknown> = {}) => ({ id, x: 0, y: 0, type: 'text', content: id, userId: 'u', username: 'me', createdAt: '', scale: 1, rotation: 0, ...extra }) as any
const layer = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, createdAt: '', isGroup: true, userId: 'u', ...extra }) as any
const link = (id: string, from: string, to: string) => ({ id, from, to }) as any

test('traces moved into a new group: the group made, and each trace where it went', () => {
  const a = trace('a'), b = trace('b', { layerId: null, orderKey: 'a1' })
  const before = { traces: [a, b], links: [], layers: [] }
  const after = { traces: [{ ...a, layerId: 'G', orderKey: 'a0' }, { ...b, layerId: 'G', orderKey: 'a1' }], links: [], layers: [layer('G')] }
  const d = layerDelta(before, after)
  assert.deepEqual(d.layersAdded.map(l => l.id), ['G'])
  assert.deepEqual(d.tracesChanged, [
    { id: 'a', before: { layerId: null, orderKey: null }, after: { layerId: 'G', orderKey: 'a0' } },
    { id: 'b', before: { layerId: null }, after: { layerId: 'G' } },
  ])
  // Undone: the group goes, the traces go back.
  const back = reverseDelta(d)
  assert.deepEqual(back.layersRemoved.map(l => l.id), ['G'])
  assert.deepEqual(back.tracesChanged[0], { id: 'a', before: { layerId: 'G', orderKey: 'a0' }, after: { layerId: null, orderKey: null } })
})

test('a group deleted with its traces: all of it, connections included, to bring back', () => {
  const g = layer('G'), a = trace('a', { layerId: 'G' }), c = trace('c')
  const l = link('L', 'a', 'c')
  const d = layerDelta({ traces: [a, c], links: [l], layers: [g] }, { traces: [c], links: [], layers: [] })
  assert.deepEqual([d.layersRemoved.map(x => x.id), d.tracesRemoved.map(x => x.id), d.linksRemoved.map(x => x.id)], [['G'], ['a'], ['L']])
  const back = reverseDelta(d)
  assert.deepEqual([back.layersAdded.map(x => x.id), back.tracesAdded.map(x => x.id), back.linksAdded.map(x => x.id)], [['G'], ['a'], ['L']])
})

test('a renamed group, and a locked trace; untouched fields and objects are left out', () => {
  const g = layer('G', { orderKey: 'a0' }), a = trace('a', { x: 5 }), b = trace('b')
  const d = layerDelta({ traces: [a, b], links: [], layers: [g] }, { traces: [{ ...a, isLocked: true, x: 99 }, b], links: [], layers: [{ ...g, name: 'Renamed' }] })
  assert.deepEqual(d.layersChanged, [{ id: 'G', before: { name: 'G' }, after: { name: 'Renamed' } }])
  // x is a trace's own business (a deferred edit), not a layer change's.
  assert.deepEqual(d.tracesChanged, [{ id: 'a', before: { isLocked: null }, after: { isLocked: true } }])
})

test('nothing changed is nothing to record', () => {
  const a = trace('a')
  assert.ok(deltaIsEmpty(layerDelta({ traces: [a], links: [], layers: [] }, { traces: [a], links: [], layers: [] })))
})

import { applyLayerDelta } from '../src/lib/layerDelta.ts'

// A database that notes each write, and a store that keeps what it's given.
function fakes(state: { traces: any[]; links: any[]; layers: any[] }) {
  const writes: string[] = []
  const db = {
    from(table: string) {
      const write = (what: string) => ({ eq: async (_: string, id: string) => { writes.push(`${what} ${table} ${id}`) } })
      return {
        upsert: async (row: any) => { writes.push(`upsert ${table} ${row.id}`) },
        update: (row: any) => write(`update(${Object.keys(row).join(',')})`),
        delete: () => write('delete'),
      }
    },
  }
  const store = () => ({
    ...state,
    putLayer: (l: any) => { state.layers = [...state.layers.filter(x => x.id !== l.id), l] },
    forgetLayer: (id: string) => { state.layers = state.layers.filter(x => x.id !== id) },
    addTrace: (t: any) => { state.traces = [...state.traces.filter(x => x.id !== t.id), t] },
    removeTrace: (id: string) => { state.traces = state.traces.filter(x => x.id !== id) },
    putLink: (l: any) => { state.links = [...state.links.filter(x => x.id !== l.id), l] },
    dropLink: (id: string) => { state.links = state.links.filter(x => x.id !== id) },
  })
  const adopted: string[] = []
  return { writes, target: { db, store, adopt: (id: string) => adopted.push(id) }, adopted }
}

test('undoing a group deleted with its traces brings back the group, then its traces, then their connections', async () => {
  const g = layer('G', { lobbyId: 'L' }), a = trace('a', { layerId: 'G', lobbyId: 'L' }), c = trace('c')
  const l = { id: 'L1', from: 'a', to: 'c', lobbyId: 'L', arrow: 'none', color: null, width: 2, label: '', labelOnHover: false, straight: false, toCenter: false, labelSize: 12, elbow: false, elbowAt: 0.5 }
  const before = { traces: [a, c], links: [l], layers: [g] }
  const after = { traces: [c], links: [], layers: [] }
  const d = layerDelta(before, after)
  const state = { ...after }
  const f = fakes(state)
  await applyLayerDelta(reverseDelta(d), f.target)
  assert.deepEqual(f.writes, ['upsert layers G', 'upsert traces a', 'upsert trace_links L1'])
  assert.deepEqual([state.layers.map(x => x.id), state.traces.map(x => x.id).sort(), state.links.map(x => x.id)], [['G'], ['a', 'c'], ['L1']])
  assert.deepEqual(f.adopted, ['a'])
  // And done again: the connection first, then the trace, then the group.
  const g2 = fakes(state)
  await applyLayerDelta(d, g2.target)
  assert.deepEqual(g2.writes, ['delete trace_links L1', 'delete traces a', 'delete layers G'])
  assert.deepEqual([state.layers, state.traces.map(x => x.id), state.links], [[], ['c'], []])
})

test('undoing an ungroup makes the group again before moving its traces back into it', async () => {
  const g = layer('G'), a = trace('a', { layerId: 'G', orderKey: 'a0' })
  const d = layerDelta({ traces: [a], links: [], layers: [g] }, { traces: [{ ...a, layerId: null, orderKey: 'b5' }], links: [], layers: [] })
  const state = { traces: [{ ...a, layerId: null, orderKey: 'b5' }], links: [], layers: [] as any[] }
  const f = fakes(state)
  await applyLayerDelta(reverseDelta(d), f.target)
  assert.deepEqual(f.writes, ['upsert layers G', 'update(layer_id,order_key) traces a'])
  assert.deepEqual([state.traces[0].layerId, state.traces[0].orderKey, state.layers.map(x => x.id)], ['G', 'a0', ['G']])
})
