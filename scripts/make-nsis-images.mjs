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
// The emblem comes from src-tauri/icons/icon.png, so running
// make-app-icons.mjs and then this one keeps the installer showing whatever
// the app's icon currently is.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, lumaToAlpha, resize } from './image-tools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ICON = join(root, 'src-tauri', 'icons', 'icon.png')
const OUT_DIR = join(root, 'src-tauri', 'installer')

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

// Keyed out of its black ground: these panels are drawn on black with a glow
// behind the mark, and an opaque square would cover the glow and show its own
// edges rather than sitting in the light.
const icon = lumaToAlpha(decodePng(readFileSync(SOURCE_ICON)))
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
