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
  const { language, languages, setLanguage, followingBrowser } = useTranslation()
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

  // The welcome screen's menu is a column of rows, so the picker is a row that
  // opens into more rows rather than a button that opens a floating panel.
  if (variant === 'menu') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          className={`menu-row ${className}`}
        >
          <span className="relative z-10">◇ Language · {active.endonym}</span>
        </button>
        {open && (
          <div className="panel-in flex flex-col">
            {languages.map(entry => (
              <button
                key={entry.code}
                type="button"
                onClick={() => choose(entry.code)}
                className="menu-row"
              >
                <span className={`relative z-10 pl-5 ${entry.code === language ? 'text-nier-strong' : ''}`}>
                  {entry.code === language ? '◆' : '◦'} {entry.endonym}
                </span>
              </button>
            ))}
            {!followingBrowser && (
              <button type="button" onClick={() => choose('browser')} className="menu-row">
                <span className="relative z-10 pl-5">◦ Use my browser's</span>
              </button>
            )}
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
        title={`Language: ${active.english}`}
        aria-label={`Language: ${active.english}. Click to change.`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={variant === 'atrium'
          ? `atrium-btn ${className}`
          : `cut-corner inline-flex items-center justify-center gap-2 h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/70 text-[11px] tracking-[0.15em] uppercase leading-none transition-colors ${className}`}
        style={variant === 'atrium' ? undefined : { backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
      >
        ◈
        <span className="hidden sm:inline">{active.endonym}</span>
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
                Use my browser's
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
