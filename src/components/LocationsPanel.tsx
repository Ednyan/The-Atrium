import { useState } from 'react'
import type { LobbyLocation } from '../types/database'

// Custom drag MIME so LobbyScene's canvas-wide file/URL drop handlers can
// recognize and ignore an in-panel location-reorder drag (same reasoning as
// LayerPanel's TRACE_DRAG_DATA_KEY).
export const LOCATION_DRAG_DATA_KEY = 'application/x-atrium-location-id'

interface LocationsPanelProps {
  onClose: () => void
  canEdit?: boolean
  // The working (possibly-unsaved) locations list, owned by LobbyScene. All
  // mutations go back up through the callbacks below and are only persisted
  // when onSave is called -- this panel is purely presentational.
  locations: LobbyLocation[]
  dirty: boolean
  onAdd: (name: string) => void
  onRename: (id: string, name: string) => void
  // Overwrites a saved location's camera with wherever the user is looking
  // right now -- the way to "re-shoot" a location without delete+recreate.
  onUpdateCamera: (id: string) => void
  // Locking guards the camera overwrite above, which is the only destructive
  // action here with no confirmation step.
  onToggleLock: (id: string) => void
  onDelete: (id: string) => void
  onReorder: (sourceId: string, targetId: string) => void
  onSave: () => void
  onDiscard: () => void
  onGoToLocation: (location: LobbyLocation) => void
  presentationMode: boolean
  onTogglePresentation: () => void
  presentationIndex: number
}

export default function LocationsPanel({
  onClose,
  canEdit = true,
  locations,
  dirty,
  onAdd,
  onRename,
  onUpdateCamera,
  onToggleLock,
  onDelete,
  onReorder,
  onSave,
  onDiscard,
  onGoToLocation,
  presentationMode,
  onTogglePresentation,
  presentationIndex,
}: LocationsPanelProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const [dialogMode, setDialogMode] = useState<'create' | 'rename' | 'delete' | null>(null)
  const [dialogInput, setDialogInput] = useState('')
  const [dialogTargetId, setDialogTargetId] = useState<string | null>(null)

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
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const sourceId = e.dataTransfer.getData(LOCATION_DRAG_DATA_KEY) || draggedId
    setDropTargetId(null)
    setDraggedId(null)
    if (sourceId) onReorder(sourceId, targetId)
  }

  return (
    <div
      data-ui-element="true"
      className="layer-panel fixed w-80 border-2 border-nier-bg shadow-2xl overflow-hidden flex flex-col z-[10000100] pointer-events-auto"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.98)', top: '80px', right: '16px', height: 'calc(100vh - 160px)' }}
    >
      <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-bg pointer-events-none" />
      <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-bg pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-bg pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-bg pointer-events-none" />

      {/* Header */}
      <div className="bg-nier-black border-b border-nier-border/40 p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rotate-45 border border-gray-400" />
          <h2 className="text-sm text-nier-strong tracking-[0.15em] uppercase">Locations</h2>
          {dirty && <span className="text-amber-400 text-[11px] tracking-wider uppercase" title="Unsaved changes">● Unsaved</span>}
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <button
              onClick={() => { setDialogMode('create'); setDialogInput(''); setDialogTargetId(null) }}
              className="px-3 py-1 bg-white text-black text-xs tracking-wider uppercase hover:bg-nier-bg transition-colors"
              title="Save the current camera view as a location"
            >
              + Save View
            </button>
          )}
          <button onClick={onClose} className="text-nier-bg/70 hover:text-nier-strong text-lg w-6 h-6 flex items-center justify-center transition-colors">×</button>
        </div>
      </div>

      {/* Presentation mode toggle */}
      <div className="bg-nier-black/60 border-b border-nier-border/30 px-3 py-2 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-nier-bg/80 text-xs tracking-wider uppercase">Presentation Mode</span>
          <span className="text-nier-bg/80 text-[11px] tracking-wide">← / → keys to move between locations</span>
        </div>
        <button
          onClick={onTogglePresentation}
          disabled={locations.length === 0}
          className={`px-3 py-1 text-xs tracking-wider uppercase transition-colors border ${
            presentationMode
              ? 'bg-emerald-500 border-emerald-400 text-black'
              : 'bg-nier-black border-nier-border/40 text-nier-bg/80 hover:border-nier-bg hover:text-nier-strong disabled:opacity-30 disabled:cursor-not-allowed'
          }`}
        >
          {presentationMode ? 'On' : 'Off'}
        </button>
      </div>

      {/* Location list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {locations.length === 0 && (
          <p className="text-nier-bg/70 text-xs tracking-wide text-center px-4 py-6">
            {canEdit ? 'No locations yet. Frame a view and press "Save View".' : 'No locations saved.'}
          </p>
        )}
        {locations.map((loc, index) => {
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
              onDoubleClick={() => onGoToLocation(loc)}
              className={`border p-2 flex items-center justify-between gap-2 transition-all cursor-pointer group ${
                dropTargetId === loc.id
                  ? 'border-emerald-400 bg-emerald-900/20'
                  : isPresentationCurrent
                  ? 'border-emerald-400 bg-emerald-900/30'
                  : 'border-nier-border/30 bg-nier-black hover:bg-nier-blackLight hover:border-nier-border/50'
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
                <span className="text-nier-bg/80 text-xs font-mono w-5 shrink-0 text-right">{index + 1}</span>
                <div className="flex flex-col min-w-0">
                  <span className="text-nier-strong/90 text-xs tracking-wide truncate">{loc.name}</span>
                  <span className="text-nier-bg/80 text-[11px] font-mono tracking-wide">
                    {Math.round(loc.positionX)}, {Math.round(loc.positionY)} · {loc.zoom.toFixed(2)}x
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); onGoToLocation(loc) }}
                  className="text-nier-bg/70 hover:text-nier-strong text-sm px-1.5 py-0.5 hover:bg-gray-600 transition-colors"
                  title="Fly here"
                >
                  →
                </button>
                {canEdit && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onUpdateCamera(loc.id) }}
                      disabled={loc.isLocked}
                      className={`text-xs px-1.5 py-0.5 transition-colors ${
                        loc.isLocked
                          ? 'text-gray-700 cursor-not-allowed'
                          : 'text-nier-bg/70 hover:text-nier-strong'
                      }`}
                      title={loc.isLocked
                        ? 'Locked -- unlock to overwrite this view'
                        : 'Set this location to the current camera view'}
                    >
                      ⌖
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleLock(loc.id) }}
                      className={`text-xs px-1.5 py-0.5 transition-colors ${
                        loc.isLocked
                          ? 'text-amber-400 hover:text-amber-300'
                          : 'text-nier-bg/70 hover:text-nier-strong'
                      }`}
                      title={loc.isLocked
                        ? 'Unlock -- allow this view to be overwritten'
                        : 'Lock -- protect this view from being overwritten'}
                    >
                      {loc.isLocked ? '🔒' : '🔓'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDialogMode('rename'); setDialogInput(loc.name); setDialogTargetId(loc.id) }}
                      className="text-nier-bg/70 hover:text-nier-strong text-xs px-1.5 py-0.5 transition-colors"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDialogMode('delete'); setDialogTargetId(loc.id) }}
                      className="text-red-400/60 hover:text-red-400 text-xs px-1.5 py-0.5 transition-colors"
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

      {/* Save / Discard footer -- only while there are unsaved edits */}
      {canEdit && dirty && (
        <div className="bg-nier-black border-t border-nier-border/40 p-2 flex gap-2">
          <button
            onClick={onSave}
            className="flex-1 bg-white hover:bg-nier-bg text-black py-1.5 text-xs tracking-wider uppercase transition-colors"
          >
            Save Changes
          </button>
          <button
            onClick={onDiscard}
            className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors"
          >
            Discard
          </button>
        </div>
      )}

      {/* Dialog for create/rename/delete */}
      {dialogMode && (
        <div className="absolute inset-0 bg-nier-black/70 flex items-center justify-center z-50">
          <div className="bg-nier-black border-2 border-nier-bg p-4 w-64 relative">
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-nier-bg pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-nier-bg pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-nier-bg pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-nier-bg pointer-events-none" />

            {dialogMode === 'delete' ? (
              <>
                <p className="text-nier-strong text-xs tracking-[0.15em] uppercase mb-4">Delete this location?</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => { if (dialogTargetId) onDelete(dialogTargetId); setDialogMode(null) }}
                    className="flex-1 bg-red-900 hover:bg-red-700 text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    Delete
                  </button>
                  <button onClick={() => setDialogMode(null)} className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors">Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-nier-strong text-xs tracking-[0.15em] uppercase mb-3">
                  {dialogMode === 'create' ? 'Location Name' : 'Rename Location'}
                </p>
                <input
                  autoFocus
                  type="text"
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && dialogInput.trim()) {
                      if (dialogMode === 'create') onAdd(dialogInput)
                      else if (dialogMode === 'rename' && dialogTargetId) onRename(dialogTargetId, dialogInput)
                      setDialogMode(null)
                    }
                    if (e.key === 'Escape') setDialogMode(null)
                  }}
                  className="w-full bg-nier-black border border-nier-border/40 text-nier-strong text-xs px-3 py-2 mb-3 focus:border-nier-bg focus:outline-none tracking-wider"
                  placeholder="Location name..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (dialogInput.trim()) {
                        if (dialogMode === 'create') onAdd(dialogInput)
                        else if (dialogMode === 'rename' && dialogTargetId) onRename(dialogTargetId, dialogInput)
                      }
                      setDialogMode(null)
                    }}
                    className="flex-1 bg-white hover:bg-nier-bg text-black py-1.5 text-xs tracking-wider uppercase transition-colors"
                  >
                    {dialogMode === 'create' ? 'Save' : 'Rename'}
                  </button>
                  <button onClick={() => setDialogMode(null)} className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
