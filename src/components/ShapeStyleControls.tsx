// The shape options, once.
//
// Used by the create panel and the customize panel alike, so a shape is made
// with exactly the options it can later be edited with. It used to be two
// copies that had drifted: the create panel had colour, opacity and corner
// radius, and nothing for the outline, fill or path arrows, so any of those
// meant creating the shape and then opening a second panel to finish it.
//
// Controlled: the host owns the style and decides what a change means -- a
// live update to a trace in the customize panel, local state that becomes the
// new trace in the create panel.

import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { showToast } from '../lib/toast'
import { BOX_SHAPES, type ArrowKind, type ShapeKind, type ShapeStyle } from '../lib/shapeStyle'
import { Choices, Row, ToggleTrack } from './Customization'
import { MenuIcon } from './AtriumMenu'
import { dashProps, STROKE_STYLES, type StrokeStyle } from '../lib/strokeStyle'

const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ffffff', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#000000',
]

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

const LABEL = 'block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2'
const HINT = 'text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5'

// A path's kinds of line, named as a connection's are.
const PATH_LINES: { kind: ShapeStyle['pathCurveType']; glyph: string; key: 'atrium.links.straight' | 'atrium.links.curved' | 'atrium.links.elbow' }[] = [
  { kind: 'straight', glyph: '━', key: 'atrium.links.straight' },
  { kind: 'bezier', glyph: '〰', key: 'atrium.links.curved' },
  { kind: 'elbow', glyph: '┗', key: 'atrium.links.elbow' },
]

// A section's heading, and -- in Batch Edit, where a setting may be for only
// some of what's selected -- a note of which.
// Each kind as a glyph beside its name in the picker.
const SHAPE_GLYPH: Record<ShapeKind, string> = {
  rectangle: '⬛', triangle: '▲', circle: '⚫', diamond: '◆', parallelogram: '▱', path: '〰',
}

export function SectionRule({ label, note }: { label: string; note?: string | null }) {
  return (
    <div className="flex items-baseline gap-3 pt-1">
      <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{label}</span>
      {note && <span className="text-nier-bg/60 text-[10px] tracking-wide">{note}</span>}
      <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
    </div>
  )
}

// A switch. `mixed`: some of the traces it's for have it on and some off --
// shown as a dash, and turned on for all of them by a click. `row`: among the
// Customization panel's rows, named as they are.
export function Check({ checked, onChange, label, hint, mixed = false, row = false }: {
  checked: boolean; onChange: (value: boolean) => void; label: string; hint?: string; mixed?: boolean; row?: boolean
}) {
  const on = checked && !mixed
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-check={label}
      title={hint}
      onClick={() => onChange(!on)}
      className={`group w-full flex items-center justify-between gap-3 text-left ${row ? 'min-h-8' : ''}`}
    >
      <span className={`min-w-0 text-nier-strong ${row ? 'text-[12px] tracking-[0.04em]' : 'tracking-[0.1em] uppercase text-xs'}`}>{label}</span>
      <ToggleTrack on={on} mixed={mixed} />
    </button>
  )
}

const EYEDROPPER = 'M11 7l6 6M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4z'
const RESET = 'M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4'

/** A colour, in one row: its swatch -- which opens the palette, the system's
    picker and, given `onReset`, the way back to the default -- its hex, and
    the eyedropper. For fill, outline, text and light alike. */
export function ColourField({ label, value, onChange, onReset }: { label: string; value: string; onChange: (colour: string) => void; onReset?: () => void }) {
  const { t } = useTranslation()
  // The hex field keeps its own text while it is being typed, so a half-typed
  // "#3b8" is not pushed onto the shape; it applies once it is a colour.
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  const [open, setOpen] = useState(false)

  const commitDraft = () => {
    if (HEX.test(draft)) onChange(draft)
    else setDraft(value)
  }

  const pick = async () => {
    if (!('EyeDropper' in window)) {
      showToast(t('atrium.error.pickerUnsupported'))
      return
    }
    try {
      const result = await new (window as any).EyeDropper().open()
      onChange(result.sRGBHex)
    } catch {
      // Cancelled.
    }
  }

  const tool = 'w-8 h-8 shrink-0 flex items-center justify-center border border-nier-border/30 text-nier-bg hover:border-nier-border/60 hover:text-nier-strong transition-colors'
  return (
    <div className="space-y-2">
      <Row label={label}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-colour-swatch=""
            aria-expanded={open}
            aria-label={label}
            title={label}
            onClick={() => setOpen(was => !was)}
            className="w-8 h-8 shrink-0 border border-nier-border/50 hover:border-nier-border/80 transition-colors"
            style={{ backgroundColor: HEX.test(value) ? value : 'transparent' }}
          />
          <input
            type="text"
            value={draft}
            aria-label={label}
            onChange={e => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={e => { if (e.key === 'Enter') commitDraft() }}
            placeholder="#3b82f6"
            className="flex-1 min-w-0 h-8 px-2 bg-nier-black border border-nier-border/30 text-nier-bg placeholder-nier-bg/50 focus:outline-none focus:border-nier-border/60 transition-colors font-mono text-xs uppercase"
          />
          <button
            type="button"
            onClick={e => { e.preventDefault(); e.stopPropagation(); void pick() }}
            className={tool}
            title={t('atrium.customize.pickColour')}
            aria-label={t('atrium.customize.pickColour')}
          >
            <MenuIcon d={EYEDROPPER} size={14} />
          </button>
        </div>
      </Row>
      {open && (
        <div data-colour-palette="" className="pl-[6.5rem] space-y-1.5">
          <div className="grid grid-cols-8 gap-1">
            {PALETTE.map(colour => (
              <button
                key={colour}
                type="button"
                onClick={() => onChange(colour)}
                className={`aspect-square border transition-colors ${colour.toLowerCase() === value.toLowerCase() ? 'border-nier-strong' : 'border-nier-border/30 hover:border-nier-border/70'}`}
                style={{ backgroundColor: colour }}
                title={colour}
                aria-label={colour}
              />
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={HEX.test(value) && value.length === 7 ? value : '#3b82f6'}
              onChange={e => onChange(e.target.value)}
              className="flex-1 min-w-0 h-8 cursor-pointer bg-nier-black border border-nier-border/30"
            />
            {onReset && (
              <button type="button" onClick={onReset} className={tool} title={t('atrium.customize.resetDefault')} aria-label={t('atrium.customize.resetDefault')}>
                <MenuIcon d={RESET} size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// `shown`: the value as it reads (92%, 2 px) -- given, the slider is one of
// the Customization panel's rows, the value at its end; not, its label says it.
export function Slider({ label, hint, min, max, step, value, onChange, shown }: {
  label: string; hint?: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void; shown?: string
}) {
  if (shown !== undefined) return (
    <Row label={label} hint={hint}>
      <div className="flex items-center gap-2">
        <input
          type="range" min={min} max={max} step={step} value={value}
          aria-label={label}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="flex-1 min-w-0 accent-nier-bg"
        />
        <span className="w-12 shrink-0 text-right text-[11px] text-nier-strong tabular-nums">{shown}</span>
      </div>
    </Row>
  )
  return (
    <div>
      <label className={LABEL}>{label}</label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-nier-bg"
      />
      {hint && <p className={HINT}>{hint}</p>}
    </div>
  )
}

/**
 * A size in pixels, applied when finished rather than per keystroke -- so
 * clearing the field to type "350" does not resize the shape to 3 and then 35
 * on the way. No maximum: a shape meant to sit behind a whole cluster of traces
 * has to be allowed to be that big, and dragging one out never had a limit.
 */
function SizeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (size: number) => void }) {
  const [draft, setDraft] = useState(String(Math.round(value)))
  useEffect(() => { setDraft(String(Math.round(value))) }, [value])
  const commit = () => {
    const size = Math.round(Number(draft))
    if (Number.isFinite(size) && size >= 1) onCommit(size)
    else setDraft(String(Math.round(value)))
  }
  return (
    <Row label={label}>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        aria-label={label}
        onChange={e => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit() }}
        className="w-full h-8 bg-nier-black text-nier-bg border border-nier-border/30 px-2 font-mono text-xs focus:outline-none focus:border-nier-border/60"
      />
    </Row>
  )
}

/**
 * A line's style -- solid, dashed, dotted (lib/strokeStyle) -- each choice
 * drawn as itself: for a border, an outline, a path or a connection.
 */
export function StrokeStylePicker({ value, onChange }: { value: StrokeStyle | undefined; onChange: (style: StrokeStyle) => void }) {
  const { t } = useTranslation()
  const current = value ?? 'solid'
  return (
    <Row label={t('atrium.customize.strokeStyle')}>
      <Choices
        name="stroke-style"
        value={current}
        onChange={onChange}
        options={STROKE_STYLES.map(style => ({
          value: style,
          title: t(`atrium.customize.stroke.${style}`),
          label: (
            <svg width="32" height="10" viewBox="0 0 32 10" className="mx-auto block" aria-hidden="true">
              <line x1="3" y1="5" x2="29" y2="5" stroke="currentColor" strokeWidth="2" {...dashProps(style, 2)} />
            </svg>
          ),
        }))}
      />
    </Row>
  )
}

/**
 * A trace's scale, in percent, across and down: tied together while Keep
 * proportions is on (as it starts, the way Photoshop links width and height),
 * so changing one changes the other by as much. A flip's sign is kept.
 */
export function ScaleControls({ scaleX, scaleY, onChange }: { scaleX: number; scaleY: number; onChange: (scaleX: number, scaleY: number) => void }) {
  const { t } = useTranslation()
  const [linked, setLinked] = useState(true)
  const signed = (was: number, size: number) => (was < 0 ? -size : size)
  const set = (axis: 'x' | 'y', percent: number) => {
    const next = percent / 100
    if (linked) {
      const ratio = next / (Math.abs(axis === 'x' ? scaleX : scaleY) || 1)
      onChange(scaleX * ratio, scaleY * ratio)
    } else {
      onChange(axis === 'x' ? signed(scaleX, next) : scaleX, axis === 'y' ? signed(scaleY, next) : scaleY)
    }
  }
  return (
    <>
      <SizeInput label={t('atrium.customize.scaleX')} value={Math.abs(scaleX) * 100} onCommit={p => set('x', p)} />
      <SizeInput label={t('atrium.customize.scaleY')} value={Math.abs(scaleY) * 100} onCommit={p => set('y', p)} />
      <Check row label={t('atrium.customize.keepProportions')} checked={linked} onChange={setLinked} />
    </>
  )
}

export default function ShapeStyleControls({ value, onChange, size, onSizeChange, typePicker = true, note, part, switches = false }: {
  value: ShapeStyle
  onChange: (patch: Partial<ShapeStyle>) => void
  /** Off in Batch Edit: shapes and paths are edited apart there, and a type picked for all of them could turn a box into a line with no points. */
  typePicker?: boolean
  /** Beside the heading: which of a selection these are for (Batch Edit). */
  note?: string | null
  /** The shape's box as drawn. Given by both panels, so both show it in the same place. */
  size?: { width: number; height: number }
  onSizeChange?: (width: number, height: number) => void
  /** One part, for a section of the Customization panel (which titles it):
      the kind and a path's line, the size, the fill, the outline. All of
      them, each under its own heading, when not given. */
  part?: 'shape' | 'size' | 'fill' | 'outline'
  /** The fill's and the outline's on/off are in their sections' headings
      (the Customization panel), so not here as well. */
  switches?: boolean
}) {
  const { t } = useTranslation()
  const isPath = value.shapeType === 'path'
  const arrows = (key: 'pathArrowStart' | 'pathArrowEnd', pointer: string) => (
    <Row label={t(key === 'pathArrowStart' ? 'atrium.customize.arrowStart' : 'atrium.customize.arrowEnd')}>
      <Choices
        value={value[key]}
        onChange={kind => onChange({ [key]: kind })}
        options={(['none', 'triangle', 'diamond'] as ArrowKind[]).map(kind => ({
          value: kind,
          label: kind === 'none' ? '—' : kind === 'triangle' ? pointer : '◆',
          title: kind === 'none' ? 'None' : kind === 'triangle' ? 'Arrow' : 'Diamond',
        }))}
      />
    </Row>
  )

  const show = (p: NonNullable<typeof part>) => !part || part === p
  return (
    <div className="space-y-2.5">
      {!part && <SectionRule label={isPath ? t('atrium.trace.shape.path') : t('atrium.customize.shape')} note={note} />}

      {show('shape') && typePicker && (
        <Row label={t('atrium.customize.shapeType')}>
          <Choices
            value={value.shapeType}
            onChange={shapeType => onChange({ shapeType })}
            options={([...BOX_SHAPES, 'path'] as ShapeKind[]).map(kind => ({ value: kind, label: SHAPE_GLYPH[kind], title: t(`atrium.trace.shape.${kind}` as const) }))}
          />
        </Row>
      )}

      {/* A path is sized by the points it passes through, not by a box. */}
      {show('size') && size && onSizeChange && !isPath && (
        <>
          <SizeInput label={t('atrium.trace.width')} value={size.width} onCommit={w => onSizeChange(w, size.height)} />
          <SizeInput label={t('atrium.trace.height')} value={size.height} onCommit={h => onSizeChange(size.width, h)} />
        </>
      )}

      {/* The shape's own: circles have no corners; paths are shaped by their
          points. Not with the outline, which can be off -- they round the
          fill as much. */}
      {show('shape') && value.shapeType !== 'circle' && !isPath && (
        <Slider
          label={t('atrium.customize.rowCorners')}
          hint={t('atrium.customize.roundsCorners')}
          min={0} max={100} step={1} value={value.cornerRadius} shown={`${value.cornerRadius} px`}
          onChange={v => onChange({ cornerRadius: v })}
        />
      )}

      {show('shape') && isPath && (
        <>
          <Slider
            label={t('atrium.customize.rowThickness')}
            hint={t('atrium.customize.pathThickness')}
            min={1} max={20} step={1} value={value.shapeOutlineWidth} shown={`${value.shapeOutlineWidth} px`}
            onChange={v => onChange({ shapeOutlineWidth: v })}
          />
          <StrokeStylePicker value={value.strokeStyle} onChange={strokeStyle => onChange({ strokeStyle })} />
          <Row label={t('atrium.customize.pathStyle')}>
            <Choices
              value={value.pathCurveType}
              onChange={pathCurveType => onChange({ pathCurveType })}
              options={PATH_LINES.map(({ kind, glyph, key }) => ({ value: kind, label: glyph, title: t(key) }))}
            />
          </Row>
          {arrows('pathArrowStart', '◄')}
          {arrows('pathArrowEnd', '►')}
        </>
      )}

      {!part && <SectionRule label={t('atrium.customize.colour')} />}

      {/* A path is a line: its colour and how opaque it is (arrows and
          all), with nothing to fill. */}
      {show('fill') && <ColourField label={isPath ? t('atrium.customize.lineColour') : t('atrium.customize.colour')} value={value.shapeColor} onChange={c => onChange({ shapeColor: c })} />}

      {show('fill') && <Slider
        label={t('atrium.customize.rowOpacity')}
        min={0} max={1} step={0.01} value={value.shapeOpacity} shown={`${Math.round(value.shapeOpacity * 100)}%`}
        onChange={v => onChange({ shapeOpacity: v })}
      />}

      {show('fill') && !isPath && !switches && (
        <Check row checked={value.shapeNoFill} onChange={v => onChange({ shapeNoFill: v })} label={t('atrium.customize.noFill')} />
      )}

      {/* A path is only ever its outline, so it has no switch for one. */}
      {show('outline') && !isPath && !switches && (
        <Check row checked={value.shapeOutlineOnly} onChange={v => onChange({ shapeOutlineOnly: v })} label={t('atrium.customize.showOutline')} />
      )}
      {show('outline') && !isPath && value.shapeOutlineOnly && (
        <>
          <ColourField
            label={t('atrium.customize.colour')}
            value={value.shapeOutlineColor || value.shapeColor}
            onChange={c => onChange({ shapeOutlineColor: c })}
          />
          <Slider
            label={t('atrium.customize.rowThickness')}
            hint={t('atrium.customize.outlineThickness')}
            min={1} max={20} step={1} value={value.shapeOutlineWidth} shown={`${value.shapeOutlineWidth} px`}
            onChange={v => onChange({ shapeOutlineWidth: v })}
          />
          <Slider
            label={t('atrium.customize.rowOpacity')}
            min={0} max={1} step={0.01} value={value.shapeOutlineOpacity} shown={`${Math.round(value.shapeOutlineOpacity * 100)}%`}
            onChange={v => onChange({ shapeOutlineOpacity: v })}
          />
          <StrokeStylePicker value={value.strokeStyle} onChange={strokeStyle => onChange({ strokeStyle })} />
        </>
      )}
    </div>
  )
}
