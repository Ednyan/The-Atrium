// Pasted links into frameable URLs, and the box each kind of embed starts in.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import { defaultEmbedBox, EMBED_RELAY, RELAYED_HOSTS, throughRelay, toEmbedUrl } from '../src/lib/embedUrl.ts'

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

test('videos go through the relay page; nothing else does', () => {
  const video = 'https://www.youtube.com/embed/abc123?start=5'
  assert.equal(throughRelay(video), `${EMBED_RELAY}?src=${encodeURIComponent(video)}`)
  assert.equal(new URL(throughRelay(video)).searchParams.get('src'), video)
  assert.ok(throughRelay('https://player.vimeo.com/video/42').startsWith(EMBED_RELAY))
  for (const other of ['https://drive.google.com/file/d/x/preview', 'http://www.youtube.com/embed/abc123', 'https://www.youtube.com.evil.example/embed/x', 'not a url']) {
    assert.equal(throughRelay(other), other)
  }
})

test('the relay page frames exactly the hosts the app sends it', () => {
  const page = readFileSync('public/embed/relay.js', 'utf8')
  const list = page.match(/const RELAYED_HOSTS = (\[[^\]]*\])/)
  assert.ok(list, 'relay.js names its hosts')
  assert.deepEqual(JSON.parse(list[1].replace(/'/g, '"')), RELAYED_HOSTS)
})
