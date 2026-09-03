// That the desktop shim cannot take down its caller.
//
// The shim's query builder implements a handful of PostgREST's methods. The
// danger was never the missing implementation -- it was that a missing method
// is `undefined`, calling it throws a TypeError, and a TypeError escapes every
// `if (error)` check and kills whatever function was building the query.
// `.contains()` did that to the desktop atrium browser, and `.upsert()` was
// about to do it again.
//
// Read as source rather than imported: localDb pulls in @tauri-apps/api, which
// has no meaning outside a webview. What is being checked is a property of the
// file, so the file is what is checked.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/lib/localDb.ts', import.meta.url), 'utf8')

/** Methods the real PostgREST builder offers that code might reach for. */
const POSTGREST_BUILDER_METHODS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
  'like', 'ilike', 'is', 'in', 'contains', 'containedBy',
  'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent',
  'overlaps', 'textSearch', 'match', 'not', 'or', 'filter',
  'order', 'limit', 'range', 'abortSignal',
  'single', 'maybeSingle', 'csv', 'geojson', 'explain',
  'returns', 'throwOnError',
]

/** Implemented for real: a method on the QueryBuilder class. */
function implemented(): Set<string> {
  const body = source.slice(source.indexOf('class QueryBuilder'))
  const end = body.indexOf('\n}\n')
  const names = [...body.slice(0, end).matchAll(/^ {2}([a-zA-Z]+)\s*\(/gm)].map(m => m[1])
  return new Set(names.filter(n => n !== 'constructor' && n !== 'then'))
}

/** Stubbed: present, and resolving to an error rather than throwing. */
function stubbed(): Set<string> {
  const m = /const UNIMPLEMENTED_QUERY_METHODS = \[([\s\S]*?)\]/.exec(source)
  assert.ok(m, 'UNIMPLEMENTED_QUERY_METHODS is missing from localDb.ts')
  return new Set([...m[1].matchAll(/'([a-zA-Z]+)'/g)].map(x => x[1]))
}

test('every PostgREST builder method is either implemented or stubbed', () => {
  const have = implemented()
  const stubs = stubbed()
  const missing = POSTGREST_BUILDER_METHODS.filter(n => !have.has(n) && !stubs.has(n))
  assert.deepEqual(
    missing, [],
    'these would throw a TypeError on desktop and take down their caller: '
    + missing.join(', '),
  )
})

test('no method is both implemented and stubbed', () => {
  const have = implemented()
  const both = [...stubbed()].filter(n => have.has(n))
  assert.deepEqual(both, [], 'the stub would shadow the real implementation: ' + both.join(', '))
})

test('an unsupported call resolves to an error instead of throwing', () => {
  // The whole point. If this guard is ever removed, the shim goes back to
  // being able to kill a screen.
  assert.match(source, /if \(this\.unsupported\)/)
  assert.match(source, /LOCALDB_UNSUPPORTED/)
})

test('the table-level methods the app uses all exist', () => {
  // These sit on the object `from()` returns, not on the builder, and are
  // written at six spaces of indentation -- matched directly rather than by
  // slicing the file, since `return {` appears twenty-six times in it.
  for (const name of ['select', 'insert', 'update', 'delete', 'upsert']) {
    assert.match(
      source, new RegExp('^ {6}' + name + '\\s*\\(', 'm'),
      `from().${name}() is missing, so calling it on desktop throws`,
    )
  }
})

test('the error names the method, so the message says what to do', () => {
  assert.match(source, /does not support \.\$\{this\.unsupported\}\(\)/)
})
