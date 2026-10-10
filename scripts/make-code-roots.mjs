// The landing page's roots (components/landing/CodeRoots): the project's own
// files, the most connected, and which of them call on which -- and the bloom
// round the way to the code history (CodeBloom) -- from the graph graphify
// keeps (graphify-out/graph.json), boiled down to what the page draws. Run
// after `python -m graphify update .`:
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

// The bloom: the biggest communities graphify found in the code, in its
// colours, each a tree of its most connected symbols grown from the button --
// along their real calls where those reach, the rest hung from what they do.
// Laid out here, once, by a small force simulation, in a space of -1..1 that
// the page stretches to fit; a clearing is kept round the button.
const PALETTE = ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7', '#9C755F', '#BAB0AC']
const PER = 28
const symbols = graph.nodes.filter(n => ours(n.source_file))
const near = new Map(symbols.map(n => [n.id, new Set()]))
for (const l of graph.links) {
  if (l.source === l.target || !near.has(l.source) || !near.has(l.target)) continue
  near.get(l.source).add(l.target)
  near.get(l.target).add(l.source)
}
const byCommunity = new Map()
for (const n of symbols) {
  if (!byCommunity.has(n.community)) byCommunity.set(n.community, [])
  byCommunity.get(n.community).push(n)
}
const communities = [...byCommunity.values()].sort((a, b) => b.length - a.length).slice(0, PALETTE.length)
// Named after the file most of it is in.
const nameOf = group => {
  const count = new Map()
  for (const n of group) count.set(n.source_file, (count.get(n.source_file) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0][0].split('/').pop()
}
const nodes = []
const at = new Map()
communities.forEach((group, c) => {
  const chosen = [...group].sort((a, b) => near.get(b.id).size - near.get(a.id).size).slice(0, PER)
  const inGroup = new Set(chosen.map(n => n.id))
  const depth = new Map([[chosen[0].id, 0]]), parent = new Map([[chosen[0].id, null]])
  const queue = [chosen[0].id]
  while (queue.length) {
    const id = queue.shift()
    for (const m of near.get(id)) if (inGroup.has(m) && !depth.has(m)) { depth.set(m, depth.get(id) + 1); parent.set(m, id); queue.push(m) }
  }
  const reached = [...depth.keys()]
  let k = 0
  for (const n of chosen) {
    if (depth.has(n.id)) continue
    const p = reached[(k++ * 5) % reached.length]
    depth.set(n.id, depth.get(p) + 1); parent.set(n.id, p); reached.push(n.id)
  }
  for (const n of chosen) { at.set(n.id, nodes.length); nodes.push({ id: n.id, c, depth: depth.get(n.id), parent: parent.get(n.id), degree: near.get(n.id).size }) }
})
// Calls between communities, the busiest first.
const cross = []
nodes.forEach((n, i) => { for (const m of near.get(n.id)) { const j = at.get(m); if (j > i && nodes[j].c !== n.c) cross.push([i, j]) } })
cross.sort((x, y) => nodes[y[0]].degree + nodes[y[1]].degree - nodes[x[0]].degree - nodes[x[1]].degree)

let seed = 7
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const K = communities.length
const pos = nodes.map(n => {
  const a = -Math.PI / 2 + ((n.c + 0.5) / K) * Math.PI * 2 + (rand() - 0.5) * 0.4
  const r = 0.42 + n.depth * 0.09 + rand() * 0.05
  return [Math.cos(a) * r, Math.sin(a) * r]
})
// [from (-1: the button), to, rest length, stiffness]
const springs = nodes.map((n, i) => (n.parent === null ? [-1, i, 0.46, 0.03] : [at.get(n.parent), i, 0.085, 0.07]))
const STEPS = 700
for (let step = 0; step < STEPS; step++) {
  const heat = 1 - step / STEPS
  const force = nodes.map(() => [0, 0])
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = pos[j][0] - pos[i][0], dy = pos[j][1] - pos[i][1]
      const d2 = Math.max(dx * dx + dy * dy, 1e-4)
      if (d2 > 0.04) continue
      const f = 0.00009 / d2
      force[i][0] -= dx * f; force[i][1] -= dy * f; force[j][0] += dx * f; force[j][1] += dy * f
    }
  }
  for (const [a, b, rest, k] of springs) {
    const from = a < 0 ? [0, 0] : pos[a]
    const dx = pos[b][0] - from[0], dy = pos[b][1] - from[1], d = Math.max(Math.hypot(dx, dy), 1e-4)
    const f = ((d - rest) * k) / d
    force[b][0] -= dx * f; force[b][1] -= dy * f
    if (a >= 0) { force[a][0] += dx * f; force[a][1] += dy * f }
  }
  pos.forEach(([x, y], i) => {
    const e = Math.hypot(x / 0.36, y / 0.34)
    if (e < 1) { force[i][0] += (x / (e || 1)) * (1 - e) * 0.04; force[i][1] += (y / (e || 1)) * (1 - e) * 0.04 }
    const r = Math.hypot(x, y)
    if (r > 0.97) { force[i][0] -= (x / r) * (r - 0.97) * 0.3; force[i][1] -= (y / r) * (r - 0.97) * 0.3 }
    pos[i][0] += Math.max(-0.02, Math.min(0.02, force[i][0])) * (0.3 + heat)
    pos[i][1] += Math.max(-0.02, Math.min(0.02, force[i][1])) * (0.3 + heat)
  })
}
const round = v => Math.round(v * 1000) / 1000
const bloom = {
  groups: communities.map((group, c) => ({ name: nameOf(group), color: PALETTE[c] })),
  // [x, y, group, parent (-1: the button), depth, size]
  nodes: nodes.map((n, i) => [round(pos[i][0]), round(pos[i][1]), n.c, n.parent === null ? -1 : at.get(n.parent), n.depth, round(Math.min(4.5, 1 + Math.sqrt(n.degree) * 0.45))]),
  cross: cross.slice(0, 60),
}

const out = {
  commit: graph.built_at_commit ?? null,
  files: files.map(f => ({ name: f.split('/').pop(), path: f, size: size.get(f) })),
  links: links.sort((x, y) => y[2] - x[2]),
  bloom,
}
writeFileSync('src/components/landing/codeRoots.json', JSON.stringify(out))
console.log(`${out.files.length} files, ${out.links.length} links; bloom: ${bloom.nodes.length} symbols in ${bloom.groups.length} communities (${bloom.groups.map(g => g.name).join(', ')}), ${bloom.cross.length} calls across`)
