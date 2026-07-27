// Creates the GitHub release and uploads the three assets the updater needs.
//
//   GITHUB_TOKEN=<pat> node scripts/publish-release.mjs
//
// The token is read from the environment and never written anywhere. Needs
// Contents: read+write on this repo and nothing else.
//
// Refuses to overwrite an existing release for the same tag -- republishing a
// version that clients may already have installed is not something to do by
// accident.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const OWNER = 'Ednyan'
const REPO = 'The-Atrium'
const NSIS_DIR = 'src-tauri/target/release/bundle/nsis'

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('✗ GITHUB_TOKEN is not set.')
  process.exit(1)
}

const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  })
  return res
}

const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const version = conf.version
const tag = `v${version}`

const exeName = `The Digital Atrium_${version}_x64-setup.exe`
const assets = [
  join(NSIS_DIR, exeName),
  join(NSIS_DIR, `${exeName}.sig`),
  'latest.json',
]

for (const a of assets) {
  if (!existsSync(a)) {
    console.error(`✗ Missing ${a}`)
    console.error('  Build with the signing key, then run scripts/make-release-manifest.mjs')
    process.exit(1)
  }
}

// The manifest must describe the version being published, or clients download
// a mismatched binary.
const manifest = JSON.parse(readFileSync('latest.json', 'utf8'))
if (manifest.version !== version) {
  console.error(`✗ latest.json is for ${manifest.version} but tauri.conf.json says ${version}.`)
  console.error('  Re-run scripts/make-release-manifest.mjs')
  process.exit(1)
}

const existing = await api(`/repos/${OWNER}/${REPO}/releases/tags/${tag}`)
if (existing.ok) {
  console.error(`✗ Release ${tag} already exists. Bump the version rather than replacing it.`)
  process.exit(1)
}
if (existing.status !== 404) {
  console.error(`✗ Could not check for an existing release (HTTP ${existing.status}).`)
  console.error(await existing.text())
  process.exit(1)
}

console.log(`Creating release ${tag}...`)
const created = await api(`/repos/${OWNER}/${REPO}/releases`, {
  method: 'POST',
  body: JSON.stringify({
    tag_name: tag,
    name: tag,
    body: manifest.notes || `Version ${version}`,
    draft: false,
    prerelease: false,
  }),
})

if (!created.ok) {
  console.error(`✗ Failed to create release (HTTP ${created.status}).`)
  console.error(await created.text())
  process.exit(1)
}

const release = await created.json()
// Strip the {?name,label} template GitHub appends.
const uploadBase = release.upload_url.replace(/\{.*$/, '')

for (const path of assets) {
  const name = basename(path)
  const size = statSync(path).size
  process.stdout.write(`Uploading ${name} (${(size / 1048576).toFixed(1)} MB)... `)

  const res = await fetch(`${uploadBase}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
    },
    body: readFileSync(path),
  })

  if (!res.ok) {
    console.log('failed')
    console.error(`✗ Upload failed (HTTP ${res.status}).`)
    console.error(await res.text())
    console.error(`\nThe release exists but is incomplete: ${release.html_url}`)
    console.error('Delete it on GitHub before retrying.')
    process.exit(1)
  }
  console.log('ok')
}

console.log(`\n✓ Published ${tag}`)
console.log(`  ${release.html_url}`)
