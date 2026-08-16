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
//   icon.icns          macOS. The format is writable but not verifiable from
//                      Windows, and a malformed one fails the macOS build.
//   Square*Logo.png    Windows Store leftovers from `tauri icon`; nothing in
//                      tauri.conf.json references them.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, encodeIco, resize } from './image-tools.mjs'

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
