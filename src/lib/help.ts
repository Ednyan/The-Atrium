// The help articles (docs/help/<section>/<id>.md, docs/help/README.md says how
// they're written): read from their text, searched here in the page, so the
// search asks nothing of anyone and works offline. No Markdown library: articles
// use this little of it, and it's all tested (tests/help.test.ts).

export type HelpInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }

export type HelpBlock =
  | { kind: 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'image'; alt: string; src: string }

export interface HelpArticle {
  id: string
  title: string
  summary: string
  keywords: string[]
  related: string[]
  // Its place in the tree: 'Arranging', 'Organizing'; and what orders it ('4.2').
  section: string
  topic: string | null
  order: string
  blocks: HelpBlock[]
}

const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)$/

function blocksOf(body: string): HelpBlock[] {
  const blocks: HelpBlock[] = []
  let paragraph: string[] = []
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ kind: 'p', text: paragraph.join(' ') })
    paragraph = []
  }
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
  const lines = body.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const last = blocks[blocks.length - 1]
    if (!line.trim()) { endParagraph(); continue }
    // A list item's next line, indented.
    if (/^\s+\S/.test(line) && !paragraph.length && last?.kind === 'list') {
      last.items[last.items.length - 1] += ' ' + line.trim()
      continue
    }
    if (line.startsWith('# ')) { endParagraph(); continue } // The title, which the front matter gives.
    if (line.startsWith('## ')) { endParagraph(); blocks.push({ kind: 'h2', text: line.slice(3).trim() }); continue }
    if (line.startsWith('### ')) { endParagraph(); blocks.push({ kind: 'h3', text: line.slice(4).trim() }); continue }
    const image = IMAGE.exec(line.trim())
    if (image) { endParagraph(); blocks.push({ kind: 'image', alt: image[1], src: image[2] }); continue }
    if (line.startsWith('- ')) {
      endParagraph()
      if (last?.kind === 'list') last.items.push(line.slice(2).trim())
      else blocks.push({ kind: 'list', items: [line.slice(2).trim()] })
      continue
    }
    if (line.startsWith('|')) {
      endParagraph()
      const rows: string[][] = []
      for (; i < lines.length && lines[i].startsWith('|'); i++) {
        if (!/^\|[\s:|-]+\|?\s*$/.test(lines[i])) rows.push(cells(lines[i]))
      }
      i--
      blocks.push({ kind: 'table', head: rows[0] ?? [], rows: rows.slice(1) })
      continue
    }
    paragraph.push(line.trim())
  }
  endParagraph()
  return blocks
}

/** An article from its file's text. Null without a title and an id: a file
 *  half written doesn't show. */
export function parseArticle(raw: string): HelpArticle | null {
  const text = raw.replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) return null
  const front = new Map<string, string>()
  for (const line of match[1].split('\n')) {
    const at = line.indexOf(':')
    if (at > 0) front.set(line.slice(0, at).trim(), line.slice(at + 1).trim())
  }
  const list = (key: string) => (front.get(key) ?? '').split(',').map(word => word.trim()).filter(Boolean)
  const id = front.get('id'), title = front.get('title')
  if (!id || !title) return null
  // '4.2 Arranging > Organizing'
  const place = /^([\d.]+)\s+(.*)$/.exec(front.get('section') ?? '')
  const [section, topic] = (place?.[2] ?? 'Other').split('>').map(part => part.trim())
  return {
    id, title,
    summary: front.get('summary') ?? '',
    keywords: list('keywords'),
    related: list('related'),
    section, topic: topic ?? null, order: place?.[1] ?? '99',
    blocks: blocksOf(match[2]),
  }
}

/** A run of text, with its bold, code and links. */
export function parseInline(text: string): HelpInline[] {
  const parts: HelpInline[] = []
  const marks = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  let at = 0
  for (let m = marks.exec(text); m; m = marks.exec(text)) {
    if (m.index > at) parts.push({ kind: 'text', text: text.slice(at, m.index) })
    if (m[1] !== undefined) parts.push({ kind: 'bold', text: m[1] })
    else if (m[2] !== undefined) parts.push({ kind: 'code', text: m[2] })
    else parts.push({ kind: 'link', text: m[3], href: m[4] })
    at = marks.lastIndex
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) })
  return parts
}

/** The article a link points to, by its file's name; null for one outside the help. */
export const articleOfLink = (href: string): string | null => /^(?!https?:)(?:.*\/)?([\w-]+)\.md$/.exec(href)?.[1] ?? null

const plain = (text: string) => parseInline(text).map(part => part.text).join('')
const bodyText = (article: HelpArticle) => article.blocks.flatMap(block => {
  if (block.kind === 'list') return block.items.map(plain)
  if (block.kind === 'table') return [...block.head, ...block.rows.flat()].map(plain)
  if (block.kind === 'image') return [block.alt]
  return [plain(block.text)]
}).join(' ')

// Accents and case don't matter, nor a plural's s.
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const wordsOf = (query: string) => fold(query).split(/\s+/).filter(Boolean).map(word => (word.length > 3 ? word.replace(/s$/, '') : word))

export interface HelpResult { article: HelpArticle; snippet: string }

/** The articles holding every word asked for, the likeliest first: in its title,
 *  then what it's about, then its headings, then anywhere. */
export function searchHelp(articles: HelpArticle[], query: string): HelpResult[] {
  const words = wordsOf(query)
  if (!words.length) return []
  const scored = articles.flatMap(article => {
    const title = fold(article.title), keywords = fold(article.keywords.join(' ')), summary = fold(article.summary)
    const headings = fold(article.blocks.flatMap(block => (block.kind === 'h2' || block.kind === 'h3' ? [block.text] : [])).join(' '))
    const whole = bodyText(article)
    const body = fold(whole)
    let score = 0
    for (const word of words) {
      const here = (title.includes(word) ? 10 : 0) + (keywords.includes(word) ? 6 : 0) + (summary.includes(word) ? 3 : 0) + (headings.includes(word) ? 3 : 0) + (body.includes(word) ? 1 : 0)
      if (!here) return []
      score += here
    }
    // Around the first word found in the text, else what the article is.
    // (Folding keeps most text's length; if not, the snippet is only a little off.)
    const at = body.indexOf(words[0])
    const snippet = at < 0 ? article.summary : `${at > 40 ? '…' : ''}${whole.slice(Math.max(0, at - 40), at + 120).trim()}…`
    return [{ score, result: { article, snippet } }]
  })
  return scored.sort((a, b) => b.score - a.score || a.result.article.title.localeCompare(b.result.article.title)).map(entry => entry.result)
}

/** The tree: sections in their order, each with its topics and articles. */
export function helpTree(articles: HelpArticle[]): { section: string; topics: { topic: string | null; articles: HelpArticle[] }[] }[] {
  const number = (order: string) => order.split('.').map(Number)
  const sorted = [...articles].sort((a, b) => {
    const [a1, a2 = 0] = number(a.order), [b1, b2 = 0] = number(b.order)
    return a1 - b1 || a2 - b2 || a.title.localeCompare(b.title)
  })
  const tree: { section: string; topics: { topic: string | null; articles: HelpArticle[] }[] }[] = []
  for (const article of sorted) {
    let section = tree.find(entry => entry.section === article.section)
    if (!section) tree.push(section = { section: article.section, topics: [] })
    let topic = section.topics.find(entry => entry.topic === article.topic)
    if (!topic) section.topics.push(topic = { topic: article.topic, articles: [] })
    topic.articles.push(article)
  }
  return tree
}
