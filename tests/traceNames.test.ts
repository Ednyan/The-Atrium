// Numbered default names.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cleanTitle, fileTitle, firstFreeName, nextTextName, nextUntitledName } from '../src/lib/traceNames.ts'

const text = (n: number) => `Text ${n}`

test('the lowest number not taken, whatever the case', () => {
  assert.equal(firstFreeName([], text), 'Text 1')
  assert.equal(firstFreeName(['Text 1', 'text 2', 'Text 4'], text), 'Text 3')
  assert.equal(firstFreeName(['Group 1', null, undefined], text), 'Text 1')
})

test('only text traces count, and a batch counts itself', () => {
  const traces = [{ type: 'text', layerName: 'Text 1' }, { type: 'image', layerName: 'Text 2' }, { type: 'text', layerName: null }]
  assert.equal(nextTextName(traces, text), 'Text 2')
  assert.equal(nextTextName(traces, text, ['Text 2']), 'Text 3')
})

test('Untitled N counts titles, not text; a file keeps its name without the extension', () => {
  const traces = [{ type: 'image', content: 'Untitled 1' }, { type: 'text', content: 'Untitled 2' }]
  assert.equal(nextUntitledName(traces, n => `Untitled ${n}`), 'Untitled 2')
  assert.equal(fileTitle('Sunset.final.png'), 'Sunset.final')
  assert.equal(fileTitle('no extension'), 'no extension')
  assert.equal(fileTitle('.png'), '')
})

test('a title of blanks and invisible characters is no title', () => {
  assert.equal(cleanTitle('  \u200B \n\t '), '')
  // Pinterest's invisible names: Hangul fillers and the empty Braille cell.
  assert.equal(cleanTitle('\u3164'), '')
  assert.equal(cleanTitle('\u2800 \u2800\uFFA0'), '')
  assert.equal(cleanTitle('\u3164 Casual \n dress code \u200B'), 'Casual dress code')
  assert.equal(cleanTitle('\u2764\uFE0F\u200D\uD83D\uDD25 \u200D'), '\u2764\uFE0F\u200D\uD83D\uDD25')
  assert.equal(cleanTitle(null), '')
})
