import { test } from 'node:test'
import assert from 'node:assert/strict'

import { asDeckFile, deckPictures } from '../src/lib/deck.ts'

test('a deck read back is set right: nothing but numbers, #rrggbb colours, path commands and kept pictures gets through', () => {
  const deck = asDeckFile({
    v: 1, kind: 'deck', name: 'Talk', width: 1280, height: 720,
    slides: [{
      background: 'red" onload="x',
      picture: { src: 'javascript:alert(1)', hash: 'ab' },
      items: [
        { kind: 'shape', x: 1, y: 2, w: 3, h: 4, path: 'M0 0 L3 4 Z', fill: '#ff0000', line: 'url(#x)', text: {
          anchor: 'middle', inset: [1, 2, 3, 'x'], paragraphs: [{ align: 'ctr', size: 20, runs: [{ text: '<b>hi</b>', size: 'big', color: '#00ff00', font: "Arial'; x: url(y)" }] }],
        } },
        { kind: 'shape', x: 0, y: 0, w: 1, h: 1, path: 'M0 0"/><script>' },
        { kind: 'picture', x: 0, y: 0, w: 1, h: 1, src: 'local://traces/L/a.png', hash: 'ff<' },
        { kind: 'picture', x: 0, y: 0, w: 1, h: 1, src: 'http://example.com/a.png', hash: 'ee' },
        { kind: 'chart', x: 0, y: 0, w: 1, h: 1, chart: { v: 1, kind: 'chart', type: 'pie', series: [{ name: 'a', color: '#123456', values: [1, 2] }] } },
        { kind: 'script', x: 0 },
      ],
    }],
  })
  assert.ok(deck)
  const [slide] = deck.slides
  assert.equal(slide.background, '#ffffff')
  assert.equal(slide.picture, undefined)
  assert.deepEqual(slide.items.map(i => i.kind), ['shape', 'picture', 'chart'])
  const shape = slide.items[0]
  assert.ok(shape.kind === 'shape')
  assert.equal(shape.fill, '#ff0000')
  assert.equal(shape.line, undefined)
  assert.equal(shape.text?.anchor, 't')
  assert.deepEqual(shape.text?.inset, [1, 2, 3, 0])
  // Text is kept as text (deckDraw escapes it); the font name loses what isn't a name.
  assert.deepEqual(shape.text?.paragraphs[0].runs[0], { text: '<b>hi</b>', size: 24, color: '#00ff00', font: 'Arial x urly' })
  const picture = slide.items[1]
  assert.ok(picture.kind === 'picture')
  assert.equal(picture.hash, 'ff')
  assert.deepEqual([...deckPictures(deck)], [['ff', 'local://traces/L/a.png']])
  assert.equal(asDeckFile({ v: 1, kind: 'sheet', slides: [] }), null)
})
