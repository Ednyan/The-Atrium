// Copies of traces, written and on the canvas: Duplicate, a paste, the Layer
// panel's. One definition, so a frame is copied the same way from all of them.
//
// A frame is its contents (lib/frames withHeld gives what to copy), so its
// copy holds the copies of what it holds. A group it holds comes as a new
// group, as the Layer panel's Duplicate Group makes, and the threads between
// what's copied come too. Any other copy belongs to the frame it lands in;
// one that stays in its original's group stays in that group's frame.
//
// Copying a frame makes groups and threads as well as traces, so a caller
// records it as one layer change (lib/layerUndo). Traces alone are picked up
// as additions, as any new trace is (TraceOverlay).

import { supabase } from './supabase'
import { useGameStore } from '../store/gameStore'
import { createGroup } from '../hooks/useLayers'
import { freshIds, frameOfCopy, isFrame, type FrameBox } from './frames'
import { inOrder, keyAt, keysOnTop, topLevel, type Ordered } from './order'
import { shiftPoints } from './pathGeometry'
import { isPathTrace, pathWorldBounds } from './pathBounds'
import { traceBox } from './traceGeometry'
import { buildTraceInsertRow } from './traceInsert'
import { carryLinks, linkRow, mapRowToLink } from './traceLinks'
import { nextTextName } from './traceNames'
import type { Trace } from '../types/database'

export interface CopyWho {
  userId: string
  username: string
  lobbyId: string
  // A copied text trace is a new one, with the next free name.
  textName: (n: number) => string
}

function boxOf(trace: Trace): FrameBox {
  const path = isPathTrace(trace) ? pathWorldBounds(trace.shapePoints, trace.shapeOutlineWidth ?? 2) : null
  if (!path) return traceBox(trace)
  return { cx: (path.minX + path.maxX) / 2, cy: (path.minY + path.maxY) / 2, halfW: (path.maxX - path.minX) / 2, halfH: (path.maxY - path.minY) / 2 }
}

const BATCH = 50

// `sources`, each moved by `offset`. The copies, as they now are in the store;
// a write that's refused throws, with what was written before it on the canvas.
export async function copyTraces(sources: Trace[], offset: { x: number; y: number }, who: CopyWho): Promise<Trace[]> {
  const db = supabase
  if (!db || sources.length === 0) return []
  const store = useGameStore.getState()
  const groups = new Map(store.layers.map(layer => [layer.id, layer]))
  const ids = freshIds(sources, () => crypto.randomUUID())
  const copiedFrames = new Set(sources.filter(isFrame).map(frame => frame.id))
  const framesAfter = [
    ...store.traces.filter(isFrame).map(frame => ({ id: frame.id, box: boxOf(frame) })),
    ...sources.filter(isFrame).map(frame => {
      const box = boxOf(frame)
      return { id: ids.get(frame.id)!, box: { ...box, cx: box.cx + offset.x, cy: box.cy + offset.y } }
    }),
  ]

  // Each copy just above its original, among what that's ordered among (its
  // group, or the stack). A pasted trace from another atrium has no original
  // here, and its group isn't this atrium's: it goes on top of the stack.
  const working = new Map<string | null, Ordered[]>()
  const keyAbove = (layerId: string | null, id: string) => {
    if (!working.has(layerId)) working.set(layerId, layerId ? store.traces.filter(t => t.layerId === layerId) : topLevel(store.traces, store.layers))
    const pool = working.get(layerId)!
    const sorted = inOrder(pool)
    const at = sorted.findIndex(item => item.id === id)
    const key = (at === -1 ? null : keyAt(sorted, at + 1)) ?? keysOnTop(pool)[0]
    // Seen by the copies after it, so two from one group don't collide.
    pool.push({ id: `copy-${pool.length}`, orderKey: key })
    return key
  }

  const newGroups = new Map<string, string>()
  for (const trace of sources) {
    const group = trace.layerId ? groups.get(trace.layerId) : undefined
    if (!group || newGroups.has(group.id) || !trace.frameId || !copiedFrames.has(trace.frameId)) continue
    const made = await createGroup(who.lobbyId, `${group.name} copy`, who.userId, keyAbove(null, group.id))
    newGroups.set(group.id, made.id)
  }

  const namedCopies: string[] = []
  const now = new Date().toISOString()
  const copies = sources.map((trace): Trace => {
    const newGroup = trace.layerId ? newGroups.get(trace.layerId) : undefined
    const keptGroup = !newGroup && trace.layerId && groups.has(trace.layerId) ? trace.layerId : null
    // In a new group they keep their keys: a key orders a trace within its
    // group, so the same keys there are the same order.
    const orderKey = newGroup ? trace.orderKey ?? null : keyAbove(keptGroup, trace.id)
    const layerName = trace.type === 'text' ? nextTextName(store.traces, who.textName, namedCopies) : trace.layerName ?? null
    if (trace.type === 'text' && layerName) namedCopies.push(layerName)
    const box = boxOf(trace)
    return {
      ...trace,
      id: ids.get(trace.id)!,
      userId: who.userId,
      username: who.username,
      lobbyId: who.lobbyId,
      x: trace.x + offset.x,
      y: trace.y + offset.y,
      // A path is drawn from its points, not its x/y: they move with it.
      shapePoints: trace.shapePoints && shiftPoints(trace.shapePoints, offset.x, offset.y),
      createdAt: now,
      isLocked: false,
      layerId: newGroup ?? keptGroup,
      frameId: frameOfCopy(trace, ids, !!keptGroup, framesAfter, { x: box.cx + offset.x, y: box.cy + offset.y }),
      orderKey,
      layerName,
    }
  })

  const rows = copies.map((copy, i) => {
    const { frame_id: _frame, layer_id: _layer, ...row } = buildTraceInsertRow(sources[i], who.userId, who.username, who.lobbyId, offset.x, offset.y)
    return {
      ...row,
      id: copy.id,
      created_at: now,
      order_key: copy.orderKey,
      layer_name: copy.layerName,
      layer_id: copy.layerId,
      ...(copy.frameId ? { frame_id: copy.frameId } : {}),
    }
  })
  let written = 0
  let refused: string | null = null
  for (; written < rows.length && !refused; written += BATCH) {
    const { error } = await (db.from('traces') as any).insert(rows.slice(written, written + BATCH))
    if (error) refused = error.message ?? String(error)
    else copies.slice(written, written + BATCH).forEach(copy => useGameStore.getState().addTrace(copy))
  }
  if (refused) throw new Error(refused)

  // Threads, once both their traces are in.
  if (copiedFrames.size > 0) {
    const linkRows = carryLinks(store.links.map(linkRow), ids).map(link => ({ ...link, lobby_id: who.lobbyId }))
    if (linkRows.length > 0) {
      const { data } = await (db.from('trace_links') as any).insert(linkRows).select()
      if (Array.isArray(data)) for (const row of data) useGameStore.getState().receiveLink(mapRowToLink(row))
    }
  }
  window.dispatchEvent(new Event('atrium:layers-changed'))
  return copies
}
