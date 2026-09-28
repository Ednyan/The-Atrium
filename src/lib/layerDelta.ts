// What a layer change did, as the difference between the atrium before and
// after it: groups made, removed or changed (name, place, parent); traces
// added or removed whole, or changed in the fields layer changes touch; and
// connections that went or came with them. Undoing the change applies it
// backwards, redoing it forwards (lib/layerUndo) -- only what this change
// touched, so nothing done before or since is disturbed.
//
// Kept free of the app -- the database and the store are handed in -- so it
// can be tested.

import type { Layer, Trace } from '../types/database'
import { buildTraceInsertRow } from './traceInsert.ts'
import { linkRow, type TraceLink } from './traceLinks.ts'

export interface LayerSnapshot {
  traces: Trace[]
  links: TraceLink[]
  layers: Layer[]
}

// The fields of a trace a layer change writes: where it is in the layers
// (its group and place), its name there, and what the Layer panel toggles.
export const TRACKED_TRACE_FIELDS = ['layerId', 'orderKey', 'layerName', 'content', 'isLocked', 'ignoreClicks', 'enableInteraction'] as const
export type TrackedField = typeof TRACKED_TRACE_FIELDS[number]
export type TrackedValues = Partial<Pick<Trace, TrackedField>>

export const TRACKED_LAYER_FIELDS = ['name', 'orderKey', 'parentId'] as const
export type LayerValues = Partial<Pick<Layer, typeof TRACKED_LAYER_FIELDS[number]>>

export interface LayerDelta {
  layersAdded: Layer[]
  layersRemoved: Layer[]
  layersChanged: { id: string; before: LayerValues; after: LayerValues }[]
  tracesAdded: Trace[]
  tracesRemoved: Trace[]
  tracesChanged: { id: string; before: TrackedValues; after: TrackedValues }[]
  linksAdded: TraceLink[]
  linksRemoved: TraceLink[]
}

// A missing value and a null one are the same place: no group, no key.
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null)

function changes<T extends object, K extends keyof T>(before: T, after: T, fields: readonly K[]) {
  const was: Partial<T> = {}, now: Partial<T> = {}
  let any = false
  for (const field of fields) {
    if (same(before[field], after[field])) continue
    was[field] = before[field] ?? (null as any)
    now[field] = after[field] ?? (null as any)
    any = true
  }
  return any ? { before: was, after: now } : null
}

export function layerDelta(before: LayerSnapshot, after: LayerSnapshot): LayerDelta {
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map(item => [item.id, item]))
  const layersBefore = byId(before.layers), layersAfter = byId(after.layers)
  const tracesBefore = byId(before.traces), tracesAfter = byId(after.traces)
  const linksBefore = byId(before.links), linksAfter = byId(after.links)

  const delta: LayerDelta = {
    layersAdded: after.layers.filter(l => !layersBefore.has(l.id)),
    layersRemoved: before.layers.filter(l => !layersAfter.has(l.id)),
    layersChanged: [],
    tracesAdded: after.traces.filter(t => !tracesBefore.has(t.id)),
    tracesRemoved: before.traces.filter(t => !tracesAfter.has(t.id)),
    tracesChanged: [],
    linksAdded: after.links.filter(l => !linksBefore.has(l.id)),
    linksRemoved: before.links.filter(l => !linksAfter.has(l.id)),
  }
  for (const layer of after.layers) {
    const was = layersBefore.get(layer.id)
    const change = was && was !== layer ? changes(was, layer, TRACKED_LAYER_FIELDS) : null
    if (change) delta.layersChanged.push({ id: layer.id, ...change })
  }
  for (const trace of after.traces) {
    const was = tracesBefore.get(trace.id)
    const change = was && was !== trace ? changes(was, trace, TRACKED_TRACE_FIELDS) : null
    if (change) delta.tracesChanged.push({ id: trace.id, ...change })
  }
  return delta
}

export const deltaIsEmpty = (d: LayerDelta) =>
  !d.layersAdded.length && !d.layersRemoved.length && !d.layersChanged.length &&
  !d.tracesAdded.length && !d.tracesRemoved.length && !d.tracesChanged.length &&
  !d.linksAdded.length && !d.linksRemoved.length

// The same change the other way: undoing it is doing this.
export function reverseDelta(d: LayerDelta): LayerDelta {
  return {
    layersAdded: d.layersRemoved,
    layersRemoved: d.layersAdded,
    layersChanged: d.layersChanged.map(c => ({ id: c.id, before: c.after, after: c.before })),
    tracesAdded: d.tracesRemoved,
    tracesRemoved: d.tracesAdded,
    tracesChanged: d.tracesChanged.map(c => ({ id: c.id, before: c.after, after: c.before })),
    linksAdded: d.linksRemoved,
    linksRemoved: d.linksAdded,
  }
}

// What a delta is applied to: the database (the client's from(table)), the
// store, and a note of each trace it brings in (lib/layerUndo).
export interface LayerDeltaTarget {
  db: { from(table: string): any }
  store: () => {
    layers: Layer[]
    traces: Trace[]
    putLayer(layer: Layer): void
    forgetLayer(id: string): void
    addTrace(trace: Trace): void
    removeTrace(id: string): void
    putLink(link: TraceLink): void
    dropLink(id: string): void
  }
  adopt(traceId: string): void
}

const TRACE_COLUMNS: Record<TrackedField, string> = {
  layerId: 'layer_id',
  orderKey: 'order_key',
  layerName: 'layer_name',
  content: 'content',
  isLocked: 'is_locked',
  ignoreClicks: 'ignore_clicks',
  enableInteraction: 'enable_interaction',
}
const LAYER_COLUMNS: Record<keyof LayerValues, string> = { name: 'name', orderKey: 'order_key', parentId: 'parent_id' }
const columns = (values: object, names: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [names[key], value ?? null]))

// Makes the store and the database what `delta` leads to. Groups come back
// before the traces that go into them and go after the traces leave them;
// connections go before their traces and come back after both their ends.
export async function applyLayerDelta(delta: LayerDelta, to: LayerDeltaTarget): Promise<void> {
  const { db, store } = to
  for (const layer of delta.layersAdded) {
    await db.from('layers').upsert({
      id: layer.id, name: layer.name, order_key: layer.orderKey ?? null, is_group: layer.isGroup,
      parent_id: layer.parentId ?? null, user_id: layer.userId, lobby_id: layer.lobbyId ?? null,
    })
    store().putLayer(layer)
  }
  for (const change of delta.layersChanged) {
    await db.from('layers').update(columns(change.after, LAYER_COLUMNS)).eq('id', change.id)
    const now = store().layers.find(l => l.id === change.id)
    if (now) store().putLayer({ ...now, ...change.after })
  }
  for (const trace of delta.tracesAdded) {
    to.adopt(trace.id)
    await db.from('traces').upsert({
      ...buildTraceInsertRow(trace, trace.userId, trace.username, trace.lobbyId ?? undefined, 0, 0),
      id: trace.id,
      // The row as it was, not as a new trace starts out.
      is_locked: !!trace.isLocked,
    })
    store().addTrace(trace)
  }
  for (const change of delta.tracesChanged) {
    await db.from('traces').update(columns(change.after, TRACE_COLUMNS)).eq('id', change.id)
    const now = store().traces.find(t => t.id === change.id)
    if (now) store().addTrace({ ...now, ...change.after })
  }
  for (const link of delta.linksRemoved) {
    await db.from('trace_links').delete().eq('id', link.id)
    store().dropLink(link.id)
  }
  for (const trace of delta.tracesRemoved) {
    await db.from('traces').delete().eq('id', trace.id)
    store().removeTrace(trace.id)
  }
  for (const link of delta.linksAdded) {
    await db.from('trace_links').upsert(linkRow(link))
    store().putLink(link)
  }
  for (const layer of delta.layersRemoved) {
    await db.from('layers').delete().eq('id', layer.id)
    store().forgetLayer(layer.id)
  }
}
