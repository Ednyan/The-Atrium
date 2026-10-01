// Numbered default names.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cleanTitle, fileTitle, firstFreeName, nextTextName, nextUntitledName, placeholderNames } from '../src/lib/traceNames.ts'

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

test('placeholders from before shapes and drawings were numbered get names', () => {
  const names = { shape: (n: number) => `Shape ${n}`, path: (n: number) => `Path ${n}`, stroke: (n: number) => `Stroke ${n}`, drawing: (n: number) => `Drawing ${n}` }
  const drawn = (id: string, layerId: string | null, mediaUrl = `https://x/drawing_u_${id}.png`) => ({ id, type: 'image', content: 'freehand drawing', layerId, mediaUrl })
  const named = placeholderNames([
    { id: 's1', type: 'shape', shapeType: 'rectangle', content: 'Shape 1' },
    { id: 's2', type: 'shape', shapeType: 'circle', content: 'shape content' },
    { id: 's3', type: 'shape', shapeType: 'rectangle', content: '  ' },
    { id: 'p1', type: 'shape', shapeType: 'path', content: 'shape content' },
    drawn('a', 'g'), drawn('b', 'g'), drawn('c', null),
    // Known as a drawing only by its placeholder: left as it is.
    drawn('d', null, 'data:image/png;base64,AAA'),
    { id: 't', type: 'text', content: 'shape content' },
  ], ['Drawing 1'], names)
  assert.deepEqual(Object.fromEntries(named), { s2: 'Shape 2', s3: 'Shape 3', p1: 'Path 1', a: 'Stroke 1', b: 'Stroke 2', c: 'Drawing 2' })
})
