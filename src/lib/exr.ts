// OpenEXR images, turned into pictures a browser can show.
//
// An EXR holds linear, high-dynamic-range light -- values past 1, often far
// past it -- in half or full floats, and no browser decodes one. On import it
// is decoded (three's EXRLoader, fixed for DWA -- see vendor/EXRLoader.js -- and loaded only when an EXR arrives), tone-mapped
// to ordinary 8-bit sRGB and handed on as a PNG, so everything after that sees
// an image like any other.

export interface DecodedExr {
  width: number
  height: number
  channels: 1 | 4
  // Top row first.
  data: Float32Array
}

export const isExr = (file: { name: string }) => /\.exr$/i.test(file.name)

// ---- Decoding --------------------------------------------------------------------

// The loader reads only bare channel names -- R, G, B, A, or Y. Renders are
// often multi-layer instead, every channel named for its layer (Blender's
// "ViewLayer.Combined.R", a matcap's "diffuse.R"), and it refused them all. So
// one layer is chosen and its channels renamed in the header, in a copy of the
// file; the others it then skips as unknown. Safe for a single-part file,
// whose pixel data is read in order after the header whatever its length. A
// multi-part file's parts are tried in turn instead.
const PREFERRED_LAYER = /(^|\.)(combined|beauty|rgba|color|colour|diffuse)$/i

export async function decodeExr(buffer: ArrayBuffer): Promise<DecodedExr> {
  // Each import destructured where it is awaited, the form a bundler can see
  // through: it then keeps only the parts of three the loader uses, not all
  // of it (in a Promise.all, it kept everything -- 740 kB).
  const loading = import('./vendor/EXRLoader.js')
  const { FloatType, RedFormat } = await import('three')
  const { EXRLoader } = await loading
  const parse = (bytes: ArrayBuffer, part = 0) => new EXRLoader().setDataType(FloatType).setPart(part).parse(bytes)
  let result
  try {
    result = parse(buffer)
  } catch (error) {
    if (!/unsupported data channels/.test(String(error))) throw error
    result = multiPart(buffer) ? tryParts(buffer, parse) : parse(withLayerAsDefault(buffer))
  }
  const { width, height } = result
  if (!width || !height) throw new Error('EXR has no pixels')
  const channels = result.format === RedFormat ? 1 : 4
  // The loader writes rows bottom first, as a texture wants them.
  const source = result.data as Float32Array
  const data = new Float32Array(source.length)
  const row = width * channels
  for (let y = 0; y < height; y++) data.set(source.subarray((height - 1 - y) * row, (height - y) * row), y * row)
  return { width, height, channels, data }
}

const multiPart = (buffer: ArrayBuffer) => (new DataView(buffer).getUint32(4, true) & 0x1000) !== 0

function tryParts<T>(buffer: ArrayBuffer, parse: (bytes: ArrayBuffer, part: number) => T): T {
  let lastError: unknown
  for (let part = 0; part < 16; part++) {
    try {
      return parse(buffer, part)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

// A copy of a single-part EXR whose chosen layer's channels are bare.
export function withLayerAsDefault(buffer: ArrayBuffer, pick: (names: string[]) => string | null = chooseLayer): ArrayBuffer {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  const decoder = new TextDecoder()
  const readString = (at: number) => {
    let end = at
    while (bytes[end] !== 0) end++
    return { text: decoder.decode(bytes.subarray(at, end)), next: end + 1 }
  }
  // Attributes: name, type, size, value -- until an empty name.
  let at = 8
  for (;;) {
    const name = readString(at)
    if (!name.text) throw new Error('EXR has no channel list')
    const type = readString(name.next)
    const size = view.getInt32(type.next, true)
    const valueAt = type.next + 4
    if (name.text === 'channels' && type.text === 'chlist') {
      const channels: { name: string; rest: Uint8Array }[] = []
      let c = valueAt
      while (bytes[c] !== 0) {
        const channelName = readString(c)
        channels.push({ name: channelName.text, rest: bytes.slice(channelName.next, channelName.next + 16) })
        c = channelName.next + 16
      }
      const layer = pick(channels.map(ch => ch.name))
      if (layer === null) throw new Error('EXR has no colour or luminance layer')
      const encoder = new TextEncoder()
      const renamed = channels.map(ch => {
        const dot = ch.name.lastIndexOf('.')
        const inLayer = (dot < 0 ? '' : ch.name.slice(0, dot)) === layer
        return { name: encoder.encode(inLayer ? ch.name.slice(dot + 1) : ch.name), rest: ch.rest }
      })
      const listSize = renamed.reduce((total, ch) => total + ch.name.length + 1 + 16, 0) + 1
      const list = new Uint8Array(listSize)
      let w = 0
      for (const ch of renamed) {
        list.set(ch.name, w); w += ch.name.length + 1
        list.set(ch.rest, w); w += 16
      }
      const out = new Uint8Array(bytes.length - size + listSize)
      out.set(bytes.subarray(0, type.next))
      new DataView(out.buffer).setInt32(type.next, listSize, true)
      out.set(list, valueAt)
      out.set(bytes.subarray(valueAt + size), valueAt + listSize)
      return out.buffer
    }
    at = valueAt + size
  }
}

// The layer to show: one of the channel names' prefixes -- the part before the
// last dot -- that has R, G and B (or Y). The unnamed layer first, then one
// named like a finished image, then the first there is.
export function chooseLayer(names: string[]): string | null {
  const layers = new Map<string, Set<string>>()
  for (const name of names) {
    const dot = name.lastIndexOf('.')
    const layer = dot < 0 ? '' : name.slice(0, dot)
    const channel = dot < 0 ? name : name.slice(dot + 1)
    if (!layers.has(layer)) layers.set(layer, new Set())
    layers.get(layer)!.add(channel)
  }
  const complete = [...layers].filter(([, set]) => (set.has('R') && set.has('G') && set.has('B')) || set.has('Y')).map(([layer]) => layer)
  if (complete.includes('')) return ''
  return complete.find(layer => PREFERRED_LAYER.test(layer)) ?? complete[0] ?? null
}

// ---- Grading ---------------------------------------------------------------------

// How an EXR trace is shown, kept with it (traces.exr) along with its original
// file, so it can be shown again differently: the light read in a colour
// space, exposed, put through a view transform, a LUT if there is one, and
// brightness and contrast on the result.
//
// The view transforms: ACES's filmic curve (as renderers use, and what an
// EXR has always come in as), AgX (Blender's), Standard (the light as it is,
// clipped at 1), and Data -- a displacement, depth or roughness map, not
// light, which a tone curve would bend and sRGB wash out (a brick displacement
// map came out near white): stretched, linearly, from its lowest value to its
// highest. Data is one channel, three equal ones, or a file named for what it
// holds.
export type ExrView = 'aces' | 'agx' | 'standard' | 'data'
export type ExrInput = 'rec709' | 'acescg' | 'aces2065'
export const EXR_VIEWS: ExrView[] = ['aces', 'agx', 'standard', 'data']
export const EXR_INPUTS: ExrInput[] = ['rec709', 'acescg', 'aces2065']

// The numbers alone.
export interface ExrLook {
  view: ExrView
  input: ExrInput
  // In stops: each one doubles the light.
  exposure: number
  // -1..1, on the shown picture: added, and stretched about its middle.
  brightness: number
  contrast: number
}
export interface ExrGrade extends ExrLook {
  // The original .exr, where it's kept.
  source: string
  // A LUT applied after the view transform: a .cube file, or one of ours.
  lut?: ExrLut
}

const DATA_NAME = /disp|displacement|height|depth|bump|rough|metal|occlusion|(^|[^a-z])ao([^a-z]|$)|mask/i
const isData = (exr: DecodedExr, fileName: string) => exr.channels === 1 || DATA_NAME.test(fileName) || isGrey(exr.data)

// How an EXR is shown before anyone has said otherwise.
export const defaultLook = (exr: DecodedExr, fileName = ''): ExrLook =>
  ({ view: isData(exr, fileName) ? 'data' : 'aces', input: 'rec709', exposure: 0, brightness: 0, contrast: 0 })

// A grade as kept in a row -- the trust boundary: the row may have been
// written by hand, or come in a file. Undefined when it isn't one.
export function asExrGrade(raw: unknown): ExrGrade | undefined {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return null } })() : raw
  if (!v || typeof v !== 'object' || typeof v.source !== 'string' || !v.source) return undefined
  const n = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : 0)
  const lut: ExrLut | undefined = LUT_PRESETS.includes(v.lut?.preset) ? { preset: v.lut.preset }
    : v.lut && typeof v.lut.url === 'string' && v.lut.url ? { url: v.lut.url, name: typeof v.lut.name === 'string' ? v.lut.name : '' }
    : undefined
  return {
    source: v.source,
    view: EXR_VIEWS.includes(v.view) ? v.view : 'aces',
    input: EXR_INPUTS.includes(v.input) ? v.input : 'rec709',
    exposure: n(v.exposure, -16, 16),
    brightness: n(v.brightness, -1, 1),
    contrast: n(v.contrast, -1, 1),
    ...(lut ? { lut } : {}),
  }
}

// The LUTs that come with the Atrium: looks written here, as functions of a
// shown colour (0..1, sRGB-encoded) -- ours, so free to ship and share, where
// a pack's files almost never are. Each is sampled into a 33-point LUT when
// it's first used.
export const LUT_PRESETS = ['warm', 'cool', 'tealOrange', 'bleachBypass', 'fadedFilm', 'blackWhite', 'punchy', 'dayForNight'] as const
export type LutPreset = typeof LUT_PRESETS[number]
export type ExrLut = { url: string; name: string } | { preset: LutPreset }
export const lutKey = (lut?: ExrLut) => (!lut ? '' : 'preset' in lut ? `preset:${lut.preset}` : lut.url)

type Rgb = [number, number, number]
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const lumaOf = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const saturate = (c: Rgb, amount: number): Rgb => { const l = lumaOf(c); return c.map(v => l + (v - l) * amount) as Rgb }
// An S-curve about the middle: 0 leaves it be, 1 is smoothstep's.
const sCurve = (c: Rgb, amount: number): Rgb => c.map(v => { const x = clamp01(v); return x + (x * x * (3 - 2 * x) - x) * amount }) as Rgb
// Lift (shadows), gain (highlights), per channel.
const liftGain = (c: Rgb, lift: Rgb, gain: Rgb): Rgb => c.map((v, i) => (v + lift[i] * (1 - v)) * gain[i]) as Rgb
// A tint by brightness: `dark` added to the shadows, `light` to the highlights.
const splitTone = (c: Rgb, dark: Rgb, light: Rgb): Rgb => { const l = clamp01(lumaOf(c)); return c.map((v, i) => v + dark[i] * (1 - l) + light[i] * l) as Rgb }

const LOOKS: Record<LutPreset, (c: Rgb) => Rgb> = {
  warm: c => saturate(liftGain(c, [0.012, 0.006, 0], [1.05, 1.0, 0.88]), 1.05),
  cool: c => saturate(liftGain(c, [0, 0.006, 0.016], [0.92, 0.99, 1.06]), 0.97),
  tealOrange: c => sCurve(saturate(splitTone(c, [-0.05, 0.035, 0.07], [0.08, 0.02, -0.06]), 1.12), 0.25),
  bleachBypass: c => sCurve(saturate(c, 0.45), 0.6).map(v => v * 0.97 + 0.015) as Rgb,
  fadedFilm: c => saturate(liftGain(c, [0.08, 0.075, 0.07], [0.93, 0.92, 0.89]), 0.8),
  blackWhite: c => { const l = lumaOf(sCurve(c, 0.15)); return [l, l, l] },
  punchy: c => saturate(sCurve(c, 0.45), 1.25),
  dayForNight: c => saturate(c, 0.45).map((v, i) => Math.pow(clamp01(v), 1.4) * 0.55 * [0.8, 0.9, 1.25][i]) as Rgb,
}

const presets = new Map<LutPreset, CubeLut>()
export function presetLut(preset: LutPreset, size = 33): CubeLut {
  const known = presets.get(preset)
  if (known) return known
  const look = LOOKS[preset]
  const table = new Float32Array(size * size * size * 3)
  let i = 0
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const out = look([r / (size - 1), g / (size - 1), b / (size - 1)])
    table[i++] = clamp01(out[0]); table[i++] = clamp01(out[1]); table[i++] = clamp01(out[2])
  }
  const lut: CubeLut = { size, min: [0, 0, 0], max: [1, 1, 1], table }
  presets.set(preset, lut)
  return lut
}

// A 3D LUT in Adobe's .cube format, red changing fastest.
export interface CubeLut { size: number; min: [number, number, number]; max: [number, number, number]; table: Float32Array }

export function parseCube(text: string): CubeLut {
  let size = 0
  let min: [number, number, number] = [0, 0, 0], max: [number, number, number] = [1, 1, 1]
  const values: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const key = parts[0].toUpperCase()
    if (key === 'TITLE') continue
    if (key === 'LUT_1D_SIZE') throw new Error('a 1D LUT, not a 3D one')
    if (key === 'LUT_3D_SIZE') { size = Number(parts[1]); continue }
    if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      const d = parts.slice(1, 4).map(Number) as [number, number, number]
      if (d.length !== 3 || d.some(x => !Number.isFinite(x))) throw new Error('a domain that is not three numbers')
      if (key === 'DOMAIN_MIN') min = d
      else max = d
      continue
    }
    if (/^[A-Z_]+$/.test(key)) continue // a keyword this doesn't need
    const rgb = parts.slice(0, 3).map(Number)
    if (rgb.length !== 3 || rgb.some(x => !Number.isFinite(x))) throw new Error(`not a LUT line: ${line.slice(0, 40)}`)
    values.push(...rgb)
  }
  if (!Number.isInteger(size) || size < 2 || size > 256) throw new Error('no LUT_3D_SIZE')
  if (values.length !== size * size * size * 3) throw new Error(`${values.length / 3} entries for a ${size}³ LUT`)
  if (min.some((m, i) => !(max[i] > m))) throw new Error('an empty domain')
  return { size, min, max, table: new Float32Array(values) }
}

// One colour through a LUT, trilinearly. `rgb` is written over.
function applyLut(lut: CubeLut, rgb: number[]) {
  const { size, min, max, table } = lut
  const n = size - 1
  const at: number[] = [], f: number[] = []
  for (let c = 0; c < 3; c++) {
    const t = Math.min(n, Math.max(0, ((rgb[c] - min[c]) / (max[c] - min[c])) * n))
    at[c] = Math.min(n - 1, Math.floor(t))
    f[c] = t - at[c]
  }
  const index = (r: number, g: number, b: number) => (r + g * size + b * size * size) * 3
  for (let c = 0; c < 3; c++) {
    const v = (dr: number, dg: number, db: number) => table[index(at[0] + dr, at[1] + dg, at[2] + db) + c]
    const x00 = v(0, 0, 0) + (v(1, 0, 0) - v(0, 0, 0)) * f[0]
    const x10 = v(0, 1, 0) + (v(1, 1, 0) - v(0, 1, 0)) * f[0]
    const x01 = v(0, 0, 1) + (v(1, 0, 1) - v(0, 0, 1)) * f[0]
    const x11 = v(0, 1, 1) + (v(1, 1, 1) - v(0, 1, 1)) * f[0]
    const y0 = x00 + (x10 - x00) * f[1], y1 = x01 + (x11 - x01) * f[1]
    rgb[c] = y0 + (y1 - y0) * f[2]
  }
}

// To linear Rec.709 from each input's primaries (white balanced D60 -> D65).
const FROM_INPUT: Record<ExrInput, number[] | null> = {
  rec709: null,
  acescg: [1.70505, -0.62179, -0.08326, -0.13026, 1.14080, -0.01055, -0.02400, -0.12897, 1.15297],
  aces2065: [2.52169, -1.13413, -0.38756, -0.27648, 1.37272, -0.09624, -0.01538, -0.15298, 1.16835],
}

// The picture, graded: RGBA bytes, top row first.
export function gradeExr(exr: DecodedExr, look: ExrLook, lut?: CubeLut | null): Uint8ClampedArray {
  const { width, height, channels, data } = exr
  const out = new Uint8ClampedArray(width * height * 4)
  const step = channels
  const factor = 1 + look.contrast, lift = look.brightness * 0.5
  const finish = look.contrast !== 0 || look.brightness !== 0
  const rgb = [0, 0, 0]
  const write = (o: number) => {
    if (lut) applyLut(lut, rgb)
    for (let c = 0; c < 3; c++) out[o + c] = (finish ? (rgb[c] - 0.5) * factor + 0.5 + lift : rgb[c]) * 255
  }

  if (look.view === 'data') {
    let min = Infinity, max = -Infinity
    for (let i = 0; i < data.length; i += step) {
      for (let c = 0; c < Math.min(3, step); c++) {
        const v = data[i + c]
        if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v }
      }
    }
    const span = max > min ? max - min : 1
    const stretch = (v: number) => (Number.isFinite(v) ? (v - min) / span : 0)
    for (let i = 0, o = 0; i < data.length; i += step, o += 4) {
      rgb[0] = stretch(data[i]); rgb[1] = stretch(data[i + (step > 1 ? 1 : 0)]); rgb[2] = stretch(data[i + (step > 1 ? 2 : 0)])
      write(o)
      out[o + 3] = 255
    }
    return out
  }

  const m = FROM_INPUT[look.input]
  const gain = Math.pow(2, look.exposure)
  const view = VIEWS[look.view]
  for (let i = 0, o = 0; i < data.length; i += step, o += 4) {
    let r = data[i], g = data[i + (step > 1 ? 1 : 0)], b = data[i + (step > 1 ? 2 : 0)]
    r = Number.isFinite(r) ? r : 0; g = Number.isFinite(g) ? g : 0; b = Number.isFinite(b) ? b : 0
    if (m) [r, g, b] = [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b]
    view(r * gain, g * gain, b * gain, rgb)
    write(o)
    const a = step === 4 ? data[i + 3] : 1
    out[o + 3] = Math.max(0, Math.min(1, Number.isFinite(a) ? a : 1)) * 255
  }
  return out
}

// What the import has always made of an EXR: its default look.
export const toneMap = (exr: DecodedExr, fileName = '') => gradeExr(exr, defaultLook(exr, fileName))

// Four channels whose R, G and B are the same everywhere: one value, stored
// three times.
function isGrey(data: Float32Array): boolean {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) return false
  }
  return true
}

// Linear 0..1 to sRGB's encoding, 0..1.
function srgb(linear: number): number {
  const v = Math.min(1, Math.max(0, linear))
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

// Narkowicz's fit of the ACES filmic curve: linear light in, 0..1 out.
function aces(x: number): number {
  if (!(x > 0)) return 0
  return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))
}

// AgX, as Blender has it, in Benjamin Wrensch's minimal form: into AgX's
// primaries, a log encoding, a fitted sigmoid, and back out.
const AGX_MIN = -12.47393, AGX_MAX = 4.026069
function agxCurve(x: number): number {
  const l = (Math.min(AGX_MAX, Math.max(AGX_MIN, Math.log2(Math.max(x, 1e-10)))) - AGX_MIN) / (AGX_MAX - AGX_MIN)
  const l2 = l * l, l4 = l2 * l2
  return 15.5 * l4 * l2 - 40.14 * l4 * l + 31.96 * l4 - 6.868 * l2 * l + 0.4298 * l2 + 0.1191 * l - 0.00232
}

const VIEWS: Record<Exclude<ExrView, 'data'>, (r: number, g: number, b: number, out: number[]) => void> = {
  aces: (r, g, b, out) => { out[0] = srgb(aces(r)); out[1] = srgb(aces(g)); out[2] = srgb(aces(b)) },
  standard: (r, g, b, out) => { out[0] = srgb(r); out[1] = srgb(g); out[2] = srgb(b) },
  agx: (r, g, b, out) => {
    const ar = agxCurve(0.842479062253094 * r + 0.0784335999999992 * g + 0.0792237451477643 * b)
    const ag = agxCurve(0.0423282422610123 * r + 0.878468636469772 * g + 0.0791661274605434 * b)
    const ab = agxCurve(0.0423756549057051 * r + 0.0784336 * g + 0.879142973793104 * b)
    const or = 1.19687900512017 * ar - 0.0980208811401368 * ag - 0.0990297440797205 * ab
    const og = -0.0528968517574562 * ar + 1.15190312990417 * ag - 0.0989611768448433 * ab
    const ob = -0.0529716355144438 * ar - 0.0980434501171241 * ag + 1.15107367264116 * ab
    // Out of AgX's display encoding (a 2.2 power) to light, then to sRGB.
    out[0] = srgb(Math.pow(Math.max(0, or), 2.2)); out[1] = srgb(Math.pow(Math.max(0, og), 2.2)); out[2] = srgb(Math.pow(Math.max(0, ob), 2.2))
  },
}

// ---- Files -----------------------------------------------------------------------

// An EXR file as a PNG file of the same name, for the image import -- the
// original and the look it was given remembered with it (exrOrigin), so the
// trace made of it can keep them and be graded again.
//
// Converted in a worker (exr.worker.ts) when one can be started: a 1080p
// render takes a couple of seconds to decode and a 4K map several, and on the
// thread that draws the atrium that is a frozen canvas and an import count
// that never moves. On this thread only when no worker would start.
const origins = new WeakMap<File, { source: File; look: ExrLook }>()
export const exrOrigin = (png: File) => origins.get(png)

export async function exrFileToPng(file: File): Promise<File> {
  const made = (await importInWorker(file)) ?? (await importExr(file, file.name))
  const png = new File([made.png], file.name.replace(/\.exr$/i, '.png'), { type: 'image/png' })
  origins.set(png, { source: file, look: made.look })
  return png
}

// Decoded, given the look it starts with, and encoded. The work itself,
// wherever it runs.
export async function importExr(file: Blob, fileName: string): Promise<{ png: Blob; look: ExrLook }> {
  const exr = await decodeExr(await file.arrayBuffer())
  const look = defaultLook(exr, fileName)
  return { png: await encodePng(exr.width, exr.height, gradeExr(exr, look)), look }
}

export function encodePng(width: number, height: number, pixels: Uint8ClampedArray): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d')!.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

// The import done in a worker; null if the worker itself failed -- not
// started, or its script not loaded -- so the caller does the work here
// instead. A file the worker could not read rejects, as it would here.
async function importInWorker(file: File): Promise<{ png: Blob; look: ExrLook } | null> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./exr.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  try {
    return await new Promise<{ png: Blob; look: ExrLook } | null>((resolve, reject) => {
      worker.onerror = event => {
        event.preventDefault()
        resolve(null)
      }
      worker.onmessage = event => {
        if (event.data?.png) resolve({ png: event.data.png, look: event.data.look })
        else reject(new Error(event.data?.error || 'EXR conversion failed'))
      }
      worker.postMessage({ kind: 'import', file, fileName: file.name })
    })
  } finally {
    worker.terminate()
  }
}

// A batch of files with every EXR among them made a PNG. One that can't be
// read is left out, and reported.
export async function withExrAsPng(files: File[], onUnreadable: (file: File, error: unknown) => void): Promise<File[]> {
  const out: File[] = []
  for (const file of files) {
    if (!isExr(file)) { out.push(file); continue }
    try {
      out.push(await exrFileToPng(file))
    } catch (error) {
      onUnreadable(file, error)
    }
  }
  return out
}
