// The one Atrium Settings window, whichever kind of atrium: one in the cloud
// (components/LobbyManagement), one in Google Drive (components/DriveSettings).
// Its frame, its two tabs -- General, and People -- and the parts each kind
// fills them with, so the two are one thing to whoever uses them.
import type { ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'

export type SettingsTab = 'general' | 'people'
export const SMALL_BUTTON = 'px-3 py-1 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors disabled:opacity-40'
export const REMOVE_BUTTON = 'px-3 py-1 border border-nier-red/40 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:bg-nier-red/20 hover:text-nier-bg transition-colors disabled:opacity-40'
export const FIELD_LABEL = 'block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2'
export const FIELD = 'bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors'

const tabClass = (on: boolean) => `flex-1 px-4 py-3 text-xs tracking-[0.15em] uppercase transition-colors ${
  on ? 'text-nier-bg border-b border-nier-bg bg-nier-bg/5' : 'text-nier-bg/75 hover:text-nier-bg hover:bg-nier-bg/5'
}`

/** The window: its title, a word (an error, or what was just done), the two
 *  tabs, what's in the one open -- and, under them, what applies to both
 *  (`footer`); `over` is what opens over it (a question). Clicking outside it
 *  is closing it. */
export function SettingsFrame({ tab, onTab, people, notice, onClose, footer, over, children }: {
  tab: SettingsTab
  onTab: (tab: SettingsTab) => void
  people: number
  notice?: { text: string; error?: boolean } | null
  onClose: () => void
  footer?: ReactNode
  over?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div
      data-ui-element="true"
      className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] p-4 font-mono"
      style={{ touchAction: 'auto', overscrollBehavior: 'contain' }}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={onClose}
    >
      <div data-atrium-settings="" className="bg-nier-blackLight border border-nier-border/40 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }} onClick={(e) => e.stopPropagation()}>
        <div className="absolute top-0 left-0 w-6 h-6 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-6 h-6 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-r border-b border-nier-border/60" />

        <div className="p-6 border-b border-nier-border/20">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
              <h2 className="text-lg text-nier-strong tracking-[0.15em] uppercase">{t('atrium.manage.title')}</h2>
            </div>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
            >
              ×
            </button>
          </div>
          {notice && (
            <div role={notice.error ? 'alert' : 'status'} className={`mt-3 text-nier-bg/80 text-xs tracking-wider px-3 py-2 border ${notice.error ? 'border-nier-red/40 bg-nier-red/10' : 'border-nier-border/40 bg-nier-border/10'}`}>
              {notice.error ? '' : '✓ '}{notice.text}
            </div>
          )}
        </div>

        <div className="flex border-b border-nier-border/20">
          <button data-settings-tab="general" onClick={() => onTab('general')} className={tabClass(tab === 'general')}>
            {t('atrium.manage.general')}
          </button>
          <button data-settings-tab="people" onClick={() => onTab('people')} className={tabClass(tab === 'people')}>
            {t('atrium.manage.people', { count: people })}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <div className="p-4 border-t border-nier-border/20">{footer}</div>}
      </div>
      {over}
    </div>
  )
}

/** A group of people on the People tab: what they are, what that means, who. */
export function SettingsGroup({ id, title, hint, dim, children }: { id: string; title: string; hint: ReactNode; dim?: boolean; children: ReactNode }) {
  return (
    <div data-people-group={id} className={dim ? 'opacity-60' : undefined}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase">{title}</span>
        <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
      </div>
      <p className="text-nier-bg/65 text-[0.7rem] leading-relaxed tracking-wide mb-2">{hint}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

/** Someone in a group, with what can be done about them -- and, under, a step
 *  one of those opens (`below`). */
export function SettingsPerson({ name, children, below }: { name: string; children?: ReactNode; below?: ReactNode }) {
  return (
    <div className="bg-nier-black border border-nier-border/20 px-3 py-2">
      <div className="flex flex-wrap justify-between items-center gap-2">
        <span className="min-w-0 truncate text-nier-bg text-sm tracking-wide">{name}</span>
        <div className="flex flex-wrap items-center gap-2">{children}</div>
      </div>
      {below}
    </div>
  )
}

export function Nobody() {
  const { t } = useTranslation()
  return <div className="text-nier-bg/55 text-[10px] tracking-wider uppercase py-1">{t('atrium.manage.noUsers')}</div>
}

/** The owner's mark beside their name. */
export function OwnerBadge() {
  const { t } = useTranslation()
  return <span data-owner-badge="" className="px-2 py-0.5 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.15em] uppercase">{t('atrium.manage.owner')}</span>
}
