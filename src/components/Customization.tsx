// The Customization panel, as Excalidraw's properties are: one frame, docked
// on the right (--right-rail), its sections in the order the work goes --
// what a thing is, then how it looks, then where it sits -- and only those
// the thing being customized has. For a trace, for several at once (Batch
// Edit), for the tool in hand (how what it makes starts), and for drawing.
// Its sections fold, and stay folded, on this device; one that can be off
// has its switch in its heading, and says how it's set while folded. Each
// setting is a row: its name on the left, what sets it on the right. Its
// foot is a row of actions.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'
import { kindOf, type TraceKind } from '../lib/traceKinds'
import type { TranslationKey } from '../locales/en'
import type { Trace } from '../types/database'
import { MenuIcon, SlideLabel } from './AtriumMenu'
import { useGamePick } from '../store/gameStore'

export type SectionId = 'name' | 'style' | 'fill' | 'outline' | 'text' | 'shape' | 'content' | 'effects' | 'size' | 'brush' | 'colour' | 'stroke' | 'exr' | 'look'
  | 'background' | 'border' | 'shadow' | 'light' | 'captions' | 'arrange'
  // Atrium Themes (ThemeCustomization).
  | 'presets' | 'mine' | 'grid' | 'room' | 'particles' | 'ground'
  // User Preferences (ProfileCustomization).
  | 'you' | 'work' | 'moving' | 'see' | 'people' | 'sound' | 'motion'

// Each kind of trace by its name: the panel's subtitle, and Batch Edit's
// notes on which of a selection a setting is for.
export const KIND_LABEL: Record<TraceKind, TranslationKey> = {
  text: 'atrium.trace.type.text',
  image: 'atrium.trace.type.image',
  drawing: 'atrium.trace.type.drawing',
  embed: 'atrium.trace.type.embed',
  document: 'atrium.trace.type.document',
  audio: 'atrium.trace.type.audio',
  video: 'atrium.trace.type.video',
  frame: 'atrium.trace.type.frame',
  shape: 'atrium.trace.type.shape',
  path: 'atrium.trace.shape.path',
  sheet: 'atrium.trace.type.sheet',
  chart: 'atrium.trace.type.chart',
}

// A trace's kind as the panel names it: a shape by its own (Diamond), not
// "Shape".
export function traceKindLabel(trace: Trace, t: (key: TranslationKey) => string): string {
  if (trace.type === 'shape' && trace.shapeType && trace.shapeType !== 'path') return t(`atrium.trace.shape.${trace.shapeType}` as TranslationKey)
  return t(KIND_LABEL[kindOf(trace)])
}

const FOLDED_KEY = 'atrium.customize.folded'
const readFolded = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) || '[]')) } catch { return new Set() }
}

export function CustomizationPanel({ subtitle, onClose, closeLabel, actions, zIndex, children }: {
  // What it's customizing: a kind ("Rectangle"), a count, a tool.
  subtitle?: string
  onClose?: () => void
  closeLabel?: string
  actions?: ReactNode
  zIndex: number
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div
      data-customization=""
      data-ui-element="true"
      className="customize-menu docked-panel panel-in-right fixed flex flex-col w-[22rem] top-[4.25rem] max-h-[calc(100vh-8.5rem)] border border-nier-border/40 font-mono pointer-events-auto shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
      style={{ zIndex, backgroundColor: 'rgb(var(--c-ground) / 0.97)' }}
    >
      <header className="shrink-0 flex items-center justify-between gap-2 pl-4 pr-2 py-2 border-b border-nier-border/25">
        <h2 className="min-w-0 truncate text-nier-strong text-[11px] tracking-[0.2em] uppercase">
          {t('atrium.customize.panel')}
          {subtitle && <span className="text-nier-bg/60"> · {subtitle}</span>}
        </h2>
        {onClose && (
          <button
            type="button"
            data-customization-close=""
            onClick={onClose}
            aria-label={closeLabel ?? t('common.close')}
            title={closeLabel ?? t('common.close')}
            className="shrink-0 w-7 h-7 flex items-center justify-center border border-nier-bg/50 text-nier-strong hover:bg-nier-bg hover:text-nier-black transition-colors"
          >
            <MenuIcon d="M6 6l12 12M18 6l-12 12" size={14} />
          </button>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto px-4">{children}</div>
      {actions && (
        <footer data-customization-actions="" className="relative shrink-0 flex flex-wrap items-center gap-1 px-2 py-2 border-t border-nier-border/25">
          {actions}
        </footer>
      )}
    </div>
  )
}

// One section: its title a button that folds it. Folded or not is kept for
// every panel alike -- fold Effects once and it's folded everywhere.
// `summary`: how it's set, beside the title, so a folded one still tells.
// `on`/`onSwitch`: a section that can be off (a border, a light) has its
// switch in its heading; off, there is nothing in it to set.
export function Section({ id, title, note, summary, on, onSwitch, children }: {
  id: SectionId
  title: string
  note?: string | null
  summary?: string | null
  on?: boolean
  onSwitch?: (on: boolean) => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(() => !readFolded().has(id))
  const toggle = () => {
    setOpen(was => {
      const folded = readFolded()
      if (was) folded.add(id)
      else folded.delete(id)
      try { localStorage.setItem(FOLDED_KEY, JSON.stringify([...folded])) } catch { /* for this visit only */ }
      return !was
    })
  }
  const off = on === false
  const aside = note ?? (off ? t('atrium.customize.off') : summary)
  return (
    <section data-section={id} className="border-b border-nier-border/15 last:border-b-0">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex-1 min-w-0 flex items-center gap-2 py-3 text-left text-nier-strong text-[11px] tracking-[0.2em] uppercase hover:text-nier-bg"
        >
          <span className={`text-nier-bg/60 text-[10px] transition-transform ${open ? '' : '-rotate-90'}`}>▾</span>
          <span className="shrink-0">{title}</span>
          {aside && <span data-section-summary="" className="ml-auto min-w-0 text-nier-bg/55 text-[10px] tracking-wide normal-case truncate">{aside}</span>}
        </button>
        {onSwitch && (
          <button
            type="button"
            role="switch"
            aria-checked={!off}
            aria-label={title}
            data-section-switch={id}
            onClick={() => onSwitch(off)}
            className="group shrink-0 flex items-center py-2"
          >
            <ToggleTrack on={!off} />
          </button>
        )}
      </div>
      {open && !off && children && <div className="pb-4 pl-5 space-y-2.5">{children}</div>}
    </section>
  )
}

// One setting: its name on the left, what sets it on the right -- or, for
// one too wide to share the line (`stacked`), under it.
export function Row({ label, hint, stacked, children }: { label: ReactNode; hint?: string; stacked?: boolean; children: ReactNode }) {
  return (
    <div className={stacked ? 'space-y-1.5' : 'flex items-center gap-3 min-h-8'} title={hint}>
      <span className={`${stacked ? 'block' : 'w-[5.75rem] shrink-0'} text-nier-bg/70 text-[11px] tracking-[0.06em] leading-tight`}>{label}</span>
      {stacked ? children : <div className="flex-1 min-w-0">{children}</div>}
    </div>
  )
}

// One of a few, side by side, the chosen one lit. `title`: its name, where
// it's shown as a mark (◀, B). Pressed or not on its own, it's one of a set
// of toggles (bold, italic) rather than one choice among them.
export function ChoiceButton({ on, title, onClick, className = '', children, data }: {
  on: boolean
  title?: string
  onClick: () => void
  className?: string
  children: ReactNode
  // Data attributes, for whatever looks for this button.
  data?: Record<string, string>
}) {
  return (
    <button
      type="button"
      {...data}
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
      className={`flex-1 min-w-0 h-8 px-1.5 truncate text-[10px] tracking-[0.08em] uppercase border transition-colors ${
        on ? 'bg-nier-bg text-nier-black border-nier-bg' : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
      } ${className}`}
    >
      {children}
    </button>
  )
}
export function Choices<T extends string>({ options, value, onChange, name }: {
  options: readonly { value: T; label: ReactNode; title?: string }[]
  // null while several disagree (Batch Edit): none lit.
  value: T | null
  onChange: (value: T) => void
  // The data attribute each carries its value in: data-<name>="top".
  name?: string
}) {
  return (
    <div className="flex gap-1">
      {options.map(option => (
        <ChoiceButton key={option.value} on={value === option.value} title={option.title} onClick={() => onChange(option.value)} data={name ? { [`data-${name}`]: option.value } : undefined}>
          {option.label}
        </ChoiceButton>
      ))}
    </div>
  )
}

// An action at the panel's foot: an icon, its name drawn out above it.
export function PanelAction({ icon, label, onClick, danger, active, disabled }: {
  icon: string
  label: string
  onClick: () => void
  danger?: boolean
  active?: boolean
  disabled?: boolean
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        data-action={label}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={`peer w-8 h-8 flex items-center justify-center border transition-colors disabled:opacity-35 disabled:pointer-events-none ${
          active
            ? 'bg-nier-bg text-nier-black border-nier-bg'
            : danger
              ? 'border-transparent hover:border-red-500/60'
              : 'border-transparent text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
        }`}
        style={danger && !active ? { color: 'rgb(var(--c-danger))' } : undefined}
      >
        <MenuIcon d={icon} size={16} />
      </button>
      <SlideLabel side="above" text={label} onPress={disabled ? undefined : onClick} />
    </div>
  )
}

// The actions' icons, after Tabler's (MIT), stroked as the menu's are.
export const ACTION_ICONS = {
  crop: 'M8 5v10a1 1 0 0 0 1 1h10M5 8h10a1 1 0 0 1 1 1v10',
  // Mirrored across, and up and down.
  flipH: 'M12 3l0 18M16 7l0 10l5 0l-5 -10M8 7l0 10l-5 0l5 -10',
  flipV: 'M3 12l18 0M7 16l10 0l-10 5l0 -5M7 8l10 0l-10 -5l0 5',
  resetRotation: 'M19.95 11a8 8 0 1 0 -.5 4m.5 5v-5h-5',
  connect: 'M9 15l6 -6M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463',
  frame: 'M4 7l16 0M4 17l16 0M7 4l0 16M17 4l0 16',
  export: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2M7 11l5 5l5 -5M12 4l0 12',
  // The footer's own: choosing what's in it.
  choose: 'M4 6h8M16 6h4M4 12h2M10 12h10M4 18h11M19 18h1M14 4v4M8 10v4M17 16v4',
  duplicate: 'M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667zM4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
  copyStyle: 'M19 3h-14a2 2 0 0 0 -2 2v4h18v-4a2 2 0 0 0 -2 -2zM5 9h14v4h-6v8h-2v-8h-6z',
  pasteStyle: 'M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2M9 3h6v4h-6zM9 13l2 2l4 -4',
  // In the drawing order: a step up or down, to the top or bottom.
  up: 'M12 5l0 14M18 11l-6 -6M6 11l6 -6',
  down: 'M12 5l0 14M18 13l-6 6M6 13l6 6',
  top: 'M12 10l0 10M12 10l4 4M12 10l-4 4M4 4l16 0',
  bottom: 'M4 20l16 0M12 14l0 -10M12 14l4 -4M12 14l-4 -4',
  lock: 'M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2zM11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0M8 11v-4a4 4 0 1 1 8 0v4',
  delete: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
  // A picture: strokes made one, for good.
  rasterize: 'M15 8h.01M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3zM3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3',
} as const

// ---------------------------------------------------------------- the footer

/** An action at the panel's foot, by its id: whether it applies to what's
 *  being customized (one trace, a selection) -- shown only if so. */
export interface FooterAction { id: string; icon: string; label: string; onClick: () => void; applies?: boolean; danger?: boolean; active?: boolean }
// The ones it comes with -- and the most it holds: one row, ten across at
// 32px with the button that chooses them.
export const FOOTER_DEFAULT = ['duplicate', 'copyStyle', 'pasteStyle', 'up', 'down', 'top', 'bottom', 'lock', 'delete']
export const FOOTER_MOST = 9

/** The footer's chosen actions, in their order, as far as `known` has them. */
export function footerOf(chosen: string[] | null, known: string[]): string[] {
  return (chosen ?? FOOTER_DEFAULT).filter((id, i, all) => known.includes(id) && all.indexOf(id) === i).slice(0, FOOTER_MOST)
}

// The footer of a trace's panel, or a selection's: the actions chosen for it
// (User's own, on this device: panelActions), those that apply here, in one
// row -- and at its end the button that chooses them.
export function PanelFooter({ actions }: { actions: FooterAction[] }) {
  const { t } = useTranslation()
  const { panelActions, setPanelActions } = useGamePick('panelActions', 'setPanelActions')
  const [choosing, setChoosing] = useState(false)
  const chosen = footerOf(panelActions, actions.map(action => action.id))
  return (
    <>
      <div className="flex-1 min-w-0 flex items-center">
        {chosen.map(id => actions.find(action => action.id === id)).filter(action => action && action.applies !== false).map(action => (
          <PanelAction key={action!.id} icon={action!.icon} label={action!.label} onClick={action!.onClick} danger={action!.danger} active={action!.active} />
        ))}
      </div>
      <div data-footer-choose="">
        <PanelAction icon={ACTION_ICONS.choose} label={t('atrium.customize.editFooter')} active={choosing} onClick={() => setChoosing(was => !was)} />
      </div>
      {choosing && <FooterChooser actions={actions} chosen={chosen} onChange={setPanelActions} onClose={() => setChoosing(false)} />}
    </>
  )
}

// Choosing the footer's actions: each switched in or out, up to FOOTER_MOST,
// the chosen dragged into their order by their rows -- the footer following
// at once. Over the panel, just above its foot; Esc or a press elsewhere
// closes it.
function FooterChooser({ actions, chosen, onChange, onClose }: {
  actions: FooterAction[]; chosen: string[]; onChange: (actions: string[] | null) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const rows = useRef(new Map<string, HTMLLIElement>())
  // The row held, and the order the chosen would have let go of now.
  const [held, setHeld] = useState<{ id: string; order: string[] } | null>(null)
  const order = held?.order ?? chosen
  useEffect(() => {
    // Its own Esc: ahead of the atrium's (which puts the selection down, and
    // the panel with it), and only this closed.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    const press = (e: PointerEvent) => {
      const at = e.target as Node
      if (!box.current?.contains(at) && !(at as HTMLElement).closest?.('[data-footer-choose]')) onClose()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', press, true)
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', press, true) }
  }, [onClose])
  const move = (y: number) => {
    if (!held) return
    const others = order.filter(id => id !== held.id)
    let at = others.findIndex(id => {
      const r = rows.current.get(id)?.getBoundingClientRect()
      return !!r && y < r.top + r.height / 2
    })
    if (at < 0) at = others.length
    const next = [...others.slice(0, at), held.id, ...others.slice(at)]
    if (next.join() !== order.join()) setHeld({ id: held.id, order: next })
  }
  const letGo = () => {
    if (held && held.order.join() !== chosen.join()) onChange(held.order)
    setHeld(null)
  }
  const full = chosen.length >= FOOTER_MOST
  const listed = [...order.map(id => actions.find(action => action.id === id)!).filter(Boolean), ...actions.filter(action => !order.includes(action.id))]
  return (
    <div
      ref={box}
      data-footer-chooser=""
      className="absolute left-0 right-0 bottom-full max-h-[min(70vh,34rem)] overflow-y-auto border-t border-nier-border/40 px-4 py-3 shadow-[0_-12px_24px_rgba(0,0,0,0.35)]"
      style={{ backgroundColor: 'rgb(var(--c-ground))' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-nier-strong text-[11px] tracking-[0.2em] uppercase">{t('atrium.customize.footerTitle')}</span>
        <span className="text-nier-bg/55 text-[10px] tabular-nums">{t('atrium.customize.footerCount', { count: chosen.length, most: FOOTER_MOST })}</span>
      </div>
      <p className="mt-1 mb-2.5 text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide">{t('atrium.customize.footerHint', { most: FOOTER_MOST })}</p>
      <ul className="flex flex-col gap-1">
        {listed.map(action => {
          const isIn = order.includes(action.id)
          return (
            <li
              key={action.id}
              ref={el => { if (el) rows.current.set(action.id, el); else rows.current.delete(action.id) }}
              data-footer-row={action.id}
              onPointerDown={e => {
                if (!isIn || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
                e.currentTarget.setPointerCapture(e.pointerId)
                setHeld({ id: action.id, order })
              }}
              onPointerMove={e => move(e.clientY)}
              onPointerUp={letGo}
              onPointerCancel={() => setHeld(null)}
              className={`flex items-center gap-2.5 h-9 pl-2 pr-1 border select-none touch-none transition-colors ${
                held?.id === action.id ? 'border-nier-bg bg-nier-bg/10 cursor-grabbing'
                  : isIn ? 'border-nier-border/40 hover:border-nier-border/70 cursor-grab' : 'border-nier-border/15'
              }`}
            >
              <span className={`w-3 text-center text-[10px] ${isIn ? 'text-nier-bg/50' : 'text-transparent'}`} aria-hidden="true">⋮⋮</span>
              <span className={isIn ? 'text-nier-bg' : 'text-nier-bg/45'} style={action.danger ? { color: 'rgb(var(--c-danger))' } : undefined}><MenuIcon d={action.icon} size={15} /></span>
              <span className={`flex-1 min-w-0 truncate text-[11px] tracking-[0.06em] ${isIn ? 'text-nier-strong' : 'text-nier-bg/60'}`}>{action.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={isIn}
                aria-label={action.label}
                disabled={!isIn && full}
                onClick={() => onChange(isIn ? chosen.filter(id => id !== action.id) : [...chosen, action.id])}
                className="group shrink-0 flex items-center p-1 disabled:opacity-35"
              >
                <ToggleTrack on={isIn} />
              </button>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        data-footer-reset=""
        onClick={() => onChange(null)}
        className="mt-3 w-full h-8 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.15em] uppercase hover:border-nier-bg transition-colors"
      >
        {t('atrium.customize.resetDefault')}
      </button>
    </div>
  )
}

// A setting that is on or off: its name and what it does, and a switch --
// a track with its knob, sliding over and filling when on. Clearer at a
// glance than a box ticked or not, and the whole row presses it.
export function Switch({ label, hint, on, onChange, testId }: {
  label: string
  hint?: string
  on: boolean
  onChange: (on: boolean) => void
  testId?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-switch={testId}
      onClick={() => onChange(!on)}
      className="group w-full flex items-start justify-between gap-4 text-left"
    >
      <span className="min-w-0">
        <span className="block text-nier-strong text-xs tracking-[0.1em] uppercase">{label}</span>
        {hint && <span className="block mt-1 text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide">{hint}</span>}
      </span>
      <ToggleTrack on={on} className="mt-0.5" />
    </button>
  )
}

// A text's alignment, its four buttons -- for one trace, or several (Batch
// Edit), where `value` is null while they disagree and none is lit.
export type TextAlign = 'left' | 'center' | 'right' | 'justify'
const ALIGN_MARK: Record<TextAlign, string> = { left: '◀', center: '◆', right: '▶', justify: '▣' }
export function TextAlignField({ value, onChange }: { value: TextAlign | null; onChange: (align: TextAlign) => void }) {
  const { t } = useTranslation()
  return (
    <Row label={t('atrium.customize.textAlignment')}>
      <Choices
        name="text-align"
        value={value}
        onChange={onChange}
        options={(Object.keys(ALIGN_MARK) as TextAlign[]).map(align => ({ value: align, label: ALIGN_MARK[align], title: align }))}
      />
    </Row>
  )
}

// Where a text sits up and down in its box -- the middle unless chosen --
// for one trace or several, `value` null while they disagree.
export type TextValign = 'top' | 'middle' | 'bottom'
const VALIGN: Record<TextValign, { mark: string; label: TranslationKey }> = {
  top: { mark: '▲', label: 'atrium.customize.alignTop' },
  middle: { mark: '◆', label: 'atrium.customize.alignCenter' },
  bottom: { mark: '▼', label: 'atrium.customize.alignBottom' },
}
export function TextValignField({ value, onChange }: { value: TextValign | null; onChange: (valign: TextValign) => void }) {
  const { t } = useTranslation()
  return (
    <Row label={t('atrium.customize.verticalAlignment')}>
      <Choices
        name="text-valign"
        value={value}
        onChange={onChange}
        options={(Object.keys(VALIGN) as TextValign[]).map(valign => ({ value: valign, label: VALIGN[valign].mark, title: t(VALIGN[valign].label) }))}
      />
    </Row>
  )
}

// The switch itself: a track, its knob at the far end when on -- and in the
// middle when it's on for some of what's selected and off for the rest. The
// one look every on/off in the app has (Switch here, Check in the panels).
export function ToggleTrack({ on, mixed = false, className = '' }: { on: boolean; mixed?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative shrink-0 w-9 h-5 border transition-colors duration-200 ${className} ${
        on ? 'bg-nier-bg border-nier-bg' : 'border-nier-border/50 group-hover:border-nier-border/80'
      }`}
    >
      <span
        className="absolute top-[3px] left-[3px] w-3 h-3 transition-transform duration-200 ease-out"
        style={{ transform: on ? 'translateX(16px)' : mixed ? 'translateX(8px)' : 'none', backgroundColor: on ? 'rgb(var(--c-ground))' : 'rgb(var(--c-fg) / 0.7)' }}
      />
    </span>
  )
}
