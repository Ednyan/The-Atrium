// Everything about how a shape looks, in one shape.
//
// The create panel, the customize panel and the preview drawn while a shape is
// being placed all describe the same thing. They used to each carry their own
// subset -- the create panel knew colour, opacity and corner radius and nothing
// about outlines, so a shape could only get a border after it existed -- and
// this is what makes them the same set. See ShapeStyleControls.

import { dashProps, type StrokeStyle } from './strokeStyle.ts'
import type { Trace } from '../types/database'

// The shapes drawn in a box, in the order they're offered; and a path.
export const BOX_SHAPES = ['rectangle', 'triangle', 'circle', 'diamond', 'parallelogram'] as const
export type BoxShape = typeof BOX_SHAPES[number]
export type ShapeKind = BoxShape | 'path'
export const isBoxShape = (kind: unknown): kind is BoxShape => (BOX_SHAPES as readonly unknown[]).includes(kind)
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
  strokeStyle?: StrokeStyle
}

export const defaultShapeColor = (kind: ShapeKind) => (kind === 'path' ? '#9ca3af' : '#3b82f6')

// An arrowhead's length and width, as a multiple of its line's thickness: on
// the canvas (TraceOverlay) and in an exported picture (lib/exportImage) alike.
// It was 3.5, which left a head barely wider than a thick line.
export const ARROW_SCALE = 4.5

// How a path starts before any has been made (or remembered, below): thick
// enough to read at a glance, ending in an arrow, as the Path tool's icon
// shows. It was 2 wide with no head.
const NEW_PATH: Partial<ShapeStyle> = { shapeOutlineWidth: 4, pathArrowEnd: 'triangle' }

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
    strokeStyle: trace.strokeStyle,
  }
}

// The look a new shape is made with: the last shape's, as it was made or last
// customized -- change one shape's colour and the next is that colour too, as
// in Excalidraw. Lines apart from the filled kinds: a path's colour and
// thickness aren't a box's. Kept on this device (localStorage), which may
// refuse it -- then it's the defaults.
// v2: forgotten once, so the bigger path above is seen instead of a
// remembered thin one.
const LAST_STYLE_KEY = 'atrium.lastShapeStyle.v2'
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
  return shapeStyleOf({ ...(kind === 'path' ? NEW_PATH : {}), ...lastStyles()[slotOf(kind)], shapeType: kind } as Partial<Trace>)
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
    stroke_style: style.strokeStyle,
  }
}

/** "#3b82f6" or "#38f" as the number Pixi takes. Blue for anything unparseable. */
export function colourToNumber(colour: string | undefined): number {
  const hex = (colour ?? '').replace('#', '')
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
  const value = parseInt(full, 16)
  return /^[0-9a-f]{6}$/i.test(full) && Number.isFinite(value) ? value : 0x3b82f6
}

/**
 * How a shape's fill and outline are painted at a zoom -- by TraceOverlay, and
 * by the quick bar's preview as one is dragged out (LobbyScene), so what's
 * dragged out is what appears. The outline's width is in screen pixels (drawn
 * non-scaling), so it carries the zoom: its thickness is in world units.
 */
export function shapePaint(style: Pick<ShapeStyle, 'shapeColor' | 'shapeOpacity' | 'shapeNoFill' | 'shapeOutlineOnly' | 'shapeOutlineColor' | 'shapeOutlineWidth' | 'shapeOutlineOpacity' | 'strokeStyle'>, zoom: number) {
  const outline = style.shapeOutlineOnly
  const strokeWidth = outline ? Math.max(style.shapeOutlineWidth * zoom, 0.5) : 0
  return {
    fill: style.shapeNoFill ? 'none' : style.shapeColor,
    fillOpacity: style.shapeOpacity,
    stroke: outline ? style.shapeOutlineColor || style.shapeColor : 'none',
    strokeOpacity: style.shapeOutlineOpacity,
    strokeWidth,
    // Dashed or dotted, from the outline's width in the atrium, at the zoom.
    dash: dashProps(style.strokeStyle, outline ? style.shapeOutlineWidth : 0, zoom),
  }
}

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
