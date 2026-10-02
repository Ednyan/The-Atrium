// The atrium's menu, at the top left: three lines, and open, a column of
// icons, each one's name sliding out beside it under the pointer (or the
// keyboard's focus). It closes by its own button, Escape, or a press anywhere
// off it; what it opens elsewhere -- a dialog -- closes it too (LobbyScene).

import { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'

// Each icon one path on a 24-unit grid, stroked like the quick bar's
// (after Tabler's, MIT).
export const MENU_ICONS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  save: 'M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2M10 14a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M14 4v4h-6v-4',
  open: 'M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2',
  image: 'M15 8h.01M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3zM3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3',
  share: 'M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M8.7 10.7l6.6 -3.4M8.7 13.3l6.6 3.4',
  themes: 'M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M11.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M15.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  preferences: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M6.168 18.849a4 4 0 0 1 3.832 -2.849h4a4 4 0 0 1 3.834 2.855',
  permissions: 'M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3M9 12l2 2l4 -4',
  recenter: 'M11.5 12a.5 .5 0 1 0 1 0a.5 .5 0 1 0 -1 0M4 8v-2a2 2 0 0 1 2 -2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2 -2v-2',
  language: 'M4 5h7M9 3v2c0 4.418 -2.239 8 -5 8M5 9c0 2.144 2.952 3.908 6.7 4M12 20l4 -9l4 9M19.1 18h-6.2',
  storeLocally: 'M19 18a3.5 3.5 0 0 0 0 -7h-1a5 4.5 0 0 0 -11 -2a4.6 4.4 0 0 0 -2.1 8.4M12 13v9M9 19l3 3l3 -3',
  report: 'M12 9v4M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0zM12 16h.01',
  users: 'M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0 -3 -3.85',
  maximize: 'M16 4h4v4M14 10l6 -6M8 20h-4v-4M4 20l6 -6M16 20h4v-4M14 14l6 6M8 4h-4v4M4 4l6 6',
  minimize: 'M5 9h4v-4M3 3l6 6M5 15h4v4M3 21l6 -6M19 9h-4v-4M15 9l6 -6M19 15h-4v4M15 15l6 6',
  hide: 'M10.585 10.587a2 2 0 0 0 2.829 2.828M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87M3 3l18 18',
  show: 'M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6',
  sun: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 12h1M12 3v1M20 12h1M12 20v1M5.6 5.6l.7 .7M18.4 5.6l-.7 .7M17.7 17.7l.7 .7M6.3 17.7l-.7 .7',
  moon: 'M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z',
  leave: 'M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2M9 12h12l-3 -3M18 15l3 -3',
  check: 'M5 12l5 5l10 -10',
  discard: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M10 10l4 4m0 -4l-4 4',
  close: 'M18 6l-12 12M6 6l12 12',
  controls: 'M2 8a2 2 0 0 1 2 -2h16a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2zM6 10v.01M10 10v.01M14 10v.01M18 10v.01M6 14v.01M18 14v.01M10 14h4',
} as const

export function MenuIcon({ d, size = 20 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} className="shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

// A name drawn out from an icon's edge as the pointer arrives (or the
// keyboard's focus): beside the icons of the left edge -- the menu, the quick
// bar -- and below those along the top, which have no room beside them. It
// goes after a button marked `peer`, both inside a `group`; pressing it is
// pressing the button. `shown` keeps it out without the pointer.
const SLIDE = {
  right: 'absolute left-full top-1/2 -translate-y-1/2 -translate-x-1 pl-2 z-10 opacity-0 pointer-events-none [clip-path:inset(0_100%_0_0)] transition-[clip-path,opacity,transform] duration-200 ease-out group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto group-hover:[clip-path:inset(0_0_0_0)] peer-focus-visible:opacity-100 peer-focus-visible:translate-x-0 peer-focus-visible:[clip-path:inset(0_0_0_0)]',
  below: 'absolute top-full right-0 pt-2 z-10 opacity-0 pointer-events-none -translate-y-1 [clip-path:inset(0_0_100%_0)] transition-[clip-path,opacity,transform] duration-200 ease-out group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto group-hover:[clip-path:inset(0_0_0_0)] peer-focus-visible:opacity-100 peer-focus-visible:translate-y-0 peer-focus-visible:[clip-path:inset(0_0_0_0)]',
}
const SLIDE_SHOWN = {
  right: 'absolute left-full top-1/2 -translate-y-1/2 pl-2 z-10',
  below: 'absolute top-full right-0 pt-2 z-10',
}

export function SlideLabel({ text, hint, onPress, side = 'right', shown = false }: {
  text: string
  hint?: string
  onPress?: () => void
  side?: 'right' | 'below'
  shown?: boolean
}) {
  return (
    <span aria-hidden="true" onClick={onPress} className={shown ? SLIDE_SHOWN[side] : SLIDE[side]}>
      <span
        className="block whitespace-nowrap px-3 py-2 border border-nier-border/40 text-nier-strong text-[11px] tracking-[0.15em] uppercase cursor-pointer"
        style={{ backgroundColor: 'rgb(var(--c-ground) / 0.96)' }}
      >
        {text}
        {hint && <span className="ml-3 text-nier-bg/50 normal-case tracking-normal">{hint}</span>}
      </span>
    </span>
  )
}

// A square button of the HUD that is only its icon, its name drawn out below
// it under the pointer: the session's controls at the top right, and Save.
export function HudIconButton({ icon, label, hint, onClick, active, holdLabel, badge, iconClassName, className = '', style, ...rest }: {
  icon: string
  label: string
  hint?: string
  onClick: () => void
  active?: boolean
  // Its name kept out, not only under the pointer: a press that asks to be
  // sure (Don't Save's second).
  holdLabel?: boolean
  // Drawn over the icon: a count.
  badge?: ReactNode
  iconClassName?: string
  className?: string
  style?: CSSProperties
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'style' | 'className' | 'type'>) {
  return (
    <div className="group relative">
      <button
        type="button"
        data-ui-element="true"
        {...rest}
        onClick={onClick}
        aria-label={hint ? `${label} (${hint})` : label}
        data-active={active}
        className={`peer atrium-btn relative w-[2.125rem] ${className}`}
        // Square: .atrium-btn's own padding outranks px-0.
        style={{ padding: 0, ...style }}
      >
        <span className={`flex ${iconClassName ?? ''}`}><MenuIcon d={icon} size={18} /></span>
        {badge}
      </button>
      <SlideLabel text={label} hint={hint} side="below" shown={holdLabel} onPress={rest.disabled ? undefined : onClick} />
    </div>
  )
}

export interface MenuItem {
  id: string
  icon: string
  label: string
  // Its shortcut, shown after the name.
  hint?: string
  onSelect: () => void
  disabled?: boolean
  // A panel beside it (Share, Language) rather than somewhere else: shown
  // while `open`, the menu staying open with it.
  panel?: ReactNode
  open?: boolean
  // A rule above it, between groups.
  apart?: boolean
}

export default function AtriumMenu({ open, onOpenChange, items }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: MenuItem[]
}) {
  const { t } = useTranslation()
  const rootRef = useRef<HTMLDivElement>(null)
  const openChange = useRef(onOpenChange)
  openChange.current = onOpenChange

  useEffect(() => {
    if (!open) return
    const press = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) openChange.current(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') openChange.current(false) }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('keydown', key)
    }
  }, [open])

  return (
    <div ref={rootRef} data-atrium-menu="" className="flex flex-col items-start gap-1 font-mono pointer-events-auto">
      <button
        type="button"
        data-menu-toggle=""
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('atrium.menu.title')}
        title={t('atrium.menu.title')}
        data-active={open}
        // Square: .atrium-btn's own padding outranks px-0, and left the icon
        // no width at all.
        className="atrium-btn w-[2.125rem]"
        style={{ padding: 0 }}
      >
        <MenuIcon d={MENU_ICONS.menu} size={18} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('atrium.menu.title')}
          className="panel-in flex flex-col gap-1 p-1 border border-nier-border/40"
          style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}
        >
          {items.map(item => (
            <div key={item.id} className="group relative">
              {item.apart && <div className="absolute -top-[3px] inset-x-1 h-px bg-nier-border/30" />}
              <button
                type="button"
                role="menuitem"
                data-menu-item={item.id}
                data-panel-toggle={item.panel ? item.id : undefined}
                disabled={item.disabled}
                onClick={item.onSelect}
                aria-label={item.hint ? `${item.label} (${item.hint})` : item.label}
                aria-expanded={item.panel ? !!item.open : undefined}
                className={`peer w-9 h-9 flex items-center justify-center border transition-colors disabled:opacity-50 ${
                  item.open
                    ? 'bg-nier-bg text-nier-black border-nier-bg'
                    : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg focus-visible:border-nier-border/60'
                }`}
              >
                <MenuIcon d={item.icon} />
              </button>
              {/* Not while the item's panel is open, which stands in its place. */}
              {!item.open && <SlideLabel text={item.label} hint={item.hint} onPress={item.disabled ? undefined : item.onSelect} />}
              {item.open && item.panel}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Every control and shortcut in the atrium, each written "What : Keys" (a
// full-width colon in Chinese and Japanese), shown as the two sides of a row.
const CONTROLS = [
  'atrium.controls.pan', 'atrium.controls.zoom', 'atrium.controls.zoomReset', 'atrium.controls.recenter', 'atrium.controls.fullscreen',
  'atrium.controls.quickBar', 'atrium.controls.leaveTrace', 'atrium.controls.draw', 'atrium.controls.laser', 'atrium.controls.cancel', 'atrium.controls.finishPath',
  'atrium.controls.editTrace', 'atrium.controls.multiSelect', 'atrium.controls.directSelect', 'atrium.controls.groupUngroup',
  'atrium.controls.copyPaste', 'atrium.controls.copyPasteStyle', 'atrium.controls.deleteSelected', 'atrium.controls.undoRedo',
  'atrium.controls.saveChanges', 'atrium.controls.export', 'atrium.controls.presenting',
] as const

// The list, beside the menu, from its top to the screen's foot at most, and
// scrolled within that.
export function ControlsPanel() {
  const { t } = useTranslation()
  return (
    <div
      data-ui-element="true"
      data-controls-panel=""
      onWheel={event => event.stopPropagation()}
      className="panel-in fixed top-4 left-[4.375rem] z-[10000] w-[24rem] max-w-[calc(100vw-5.5rem)] max-h-[calc(100vh-2rem)] overflow-y-auto border border-nier-border/40 p-4 font-mono"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.97)' }}
    >
      <h3 className="text-nier-strong text-xs tracking-[0.2em] uppercase mb-3"><span className="text-nier-bg/60 mr-2">◇</span>{t('atrium.controls.title')}</h3>
      <dl className="space-y-1.5">
        {CONTROLS.map(key => {
          const text = t(key)
          const at = text.search(/ : |：/)
          const [what, keys] = at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at).replace(/^ : |^：/, '')]
          return (
            <div key={key} className="flex items-baseline justify-between gap-4 text-xs tracking-wider">
              <dt className="text-nier-bg/80">{what}</dt>
              <dd className="text-nier-strong text-right shrink-0 max-w-[55%]">{keys}</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
