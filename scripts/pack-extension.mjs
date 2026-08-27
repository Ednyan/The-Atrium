// Assembles the Firefox build of the extension.
//
// Chrome and Firefox need genuinely different manifests -- Chrome's MV3 wants
// background.service_worker and rejects background.scripts, Firefox is the
// other way round -- so one file cannot serve both. The rest of the extension
// is identical, and duplicating it would only guarantee the two copies drift.
//
// Chrome loads `extension/` directly. This copies the shared files next to the
// Firefox manifest, renamed so Firefox can find it.

import { mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = 'extension'
const OUT = join('build-extension', 'firefox')
const SHARED = ['background.js', 'content.js', 'icon.png']

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

for (const file of SHARED) {
  copyFileSync(join(SOURCE, file), join(OUT, file))
}
copyFileSync(join(SOURCE, 'manifest.firefox.json'), join(OUT, 'manifest.json'))

console.log(`Firefox extension assembled in ${OUT}`)
console.log('Load it via about:debugging → This Firefox → Load Temporary Add-on → pick manifest.json')
