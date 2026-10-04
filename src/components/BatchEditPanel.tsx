// Batch Edit: several traces changed at once -- the Customization panel's
// form for a selection (components/Customization), in its sections.
//
// Built from lib/traceKinds, as Excalidraw's properties are: a setting shows
// when any trace selected has it, notes which of them it's for when that
// isn't all of them, and changes only those. A switch the traces disagree on
// shows a dash; a value shown is the first of them's. Every change is one
// step of undo (TraceOverlay's onChange).

import type { ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import type { Trace } from '../types/database'
import { has, kindOf, settingsOf, type Setting } from '../lib/traceKinds'
import { CustomizationPanel, KIND_LABEL, Section, type SectionId } from './Customization'
import { TRACE_PRESETS, rememberTracePreset } from '../lib/tracePresets'
import { rememberShapeStyle, shapeStyleOf, type ShapeStyle } from '../lib/shapeStyle'
import ShapeStyleControls, { Check, ColourField, SectionRule, Slider } from './ShapeStyleControls'
import StrokeStyleField from './StrokeStyleField'

export type BatchChange = { ids: string[]; patch: Partial<Trace> }


const SELECT = 'w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60'
const choice = (on: boolean) => `flex-1 px-2 py-2 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
  on ? 'bg-nier-bg text-nier-black border-nier-bg' : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
}`

export default function BatchEditPanel({ traces, lobbyId, userId, zIndex, fontOptions, borderColourOf, onChange, onFont, onDone, actions }: {
  traces: Trace[]
  lobbyId?: string
  userId: string | null
  zIndex: number
  fontOptions: { value: string; label: string }[]
  // A trace type's own border colour, when it has none set.
  borderColourOf: (type: string) => string
  // These changes, as one step of undo.
  onChange: (changes: BatchChange[]) => void
  // A typeface for these text traces, each fitted to its text again.
  onFont: (ids: string[], family: string) => void
  onDone: () => void
  // The panel's foot: what can be done to all of them.
  actions?: ReactNode
}) {
  const { t } = useTranslation()
  const ids = (ts: Trace[]) => ts.map(tr => tr.id)
  const set = (ts: Trace[], patch: Partial<Trace>) => onChange([{ ids: ids(ts), patch }])
  // A switch across several: on for all of them, or some of each.
  const switchOf = (ts: Trace[], on: (tr: Trace) => boolean) => {
    const count = ts.filter(on).length
    return { checked: count === ts.length, mixed: count > 0 && count < ts.length }
  }
  // Which of the selection a setting is for, when it isn't all of it.
  const noteFor = (targets: Trace[]) => targets.length === traces.length
    ? null
    : `${t('atrium.customize.someOf', { count: targets.length, total: traces.length })} · ${[...new Set(targets.map(kindOf))].map(kind => t(KIND_LABEL[kind])).join(', ')}`

  const section = (setting: Setting, targets: Trace[]): { id: SectionId; node: ReactNode }[] => {
    switch (setting) {
      case 'strokes':
        return lobbyId ? [{ id: 'fill', node: <StrokeStyleField key={ids(targets).join(',')} traceIds={ids(targets)} lobbyId={lobbyId} userId={userId} /> }] : []

      case 'shape':
      case 'line': {
        const props = {
          typePicker: false,
          value: shapeStyleOf(targets[0]),
          onChange: (patch: Partial<ShapeStyle>) => {
            set(targets, patch)
            rememberShapeStyle(shapeStyleOf({ ...targets[0], ...patch }))
          },
        }
        return setting === 'shape'
          ? [{ id: 'fill', node: <ShapeStyleControls {...props} part="fill" /> }, { id: 'outline', node: <ShapeStyleControls {...props} part="outline" /> }]
          : [{ id: 'fill', node: <ShapeStyleControls {...props} part="fill" /> }, { id: 'shape', node: <ShapeStyleControls {...props} part="shape" /> }]
      }

      case 'font': {
        const family = targets[0].fontFamily ?? 'sans'
        const mixedFamily = targets.some(tr => (tr.fontFamily ?? 'sans') !== family)
        const scales = switchOf(targets, tr => tr.textScaleWithBox ?? true)
        return [{ id: 'text', node: (
          <div className="space-y-3">
            <div>
              <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.fontFamily')}</label>
              <select value={mixedFamily ? '' : family} onChange={e => { if (e.target.value) onFont(ids(targets), e.target.value) }} className={SELECT}>
                {/* Only while they disagree, and not to be picked. */}
                {mixedFamily && <option value="" disabled>{t('common.mixed')}</option>}
                {fontOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <ColourField label={t('atrium.customize.textColour')} value={targets[0].textColor ?? '#ffffff'} onChange={c => set(targets, { textColor: c })} />
            <div>
              <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.textSizing')}</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => set(targets, { textScaleWithBox: true })} className={choice(scales.checked)}>{t('atrium.controls.scalesWithBox')}</button>
                <button type="button" onClick={() => set(targets, { textScaleWithBox: false })} className={choice(!scales.checked && !scales.mixed)}>{t('atrium.controls.fixedSize')}</button>
              </div>
            </div>
          </div>
        ) }]
      }

      case 'frame': {
        const first = targets[0]
        const border = switchOf(targets, tr => tr.showBorder ?? true)
        const background = switchOf(targets, tr => tr.showBackground ?? true)
        const shadow = switchOf(targets, tr => tr.showShadow ?? true)
        return [
          { id: 'style', node: (
            <>
              {/* The presets: the quickest way to make them look alike, and the
                  atrium's house style from then on, as on one trace. Their font
                  goes only to the text among them. */}
              <div className="grid grid-cols-3 gap-1.5">
                {TRACE_PRESETS.map(preset => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      const texts = targets.filter(tr => has(tr, 'font'))
                      onChange([
                        { ids: ids(targets), patch: { borderColor: preset.border, fillColor: preset.fill, showBorder: true, showBackground: true } },
                        ...(texts.length ? [{ ids: ids(texts), patch: { fontFamily: 'mono', ...(preset.text ? { textColor: preset.text } : {}) } }] : []),
                      ])
                      if (lobbyId) rememberTracePreset(lobbyId, preset.id)
                    }}
                    className="px-2 py-1.5 bg-nier-black border border-nier-border/30 text-nier-bg/80 text-[11px] tracking-[0.12em] uppercase hover:border-nier-border/60 hover:text-nier-strong transition-colors"
                    style={{ borderLeftColor: preset.border, borderLeftWidth: '2px' }}
                  >
                    {t(preset.labelKey as TranslationKey)}
                  </button>
                ))}
              </div>
            </>
          ) },
          { id: 'fill', node: (
            <>
              <Check {...background} label={t('atrium.customize.showBackground')} onChange={on => set(targets, { showBackground: on })} />
              {(background.checked || background.mixed) && (
                <div className="ml-6 space-y-3">
                  <ColourField label={t('atrium.customize.fillColour')} value={first.fillColor || '#191919'} onChange={c => set(targets, { fillColor: c })} />
                  <Slider
                    label={t('atrium.customize.fillOpacity', { value: Math.round((first.fillOpacity ?? 0.95) * 100) })}
                    min={0} max={1} step={0.01} value={first.fillOpacity ?? 0.95}
                    onChange={v => set(targets, { fillOpacity: v })}
                  />
                </div>
              )}
            </>
          ) },
          { id: 'outline', node: (
            <>
              <Check {...border} label={t('atrium.customize.showBorder')} onChange={on => set(targets, { showBorder: on })} />
              {(border.checked || border.mixed) && (
                <div className="ml-6 space-y-3">
                  <ColourField label={t('atrium.customize.borderColour')} value={first.borderColor || borderColourOf(first.type)} onChange={c => set(targets, { borderColor: c })} />
                  <Slider
                    label={t('atrium.customize.borderOpacity', { value: Math.round((first.borderOpacity ?? 1) * 100) })}
                    min={0} max={1} step={0.01} value={first.borderOpacity ?? 1}
                    onChange={v => set(targets, { borderOpacity: v })}
                  />
                  <Slider
                    label={t('atrium.customize.borderThickness', { value: first.borderWidth ?? 2 })}
                    min={1} max={20} step={1} value={first.borderWidth ?? 2}
                    onChange={v => set(targets, { borderWidth: v })}
                  />
                </div>
              )}
              <Slider
                label={t('atrium.customize.borderRadius', { value: first.borderRadius ?? 0 })}
                min={0} max={50} step={1} value={first.borderRadius ?? 0}
                onChange={v => set(targets, { borderRadius: v })}
              />
            </>
          ) },
          { id: 'effects', node: (
            <Check {...shadow} label={t('atrium.customize.softShadow')} hint={t('atrium.customize.softShadowHint')} onChange={on => set(targets, { showShadow: on })} />
          ) },
        ]
      }

      case 'captions':
        return [{ id: 'content', node: (
          <div className="space-y-3">
            <Check {...switchOf(targets, tr => tr.showFilename ?? true)} label={t('atrium.customize.showUsername')} onChange={on => set(targets, { showFilename: on })} />
            <Check {...switchOf(targets, tr => tr.showDescription ?? false)} label={t('atrium.customize.showDescription')} onChange={on => set(targets, { showDescription: on })} />
          </div>
        ) }]

      case 'light': {
        const lit = switchOf(targets, tr => tr.illuminate ?? false)
        const first = targets[0]
        // A path's light is a glow along it, with no radius (renderPathSvg).
        const round = targets.filter(tr => kindOf(tr) !== 'path')
        const glowOnly = round.length === 0
        return [{ id: 'effects', node: (
          <div className="space-y-3">
            <SectionRule label={glowOnly ? t('atrium.controls.glow') : t('atrium.controls.light')} />
            <Check {...lit} label={glowOnly ? t('atrium.controls.enableGlow') : t('atrium.controls.enableLight')} onChange={on => set(targets, { illuminate: on })} />
            {(lit.checked || lit.mixed) && (
              <div className="ml-6 space-y-3">
                <ColourField label={glowOnly ? t('atrium.controls.glowColour') : t('atrium.controls.lightColour')} value={first.lightColor ?? '#ffffff'} onChange={c => set(targets, { lightColor: c })} />
                <Slider
                  label={t('atrium.customize.intensity', { value: (first.lightIntensity ?? 1).toFixed(1) })}
                  min={0} max={2} step={0.1} value={first.lightIntensity ?? 1}
                  onChange={v => set(targets, { lightIntensity: v })}
                />
                {round.length > 0 && (
                  <Slider
                    label={t('atrium.customize.radius', { value: round[0].lightRadius ?? 200 })}
                    min={50} max={3000} step={50} value={round[0].lightRadius ?? 200}
                    onChange={v => set(round, { lightRadius: v })}
                  />
                )}
              </div>
            )}
          </div>
        ) }]
      }

      default:
        return []
    }
  }

  // Every part of every setting, with which of the selection it's for when
  // that isn't all of it.
  const parts = settingsOf(traces).flatMap(({ setting, targets }) =>
    section(setting, targets).map((part, i) => ({ ...part, key: `${setting}-${i}`, note: noteFor(targets) })))
  const TITLE: Partial<Record<SectionId, string>> = {
    style: t('atrium.customize.sectionStyle'),
    fill: t('atrium.customize.sectionFill'),
    outline: t('atrium.customize.sectionOutline'),
    text: t('atrium.customize.sectionText'),
    shape: t('atrium.customize.sectionShape'),
    content: t('atrium.customize.sectionContent'),
    effects: t('atrium.customize.sectionEffects'),
  }
  const ORDER: SectionId[] = ['style', 'fill', 'outline', 'text', 'shape', 'content', 'effects']

  return (
    <CustomizationPanel
      subtitle={t('atrium.customize.batchEdit', { count: traces.length })}
      onClose={onDone}
      closeLabel={t('atrium.customize.done')}
      zIndex={zIndex}
      actions={actions}
    >
      {ORDER.map(id => {
        const here = parts.filter(part => part.id === id)
        if (here.length === 0) return null
        return (
          <Section key={id} id={id} title={TITLE[id] ?? id}>
            {here.map(part => (
              <div key={part.key} className="space-y-3">
                {part.note && <p className="text-nier-bg/55 text-[10px] tracking-wide">{part.note}</p>}
                {part.node}
              </div>
            ))}
          </Section>
        )
      })}
    </CustomizationPanel>
  )
}
