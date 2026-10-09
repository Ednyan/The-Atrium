// What a deck's document trace shows: the slide it's on (`page`, from 1),
// drawn by lib/deckDraw from its file (lib/deck). Says how many slides there
// are (`onCount`), for the page arrows a PDF has too.

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { deckFile, deckSvg, pictureSrc, slidePictures } from '../lib/deckDraw'
import type { DeckData } from '../lib/deck'

export default function DeckSlide({ url, page, onCount }: { url: string; page: number; onCount: (count: number) => void }) {
  const { t } = useTranslation()
  // Undefined while it's read; null when it can't be.
  const [deck, setDeck] = useState<DeckData | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    const load = () => void deckFile(url).then(d => { if (live) setDeck(d) })
    load()
    // Written again (a file it follows saved again: lib/liveFiles), or still
    // being written when it was first read.
    const written = (e: Event) => { if ((e as CustomEvent).detail?.localUrl === url) load() }
    window.addEventListener('atrium:vault-write-complete', written)
    return () => { live = false; window.removeEventListener('atrium:vault-write-complete', written) }
  }, [url])
  useEffect(() => { if (deck) onCount(deck.slides.length) }, [deck]) // eslint-disable-line react-hooks/exhaustive-deps

  // The slide's pictures, as they come.
  const [srcs, setSrcs] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!deck) return
    let live = true
    for (const src of slidePictures(deck, page - 1)) {
      if (srcs[src]) continue
      void pictureSrc(src).then(found => { if (live && found) setSrcs(prev => ({ ...prev, [src]: found })) })
    }
    return () => { live = false }
  }, [deck, page]) // eslint-disable-line react-hooks/exhaustive-deps

  const markup = useMemo(() => (deck ? deckSvg(deck, page - 1, src => srcs[src]) : ''), [deck, page, srcs])
  if (!deck) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-black/40 text-[10px] tracking-wider uppercase">
          {deck === null ? t('atrium.sheet.unreadable') : t('atrium.controls.rendering')}
        </span>
      </div>
    )
  }
  return <div data-deck-slide={page} className="absolute inset-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:block pointer-events-none select-none" dangerouslySetInnerHTML={{ __html: markup }} />
}
