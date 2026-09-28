// A drawing in progress is kept in world units, so it stays where it was
// drawn on the canvas as the view pans and zooms, and is painted -- and
// saved -- through the view it's seen with. It was kept in screen pixels, so
// it slid along with the view instead.
//
// screen = world * zoom + (x, y), as everywhere (lib/worldCamera).

import type { Stroke, StrokePoint, TracePlacement } from './brushes.ts'
import type { View } from './worldCamera.ts'

export const pointToWorld = (x: number, y: number, v: View) => ({ x: (x - v.x) / v.zoom, y: (y - v.y) / v.zoom })

// A stroke kept in world units, as it's drawn at this view: its points and
// its width, which is a width in the world too.
export function strokeOnScreen(stroke: Stroke, v: View): Stroke {
  return {
    ...stroke,
    width: stroke.width * v.zoom,
    points: stroke.points.map((p: StrokePoint) => ({ ...p, x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y })),
  }
}

// A saved drawing's picture being drawn over, from where it sits in the
// world to where it's seen at this view, and back. Its scale is screen
// pixels per world unit (lib/brushes), so it carries the zoom.
export function placementOnScreen(pl: TracePlacement, v: View): TracePlacement {
  return { ...pl, cx: pl.cx * v.zoom + v.x, cy: pl.cy * v.zoom + v.y, scaleX: pl.scaleX * v.zoom, scaleY: pl.scaleY * v.zoom }
}

export function placementInWorld(pl: TracePlacement, v: View): TracePlacement {
  return { ...pl, cx: (pl.cx - v.x) / v.zoom, cy: (pl.cy - v.y) / v.zoom, scaleX: pl.scaleX / v.zoom, scaleY: pl.scaleY / v.zoom }
}

// Whether two views would draw the same.
export const sameView = (a: View | null, b: View) => !!a && a.x === b.x && a.y === b.y && a.zoom === b.zoom
