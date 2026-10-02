// Frames: traces (type 'frame') that hold other traces, and carry them when
// they move.
//
// What a frame holds is written on each trace it holds (frameId), rather than
// read off where things happen to lie, so a frame dragged across other traces
// doesn't take them with it. A trace or a group joins a frame when it's put
// in one -- dropped in it, wrapped in it, or a frame made around it -- and
// leaves when it's taken out. It's in when its middle is: a thing half in is
// wherever most of it is. A group joins and leaves whole, by the middle of
// all of it, so a frame never carries half a group away. Frames hold no
// frames.
//
// A deleted frame leaves its traces' frameId behind, pointing at nothing,
// which reads as no frame; undo brings the frame back holding what it held.

import type { Trace } from '../types/database'

export interface FrameBox {
  cx: number
  cy: number
  halfW: number
  halfH: number
}

export interface Framed {
  id: string
  type: string
  layerId?: string | null
  frameId?: string | null
}

export const isFrame = (trace: { type: string }) => trace.type === 'frame'

// A new frame over `box`, as every frame starts: titled `name`, outlined in
// the atrium's colours, no background, its id the database's to give. At
// `orderKey` -- the bottom of the stack, so what it holds is drawn over it.
export function newFrame(
  box: FrameBox, name: string, who: { userId: string; username: string },
  colours: { border: string; fill: string }, orderKey: string,
): Trace {
  return {
    id: '',
    userId: who.userId,
    username: who.username,
    type: 'frame',
    content: name,
    x: box.cx,
    y: box.cy,
    width: Math.round(box.halfW * 2),
    height: Math.round(box.halfH * 2),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    createdAt: '',
    showBorder: true,
    showBackground: false,
    showShadow: false,
    showFilename: false,
    borderColor: colours.border,
    fillColor: colours.fill,
    borderWidth: 2,
    borderRadius: 8,
    orderKey,
  }
}

export const boxContains = (box: FrameBox, x: number, y: number) =>
  Math.abs(x - box.cx) <= box.halfW && Math.abs(y - box.cy) <= box.halfH

// The frame a point is in: the smallest that holds it, so a small frame lying
// on a big one takes what is put in it.
export function frameAt(frames: { id: string; box: FrameBox }[], x: number, y: number): string | null {
  let best: { id: string; area: number } | null = null
  for (const { id, box } of frames) {
    if (!boxContains(box, x, y)) continue
    const area = box.halfW * box.halfH
    if (!best || area < best.area) best = { id, area }
  }
  return best?.id ?? null
}

// The traces a frame holds, when it exists: frames in `frameIds`, among
// `traces`. For carrying them along in a drag.
export function heldBy<T extends Framed>(frameIds: Set<string>, traces: T[]): T[] {
  if (frameIds.size === 0) return []
  return traces.filter(t => !isFrame(t) && t.frameId != null && frameIds.has(t.frameId))
}

// The traces taken as one: every trace of a group together, or one trace on
// its own. Frames are never held, so they are no unit. `of` limits it to the
// units that have a trace among those ids; `groups` are the ids of the groups
// that exist (a trace naming one that doesn't is on its own).
export function unitsOf<T extends Framed>(traces: T[], groups: Set<string>, of?: Set<string>): T[][] {
  const byGroup = new Map<string, T[]>()
  const units: T[][] = []
  for (const t of traces) {
    if (isFrame(t)) continue
    if (t.layerId && groups.has(t.layerId)) {
      const unit = byGroup.get(t.layerId)
      if (unit) unit.push(t)
      else {
        const fresh = [t]
        byGroup.set(t.layerId, fresh)
        units.push(fresh)
      }
    } else {
      units.push([t])
    }
  }
  return of ? units.filter(unit => unit.some(t => of.has(t.id))) : units
}

// The middle of a unit: of the box around all of its traces.
export function unitMiddle<T>(unit: T[], boxOf: (trace: T) => FrameBox): { x: number; y: number } {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const t of unit) {
    const b = boxOf(t)
    left = Math.min(left, b.cx - b.halfW)
    right = Math.max(right, b.cx + b.halfW)
    top = Math.min(top, b.cy - b.halfH)
    bottom = Math.max(bottom, b.cy + b.halfH)
  }
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

// Where each of these units now belongs, by where its middle is -- only the
// traces whose frame changes: trace id to frame id, or null for none. A
// frameId left pointing at a deleted frame is cleared here, once its trace
// has been placed somewhere else.
export function placeUnits<T extends Framed>(
  units: T[][],
  frames: { id: string; box: FrameBox }[],
  boxOf: (trace: T) => FrameBox,
): Map<string, string | null> {
  const changes = new Map<string, string | null>()
  for (const unit of units) {
    const middle = unitMiddle(unit, boxOf)
    const frame = frameAt(frames, middle.x, middle.y)
    for (const t of unit) if ((t.frameId ?? null) !== frame) changes.set(t.id, frame)
  }
  return changes
}

// Every unit put into one frame, whatever frame it was in: wrapping a
// selection. Only the traces whose frame changes.
export function putInFrame<T extends Framed>(units: T[][], frameId: string): Map<string, string | null> {
  const changes = new Map<string, string | null>()
  for (const unit of units) for (const t of unit) if (t.frameId !== frameId) changes.set(t.id, frameId)
  return changes
}

// A frame drawn around these boxes: their bounds, with room around them.
export function frameAround(boxes: FrameBox[], padding: number): FrameBox {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const b of boxes) {
    left = Math.min(left, b.cx - b.halfW)
    right = Math.max(right, b.cx + b.halfW)
    top = Math.min(top, b.cy - b.halfH)
    bottom = Math.max(bottom, b.cy + b.halfH)
  }
  return {
    cx: (left + right) / 2,
    cy: (top + bottom) / 2,
    halfW: (right - left) / 2 + padding,
    halfH: (bottom - top) / 2 + padding,
  }
}

// Old trace ids to new ones, for an atrium carried somewhere else (an import,
// an upload, a restore as a copy), made up front so a frame and what it holds
// can be written in any order; and a row's frame_id carried across by it.
export function freshIds(rows: { id?: string }[], fresh: () => string): Map<string, string> {
  return new Map(rows.filter(r => r.id).map(r => [r.id!, fresh()]))
}
export const carriedFrameId = (frameId: unknown, ids: Map<string, string>): string | null =>
  typeof frameId === 'string' ? ids.get(frameId) ?? null : null
