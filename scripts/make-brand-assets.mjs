// Brand images for places outside the app that ask for an icon and a logo --
// Stripe's checkout and receipts being the reason this exists.
//
//   node scripts/make-brand-assets.mjs [output directory]
//
// Both are the portal on black, which is what the mark is: white linework that
// needs a dark ground to exist on. On a white receipt it reads as a deliberate
// plate rather than a floating scribble, and it matches the app icon, the
// installer and the launch screen -- one mark everywhere.
//
// No wordmark. Drawing "DIGITAL ATRIUM" would need a text rasteriser, and these
// scripts deliberately have no image library; a lockup with type belongs in a
// design tool, not here.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, lumaToAlpha, resize } from './image-tools.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'public', 'portal_profile.png')
const outDir = process.argv[2] ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', 'Desktop')

// Keyed off its black ground so the glow behind it shows through, instead of
// the mark sitting on a slightly different black in a visible square.
const mark = lumaToAlpha(decodePng(readFileSync(SOURCE)))

function plate(width, height, markSize) {
  const rgba = Buffer.alloc(width * height * 4)

  // Opaque black. Transparent would be worse everywhere this gets used: white
  // linework on a transparent ground disappears against a white receipt.
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i + 3] = 255
  }

  // A pool of light behind the mark, the same one the installer and the launch
  // screen use.
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) * 0.62
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const distance = Math.hypot(x - cx, y - cy) / radius
      if (distance >= 1) continue
      const falloff = (1 - distance) * (1 - distance) * 0.09
      const d = (y * width + x) * 4
      rgba[d] = Math.round(203 * falloff)
      rgba[d + 1] = Math.round(203 * falloff)
      rgba[d + 2] = Math.round(203 * falloff)
    }
  }

  const scaled = resize(mark, markSize, markSize)
  const originX = Math.round((width - markSize) / 2)
  const originY = Math.round((height - markSize) / 2)

  for (let y = 0; y < markSize; y++) {
    for (let x = 0; x < markSize; x++) {
      const s = (y * markSize + x) * 4
      const alpha = scaled.rgba[s + 3] / 255
      if (alpha <= 0) continue
      const d = ((originY + y) * width + (originX + x)) * 4
      for (let c = 0; c < 3; c++) {
        rgba[d + c] = Math.round(rgba[d + c] * (1 - alpha) + scaled.rgba[s + c] * alpha)
      }
    }
  }

  return { width, height, rgba }
}

mkdirSync(outDir, { recursive: true })

// Square, shown small: in checkout's header, beside the business name, and as
// the avatar on a receipt. The mark fills most of it, since at that size margin
// is wasted space.
const icon = plate(512, 512, 400)
const iconPath = join(outDir, 'digital-atrium-icon.png')
writeFileSync(iconPath, encodePng(icon))

// Wider, shown larger at the top of a receipt or invoice. More margin, because
// here the mark has room to be looked at rather than merely recognised.
const logo = plate(1024, 512, 460)
const logoPath = join(outDir, 'digital-atrium-logo.png')
writeFileSync(logoPath, encodePng(logo))

for (const [path, image] of [[iconPath, icon], [logoPath, logo]]) {
  const size = readFileSync(path).length
  console.log(`${path}  ${image.width}x${image.height}  ${(size / 1024).toFixed(0)} KB`)
}
