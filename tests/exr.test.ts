import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chooseLayer, decodeExr, toneMap, withExrAsPng } from '../src/lib/exr.ts'

// A minimal single-part, scanline, uncompressed EXR of 32-bit float channels.
// `pixel(x, y)` gives each channel's value by name; y = 0 is the top row.
function makeExr(width: number, height: number, channels: string[], pixel: (x: number, y: number) => Record<string, number>): ArrayBuffer {
  const bytes: number[] = []
  const u8 = (...v: number[]) => bytes.push(...v)
  const i32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v, true); u8(...b) }
  const f32 = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); u8(...b) }
  const u64 = (v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); u8(...b) }
  const str = (s: string) => { u8(...new TextEncoder().encode(s), 0) }
  const attr = (name: string, type: string, value: number[]) => { str(name); str(type); i32(value.length); u8(...value) }
  const encode = (write: () => void) => { const at = bytes.length; write(); return bytes.splice(at) }

  // Channels are stored in alphabetical order, as the format requires.
  const sorted = [...channels].sort()
  u8(0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0)
  attr('channels', 'chlist', encode(() => {
    for (const name of sorted) { str(name); i32(2); u8(0, 0, 0, 0); i32(1); i32(1) }
    u8(0)
  }))
  attr('compression', 'compression', [0])
  attr('dataWindow', 'box2i', encode(() => { i32(0); i32(0); i32(width - 1); i32(height - 1) }))
  attr('displayWindow', 'box2i', encode(() => { i32(0); i32(0); i32(width - 1); i32(height - 1) }))
  attr('lineOrder', 'lineOrder', [0])
  attr('pixelAspectRatio', 'float', encode(() => f32(1)))
  attr('screenWindowCenter', 'v2f', encode(() => { f32(0); f32(0) }))
  attr('screenWindowWidth', 'float', encode(() => f32(1)))
  u8(0)

  // One line per block: an offset table, then each line's y, size and data.
  const lineSize = width * sorted.length * 4
  const tableEnd = bytes.length + height * 8
  for (let y = 0; y < height; y++) u64(tableEnd + y * (8 + lineSize))
  for (let y = 0; y < height; y++) {
    i32(y)
    i32(lineSize)
    for (const name of sorted) for (let x = 0; x < width; x++) f32(pixel(x, y)[name])
  }
  return new Uint8Array(bytes).buffer
}

test('plain RGB decodes top row first, with an opaque alpha added', async () => {
  // Red rises along a row, green down the rows: each pixel says where it is.
  const buffer = makeExr(3, 2, ['R', 'G', 'B'], (x, y) => ({ R: x, G: y, B: 0.5 }))
  const exr = await decodeExr(buffer)
  assert.equal(exr.width, 3)
  assert.equal(exr.height, 2)
  assert.equal(exr.channels, 4)
  const at = (x: number, y: number) => Array.from(exr.data.subarray((y * 3 + x) * 4, (y * 3 + x) * 4 + 4))
  assert.deepEqual(at(0, 0), [0, 0, 0.5, 1])
  assert.deepEqual(at(2, 0), [2, 0, 0.5, 1])
  assert.deepEqual(at(1, 1), [1, 1, 0.5, 1])
})

test('a multi-layer file shows its colour layer, not the first one', async () => {
  const buffer = makeExr(2, 2, ['diffuse.R', 'diffuse.G', 'diffuse.B', 'specular.R', 'specular.G', 'specular.B'], () => ({
    'diffuse.R': 0.25, 'diffuse.G': 0.5, 'diffuse.B': 0.75,
    'specular.R': 9, 'specular.G': 9, 'specular.B': 9,
  }))
  const exr = await decodeExr(buffer)
  assert.deepEqual(Array.from(exr.data.subarray(0, 4)), [0.25, 0.5, 0.75, 1])
})

test('the layer chosen: unnamed first, then a finished image, then the first complete one', () => {
  assert.equal(chooseLayer(['R', 'G', 'B', 'depth.Z']), '')
  assert.equal(chooseLayer(['ViewLayer.Normal.X', 'ViewLayer.Combined.R', 'ViewLayer.Combined.G', 'ViewLayer.Combined.B']), 'ViewLayer.Combined')
  assert.equal(chooseLayer(['a.R', 'a.G', 'b.R', 'b.G', 'b.B']), 'b')
  assert.equal(chooseLayer(['height.Y']), 'height')
  assert.equal(chooseLayer(['depth.Z', 'mask.A']), null)
})

test('light is tone-mapped; data is stretched from its lowest value to its highest', async () => {
  const buffer = makeExr(2, 1, ['R', 'G', 'B'], x => ({ R: x ? 50 : 0, G: x ? 0.18 : 0, B: 0 }))
  const exr = await decodeExr(buffer)
  const light = toneMap(exr, 'render.exr')
  assert.deepEqual(Array.from(light.subarray(0, 4)), [0, 0, 0, 255])
  // A highlight at 50 rolls off to white rather than wrapping or clipping early.
  assert.equal(light[4], 255)
  assert.ok(light[5] > 80 && light[5] < 200, `mid grey stays mid: ${light[5]}`)

  // The same values, named as a displacement map, are data: stretched evenly.
  const data = toneMap(exr, 'bricks_disp_4k.exr')
  assert.deepEqual(Array.from(data.subarray(4, 8)), [255, 1, 0, 255])
})

test('a batch passes other files through and leaves out, and reports, an EXR it cannot read', async () => {
  const photo = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
  const broken = new File([new Uint8Array([0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0, 0])], 'broken.exr')
  const reported: string[] = []
  const out = await withExrAsPng([photo, broken], file => reported.push(file.name))
  assert.deepEqual(out, [photo])
  assert.deepEqual(reported, ['broken.exr'])
})
