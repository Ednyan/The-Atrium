// The camera over the DOM world layer: when it scales the layer, and when it
// asks for a layout instead.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { contentView, createWorldCamera, edgeInsets, layerTransform, layoutHolds, type View } from '../src/lib/worldCamera.ts'

const W = 1000, H = 600, MARGIN = 500

// A stand-in for the layer: its style, and one element that keeps its size.
function fakeLayer() {
  const label = { style: { scale: '' } }
  const attributes = new Set<string>()
  const layer = {
    style: { transform: '', willChange: '' },
    querySelectorAll: () => [label],
    setAttribute: (name: string) => { attributes.add(name) },
    removeAttribute: (name: string) => { attributes.delete(name) },
  }
  return { layer: layer as unknown as HTMLElement, style: layer.style, label, attributes }
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
  const { commits, frame, style, attributes } = setup()
  frame({ x: 0, y: 0, zoom: 1 })
  assert.equal(commits.length, 1)
  for (let i = 1; i <= 10; i++) frame({ x: -i * 10, y: 0, zoom: 1 })
  assert.equal(commits.length, 1, 'no layout while it moves')
  assert.equal(style.transform, 'translate(-100px, 0px) scale(1)')
  assert.equal(style.willChange, 'transform')
  assert.ok(attributes.has('data-camera-moving'), 'marked while it moves')
  // Still for longer than it takes to settle.
  for (let i = 0; i < 10; i++) frame({ x: -100, y: 0, zoom: 1 })
  assert.deepEqual(commits.at(-1), { x: -100, y: 0, zoom: 1 })
  assert.equal(style.transform, '')
  assert.equal(style.willChange, '')
  assert.ok(!attributes.has('data-camera-moving'), 'and not at rest')
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

// ---- Recenter ----

const ROOM = { left: 100, top: 100, right: 100, bottom: 100 }
const box = (x: number, y: number, w = 200, h = 200) => ({ minX: x - w / 2, minY: y - h / 2, maxX: x + w / 2, maxY: y + h / 2 })

test('recenter: traces near each other are all framed, centred, with room around them', () => {
  const view = contentView([box(0, 0), box(1000, 0), box(500, 600)], 1600, 900, ROOM, 0.25, 1)!
  assert.deepEqual([view.cx, view.cy], [500, 300])
  // 1200 x 800 of traces into 1400 x 700 of room: the height decides.
  assert.equal(view.zoom, 700 / 800)
})

test('recenter: one small trace is shown at 100%, not blown up', () => {
  assert.deepEqual(contentView([box(40, -30, 100, 50)], 1600, 900, ROOM, 0.25, 1), { cx: 40, cy: -30, zoom: 1 })
})

test('recenter: a trace far off from the rest leaves them framed where they are', () => {
  const cluster = [box(0, 0), box(400, 0), box(0, 400), box(400, 400)]
  const view = contentView([...cluster, box(50000, 50000)], 1600, 900, ROOM, 0.25, 1)!
  assert.deepEqual([view.cx, view.cy], [200, 200])
  // 600 x 600 fits at more than 100%: shown at 100%.
  assert.equal(view.zoom, 1)
})

test('recenter: two far-apart groups -- the bigger one is framed', () => {
  const small = [box(0, 0), box(300, 0)]
  const big = [box(20000, 0), box(20400, 0), box(20000, 400)]
  const view = contentView([...small, ...big], 1600, 900, ROOM, 0.25, 1)!
  assert.deepEqual([view.cx, view.cy], [20200, 200])
})

test('recenter: nothing to frame', () => {
  assert.equal(contentView([], 1600, 900, ROOM, 0.25, 1), null)
})

test('recenter: framed in the room the menus leave, not under them', () => {
  // A 300-wide menu down the left: the traces' middle is the room's middle.
  const view = contentView([box(0, 0), box(1000, 0)], 1600, 900, { left: 300, top: 0, right: 0, bottom: 0 }, 0.25, 1)!
  assert.equal(view.zoom, 1)
  const screenX = (0 + 1000) / 2 - view.cx + 800
  assert.equal(screenX, 300 + 1300 / 2)
})

test('menus count against the edge they cover least of', () => {
  const insets = edgeInsets([
    { left: 16, top: 16, right: 220, bottom: 430 },     // the atrium menu, top left: tall, so the left
    { left: 16, top: 270, right: 62, bottom: 630 },     // the quick bar: the left
    { left: 1070, top: 16, right: 1584, bottom: 50 },   // the top-right bar: the top
    { left: 680, top: 760, right: 900, bottom: 792 },   // the usage bar: the bottom
    { left: 1460, top: 560, right: 1584, bottom: 600 }, // Draw, at the right: the right
    { left: 0, top: 0, right: 1600, bottom: 900 },      // a layer over everything: not a menu
  ], 1600, 900)
  assert.deepEqual(insets, { left: 220, top: 50, right: 140, bottom: 140 })
})
