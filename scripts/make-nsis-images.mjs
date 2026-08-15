// Generates the two bitmaps the Windows installer wizard displays:
//
//   installer-header.bmp    150x57   the strip across the top of every page
//   installer-sidebar.bmp   164x314  the panel on the welcome and finish pages
//
// NSIS requires BMP specifically -- it cannot read PNG -- and requires those
// exact pixel dimensions, so these can't just be the app icon pointed at from
// tauri.conf.json. They're generated rather than hand-drawn so that changing
// the app icon means re-running one command, and so the files in the repo are
// reproducible instead of being binaries nobody can regenerate.
//
//   node scripts/make-nsis-images.mjs
//
// Pure Node: the PNG decoder below is ~40 lines against zlib, which is a much
// smaller cost than adding an image library to a project that needs one for
// this and nothing else.

import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ICON = join(root, 'src-tauri', 'icons', 'icon.png')
const OUT_DIR = join(root, 'src-tauri', 'installer')

// --- PNG -> {width, height, rgba} -------------------------------------------
// Handles 8-bit RGB/RGBA non-interlaced, which is what the app icon is. Anything
// else throws loudly rather than producing a subtly wrong image.

function decodePng(buf) {
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

// --- scaling ----------------------------------------------------------------
// Box-average, since every use here is a large downscale and averaging keeps
// the thin bright linework in the emblem from breaking up the way point
// sampling would.

function resize(img, w, h) {
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
          // Weight colour by alpha so transparent pixels don't drag the
          // averaged colour toward whatever happens to sit in unused channels.
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

// --- canvas -----------------------------------------------------------------

function canvas(w, h) {
  return { width: w, height: h, rgb: Buffer.alloc(w * h * 3) } // starts black
}

function setPixel(c, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return
  const d = (y * c.width + x) * 3
  c.rgb[d] = r
  c.rgb[d + 1] = g
  c.rgb[d + 2] = b
}

function blend(c, x, y, r, g, b, alpha) {
  if (alpha <= 0 || x < 0 || y < 0 || x >= c.width || y >= c.height) return
  const d = (y * c.width + x) * 3
  const a = Math.min(1, alpha)
  c.rgb[d] = Math.round(c.rgb[d] * (1 - a) + r * a)
  c.rgb[d + 1] = Math.round(c.rgb[d + 1] * (1 - a) + g * a)
  c.rgb[d + 2] = Math.round(c.rgb[d + 2] * (1 - a) + b * a)
}

// The same pool of light the launch intro puts under the portal, so the
// installer and the app's first screen look like the same product.
function glow(c, cx, cy, radius, strength) {
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const d = Math.hypot(x - cx, y - cy) / radius
      if (d >= 1) continue
      const falloff = (1 - d) * (1 - d)
      blend(c, x, y, 203, 203, 203, falloff * strength)
    }
  }
}

function drawImage(c, img, dx, dy) {
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4
      blend(c, dx + x, dy + y, img.rgba[s], img.rgba[s + 1], img.rgba[s + 2], img.rgba[s + 3] / 255)
    }
  }
}

// --- BMP --------------------------------------------------------------------
// 24-bit, uncompressed, bottom-up: the format every NSIS build reads without
// argument. Rows are padded to a 4-byte boundary.

function writeBmp(path, c) {
  const rowSize = Math.ceil((c.width * 3) / 4) * 4
  const pixels = Buffer.alloc(rowSize * c.height)

  for (let y = 0; y < c.height; y++) {
    const src = (c.height - 1 - y) * c.width * 3 // flip: BMP rows run upward
    for (let x = 0; x < c.width; x++) {
      const d = y * rowSize + x * 3
      pixels[d] = c.rgb[src + x * 3 + 2] // B
      pixels[d + 1] = c.rgb[src + x * 3 + 1] // G
      pixels[d + 2] = c.rgb[src + x * 3] // R
    }
  }

  const header = Buffer.alloc(54)
  header.write('BM', 0, 'ascii')
  header.writeUInt32LE(54 + pixels.length, 2) // file size
  header.writeUInt32LE(54, 10) // pixel data offset
  header.writeUInt32LE(40, 14) // DIB header size
  header.writeInt32LE(c.width, 18)
  header.writeInt32LE(c.height, 22)
  header.writeUInt16LE(1, 26) // planes
  header.writeUInt16LE(24, 28) // bits per pixel
  header.writeUInt32LE(pixels.length, 34)
  header.writeInt32LE(2835, 38) // 72 DPI
  header.writeInt32LE(2835, 42)

  writeFileSync(path, Buffer.concat([header, pixels]))
  console.log(`  ${path.replace(root, '.')}  ${c.width}x${c.height}`)
}

// --- the two images ---------------------------------------------------------

const icon = decodePng(readFileSync(SOURCE_ICON))
console.log(`source ${SOURCE_ICON.replace(root, '.')} (${icon.width}x${icon.height})`)

// Header: 150x57, shown top-right of each wizard page with the page title to
// its left. The emblem sits at the right edge, inset, with a hairline rule
// along the bottom to separate the strip from the page body.
{
  const c = canvas(150, 57)
  glow(c, 122, 28, 46, 0.5)
  const mark = resize(icon, 45, 45)
  drawImage(c, mark, 96, 6)
  for (let x = 0; x < c.width; x++) {
    setPixel(c, x, c.height - 1, 60, 60, 58)
  }
  writeBmp(join(OUT_DIR, 'installer-header.bmp'), c)
}

// Sidebar: 164x314, the full-height panel on the welcome and finish pages.
// The emblem sits high rather than centred -- NSIS overlays nothing here, but
// optical centre on a tall narrow panel is above the middle.
{
  const c = canvas(164, 314)
  glow(c, 82, 118, 150, 0.42)
  const mark = resize(icon, 112, 112)
  drawImage(c, mark, 26, 62)

  // A short rule under the emblem, echoing the ones bracketing the wordmark
  // on the app's own title screen. Fades out at both ends.
  const ruleY = 206
  for (let x = 26; x < 138; x++) {
    const t = (x - 26) / 112
    setPixel(c, x, ruleY, 0, 0, 0)
    blend(c, x, ruleY, 203, 203, 203, Math.sin(t * Math.PI) * 0.45)
  }

  // Vignette, so the panel reads as depth rather than a flat black rectangle.
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const dx = (x - c.width / 2) / (c.width / 2)
      const dy = (y - c.height / 2) / (c.height / 2)
      const d = Math.min(1, Math.hypot(dx, dy) / 1.35)
      blend(c, x, y, 0, 0, 0, d * d * 0.55)
    }
  }

  writeBmp(join(OUT_DIR, 'installer-sidebar.bmp'), c)
}
