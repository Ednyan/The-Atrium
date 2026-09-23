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
  pathCurveType: 'straight' | 'bezier'
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
