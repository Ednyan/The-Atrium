// The Creator, as a panel from the side: his portrait, his story, and the
// ways to reach him.
//
// Opened from the landing page's signature (landing/CreatorSignature) and the
// welcome screen's byline -- the desktop app can reach the landing page, but
// nobody goes looking for a marketing page inside an app they have already
// installed. One panel and one story for both, so there aren't two that drift.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../lib/i18n'
import ConnectTiles from './ConnectTiles'

export const CREATOR_NAME = 'Eduardo Paranhos'

export default function CreatorPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      // Tab stays in the panel while it's open.
      if (e.key !== 'Tab' || !panel.current) return
      const stops = [...panel.current.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])')]
      if (!stops.length) return
      const first = stops[0], last = stops[stops.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // On the landing page, inside its own element, which carries the theme's
  // colours; elsewhere, over everything.
  const host = document.querySelector('[data-landing-theme]') ?? document.body
  return createPortal(
    <div className="fixed inset-0 z-[10000400] flex justify-end" data-lenis-prevent>
      <button type="button" aria-label={t('common.close')} onClick={onClose} className="creator-backdrop absolute inset-0 cursor-default" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="creator-panel-title"
        tabIndex={-1}
        className="creator-panel relative h-full w-full max-w-[30rem] overflow-y-auto outline-none border-l border-nier-border/30 px-7 sm:px-10 py-10 font-mono"
      >
        <button type="button" onClick={onClose} aria-label={t('common.close')} className="absolute top-5 right-5 w-9 h-9 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/80">×</button>
        <div className="relative max-w-[16rem] mb-8 overflow-hidden border border-nier-border/30">
          <img src="/landing/creator.webp" srcSet="/landing/creator-480.webp 480w, /landing/creator.webp 900w" sizes="16rem" width={900} height={900} alt={t('landing.creator.alt')} className="block w-full h-auto" />
        </div>
        <p className="text-[11px] tracking-[0.3em] uppercase text-nier-bg/60">{t('landing.creator.title')}</p>
        <h2 id="creator-panel-title" translate="no" className="mt-2 text-3xl font-extralight tracking-[0.04em] text-nier-strong">{CREATOR_NAME}</h2>
        <p className="mt-6 text-nier-bg/85 leading-relaxed text-pretty">{t('landing.creator.p1')}</p>
        <p className="mt-4 text-nier-bg/75 leading-relaxed text-pretty">{t('landing.creator.p2')}</p>
        <h3 className="mt-10 mb-4 text-xs tracking-[0.2em] uppercase text-nier-bg/70">{t('landing.connect')}</h3>
        <ConnectTiles columns={2} />
      </div>
    </div>,
    host,
  )
}
