// Pasted links into frameable URLs, and the box each kind of embed starts in.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readFileSync } from 'node:fs'

import { defaultEmbedBox, EMBED_RELAY, embedSourcesIn, linksIn, RELAYED_HOSTS, throughRelay, toEmbedUrl } from '../src/lib/embedUrl.ts'

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

test('a SoundCloud page plays in SoundCloud’s player, sized as SoundCloud sizes it', () => {
  const track = 'https://soundcloud.com/artist/a-track'
  const player = `https://w.soundcloud.com/player/?url=${encodeURIComponent(track)}`
  assert.equal(toEmbedUrl(track), player)
  assert.equal(toEmbedUrl(track + '?si=abc&utm_source=clipboard'), player)
  assert.equal(toEmbedUrl('https://m.soundcloud.com/artist/a-track'), `https://w.soundcloud.com/player/?url=${encodeURIComponent('https://m.soundcloud.com/artist/a-track')}`)
  // The player itself is left as it is.
  assert.equal(toEmbedUrl(player), player)
  assert.deepEqual(defaultEmbedBox(track), { width: 560, height: 166 })
  assert.deepEqual(defaultEmbedBox('https://soundcloud.com/artist/sets/a-list'), { width: 560, height: 450 })
  assert.deepEqual(defaultEmbedBox('https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/playlists/123'), { width: 560, height: 450 })
})

test('embed code is read for where its frames point; the code itself is never kept', () => {
  const soundcloud = '<iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/123&color=%23ff5500&auto_play=false"></iframe><div style="font-size: 10px;"><a href="https://soundcloud.com/artist" title="Artist">Artist</a> · <a href="https://soundcloud.com/artist/a-track" title="A Track">A Track</a></div>'
  assert.deepEqual(embedSourcesIn(soundcloud), ['https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/123&color=%23ff5500&auto_play=false'])
  const youtube = '<iframe width="560" height="315" src="https://www.youtube.com/embed/abc123?si=x&amp;start=5" title="YouTube video player" allowfullscreen></iframe>'
  assert.deepEqual(embedSourcesIn(youtube), ['https://www.youtube.com/embed/abc123?si=x&start=5'])
  // Two frames, two embeds; a frame pointing anywhere but the web, none.
  assert.equal(embedSourcesIn(youtube + youtube).length, 2)
  assert.deepEqual(embedSourcesIn('<iframe src="javascript:alert(1)"></iframe>'), [])
  assert.deepEqual(embedSourcesIn("<iframe src='//player.vimeo.com/video/42'></iframe>"), ['https://player.vimeo.com/video/42'])
  // Plain text: every link in it, as before.
  assert.deepEqual(embedSourcesIn('see https://a.example/x and b.example'), linksIn('see https://a.example/x and b.example'))
  assert.deepEqual(linksIn('see https://a.example/x and b.example'), ['https://a.example/x', 'https://b.example'])
})
