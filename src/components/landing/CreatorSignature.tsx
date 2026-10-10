// Who made it: the creator's face and name, held in the corner the whole way
// down the page, opening his panel (components/CreatorPanel). Bare on the
// first screen where there's room; on a glass of its own everywhere else, to
// stay readable over whatever passes under it (LandingPage's styles). Not a
// chapter of its own: the page tells the Atrium's story, and this is there
// for whoever wants the person behind it.

import { useRef, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import CreatorPanel, { CREATOR_NAME } from '../CreatorPanel'

export default function CreatorSignature({ bare }: { bare: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={opener}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-bare={bare ? '' : undefined}
        className="creator-signature group fixed z-40 left-3 bottom-3 sm:left-6 sm:bottom-6 flex items-center text-left"
      >
        <img src="/landing/creator-96.webp" alt="" width={36} height={36} className="w-9 h-9 shrink-0 rounded-full object-cover grayscale group-hover:grayscale-0 group-focus-visible:grayscale-0 transition-[filter] duration-500 border border-nier-border/40" />
        <span className="flex items-center gap-3 whitespace-nowrap">
          <span className="flex flex-col leading-tight">
            <span className="text-[10px] tracking-[0.25em] uppercase text-nier-bg/60">{t('landing.signature')}</span>
            <span translate="no" className="text-sm tracking-[0.08em] text-nier-strong">{CREATOR_NAME}</span>
          </span>
          <span aria-hidden="true" className="text-nier-bg/60 transition-transform duration-300 group-hover:translate-x-1">→</span>
        </span>
      </button>
      {open && <CreatorPanel onClose={() => { setOpen(false); opener.current?.focus() }} />}
    </>
  )
}
