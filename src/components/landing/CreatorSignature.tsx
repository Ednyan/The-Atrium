// Who made it: a signature at the foot of the first screen -- the creator's
// face and name -- opening his panel (components/CreatorPanel). Not a chapter
// of its own: the page tells the Atrium's story, and this is there for
// whoever wants the person behind it.

import { useRef, useState } from 'react'
import { useTranslation } from '../../lib/i18n'
import CreatorPanel, { CREATOR_NAME } from '../CreatorPanel'

export default function CreatorSignature({ className = '' }: { className?: string }) {
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
        className={`creator-signature group flex items-center gap-3 text-left ${className}`}
      >
        <img src="/landing/creator-480.webp" alt="" width={36} height={36} className="w-9 h-9 rounded-full object-cover grayscale group-hover:grayscale-0 transition-[filter] duration-500 border border-nier-border/40" />
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] tracking-[0.25em] uppercase text-nier-bg/60">{t('landing.signature')}</span>
          <span translate="no" className="text-sm tracking-[0.08em] text-nier-strong">{CREATOR_NAME}</span>
        </span>
        <span aria-hidden="true" className="text-nier-bg/60 transition-transform duration-300 group-hover:translate-x-1">→</span>
      </button>
      {open && <CreatorPanel onClose={() => { setOpen(false); opener.current?.focus() }} />}
    </>
  )
}
