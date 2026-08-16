// Regenerates the Windows and Linux app icons from the portal mark.
//
//   node scripts/make-app-icons.mjs
//
// The source is public/glass_dome_small_icon.png -- the same file the web
// favicon uses, so the app icon, the browser tab and the launch intro are all
// the one mark rather than three that drifted apart.
//
// Kept on its black ground rather than cut out. The portal is white linework;
// on a transparent background it vanishes against a light taskbar, and the
// black is part of how it reads everywhere else in the app.
//
// Not regenerated here:
//   Square*Logo.png    Windows Store leftovers from `tauri icon`; nothing in
//                      tauri.conf.json references them.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, encodeIco, encodeIcns, resize, ICNS_TYPES } from './image-tools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'public', 'glass_dome_small_icon.png')
const ICONS = join(root, 'src-tauri', 'icons')

const source = decodePng(readFileSync(SOURCE))
console.log(`source ${SOURCE.replace(root, '.')} (${source.width}x${source.height})`)

// icon.png is both an icon in its own right and the source the installer art
// is generated from, so it keeps the full resolution available.
const PNG_SIZES = [
  ['icon.png', 256],
  ['128x128@2x.png', 256],
  ['128x128.png', 128],
  ['64x64.png', 64],
  ['32x32.png', 32],
]

for (const [name, size] of PNG_SIZES) {
  const scaled = size === source.width ? source : resize(source, size, size)
  writeFileSync(join(ICONS, name), encodePng(scaled))
  console.log(`  icons/${name}  ${size}x${size}`)
}

// Every size Windows picks between: the list view, the taskbar, the desktop,
// and the large tile in the installer's own title bar.
const ICO_SIZES = [16, 32, 48, 64, 128, 256]
const ico = encodeIco(ICO_SIZES.map(size => (size === source.width ? source : resize(source, size, size))))
writeFileSync(join(ICONS, 'icon.ico'), ico)
console.log(`  icons/icon.ico  ${ICO_SIZES.join(', ')}  (${(ico.length / 1024).toFixed(0)} KB)`)

// macOS. Only sizes the source can actually fill: it is 256 square, so the
// 512 and 1024 slots are left out rather than filled with an upscale that
// would look worse than letting macOS scale the 256 itself.
const icnsSizes = [...new Set(ICNS_TYPES.map(([, size]) => size))]
const pngBySize = new Map(
  icnsSizes.map(size => [size, encodePng(size === source.width ? source : resize(source, size, size))]),
)
const icns = encodeIcns(pngBySize)
writeFileSync(join(ICONS, 'icon.icns'), icns)
console.log(`  icons/icon.icns  ${ICNS_TYPES.map(([t, s]) => `${t}:${s}`).join(', ')}  (${(icns.length / 1024).toFixed(0)} KB)`)

// Read back before it's trusted. This runs on Windows, where nothing can open
// an .icns to check it, and a malformed one fails the macOS build with an error
// that points at the file rather than at what's wrong with it.
{
  const written = readFileSync(join(ICONS, 'icon.icns'))
  if (written.toString('ascii', 0, 4) !== 'icns') throw new Error('icns: bad magic')
  if (written.readUInt32BE(4) !== written.length) {
    throw new Error(`icns: header says ${written.readUInt32BE(4)} bytes, file is ${written.length}`)
  }

  let pos = 8
  let seen = 0
  while (pos < written.length) {
    const type = written.toString('ascii', pos, pos + 4)
    const len = written.readUInt32BE(pos + 4)
    if (len < 8 || pos + len > written.length) throw new Error(`icns: entry ${type} has length ${len}`)
    const payload = written.subarray(pos + 8, pos + len)
    if (payload.readUInt32BE(0) !== 0x89504e47) throw new Error(`icns: entry ${type} is not a PNG`)
    const expected = ICNS_TYPES.find(([t]) => t === type)?.[1]
    const actual = payload.readUInt32BE(16)
    if (actual !== expected) throw new Error(`icns: ${type} holds ${actual}px, expected ${expected}px`)
    seen++
    pos += len
  }
  if (seen !== ICNS_TYPES.length) throw new Error(`icns: ${seen} entries, expected ${ICNS_TYPES.length}`)
  console.log(`  icons/icon.icns verified: ${seen} entries, sizes and lengths agree`)
}
