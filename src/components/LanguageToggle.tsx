// The language picker.
//
// Sits beside the theme switch and behaves like it: one preference, shared by
// every screen, whether or not that screen carries the control. It only
// appears once there is more than one language to choose -- a dropdown with a
// single entry is a decoration.
//
// Languages are listed by their own names. "Japanese" is a label for people
// who already read English; 日本語 is how somebody finds their own language.

import { useEffect, useRef, useState } from 'react'
import { useTranslation, type LanguageCode } from '../lib/i18n'

export default function LanguageToggle({ className = '', variant = 'panel' }: {
  className?: string
  // 'panel' is the compact control that stands beside the theme switch in a
  // bar. 'atrium' takes the shared in-atrium button definition, so it is the
  // same height as everything next to it. 'menu' is a row in the welcome
  // screen's column, which is a list of rows rather than a row of buttons.
  variant?: 'panel' | 'atrium' | 'menu'
}) {
  const { t, language, languages, setLanguage, followingBrowser } = useTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Clicking anywhere else, or pressing Escape, closes it -- the two ways
  // anybody expects to get out of a menu they opened by accident.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (languages.length < 2) return null

  const active = languages.find(entry => entry.code === language) ?? languages[0]

  const choose = (code: LanguageCode | 'browser') => {
    setLanguage(code)
    setOpen(false)
  }

  // On the welcome screen the picker is a panel, not a row that unfolds.
  //
  // Unfolding pushed every button below it down the column and, with eight
  // languages, ran the menu off a short window -- the thing the whole screen
  // was just taught to avoid. A panel is also what Profile Settings does from
  // the same list, so the two rows in that column now behave alike: press,
  // choose, and it closes itself.
  if (variant === 'menu') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={`menu-row ${className}`}
        >
          <span className="relative z-10">◇ {t('welcome.language')}</span>
        </button>

        {open && (
          <div
            className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000] p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="bg-nier-blackLight border border-nier-border/40 max-w-xs w-full mx-4 max-h-[90vh] relative flex flex-col"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
              <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
              <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
              <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

              <div className="flex justify-between items-center gap-3 px-6 pt-6 pb-4 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60 shrink-0" />
                  <h2 className="text-lg text-white tracking-[0.15em] uppercase truncate">{t('welcome.language')}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t('common.close')}
                  className="w-8 h-8 shrink-0 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
                >
                  ×
                </button>
              </div>

              <div className="px-6 pb-6 overflow-y-auto flex-1 min-h-0 flex flex-col gap-1">
                {languages.map(entry => {
                  const isActive = entry.code === language
                  return (
                    <button
                      key={entry.code}
                      type="button"
                      onClick={() => choose(entry.code)}
                      className={`w-full px-4 py-2.5 text-left text-[11px] tracking-[0.12em] uppercase border transition-colors flex items-center justify-between gap-3 ${
                        isActive
                          ? 'text-nier-strong border-nier-border/60 bg-nier-bg/10'
                          : 'text-nier-bg/80 border-nier-border/25 hover:text-nier-strong hover:border-nier-border/50'
                      }`}
                    >
                      <span>{entry.endonym}</span>
                      {isActive && <span className="text-[10px]">◇</span>}
                    </button>
                  )
                })}

                {!followingBrowser && (
                  <button
                    type="button"
                    onClick={() => choose('browser')}
                    className="w-full px-4 py-2.5 text-left text-[11px] tracking-[0.12em] uppercase border border-nier-border/25 text-nier-bg/70 hover:text-nier-strong hover:border-nier-border/50 transition-colors mt-1"
                  >
                    {t('welcome.useBrowserLanguage')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        title={`${t('welcome.language')}: ${active.endonym}`}
        aria-label={`${t('welcome.language')}: ${active.endonym}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={variant === 'atrium'
          ? `atrium-btn ${className}`
          : `cut-corner inline-flex items-center justify-center gap-2 h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/70 text-[11px] tracking-[0.15em] uppercase leading-none transition-colors ${className}`}
        style={variant === 'atrium' ? undefined : { backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
      >
        ◈
        {/* The code, not the endonym. This button sits in a bar that is
            already full, and "Português (Brasil)" is 150px of it -- enough to
            push the nav into the Donate button on its own. The dropdown below
            is where somebody reads their language's own name; up here it only
            has to say which one is on, and a code does that in a width that
            cannot change with the language. */}
        <span className="hidden 2xl:inline">{active.code.toUpperCase()}</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="panel-in absolute right-0 top-[calc(100%+6px)] z-[10000200] min-w-[10rem] border border-nier-border/40 py-1 max-h-[60vh] overflow-y-auto"
          style={{ backgroundColor: 'rgb(var(--c-surface))' }}
        >
          {languages.map(entry => {
            const isActive = entry.code === language
            return (
              <button
                key={entry.code}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => choose(entry.code)}
                className={`w-full px-4 py-2 text-left text-[11px] tracking-[0.12em] uppercase transition-colors flex items-center justify-between gap-3 ${
                  isActive ? 'text-nier-strong bg-nier-bg/10' : 'text-nier-bg/80 hover:text-nier-strong hover:bg-nier-bg/5'
                }`}
              >
                <span>{entry.endonym}</span>
                {isActive && <span className="text-[10px]">◇</span>}
              </button>
            )
          })}

          {/* Back to following the machine, the same third state the theme
              switch has. Only worth offering once it has been left. */}
          {!followingBrowser && (
            <>
              <div className="my-1 h-px bg-nier-border/25" />
              <button
                type="button"
                onClick={() => choose('browser')}
                className="w-full px-4 py-2 text-left text-[11px] tracking-[0.12em] uppercase text-nier-bg/70 hover:text-nier-strong hover:bg-nier-bg/5 transition-colors"
              >
                {t('welcome.useBrowserLanguage')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
