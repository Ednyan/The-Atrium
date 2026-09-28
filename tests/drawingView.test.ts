import test from 'node:test'
import assert from 'node:assert/strict'
import { placementInWorld, placementOnScreen, pointToWorld, sameView, strokeOnScreen } from '../src/lib/drawingView.ts'

const view = { x: 100, y: -50, zoom: 2 }

test('a stroke kept in the world is drawn where the view puts it, width and all', () => {
  const stroke = { points: [{ x: 0, y: 0 }, { x: 10, y: 5, p: 0.4 }], color: '#fff', width: 3, isEraser: false }
  const shown = strokeOnScreen(stroke, view)
  assert.deepEqual(shown.points, [{ x: 100, y: -50 }, { x: 120, y: -40, p: 0.4 }])
  assert.equal(shown.width, 6)
  // Back from the screen, where it was drawn.
  assert.deepEqual(pointToWorld(120, -40, view), { x: 10, y: 5 })
})

test("an edited drawing's picture goes into the world and back unchanged", () => {
  const onScreen = { cx: 300, cy: 200, rotation: 15, flipH: true, flipV: false, width: 80, height: 60, scaleX: 2, scaleY: 2, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 }
  const world = placementInWorld(onScreen, view)
  assert.deepEqual({ cx: world.cx, cy: world.cy, scaleX: world.scaleX }, { cx: 100, cy: 125, scaleX: 1 })
  // Seen at another view, it moves with the world.
  assert.deepEqual(placementOnScreen(world, { x: 0, y: 0, zoom: 1 }), { ...onScreen, cx: 100, cy: 125, scaleX: 1, scaleY: 1 })
  assert.deepEqual(placementOnScreen(world, view), onScreen)
})

test('views compare by what they draw', () => {
  assert.ok(sameView({ ...view }, view))
  assert.ok(!sameView(null, view))
  assert.ok(!sameView({ ...view, zoom: 1 }, view))
})
