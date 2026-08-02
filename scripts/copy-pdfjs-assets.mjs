// Copies pdfjs's runtime asset folders into public/pdfjs/ so Vite serves them
// alongside the app.
//
// pdfjs doesn't bundle these -- it fetches them at runtime from URLs you give
// it, and silently degrades when they're missing. That degradation is quiet in
// exactly the way that wastes an afternoon: a page renders, but any image
// inside it encoded as JPEG 2000 or JBIG2 comes out blank, because the wasm
// decoder for it was never fetched.
//
//   wasm/           JPEG 2000, JBIG2, colour management. Missing images.
//   cmaps/          CJK character maps. Missing/garbled text in CJK documents.
//   standard_fonts/ The 14 standard PDF fonts. Wrong or missing glyphs.
//   iccs/           ICC colour profiles. Colours shift.
//
// Copied at build time rather than committed: they're ~6MB of binaries that
// belong to a dependency, and committing them means they silently go stale the
// next time pdfjs is updated. public/pdfjs/ is gitignored for the same reason.

import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', 'pdfjs-dist')
const destination = join(root, 'public', 'pdfjs')

const FOLDERS = ['wasm', 'cmaps', 'standard_fonts', 'iccs']

if (!existsSync(source)) {
  console.error('pdfjs-dist not found in node_modules -- run npm install first.')
  process.exit(1)
}

await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })

for (const folder of FOLDERS) {
  const from = join(source, folder)
  if (!existsSync(from)) {
    // Not fatal: a future pdfjs may drop or rename one of these, and a missing
    // ICC folder shouldn't stop the app being built.
    console.warn(`pdfjs assets: ${folder} not present, skipping`)
    continue
  }
  await cp(from, join(destination, folder), { recursive: true })
}

console.log(`pdfjs assets copied to public/pdfjs (${FOLDERS.join(', ')})`)
