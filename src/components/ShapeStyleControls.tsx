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

import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'
import { showToast } from '../lib/toast'
import type { ArrowKind, ShapeKind, ShapeStyle } from '../lib/shapeStyle'

const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ffffff', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#000000',
]

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

const LABEL = 'block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2'
const HINT = 'text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5'
const choice = (on: boolean) => `px-3 py-2 text-[10px] tracking-wider uppercase font-mono transition-all border ${
  on
    ? 'bg-nier-bg text-nier-black border-nier-bg'
    : 'bg-transparent text-nier-bg/80 border-nier-border/30 hover:border-nier-border/60 hover:text-nier-bg'
}`

function SectionRule({ label }: { label: string }) {
  return (
    <div className="flex items-baseline gap-3 pt-1">
      <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{label}</span>
      <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
    </div>
  )
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${checked ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
        {checked && <span className="text-nier-bg text-[10px]">✓</span>}
      </div>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="hidden" />
      <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">{label}</span>
    </label>
  )
}

/** Palette, eyedropper, native picker and a hex field -- for fill and outline alike. */
export function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (colour: string) => void }) {
  const { t } = useTranslation()
  // The hex field keeps its own text while it is being typed, so a half-typed
  // "#3b8" is not pushed onto the shape; it applies once it is a colour.
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

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

  return (
    <div>
      <label className={LABEL}>{label}</label>
      <div className="grid grid-cols-8 gap-1.5 mb-3">
        {PALETTE.map(colour => (
          <button
            key={colour}
            type="button"
            onClick={() => onChange(colour)}
            className="w-7 h-7 border border-nier-border/30 hover:border-nier-border/60 transition-all hover:scale-110"
            style={{ backgroundColor: colour }}
            title={colour}
          />
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={e => { e.preventDefault(); e.stopPropagation(); void pick() }}
          className="p-2 border transition-all bg-nier-black border-nier-border/30 text-nier-bg hover:border-nier-border/60"
          title={t('atrium.customize.pickColour')}
        >
          💧
        </button>
        <input
          type="color"
          value={HEX.test(value) && value.length === 7 ? value : '#3b82f6'}
          onChange={e => onChange(e.target.value)}
          className="w-14 h-9 cursor-pointer bg-nier-black border border-nier-border/30"
        />
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={e => { if (e.key === 'Enter') commitDraft() }}
          placeholder="#3b82f6"
          className="flex-1 min-w-0 px-3 py-2 bg-nier-black border border-nier-border/30 text-nier-bg placeholder-nier-bg/50 focus:outline-none focus:border-nier-border/60 transition-colors font-mono text-sm"
        />
      </div>
    </div>
  )
}

export function Slider({ label, hint, min, max, step, value, onChange }: {
  label: string; hint?: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void
}) {
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
    <div>
      <label className={LABEL}>{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={e => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit() }}
        className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
      />
    </div>
  )
}

export default function ShapeStyleControls({ value, onChange, size, onSizeChange, pathExtra }: {
  value: ShapeStyle
  onChange: (patch: Partial<ShapeStyle>) => void
  /** The shape's box as drawn. Given by both panels, so both show it in the same place. */
  size?: { width: number; height: number }
  onSizeChange?: (width: number, height: number) => void
  /** Rendered among the path options: the point editor, which needs a trace that exists. */
  pathExtra?: ReactNode
}) {
  const { t } = useTranslation()
  const isPath = value.shapeType === 'path'
  const arrows = (key: 'pathArrowStart' | 'pathArrowEnd', pointer: string) => (
    <div>
      <label className={LABEL}>{t(key === 'pathArrowStart' ? 'atrium.customize.arrowStart' : 'atrium.customize.arrowEnd')}</label>
      <div className="grid grid-cols-3 gap-2">
        {(['none', 'triangle', 'diamond'] as ArrowKind[]).map(kind => (
          <button key={kind} type="button" onClick={() => onChange({ [key]: kind })} className={choice(value[key] === kind).replace('px-3', 'px-2')}>
            {kind === 'none' && '— None'}
            {kind === 'triangle' && `${pointer} Arrow`}
            {kind === 'diamond' && '◆ Diamond'}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <SectionRule label={t('atrium.customize.shape')} />

      <div>
        <label className={LABEL}>{t('atrium.customize.shapeType')}</label>
        <div className="grid grid-cols-2 gap-2">
          {(['rectangle', 'circle', 'triangle', 'path'] as ShapeKind[]).map(kind => (
            <button key={kind} type="button" onClick={() => onChange({ shapeType: kind })} className={choice(value.shapeType === kind)}>
              {kind === 'rectangle' && '⬛ '}
              {kind === 'circle' && '⚫ '}
              {kind === 'triangle' && '▲ '}
              {kind === 'path' && '〰 '}
              {t(`atrium.trace.shape.${kind}` as const)}
            </button>
          ))}
        </div>
      </div>

      {/* A path is sized by the points it passes through, not by a box. */}
      {size && onSizeChange && !isPath && (
        <div className="grid grid-cols-2 gap-4">
          <SizeInput label={t('atrium.trace.width')} value={size.width} onCommit={w => onSizeChange(w, size.height)} />
          <SizeInput label={t('atrium.trace.height')} value={size.height} onCommit={h => onSizeChange(size.width, h)} />
        </div>
      )}

      {/* Circles have no corners; paths are shaped by their points. */}
      {(value.shapeType === 'rectangle' || value.shapeType === 'triangle') && (
        <Slider
          label={t('atrium.customize.cornerRadiusLabel', { value: value.cornerRadius })}
          hint={t('atrium.customize.roundsCorners')}
          min={0} max={100} step={1} value={value.cornerRadius}
          onChange={v => onChange({ cornerRadius: v })}
        />
      )}

      {isPath && (
        <>
          <Slider
            label={t('atrium.customize.pathThicknessLabel', { value: value.shapeOutlineWidth })}
            hint={t('atrium.customize.pathThickness')}
            min={1} max={20} step={1} value={value.shapeOutlineWidth}
            onChange={v => onChange({ shapeOutlineWidth: v })}
          />
          <div>
            <label className={LABEL}>{t('atrium.customize.pathStyle')}</label>
            <div className="grid grid-cols-2 gap-2">
              {(['straight', 'bezier'] as const).map(kind => (
                <button key={kind} type="button" onClick={() => onChange({ pathCurveType: kind })} className={choice(value.pathCurveType === kind)}>
                  {kind === 'straight' ? '━ Straight' : '〰 Curved'}
                </button>
              ))}
            </div>
          </div>
          {arrows('pathArrowStart', '◄')}
          {arrows('pathArrowEnd', '►')}
          {pathExtra}
        </>
      )}

      <SectionRule label={t('atrium.customize.colour')} />

      <ColourField label={t('atrium.customize.fillColour')} value={value.shapeColor} onChange={c => onChange({ shapeColor: c })} />

      <Slider
        label={t('atrium.customize.fillOpacity', { value: (value.shapeOpacity * 100).toFixed(0) })}
        min={0} max={1} step={0.01} value={value.shapeOpacity}
        onChange={v => onChange({ shapeOpacity: v })}
      />

      <div className="space-y-2">
        <Check checked={value.shapeNoFill} onChange={v => onChange({ shapeNoFill: v })} label={t('atrium.customize.noFill')} />
      </div>

      {/* A path is only ever its outline, so it has no switch for one. */}
      {!isPath && (
        <div>
          <div className="mb-2">
            <Check checked={value.shapeOutlineOnly} onChange={v => onChange({ shapeOutlineOnly: v })} label={t('atrium.customize.showOutline')} />
          </div>
          {value.shapeOutlineOnly && (
            <div className="ml-6 space-y-3">
              <Slider
                label={t('atrium.customize.outlineWidth', { value: value.shapeOutlineWidth })}
                hint={t('atrium.customize.outlineThickness')}
                min={1} max={20} step={1} value={value.shapeOutlineWidth}
                onChange={v => onChange({ shapeOutlineWidth: v })}
              />
              <Slider
                label={t('atrium.customize.outlineOpacity', { value: (value.shapeOutlineOpacity * 100).toFixed(0) })}
                min={0} max={1} step={0.01} value={value.shapeOutlineOpacity}
                onChange={v => onChange({ shapeOutlineOpacity: v })}
              />
            </div>
          )}
        </div>
      )}

      {!isPath && value.shapeOutlineOnly && (
        <ColourField
          label={t('atrium.customize.outlineColour')}
          value={value.shapeOutlineColor || value.shapeColor}
          onChange={c => onChange({ shapeOutlineColor: c })}
        />
      )}
    </div>
  )
}
