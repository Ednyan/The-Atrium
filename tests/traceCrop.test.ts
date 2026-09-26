// Cropping: which edges a handle moves, and how the trace moves with them.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { boxFromWindow, cropShift, dragCrop, MIN_CROP, turn, WHOLE } from '../src/lib/traceCrop.ts'

const close = (a: object, b: object) => {
  for (const [k, v] of Object.entries(b)) assert.ok(Math.abs((a as any)[k] - v) < 1e-9, `${k}: ${(a as any)[k]} is not ${v}`)
}

test('a handle moves only its own edges', () => {
  close(dragCrop(WHOLE, 'l', 0.2, 0.5), { x: 0.2, y: 0, w: 0.8, h: 1 })
  close(dragCrop(WHOLE, 'br', -0.25, -0.5), { x: 0, y: 0, w: 0.75, h: 0.5 })
  close(dragCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, 't', 0.3, 0.2), { x: 0.1, y: 0.3, w: 0.5, h: 0.3 })
})

test('an edge stops at the box, and short of the edge opposite', () => {
  close(dragCrop({ x: 0.2, y: 0, w: 0.5, h: 1 }, 'l', -0.9, 0), { x: 0, w: 0.7 })
  close(dragCrop(WHOLE, 'r', -2, 0), { x: 0, w: MIN_CROP })
})

test('the window slides across the content, and not off it', () => {
  close(dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'm', 0.1, -0.1), { x: 0.3, y: 0.1, w: 0.5, h: 0.5 })
  close(dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, 'm', 0.9, 0.9), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 })
})

test('cropping one edge moves the centre half as far, so the other edge stays', () => {
  // Left edge in by 0.2: the centre moves right by 0.1.
  close(cropShift(WHOLE, dragCrop(WHOLE, 'l', 0.2, 0)), { u: 0.1, v: 0 })
  // Sliding the window moves the centre by as much.
  close(cropShift({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, { x: 0.3, y: 0.2, w: 0.5, h: 0.5 }), { u: 0.1, v: 0 })
})

test('the whole box sits back from the window by the crop', () => {
  close(boxFromWindow(WHOLE), { u: 0, v: 0 })
  // Kept the right half: the box's centre is a quarter to the left.
  close(boxFromWindow({ x: 0.5, y: 0, w: 0.5, h: 1 }), { u: -0.25, v: 0 })
})

test('a vector turns with the trace', () => {
  close(turn(1, 0, 90), { x: 0, y: 1 })
  close(turn(0, 1, 90), { x: -1, y: 0 })
})
