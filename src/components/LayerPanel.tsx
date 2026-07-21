import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import type { Layer } from '../types/database'
import { TRACE_LAYER_MULTIPLIER } from '../lib/layerZIndex'

// Exported so LobbyScene's canvas-wide file/URL drop handlers can recognize
// (and ignore) this in-app drag, since native drag events bubble through the
// DOM regardless of React component boundaries -- without this, reordering
// traces between layers made the canvas's "drop file to create trace"
// overlay flash on, since the trace row's drag bubbled past any gaps in the
// panel that don't have their own onDragOver/stopPropagation.
export const TRACE_DRAG_DATA_KEY = 'application/x-atrium-trace-id'
const UNGROUPED_DROP_TARGET = '__ungrouped__'

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
  // Mirrors LobbyScene's canEdit (per lobbies.edit_permission_mode). Server
  // enforcement lives in RLS (user_can_edit_lobby on layers/traces); this
  // hides the mutating controls (create/rename/delete group, reordering,
  // moving traces between groups) for a user whose writes would be
  // rejected anyway. Viewing/selecting is unaffected.
  canEdit?: boolean
}

export default function LayerPanel({ lobbyId, onClose, selectedTraceId, multiSelectedTraceIds, onSelectTrace, onGoToTrace, activeLayerId, onSetActiveLayer, onSelectGroupTraces, canEdit = true }: LayerPanelProps) {
  const multiSelectedSet = new Set(multiSelectedTraceIds ?? [])
  const { traces, username, setPlayerZIndex, addTrace, removeTrace } = useGameStore()
  const [layers, setLayers] = useState<Layer[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [draggedTraceId, setDraggedTraceId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  // Dialog state for create/rename/delete (replaces prompt/confirm which don't work in Tauri)
  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | 'delete' | null>(null)
  const [dialogInput, setDialogInput] = useState('')
  const [dialogTargetId, setDialogTargetId] = useState<string | null>(null)

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

    // Self-heal: duplicate z-indexes can only happen from legacy data (this
    // atrium's layers used to be computed against every atrium's layers
    // combined, before the cross-atrium leak fix scoped them by lobby_id) --
    // silently renumber instead of requiring the user to find a manual "Fix"
    // button.
    const hasDuplicateZIndex = new Set(mappedLayers.map(l => l.zIndex)).size !== mappedLayers.length
    if (hasDuplicateZIndex) {
      await repairDuplicateZIndexes(mappedLayers)
      return
    }

    setLayers(mappedLayers)
  }, [lobbyId])

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

    const maxZIndex = Math.max(...layers.map(l => l.zIndex), 0)
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
    await persistTraceOrder(layerId, reorderedTraces, layerZIndex)
  }

  const handleTraceDragStart = (e: React.DragEvent<HTMLDivElement>, traceId: string) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(TRACE_DRAG_DATA_KEY, traceId)
    setDraggedTraceId(traceId)
  }

  const handleTraceDragEnd = () => {
    setDraggedTraceId(null)
    setDropTargetId(null)
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

    // Dragging any one of a multi-selection moves the whole selection to
    // the same group together, instead of stranding the rest behind.
    if (multiSelectedSet.has(traceId) && multiSelectedSet.size > 1) {
      await moveTracesToLayer(Array.from(multiSelectedSet), layerId)
    } else {
      await moveTraceToLayer(traceId, layerId)
    }
  }

  const handleDropTargetLeave = (targetId: string) => {
    if (dropTargetId === targetId) {
      setDropTargetId(null)
    }
  }

  const updateLayerZIndex = async (layerId: string, newZIndex: number) => {
    if (!supabase || !canEdit) return

    // Update the layer
    const { error: layerError } = await (supabase.from('layers') as any)
      .update({ z_index: newZIndex })
      .eq('id', layerId)

    if (layerError) {
      console.error('Error updating layer z-index:', layerError)
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

  const moveLayerUp = async (layer: Layer) => {
    if (!supabase) return
    
    // Find layer above this one
    const sortedLayers = [...layers].sort((a, b) => b.zIndex - a.zIndex)
    const currentIndex = sortedLayers.findIndex(l => l.id === layer.id)
    if (currentIndex === 0) return // Already at top

    const layerAbove = sortedLayers[currentIndex - 1]
    const currentLayerTraces = getTracesForLayer(layer.id)
    const layerAboveTraces = getTracesForLayer(layerAbove.id)
    
    // Swap z-indexes of the layers
    const tempZIndex = layer.zIndex
    await updateLayerZIndex(layer.id, layerAbove.zIndex)
    await updateLayerZIndex(layerAbove.id, tempZIndex)

    await persistTraceOrder(layer.id, currentLayerTraces, layerAbove.zIndex)
    await persistTraceOrder(layerAbove.id, layerAboveTraces, tempZIndex)
    await loadLayers()
  }

  const moveLayerDown = async (layer: Layer) => {
    if (!supabase) return
    
    const sortedLayers = [...layers].sort((a, b) => b.zIndex - a.zIndex)
    const currentIndex = sortedLayers.findIndex(l => l.id === layer.id)
    if (currentIndex === sortedLayers.length - 1) {
      return
    }

    const layerBelow = sortedLayers[currentIndex + 1]
    const currentLayerTraces = getTracesForLayer(layer.id)
    const layerBelowTraces = getTracesForLayer(layerBelow.id)
    
    // Swap z-indexes of the layers
    const tempZIndex = layer.zIndex
    await updateLayerZIndex(layer.id, layerBelow.zIndex)
    await updateLayerZIndex(layerBelow.id, tempZIndex)

    await persistTraceOrder(layer.id, currentLayerTraces, layerBelow.zIndex)
    await persistTraceOrder(layerBelow.id, layerBelowTraces, tempZIndex)
    await loadLayers()
  }

  // Get traces for a specific layer
  const getTracesForLayer = (layerId: string | null) => {
    return traces
      .filter(t => (t.layerId ?? null) === layerId)
      .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0)) // Highest z-index first (top of layer)
  }

  // Get ungrouped traces
  const ungroupedTraces = traces.filter(t => !t.layerId)

  // Sort layers by z-index (highest first)
  const sortedLayers = [...layers].sort((a, b) => b.zIndex - a.zIndex)

  // Create a list of layer items
  const allItems = [
    ...sortedLayers.map(l => ({ type: 'layer' as const, data: l, zIndex: l.zIndex })),
  ].sort((a, b) => b.zIndex - a.zIndex)

  return (
    <div 
      data-ui-element="true"
      className="layer-panel fixed w-80 border-2 border-white shadow-2xl overflow-hidden flex flex-col z-[10000100] pointer-events-auto"
      style={{ 
        backgroundColor: 'rgba(20,20,20,0.98)',
        top: '80px',
        right: '16px',
        height: 'calc(100vh - 160px)'
      }}
    >
      {/* Corner brackets */}
      <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-white pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-white pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-white pointer-events-none" />
      
      {/* Header */}
      <div className="bg-black border-b border-gray-600 p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rotate-45 border border-gray-400" />
          <h2 className="text-sm text-white tracking-[0.15em] uppercase">Layers</h2>
        </div>
        <div className="flex gap-2">
          {canEdit && (
          <button
            onClick={createGroup}
            className="px-3 py-1 bg-white text-black text-[9px] tracking-wider uppercase hover:bg-gray-200 transition-colors"
            title="Create new group"
          >
            + Group
          </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg w-6 h-6 flex items-center justify-center transition-colors"
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

          return (
            <div
              key={layer.id}
              className={`border transition-all ${
                // Focusing a group (clicking its name) uses the exact same
                // "soft selection" blue as an actually-selected trace -- they
                // both just mean "this is the thing currently in focus".
                // A static bg-gray-800/80 used to always be present in the
                // base classes here alongside this, which -- since Tailwind
                // resolves same-specificity background-color utilities by
                // stylesheet order, not by className order -- could win over
                // this conditional background regardless of state. Folding
                // the default background into the final else branch below
                // (so only ever one bg-* class is present at a time) makes
                // the highlight actually visible.
                (isActiveLayer || hasSelectedTrace)
                  ? 'border-blue-400 bg-blue-900/20'
                  : dropTargetId === layer.id
                    ? 'border-emerald-400 bg-emerald-900/20'
                    : 'border-gray-600 bg-gray-800/80'
              }`}
              onDragOver={(e) => handleDropTargetDragOver(e, layer.id)}
              onDrop={(e) => handleDropTargetDrop(e, layer.id)}
              onDragLeave={() => handleDropTargetLeave(layer.id)}
            >
              {/* Group header */}
              <div className="p-2 flex items-center justify-between hover:bg-gray-700/50 cursor-pointer">
                <div
                  className="flex items-center gap-1 flex-1"
                  title="Click the arrow to expand/collapse. Click the name to set this group as the target for new traces. Click the diamond icon to select all traces in this group."
                >
                  <span
                    className="text-gray-400 text-[10px] px-1 cursor-pointer"
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
                      className={`text-xs ${isActiveLayer ? 'text-amber-400' : 'text-gray-400'} hover:text-amber-300`}
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
                      {isActiveLayer ? '◆' : '◇'}
                    </span>
                    <span className="text-white text-xs tracking-wide">{layer.name}</span>
                    <span className="text-gray-500 text-[10px]">({layerTraces.length})</span>
                    {isActiveLayer && (
                      <span className="text-amber-400 text-[9px] tracking-wider uppercase">Target</span>
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
                    className={`text-[10px] px-2 py-1 ${canMoveUp ? 'text-gray-400 hover:text-white cursor-pointer' : 'text-gray-700 cursor-not-allowed'}`}
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
                    className={`text-[10px] px-2 py-1 ${canMoveDown ? 'text-gray-400 hover:text-white cursor-pointer' : 'text-gray-700 cursor-not-allowed'}`}
                    title={canMoveDown ? "Move down" : "Already at bottom"}
                  >
                    ▼
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      renameGroup(layer.id, layer.name)
                    }}
                    className="text-gray-400 hover:text-white text-[10px] px-2 py-1"
                    title="Rename group"
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteGroup(layer.id)
                    }}
                    className="text-red-400/60 hover:text-red-400 text-[10px] px-2 py-1"
                    title="Delete group"
                  >
                    ×
                  </button>
                </div>
              </div>

              {/* Traces in group */}
              {isExpanded && (
                <div className="pl-6 pr-2 pb-2 space-y-1">
                  {layerTraces.map((trace) => (
                    <div
                      key={trace.id}
                      draggable={canEdit}
                      className={`bg-gray-900 border p-2 flex items-center justify-between text-xs transition-all cursor-pointer hover:bg-gray-700 ${
                        trace.id === selectedTraceId || multiSelectedSet.has(trace.id)
                          ? 'border-blue-400 bg-blue-900/30'
                          : 'border-gray-600'
                      }`}
                      onDragStart={(e) => handleTraceDragStart(e, trace.id)}
                      onDragEnd={handleTraceDragEnd}
                      onClick={() => {
                        onSelectTrace?.(trace.id)
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-gray-400 text-[10px]">
                          {trace.type === 'text' && '◇'}
                          {trace.type === 'image' && '◻'}
                          {trace.type === 'audio' && '♪'}
                          {trace.type === 'video' && '▷'}
                          {trace.type === 'embed' && '⬡'}
                        </span>
                        <span className="text-white/80 truncate tracking-wide">
                          {trace.content.substring(0, 20) || 'Untitled'}
                        </span>
                        {trace.illuminate && <span className="text-yellow-400 text-[9px]" title="Emits light">★</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            moveTraceWithinLayer(trace.id, trace.layerId ?? null, 'up')
                          }}
                          disabled={layerTraces.findIndex(t => t.id === trace.id) === 0}
                          className={`text-[10px] px-1.5 py-0.5 ${layerTraces.findIndex(t => t.id === trace.id) === 0 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white'}`}
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
                          className={`text-[10px] px-1.5 py-0.5 ${layerTraces.findIndex(t => t.id === trace.id) === layerTraces.length - 1 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white'}`}
                          title="Move down in group"
                        >
                          ▼
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onGoToTrace?.(trace.id)
                          }}
                          className="text-gray-400 hover:text-white text-[10px] px-1.5 py-0.5 hover:bg-gray-600 transition-colors"
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
                          className="text-gray-500 hover:text-gray-300 text-[10px] px-1.5 py-0.5"
                          title="Remove from group"
                        >
                          ↗
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            doDeleteTrace(trace.id)
                          }}
                          className="text-red-400/60 hover:text-red-400 text-[10px] px-1.5 py-0.5"
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
                : dropTargetId === UNGROUPED_DROP_TARGET ? 'border-emerald-400 bg-emerald-900/20' : 'border-gray-600 bg-gray-900/50'
            }`}
            onDragOver={(e) => handleDropTargetDragOver(e, UNGROUPED_DROP_TARGET)}
            onDrop={(e) => handleDropTargetDrop(e, null)}
            onDragLeave={() => handleDropTargetLeave(UNGROUPED_DROP_TARGET)}
          >
            <div
              className="flex items-center gap-2 mb-2 cursor-pointer"
              title="Click to select all ungrouped traces and set 'Ungrouped' as the target for new traces"
              onClick={() => {
                onSelectGroupTraces?.(ungroupedTraces.map(t => t.id))
                onSetActiveLayer?.(null)
              }}
            >
              <span className="text-gray-400 text-[9px] tracking-[0.15em] uppercase">Ungrouped</span>
              {!activeLayerId && (
                <span className="text-amber-400 text-[9px] tracking-wider uppercase">Target</span>
              )}
            </div>
            <div className="space-y-1">
              {ungroupedTraces.map((trace) => (
                <div
                  key={trace.id}
                  draggable={canEdit}
                  className={`bg-gray-900 border p-2 flex items-center justify-between text-xs transition-all cursor-pointer hover:bg-gray-700 ${
                    trace.id === selectedTraceId || multiSelectedSet.has(trace.id)
                      ? 'border-blue-400 bg-blue-900/30'
                      : 'border-gray-600'
                  }`}
                  onDragStart={(e) => handleTraceDragStart(e, trace.id)}
                  onDragEnd={handleTraceDragEnd}
                  onClick={() => {
                    onSelectTrace?.(trace.id)
                  }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-gray-400 text-[10px]">
                      {trace.type === 'text' && '◇'}
                      {trace.type === 'image' && '◻'}
                      {trace.type === 'audio' && '♪'}
                      {trace.type === 'video' && '▷'}
                      {trace.type === 'embed' && '⬡'}
                    </span>
                    <span className="text-white/80 truncate tracking-wide">
                      {trace.content.substring(0, 20) || 'Untitled'}
                    </span>
                    {trace.illuminate && <span className="text-yellow-400 text-[9px]" title="Emits light">★</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        moveTraceWithinLayer(trace.id, null, 'up')
                      }}
                      disabled={ungroupedTraces.findIndex(t => t.id === trace.id) === 0}
                      className={`text-[10px] px-1.5 py-0.5 ${ungroupedTraces.findIndex(t => t.id === trace.id) === 0 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white'}`}
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
                      className={`text-[10px] px-1.5 py-0.5 ${ungroupedTraces.findIndex(t => t.id === trace.id) === ungroupedTraces.length - 1 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white'}`}
                      title="Move down"
                    >
                      ▼
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onGoToTrace?.(trace.id)
                      }}
                      className="text-gray-400 hover:text-white text-[10px] px-1.5 py-0.5 hover:bg-gray-600 transition-colors"
                      title="Go to trace"
                    >
                      →
                    </button>
                    <select
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const layerId = e.target.value || null
                        if (multiSelectedSet.has(trace.id) && multiSelectedSet.size > 1) {
                          moveTracesToLayer(Array.from(multiSelectedSet), layerId)
                        } else {
                          moveTraceToLayer(trace.id, layerId)
                        }
                      }}
                      className="bg-gray-800 text-white text-[10px] border border-gray-600 px-2 py-1 focus:border-gray-400"
                    >
                      <option value="">Move to...</option>
                      {sortedLayers.map(layer => (
                        <option key={layer.id} value={layer.id}>
                          {layer.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        doDeleteTrace(trace.id)
                      }}
                      className="text-red-400/60 hover:text-red-400 text-[10px] px-1.5 py-0.5"
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

      {/* Dialog for create/rename/delete */}
      {dialogMode && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-black border-2 border-white p-4 w-64">
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-white pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-white pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-white pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-white pointer-events-none" />

            {dialogMode === 'delete' ? (
              <>
                <p className="text-white text-xs tracking-[0.15em] uppercase mb-4">
                  Delete this group and all traces inside it?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (dialogTargetId) doDeleteGroup(dialogTargetId)
                      setDialogMode(null)
                    }}
                    className="flex-1 bg-red-900 hover:bg-red-700 text-white py-1.5 text-[10px] tracking-wider uppercase transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDialogMode(null)}
                    className="flex-1 border border-gray-600 hover:border-white text-white py-1.5 text-[10px] tracking-wider uppercase transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-white text-xs tracking-[0.15em] uppercase mb-3">
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
                  className="w-full bg-gray-900 border border-gray-600 text-white text-xs px-3 py-2 mb-3 focus:border-white focus:outline-none tracking-wider"
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
                    className="flex-1 bg-white hover:bg-gray-200 text-black py-1.5 text-[10px] tracking-wider uppercase transition-colors"
                  >
                    {dialogMode === 'create' ? 'Create' : 'Rename'}
                  </button>
                  <button
                    onClick={() => setDialogMode(null)}
                    className="flex-1 border border-gray-600 hover:border-white text-white py-1.5 text-[10px] tracking-wider uppercase transition-colors"
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
