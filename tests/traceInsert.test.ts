// What a trace's save writes: each setting reaches its column.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildTraceInsertRow, traceColumns } from '../src/lib/traceInsert.ts'

const base = { id: 'x', x: 0, y: 0, userId: 'u', username: 'me', lobbyId: 'L', createdAt: '' }

test("a sound's bar colour is saved, in the shape's colour column", () => {
  assert.equal(traceColumns({ ...base, type: 'audio', shapeColor: '#ff7a1a' } as any).shape_color, '#ff7a1a')
})

test("a shape's colour is saved; a text's stray one is not", () => {
  assert.equal(traceColumns({ ...base, type: 'shape', shapeType: 'rectangle', shapeColor: '#3b82f6' } as any).shape_color, '#3b82f6')
  assert.equal('shape_color' in traceColumns({ ...base, type: 'text', shapeColor: '#3b82f6' } as any), false)
})

test("a path's copy has its points moved with it, handles too", () => {
  const path = { ...base, type: 'shape', shapeType: 'path', x: 5, y: 5, shapePoints: [{ x: 10, y: 20 }, { x: 30, y: 40, cp1x: 25, cp1y: 35, cp2x: 35, cp2y: 45 }] }
  const row = buildTraceInsertRow(path as any, 'u', 'me', 'L', 50, -10)
  assert.equal(row.position_x, 55)
  assert.deepEqual(row.shape_points, [{ x: 60, y: 10 }, { x: 80, y: 30, cp1x: 75, cp1y: 25, cp2x: 85, cp2y: 35 }])
  // Written back as it was (undo's reinsert): the points where they were.
  assert.deepEqual(buildTraceInsertRow(path as any, 'u', 'me', 'L', 0, 0).shape_points, path.shapePoints)
})
