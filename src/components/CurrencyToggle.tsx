// The currency picker.
//
// Deliberately the same control as LanguageToggle, down to the variants and
// the way it closes: they are the same kind of preference, they appear in the
// same places, and a picker that behaved differently from the one beside it
// would only be a thing to notice.
//
// Currencies are listed by code and by the name of the currency in the
// reader's own language, which Intl already knows -- "US Dollar" for somebody
// reading English, "Dólar americano" for somebody reading Portuguese. A symbol
// alone would not do: ¥ is two of the currencies here.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { useCurrency, type CurrencyCode } from '../lib/currency'

// The currency's name in the current language. Intl carries these, so they do
// not need translating eight times by hand -- and it falls back to the code,
// which is a poor label but never a wrong one.
function currencyName(code: CurrencyCode, locale: string): string {
  try {
    const parts = new Intl.DisplayNames([locale], { type: 'currency' })
    return parts.of(code) ?? code
  } catch {
    return code
  }
}

export default function CurrencyToggle({ className = '', variant = 'panel' }: {
  className?: string
  variant?: 'panel' | 'atrium' | 'menu'
}) {
  const { t, language } = useTranslation()
  const { currency, currencies, setCurrency } = useCurrency()
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

  const choose = (code: CurrencyCode) => {
    setCurrency(code)
    setOpen(false)
  }

  const label = t('currency.label')

  const rows = currencies.map(entry => {
    const isActive = entry.code === currency
    return (
      <button
        key={entry.code}
        type="button"
        role={variant === 'menu' ? undefined : 'option'}
        aria-selected={variant === 'menu' ? undefined : isActive}
        onClick={() => choose(entry.code)}
        className={variant === 'menu'
          ? `w-full px-4 py-2.5 text-left text-[11px] tracking-[0.12em] uppercase border transition-colors flex items-center justify-between gap-3 ${
              isActive
                ? 'text-nier-strong border-nier-border/60 bg-nier-bg/10'
                : 'text-nier-bg/80 border-nier-border/25 hover:text-nier-strong hover:border-nier-border/50'
            }`
          : `w-full px-4 py-2 text-left text-[11px] tracking-[0.12em] uppercase transition-colors flex items-center justify-between gap-3 ${
              isActive ? 'text-nier-strong bg-nier-bg/10' : 'text-nier-bg/80 hover:text-nier-strong hover:bg-nier-bg/5'
            }`}
      >
        <span className="truncate">
          <span className="text-nier-bg/60">{entry.code}</span>
          {' · '}
          {currencyName(entry.code, language)}
        </span>
        {isActive && <span className="text-[10px] shrink-0">◇</span>}
      </button>
    )
  })

  // On the welcome screen it is a panel rather than a row that unfolds, for
  // the same reason the language picker is: unfolding pushes every button
  // below it down a column that may not have the room.
  if (variant === 'menu') {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className={`menu-row ${className}`}
        >
          <span className="relative z-10">◇ {label}</span>
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
                  <h2 className="text-lg text-nier-strong tracking-[0.15em] uppercase truncate">{label}</h2>
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
                {rows}
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
        title={`${label}: ${currencyName(currency, language)}`}
        aria-label={`${label}: ${currencyName(currency, language)}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={variant === 'atrium'
          ? `atrium-btn ${className}`
          : `cut-corner inline-flex items-center justify-center gap-2 h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/70 text-[11px] tracking-[0.15em] uppercase leading-none transition-colors ${className}`}
        style={variant === 'atrium' ? undefined : { backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
      >
        ◆
        {/* The code, for the same reason the language button shows one: it is a
            fixed width whatever is chosen, and the list below is where the
            name is read. */}
        <span>{currency}</span>
      </button>

      {open && (
        <div
          role="listbox"
          onWheel={event => event.stopPropagation()}
          className="panel-in absolute right-0 top-[calc(100%+6px)] z-[10000200] min-w-[12rem] border border-nier-border/40 py-1 max-h-[60vh] overflow-y-auto"
          style={{ backgroundColor: 'rgb(var(--c-surface))' }}
        >
          {rows}
        </div>
      )}
    </div>
  )
}
