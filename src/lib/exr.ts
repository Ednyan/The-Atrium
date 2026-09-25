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
  const [{ EXRLoader }, { FloatType, RedFormat }] = await Promise.all([
    import('./vendor/EXRLoader.js'),
    import('three'),
  ])
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

// ---- Tone mapping ----------------------------------------------------------------

// Light is tone-mapped with the ACES filmic curve that renderers use, so a
// highlight at 10 rolls off rather than clipping, then encoded as sRGB. Data --
// a displacement, depth or roughness map, not light -- would be bent by a tone
// curve and washed out by sRGB (a brick displacement map came out near white):
// it is stretched, linearly, from its lowest value to its highest. Data is one
// channel, three equal ones, or a file named for what it holds.
const DATA_NAME = /disp|displacement|height|depth|bump|rough|metal|occlusion|(^|[^a-z])ao([^a-z]|$)|mask/i

export function toneMap(exr: DecodedExr, fileName = ''): Uint8ClampedArray {
  const { width, height, channels, data } = exr
  const out = new Uint8ClampedArray(width * height * 4)
  if (channels === 1 || DATA_NAME.test(fileName) || isGrey(data)) {
    const step = channels
    let min = Infinity, max = -Infinity
    for (let i = 0; i < data.length; i += step) {
      for (let c = 0; c < Math.min(3, step); c++) {
        const v = data[i + c]
        if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v }
      }
    }
    const span = max > min ? max - min : 1
    const stretch = (v: number) => (Number.isFinite(v) ? ((v - min) / span) * 255 : 0)
    for (let i = 0, o = 0; i < data.length; i += step, o += 4) {
      out[o] = stretch(data[i])
      out[o + 1] = stretch(data[i + (step > 1 ? 1 : 0)])
      out[o + 2] = stretch(data[i + (step > 1 ? 2 : 0)])
      out[o + 3] = 255
    }
    return out
  }
  for (let i = 0; i < data.length; i += 4) {
    out[i] = srgb(aces(data[i]))
    out[i + 1] = srgb(aces(data[i + 1]))
    out[i + 2] = srgb(aces(data[i + 2]))
    out[i + 3] = Math.max(0, Math.min(1, Number.isFinite(data[i + 3]) ? data[i + 3] : 1)) * 255
  }
  return out
}

// Four channels whose R, G and B are the same everywhere: one value, stored
// three times.
function isGrey(data: Float32Array): boolean {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) return false
  }
  return true
}

// Narkowicz's fit of the ACES filmic curve: linear light in, 0..1 out.
function aces(x: number): number {
  if (!(x > 0)) return 0
  return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))
}

// Linear 0..1 to an sRGB byte.
function srgb(linear: number): number {
  const v = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055
  return Math.round(v * 255)
}

// ---- Files -----------------------------------------------------------------------

// An EXR file as a PNG file of the same name, for the image import.
export async function exrFileToPng(file: File): Promise<File> {
  const exr = await decodeExr(await file.arrayBuffer())
  const pixels = new ImageData(toneMap(exr, file.name) as Uint8ClampedArray<ArrayBuffer>, exr.width, exr.height)
  const canvas = new OffscreenCanvas(exr.width, exr.height)
  canvas.getContext('2d')!.putImageData(pixels, 0, 0)
  const png = await canvas.convertToBlob({ type: 'image/png' })
  return new File([png], file.name.replace(/\.exr$/i, '.png'), { type: 'image/png' })
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
