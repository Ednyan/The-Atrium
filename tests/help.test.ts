// The help articles: read from their files, searched, and every one sound.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { articleOfLink, helpTree, parseArticle, parseInline, searchHelp, type HelpArticle } from '../src/lib/help.ts'

const doc = (front: string, body = '') => `---\n${front}\n---\n\n${body}`
const article = (id: string, title: string, extra = '', body = '') =>
  parseArticle(doc(`id: ${id}\ntitle: ${title}\nsection: 4.2 Arranging > Organizing\n${extra}`, body))!

test('front matter gives what an article is, and where it goes', () => {
  const a = parseArticle(doc('id: frames\ntitle: Frames\nsection: 4.2 Arranging > Organizing\nsummary: A box: it holds traces.\nkeywords: frame, box\nrelated: groups, selecting'))!
  assert.equal(a.id, 'frames')
  assert.equal(a.summary, 'A box: it holds traces.')
  assert.deepEqual(a.keywords, ['frame', 'box'])
  assert.deepEqual(a.related, ['groups', 'selecting'])
  assert.deepEqual([a.section, a.topic, a.order], ['Arranging', 'Organizing', '4.2'])
  const flat = parseArticle(doc('id: x\ntitle: X\nsection: 2 Moving around'))!
  assert.deepEqual([flat.section, flat.topic, flat.order], ['Moving around', null, '2'])
})

test('a file without a title, an id or front matter is no article', () => {
  assert.equal(parseArticle('# Just text'), null)
  assert.equal(parseArticle(doc('title: X')), null)
})

test('Windows line ends read the same', () => {
  const a = parseArticle(doc('id: x\ntitle: X', 'One\nline\n\n- item').replace(/\n/g, '\r\n'))!
  assert.deepEqual(a.blocks, [{ kind: 'p', text: 'One line' }, { kind: 'list', items: ['item'] }])
})

test('the body becomes headings, paragraphs, lists, tables and pictures', () => {
  const a = article('x', 'X', '', [
    '# X', '', 'First line', 'goes on.', '', '## Make one', '', '### Small', '',
    '- One', '  goes on', '- Two', '',
    '| You want | Do this |', '|---|---|', '| A | **8** |', '| B | Click |', '',
    '![A picture](../images/x.png)', '', 'After.',
  ].join('\n'))
  assert.deepEqual(a.blocks, [
    { kind: 'p', text: 'First line goes on.' },
    { kind: 'h2', text: 'Make one' },
    { kind: 'h3', text: 'Small' },
    { kind: 'list', items: ['One goes on', 'Two'] },
    { kind: 'table', head: ['You want', 'Do this'], rows: [['A', '**8**'], ['B', 'Click']] },
    { kind: 'image', alt: 'A picture', src: '../images/x.png' },
    { kind: 'p', text: 'After.' },
  ])
})

test('inline marks: bold, code, links', () => {
  assert.deepEqual(parseInline('Press **8**, see `x` or [Groups](groups.md): done'), [
    { kind: 'text', text: 'Press ' }, { kind: 'bold', text: '8' }, { kind: 'text', text: ', see ' },
    { kind: 'code', text: 'x' }, { kind: 'text', text: ' or ' }, { kind: 'link', text: 'Groups', href: 'groups.md' },
    { kind: 'text', text: ': done' },
  ])
  assert.equal(articleOfLink('../making-it-look-right/customization-panel.md'), 'customization-panel')
  assert.equal(articleOfLink('https://example.com/a.md'), null)
})

test('search: every word must be there, the title counts most', () => {
  const frames = article('frames', 'Frames', 'keywords: artboard', 'Hold traces together.')
  const groups = article('groups', 'Groups', '', 'Unlike a frame, a group has no box.')
  const all = [groups, frames]
  assert.deepEqual(searchHelp(all, 'frame').map(r => r.article.id), ['frames', 'groups'])
  assert.deepEqual(searchHelp(all, 'FRAMES').map(r => r.article.id), ['frames', 'groups'])
  assert.deepEqual(searchHelp(all, 'artboard').map(r => r.article.id), ['frames'])
  assert.deepEqual(searchHelp(all, 'frame box').map(r => r.article.id), ['groups'])
  assert.deepEqual(searchHelp(all, 'spaceship'), [])
  assert.deepEqual(searchHelp(all, '   '), [])
})

test('search: the snippet shows the word in its place', () => {
  const a = article('x', 'X', '', `${'word '.repeat(30)}the needle is here`)
  assert.match(searchHelp([a], 'needle')[0].snippet, /^….*needle is here/)
})

test('the tree keeps the sections in their order', () => {
  const at = (id: string, section: string) => parseArticle(doc(`id: ${id}\ntitle: ${id}\nsection: ${section}`))!
  const tree = helpTree([at('c', '10 Last'), at('b', '4.2 Arranging > Organizing'), at('a', '4.1 Arranging > Selecting'), at('z', '2 Moving')])
  assert.deepEqual(tree.map(s => s.section), ['Moving', 'Arranging', 'Last'])
  assert.deepEqual(tree[1].topics.map(t => t.topic), ['Selecting', 'Organizing'])
})

// The real files: each reads, its id is its file's, and what it points at is there.
const ROOT = resolve('docs/help')
const files = readdirSync(ROOT).filter(name => statSync(join(ROOT, name)).isDirectory() && name !== 'images')
  .flatMap(folder => readdirSync(join(ROOT, folder)).filter(name => name.endsWith('.md')).map(name => join(ROOT, folder, name)))

test('every article is sound: id, summary, keywords, section, its pictures', () => {
  assert.ok(files.length > 0)
  for (const file of files) {
    const a = parseArticle(readFileSync(file, 'utf8')) as HelpArticle
    assert.ok(a, `${file} doesn't read`)
    assert.equal(a.id, file.replace(/\\/g, '/').split('/').pop()!.replace('.md', ''), file)
    assert.ok(a.summary && a.keywords.length && a.order !== '99', `${a.id} lacks its summary, keywords or section`)
    for (const block of a.blocks) {
      if (block.kind === 'image') assert.ok(existsSync(resolve(dirname(file), block.src)), `${a.id}: no picture ${block.src}`)
    }
  }
})
