import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import type { LobbyLocation } from '../types/database'

// Custom drag MIME so LobbyScene's canvas-wide file/URL drop handlers can
// recognize and ignore an in-panel location-reorder drag (same reasoning as
// LayerPanel's TRACE_DRAG_DATA_KEY).
export const LOCATION_DRAG_DATA_KEY = 'application/x-atrium-location-id'

interface LocationsPanelProps {
  lobbyId: string
  onClose: () => void
  canEdit?: boolean
  // Reads the live camera (world position + zoom) at the moment "Save
  // Location" is pressed.
  getCurrentCamera: () => { x: number; y: number; zoom: number }
  // Smoothly flies the camera to a saved location (LobbyScene's flyToLocation).
  onGoToLocation: (location: LobbyLocation) => void
}

function mapRow(row: any): LobbyLocation {
  return {
    id: row.id,
    createdAt: row.created_at,
    lobbyId: row.lobby_id,
    name: row.name,
    positionX: row.position_x,
    positionY: row.position_y,
    zoom: row.zoom ?? 1,
    orderIndex: row.order_index ?? 0,
    userId: row.user_id,
  }
}

export default function LocationsPanel({ lobbyId, onClose, canEdit = true, getCurrentCamera, onGoToLocation }: LocationsPanelProps) {
  const { username } = useGameStore()
  const [locations, setLocations] = useState<LobbyLocation[]>([])
  const [isReordering, setIsReordering] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | 'delete' | null>(null)
  const [dialogInput, setDialogInput] = useState('')
  const [dialogTargetId, setDialogTargetId] = useState<string | null>(null)

  // Presentation mode: while on, Left/Right arrow keys step through the
  // locations in order, flying the camera to each. Lives here (rather than
  // LobbyScene) since this panel owns the ordered list; it therefore only
  // works while the panel is open, which is fine -- the panel docks to the
  // side and leaves the canvas visible.
  const [presentationMode, setPresentationMode] = useState(false)
  const [presentationIndex, setPresentationIndex] = useState(0)

  // Sorted ascending by order_index -- index 0 is the top of the list and the
  // first stop in presentation mode.
  const sorted = [...locations].sort((a, b) => a.orderIndex - b.orderIndex)
  const sortedRef = useRef(sorted)
  sortedRef.current = sorted

  const loadLocations = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('lobby_locations')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('order_index', { ascending: true })
    if (error || !data) return
    setLocations(data.map(mapRow))
  }, [lobbyId])

  useEffect(() => {
    loadLocations()
    if (!supabase) return
    const channel = supabase
      .channel(`locations-channel-${lobbyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_locations', filter: `lobby_id=eq.${lobbyId}` }, () => {
        loadLocations()
      })
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [loadLocations, lobbyId])

  const goToIndex = useCallback((index: number) => {
    const list = sortedRef.current
    if (list.length === 0) return
    const clamped = Math.max(0, Math.min(list.length - 1, index))
    setPresentationIndex(clamped)
    onGoToLocation(list[clamped])
  }, [onGoToLocation])

  // Arrow-key navigation while presentation mode is on.
  useEffect(() => {
    if (!presentationMode) return
    const isEditable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      const tag = el?.tagName
      return !!el?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    const handler = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goToIndex(presentationIndex + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goToIndex(presentationIndex - 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [presentationMode, presentationIndex, goToIndex])

  const togglePresentationMode = () => {
    if (presentationMode) {
      setPresentationMode(false)
      return
    }
    setPresentationMode(true)
    // Jump to the first location immediately so the mode has visible effect.
    if (sortedRef.current.length > 0) goToIndex(0)
  }

  const doSave = async (name: string) => {
    if (!supabase || !name.trim() || !canEdit) return
    const cam = getCurrentCamera()
    const maxOrder = locations.reduce((m, l) => Math.max(m, l.orderIndex), -1)
    const { error } = await (supabase.from('lobby_locations') as any).insert({
      lobby_id: lobbyId,
      name: name.trim(),
      position_x: cam.x,
      position_y: cam.y,
      zoom: cam.zoom,
      order_index: maxOrder + 1,
      user_id: username,
    })
    if (error) {
      alert(`Failed to save location: ${error.message}`)
      return
    }
    await loadLocations()
  }

  const doRename = async (id: string, name: string) => {
    if (!supabase || !name.trim() || !canEdit) return
    const { error } = await (supabase.from('lobby_locations') as any).update({ name: name.trim() }).eq('id', id)
    if (error) { alert(`Failed to rename: ${error.message}`); return }
    await loadLocations()
  }

  const doDelete = async (id: string) => {
    if (!supabase || !canEdit) return
    const { error } = await (supabase.from('lobby_locations') as any).delete().eq('id', id)
    if (error) { alert(`Failed to delete: ${error.message}`); return }
    await loadLocations()
  }

  // Drag-reorder: reassign a contiguous order_index sequence matching the new
  // visual order, same approach as LayerPanel's group reorder.
  const reorder = async (sourceId: string, targetId: string) => {
    if (!supabase || !canEdit || sourceId === targetId) return
    const ordered = [...sortedRef.current]
    const from = ordered.findIndex(l => l.id === sourceId)
    const to = ordered.findIndex(l => l.id === targetId)
    if (from === -1 || to === -1) return
    const [moved] = ordered.splice(from, 1)
    ordered.splice(to, 0, moved)
    setIsReordering(true)
    try {
      for (let i = 0; i < ordered.length; i++) {
        if (ordered[i].orderIndex !== i) {
          await (supabase.from('lobby_locations') as any).update({ order_index: i }).eq('id', ordered[i].id)
        }
      }
      await loadLocations()
    } finally {
      setIsReordering(false)
    }
  }

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData(LOCATION_DRAG_DATA_KEY, id)
    setDraggedId(id)
  }
  const handleDragEnd = () => { setDraggedId(null); setDropTargetId(null) }
  const handleDragOver = (e: React.DragEvent, id: string) => {
    if (!draggedId || draggedId === id) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (dropTargetId !== id) setDropTargetId(id)
  }
  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const sourceId = e.dataTransfer.getData(LOCATION_DRAG_DATA_KEY) || draggedId
    setDropTargetId(null)
    setDraggedId(null)
    if (sourceId) await reorder(sourceId, targetId)
  }

  return (
    <div
      data-ui-element="true"
      className="layer-panel fixed w-80 border-2 border-white shadow-2xl overflow-hidden flex flex-col z-[10000100] pointer-events-auto"
      style={{ backgroundColor: 'rgba(20,20,20,0.98)', top: '80px', right: '16px', height: 'calc(100vh - 160px)' }}
    >
      <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-white pointer-events-none" />
      <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-white pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-white pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-white pointer-events-none" />

      {/* Header */}
      <div className="bg-black border-b border-gray-600 p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rotate-45 border border-gray-400" />
          <h2 className="text-sm text-white tracking-[0.15em] uppercase">Locations</h2>
          {isReordering && (
            <span className="w-3 h-3 border border-gray-500 border-t-white rounded-full animate-spin" title="Updating order…" />
          )}
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <button
              onClick={() => { setDialogMode('create'); setDialogInput(''); setDialogTargetId(null) }}
              className="px-3 py-1 bg-white text-black text-[9px] tracking-wider uppercase hover:bg-gray-200 transition-colors"
              title="Save the current camera view as a location"
            >
              + Save Location
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-white text-lg w-6 h-6 flex items-center justify-center transition-colors">×</button>
        </div>
      </div>

      {/* Presentation mode toggle */}
      <div className="bg-black/60 border-b border-gray-700 px-3 py-2 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-gray-300 text-[10px] tracking-wider uppercase">Presentation Mode</span>
          <span className="text-gray-500 text-[8px] tracking-wide">← / → keys to move between locations</span>
        </div>
        <button
          onClick={togglePresentationMode}
          disabled={locations.length === 0}
          className={`px-3 py-1 text-[9px] tracking-wider uppercase transition-colors border ${
            presentationMode
              ? 'bg-emerald-500 border-emerald-400 text-black'
              : 'bg-gray-900 border-gray-600 text-gray-300 hover:border-white hover:text-white disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          {presentationMode ? 'On' : 'Off'}
        </button>
      </div>

      {/* Location list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sorted.length === 0 && (
          <p className="text-gray-600 text-[10px] tracking-wide text-center px-4 py-6">
            {canEdit ? 'No locations yet. Frame a view and press "Save Location".' : 'No locations saved.'}
          </p>
        )}
        {sorted.map((loc, index) => {
          const isPresentationCurrent = presentationMode && index === presentationIndex
          return (
            <div
              key={loc.id}
              draggable={canEdit}
              style={{ userSelect: 'none', WebkitUserDrag: 'element' } as React.CSSProperties}
              onDragStart={(e) => handleDragStart(e, loc.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, loc.id)}
              onDrop={(e) => handleDrop(e, loc.id)}
              onDoubleClick={() => { onGoToLocation(loc); if (presentationMode) setPresentationIndex(index) }}
              className={`border p-2 flex items-center justify-between gap-2 transition-all cursor-pointer group ${
                dropTargetId === loc.id
                  ? 'border-emerald-400 bg-emerald-900/20'
                  : isPresentationCurrent
                  ? 'border-emerald-400 bg-emerald-900/30'
                  : 'border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-gray-500'
              }`}
              title="Double-click to fly here"
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {canEdit && (
                  <span
                    className="grid grid-cols-2 gap-[2px] px-1 py-0.5 cursor-grab active:cursor-grabbing shrink-0 group/grip"
                    style={{ userSelect: 'none' } as React.CSSProperties}
                    title="Drag to reorder"
                  >
                    {Array.from({ length: 6 }).map((_, i) => (
                      <span key={i} className="w-[3px] h-[3px] rounded-full bg-gray-600 group-hover/grip:bg-gray-300 pointer-events-none" style={{ userSelect: 'none' }} />
                    ))}
                  </span>
                )}
                <span className="text-gray-500 text-[9px] font-mono w-5 shrink-0 text-right">{index + 1}</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-white/90 text-xs tracking-wide truncate">{loc.name}</span>
                  <span className="text-gray-500 text-[8px] font-mono tracking-wide">
                    {Math.round(loc.positionX)}, {Math.round(loc.positionY)} · {loc.zoom.toFixed(2)}x
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); onGoToLocation(loc); if (presentationMode) setPresentationIndex(index) }}
                  className="text-gray-400 hover:text-white text-[11px] px-1.5 py-0.5 hover:bg-gray-600 transition-colors"
                  title="Fly here"
                >
                  →
                </button>
                {canEdit && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDialogMode('rename'); setDialogInput(loc.name); setDialogTargetId(loc.id) }}
                      className="text-gray-400 hover:text-white text-[10px] px-1.5 py-0.5 transition-colors"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDialogMode('delete'); setDialogTargetId(loc.id) }}
                      className="text-red-400/60 hover:text-red-400 text-[10px] px-1.5 py-0.5 transition-colors"
                      title="Delete"
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Dialog for create/rename/delete */}
      {dialogMode && (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-black border-2 border-white p-4 w-64 relative">
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-white pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-white pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-white pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-white pointer-events-none" />

            {dialogMode === 'delete' ? (
              <>
                <p className="text-white text-xs tracking-[0.15em] uppercase mb-4">Delete this location?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { if (dialogTargetId) doDelete(dialogTargetId); setDialogMode(null) }}
                    className="flex-1 bg-red-900 hover:bg-red-700 text-white py-1.5 text-[10px] tracking-wider uppercase transition-colors"
                  >
                    Delete
                  </button>
                  <button onClick={() => setDialogMode(null)} className="flex-1 border border-gray-600 hover:border-white text-white py-1.5 text-[10px] tracking-wider uppercase transition-colors">Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-white text-xs tracking-[0.15em] uppercase mb-3">
                  {dialogMode === 'create' ? 'Location Name' : 'Rename Location'}
                </p>
                <input
                  autoFocus
                  type="text"
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dialogInput.trim()) {
                      if (dialogMode === 'create') doSave(dialogInput)
                      else if (dialogMode === 'rename' && dialogTargetId) doRename(dialogTargetId, dialogInput)
                      setDialogMode(null)
                    }
                    if (e.key === 'Escape') setDialogMode(null)
                  }}
                  className="w-full bg-gray-900 border border-gray-600 text-white text-xs px-3 py-2 mb-3 focus:border-white focus:outline-none tracking-wider"
                  placeholder="Location name..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (dialogInput.trim()) {
                        if (dialogMode === 'create') doSave(dialogInput)
                        else if (dialogMode === 'rename' && dialogTargetId) doRename(dialogTargetId, dialogInput)
                      }
                      setDialogMode(null)
                    }}
                    className="flex-1 bg-white hover:bg-gray-200 text-black py-1.5 text-[10px] tracking-wider uppercase transition-colors"
                  >
                    {dialogMode === 'create' ? 'Save' : 'Rename'}
                  </button>
                  <button onClick={() => setDialogMode(null)} className="flex-1 border border-gray-600 hover:border-white text-white py-1.5 text-[10px] tracking-wider uppercase transition-colors">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
