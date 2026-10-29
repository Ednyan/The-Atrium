// What a trace's save writes: each setting reaches its column.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { traceColumns } from '../src/lib/traceInsert.ts'

const base = { id: 'x', x: 0, y: 0, userId: 'u', username: 'me', lobbyId: 'L', createdAt: '' }

test("a sound's bar colour is saved, in the shape's colour column", () => {
  assert.equal(traceColumns({ ...base, type: 'audio', shapeColor: '#ff7a1a' } as any).shape_color, '#ff7a1a')
})

test("a shape's colour is saved; a text's stray one is not", () => {
  assert.equal(traceColumns({ ...base, type: 'shape', shapeType: 'rectangle', shapeColor: '#3b82f6' } as any).shape_color, '#3b82f6')
  assert.equal('shape_color' in traceColumns({ ...base, type: 'text', shapeColor: '#3b82f6' } as any), false)
})
