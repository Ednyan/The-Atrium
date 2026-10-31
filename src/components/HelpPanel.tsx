// Help: the articles (docs/help) searched and read, in the page. They come with
// the app, in this panel's own chunk, so opening it and searching ask nothing
// of the server, and it works offline. Reporting a problem or suggesting what's
// not found is here too: the report form, with what was searched for as its subject.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { articleOfLink, helpTree, parseArticle, parseInline, searchHelp, type HelpArticle, type HelpBlock } from '../lib/help'
import { ReportFeedbackModal } from './ReportFeedbackModal'

const FILES = import.meta.glob('../../docs/help/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const PICTURES = import.meta.glob('../../docs/help/images/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const ARTICLES = Object.values(FILES).flatMap(raw => parseArticle(raw) ?? [])
const TREE = helpTree(ARTICLES)
const pictureOf = (src: string) => PICTURES[`../../docs/help/images/${src.split('/').pop()}`]

function Inline({ text, onOpen }: { text: string; onOpen: (id: string) => void }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.kind === 'bold') return <strong key={i} className="text-nier-strong font-semibold">{part.text}</strong>
        if (part.kind === 'code') return <code key={i} className="px-1 border border-nier-border/30">{part.text}</code>
        if (part.kind === 'text') return <Fragment key={i}>{part.text}</Fragment>
        const id = articleOfLink(part.href)
        // An article not written yet is named, not linked.
        if (id) {
          return ARTICLES.some(a => a.id === id)
            ? <button key={i} type="button" data-help-link={id} onClick={() => onOpen(id)} className="underline underline-offset-2 text-nier-strong hover:opacity-70">{part.text}</button>
            : <strong key={i} className="font-semibold">{part.text}</strong>
        }
        return <a key={i} href={part.href} target="_blank" rel="noreferrer" className="underline underline-offset-2 text-nier-strong">{part.text}</a>
      })}
    </>
  )
}

function Block({ block, onOpen }: { block: HelpBlock; onOpen: (id: string) => void }) {
  const inline = (text: string) => <Inline text={text} onOpen={onOpen} />
  switch (block.kind) {
    case 'h2': return <h3 className="mt-8 mb-3 text-nier-strong text-sm font-semibold">{inline(block.text)}</h3>
    case 'h3': return <h4 className="mt-5 mb-2 text-nier-strong text-xs font-semibold">{inline(block.text)}</h4>
    case 'p': return <p className="my-3">{inline(block.text)}</p>
    case 'list':
      return <ul className="my-3 ml-4 list-disc space-y-1.5">{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>
    case 'table':
      return (
        <div className="my-4 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>{block.head.map((cell, i) => <th key={i} className="border border-nier-border/30 px-3 py-2 font-semibold text-nier-strong">{inline(cell)}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => <tr key={r}>{row.map((cell, i) => <td key={i} className="border border-nier-border/30 px-3 py-2 align-top">{inline(cell)}</td>)}</tr>)}
            </tbody>
          </table>
        </div>
      )
    case 'image': {
      const src = pictureOf(block.src)
      return src ? <img src={src} alt={block.alt} loading="lazy" className="my-4 max-w-full border border-nier-border/30" /> : null
    }
  }
}

export default function HelpPanel({ onClose, username, atriumName }: { onClose: () => void; username?: string; atriumName?: string }) {
  const { t, language } = useTranslation()
  const [query, setQuery] = useState('')
  // The article being read; none, the search's results or the first one's place.
  const [reading, setReading] = useState<HelpArticle | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const results = useMemo(() => searchHelp(ARTICLES, query), [query])
  const searching = !reading && query.trim().length > 0

  useEffect(() => { inputRef.current?.focus() }, [])
  // Esc: out of the suggestion first, then closed. Before the atrium hears it,
  // which would drop the selection behind.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (suggesting) setSuggesting(false)
      else onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose, suggesting])
  const open = (id: string) => {
    const article = ARTICLES.find(a => a.id === id)
    if (!article) return
    setReading(article)
    pageRef.current?.scrollTo(0, 0)
  }

  return (
    <div
      data-help-panel=""
      data-ui-element="true"
      data-hud="true"
      className="fixed inset-0 bg-nier-black/70 flex items-center justify-center z-[10000100] pointer-events-auto font-mono"
      onClick={onClose}
      onWheel={e => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-label={t('help.title')}
        className="panel-in flex flex-col w-full max-w-5xl h-[85vh] mx-4 border border-nier-border/40 text-nier-bg"
        style={{ backgroundColor: 'rgb(var(--c-ground))' }}
        onClick={e => e.stopPropagation()}
      >
        <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-nier-border/25">
          <h2 className="text-nier-strong text-[11px] tracking-[0.2em] uppercase">{t('help.title')}</h2>
          <input
            ref={inputRef}
            data-help-search=""
            type="search"
            value={query}
            onChange={e => { setQuery(e.target.value); setReading(null) }}
            placeholder={t('help.search')}
            className="flex-1 min-w-0 bg-transparent border border-nier-border/40 px-3 py-1.5 text-xs text-nier-strong focus:border-nier-bg focus:outline-none"
          />
          <button type="button" data-help-close="" onClick={onClose} aria-label={t('common.close')} className="w-8 h-8 flex items-center justify-center border border-nier-border/40 hover:border-nier-bg transition-colors">×</button>
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* The tree: what's written, by section and topic. Not on a phone while reading. */}
          <nav data-help-tree="" aria-label={t('help.title')} className={`${reading || searching ? 'hidden sm:block' : 'block'} shrink-0 w-full sm:w-56 overflow-y-auto border-r border-nier-border/25 p-4 text-xs`}>
            {TREE.map(({ section, topics }) => (
              <div key={section} className="mb-5">
                <p className="mb-2 text-nier-strong text-[10px] tracking-[0.15em] uppercase">{section}</p>
                {topics.map(({ topic, articles }) => (
                  <div key={topic ?? ''} className="mb-2">
                    {topic && <p className="mb-1 text-nier-bg/55">{topic}</p>}
                    {articles.map(article => (
                      <button
                        key={article.id}
                        type="button"
                        data-help-article={article.id}
                        aria-current={reading?.id === article.id ? 'page' : undefined}
                        onClick={() => open(article.id)}
                        className={`block w-full text-left py-1 pl-2 border-l transition-colors ${reading?.id === article.id ? 'border-nier-bg text-nier-strong' : 'border-transparent hover:text-nier-strong'}`}
                      >
                        {article.title}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </nav>

          <div ref={pageRef} data-help-page="" className={`${reading || searching ? 'block' : 'hidden sm:block'} flex-1 min-w-0 overflow-y-auto p-5 sm:p-7 text-xs leading-relaxed`}>
            {language !== 'en' && <p data-help-english="" className="mb-4 text-nier-bg/60">{t('help.englishOnly')}</p>}
            {reading ? (
              <article data-help-reading={reading.id} className="max-w-2xl">
                <button type="button" data-help-back="" onClick={() => setReading(null)} className="mb-5 sm:hidden text-[11px] tracking-[0.15em] uppercase text-nier-bg/70">← {t('help.title')}</button>
                <h1 className="text-nier-strong text-xl font-light tracking-[0.04em] mb-3">{reading.title}</h1>
                {reading.blocks.map((block, i) => <Block key={i} block={block} onOpen={open} />)}
              </article>
            ) : searching ? (
              <ul data-help-results="" className="max-w-2xl space-y-1">
                {results.map(({ article, snippet }) => (
                  <li key={article.id}>
                    <button type="button" data-help-result={article.id} onClick={() => open(article.id)} className="block w-full text-left p-3 border border-transparent hover:border-nier-border/40 transition-colors">
                      <span className="block text-nier-strong text-sm">{article.title}</span>
                      <span className="block mt-1 text-nier-bg/60">{article.section}{article.topic ? ` · ${article.topic}` : ''}</span>
                      <span className="block mt-1 text-nier-bg/80">{snippet}</span>
                    </button>
                  </li>
                ))}
                {results.length === 0 && <li data-help-none="" className="p-3 text-nier-bg/75">{t('help.none', { query: query.trim() })}</li>}
              </ul>
            ) : (
              <p className="max-w-2xl text-nier-bg/70">{t('help.lead')}</p>
            )}
          </div>
        </div>

        <footer className="shrink-0 flex flex-wrap items-center justify-end gap-3 px-4 py-2.5 border-t border-nier-border/25 text-xs">
          <span className="text-nier-bg/70">{t('help.notFound')}</span>
          <button type="button" data-help-suggest="" onClick={() => setSuggesting(true)} className="px-3 py-1.5 border border-nier-border/40 text-nier-strong text-[11px] tracking-[0.15em] uppercase hover:border-nier-bg transition-colors">
            {t('browser.reportProblem')}
          </button>
        </footer>
      </div>

      {suggesting && (
        <div onClick={e => e.stopPropagation()}>
          <ReportFeedbackModal onClose={() => setSuggesting(false)} username={username} atriumName={atriumName} initialMotive={query.trim() ? 'feature' : 'bug'} initialSubject={query.trim()} />
        </div>
      )}
    </div>
  )
}
