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

// ---- Grading ----

import { asExrGrade, gradeExr, parseCube, type ExrLook } from '../src/lib/exr.ts'

const flat = (values: number[][]) => ({ width: values.length, height: 1, channels: 4 as const, data: new Float32Array(values.flatMap(([r, g, b]) => [r, g, b, 1])) })
const look = (change: Partial<ExrLook> = {}): ExrLook => ({ view: 'standard', input: 'rec709', exposure: 0, brightness: 0, contrast: 0, ...change })
const srgbByte = (linear: number) => Math.round((linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055) * 255)

test('a stop of exposure doubles the light before it is shown', () => {
  const exr = flat([[0.25, 0.25, 0.25]])
  assert.equal(gradeExr(exr, look())[0], srgbByte(0.25))
  assert.equal(gradeExr(exr, look({ exposure: 1 }))[0], srgbByte(0.5))
  assert.equal(gradeExr(exr, look({ exposure: -2 }))[0], srgbByte(0.0625))
})

test('white stays white from any input colour space; a pure ACEScg red is not Rec.709 red', () => {
  for (const input of ['rec709', 'acescg', 'aces2065'] as const) {
    assert.deepEqual(Array.from(gradeExr(flat([[1, 1, 1]]), look({ input })).subarray(0, 3)), [255, 255, 255], input)
  }
  // ACEScg's red is a deeper red than Rec.709's: the same number, read as
  // ACEScg, is a stronger red, its green and blue below zero (clipped).
  const asRec709 = gradeExr(flat([[0.5, 0, 0]]), look()), asAcescg = gradeExr(flat([[0.5, 0, 0]]), look({ input: 'acescg' }))
  assert.deepEqual(Array.from(asRec709.subarray(0, 3)), [188, 0, 0])
  assert.deepEqual(Array.from(asAcescg.subarray(0, 3)), [238, 0, 0])
})

test('AgX rises with the light, keeps black near black and rolls a highlight off below white', () => {
  const ramp = [0, 0.01, 0.05, 0.18, 1, 4, 16].map(v => [v, v, v])
  const out = gradeExr(flat(ramp), look({ view: 'agx' }))
  const greys = ramp.map((_, i) => out[i * 4])
  for (let i = 1; i < greys.length; i++) assert.ok(greys[i] >= greys[i - 1], `rising: ${greys}`)
  assert.ok(greys[0] < 10, `black: ${greys[0]}`)
  assert.ok(greys[3] > 80 && greys[3] < 160, `mid grey stays mid: ${greys[3]}`)
  assert.ok(greys[6] > 230, `a highlight near white: ${greys[6]}`)
})

test('contrast stretches about the middle; brightness lifts it all', () => {
  const exr = flat([[srgbToLinear(0.25), srgbToLinear(0.25), srgbToLinear(0.25)]])
  const at = (change: Partial<ExrLook>) => gradeExr(exr, look(change))[0]
  assert.equal(at({}), 64)
  assert.equal(at({ contrast: 1 }), 0) // (0.25 - 0.5) * 2 + 0.5
  assert.equal(at({ brightness: 0.5 }), 128) // 0.25 + 0.25
})
function srgbToLinear(v: number) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }

test('a .cube LUT is read and applied after the view, trilinearly', () => {
  // Size 2: each output channel is one minus the input's -- an inverting LUT.
  const lines = ['TITLE "invert"', '# a comment', 'LUT_3D_SIZE 2']
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${1 - r} ${1 - g} ${1 - b}`)
  const lut = parseCube(lines.join('\n'))
  assert.equal(lut.size, 2)
  const out = gradeExr(flat([[1, 0, srgbToLinear(0.25)]]), look(), lut)
  assert.deepEqual(Array.from(out.subarray(0, 3)), [0, 255, 191])
  assert.throws(() => parseCube('LUT_3D_SIZE 2\n0 0 0\n'), /1 entries/)
  assert.throws(() => parseCube('LUT_1D_SIZE 4\n'), /1D/)
})

test('a grade from a row: checked, clamped, defaulted -- and nothing without its original', () => {
  assert.equal(asExrGrade(null), undefined)
  assert.equal(asExrGrade({ view: 'aces' }), undefined)
  assert.deepEqual(asExrGrade(JSON.stringify({ source: 'local://traces/L/a.exr', view: 'odd', exposure: 99, contrast: 'x', lut: { url: 'u.cube', name: 'u.cube' } })), {
    source: 'local://traces/L/a.exr', view: 'aces', input: 'rec709', exposure: 16, brightness: 0, contrast: 0, lut: { url: 'u.cube', name: 'u.cube' },
  })
})

// ---- Our LUTs ----

import { LUT_PRESETS, presetLut } from '../src/lib/exr.ts'
import { readFileSync } from 'node:fs'

const through = (preset: (typeof LUT_PRESETS)[number], colours: number[][]) => gradeExr(flat(colours), look(), presetLut(preset))

test('every preset keeps a grey ramp in order, dark to light', () => {
  const ramp = Array.from({ length: 12 }, (_, i) => { const v = srgbToLinear(i / 11); return [v, v, v] })
  for (const preset of LUT_PRESETS) {
    const out = through(preset, ramp)
    const shades = ramp.map((_, i) => out[i * 4] * 0.2126 + out[i * 4 + 1] * 0.7152 + out[i * 4 + 2] * 0.0722)
    for (let i = 1; i < shades.length; i++) assert.ok(shades[i] >= shades[i - 1] - 0.5, `${preset}: ${shades.map(Math.round)}`)
  }
})

test('each preset does what its name says', () => {
  const grey = srgbToLinear(0.5), white = 1
  const [bw] = [through('blackWhite', [[srgbToLinear(0.8), srgbToLinear(0.2), srgbToLinear(0.4)]])]
  assert.ok(bw[0] === bw[1] && bw[1] === bw[2], `black & white is grey: ${Array.from(bw.subarray(0, 3))}`)
  const warm = through('warm', [[white, white, white]]), cool = through('cool', [[white, white, white]])
  assert.ok(warm[0] >= warm[2] + 15, `warm white leans red: ${Array.from(warm.subarray(0, 3))}`)
  assert.ok(cool[2] >= cool[0] + 15, `cool white leans blue: ${Array.from(cool.subarray(0, 3))}`)
  const night = through('dayForNight', [[grey, grey, grey]])
  assert.ok(night[2] > night[0] && night[0] < 90, `day for night is dark and blue: ${Array.from(night.subarray(0, 3))}`)
  const faded = through('fadedFilm', [[0, 0, 0]])
  assert.ok(faded[0] > 12, `faded film lifts black: ${faded[0]}`)
})

test('a preset kept in a row comes back; one that is not ours does not', () => {
  assert.deepEqual(asExrGrade({ source: 'a.exr', lut: { preset: 'tealOrange' } })?.lut, { preset: 'tealOrange' })
  assert.equal(asExrGrade({ source: 'a.exr', lut: { preset: 'stolen' } })?.lut, undefined)
})

test('every preset has a name in every language', () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt-BR', 'pt-PT', 'ru', 'zh']) {
    const text = readFileSync(new URL(`../src/locales/${locale}.ts`, import.meta.url), 'utf8')
    for (const preset of LUT_PRESETS) assert.ok(text.includes(`'atrium.exr.preset.${preset}':`), `${locale}: ${preset}`)
  }
})
