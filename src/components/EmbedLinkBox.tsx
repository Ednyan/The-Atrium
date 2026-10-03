// Where an embed's link is asked for: a small box at the spot it will go, as
// Excalidraw asks for an embed's. One link, or many pasted at once -- every
// link in what's written is found, and placed in the arrangement the person
// has chosen for batches (LobbyScene's handleCreateBatchEmbeds). Enter
// places them; Esc, or a press anywhere else, lets it go.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'

// Every web link in `text`: http(s) ones as they're written, and a bare
// address (example.com/page) given its https. In the order they appear.
export function linksIn(text: string): string[] {
  const found: string[] = []
  for (const word of text.split(/\s+/)) {
    const candidate = /^https?:\/\//i.test(word) ? word : /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(word) ? `https://${word}` : null
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'http:' || url.protocol === 'https:') found.push(candidate)
    } catch { /* not a link */ }
  }
  return found
}

export default function EmbedLinkBox({ at, onEmbed, onCancel }: {
  // Where on the screen it opens: the point the embed will be centred on.
  at: { x: number; y: number }
  onEmbed: (urls: string[]) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const links = linksIn(text)

  useEffect(() => {
    const press = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) onCancel() }
    window.addEventListener('pointerdown', press, true)
    return () => window.removeEventListener('pointerdown', press, true)
  }, [onCancel])

  // Kept on the screen: its width, and a line or so of height, inside the edges.
  const left = Math.max(16, Math.min(at.x - 170, window.innerWidth - 356))
  const top = Math.max(16, Math.min(at.y + 12, window.innerHeight - 140))

  return (
    <div
      ref={rootRef}
      data-ui-element="true"
      data-embed-box=""
      className="panel-in fixed z-[10000100] w-[340px] flex items-start gap-2 p-2 border border-nier-border/50 font-mono pointer-events-auto shadow-[0_10px_28px_rgba(0,0,0,0.55)]"
      style={{ left, top, backgroundColor: 'rgb(var(--c-ground) / 0.97)' }}
    >
      <textarea
        autoFocus
        rows={Math.min(5, Math.max(1, text.split('\n').length))}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Escape') onCancel()
          else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (links.length > 0) onEmbed(links)
          }
        }}
        placeholder={t('atrium.embed.placeholder')}
        aria-label={t('atrium.embed.placeholder')}
        className="flex-1 min-w-0 resize-none bg-transparent outline-none text-[12px] leading-5 py-1 px-1 text-sky-400 placeholder:text-nier-bg/45"
      />
      <div className="flex flex-col items-end gap-1 shrink-0">
        <button
          type="button"
          data-embed-place=""
          disabled={links.length === 0}
          onClick={() => onEmbed(links)}
          className="h-7 px-3 text-[10px] tracking-[0.15em] uppercase border border-nier-bg/70 text-nier-strong hover:bg-nier-bg hover:text-nier-black transition-colors disabled:opacity-35 disabled:pointer-events-none"
        >
          {t('atrium.embed.place')}
        </button>
        {links.length > 1 && (
          <span className="text-[10px] tracking-wider text-nier-bg/60 tabular-nums">{t('atrium.embed.count', { count: links.length })}</span>
        )}
      </div>
    </div>
  )
}
