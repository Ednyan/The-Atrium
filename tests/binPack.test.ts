// Placing a batch around a point: 'square' makes a square-ish block.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { packBoxesAroundCenter } from '../src/lib/binPack.ts'

const columnsAndRows = (offsets: { x: number; y: number }[]) => ({
  columns: new Set(offsets.map(o => Math.round(o.x))).size,
  rows: new Set(offsets.map(o => Math.round(o.y))).size,
})

test('pictures all one size make a square, not a column', () => {
  assert.deepEqual(columnsAndRows(packBoxesAroundCenter(Array(4).fill({ width: 300, height: 200 }))), { columns: 2, rows: 2 })
  assert.deepEqual(columnsAndRows(packBoxesAroundCenter(Array(9).fill({ width: 200, height: 200 }))), { columns: 3, rows: 3 })
  const six = columnsAndRows(packBoxesAroundCenter(Array(6).fill({ width: 300, height: 300 })))
  assert.ok(six.columns >= 2 && six.rows >= 2, JSON.stringify(six))
})

test('nothing overlaps', () => {
  const boxes = [{ width: 300, height: 200 }, { width: 120, height: 300 }, { width: 300, height: 300 }, { width: 80, height: 80 }, { width: 200, height: 150 }]
  const at = packBoxesAroundCenter(boxes)
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const apartX = Math.abs(at[i].x - at[j].x) >= (boxes[i].width + boxes[j].width) / 2
      const apartY = Math.abs(at[i].y - at[j].y) >= (boxes[i].height + boxes[j].height) / 2
      assert.ok(apartX || apartY, `${i} and ${j} overlap`)
    }
  }
})
