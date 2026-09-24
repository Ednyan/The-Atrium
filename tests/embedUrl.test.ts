// Pasted links into frameable URLs, and the box each kind of embed starts in.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { defaultEmbedBox, toEmbedUrl } from '../src/lib/embedUrl.ts'

test('every shape of YouTube link becomes the one embed URL', () => {
  const embed = 'https://www.youtube.com/embed/abc123'
  for (const link of [
    'https://www.youtube.com/watch?v=abc123',
    'https://www.youtube.com/watch?v=abc123&list=PL1&index=2',
    'https://www.youtube.com/watch?feature=share&v=abc123',
    'https://m.youtube.com/watch?app=desktop&v=abc123#t=4',
    'https://youtu.be/abc123?si=xyz',
    'https://www.youtube.com/shorts/abc123',
    'https://www.youtube.com/live/abc123/',
  ]) assert.equal(toEmbedUrl(link), embed, link)
  assert.equal(toEmbedUrl(embed + '?start=30'), embed + '?start=30')
})

test('videos start at a size YouTube draws its full player at', () => {
  assert.deepEqual(defaultEmbedBox('https://www.youtube.com/watch?v=abc123'), { width: 560, height: 315 })
  assert.deepEqual(defaultEmbedBox('https://youtu.be/abc123'), { width: 560, height: 315 })
  assert.deepEqual(defaultEmbedBox('https://www.youtube.com/shorts/abc123'), { width: 338, height: 600 })
  assert.equal(defaultEmbedBox('https://docs.google.com/presentation/d/x/edit'), null)
})
