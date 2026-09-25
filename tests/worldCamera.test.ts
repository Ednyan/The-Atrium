// The camera over the DOM world layer: when it scales the layer, and when it
// asks for a layout instead.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createWorldCamera, layerTransform, layoutHolds, type View } from '../src/lib/worldCamera.ts'

const W = 1000, H = 600, MARGIN = 500

// A stand-in for the layer: its style, and one element that keeps its size.
function fakeLayer() {
  const label = { style: { scale: '' } }
  const layer = {
    style: { transform: '', willChange: '' },
    querySelectorAll: () => [label],
  }
  return { layer: layer as unknown as HTMLElement, style: layer.style, label }
}

function setup(canScale = true) {
  const commits: View[] = []
  const camera = createWorldCamera({ commit: view => { commits.push(view) }, margin: MARGIN })
  const fake = fakeLayer()
  let now = 0
  const frame = (view: View, dt = 16) => {
    now += dt
    return camera.frame({ layer: fake.layer, view, now, width: W, height: H, canScale })
  }
  return { commits, frame, ...fake }
}

test('a layout holds while the view stays within four fifths of its margin', () => {
  const laid = { x: 0, y: 0, zoom: 1 }
  assert.equal(layoutHolds(laid, { x: -300, y: 0, zoom: 1 }, W, H, MARGIN * 0.8), true)
  assert.equal(layoutHolds(laid, { x: -450, y: 0, zoom: 1 }, W, H, MARGIN * 0.8), false)
  // Zoomed out, the screen takes in more world than was laid out.
  assert.equal(layoutHolds(laid, { x: 0, y: 0, zoom: 0.75 }, W, H, MARGIN * 0.8), true) // right edge at 1333 of 1400
  assert.equal(layoutHolds(laid, { x: 0, y: 0, zoom: 0.5 }, W, H, MARGIN * 0.8), false)
})

test('the transform puts every world point where a new layout would', () => {
  const laid = { x: 120, y: -40, zoom: 0.8 }, now = { x: 90, y: 10, zoom: 1.1 }
  const { k, tx, ty } = layerTransform(laid, now)
  for (const [wx, wy] of [[0, 0], [250, -80], [-400, 300]]) {
    const laidX = wx * laid.zoom + laid.x, laidY = wy * laid.zoom + laid.y
    assert.ok(Math.abs(laidX * k + tx - (wx * now.zoom + now.x)) < 1e-9)
    assert.ok(Math.abs(laidY * k + ty - (wy * now.zoom + now.y)) < 1e-9)
  }
})

test('a pan moves the layer, and is laid out once it stops', () => {
  const { commits, frame, style } = setup()
  frame({ x: 0, y: 0, zoom: 1 })
  assert.equal(commits.length, 1)
  for (let i = 1; i <= 10; i++) frame({ x: -i * 10, y: 0, zoom: 1 })
  assert.equal(commits.length, 1, 'no layout while it moves')
  assert.equal(style.transform, 'translate(-100px, 0px) scale(1)')
  assert.equal(style.willChange, 'transform')
  // Still for longer than it takes to settle.
  for (let i = 0; i < 10; i++) frame({ x: -100, y: 0, zoom: 1 })
  assert.deepEqual(commits.at(-1), { x: -100, y: 0, zoom: 1 })
  assert.equal(style.transform, '')
  assert.equal(style.willChange, '')
})

test('a long pan is laid out again before the edge of the layout shows', () => {
  const { commits, frame, style } = setup()
  frame({ x: 0, y: 0, zoom: 1 })
  for (let i = 1; i <= 50; i++) frame({ x: -i * 20, y: 0, zoom: 1 })
  assert.ok(commits.length >= 2, 'laid out again midway')
  // Promoted still, between layouts, while it keeps moving.
  assert.equal(style.willChange, 'transform')
})

test('a zoom scales the layer, and what keeps its size is scaled back', () => {
  const { commits, frame, style, label } = setup()
  frame({ x: 0, y: 0, zoom: 1 })
  frame({ x: -10, y: -6, zoom: 1.02 })
  assert.equal(commits.length, 1)
  assert.match(style.transform, /scale\(1\.02\)$/)
  assert.equal(label.style.scale, String(1 / 1.02))
  for (let i = 0; i < 10; i++) frame({ x: -10, y: -6, zoom: 1.02 })
  assert.equal(label.style.scale, '', 'laid out at its own size again')
})

test('zoomed in by a quarter, it is laid out rather than blurred', () => {
  const { commits, frame } = setup()
  frame({ x: 0, y: 0, zoom: 1 })
  frame({ x: 0, y: 0, zoom: 1.2 })
  assert.equal(commits.length, 1)
  frame({ x: 0, y: 0, zoom: 1.3 })
  assert.equal(commits.length, 2)
})

test('while it cannot scale -- a trace being dragged -- every move is laid out', () => {
  const { commits, frame, style } = setup(false)
  frame({ x: 0, y: 0, zoom: 1 })
  frame({ x: -10, y: 0, zoom: 1 })
  frame({ x: -20, y: 0, zoom: 1 })
  assert.equal(commits.length, 3)
  assert.equal(style.transform, '')
})

test('it reports whether the view moved since the last frame', () => {
  const { frame } = setup()
  assert.equal(frame({ x: 0, y: 0, zoom: 1 }), true)
  assert.equal(frame({ x: 0, y: 0, zoom: 1 }), false)
  assert.equal(frame({ x: 5, y: 0, zoom: 1 }), true)
})
