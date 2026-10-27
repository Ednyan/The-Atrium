// What a deck's document trace shows: the slide it's on (`page`, from 1),
// drawn by lib/deckDraw from its file (lib/deck). Says how many slides there
// are (`onCount`), for the page arrows a PDF has too.
//
// A slide is shown once its pictures are in -- the one before stays until
// then, HOLD_MS at most -- and the slides either side have theirs fetched
// meanwhile, so paging through quickly goes from whole slide to whole slide.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { deckFile, deckSvg, pictureSrc, slidePictures } from '../lib/deckDraw'
import type { DeckData } from '../lib/deck'

const HOLD_MS = 1000

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

  // The slide's pictures, as they come -- undefined for one that can't be had.
  const [srcs, setSrcs] = useState<Record<string, string | undefined>>({})
  const pictures = useMemo(() => (deck ? slidePictures(deck, page - 1) : []), [deck, page])
  useEffect(() => {
    if (!deck) return
    let live = true
    for (const src of pictures) {
      if (src in srcs) continue
      void pictureSrc(src).then(found => { if (live) setSrcs(prev => ({ ...prev, [src]: found })) })
    }
    for (const near of [page, page - 2]) for (const src of slidePictures(deck, near)) void pictureSrc(src)
    return () => { live = false }
  }, [deck, pictures]) // eslint-disable-line react-hooks/exhaustive-deps

  // A picture slow to come doesn't keep the slide before up for long.
  const [late, setLate] = useState<number | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => setLate(page), HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [deck, page])
  const ready = late === page || pictures.every(src => src in srcs)
  const markup = useMemo(() => (deck && ready ? deckSvg(deck, page - 1, src => srcs[src]) : null), [deck, page, srcs, ready]) // eslint-disable-line react-hooks/exhaustive-deps
  const held = useRef('')
  if (markup !== null) held.current = markup
  if (!deck || !held.current) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-black/40 text-[10px] tracking-wider uppercase">
          {deck === null ? t('atrium.sheet.unreadable') : t('atrium.controls.rendering')}
        </span>
      </div>
    )
  }
  return <div data-deck-slide={page} className="absolute inset-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:block pointer-events-none select-none" dangerouslySetInnerHTML={{ __html: held.current }} />
}
