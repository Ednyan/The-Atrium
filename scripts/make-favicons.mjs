// The website's icons: the browser tab, a phone's home screen, an installed
// shortcut.
//
//   node scripts/make-favicons.mjs
//
// Writes into public/:
//   favicon.ico            16, 32 and 48 -- what a browser asks /favicon.ico
//                          for unprompted, and what most tools read
//   apple-touch-icon.png   180, opaque: iOS puts it on a home screen as is
//   icon-192.png           for site.webmanifest (Android, installs), with
//                          icon-512.png, which is the source and kept by hand
//
// The small ones come from the app icon (src-tauri/icons/icon.png), whose mark
// fills its square, so it still reads at 16 px. The manifest's come from
// public/icon-512.png, the same mark with room around it: Android crops
// a "maskable" icon to a circle or a squircle, keeping only its middle 80%.
// Both are the portal on black, as everywhere else.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, encodeIco, resize } from './image-tools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(root, 'public')
const tight = decodePng(readFileSync(join(root, 'src-tauri', 'icons', 'icon.png')))
const roomy = decodePng(readFileSync(join(PUBLIC, 'icon-512.png')))
const sized = (img, size) => (img.width === size ? img : resize(img, size, size))

writeFileSync(join(PUBLIC, 'favicon.ico'), encodeIco([16, 32, 48].map(size => sized(tight, size))))
writeFileSync(join(PUBLIC, 'apple-touch-icon.png'), encodePng(sized(tight, 180)))
writeFileSync(join(PUBLIC, 'icon-192.png'), encodePng(sized(roomy, 192)))
console.log('public/: favicon.ico (16, 32, 48), apple-touch-icon.png (180), icon-192.png')
