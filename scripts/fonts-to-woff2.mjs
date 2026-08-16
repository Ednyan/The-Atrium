// Converts the bundled fonts from TTF/OTF to WOFF2, in place.
//
//   node scripts/fonts-to-woff2.mjs            convert, keep the originals
//   node scripts/fonts-to-woff2.mjs --replace  convert and delete the originals
//
// WOFF2 is the same outlines under Brotli compression built for fonts, so this
// costs nothing visually and typically takes 70-80% off. The fonts are the
// heaviest thing shipped -- Datatype alone is 4.1MB -- and while they load
// lazily (only when a trace actually uses one), a single trace in an unusual
// font was pulling several megabytes.
//
// No code change goes with this. TraceOverlay's font registry already globs
// woff2 alongside ttf and otf, and picks a family's file by filename, which
// conversion preserves. Nothing anywhere references a .ttf path directly.
//
// Only the two depths the registry looks at: bare files in fonts/, and files at
// the root of a family folder. A Google Fonts download nests every individual
// weight under static/, which is deliberately not globbed -- converting those
// would spend time on files that never ship.

import { readdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, extname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compress } from 'wawoff2'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FONTS = join(root, 'src', 'assets', 'fonts')
const replaceOriginals = process.argv.includes('--replace')

const CONVERTIBLE = new Set(['.ttf', '.otf'])

// Italics are converted too, even though the registry excludes them from the
// bundle and always has -- one roman entry per family, with slant synthesized
// by the browser. They cost nothing to download and everything to store: 14
// files, 6.9MB, sitting in the repository for a use they don't currently have.
// Converting keeps them, at a fifth of the weight, in the format they'd need to
// be in the day italic support becomes real.
function candidatesIn(dir, depth) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (depth === 0) out.push(...candidatesIn(path, 1))
      continue
    }
    if (!CONVERTIBLE.has(extname(entry).toLowerCase())) continue
    out.push(path)
  }
  return out
}

const files = candidatesIn(FONTS, 0)
const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(2)

let before = 0
let after = 0
let converted = 0
let skipped = 0

for (const path of files) {
  const target = join(dirname(path), `${basename(path, extname(path))}.woff2`)
  const input = readFileSync(path)

  let output
  try {
    output = Buffer.from(await compress(input))
  } catch (error) {
    // Reported rather than swallowed: a font that won't convert stays a TTF and
    // keeps working, but silently leaving one behind would look like the size
    // saving simply didn't happen.
    console.warn(`  ! ${basename(path)} could not be converted: ${error.message ?? error}`)
    skipped++
    continue
  }

  writeFileSync(target, output)
  if (replaceOriginals) unlinkSync(path)

  before += input.length
  after += output.length
  converted++
  const saved = (100 * (1 - output.length / input.length)).toFixed(0)
  console.log(`  ${basename(target).padEnd(58)} ${mb(input.length)}MB -> ${mb(output.length)}MB  (-${saved}%)`)
}

console.log()
console.log(`${converted} converted${skipped ? `, ${skipped} skipped` : ''}`)
console.log(`${mb(before)}MB -> ${mb(after)}MB  (-${(100 * (1 - after / before)).toFixed(0)}%)`)
if (!replaceOriginals) {
  console.log('Originals kept. Re-run with --replace to remove them.')
}
