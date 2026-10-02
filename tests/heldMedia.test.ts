// A deleted trace's files are held while undo could bring the trace back, and
// released after: a file goes only if its trace didn't come back. The SQL is
// read from lib/localDb's source (it pulls in Tauri, which Node can't load,
// as tests/localDbSurface says) and run on a real SQLite.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const source = readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8')
const found = (pattern: RegExp) => {
  const m = pattern.exec(source)
  assert.ok(m, `localDb has ${pattern}`)
  return m
}
const create = found(/db\.execute\('(CREATE TABLE IF NOT EXISTS held_trace_media[^']*)'\)/)[1]
const hold = found(/'(INSERT OR REPLACE INTO held_trace_media[^']*)'/)[1]
const select = found(/`(SELECT h\.\*, t\.id AS back FROM held_trace_media h LEFT JOIN traces t ON t\.id = h\.trace_id)\$\{lobbyId \? '( WHERE h\.lobby_id = \?)' : ''\}`/)
const release = found(/'(DELETE FROM held_trace_media WHERE trace_id = \?)'/)[1]

test('released, only the files of traces still deleted go; the other atrium keeps its holds', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE traces (id TEXT PRIMARY KEY, lobby_id TEXT, type TEXT, media_url TEXT, image_url TEXT)')
  db.exec(create)
  db.exec(create)

  const held = (id: string, lobby: string) => db.prepare(hold).run(id, lobby, 'image', `local://traces/${lobby}/${id}.png`, null)
  held('A', 'L')
  held('B', 'L')
  held('C', 'M')
  held('B', 'L')
  // B's delete undone.
  db.prepare('INSERT INTO traces VALUES (?, ?, ?, ?, ?)').run('B', 'L', 'image', 'local://traces/L/B.png', null)

  // Atrium L left.
  const rows = db.prepare(select[1] + select[2]).all('L') as { trace_id: string; back: string | null }[]
  for (const row of rows) db.prepare(release).run(row.trace_id)
  assert.deepEqual(rows.filter(r => !r.back).map(r => r.trace_id), ['A'])
  assert.deepEqual((db.prepare('SELECT trace_id FROM held_trace_media').all() as { trace_id: string }[]).map(r => r.trace_id), ['C'])

  // The next start: the rest.
  assert.deepEqual((db.prepare(select[1]).all() as { trace_id: string; back: string | null }[]).map(r => [r.trace_id, r.back]), [['C', null]])
})
