// The Customization panel, as Excalidraw's properties are: one frame, docked
// on the right (--right-rail), its sections always in
// one order -- Name, Style, Fill, Outline, Text, Shape, Content, Effects,
// Size, a text trace's Content first -- and only those the thing being
// customized has. For a trace, for
// several at once (Batch Edit), for the tool in hand (how what it makes
// starts), and for drawing. Its sections fold, and stay folded, on this
// device; its foot is a row of actions.

import { useState, type ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'
import { kindOf, type TraceKind } from '../lib/traceKinds'
import type { TranslationKey } from '../locales/en'
import type { Trace } from '../types/database'
import { MenuIcon, SlideLabel } from './AtriumMenu'

export type SectionId = 'name' | 'style' | 'fill' | 'outline' | 'text' | 'shape' | 'content' | 'effects' | 'size' | 'brush' | 'colour' | 'stroke' | 'exr'
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
      className="customize-menu panel-in-right fixed flex flex-col w-[22rem] max-h-[calc(100vh-8.5rem)] border border-nier-border/40 font-mono pointer-events-auto shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
      style={{ right: 'var(--right-rail)', top: '4.25rem', zIndex, backgroundColor: 'rgb(var(--c-ground) / 0.97)' }}
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
        <footer data-customization-actions="" className="shrink-0 flex flex-wrap items-center gap-1 px-2 py-2 border-t border-nier-border/25">
          {actions}
        </footer>
      )}
    </div>
  )
}

// One section: its title a button that folds it. Folded or not is kept for
// every panel alike -- fold Effects once and it's folded everywhere.
export function Section({ id, title, note, children }: { id: SectionId; title: string; note?: string | null; children: ReactNode }) {
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
  return (
    <section data-section={id} className="border-b border-nier-border/15 last:border-b-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 py-2.5 text-left text-nier-strong text-[11px] tracking-[0.2em] uppercase hover:text-nier-bg"
      >
        <span className={`text-nier-bg/60 text-[10px] transition-transform ${open ? '' : '-rotate-90'}`}>▾</span>
        <span className="truncate">{title}</span>
        {note && <span className="ml-auto text-nier-bg/55 text-[10px] tracking-wide normal-case truncate">{note}</span>}
      </button>
      {open && <div className="pb-4 space-y-4">{children}</div>}
    </section>
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
