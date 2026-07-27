// Generates the latest.json the desktop updater reads, from whatever the last
// build produced. Exists because the two things people get wrong when writing
// it by hand are exactly the two things a script can't get wrong: pasting the
// .sig file's CONTENTS (not a path), and matching GitHub's asset URL, which
// rewrites spaces in filenames to dots.
//
//   node scripts/make-release-manifest.mjs "Notes shown to the user."
//
// Writes latest.json to the repo root. Attach it to the same GitHub release as
// the .exe and its .sig.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO = 'Ednyan/The-Atrium'
const NSIS_DIR = 'src-tauri/target/release/bundle/nsis'

const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const version = conf.version
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`✗ Version "${version}" must be MAJOR.MINOR.PATCH with no prefix or suffix.`)
  process.exit(1)
}

const exeName = `The Digital Atrium_${version}_x64-setup.exe`
const sigPath = join(NSIS_DIR, `${exeName}.sig`)
const exePath = join(NSIS_DIR, exeName)

if (!existsSync(exePath)) {
  console.error(`✗ No installer at ${exePath}`)
  console.error('  Run: npm run tauri:build')
  process.exit(1)
}

if (!existsSync(sigPath)) {
  console.error(`✗ Installer exists but has no .sig alongside it.`)
  console.error('  The build ran without TAURI_SIGNING_PRIVATE_KEY set, so the')
  console.error('  update would be rejected as unsigned. Re-run:')
  console.error('    export TAURI_SIGNING_PRIVATE_KEY="$(cat /c/Users/Ednyan/Desktop/atrium-updater-keys/atrium-updater.key)"')
  console.error('    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""')
  console.error('    npm run tauri:build')
  process.exit(1)
}

const signature = readFileSync(sigPath, 'utf8').trim()
const notes = process.argv[2] || `Version ${version}`

// GitHub serves attached assets with spaces replaced by dots.
const assetName = exeName.replace(/ /g, '.')

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${REPO}/releases/download/v${version}/${assetName}`,
    },
  },
}

writeFileSync('latest.json', JSON.stringify(manifest, null, 2) + '\n')

console.log(`✓ latest.json written for v${version}`)
console.log('')
console.log('Attach these three to a GitHub release tagged v' + version + ':')
console.log(`  ${exePath}`)
console.log(`  ${sigPath}`)
console.log('  latest.json')
console.log('')
console.log('Then verify:')
console.log(`  curl -sL https://github.com/${REPO}/releases/latest/download/latest.json`)
