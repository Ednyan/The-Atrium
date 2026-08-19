import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import type { Layer } from '../types/database'
import { TRACE_LAYER_MULTIPLIER } from '../lib/layerZIndex'
import { buildTraceInsertRow } from '../lib/traceInsert'
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition'

// Exported so LobbyScene's canvas-wide file/URL drop handlers can recognize
// (and ignore) this in-app drag, since native drag events bubble through the
// DOM regardless of React component boundaries -- without this, reordering
// traces between layers made the canvas's "drop file to create trace"
// overlay flash on, since the trace row's drag bubbled past any gaps in the
// panel that don't have their own onDragOver/stopPropagation.
export const TRACE_DRAG_DATA_KEY = 'application/x-atrium-trace-id'
// Separate data key from TRACE_DRAG_DATA_KEY so a group-header drag (to
// reorder groups) and a trace-row drag (to move a trace into a different
// group) can share the same drop targets without being confused for each
// other.
//
// Exported for the same reason as TRACE_DRAG_DATA_KEY, and it was missed when
// that one was added: a group drag bubbled to the canvas, which read it as a
// file/link drag and showed the "drop to create trace" overlay. Worse, it got
// stuck there -- the group's own drop handler calls stopPropagation, so the
// canvas drop handler that clears the overlay never ran, and it stayed until
// the page was reloaded.
export const LAYER_DRAG_DATA_KEY = 'application/x-atrium-layer-id'
const UNGROUPED_DROP_TARGET = '__ungrouped__'

// Module scope on purpose. Defined inside LayerPanel's render body, this would
// be a brand-new component type on every render, so React would unmount and
// remount each button rather than update it. LayerPanel calls useGameStore()
// with no selector, so it re-renders on any store change -- including the local
// player's `position`, which updates on every mouse move. The button therefore
// got replaced between mousedown and mouseup and no click event ever fired,
// making the whole menu look dead.
function MenuItem({ label, onClick, danger, disabled, busy, hint }: {
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  // Set while a duplicate/insert round-trip is in flight, so a second click
  // can't kick off a duplicate of the duplicate.
  busy?: boolean
  hint?: string
}) {
  return (
    <button
      disabled={disabled || busy}
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger ? 'text-red-400/80 hover:bg-red-900/30 hover:text-red-300' : 'text-nier-strong hover:bg-nier-blackLight'
      }`}
      title={hint}
    >
      {label}
    </button>
  )
}

interface LayerPanelProps {
  lobbyId: string
  onClose: () => void
  selectedTraceId?: string | null
  // Mirrors TraceOverlay's own multi-selection (shift-click, area-select),
  // so every multi-selected trace/group highlights here too, not just the
  // single selectedTraceId.
  multiSelectedTraceIds?: string[]
  onSelectTrace?: (traceId: string) => void
  onGoToTrace?: (traceId: string) => void
  // The layer group new traces should be created into. Clicking a group
  // header sets this (and selects all its traces); clicking it again, or the
  // Ungrouped section, clears it back to null.
  activeLayerId?: string | null
  onSetActiveLayer?: (layerId: string | null) => void
  onSelectGroupTraces?: (traceIds: string[]) => void
  // Frames the camera on a whole set of traces at once (Go to Group), as
  // opposed to onGoToTrace which centers a single one at the current zoom.
  onGoToTraces?: (traceIds: string[]) => void
  // Mirrors LobbyScene's canEdit (per lobbies.edit_permission_mode). Server
  // enforcement lives in RLS (user_can_edit_lobby on layers/traces); this
  // hides the mutating controls (create/rename/delete group, reordering,
  // moving traces between groups) for a user whose writes would be
  // rejected anyway. Viewing/selecting is unaffected.
  canEdit?: boolean
}

export default function LayerPanel({ lobbyId, onClose, selectedTraceId, multiSelectedTraceIds, onSelectTrace, onGoToTrace, activeLayerId, onSetActiveLayer, onSelectGroupTraces, onGoToTraces, canEdit = true }: LayerPanelProps) {
  const multiSelectedSet = new Set(multiSelectedTraceIds ?? [])
  const { traces, username, userId, setPlayerZIndex, addTrace, removeTrace } = useGameStore()
  const [layers, setLayers] = useState<Layer[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [draggedTraceId, setDraggedTraceId] = useState<string | null>(null)
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  // True while a drag-reorder is being persisted, so we can show a small
  // spinner -- the DB round-trip (plus realtime settling) can take a moment.
  const [isReordering, setIsReordering] = useState(false)
  // Lets the selected-trace effect below scroll the right row into view
  // without any CSS-selector escaping concerns (trace ids are plain UUIDs,
  // but this avoids relying on that).
  const traceRowRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const setTraceRowRef = (traceId: string) => (el: HTMLDivElement | null) => {
    if (el) traceRowRefs.current.set(traceId, el)
    else traceRowRefs.current.delete(traceId)
  }
  // Same idea for group headers, so dragging a group shows the whole header
  // as the drag image instead of just the grip glyph the drag starts on.
  const groupHeaderRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const setGroupHeaderRef = (layerId: string) => (el: HTMLDivElement | null) => {
    if (el) groupHeaderRefs.current.set(layerId, el)
    else groupHeaderRefs.current.delete(layerId)
  }
  // Dialog state for create/rename/delete (replaces prompt/confirm which don't work in Tauri)
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | 'delete' | null>(null)
  const [dialogInput, setDialogInput] = useState('')
  const [dialogTargetId, setDialogTargetId] = useState<string | null>(null)

  // Right-click menu for rows. `kind` decides which actions apply -- groups
  // and traces share the menu component but expose different items, and a
  // grouped trace gets Ungroup while an ungrouped one doesn't.
  const [rowMenu, setRowMenu] = useState<
    { x: number; y: number; kind: 'group' | 'trace'; id: string } | null
  >(null)
  const rowMenuRef = useRef<HTMLDivElement>(null)
  const rowMenuPos = useClampedMenuPosition(rowMenuRef, rowMenu?.x ?? 0, rowMenu?.y ?? 0)
  // Whether the Move to Group flyout is open (its own state so the flyout
  // closes when the menu is re-opened elsewhere).
  const [moveToGroupOpen, setMoveToGroupOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  const openRowMenu = (e: React.MouseEvent, kind: 'group' | 'trace', id: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMoveToGroupOpen(false)
    setRowMenu({ x: e.clientX, y: e.clientY, kind, id })
  }
  const closeRowMenu = () => {
    setRowMenu(null)
    setMoveToGroupOpen(false)
  }

  // Dismiss on any outside click, Escape, or scroll -- a fixed-position menu
  // would otherwise hang in place while the list scrolls underneath it.
  useEffect(() => {
    if (!rowMenu) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[data-layer-row-menu]')) closeRowMenu()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRowMenu() }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', closeRowMenu, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', closeRowMenu, true)
    }
  }, [rowMenu])

  const loadLayers = useCallback(async () => {
    if (!supabase) {
      return
    }

    const { data, error } = await supabase
      .from('layers')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('z_index', { ascending: false })

    if (error || !data) {
      return
    }

    const mappedLayers: Layer[] = data.map((row: any) => ({
      id: row.id,
      createdAt: row.created_at,
      name: row.name,
      zIndex: row.z_index,
      isGroup: row.is_group,
      parentId: row.parent_id,
      userId: row.user_id,
      lobbyId: row.lobby_id,
    }))

    // Self-heal: duplicate z-indexes are not only legacy data. Two people
    // creating a group at the same moment both compute maxZIndex + 1 from
    // their own copy of the list and land on the same number -- which is why
    // this can start happening in a busy atrium on an ordinary day.
    //
    // Duplicates break reordering outright: the renumber in reorderLayers
    // compares each layer's current z_index against its target and skips the
    // write when they match, so with collisions some layers never move. That
    // is the "it said it updated but stayed in the same place" report.
    const hasDuplicateZIndex = new Set(mappedLayers.map(l => l.zIndex)).size !== mappedLayers.length

    // Always render something. This used to `return` before setLayers when
    // duplicates were found, so if the repair below couldn't write -- a
    // viewer without edit rights, or an RLS denial, both of which fail
    // silently -- the panel kept displaying whatever it had loaded before,
    // forever. A reorder would write, reload, hit this branch, and leave the
    // stale list on screen, which looks exactly like "nothing happened".
    setLayers(mappedLayers)

    // Guarded against re-entry: repair calls loadLayers again, and if the
    // writes didn't take, that finds the same duplicates and repairs again.
    // Without this flag that recursion never terminates.
    if (hasDuplicateZIndex && canEdit && !repairInFlightRef.current) {
      repairInFlightRef.current = true
      try {
        await repairDuplicateZIndexes(mappedLayers)
      } finally {
        repairInFlightRef.current = false
      }
    }
  }, [lobbyId, canEdit])

  // True while a duplicate-z_index repair is running, so the reload it
  // triggers can't start another one.
  const repairInFlightRef = useRef(false)

  const repairDuplicateZIndexes = async (layersToFix: Layer[]) => {
    if (!supabase) return

    const sorted = [...layersToFix].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    for (let i = 0; i < sorted.length; i++) {
      await updateLayerZIndex(sorted[i].id, i + 1)
    }

    // Set player z-index to be on top (above all layers)
    setPlayerZIndex(sorted.length + 1)

    await loadLayers()
  }

  // Load layers from database, scoped to this atrium only
  useEffect(() => {
    loadLayers()

    // Subscribe to layer changes for this atrium only
    if (!supabase) return

    const channel = supabase
      .channel(`layers-channel-${lobbyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'layers',
          filter: `lobby_id=eq.${lobbyId}`,
        },
                () => {
          loadLayers()
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [loadLayers, lobbyId])

  const createGroup = () => {
    if (!supabase) {
      alert('Supabase not initialized')
      return
    }
    setDialogMode('create')
    setDialogInput('')
    setDialogTargetId(null)
  }

  const doCreateGroup = async (name: string) => {
    if (!supabase || !name.trim() || !canEdit) return

    // Read the current top from the database rather than from local state.
    // Two people creating a group at once both computed maxZIndex + 1 from
    // their own (equally stale) copy of the list and picked the same number,
    // which is how an atrium that had been fine for weeks suddenly grew
    // duplicate z-indexes and stopped reordering. This narrows the window to
    // the round-trip instead of however long the panel had been open.
    //
    // Still not airtight -- two inserts inside that window can collide -- so
    // the self-heal in loadLayers stays as the backstop.
    const { data: topLayer } = await (supabase
      .from('layers') as any)
      .select('z_index')
      .eq('lobby_id', lobbyId)
      .order('z_index', { ascending: false })
      .limit(1)
      .maybeSingle()

    const maxZIndex = Math.max(topLayer?.z_index ?? 0, ...layers.map(l => l.zIndex), 0)
    const newZIndex = maxZIndex + 1

    const { error } = await (supabase.from('layers') as any).insert({
      name: name.trim(),
      z_index: newZIndex,
      is_group: true,
      user_id: username,
      lobby_id: lobbyId,
    })

    if (error) {
      alert(`Failed to create group: ${error.message}`)
      return
    }

    await loadLayers()
  }

  const deleteGroup = (layerId: string) => {
    if (!supabase) return
    setDialogMode('delete')
    setDialogTargetId(layerId)
  }

  const doDeleteGroup = async (layerId: string) => {
    if (!supabase || !canEdit) return

    // Delete all traces in this group
    const { error: tracesError } = await supabase
      .from('traces')
      .delete()
      .eq('layer_id', layerId)

    if (tracesError) {
      return
    }

    // Delete the group
    const { error } = await supabase.from('layers').delete().eq('id', layerId)

    if (error) {
      console.error('Error deleting group:', error)
      return
    }

    // activeLayerId now persists independently of canvas selection (see
    // LobbyScene's comment on where it used to be cleared) -- but it must
    // still be cleared here, otherwise it'd keep pointing at a group that no
    // longer exists and new traces would silently try to target it.
    if (layerId === activeLayerId) {
      onSetActiveLayer?.(null)
    }

    await loadLayers()
  }

  // Deletes a single trace directly (grouped or ungrouped) -- previously the
  // only way to remove a trace from the Layer panel was to delete its entire
  // group, which took every other trace in it down too.
  const doDeleteTrace = async (traceId: string) => {
    if (!supabase || !canEdit) return

    const { error } = await supabase.from('traces').delete().eq('id', traceId)

    if (error) {
      console.error('Error deleting trace:', error)
      return
    }

    removeTrace(traceId)
  }

  const renameGroup = (layerId: string, currentName: string) => {
    if (!supabase) return
    setDialogMode('rename')
    setDialogInput(currentName)
    setDialogTargetId(layerId)
  }

  const doRenameGroup = async (layerId: string, newName: string) => {
    if (!supabase || !newName.trim() || !canEdit) return

    const { error } = await (supabase.from('layers') as any)
      .update({ name: newName.trim() })
      .eq('id', layerId)

    if (error) {
      console.error('Error renaming group:', error)
      return
    }

    await loadLayers()
  }

  // Deletes the group but keeps its traces, moving them out to Ungrouped.
  // Separate from doDeleteGroup, which takes the contents down with it --
  // as a one-click menu item that needed to be an explicit, distinct choice
  // rather than the only meaning of "Delete".
  const doDeleteGroupKeepTraces = async (layerId: string) => {
    if (!supabase || !canEdit) return

    const groupTraces = getTracesForLayer(layerId)
    if (groupTraces.length > 0) {
      await moveTracesToLayer(groupTraces.map(t => t.id), null)
    }

    const { error } = await supabase.from('layers').delete().eq('id', layerId)
    if (error) {
      console.error('Error deleting group:', error)
      return
    }

    if (layerId === activeLayerId) onSetActiveLayer?.(null)
    await loadLayers()
  }

  // Copies a group and everything in it into a brand-new group, so the copies
  // are independently groupable rather than piling into the original (which is
  // what duplicating the traces alone would do -- they inherit layer_id).
  const duplicateGroup = async (layerId: string) => {
    if (!supabase || !canEdit || !userId) return
    const source = layers.find(l => l.id === layerId)
    if (!source) return

    setIsBusy(true)
    try {
      const maxZIndex = Math.max(...layers.map(l => l.zIndex), 0)
      const { data: created, error: layerError } = await (supabase.from('layers') as any)
        .insert({
          name: `${source.name} copy`,
          z_index: maxZIndex + 1,
          is_group: true,
          user_id: userId,
          lobby_id: lobbyId,
        })
        .select()
        .single()

      if (layerError || !created) {
        console.error('Error duplicating group:', layerError)
        return
      }

      // getTracesForLayer returns top-of-stack first, but getTraceZIndexForOrder
      // treats a higher orderIndex as higher in the stack. Feeding it the list
      // as-is handed the topmost trace the lowest z-index, so every duplicated
      // group came out with its contents flipped. Reversing to bottom-first
      // makes orderIndex ascend with z-index.
      const sourceTraces = [...getTracesForLayer(layerId)].reverse()
      if (sourceTraces.length > 0) {
        const rows = sourceTraces.map((trace, index) => ({
          ...buildTraceInsertRow(trace, userId, username, lobbyId, 0, 0),
          layer_id: created.id,
          z_index: getTraceZIndexForOrder(created.id, created.z_index, index),
        }))
        const { error: tracesError } = await (supabase.from('traces') as any).insert(rows)
        if (tracesError) {
          console.error('Error duplicating group traces:', tracesError)
        }
      }

      await loadLayers()
    } finally {
      setIsBusy(false)
    }
  }

  const duplicateSingleTrace = async (traceId: string) => {
    if (!supabase || !canEdit || !userId) return
    const trace = traces.find(t => t.id === traceId)
    if (!trace) return

    setIsBusy(true)
    try {
      // Same 20px nudge the canvas duplicate uses, so the copy is visibly
      // offset instead of hiding exactly behind the original.
      const row = buildTraceInsertRow(trace, userId, username, lobbyId, 20, 20)
      const { data, error } = await (supabase.from('traces') as any).insert(row).select().single()
      if (error || !data) {
        console.error('Error duplicating trace:', error)
        return
      }
      addTrace({ ...trace, id: data.id, x: trace.x + 20, y: trace.y + 20, createdAt: data.created_at })
    } finally {
      setIsBusy(false)
    }
  }

  const setTraceLocked = async (traceId: string, locked: boolean) => {
    if (!supabase || !canEdit) return
    const { error } = await (supabase.from('traces') as any)
      .update({ is_locked: locked })
      .eq('id', traceId)
    if (error) {
      console.error('Error updating lock:', error)
      return
    }
    const trace = traces.find(t => t.id === traceId)
    if (trace) {
      removeTrace(traceId)
      addTrace({ ...trace, isLocked: locked })
    }
  }

  const moveTraceToLayer = async (traceId: string, layerId: string | null) => {
    if (!supabase || !canEdit) return

    const currentLayerId = traces.find(t => t.id === traceId)?.layerId ?? null
    if (currentLayerId === layerId) return

    // Calculate the z-index for this trace
    let newZIndex: number
    if (layerId === null) {
      const ungroupedTraces = getTracesForLayer(null).filter(t => t.id !== traceId)
      newZIndex = getTraceZIndexForOrder(null, ungroupedTraces.length, ungroupedTraces.length)
    } else {
      // Find the layer and calculate base z-index
      const targetLayer = layers.find(l => l.id === layerId)
      if (!targetLayer) return
      
      // Get existing traces in this layer
      const layerTraces = traces.filter(t => t.layerId === layerId && t.id !== traceId)
      
      newZIndex = getTraceZIndexForOrder(layerId, targetLayer.zIndex, layerTraces.length)
    }

    const { error } = await (supabase.from('traces') as any)
      .update({ layer_id: layerId, z_index: newZIndex })
      .eq('id', traceId)

    if (error) {
      console.error('Error moving trace:', error)
    } else {
      // Optimistic local update - realtime subscription may drop this
      // due to pendingChanges guard, so update the store directly
      const trace = traces.find(t => t.id === traceId)
      if (trace) {
        addTrace({ ...trace, layerId: layerId, zIndex: newZIndex })
      }
    }
  }

  // Moves every trace in the batch to layerId together, computing each
  // one's z-index up front against the target's existing trace count (not
  // by calling moveTraceToLayer in a loop, which would recompute the "next
  // free" z-index from the same stale traces snapshot each time and collide
  // every moved trace onto the same slot).
  const moveTracesToLayer = async (traceIds: string[], layerId: string | null) => {
    if (!supabase || traceIds.length === 0 || !canEdit) return

    const idsToMove = new Set(traceIds)
    const tracesToMove = traces.filter(t => idsToMove.has(t.id) && (t.layerId ?? null) !== layerId)
    if (tracesToMove.length === 0) return

    const baseLayerZIndex = layerId === null ? 0 : (layers.find(l => l.id === layerId)?.zIndex ?? 0)
    const existingInTarget = getTracesForLayer(layerId).filter(t => !idsToMove.has(t.id))
    let orderIndex = existingInTarget.length

    for (const trace of tracesToMove) {
      const newZIndex = getTraceZIndexForOrder(layerId, baseLayerZIndex, orderIndex)
      orderIndex++

      const { error } = await (supabase.from('traces') as any)
        .update({ layer_id: layerId, z_index: newZIndex })
        .eq('id', trace.id)

      if (error) {
        console.error('Error moving trace:', error)
      } else {
        addTrace({ ...trace, layerId: layerId, zIndex: newZIndex })
      }
    }
  }

  const getTraceBaseZIndex = (layerId: string | null, layerZIndex?: number) => {
    if (layerId === null) return 0
    const resolvedLayerZIndex = layerZIndex ?? layers.find(l => l.id === layerId)?.zIndex
    if (resolvedLayerZIndex === undefined) return 0
    return resolvedLayerZIndex * TRACE_LAYER_MULTIPLIER
  }

  const getTraceZIndexForOrder = (layerId: string | null, layerZIndexOrLength: number, orderIndex: number) => {
    if (layerId === null) {
      return orderIndex + 1
    }
    return getTraceBaseZIndex(layerId, layerZIndexOrLength) + orderIndex + 1
  }

  const persistTraceOrder = async (layerId: string | null, orderedTraces: typeof traces, layerZIndex?: number) => {
    if (!supabase) return

    const total = orderedTraces.length
    for (let index = 0; index < total; index++) {
      const trace = orderedTraces[index]
      const orderIndex = total - index - 1
      const newZIndex = layerId === null
        ? getTraceZIndexForOrder(null, 0, orderIndex)
        : getTraceZIndexForOrder(layerId, layerZIndex ?? layers.find(l => l.id === layerId)?.zIndex ?? 0, orderIndex)

      await (supabase.from('traces') as any)
        .update({ z_index: newZIndex })
        .eq('id', trace.id)

      addTrace({ ...trace, zIndex: newZIndex })
    }
  }

  const moveTraceWithinLayer = async (traceId: string, layerId: string | null, direction: 'up' | 'down') => {
    if (!supabase || !canEdit) return

    const orderedTraces = getTracesForLayer(layerId)
    const currentIndex = orderedTraces.findIndex(t => t.id === traceId)
    if (currentIndex === -1) return

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= orderedTraces.length) return

    const reorderedTraces = [...orderedTraces]
    ;[reorderedTraces[currentIndex], reorderedTraces[targetIndex]] = [reorderedTraces[targetIndex], reorderedTraces[currentIndex]]

    const layerZIndex = layerId === null ? undefined : layers.find(l => l.id === layerId)?.zIndex
    setIsReordering(true)
    try {
      await persistTraceOrder(layerId, reorderedTraces, layerZIndex)
    } finally {
      setIsReordering(false)
    }
  }

  // Drops a dragged trace directly onto another trace's row -- inserts it
  // immediately before that trace in its group (moving it into that group
  // first if it wasn't already there), rather than only being able to drop
  // onto a group header (which always lands at the top) or nudge one step
  // via the up/down buttons.
  const moveTraceToPosition = async (traceId: string, targetTraceId: string) => {
    if (!supabase || !canEdit || traceId === targetTraceId) return
    const draggedTrace = traces.find(t => t.id === traceId)
    const targetTrace = traces.find(t => t.id === targetTraceId)
    if (!draggedTrace || !targetTrace) return

    const targetLayerId = targetTrace.layerId ?? null

    if ((draggedTrace.layerId ?? null) !== targetLayerId) {
      const { error } = await (supabase.from('traces') as any)
        .update({ layer_id: targetLayerId })
        .eq('id', traceId)
      if (error) {
        console.error('Error moving trace to layer:', error)
        return
      }
      // Optimistic local update -- realtime subscription may drop this due
      // to the pendingChanges guard, same as moveTraceToLayer above.
      addTrace({ ...draggedTrace, layerId: targetLayerId })
    }

    const existingInTarget = getTracesForLayer(targetLayerId).filter(t => t.id !== traceId)
    const targetIndex = existingInTarget.findIndex(t => t.id === targetTraceId)
    if (targetIndex === -1) return

    const finalOrder = [...existingInTarget]
    finalOrder.splice(targetIndex, 0, { ...draggedTrace, layerId: targetLayerId })

    const layerZIndex = targetLayerId === null ? undefined : layers.find(l => l.id === targetLayerId)?.zIndex
    await persistTraceOrder(targetLayerId, finalOrder, layerZIndex)
  }

  const handleTraceDragStart = (e: React.DragEvent<HTMLElement>, traceId: string) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(TRACE_DRAG_DATA_KEY, traceId)
    // Drag the whole row as the drag image, not the little grip glyph, so
    // it's clear the layer itself is what's moving. The grip's own rect is
    // the drag origin, so offset the image to sit under the cursor.
    const row = traceRowRefs.current.get(traceId)
    if (row) {
      const gripRect = e.currentTarget.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      e.dataTransfer.setDragImage(row, gripRect.left - rowRect.left + 8, gripRect.top - rowRect.top + 8)
    }
    setDraggedTraceId(traceId)
  }

  const handleTraceDragEnd = () => {
    setDraggedTraceId(null)
    setDropTargetId(null)
  }

  const handleTraceRowDragOver = (e: React.DragEvent<HTMLDivElement>, targetTraceId: string) => {
    if (!draggedTraceId || draggedTraceId === targetTraceId) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dropTargetId !== targetTraceId) setDropTargetId(targetTraceId)
  }

  const handleTraceRowDrop = async (e: React.DragEvent<HTMLDivElement>, targetTraceId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const traceId = e.dataTransfer.getData(TRACE_DRAG_DATA_KEY) || draggedTraceId
    setDropTargetId(null)
    setDraggedTraceId(null)
    if (!traceId || traceId === targetTraceId) return

    setIsReordering(true)
    try {
      // Dragging any one of a multi-selection moves the whole selection to
      // the target's group together (landing at the top there, same as
      // dropping on a group header), rather than trying to reason about
      // precise ordering for several traces against one drop point at once.
      if (multiSelectedSet.has(traceId) && multiSelectedSet.size > 1) {
        const targetTrace = traces.find(t => t.id === targetTraceId)
        await moveTracesToLayer(Array.from(multiSelectedSet), targetTrace?.layerId ?? null)
        return
      }
      await moveTraceToPosition(traceId, targetTraceId)
    } finally {
      setIsReordering(false)
    }
  }

  const handleDropTargetDragOver = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
    if (!draggedTraceId) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dropTargetId !== targetId) {
      setDropTargetId(targetId)
    }
  }

  const handleDropTargetDrop = async (e: React.DragEvent<HTMLDivElement>, layerId: string | null) => {
    e.preventDefault()
    e.stopPropagation()

    const traceId = e.dataTransfer.getData(TRACE_DRAG_DATA_KEY) || draggedTraceId
    setDropTargetId(null)
    setDraggedTraceId(null)

    if (!traceId) return

    setIsReordering(true)
    try {
      // Dragging any one of a multi-selection moves the whole selection to
      // the same group together, instead of stranding the rest behind.
      if (multiSelectedSet.has(traceId) && multiSelectedSet.size > 1) {
        await moveTracesToLayer(Array.from(multiSelectedSet), layerId)
      } else {
        await moveTraceToLayer(traceId, layerId)
      }
    } finally {
      setIsReordering(false)
    }
  }

  const handleDropTargetLeave = (targetId: string) => {
    if (dropTargetId === targetId) {
      setDropTargetId(null)
    }
  }

  const handleLayerDragStart = (e: React.DragEvent<HTMLSpanElement>, layerId: string) => {
    if (!canEdit) return
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(LAYER_DRAG_DATA_KEY, layerId)
    // Drag the whole group header as the drag image rather than the grip
    // glyph the drag happens to start on -- otherwise the only thing that
    // moves with the cursor is the little dot grid, which doesn't read as
    // "this group is moving". Same treatment trace rows already got; groups
    // were simply missed. The grip's rect is the drag origin, so the image is
    // offset to keep the cursor where it was within the header.
    const header = groupHeaderRefs.current.get(layerId)
    if (header) {
      const gripRect = e.currentTarget.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      e.dataTransfer.setDragImage(header, gripRect.left - headerRect.left + 8, gripRect.top - headerRect.top + 8)
    }
    setDraggedLayerId(layerId)
  }

  const handleLayerDragEnd = () => {
    setDraggedLayerId(null)
    setDropTargetId(null)
  }

  // Shared with each group card's existing trace-drop-into-group handlers
  // (handleDropTargetDragOver/Drop) -- a group header doubles as both a
  // trace drop target and a group reorder-drop target, disambiguated by
  // whether a layer drag or a trace drag is currently in progress.
  const handleGroupCardDragOver = (e: React.DragEvent<HTMLDivElement>, targetLayerId: string) => {
    if (draggedLayerId) {
      if (draggedLayerId === targetLayerId) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (dropTargetId !== targetLayerId) setDropTargetId(targetLayerId)
      return
    }
    handleDropTargetDragOver(e, targetLayerId)
  }

  const handleGroupCardDrop = async (e: React.DragEvent<HTMLDivElement>, targetLayerId: string) => {
    if (draggedLayerId) {
      e.preventDefault()
      e.stopPropagation()
      const sourceLayerId = draggedLayerId
      setDropTargetId(null)
      setDraggedLayerId(null)
      if (sourceLayerId === targetLayerId) return
      await reorderLayers(sourceLayerId, targetLayerId)
      return
    }
    await handleDropTargetDrop(e, targetLayerId)
  }

  // Moves a group to sit where targetLayerId currently is, renumbering every
  // layer's z_index to match the new visual order (rather than a pairwise
  // swap like moveLayerUp/moveLayerDown, since a drag can reorder across
  // more than one position at once).
  const reorderLayers = async (sourceLayerId: string, targetLayerId: string) => {
    if (!supabase || !canEdit) return

    const sorted = [...layers].sort((a, b) => b.zIndex - a.zIndex)
    const draggedIndex = sorted.findIndex(l => l.id === sourceLayerId)
    const targetIndex = sorted.findIndex(l => l.id === targetLayerId)
    if (draggedIndex === -1 || targetIndex === -1) return

    const reordered = [...sorted]
    const [movedLayer] = reordered.splice(draggedIndex, 1)
    reordered.splice(targetIndex, 0, movedLayer)

    const total = reordered.length
    const renumbered = reordered.map((layer, i) => ({ ...layer, zIndex: total - i }))

    // Show the new order immediately, before anything is written.
    //
    // Persisting a reorder is one request per layer plus one per trace inside
    // every layer that moved, all sequential -- so on the web the panel used
    // to sit unchanged for as long as that took, which is why the desktop
    // (writing to local SQLite) felt instant by comparison. The writes below
    // are unchanged; only the moment the user sees the result has moved.
    //
    // On failure loadLayers() runs regardless and puts back whatever the
    // database actually holds, so an optimistic view can't persist as a lie.
    setLayers(renumbered)

    setIsReordering(true)
    try {
      for (let i = 0; i < total; i++) {
        const newZIndex = total - i
        if (reordered[i].zIndex !== newZIndex) {
          await updateLayerZIndex(reordered[i].id, newZIndex)
        }
      }
      await loadLayers()
    } finally {
      setIsReordering(false)
    }
  }

  const updateLayerZIndex = async (layerId: string, newZIndex: number) => {
    if (!supabase || !canEdit) return

    // .select() so a rejection can't pass for success. RLS doesn't raise on a
    // forbidden UPDATE -- the row simply isn't visible to the statement, so it
    // matches nothing and returns no error. Without this, a blocked write and
    // a successful one are indistinguishable here, and the only symptom is the
    // panel reloading the unchanged order: "it updated but stayed in place".
    const { data: updated, error: layerError } = await (supabase.from('layers') as any)
      .update({ z_index: newZIndex })
      .eq('id', layerId)
      .select('id')

    if (layerError) {
      console.error('Error updating layer z-index:', layerError)
      return
    }

    if (!updated || updated.length === 0) {
      console.warn(
        `Layer ${layerId}: z-index update affected no rows. The row is either gone or write access is denied by RLS (user_can_edit_lobby).`
      )
      return
    }

    await persistTraceOrder(layerId, getTracesForLayer(layerId), newZIndex)
  }

  const toggleGroup = (groupId: string) => {
    const newExpanded = new Set(expandedGroups)
    if (newExpanded.has(groupId)) {
      newExpanded.delete(groupId)
    } else {
      newExpanded.add(groupId)
    }
    setExpandedGroups(newExpanded)
  }

  // Auto-expands whatever group contains the selected trace and scrolls its
  // row into view -- but ONLY once per selection: on a genuine selection
  // change (e.g. clicking a trace on canvas) or the first time this effect
  // sees a given selected trace (which covers the panel being freshly opened
  // while a trace is already selected).
  //
  // Crucially, everything is gated behind a "have we already handled THIS
  // selectedTraceId" ref, so we do NOT fight the user afterwards: once we've
  // expanded + scrolled for a selection, they're free to collapse that group
  // or scroll away, and reorders (which mutate `traces`) won't re-trigger it
  // either. We only mark a selection handled once its trace actually exists
  // in `traces`, so a panel that mounts before traces load still fires once
  // they arrive.
  const handledSelectionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!selectedTraceId) {
      handledSelectionRef.current = null
      return
    }
    if (handledSelectionRef.current === selectedTraceId) return
    const selectedTrace = traces.find(t => t.id === selectedTraceId)
    if (!selectedTrace) return // traces not loaded yet; try again when they are
    handledSelectionRef.current = selectedTraceId
    // Expand the containing group if it's collapsed (one-shot -- if the user
    // later collapses it again we leave it be).
    if (selectedTrace.layerId && !expandedGroups.has(selectedTrace.layerId)) {
      setExpandedGroups(prev => new Set(prev).add(selectedTrace.layerId!))
    }
    const raf = requestAnimationFrame(() => {
      traceRowRefs.current.get(selectedTraceId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [selectedTraceId, traces, expandedGroups])

  // Swaps two layers' z-indexes without ever committing a state where they
  // share one.
  //
  // THIS IS HOW DUPLICATE Z-INDEXES GOT CREATED BY A SINGLE USER. The old
  // version wrote `a := b.zIndex` and then `b := a.zIndex`. Despite the
  // variable being called tempZIndex, there was no temporary value -- between
  // those two writes both rows genuinely held the same number in the
  // database. Anything that stopped the second write made that permanent: a
  // failed request (updateLayerZIndex logs and returns on error), closing the
  // tab, navigating away, going offline.
  //
  // And the window was not small. updateLayerZIndex also rewrites the
  // z-index of every trace in the layer, one request each, sequentially -- so
  // the gap between the two halves of the swap was as long as it took to
  // rewrite an entire group's traces. On a slow or flaky connection that is
  // seconds, with the database sitting in the duplicated state throughout.
  //
  // Parking the first layer on an unused index first costs one extra write
  // and makes every intermediate state collision-free. An interruption now
  // leaves one layer at the top rather than two layers tied.
  const swapLayerZIndexes = async (a: Layer, b: Layer) => {
    const parkingZIndex = Math.max(...layers.map(l => l.zIndex), 0) + 1
    await updateLayerZIndex(a.id, parkingZIndex)
    await updateLayerZIndex(b.id, a.zIndex)
    await updateLayerZIndex(a.id, b.zIndex)
    await loadLayers()
  }

  const moveLayerUp = async (layer: Layer) => {
    if (!supabase || !canEdit) return

    // Find layer above this one
    const sortedLayers = [...layers].sort((a, b) => b.zIndex - a.zIndex)
    const currentIndex = sortedLayers.findIndex(l => l.id === layer.id)
    if (currentIndex === 0) return // Already at top

    // The explicit persistTraceOrder calls that used to follow are gone:
    // updateLayerZIndex already reorders the layer's traces, so each layer's
    // traces were being rewritten twice per move.
    await swapLayerZIndexes(layer, sortedLayers[currentIndex - 1])
  }

  const moveLayerDown = async (layer: Layer) => {
    if (!supabase || !canEdit) return

    const sortedLayers = [...layers].sort((a, b) => b.zIndex - a.zIndex)
    const currentIndex = sortedLayers.findIndex(l => l.id === layer.id)
    if (currentIndex === sortedLayers.length - 1) {
      return
    }

    await swapLayerZIndexes(layer, sortedLayers[currentIndex + 1])
  }

  // Get traces for a specific layer
  const getTracesForLayer = (layerId: string | null) => {
    return traces
      .filter(t => (t.layerId ?? null) === layerId)
      .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0)) // Highest z-index first (top of layer)
  }

  // Get ungrouped traces, sorted the same way grouped traces are (highest
  // z-index first) so the rendered order matches what moveTraceToPosition /
  // moveTraceWithinLayer reason about -- otherwise reordering within the
  // ungrouped section appears to do nothing.
  const ungroupedTraces = getTracesForLayer(null)

  // Self-heal ungrouped z-indexes. A trace created with no active layer is
  // inserted at z_index 0 (the DB default), so multiple ungrouped traces
  // collide at 0 with no defined stacking order -- which is why the top of
  // the ungrouped section wasn't actually the highest-z trace. When we detect
  // colliding z-indexes among ungrouped traces, renumber them into a proper
  // distinct sequence, preserving their current top-to-bottom display order.
  // Ungrouped traces get base 0 (z = 1..N), always below any group (base
  // >= 100), so the whole section stays stacked beneath every group. Editors
  // only; the ref guards against re-entrancy while the async renumber's
  // optimistic updates land, and the distinct-z check stops it re-running
  // once healed.
  const isHealingUngroupedRef = useRef(false)
  useEffect(() => {
    if (!canEdit || isHealingUngroupedRef.current) return
    const ung = getTracesForLayer(null)
    if (ung.length < 2) return
    const zs = ung.map(t => t.zIndex ?? 0)
    if (new Set(zs).size === zs.length) return // already distinct -- nothing to heal
    isHealingUngroupedRef.current = true
    persistTraceOrder(null, ung, undefined).finally(() => { isHealingUngroupedRef.current = false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traces, canEdit])

  // Sort layers by z-index (highest first)
  const sortedLayers = [...layers].sort((a, b) => b.zIndex - a.zIndex)

  // Create a list of layer items
  const allItems = [
    ...sortedLayers.map(l => ({ type: 'layer' as const, data: l, zIndex: l.zIndex })),
  ].sort((a, b) => b.zIndex - a.zIndex)

  return (
    <div 
      data-ui-element="true"
      className="layer-panel panel-in-right fixed w-80 border-2 border-nier-bg shadow-2xl overflow-hidden flex flex-col z-[10000100] pointer-events-auto"
      style={{ 
        backgroundColor: 'rgb(var(--c-ground) / 0.98)',
        top: '80px',
        right: '16px',
        height: 'calc(100vh - 160px)'
      }}
    >
      {/* Corner brackets */}
      <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-bg pointer-events-none" />
      <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-bg pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-bg pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-bg pointer-events-none" />
      
      {/* Header */}
      <div className="bg-nier-black border-b border-nier-border/40 p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rotate-45 border border-gray-400" />
          <h2 className="text-sm text-nier-strong tracking-[0.15em] uppercase">Layers</h2>
          {isReordering && (
            <span
              className="w-3 h-3 border border-nier-border/50 border-t-white rounded-full animate-spin"
              title="Updating order…"
            />
          )}
        </div>
        <div className="flex gap-2">
          {canEdit && (
          <button
            onClick={createGroup}
            className="px-3 py-1 bg-white text-black text-xs tracking-wider uppercase hover:bg-nier-bg transition-colors"
            title="Create new group"
          >
            + Group
          </button>
          )}
          <button
            onClick={onClose}
            className="text-nier-bg/70 hover:text-nier-strong text-lg w-6 h-6 flex items-center justify-center transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {allItems.map((item) => {
          const layer = item.data as Layer
          const layerTraces = getTracesForLayer(layer.id)
          const isExpanded = expandedGroups.has(layer.id)
          
          // Check if this layer can move up or down
          const layerIndex = sortedLayers.findIndex(l => l.id === layer.id)
          const canMoveUp = layerIndex > 0 // Not already at top (highest z-index)
          const canMoveDown = layerIndex < sortedLayers.length - 1 // Not already at bottom (lowest z-index)
          
          // Check if any/all traces in this group are selected
          const hasSelectedTrace = layerTraces.some(t => t.id === selectedTraceId || multiSelectedSet.has(t.id))
          const isGroupFullySelected = layerTraces.length > 0 && layerTraces.every(t => t.id === selectedTraceId || multiSelectedSet.has(t.id))
          const isActiveLayer = activeLayerId === layer.id
          // "Hard selected" (all traces in the group actually selected on
          // canvas, via the diamond icon) gets the amber/yellow treatment;
          // merely focusing the group (soft selection, via its name) or
          // having only some of its traces selected gets blue instead.
          const isHardSelected = isGroupFullySelected

          return (
            <div
              key={layer.id}
              className={`border transition-all ${
                // A static bg-nier-blackLight/80 used to always be present in the
                // base classes here alongside this, which -- since Tailwind
                // resolves same-specificity background-color utilities by
                // stylesheet order, not by className order -- could win over
                // this conditional background regardless of state. Folding
                // the default background into the final else branch below
                // (so only ever one bg-* class is present at a time) makes
                // the highlight actually visible.
                isHardSelected
                  ? 'border-amber-400 bg-amber-900/20 ring-1 ring-amber-400/60'
                  : (isActiveLayer || hasSelectedTrace)
                  ? 'border-blue-400 bg-blue-900/20'
                  : dropTargetId === layer.id
                    ? 'border-emerald-400 bg-emerald-900/20'
                    : 'border-nier-border/40 bg-nier-blackLight/80'
              }`}
              onDragOver={(e) => handleGroupCardDragOver(e, layer.id)}
              onDrop={(e) => handleGroupCardDrop(e, layer.id)}
              onDragLeave={() => handleDropTargetLeave(layer.id)}
            >
              {/* Group header */}
              <div
                ref={setGroupHeaderRef(layer.id)}
                className="p-2 flex items-center justify-between hover:bg-nier-blackLight/50 cursor-pointer"
                onContextMenu={(e) => openRowMenu(e, 'group', layer.id)}
              >
                <div
                  className="flex items-center gap-1 flex-1"
                  title="Drag the grip to reorder groups. Click the arrow to expand/collapse. Click the name to set this group as the target for new traces. Click the diamond icon to select all traces in this group."
                >
                  {canEdit && (
                    // Drawn from divs, not a font glyph (a braille-pattern
                    // grip character here previously) -- whether that glyph
                    // actually renders depends on the system/webview's font
                    // fallback for a fairly obscure Unicode block, so it may
                    // have been invisible (and un-grabbable) for some users,
                    // which looked like drag-reordering not working at all.
                    <span
                      className="grid grid-cols-2 gap-[2px] px-1.5 py-1 cursor-grab active:cursor-grabbing group/grip"
                      style={{ userSelect: 'none', WebkitUserDrag: 'element' } as React.CSSProperties}
                      draggable
                      onDragStart={(e) => handleLayerDragStart(e, layer.id)}
                      onDragEnd={handleLayerDragEnd}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to reorder"
                    >
                      {Array.from({ length: 6 }).map((_, i) => (
                        <span
                          key={i}
                          className="w-[3px] h-[3px] rounded-full bg-gray-500 group-hover/grip:bg-gray-300 pointer-events-none"
                          style={{ userSelect: 'none' }}
                        />
                      ))}
                    </span>
                  )}
                  <span
                    className="text-nier-bg/70 text-xs px-1 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleGroup(layer.id)
                    }}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <div
                    className="flex items-center gap-2 flex-1 cursor-pointer"
                    onClick={() => {
                      // Just focuses the group as the target for new traces --
                      // does NOT select its traces on the canvas. That's the
                      // diamond icon's job (below), kept as a separate click
                      // target so opening/targeting a group doesn't yank the
                      // user's current canvas selection out from under them.
                      if (isActiveLayer) {
                        onSetActiveLayer?.(null)
                      } else {
                        onSetActiveLayer?.(layer.id)
                      }
                    }}
                  >
                    <span
                      className={`text-xs ${isHardSelected ? 'text-amber-400' : 'text-nier-bg/70'} hover:text-amber-300`}
                      title="Select all traces in this group"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isGroupFullySelected) {
                          onSelectGroupTraces?.([])
                        } else {
                          onSelectGroupTraces?.(layerTraces.map(t => t.id))
                          onSetActiveLayer?.(layer.id)
                        }
                      }}
                    >
                      {isHardSelected ? '◆' : '◇'}
                    </span>
                    <span className="text-nier-strong text-xs tracking-wide">{layer.name}</span>
                    <span className="text-nier-bg/80 text-xs">({layerTraces.length})</span>
                    {isActiveLayer && (
                      <span className={`text-xs tracking-wider uppercase ${isHardSelected ? 'text-amber-400' : 'text-blue-400'}`}>Target</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayerUp(layer)
                    }}
                    disabled={!canMoveUp}
                    className={`text-xs px-2 py-1 ${canMoveUp ? 'text-nier-bg/70 hover:text-nier-strong cursor-pointer' : 'text-gray-700 cursor-not-allowed'}`}
                    title={canMoveUp ? "Move up" : "Already at top"}
                  >
                    ▲
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayerDown(layer)
                    }}
                    disabled={!canMoveDown}
                    className={`text-xs px-2 py-1 ${canMoveDown ? 'text-nier-bg/70 hover:text-nier-strong cursor-pointer' : 'text-gray-700 cursor-not-allowed'}`}
                    title={canMoveDown ? "Move down" : "Already at bottom"}
                  >
                    ▼
                  </button>
                  {/* Rename moved to the right-click menu, along with the rest
                      of the group actions -- the header row was running out of
                      space as features accumulated. */}
                  <button
                    onClick={(e) => openRowMenu(e, 'group', layer.id)}
                    className="text-nier-bg/70 hover:text-nier-strong text-xs px-2 py-1"
                    title="More actions (or right-click the group)"
                  >
                    ⋯
                  </button>
                </div>
              </div>

              {/* Traces in group */}
              {isExpanded && (
                <div className="pl-6 pr-2 pb-2 space-y-1">
                  {layerTraces.map((trace) => (
                    <div
                      key={trace.id}
                      ref={setTraceRowRef(trace.id)}
                      className={`bg-nier-black border p-2 flex items-center justify-between text-xs transition-all cursor-pointer hover:bg-nier-blackLight ${
                        dropTargetId === trace.id
                          ? 'border-emerald-400 bg-emerald-900/20'
                          : trace.id === selectedTraceId || multiSelectedSet.has(trace.id)
                          ? 'border-blue-400 bg-blue-900/30'
                          : 'border-nier-border/40'
                      }`}
                      onDragOver={(e) => handleTraceRowDragOver(e, trace.id)}
                      onDrop={(e) => handleTraceRowDrop(e, trace.id)}
                      onContextMenu={(e) => openRowMenu(e, 'trace', trace.id)}
                      onClick={() => {
                        onSelectTrace?.(trace.id)
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {canEdit && (
                          <span
                            className="grid grid-cols-2 gap-[2px] px-1 py-0.5 cursor-grab active:cursor-grabbing group/tgrip shrink-0"
                            style={{ userSelect: 'none', WebkitUserDrag: 'element' } as React.CSSProperties}
                            draggable
                            onDragStart={(e) => { e.stopPropagation(); handleTraceDragStart(e, trace.id) }}
                            onDragEnd={handleTraceDragEnd}
                            onClick={(e) => e.stopPropagation()}
                            title="Drag to reorder"
                          >
                            {Array.from({ length: 6 }).map((_, i) => (
                              <span
                                key={i}
                                className="w-[3px] h-[3px] rounded-full bg-gray-600 group-hover/tgrip:bg-gray-300 pointer-events-none"
                                style={{ userSelect: 'none' }}
                              />
                            ))}
                          </span>
                        )}
                        <span className="text-nier-bg/70 text-xs">
                          {trace.type === 'text' && '◇'}
                          {trace.type === 'image' && '◻'}
                          {trace.type === 'audio' && '♪'}
                          {trace.type === 'video' && '▷'}
                          {trace.type === 'embed' && '⬡'}
                        </span>
                        <span className="text-nier-strong/80 truncate tracking-wide">
                          {trace.content.substring(0, 20) || 'Untitled'}
                        </span>
                        {trace.illuminate && <span className="text-yellow-400 text-xs" title="Emits light">★</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            moveTraceWithinLayer(trace.id, trace.layerId ?? null, 'up')
                          }}
                          disabled={layerTraces.findIndex(t => t.id === trace.id) === 0}
                          className={`text-xs px-1.5 py-0.5 ${layerTraces.findIndex(t => t.id === trace.id) === 0 ? 'text-gray-700 cursor-not-allowed' : 'text-nier-bg/70 hover:text-nier-strong'}`}
                          title="Move up in group"
                        >
                          ▲
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            moveTraceWithinLayer(trace.id, trace.layerId ?? null, 'down')
                          }}
                          disabled={layerTraces.findIndex(t => t.id === trace.id) === layerTraces.length - 1}
                          className={`text-xs px-1.5 py-0.5 ${layerTraces.findIndex(t => t.id === trace.id) === layerTraces.length - 1 ? 'text-gray-700 cursor-not-allowed' : 'text-nier-bg/70 hover:text-nier-strong'}`}
                          title="Move down in group"
                        >
                          ▼
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onGoToTrace?.(trace.id)
                          }}
                          className="text-nier-bg/70 hover:text-nier-strong text-xs px-1.5 py-0.5 hover:bg-gray-600 transition-colors"
                          title="Go to trace"
                        >
                          →
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (multiSelectedSet.has(trace.id) && multiSelectedSet.size > 1) {
                              moveTracesToLayer(Array.from(multiSelectedSet), null)
                            } else {
                              moveTraceToLayer(trace.id, null)
                            }
                          }}
                          className="text-nier-bg/80 hover:text-nier-bg/80 text-xs px-1.5 py-0.5"
                          title="Remove from group"
                        >
                          ↗
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            doDeleteTrace(trace.id)
                          }}
                          className="text-red-400/60 hover:text-red-400 text-xs px-1.5 py-0.5"
                          title="Delete trace"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {/* Ungrouped traces */}
        {ungroupedTraces.length > 0 && (
          <div
            className={`border p-2 transition-all ${
              !activeLayerId
                ? 'border-amber-400 bg-amber-900/10 ring-1 ring-amber-400/60'
                : dropTargetId === UNGROUPED_DROP_TARGET ? 'border-emerald-400 bg-emerald-900/20' : 'border-nier-border/40 bg-nier-black/50'
            }`}
            onDragOver={(e) => handleDropTargetDragOver(e, UNGROUPED_DROP_TARGET)}
            onDrop={(e) => handleDropTargetDrop(e, null)}
            onDragLeave={() => handleDropTargetLeave(UNGROUPED_DROP_TARGET)}
          >
            {/* Same soft/hard split as a group header: clicking the label
                only targets Ungrouped for new traces, and the diamond is what
                selects its traces on canvas. This section used to do both at
                once from a single click, so there was no way to target it
                without also yanking the current canvas selection away. */}
            {(() => {
              const isUngroupedFullySelected = ungroupedTraces.length > 0 &&
                ungroupedTraces.every(t => t.id === selectedTraceId || multiSelectedSet.has(t.id))
              return (
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`text-xs cursor-pointer ${isUngroupedFullySelected ? 'text-amber-400' : 'text-nier-bg/70'} hover:text-amber-300`}
                    title="Select all ungrouped traces"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (isUngroupedFullySelected) {
                        onSelectGroupTraces?.([])
                      } else {
                        onSelectGroupTraces?.(ungroupedTraces.map(t => t.id))
                        onSetActiveLayer?.(null)
                      }
                    }}
                  >
                    {isUngroupedFullySelected ? '◆' : '◇'}
                  </span>
                  <span
                    className="text-nier-bg/70 text-xs tracking-[0.15em] uppercase cursor-pointer hover:text-gray-200"
                    title="Set 'Ungrouped' as the target for new traces"
                    onClick={() => onSetActiveLayer?.(null)}
                  >
                    Ungrouped
                  </span>
                  {!activeLayerId && (
                    <span className={`text-xs tracking-wider uppercase ${isUngroupedFullySelected ? 'text-amber-400' : 'text-blue-400'}`}>Target</span>
                  )}
                </div>
              )
            })()}
            <div className="space-y-1">
              {ungroupedTraces.map((trace) => (
                <div
                  key={trace.id}
                  ref={setTraceRowRef(trace.id)}
                  className={`bg-nier-black border p-2 flex items-center justify-between text-xs transition-all cursor-pointer hover:bg-nier-blackLight ${
                    dropTargetId === trace.id
                      ? 'border-emerald-400 bg-emerald-900/20'
                      : trace.id === selectedTraceId || multiSelectedSet.has(trace.id)
                      ? 'border-blue-400 bg-blue-900/30'
                      : 'border-nier-border/40'
                  }`}
                  onDragOver={(e) => handleTraceRowDragOver(e, trace.id)}
                  onDrop={(e) => handleTraceRowDrop(e, trace.id)}
                  onContextMenu={(e) => openRowMenu(e, 'trace', trace.id)}
                  onClick={() => {
                    onSelectTrace?.(trace.id)
                  }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {canEdit && (
                      <span
                        className="grid grid-cols-2 gap-[2px] px-1 py-0.5 cursor-grab active:cursor-grabbing group/tgrip shrink-0"
                        style={{ userSelect: 'none', WebkitUserDrag: 'element' } as React.CSSProperties}
                        draggable
                        onDragStart={(e) => { e.stopPropagation(); handleTraceDragStart(e, trace.id) }}
                        onDragEnd={handleTraceDragEnd}
                        onClick={(e) => e.stopPropagation()}
                        title="Drag to reorder"
                      >
                        {Array.from({ length: 6 }).map((_, i) => (
                          <span
                            key={i}
                            className="w-[3px] h-[3px] rounded-full bg-gray-600 group-hover/tgrip:bg-gray-300 pointer-events-none"
                            style={{ userSelect: 'none' }}
                          />
                        ))}
                      </span>
                    )}
                    <span className="text-nier-bg/70 text-xs">
                      {trace.type === 'text' && '◇'}
                      {trace.type === 'image' && '◻'}
                      {trace.type === 'audio' && '♪'}
                      {trace.type === 'video' && '▷'}
                      {trace.type === 'embed' && '⬡'}
                    </span>
                    <span className="text-nier-strong/80 truncate tracking-wide">
                      {trace.content.substring(0, 20) || 'Untitled'}
                    </span>
                    {trace.illuminate && <span className="text-yellow-400 text-xs" title="Emits light">★</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        moveTraceWithinLayer(trace.id, null, 'up')
                      }}
                      disabled={ungroupedTraces.findIndex(t => t.id === trace.id) === 0}
                      className={`text-xs px-1.5 py-0.5 ${ungroupedTraces.findIndex(t => t.id === trace.id) === 0 ? 'text-gray-700 cursor-not-allowed' : 'text-nier-bg/70 hover:text-nier-strong'}`}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        moveTraceWithinLayer(trace.id, null, 'down')
                      }}
                      disabled={ungroupedTraces.findIndex(t => t.id === trace.id) === ungroupedTraces.length - 1}
                      className={`text-xs px-1.5 py-0.5 ${ungroupedTraces.findIndex(t => t.id === trace.id) === ungroupedTraces.length - 1 ? 'text-gray-700 cursor-not-allowed' : 'text-nier-bg/70 hover:text-nier-strong'}`}
                      title="Move down"
                    >
                      ▼
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onGoToTrace?.(trace.id)
                      }}
                      className="text-nier-bg/70 hover:text-nier-strong text-xs px-1.5 py-0.5 hover:bg-gray-600 transition-colors"
                      title="Go to trace"
                    >
                      →
                    </button>
                    {/* The "Move to..." dropdown that used to sit here is now
                        the right-click menu's Move to Group flyout. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        doDeleteTrace(trace.id)
                      }}
                      className="text-red-400/60 hover:text-red-400 text-xs px-1.5 py-0.5"
                      title="Delete trace"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Row right-click menu. Fixed-positioned against the viewport (the
          panel itself scrolls), flipped back on-screen when opened near an
          edge so items never land outside the window. */}
      {rowMenu && canEdit && (() => {
        const isGroup = rowMenu.kind === 'group'
        const layer = isGroup ? layers.find(l => l.id === rowMenu.id) : null
        const trace = !isGroup ? traces.find(t => t.id === rowMenu.id) : null
        if (isGroup && !layer) return null
        if (!isGroup && !trace) return null

        const groupTraces = isGroup ? getTracesForLayer(rowMenu.id) : []
        const isExpanded = isGroup ? expandedGroups.has(rowMenu.id) : false
        const MENU_WIDTH = 190

        return (
          <div
            ref={rowMenuRef}
            data-layer-row-menu
            className="panel-in fixed bg-nier-black border border-nier-border/50 shadow-xl z-[10000400] py-1 max-h-[90vh] overflow-y-auto"
            // Position comes from the measured element (see
            // useClampedMenuPosition). The estimated heights that used to be
            // here -- 300 for a group, 260 for a trace -- were guesses, and
            // the menu's real height varies with which entries apply.
            style={{ left: rowMenuPos.x, top: rowMenuPos.y, width: MENU_WIDTH }}
            onContextMenu={(e) => e.preventDefault()}
            // Delegated close: an item's own onClick runs first, then bubbles
            // here. Saves threading a close call through every item, and a
            // disabled button doesn't emit a click at all so it can't close
            // the menu by accident. The Move to Group toggle stops propagation
            // since it expands in place rather than completing an action.
            onClick={closeRowMenu}
          >
            <div className="px-3 py-1 text-xs tracking-[0.15em] uppercase text-nier-bg/80 truncate border-b border-nier-border/30 mb-1">
              {isGroup ? layer!.name : (trace!.content.substring(0, 18) || 'Untitled')}
            </div>

            {isGroup ? (
              <>
                <MenuItem label="Duplicate Group" onClick={() => duplicateGroup(rowMenu.id)} busy={isBusy} />
                <MenuItem label="Rename" onClick={() => renameGroup(rowMenu.id, layer!.name)} />
                <MenuItem
                  label={isExpanded ? 'Collapse' : 'Expand'}
                  onClick={() => toggleGroup(rowMenu.id)}
                />
                <MenuItem
                  label="Select All Traces"
                  onClick={() => {
                    onSelectGroupTraces?.(groupTraces.map(t => t.id))
                    onSetActiveLayer?.(rowMenu.id)
                  }}
                  disabled={groupTraces.length === 0}
                />
                <MenuItem
                  label="Go to Group"
                  onClick={() => onGoToTraces?.(groupTraces.map(t => t.id))}
                  disabled={groupTraces.length === 0}
                  hint="Frame the camera on everything in this group"
                />
                <div className="h-[1px] bg-nier-blackLight my-1" />
                <MenuItem
                  label="Ungroup All"
                  onClick={() => moveTracesToLayer(groupTraces.map(t => t.id), null)}
                  disabled={groupTraces.length === 0}
                  hint="Move every trace out to Ungrouped, keeping the group"
                />
                <MenuItem
                  label="Lock All"
                  onClick={() => { groupTraces.forEach(t => setTraceLocked(t.id, true)) }}
                  disabled={groupTraces.length === 0}
                />
                <MenuItem
                  label="Unlock All"
                  onClick={() => { groupTraces.forEach(t => setTraceLocked(t.id, false)) }}
                  disabled={groupTraces.length === 0}
                />
                <div className="h-[1px] bg-nier-blackLight my-1" />
                <MenuItem
                  label="Delete Group Only"
                  onClick={() => doDeleteGroupKeepTraces(rowMenu.id)}
                  danger
                  hint="Traces move to Ungrouped"
                />
                <MenuItem
                  label={`Delete + ${groupTraces.length} Trace${groupTraces.length === 1 ? '' : 's'}`}
                  onClick={() => deleteGroup(rowMenu.id)}
                  danger
                  hint="Deletes the group and everything inside it"
                />
              </>
            ) : (
              <>
                <MenuItem label="Duplicate" onClick={() => duplicateSingleTrace(rowMenu.id)} busy={isBusy} />
                <MenuItem label="Select" onClick={() => onSelectTrace?.(rowMenu.id)} />
                <MenuItem label="Go to Trace" onClick={() => onGoToTrace?.(rowMenu.id)} />
                <MenuItem
                  label={trace!.isLocked ? 'Unlock' : 'Lock'}
                  onClick={() => setTraceLocked(rowMenu.id, !trace!.isLocked)}
                  hint={trace!.isLocked ? 'Allow selecting/dragging on the canvas' : 'Prevent selecting/dragging on the canvas'}
                />
                <div className="h-[1px] bg-nier-blackLight my-1" />
                {/* Inline flyout rather than a hover submenu -- the panel is
                    narrow and a side flyout would open off-screen as often as
                    not. */}
                <button
                  onClick={(e) => { e.stopPropagation(); setMoveToGroupOpen(o => !o) }}
                  className="w-full text-left px-3 py-1.5 text-sm tracking-wider text-nier-strong hover:bg-nier-blackLight flex items-center justify-between"
                >
                  Move to Group <span className="text-nier-bg/80">{moveToGroupOpen ? '▾' : '▸'}</span>
                </button>
                {moveToGroupOpen && (
                  <div className="max-h-40 overflow-y-auto border-y border-nier-border/30 my-1 bg-nier-black/60">
                    {layers.length === 0 && (
                      <div className="px-4 py-1.5 text-xs text-nier-bg/80 italic">No groups yet</div>
                    )}
                    {layers.map(l => (
                      <button
                        key={l.id}
                        disabled={(trace!.layerId ?? null) === l.id}
                        onClick={() => { moveTraceToLayer(rowMenu.id, l.id); closeRowMenu() }}
                        className="w-full text-left px-4 py-1.5 text-xs tracking-wider text-nier-strong hover:bg-nier-blackLight disabled:opacity-30 disabled:cursor-not-allowed truncate"
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                )}
                {trace!.layerId && (
                  <MenuItem
                    label="Ungroup"
                    onClick={() => moveTraceToLayer(rowMenu.id, null)}
                    hint="Move this trace out to Ungrouped"
                  />
                )}
                <div className="h-[1px] bg-nier-blackLight my-1" />
                <MenuItem label="Delete" onClick={() => doDeleteTrace(rowMenu.id)} danger />
              </>
            )}
          </div>
        )
      })()}

      {/* Dialog for create/rename/delete */}
      {dialogMode && (
        <div className="absolute inset-0 bg-nier-black/70 flex items-center justify-center z-50">
          <div className="bg-nier-black border-2 border-nier-bg p-4 w-64">
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-nier-bg pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-nier-bg pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-nier-bg pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-nier-bg pointer-events-none" />

            {dialogMode === 'delete' ? (
              <>
                <p className="text-nier-strong text-xs tracking-[0.15em] uppercase mb-4">
                  Delete this group and all traces inside it?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (dialogTargetId) doDeleteGroup(dialogTargetId)
                      setDialogMode(null)
                    }}
                    className="flex-1 bg-red-900 hover:bg-red-700 text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDialogMode(null)}
                    className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-nier-strong text-xs tracking-[0.15em] uppercase mb-3">
                  {dialogMode === 'create' ? 'New Group Name' : 'Rename Group'}
                </p>
                <input
                  autoFocus
                  type="text"
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dialogInput.trim()) {
                      if (dialogMode === 'create') doCreateGroup(dialogInput)
                      else if (dialogMode === 'rename' && dialogTargetId) doRenameGroup(dialogTargetId, dialogInput)
                      setDialogMode(null)
                    }
                    if (e.key === 'Escape') setDialogMode(null)
                  }}
                  className="w-full bg-nier-black border border-nier-border/40 text-nier-strong text-xs px-3 py-2 mb-3 focus:border-nier-bg focus:outline-none tracking-wider"
                  placeholder="Group name..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (dialogInput.trim()) {
                        if (dialogMode === 'create') doCreateGroup(dialogInput)
                        else if (dialogMode === 'rename' && dialogTargetId) doRenameGroup(dialogTargetId, dialogInput)
                      }
                      setDialogMode(null)
                    }}
                    className="flex-1 bg-white hover:bg-nier-bg text-black py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    {dialogMode === 'create' ? 'Create' : 'Rename'}
                  </button>
                  <button
                    onClick={() => setDialogMode(null)}
                    className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
