// Copy Style and Paste Style, as Excalidraw's: one trace's look given to
// others. Each takes what it has of it -- the fields of every setting both
// have (lib/traceKinds) -- so a text's frame, captions and light go to a
// drawing, and a rectangle's colour and thickness to a path. A drawing's
// strokes go to other drawings (lib/drawingFiles changeStrokes).
//
// A value left unset shows its default, so it's copied as that default:
// pasted, the other trace looks the same, not as it did. A colour whose
// default depends on the kind of trace is copied as unset (null), and each
// shows its own.

import { asStrokeData, strokesIn, type Stroke } from './brushes.ts'
import { shapeStyleOf } from './shapeStyle.ts'
import { styleFieldsOf } from './traceKinds.ts'
import type { Trace } from '../types/database'

export type StrokeStyle = Partial<Pick<Stroke, 'color' | 'width' | 'brush' | 'hardness'>>

export interface TraceStyle {
  fields: Partial<Record<keyof Trace, unknown>>
  // A drawing's first stroke, for the drawings it's pasted on.
  strokes: StrokeStyle | null
}

const DEFAULTS: Partial<Record<keyof Trace, unknown>> = {
  showBorder: true, borderColor: null, borderOpacity: 1, borderWidth: 2, strokeStyle: 'solid',
  showBackground: true, fillColor: null, fillOpacity: 0.95, borderRadius: 0, showShadow: true,
  showFilename: true, showDescription: false,
  fontFamily: 'sans', fontSize: 16, textColor: '#ffffff', textBold: false, textItalic: false,
  textUnderline: false, textAlign: 'center', textScaleWithBox: true, textFit: false, textValign: 'middle',
  illuminate: false, lightColor: '#ffffff', lightIntensity: 1, lightRadius: 200, lightPulse: false, lightPulseSpeed: 2, lightEmit: 'center',
}

// What a trace shows for a field: its value, or the default drawn in its
// place, or -- for a field with no default of its own -- null. Undo records a
// change from this (TraceOverlay updateTraceCustomization), so taking a value
// back writes the default rather than leaving the changed value in the row:
// an unset field isn't written at all.
export function shownValue(trace: Partial<Trace>, field: keyof Trace): unknown {
  if (trace[field] !== undefined && trace[field] !== null) return trace[field]
  if (trace.type === 'shape' && SHAPE_FIELDS.has(field)) return (shapeStyleOf(trace) as unknown as Record<string, unknown>)[field] ?? null
  return DEFAULTS[field] ?? null
}
const SHAPE_FIELDS = new Set<string>(['shapeColor', 'shapeOpacity', 'shapeNoFill', 'shapeOutlineOnly', 'shapeOutlineColor', 'shapeOutlineWidth', 'shapeOutlineOpacity', 'cornerRadius', 'pathCurveType', 'pathArrowStart', 'pathArrowEnd'])

export function styleOf(trace: Trace): TraceStyle {
  const fields: TraceStyle['fields'] = {}
  for (const field of styleFieldsOf(trace)) fields[field] = shownValue(trace, field)
  const data = asStrokeData(trace.strokeData)
  const stroke = data ? strokesIn(data)[0] : undefined
  return {
    fields,
    strokes: stroke ? { color: stroke.color, width: stroke.width, brush: stroke.brush, hardness: stroke.hardness } : null,
  }
}

// What of `style` a trace takes: those of its fields the style has, where
// they differ. Nothing when it shares no setting with where the style came from.
export function stylePatchFor(trace: Trace, style: TraceStyle): Partial<Trace> {
  const patch: Record<string, unknown> = {}
  for (const field of styleFieldsOf(trace)) {
    if (!(field in style.fields)) continue
    const value = style.fields[field]
    if ((trace[field] ?? null) !== value) patch[field] = value
  }
  return patch as Partial<Trace>
}

// The style copied, for the session: what Paste Style gives.
let copied: TraceStyle | null = null
export const copyStyle = (trace: Trace) => { copied = styleOf(trace) }
export const copiedStyle = () => copied
