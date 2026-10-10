// The landing page's roots (components/landing/CodeRoots): the project's own
// files, the most connected, and which of them call on which -- from the
// graph graphify keeps (graphify-out/graph.json), boiled down to what the
// page draws. Run after `python -m graphify update .`:
//   node scripts/make-code-roots.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const COUNT = 40
const graph = JSON.parse(readFileSync('graphify-out/graph.json', 'utf8'))
const fileOf = new Map(graph.nodes.map(n => [n.id, n.source_file]))
// Code of the app itself: not vendored, generated, or data.
const ours = file => /^(src|api|scripts|src-tauri\/src)\//.test(file ?? '') && !/vendor|\/gen\/|\.json$|\.d\.ts$|locales\//.test(file)

const size = new Map()
for (const n of graph.nodes) if (ours(n.source_file)) size.set(n.source_file, (size.get(n.source_file) ?? 0) + 1)
const pair = new Map()
for (const link of graph.links) {
  const a = fileOf.get(link.source), b = fileOf.get(link.target)
  if (!ours(a) || !ours(b) || a === b) continue
  const key = a < b ? `${a}\n${b}` : `${b}\n${a}`
  pair.set(key, (pair.get(key) ?? 0) + 1)
}
// The most connected files: their links to others, and their own size.
const degree = new Map()
for (const [key, w] of pair) for (const f of key.split('\n')) degree.set(f, (degree.get(f) ?? 0) + w)
const files = [...size.keys()].sort((a, b) => (degree.get(b) ?? 0) + size.get(b) / 4 - ((degree.get(a) ?? 0) + size.get(a) / 4)).slice(0, COUNT)
const index = new Map(files.map((f, i) => [f, i]))
const links = []
for (const [key, w] of pair) {
  const [a, b] = key.split('\n')
  if (index.has(a) && index.has(b)) links.push([index.get(a), index.get(b), w])
}
const out = {
  commit: graph.built_at_commit ?? null,
  files: files.map(f => ({ name: f.split('/').pop(), path: f, size: size.get(f) })),
  links: links.sort((x, y) => y[2] - x[2]),
}
writeFileSync('src/components/landing/codeRoots.json', JSON.stringify(out))
console.log(`${out.files.length} files, ${out.links.length} links`)
