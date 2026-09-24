import { supabase } from './supabase'

// A trace's z_index encodes both which layer it's in and its order within
// that layer: base = layer.zIndex * TRACE_LAYER_MULTIPLIER, then + order
// within the layer. Shared between LayerPanel.tsx (reordering within/between
// layers) and any code that creates a brand-new trace directly into the
// currently-active layer group (LobbyScene.tsx, TracePanel.tsx).
export const TRACE_LAYER_MULTIPLIER = 100

export function getTraceBaseZIndex(layerZIndex: number): number {
  return layerZIndex * TRACE_LAYER_MULTIPLIER
}

// Places a newly-created trace at the top of the given layer group. Returns
// 0 (ungrouped default) if the layer can't be found, e.g. it was deleted
// between the user selecting it and the trace being created.
export async function computeZIndexForNewTraceInLayer(
  layerId: string,
  tracesInLayer: { zIndex?: number | null }[]
): Promise<number> {
  if (!supabase) return 0

  const { data } = await supabase.from('layers').select('z_index').eq('id', layerId).single()
  const layerZIndex = (data as any)?.z_index
  if (layerZIndex === undefined || layerZIndex === null) return 0

  return topOfLayer(getTraceBaseZIndex(layerZIndex), tracesInLayer)
}

// One above everything already in the layer. Base + count alone is not
// enough: a deletion leaves the count lower than the highest z-index still
// in use, and the new trace then tied with or sat under the top one.
export function topOfLayer(baseZ: number, tracesInLayer: { zIndex?: number | null }[]): number {
  return Math.max(baseZ + tracesInLayer.length, ...tracesInLayer.map(t => t.zIndex ?? 0)) + 1
}

// Places a new UNGROUPED trace at the top of the ungrouped section: one above
// the current highest ungrouped z-index (base 0, so always below any group's
// base >= TRACE_LAYER_MULTIPLIER). Without this, ungrouped inserts all landed
// at the DB default z_index of 0, colliding with no defined stacking order.
export function computeZIndexForNewUngroupedTrace(
  traces: { layerId?: string | null; zIndex?: number | null }[]
): number {
  const maxUngrouped = traces
    .filter(t => (t.layerId ?? null) === null)
    .reduce((max, t) => Math.max(max, t.zIndex ?? 0), 0)
  return maxUngrouped + 1
}
