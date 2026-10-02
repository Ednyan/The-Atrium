// The .atrium file: which files are one, and where a file's traces go in its stack.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AtriumFileError, fileOrderKeys, parseAtriumFile } from '../src/lib/atriumFormat.ts'

const file = (over: Record<string, unknown> = {}) => JSON.stringify({
  version: 3, exportedAt: '', app: 'x', lobby: { name: 'A', theme_settings: null, is_public: false, max_players: 50 },
  layers: [], traces: [], layerOrder: 'flat', ...over,
})
const reason = (text: string) => {
  try { parseAtriumFile(text); return 'ok' } catch (e) { return e instanceof AtriumFileError ? e.reason : 'thrown' }
}

test('a file is ours, of a version this app reads, or says which it is not', () => {
  assert.equal(reason(file()), 'ok')
  assert.equal(reason(file({ version: 1 })), 'ok')
  assert.equal(reason('not json'), 'parseFailed')
  assert.equal(reason(JSON.stringify({ hello: 1 })), 'badFormat')
  assert.equal(reason(file({ version: 4 })), 'badVersion')
  // A file with no groups list has none.
  assert.deepEqual(parseAtriumFile(file({ layers: undefined })).layers, [])
})

test("a file's own keys are kept; an older one's numbers become keys in its order", () => {
  const keyed = parseAtriumFile(file({ traces: [{ id: 'a', order_key: 'a5' }, { id: 'b', order_key: 'a1' }] }))
  const { traceKeyOf } = fileOrderKeys(keyed)
  assert.deepEqual(keyed.traces.map(tr => traceKeyOf.get(tr)), ['a5', 'a1'])

  const numbered = parseAtriumFile(file({ traces: [{ id: 'a', z_index: 3 }, { id: 'b', z_index: 1 }, { id: 'c', z_index: 2 }] }))
  const keys = fileOrderKeys(numbered).traceKeyOf
  const order = [...numbered.traces].sort((x, y) => (keys.get(x)! < keys.get(y)! ? -1 : 1)).map(tr => tr.id)
  assert.deepEqual(order, ['b', 'c', 'a'])
})
