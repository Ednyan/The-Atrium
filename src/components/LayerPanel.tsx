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

  const renameGroup = async (layerId: string, currentName: string) => {
    if (!supabase) return
    
    const newName = prompt('Enter new group name:', currentName)
    if (!newName || newName === currentName) return

    const { error } = await (supabase.from('layers') as any)
      .update({ name: newName })
      .eq('id', layerId)

    if (error) {
      console.error('Error renaming group:', error)
      alert(`Failed to rename group: ${error.message}`)
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
    <div 
      className="layer-panel fixed w-80 border-2 border-white shadow-2xl overflow-hidden flex flex-col z-[9999]" 
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
          <button
            onClick={fixDuplicateZIndexes}
            className="px-2 py-1 border border-yellow-600 text-yellow-500 text-[9px] tracking-wider uppercase hover:bg-yellow-600/20 transition-colors"
            title="Fix duplicate z-indexes (run once if layers won't move)"
          >
            Fix
          </button>
          <button
            onClick={createGroup}
            className="px-3 py-1 bg-white text-black text-[9px] tracking-wider uppercase hover:bg-gray-200 transition-colors"
            title="Create new group"
          >
            + Group
          </button>
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
        {allItems.map((item, index) => {
          if (item.type === 'player') {
            const canMoveUp = index > 0
            const canMoveDown = index < allItems.length - 1
            
            return (
              <div
                key="player"
                className="bg-blue-900/30 border border-blue-400/50 p-2 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="text-blue-400 text-xs">◇</span>
                  <span className="text-blue-300 text-xs tracking-wider uppercase">Players</span>
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
                    className={`text-[10px] px-2 py-1 ${canMoveUp ? 'text-gray-400 hover:text-white cursor-pointer' : 'text-gray-700 cursor-not-allowed'}`}
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
                    className={`text-[10px] px-2 py-1 ${canMoveDown ? 'text-gray-400 hover:text-white cursor-pointer' : 'text-gray-700 cursor-not-allowed'}`}
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
              className={`bg-gray-800/80 border transition-all ${
                hasSelectedTrace 
                  ? 'border-blue-400 bg-blue-900/20' 
                  : 'border-gray-600'
              }`}
            >
              {/* Group header */}
              <div className="p-2 flex items-center justify-between hover:bg-gray-700/50 cursor-pointer">
                <div
                  className="flex items-center gap-2 flex-1"
                  onClick={() => toggleGroup(layer.id)}
                >
                  <span className="text-gray-400 text-[10px]">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="text-gray-400 text-xs">◇</span>
                  <span className="text-white text-xs tracking-wide">{layer.name}</span>
                  <span className="text-gray-500 text-[10px]">({layerTraces.length})</span>
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
                      className={`bg-gray-900 border p-2 flex items-center justify-between text-xs transition-all cursor-pointer hover:bg-gray-700 ${
                        trace.id === selectedTraceId
                          ? 'border-blue-400 bg-blue-900/30'
                          : 'border-gray-600'
                      }`}
                      onClick={() => {
                        console.log('LayerPanel: Clicking trace', { traceId: trace.id, currentSelected: selectedTraceId, matches: trace.id === selectedTraceId })
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
                            moveTraceToLayer(trace.id, null)
                          }}
                          className="text-gray-500 hover:text-gray-300 text-[10px] px-1.5 py-0.5"
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
          <div className="bg-gray-900/50 border border-gray-600 p-2">
            <div className="text-gray-400 text-[9px] tracking-[0.15em] uppercase mb-2">Ungrouped</div>
            <div className="space-y-1">
              {ungroupedTraces.map((trace) => (
                <div
                  key={trace.id}
                  className={`bg-gray-900 border p-2 flex items-center justify-between text-xs transition-all cursor-pointer hover:bg-gray-700 ${
                    trace.id === selectedTraceId
                      ? 'border-blue-400 bg-blue-900/30'
                      : 'border-gray-600'
                  }`}
                  onClick={() => {
                    console.log('LayerPanel: Clicking ungrouped trace', { traceId: trace.id, currentSelected: selectedTraceId, matches: trace.id === selectedTraceId })
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
                        moveTraceToLayer(trace.id, layerId)
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
