import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import type { Layer } from '../types/database'

interface LayerPanelProps {
  onClose: () => void
  selectedTraceId?: string | null
  onSelectTrace?: (traceId: string) => void
  onGoToTrace?: (traceId: string) => void
}

export default function LayerPanel({ onClose, selectedTraceId, onSelectTrace, onGoToTrace }: LayerPanelProps) {
  const { traces, username, playerZIndex, setPlayerZIndex } = useGameStore()
  const [layers, setLayers] = useState<Layer[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  // Load layers from database
  useEffect(() => {
    const loadLayers = async () => {
      if (!supabase) {
        console.warn('LayerPanel: Supabase not available')
        return
      }

      console.log('LayerPanel: Loading layers...')

      const { data, error } = await supabase
        .from('layers')
        .select('*')
        .order('z_index', { ascending: false })

      if (error) {
        console.error('Error loading layers:', error)
        console.error('Make sure you run: supabase/migrations/add_layer_system.sql')
        return
      }

      console.log('LayerPanel: Loaded layers:', data)

      if (data) {
        const mappedLayers: Layer[] = data.map((row: any) => ({
          id: row.id,
          createdAt: row.created_at,
          name: row.name,
          zIndex: row.z_index,
          isGroup: row.is_group,
          parentId: row.parent_id,
          userId: row.user_id,
        }))
        setLayers(mappedLayers)
      }
    }

    loadLayers()

    // Subscribe to layer changes
    if (!supabase) return

    console.log('LayerPanel: Subscribing to layer changes...')

    const channel = supabase
      .channel('layers-channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'layers',
        },
        (payload) => {
          console.log('LayerPanel: Layer change detected:', payload)
          loadLayers()
        }
      )
      .subscribe((status) => {
        console.log('LayerPanel: Subscription status:', status)
      })

    return () => {
      console.log('LayerPanel: Unsubscribing from layers')
      channel.unsubscribe()
    }
  }, [])

  const createGroup = async () => {
    if (!supabase) {
      alert('Supabase not initialized')
      return
    }

    const name = prompt('Enter group name:')
    if (!name) return

    console.log('Creating group:', name)

    // Find highest z-index
    const maxZIndex = Math.max(...layers.map(l => l.zIndex), 0)
    const newZIndex = maxZIndex + 1

    console.log('  Max z-index:', maxZIndex, '→ New z-index:', newZIndex)

    const { data, error } = await (supabase.from('layers') as any).insert({
      name,
      z_index: newZIndex,
      is_group: true,
      user_id: username,
    })

    if (error) {
      console.error('Error creating group:', error)
      alert(`Failed to create group: ${error.message}\n\nMake sure you've run the migration:\nsupabase/migrations/add_layer_system.sql`)
      return
    }

    console.log('Group created successfully:', data)
  }

  const fixDuplicateZIndexes = async () => {
    if (!supabase) return
    
    console.log('🔧 Fixing duplicate z-indexes...')
    const sortedLayers = [...layers].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    
    for (let i = 0; i < sortedLayers.length; i++) {
      const layer = sortedLayers[i]
      const newZIndex = i + 1
      console.log(`  Setting ${layer.name} z-index: ${layer.zIndex} → ${newZIndex}`)
      await updateLayerZIndex(layer.id, newZIndex)
      
      // Update traces in this layer
      const layerTraces = traces.filter(t => t.layerId === layer.id)
      for (let j = 0; j < layerTraces.length; j++) {
        const newTraceZIndex = newZIndex * 100 + j
        await (supabase.from('traces') as any).update({ z_index: newTraceZIndex }).eq('id', layerTraces[j].id)
      }
    }
    
    // Set player z-index to be on top (above all layers)
    const newPlayerZIndex = sortedLayers.length + 1
    console.log(`  Setting player z-index: ${playerZIndex} → ${newPlayerZIndex}`)
    setPlayerZIndex(newPlayerZIndex)
    
    console.log('✅ Fixed all z-indexes')
  }

  const deleteGroup = async (layerId: string) => {
    if (!supabase) return
    if (!confirm('Delete this group and all traces inside it?')) return

    // Delete all traces in this group
    const { error: tracesError } = await supabase
      .from('traces')
      .delete()
      .eq('layer_id', layerId)

    if (tracesError) {
      console.error('Error deleting traces:', tracesError)
      return
    }

    // Delete the group
    const { error } = await supabase.from('layers').delete().eq('id', layerId)

    if (error) {
      console.error('Error deleting group:', error)
    }
  }

  const moveTraceToLayer = async (traceId: string, layerId: string | null) => {
    if (!supabase) return

    // Calculate the z-index for this trace
    let newZIndex: number
    if (layerId === null) {
      // Moving to ungrouped, set z-index to 0
      newZIndex = 0
    } else {
      // Find the layer and calculate base z-index
      const targetLayer = layers.find(l => l.id === layerId)
      if (!targetLayer) return
      
      // Get existing traces in this layer
      const layerTraces = traces.filter(t => t.layerId === layerId && t.id !== traceId)
      
      // Base z-index is layer z-index * 100
      // Each trace gets base + order (0, 1, 2, etc.)
      const baseZIndex = targetLayer.zIndex * 100
      const nextOrder = layerTraces.length
      newZIndex = baseZIndex + nextOrder
    }

    const { error } = await (supabase.from('traces') as any)
      .update({ layer_id: layerId, z_index: newZIndex })
      .eq('id', traceId)

    if (error) {
      console.error('Error moving trace:', error)
    }
  }

  const updateLayerZIndex = async (layerId: string, newZIndex: number) => {
    if (!supabase) return

    // Update the layer
    const { error: layerError } = await (supabase.from('layers') as any)
      .update({ z_index: newZIndex })
      .eq('id', layerId)

    if (layerError) {
      console.error('Error updating layer z-index:', layerError)
      return
    }

    // Update all traces in this layer
    const tracesInLayer = traces.filter(t => t.layerId === layerId)
    for (let i = 0; i < tracesInLayer.length; i++) {
      const trace = tracesInLayer[i]
      const newTraceZIndex = newZIndex * 100 + i
      await (supabase.from('traces') as any)
        .update({ z_index: newTraceZIndex })
        .eq('id', trace.id)
    }
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
    
    // Swap z-indexes of the layers
    const tempZIndex = layer.zIndex
    await updateLayerZIndex(layer.id, layerAbove.zIndex)
    await updateLayerZIndex(layerAbove.id, tempZIndex)
    
    // Update all traces in both layers to match new layer z-indexes
    const tracesInCurrentLayer = traces.filter(t => t.layerId === layer.id)
    const tracesInAboveLayer = traces.filter(t => t.layerId === layerAbove.id)
    
    // Update current layer's traces (now using layerAbove's z-index)
    for (let i = 0; i < tracesInCurrentLayer.length; i++) {
      const newZIndex = layerAbove.zIndex * 100 + i
      await (supabase.from('traces') as any).update({ z_index: newZIndex }).eq('id', tracesInCurrentLayer[i].id)
    }
    
    // Update above layer's traces (now using current layer's old z-index)
    for (let i = 0; i < tracesInAboveLayer.length; i++) {
      const newZIndex = tempZIndex * 100 + i
      await (supabase.from('traces') as any).update({ z_index: newZIndex }).eq('id', tracesInAboveLayer[i].id)
    }
  }

  const moveLayerDown = async (layer: Layer) => {
    if (!supabase) return
    
    const sortedLayers = [...layers].sort((a, b) => b.zIndex - a.zIndex)
    const currentIndex = sortedLayers.findIndex(l => l.id === layer.id)
    console.log('🔽 Move layer down:', layer.name, 'currentIndex:', currentIndex, 'total:', sortedLayers.length)
    if (currentIndex === sortedLayers.length - 1) {
      console.log('❌ Already at bottom')
      return
    }

    const layerBelow = sortedLayers[currentIndex + 1]
    console.log('  📊 Before swap:', layer.name, 'z:', layer.zIndex, '|', layerBelow.name, 'z:', layerBelow.zIndex)
    
    // Swap z-indexes of the layers
    const tempZIndex = layer.zIndex
    await updateLayerZIndex(layer.id, layerBelow.zIndex)
    await updateLayerZIndex(layerBelow.id, tempZIndex)
    
    console.log('  ✅ Swapped z-indexes')
    
    // Update all traces in both layers to match new layer z-indexes
    const tracesInCurrentLayer = traces.filter(t => t.layerId === layer.id)
    const tracesInBelowLayer = traces.filter(t => t.layerId === layerBelow.id)
    
    console.log('  🔄 Updating traces:', tracesInCurrentLayer.length, 'in current,', tracesInBelowLayer.length, 'in below')
    
    // Update current layer's traces (now using layerBelow's z-index)
    for (let i = 0; i < tracesInCurrentLayer.length; i++) {
      const newZIndex = layerBelow.zIndex * 100 + i
      await (supabase.from('traces') as any).update({ z_index: newZIndex }).eq('id', tracesInCurrentLayer[i].id)
    }
    
    // Update below layer's traces (now using current layer's old z-index)
    for (let i = 0; i < tracesInBelowLayer.length; i++) {
      const newZIndex = tempZIndex * 100 + i
      await (supabase.from('traces') as any).update({ z_index: newZIndex }).eq('id', tracesInBelowLayer[i].id)
    }
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

  // Create a combined list with player position
  const allItems = [
    ...sortedLayers.map(l => ({ type: 'layer' as const, data: l, zIndex: l.zIndex })),
    { type: 'player' as const, data: null, zIndex: playerZIndex },
  ].sort((a, b) => b.zIndex - a.zIndex)
  
  console.log('📊 allItems calculated:', allItems.map(i => i.type === 'player' ? `Player(${i.zIndex})` : `Layer:${i.data.name}(${i.zIndex})`).join(' > '))

  return (
    <div className="layer-panel fixed right-4 top-20 bottom-20 w-80 bg-lobby-muted border-2 border-lobby-accent rounded-lg shadow-2xl overflow-hidden flex flex-col z-50">
      {/* Header */}
      <div className="bg-lobby-darker border-b border-lobby-accent p-3 flex justify-between items-center">
        <h2 className="text-lg font-bold text-lobby-accent">🎨 Layers</h2>
        <div className="flex gap-2">
          <button
            onClick={fixDuplicateZIndexes}
            className="bg-yellow-600 hover:bg-yellow-500 text-white px-2 py-1 rounded text-xs transition-all"
            title="Fix duplicate z-indexes (run once if layers won't move)"
          >
            🔧 Fix
          </button>
          <button
            onClick={createGroup}
            className="bg-lobby-accent hover:bg-lobby-accent/80 text-white px-3 py-1 rounded text-sm transition-all"
            title="Create new group"
          >
            + Group
          </button>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white text-xl"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {allItems.map((item, index) => {
          if (item.type === 'player') {
            const canMoveUp = index > 0
            const canMoveDown = index < allItems.length - 1
            
            return (
              <div
                key="player"
                className="bg-lobby-accent/20 border border-lobby-accent rounded p-2 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">👥</span>
                  <span className="text-white font-semibold">Players</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={async () => {
                      if (!canMoveUp) return
                      const itemAbove = allItems[index - 1]
                      if (itemAbove.type === 'layer') {
                        // Capture original values BEFORE any updates
                        const originalPlayerZIndex = playerZIndex
                        const originalLayerZIndex = itemAbove.zIndex
                        
                        // Check for duplicate z-indexes
                        if (originalPlayerZIndex === originalLayerZIndex) {
                          console.warn('⚠️ Duplicate z-indexes detected! Click the 🔧 Fix button first.')
                          alert('Duplicate z-indexes detected. Please click the 🔧 Fix button to fix layer ordering first.')
                          return
                        }
                        
                        console.log('🔼 Moving player up: player', originalPlayerZIndex, '→', originalLayerZIndex, '| layer', originalLayerZIndex, '→', originalPlayerZIndex)
                        
                        // Swap: player gets layer's z-index, layer gets player's z-index
                        setPlayerZIndex(originalLayerZIndex)
                        await updateLayerZIndex(itemAbove.data.id, originalPlayerZIndex)
                      }
                    }}
                    disabled={!canMoveUp}
                    className={`text-xs px-2 ${canMoveUp ? 'text-white/60 hover:text-white cursor-pointer' : 'text-white/20 cursor-not-allowed'}`}
                    title={canMoveUp ? "Move up" : "Already at top"}
                  >
                    ▲
                  </button>
                  <button
                    onClick={async () => {
                      if (!canMoveDown) return
                      const itemBelow = allItems[index + 1]
                      if (itemBelow.type === 'layer') {
                        // Capture original values BEFORE any updates
                        const originalPlayerZIndex = playerZIndex
                        const originalLayerZIndex = itemBelow.zIndex
                        
                        // Check for duplicate z-indexes
                        if (originalPlayerZIndex === originalLayerZIndex) {
                          console.warn('⚠️ Duplicate z-indexes detected! Click the 🔧 Fix button first.')
                          alert('Duplicate z-indexes detected. Please click the 🔧 Fix button to fix layer ordering first.')
                          return
                        }
                        
                        console.log('🔽 Moving player down: player', originalPlayerZIndex, '→', originalLayerZIndex, '| layer', originalLayerZIndex, '→', originalPlayerZIndex)
                        
                        // Swap: player gets layer's z-index, layer gets player's z-index
                        setPlayerZIndex(originalLayerZIndex)
                        await updateLayerZIndex(itemBelow.data.id, originalPlayerZIndex)
                      }
                    }}
                    disabled={!canMoveDown}
                    className={`text-xs px-2 ${canMoveDown ? 'text-white/60 hover:text-white cursor-pointer' : 'text-white/20 cursor-not-allowed'}`}
                    title={canMoveDown ? "Move down" : "Already at bottom"}
                  >
                    ▼
                  </button>
                </div>
              </div>
            )
          }

          const layer = item.data as Layer
          const layerTraces = getTracesForLayer(layer.id)
          const isExpanded = expandedGroups.has(layer.id)
          
          // Check if this layer can move up or down
          const layerIndex = sortedLayers.findIndex(l => l.id === layer.id)
          const canMoveUp = layerIndex > 0 // Not already at top (highest z-index)
          const canMoveDown = layerIndex < sortedLayers.length - 1 // Not already at bottom (lowest z-index)
          
          // Check if any trace in this group is selected
          const hasSelectedTrace = layerTraces.some(t => t.id === selectedTraceId)

          return (
            <div 
              key={layer.id} 
              className={`bg-lobby-darker/50 border rounded transition-all ${
                hasSelectedTrace 
                  ? 'border-green-500 bg-green-500/10' 
                  : 'border-lobby-accent/30'
              }`}
            >
              {/* Group header */}
              <div className="p-2 flex items-center justify-between hover:bg-lobby-accent/10 cursor-pointer">
                <div
                  className="flex items-center gap-2 flex-1"
                  onClick={() => toggleGroup(layer.id)}
                >
                  <span className="text-white/60 text-xs">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="text-lg">📁</span>
                  <span className="text-white">{layer.name}</span>
                  <span className="text-white/40 text-xs">({layerTraces.length})</span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      moveLayerUp(layer)
                    }}
                    disabled={!canMoveUp}
                    className={`text-xs px-2 ${canMoveUp ? 'text-white/60 hover:text-white cursor-pointer' : 'text-white/20 cursor-not-allowed'}`}
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
                    className={`text-xs px-2 ${canMoveDown ? 'text-white/60 hover:text-white cursor-pointer' : 'text-white/20 cursor-not-allowed'}`}
                    title={canMoveDown ? "Move down" : "Already at bottom"}
                  >
                    ▼
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteGroup(layer.id)
                    }}
                    className="text-red-400 hover:text-red-300 text-xs px-2"
                    title="Delete group"
                  >
                    🗑️
                  </button>
                </div>
              </div>

              {/* Traces in group */}
              {isExpanded && (
                <div className="pl-6 pr-2 pb-2 space-y-1">
                  {layerTraces.map((trace) => (
                    <div
                      key={trace.id}
                      className={`bg-lobby-darker border rounded p-2 flex items-center justify-between text-sm transition-all cursor-pointer hover:bg-lobby-accent/10 ${
                        trace.id === selectedTraceId
                          ? 'border-green-500 bg-green-500/20 shadow-lg shadow-green-500/30'
                          : 'border-lobby-accent/20'
                      }`}
                      onClick={() => {
                        console.log('LayerPanel: Clicking trace', { traceId: trace.id, currentSelected: selectedTraceId, matches: trace.id === selectedTraceId })
                        onSelectTrace?.(trace.id)
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span>
                          {trace.type === 'text' && '📝'}
                          {trace.type === 'image' && '🖼️'}
                          {trace.type === 'audio' && '🎵'}
                          {trace.type === 'video' && '🎬'}
                          {trace.type === 'embed' && '🔗'}
                        </span>
                        <span className="text-white/80 truncate">
                          {trace.content.substring(0, 20) || 'Untitled'}
                        </span>
                        {trace.illuminate && <span title="Emits light">💡</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            onGoToTrace?.(trace.id)
                          }}
                          className="text-blue-400 hover:text-blue-300 text-xs px-1.5 py-0.5 rounded hover:bg-blue-500/20 transition-colors"
                          title="Go to trace"
                        >
                          📍
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            moveTraceToLayer(trace.id, null)
                          }}
                          className="text-white/40 hover:text-white/80 text-xs px-1.5 py-0.5"
                          title="Remove from group"
                        >
                          ↗
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
          <div className="bg-lobby-darker/30 border border-lobby-accent/20 rounded p-2">
            <div className="text-white/60 text-xs mb-2 font-semibold">Ungrouped Traces</div>
            <div className="space-y-1">
              {ungroupedTraces.map((trace) => (
                <div
                  key={trace.id}
                  className={`bg-lobby-darker border rounded p-2 flex items-center justify-between text-sm transition-all cursor-pointer hover:bg-lobby-accent/10 ${
                    trace.id === selectedTraceId
                      ? 'border-green-500 bg-green-500/20 shadow-lg shadow-green-500/30'
                      : 'border-lobby-accent/20'
                  }`}
                  onClick={() => {
                    console.log('LayerPanel: Clicking ungrouped trace', { traceId: trace.id, currentSelected: selectedTraceId, matches: trace.id === selectedTraceId })
                    onSelectTrace?.(trace.id)
                  }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span>
                      {trace.type === 'text' && '📝'}
                      {trace.type === 'image' && '🖼️'}
                      {trace.type === 'audio' && '🎵'}
                      {trace.type === 'video' && '🎬'}
                      {trace.type === 'embed' && '🔗'}
                    </span>
                    <span className="text-white/80 truncate">
                      {trace.content.substring(0, 20) || 'Untitled'}
                    </span>
                    {trace.illuminate && <span title="Emits light">💡</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onGoToTrace?.(trace.id)
                      }}
                      className="text-blue-400 hover:text-blue-300 text-xs px-1.5 py-0.5 rounded hover:bg-blue-500/20 transition-colors"
                      title="Go to trace"
                    >
                      📍
                    </button>
                    <select
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const layerId = e.target.value || null
                        moveTraceToLayer(trace.id, layerId)
                      }}
                      className="bg-lobby-muted text-white text-xs border border-lobby-accent/30 rounded px-2 py-1"
                    >
                      <option value="">Move to...</option>
                      {sortedLayers.map(layer => (
                        <option key={layer.id} value={layer.id}>
                          {layer.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
