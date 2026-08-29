// The image that shows when the site is pasted into Discord, WhatsApp, Signal,
// Slack, iMessage or Twitter.
//
//   node scripts/make-og-image.mjs
//
// Writes public/og-card.png, which index.html points og:image and twitter:image
// at.
//
// This exists because the tag used to point at glass_dome.png, which is
// 2780x2503 -- very nearly square. Every one of those platforms crops a large
// card to 1.91:1 and takes the middle, so a square image arrives with its top
// and bottom cut off: the dome lost its dome. The fix is not a smaller square,
// it is the right shape, so nobody has to crop anything.
//
// 1200x630 is the size all of them ask for. Under 1 MB, and under 300 KB here,
// which matters because several of those clients give up on a slow image and
// show nothing rather than waiting.
//
// The composition is the plate from make-brand-assets.mjs -- the portal on
// black over its pool of light -- widened. No wordmark, for the reason given
// in that script: drawing type would need a text rasteriser, and these scripts
// deliberately have no image library.
//
// A screenshot of a full atrium would be a better card than this, and would
// drop straight in: save it over public/og-card.png at 1200x630 and change
// nothing else. This is the honest placeholder until there is one -- correctly
// shaped, which is the part that was actually broken.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, lumaToAlpha, resize } from './image-tools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'public', 'portal_profile.png')
const OUT = join(root, 'public', 'og-card.png')

const WIDTH = 1200
const HEIGHT = 630
// Sized against the height, not the width. Filling a wide card edge to edge
// would leave the mark cropped again the moment a client uses a squarer ratio
// than it promised.
const MARK = 380

// Keyed off its black ground, so the glow behind it shows through rather than
// the mark sitting on a slightly different black in a visible square.
const mark = lumaToAlpha(decodePng(readFileSync(SOURCE)))

const rgba = Buffer.alloc(WIDTH * HEIGHT * 4)
for (let i = 0; i < rgba.length; i += 4) {
  // #191919, the app's own ground (--c-ground in src/index.css). The brand
  // plates use pure black because they land on white receipts; this one lands
  // in a chat window next to the site it links to, so it should be the colour
  // of the site.
  rgba[i] = 25
  rgba[i + 1] = 25
  rgba[i + 2] = 25
  rgba[i + 3] = 255
}

const cx = WIDTH / 2
const cy = HEIGHT / 2
const radius = Math.min(WIDTH, HEIGHT) * 0.78
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const distance = Math.hypot(x - cx, y - cy) / radius
    if (distance >= 1) continue
    const falloff = (1 - distance) * (1 - distance) * 0.09
    const d = (y * WIDTH + x) * 4
    for (let c = 0; c < 3; c++) {
      rgba[d + c] = Math.min(255, Math.round(rgba[d + c] + 203 * falloff))
    }
  }
}

const scaled = resize(mark, MARK, MARK)
const originX = Math.round((WIDTH - MARK) / 2)
const originY = Math.round((HEIGHT - MARK) / 2)

for (let y = 0; y < MARK; y++) {
  for (let x = 0; x < MARK; x++) {
    const s = (y * MARK + x) * 4
    const alpha = scaled.rgba[s + 3] / 255
    if (alpha <= 0) continue
    const d = ((originY + y) * WIDTH + (originX + x)) * 4
    for (let c = 0; c < 3; c++) {
      rgba[d + c] = Math.round(rgba[d + c] * (1 - alpha) + scaled.rgba[s + c] * alpha)
    }
  }
}

writeFileSync(OUT, encodePng({ width: WIDTH, height: HEIGHT, rgba }))
console.log(`${OUT}  ${WIDTH}x${HEIGHT}  ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`)
