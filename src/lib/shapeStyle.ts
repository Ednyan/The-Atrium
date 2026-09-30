// Everything about how a shape looks, in one shape.
//
// The create panel, the customize panel and the preview drawn while a shape is
// being placed all describe the same thing. They used to each carry their own
// subset -- the create panel knew colour, opacity and corner radius and nothing
// about outlines, so a shape could only get a border after it existed -- and
// this is what makes them the same set. See ShapeStyleControls.

import type { Trace } from '../types/database'

export type ShapeKind = 'rectangle' | 'circle' | 'triangle' | 'path'
export type ArrowKind = 'none' | 'triangle' | 'diamond'

export interface ShapeStyle {
  shapeType: ShapeKind
  shapeColor: string
  shapeOpacity: number
  shapeNoFill: boolean
  /** "Show outline". The name is historical; it does not remove the fill. */
  shapeOutlineOnly: boolean
  /** Falls back to the fill colour when unset, as the renderer does. */
  shapeOutlineColor?: string
  /** Also a path's thickness -- a path is only ever its outline. */
  shapeOutlineWidth: number
  shapeOutlineOpacity: number
  cornerRadius: number
  pathCurveType: 'straight' | 'bezier' | 'elbow'
  pathArrowStart: ArrowKind
  pathArrowEnd: ArrowKind
}

export const defaultShapeColor = (kind: ShapeKind) => (kind === 'path' ? '#9ca3af' : '#3b82f6')

/** A trace's style with every default the renderer applies filled in. */
export function shapeStyleOf(trace: Partial<Trace>): ShapeStyle {
  const shapeType = (trace.shapeType ?? 'rectangle') as ShapeKind
  return {
    shapeType,
    shapeColor: trace.shapeColor || defaultShapeColor(shapeType),
    shapeOpacity: trace.shapeOpacity ?? 1,
    shapeNoFill: trace.shapeNoFill ?? false,
    shapeOutlineOnly: trace.shapeOutlineOnly ?? false,
    shapeOutlineColor: trace.shapeOutlineColor || undefined,
    shapeOutlineWidth: trace.shapeOutlineWidth ?? 2,
    shapeOutlineOpacity: trace.shapeOutlineOpacity ?? 1,
    cornerRadius: trace.cornerRadius ?? 0,
    pathCurveType: (trace.pathCurveType as ShapeStyle['pathCurveType']) ?? 'straight',
    pathArrowStart: (trace.pathArrowStart as ArrowKind) ?? 'none',
    pathArrowEnd: (trace.pathArrowEnd as ArrowKind) ?? 'none',
  }
}

// The look a new shape is made with: the last shape's, as it was made or last
// customized -- change one shape's colour and the next is that colour too, as
// in Excalidraw. Lines apart from the filled kinds: a path's colour and
// thickness aren't a box's. Kept on this device (localStorage), which may
// refuse it -- then it's the defaults.
const LAST_STYLE_KEY = 'atrium.lastShapeStyle'
const slotOf = (kind: ShapeKind) => (kind === 'path' ? 'path' : 'filled')

function lastStyles(): Record<string, Partial<ShapeStyle>> {
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_STYLE_KEY) ?? '{}')
    return stored && typeof stored === 'object' ? stored : {}
  } catch {
    return {}
  }
}

export function rememberShapeStyle(style: ShapeStyle) {
  const { shapeType, ...look } = style
  try {
    localStorage.setItem(LAST_STYLE_KEY, JSON.stringify({ ...lastStyles(), [slotOf(shapeType)]: look }))
  } catch {
    // Not kept; the next shape has the defaults.
  }
}

/** The style a new shape of `kind` starts with. */
export function nextShapeStyle(kind: ShapeKind): ShapeStyle {
  return shapeStyleOf({ ...lastStyles()[slotOf(kind)], shapeType: kind } as Partial<Trace>)
}

/** The same style as database columns, for an insert. */
export function shapeStyleColumns(style: ShapeStyle) {
  return {
    shape_type: style.shapeType,
    shape_color: style.shapeColor,
    shape_opacity: style.shapeOpacity,
    shape_no_fill: style.shapeNoFill,
    shape_outline_only: style.shapeOutlineOnly,
    shape_outline_color: style.shapeOutlineColor ?? null,
    shape_outline_width: style.shapeOutlineWidth,
    shape_outline_opacity: style.shapeOutlineOpacity,
    corner_radius: style.cornerRadius,
    path_curve_type: style.pathCurveType,
    path_arrow_start: style.pathArrowStart,
    path_arrow_end: style.pathArrowEnd,
  }
}

/**
 * A shape still being placed: its full style plus the size dragged out or
 * typed. The canvas draws this as a preview, so the preview can show exactly
 * what is being made -- colour, outline and all -- rather than a grey outline.
 */
export type ShapeDraft = ShapeStyle & { width: number; height: number }

/** True when two drafts would draw identically. */
export function sameShapeDraft(a: ShapeDraft | null, b: ShapeDraft | null): boolean {
  if (!a || !b) return a === b
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ShapeDraft>
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

/** "#3b82f6" or "#38f" as the number Pixi takes. Blue for anything unparseable. */
export function colourToNumber(colour: string | undefined): number {
  const hex = (colour ?? '').replace('#', '')
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
  const value = parseInt(full, 16)
  return /^[0-9a-f]{6}$/i.test(full) && Number.isFinite(value) ? value : 0x3b82f6
}

/**
 * How opaque a shape is drawn while it is still being made or edited -- the
 * placement preview and a shape whose customize panel is open use the same, so
 * the two states read as one.
 */
export const PREVIEW_OPACITY = 0.6

/**
 * The breathing frame's colour: near-black on a light atrium, white on a dark
 * one, so it is always the far end of the range from what it is drawn on.
 * Rec. 709 luminance -- green dominates perceived brightness, so a plain
 * average would call a saturated green background dark.
 */
// Plain text on the atrium's background: black on a light one, white on a
// dark one -- decided as it's made, on the background there then.
export const textColourOn = (background: string | undefined) => (previewFrameColour(background) === 0xffffff ? '#ffffff' : '#000000')

export function previewFrameColour(background: string | undefined): number {
  const value = colourToNumber(background ?? '#0a0a0f')
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 ? 0x1a1a1a : 0xffffff
}
