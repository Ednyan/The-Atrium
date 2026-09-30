// What each kind of trace has to change, in one place.
//
// The Customize panel shows a trace the settings its kind has. Batch Edit
// shows a setting when any trace selected has it -- saying which of them it's
// for when that isn't all of them -- and changes only those, as Excalidraw's
// properties do. Batch Edit used to decide from whichever trace was selected
// first and write to every trace selected, so shapes were offered a border
// colour (a shape draws no border) and no switch for their outline; and the
// Customize panel's own list of which types had a frame had left audio and
// video out, though they draw one like any other.
//
// A new kind of trace, or a new setting, is a line here -- both panels follow.

import { isDrawingTrace } from './brushes.ts'

export type TraceKind = 'text' | 'image' | 'drawing' | 'embed' | 'document' | 'audio' | 'video' | 'frame' | 'shape' | 'path'

export type Setting =
  | 'frame'     // the box it sits in: border, background, rounded corners, shadow
  | 'captions'  // the username and description shown with it
  | 'font'      // typeface, text colour, whether the text scales with its box
  | 'link'      // opened by a click (Customize only: each has its own address)
  | 'shape'     // a shape's fill, outline and corners
  | 'line'      // a path's colour, thickness, curve and arrows
  | 'strokes'   // a drawing's stroke colour
  | 'light'     // the light it gives off; a glow along a path

// Everything drawn in the usual box: every trace that isn't a shape.
const BOXED: readonly Setting[] = ['frame', 'captions', 'light']

export const SETTINGS: Record<TraceKind, readonly Setting[]> = {
  text: ['font', 'link', ...BOXED],
  image: BOXED,
  drawing: ['strokes', ...BOXED],
  embed: ['link', ...BOXED],
  document: BOXED,
  audio: BOXED,
  video: BOXED,
  frame: ['frame', 'light'],
  shape: ['shape', 'link', 'light'],
  path: ['line', 'link', 'light'],
}

type Kinded = { type: string; shapeType?: string | null; mediaUrl?: string | null; content?: string | null }

export function kindOf(trace: Kinded): TraceKind {
  if (trace.type === 'shape') return trace.shapeType === 'path' ? 'path' : 'shape'
  if (trace.type === 'image' && isDrawingTrace(trace)) return 'drawing'
  return trace.type as TraceKind
}

// Whether a trace has a setting. A type nothing here knows has none.
export const has = (trace: Kinded, setting: Setting): boolean => SETTINGS[kindOf(trace)]?.includes(setting) ?? false

// What Batch Edit offers, in the order it shows it.
export const BATCH_SETTINGS: readonly Setting[] = ['strokes', 'shape', 'line', 'font', 'frame', 'captions', 'light']

// Each of `order`'s settings that any of the traces has, with the ones that
// have it.
export function settingsOf<T extends Kinded>(traces: T[], order: readonly Setting[] = BATCH_SETTINGS): { setting: Setting; targets: T[] }[] {
  return order
    .map(setting => ({ setting, targets: traces.filter(t => has(t, setting)) }))
    .filter(section => section.targets.length > 0)
}
