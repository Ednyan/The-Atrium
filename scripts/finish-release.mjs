// Finishes a release CI drafted (RELEASING.md, route A): waits for the tag's
// workflow runs, requires exactly one draft for the tag, checks each
// platform's signature in its latest.json against the .sig uploaded beside
// it, swaps in a latest.json whose notes are the blurb, sets the release's
// body -- and, with --publish, publishes it and reads back what installed
// apps will be offered.
//
//   GH_TOKEN=<token> node scripts/finish-release.mjs <version> <commit sha> <blurb file> <body file> [--publish]
//
// The token is read from the environment and never printed or kept.

import { readFileSync } from 'node:fs'

const OWNER = 'Ednyan', REPO = 'The-Atrium'
const [version, sha, blurbFile, bodyFile] = process.argv.slice(2)
const publish = process.argv.includes('--publish')
const token = process.env.GH_TOKEN
if (!version || !sha || !blurbFile || !bodyFile) throw new Error('usage: finish-release.mjs <version> <sha> <blurb file> <body file> [--publish]')
if (!token) throw new Error('GH_TOKEN is not set')
const blurb = readFileSync(blurbFile, 'utf8').trim()
const body = readFileSync(bodyFile, 'utf8').trim()
const tag = `v${version}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

const api = async (path, init = {}) => {
  const res = await fetch(path.startsWith('http') ? path : `https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}) },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res
}
const json = async (path, init) => (await api(path, init)).json()
const download = async asset => (await api(asset.url, { headers: { Accept: 'application/octet-stream' } })).text()

// 1. The runs on the commit, finished and green.
for (let waited = 0; ; waited++) {
  const { workflow_runs: runs } = await json(`/actions/runs?head_sha=${sha}&per_page=20`)
  if (!Array.isArray(runs)) throw new Error('no workflow runs answer (is the token right?)')
  const open = runs.filter(run => run.status !== 'completed')
  if (runs.length && !open.length) {
    const failed = runs.filter(run => run.conclusion !== 'success')
    if (failed.length) throw new Error(`runs failed: ${failed.map(run => `${run.name} ${run.conclusion} ${run.html_url}`).join(', ')}`)
    console.log(`runs: ${runs.length} green`)
    break
  }
  if (waited > 100) throw new Error('runs still going after 50 minutes')
  if (waited % 4 === 0) console.log(`runs: ${runs.length ? `${open.length} of ${runs.length} still going` : 'none yet'}`)
  await sleep(30_000)
}

// 2. One draft for the tag.
const drafts = (await json('/releases?per_page=30')).filter(release => release.tag_name === tag && release.draft)
if (drafts.length !== 1) throw new Error(`${drafts.length} drafts for ${tag}: merge them first (one per tag)`)
const release = drafts[0]
const assetNamed = name => release.assets.find(asset => asset.name === name)

// 3. Each platform's signature, as its .sig says.
const manifestAsset = assetNamed('latest.json')
if (!manifestAsset) throw new Error('the draft has no latest.json')
const manifest = JSON.parse(await download(manifestAsset))
if (manifest.version !== version) throw new Error(`latest.json says ${manifest.version}`)
for (const [platform, entry] of Object.entries(manifest.platforms)) {
  const name = decodeURIComponent(new URL(entry.url).pathname.split('/').pop())
  if (!assetNamed(name)) throw new Error(`${platform}: no asset ${name}`)
  const sig = assetNamed(`${name}.sig`)
  if (!sig) throw new Error(`${platform}: no ${name}.sig`)
  if ((await download(sig)).trim() !== entry.signature.trim()) throw new Error(`${platform}: the signature isn't its .sig`)
  console.log(`${platform}: signed, matches ${name}.sig`)
}

// 4. latest.json with the notes; the body.
await api(`/releases/assets/${manifestAsset.id}`, { method: 'DELETE' })
const upload = release.upload_url.replace(/\{.*\}$/, '')
await api(`${upload}?name=latest.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...manifest, notes: blurb }, null, 2) })
await api(`/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ body, ...(publish ? { draft: false } : {}) }) })
console.log(publish ? `${tag} published` : `${tag} ready, still a draft`)

// 5. What installed apps are offered now.
if (publish) {
  await sleep(5000)
  const offered = await (await fetch(`https://github.com/${OWNER}/${REPO}/releases/latest/download/latest.json`)).json()
  console.log(`offered: ${offered.version} -- ${offered.notes.slice(0, 80)}...`)
}
