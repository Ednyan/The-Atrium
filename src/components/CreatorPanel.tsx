// The Creator, as a panel.
//
// The desktop app can reach the landing page, but nobody goes looking for a
// marketing page inside an app they have already installed -- so the one
// section of it that is actually about a person rather than about the product
// travels to the welcome screen instead, behind the byline in the corner.
//
// Same words as the landing page's Creator section, from the same keys, so
// there is one story and not two that drift.

import { useEffect } from 'react'
import { useTranslation } from '../lib/i18n'
import ConnectTiles from './ConnectTiles'
import { DONATE_CUT } from './DonateButton'

export default function CreatorPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="modal-backdrop fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000400] p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div className="flex flex-col items-center gap-5 w-full max-w-lg">
        <div
          className="support-card modal-in bg-nier-blackLight border p-6 w-full relative max-h-[85vh] overflow-y-auto"
          onClick={event => event.stopPropagation()}
        >
          <div className="corner absolute top-0 left-0 w-4 h-4 border-l border-t" />
          <div className="corner absolute top-0 right-0 w-4 h-4 border-r border-t" />
          <div className="corner absolute bottom-0 left-0 w-4 h-4 border-l border-b" />
          <div className="corner absolute bottom-0 right-0 w-4 h-4 border-r border-b" />

          <div className="flex items-center gap-3 mb-5">
            <div className="byline-mark w-2 h-2 rotate-45" />
            <h3 className="support-orange tracking-[0.15em] uppercase">
              {t('landing.nav.creator')}
            </h3>
            <div className="support-rule flex-1 h-px" />
          </div>

          <p className="text-nier-strong text-lg sm:text-xl tracking-[0.12em] uppercase leading-none mb-5">
            Eduardo Paranhos
          </p>

          <div className="border-l-2 pl-5 py-1 space-y-4 mb-8"
               style={{ borderColor: 'rgb(var(--c-orange) / 0.45)' }}>
            <p className="text-nier-bg/85 text-sm tracking-wide leading-relaxed italic">
              {t('landing.creator.p1')}
            </p>
            <p className="text-nier-bg/75 text-sm tracking-wide leading-relaxed italic">
              {t('landing.creator.p2')}
            </p>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <span className="support-orange text-[11px] tracking-[0.22em] uppercase whitespace-nowrap">
              {t('support.connect')}
            </span>
            <div className="support-rule flex-1 h-px" />
          </div>

          <ConnectTiles />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="px-10 py-2.5 border border-nier-border/40 text-nier-bg/80 text-xs tracking-[0.18em] uppercase hover:border-nier-border/70 hover:text-nier-strong transition-colors"
          style={{ clipPath: DONATE_CUT, backgroundColor: 'rgb(var(--c-ground) / 0.6)' }}
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}
