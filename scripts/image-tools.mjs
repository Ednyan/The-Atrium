// Minimal PNG/BMP/ICO handling in pure Node, shared by the icon and installer
// art generators.
//
// A ~150-line decoder against zlib is a much smaller cost than adding an image
// library to a project that needs one for two build scripts and nothing else,
// and it keeps the generated binaries in the repo reproducible rather than
// being files nobody can regenerate.

import { inflateSync, deflateSync } from 'node:zlib'

// --- PNG in ----------------------------------------------------------------
// Handles 8-bit RGB/RGBA non-interlaced. Anything else throws loudly rather
// than quietly producing a wrong image.

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')

  let pos = 8
  let ihdr = null
  const idat = []

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len // length + type + data + crc
  }

  if (!ihdr) throw new Error('PNG has no IHDR')
  if (ihdr.bitDepth !== 8 || ihdr.interlace !== 0 || ![2, 6].includes(ihdr.colorType)) {
    throw new Error(`unsupported PNG: depth ${ihdr.bitDepth}, colour ${ihdr.colorType}, interlace ${ihdr.interlace}`)
  }

  const channels = ihdr.colorType === 6 ? 4 : 3
  const { width, height } = ihdr
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(width * height * 4, 255)

  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))

    // Undo the per-scanline filter (PNG spec 9.2).
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      switch (filter) {
        case 0: break
        case 1: line[i] = (line[i] + a) & 0xff; break
        case 2: line[i] = (line[i] + b) & 0xff; break
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 0xff; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          line[i] = (line[i] + pred) & 0xff
          break
        }
        default: throw new Error(`unknown PNG filter ${filter}`)
      }
    }

    for (let x = 0; x < width; x++) {
      const s = x * channels
      const d = (y * width + x) * 4
      out[d] = line[s]
      out[d + 1] = line[s + 1]
      out[d + 2] = line[s + 2]
      out[d + 3] = channels === 4 ? line[s + 3] : 255
    }
    prev = line
  }

  return { width, height, rgba: out }
}

// --- PNG out ---------------------------------------------------------------

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = c ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

export function encodePng(img) {
  const { width, height, rgba } = img
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // no filter; these are small and already compact
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// --- scaling ---------------------------------------------------------------
// Box-average. Every use here is a downscale, and averaging keeps thin bright
// linework from breaking up the way point sampling would.

export function resize(img, w, h) {
  const out = Buffer.alloc(w * h * 4)
  const xr = img.width / w
  const yr = img.height / h

  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * yr)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yr))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * xr)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xr))

      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const s = (sy * img.width + sx) * 4
          // Weight colour by alpha so transparent pixels don't drag the average
          // toward whatever happens to sit in their unused channels.
          const av = img.rgba[s + 3]
          r += img.rgba[s] * av
          g += img.rgba[s + 1] * av
          b += img.rgba[s + 2] * av
          a += av
          n++
        }
      }

      const d = (y * w + x) * 4
      if (a === 0) {
        out[d] = out[d + 1] = out[d + 2] = out[d + 3] = 0
      } else {
        out[d] = Math.round(r / a)
        out[d + 1] = Math.round(g / a)
        out[d + 2] = Math.round(b / a)
        out[d + 3] = Math.round(a / n)
      }
    }
  }

  return { width: w, height: h, rgba: out }
}

// Turns luminance into alpha, leaving colour alone.
//
// The portal mark is white linework on an opaque black square. Composited onto
// anything, that square is visible as a square -- it covers whatever is behind
// it instead of sitting in it. Since the artwork is bright-on-black, mapping
// luminance to alpha makes the black genuinely transparent and leaves the
// highlights solid.
//
// The same thing PortalLoop does to the video with an SVG filter, for the same
// reason, using the same Rec. 709 coefficients.
export function lumaToAlpha(img) {
  const rgba = Buffer.from(img.rgba)
  for (let i = 0; i < rgba.length; i += 4) {
    const luma = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]
    rgba[i + 3] = Math.round(Math.min(255, luma) * (rgba[i + 3] / 255))
  }
  return { width: img.width, height: img.height, rgba }
}

// --- ICNS ------------------------------------------------------------------
// macOS icon container: a header, then typed entries back to back. Each entry
// is a four-character type, its total length including the 8-byte header, and
// the payload.
//
// The types are the sizes. Modern macOS reads PNG payloads directly, which is
// what the icon this replaces used for everything except two legacy 16/32px
// raw formats -- those are pre-10.7 and safe to leave out.
//
// Written from Windows, where the result can't be opened to check, so
// make-app-icons parses its own output back before it's kept.
export const ICNS_TYPES = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256], // 128@2x -- same pixels, different slot
]

export function encodeIcns(pngBySize) {
  const entries = []

  for (const [type, size] of ICNS_TYPES) {
    const png = pngBySize.get(size)
    if (!png) continue
    const header = Buffer.alloc(8)
    header.write(type, 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4)
    entries.push(Buffer.concat([header, png]))
  }

  const body = Buffer.concat(entries)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// --- ICO -------------------------------------------------------------------
// Every entry is written as a 32-bit BGRA DIB rather than an embedded PNG.
// PNG-in-ICO is legal from Vista onward, but the toolchain that stamps this
// into the executable is not the same thing as Windows Explorer, and the DIB
// form is the one every reader has always understood.

function icoDibEntry(img) {
  const { width, height, rgba } = img

  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(width, 4)
  header.writeInt32LE(height * 2, 8) // colour rows + mask rows, per the format
  header.writeUInt16LE(1, 12) // planes
  header.writeUInt16LE(32, 14) // bits per pixel
  header.writeUInt32LE(width * height * 4, 20)

  // Bottom-up BGRA.
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4
      pixels[d] = rgba[src + x * 4 + 2]
      pixels[d + 1] = rgba[src + x * 4 + 1]
      pixels[d + 2] = rgba[src + x * 4]
      pixels[d + 3] = rgba[src + x * 4 + 3]
    }
  }

  // The AND mask is ignored for 32-bit icons but must still be present and
  // correctly sized: rows padded to 4 bytes. All zero means "opaque".
  const maskStride = Math.ceil(width / 32) * 4
  const mask = Buffer.alloc(maskStride * height)

  return Buffer.concat([header, pixels, mask])
}

export function encodeIco(images) {
  const entries = images.map(icoDibEntry)

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let offset = 6 + directory.length

  images.forEach((img, i) => {
    const at = i * 16
    // 256 is written as 0: the field is one byte and 256 doesn't fit.
    directory[at] = img.width >= 256 ? 0 : img.width
    directory[at + 1] = img.height >= 256 ? 0 : img.height
    directory[at + 2] = 0 // palette size, 0 for true colour
    directory[at + 3] = 0 // reserved
    directory.writeUInt16LE(1, at + 4) // planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(entries[i].length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entries[i].length
  })

  return Buffer.concat([header, directory, ...entries])
}
