// Share, from the atrium's own menu: a link that brings people straight into
// it, and its ID -- each with a copy button -- as Excalidraw's share dialog
// offers a link. On the web anyone who opens the link comes here, through the
// same door as from the browser: asked for the password if there is one, kept
// out if they aren't allowed in. A desktop atrium lives on this computer and
// no link can reach it, so it offers to save it as an .atrium file instead.

import { useEffect, useRef } from 'react'
import { useTranslation } from '../lib/i18n'
import { isDesktop } from '../lib/supabase'
import { copyText } from '../lib/clipboard'

export const atriumLink = (id: string) => `${window.location.origin}/atrium/${id}`

const BUTTON = 'atrium-btn whitespace-nowrap'
const FIELD = 'flex-1 min-w-0 bg-nier-black text-nier-bg border border-nier-border/30 px-2 py-1.5 font-mono text-[11px] tracking-wide focus:outline-none focus:border-nier-border/60'

export default function SharePanel({ atriumId, onSaveFile, onClose }: {
  atriumId: string
  // Save as .atrium (Export, on the .atrium file), for a desktop atrium.
  onSaveFile: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  // Away by a press outside it, or Esc.
  useEffect(() => {
    // Its own button (data-share-toggle) closes it by its click.
    const press = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!ref.current?.contains(target) && !target?.closest?.('[data-share-toggle]')) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', press, true); window.removeEventListener('keydown', key) }
  }, [onClose])
  const link = atriumLink(atriumId)

  return (
    <div
      ref={ref}
      data-ui-element="true"
      data-share-panel=""
      className="panel-in absolute left-full top-0 ml-2 w-80 border-2 border-nier-border/50 z-[10000] font-mono p-4 space-y-4"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.97)' }}
    >
      <h3 className="text-nier-strong text-xs tracking-[0.2em] uppercase"><span className="text-nier-bg/60 mr-2">◇</span>{t('share.title')}</h3>

      {isDesktop ? (
        <div className="space-y-2">
          <p className="text-nier-bg/80 text-[11px] leading-relaxed tracking-wide">{t('share.desktopHint')}</p>
          <button type="button" className={`${BUTTON} w-full`} onClick={() => { onSaveFile(); onClose() }}>◇ {t('share.saveFile')}</button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-nier-bg/70 text-[10px] tracking-[0.15em] uppercase" htmlFor="share-link">{t('share.link')}</label>
          <div className="flex gap-2">
            <input id="share-link" readOnly value={link} className={FIELD} onFocus={e => e.currentTarget.select()} />
            <button type="button" data-copy="link" className={BUTTON} onClick={() => void copyText(link, t('share.linkCopied'))}>{t('share.copyLink')}</button>
          </div>
          <p className="text-nier-bg/60 text-[10px] leading-relaxed tracking-wide">{t('share.linkHint')}</p>
        </div>
      )}

      <div className="space-y-2 pt-3 border-t border-nier-border/20">
        <label className="block text-nier-bg/70 text-[10px] tracking-[0.15em] uppercase" htmlFor="share-id">{t('share.id')}</label>
        <div className="flex gap-2">
          <input id="share-id" readOnly value={atriumId} className={FIELD} onFocus={e => e.currentTarget.select()} />
          <button type="button" data-copy="id" className={BUTTON} onClick={() => void copyText(atriumId, t('share.idCopied'))}>{t('share.copyId')}</button>
        </div>
      </div>
    </div>
  )
}
