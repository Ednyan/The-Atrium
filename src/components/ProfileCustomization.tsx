import { useState, useEffect } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import {
  DEFAULT_ZOOM_SENSITIVITY,
  MIN_ZOOM_SENSITIVITY,
  MAX_ZOOM_SENSITIVITY,
  ZOOM_SENSITIVITY_STORAGE_KEY,
  clampZoomSensitivity,
} from '../lib/zoomSensitivity'
import {
  DEFAULT_UNDO_DEPTH,
  MAX_UNDO_DEPTH,
  readUndoDepth,
  writeUndoDepth,
  readPackingShape,
  writePackingShape,
} from '../lib/atriumPreferences'

interface ProfileCustomizationProps {
  onClose: () => void
  lobbyId?: string
}

// Five, from the palette the rest of the app is drawn in.
//
// Ten swatches is a decision to make rather than a colour to pick, and half of
// them were near-duplicates -- mint beside cyan beside green, salmon beside
// pink beside red. These are the five the contributors wall uses for its
// ranks: far enough apart to tell two people apart at a glance, and already
// the colours this place is made of. The picker underneath still takes
// anything at all.
const PRESET_COLORS = [
  '#FF8A3D', // Orange
  '#E8C15A', // Amber
  '#9AD4C4', // Mint
  '#A8B6D9', // Blue
  '#C77DFF', // Purple
]

export default function ProfileCustomization({ onClose, lobbyId }: ProfileCustomizationProps) {
  const { userId, username, setUsername, playerColor, setPlayerColor, showTraceIndicators, setShowTraceIndicators, showTraceTypeLabels, setShowTraceTypeLabels, hideOwnNameTag, setHideOwnNameTag, hideOtherNameTags, setHideOtherNameTags, hideOtherCursors, setHideOtherCursors, traceFadeEnabled, setTraceFadeEnabled } = useGameStore()
  const [displayName, setDisplayName] = useState(username)
  const [selectedColor, setSelectedColor] = useState(playerColor)
  const [canChangeName, setCanChangeName] = useState(isDesktop) // Desktop: always allowed
  const [daysUntilChange, setDaysUntilChange] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [undoDepth, setUndoDepth] = useState(DEFAULT_UNDO_DEPTH)
  const [zoomSensitivity, setZoomSensitivity] = useState(DEFAULT_ZOOM_SENSITIVITY)
  const [packingShape, setPackingShapeState] = useState<'square' | 'circle'>('square')

  useEffect(() => {
    loadProfile()
    try {
      const stored = localStorage.getItem(ZOOM_SENSITIVITY_STORAGE_KEY)
      if (stored) {
        const parsed = parseFloat(stored)
        if (Number.isFinite(parsed)) {
          setZoomSensitivity(clampZoomSensitivity(parsed))
        }
      }
    } catch {
      // Ignore localStorage access failures
    }
    setUndoDepth(readUndoDepth(lobbyId))
    setPackingShapeState(readPackingShape(lobbyId))
  }, [lobbyId])

  const handleZoomSensitivityChange = (value: number) => {
    const clamped = clampZoomSensitivity(value)
    setZoomSensitivity(clamped)
    try {
      localStorage.setItem(ZOOM_SENSITIVITY_STORAGE_KEY, clamped.toString())
    } catch {
      // Ignore localStorage access failures
    }
    window.dispatchEvent(new CustomEvent('lobby-zoom-sensitivity-changed', { detail: clamped }))
  }

  const handleUndoDepthChange = (value: number) => {
    const clamped = Math.max(1, Math.min(MAX_UNDO_DEPTH, value))
    setUndoDepth(clamped)
    writeUndoDepth(clamped)
    window.dispatchEvent(new CustomEvent('lobby-undo-depth-changed', { detail: clamped }))
  }

  const handlePackingShapeChange = (shape: 'square' | 'circle') => {
    setPackingShapeState(shape)
    writePackingShape(shape)
    // The atrium open behind the panel is the one that needs to know now; any
    // other picks the new shape up from storage when it opens.
    window.dispatchEvent(new CustomEvent('lobby-packing-shape-changed', { detail: { lobbyId, shape } }))
  }

  const loadProfile = async () => {
    if (!supabase || !userId) return

    const { data } = await (supabase
      .from('profiles') as any)
      .select('username, display_name, display_name_last_changed, player_color')
      .eq('id', userId)
      .single()

    if (data) {
      setDisplayName(data.display_name || data.username)
      setSelectedColor(data.player_color || '#ffffff')
      
      // Desktop: no name change restrictions
      if (!isDesktop) {
        const lastChanged = new Date(data.display_name_last_changed)
        const daysSinceChange = (Date.now() - lastChanged.getTime()) / (1000 * 60 * 60 * 24)
        
        if (daysSinceChange >= 15) {
          setCanChangeName(true)
        } else {
          setCanChangeName(false)
          setDaysUntilChange(Math.ceil(15 - daysSinceChange))
        }
      }
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    if (!supabase || !userId) return

    // Validate display name if attempting to change it (web only)
    const nameChanged = displayName !== username
    if (!isDesktop && nameChanged && !canChangeName) {
      setError(`You can change your display name in ${daysUntilChange} days`)
      setLoading(false)
      return
    }

    if (displayName.length < 1 || displayName.length > 30) {
      setError('Name must be 1-30 characters')
      setLoading(false)
      return
    }

    try {
      const updateData: any = {
        player_color: selectedColor,
        updated_at: new Date().toISOString(),
      }

      if (isDesktop) {
        // Desktop: always update the name directly, no cooldown
        if (nameChanged) {
          updateData.display_name = displayName
          updateData.username = displayName
        }
      } else {
        // Web: only update display name if it changed and user can change it
        if (nameChanged && canChangeName) {
          updateData.display_name = displayName
          updateData.display_name_last_changed = new Date().toISOString()
        }
      }

      const { error: updateError } = await (supabase
        .from('profiles') as any)
        .update(updateData)
        .eq('id', userId)

      if (updateError) throw updateError

      // Update local state
      setPlayerColor(selectedColor)
      if (nameChanged && canChangeName) {
        setUsername(displayName)
        setCanChangeName(false)
        setDaysUntilChange(15)
      }

      setSuccess(true)
      
      setTimeout(() => {
        onClose()
      }, 1000)
    } catch (err: any) {
      setError(err.message || 'Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        data-ui-element="true"
        className="fixed inset-0 z-[10000100] bg-nier-black/80 flex items-center justify-center p-4"
        onClick={onClose}
        style={{ touchAction: 'auto', overscrollBehavior: 'contain' }}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
      
      {/* Modal -- corner brackets live on this outer, non-scrolling wrapper
          (capped at max-h-[90vh]) so they stay pinned to the modal's actual
          visible edges; the content scrolls in the inner div below instead.
          Previously the brackets were absolutely positioned inside the same
          overflow-y-auto element as the content, so once enough fields were
          added to make it scroll, bottom-0 anchored to the bottom of the
          full scrollable content instead of the visible box. */}
      <div
        className="z-[10000] bg-nier-blackLight border border-nier-border/40 w-[min(30rem,92vw)] max-h-[90vh] pointer-events-auto relative flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

        <div
          className="p-6 overflow-y-auto flex-1 min-h-0"
          style={{
            touchAction: 'pan-y',
            overscrollBehavior: 'contain',
          }}
        >
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
            <h3 className="text-lg text-white tracking-[0.15em] uppercase">Profile</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* Display Name */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-strong text-xs tracking-[0.15em] uppercase">
                {isDesktop ? 'Username' : 'Display Name'}
              </span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
              placeholder={isDesktop ? 'Your username' : 'Your display name'}
              maxLength={30}
              disabled={!isDesktop && !canChangeName}
            />
            
            {!isDesktop && !canChangeName && (
              <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
                ◇ Can change in {daysUntilChange} days
              </p>
            )}
          </div>

          {/* How you work */}
          <div className="flex items-baseline gap-3 pt-2">
            <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">01</span>
            <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">How you work</span>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
          </div>

          {/* Undo History Depth */}
          <div>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
              Steps you can undo: {undoDepth}
            </label>
            <input
              type="range"
              min="1"
              max={MAX_UNDO_DEPTH}
              step="1"
              value={undoDepth}
              onChange={(e) => handleUndoDepthChange(parseInt(e.target.value, 10))}
              className="w-full accent-nier-bg"
            />
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              How many Ctrl+Z steps to remember, in every atrium. Kept in this browser only, never saved online.
            </p>
          </div>

          {/* Shape for batch placement */}
          <div>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
              Shape for batch placement
            </label>
            <div className="flex gap-2">
              {(['square', 'circle'] as const).map(shape => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => handlePackingShapeChange(shape)}
                  className={`flex-1 py-2 border text-xs tracking-[0.15em] uppercase transition-colors ${
                    packingShape === shape
                      ? 'border-nier-bg bg-nier-bg/10 text-nier-bg'
                      : 'border-nier-border/40 text-nier-bg/80 hover:border-nier-border/60'
                  }`}
                >
                  {shape}
                </button>
              ))}
            </div>
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              How dropping or pasting several files at once gets arranged, in every atrium.
              Reorganize Selected asks for a shape each time and ignores this.
            </p>
          </div>

          {/* Color Picker */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-strong text-xs tracking-[0.15em] uppercase">Your cursor</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            <div className="grid grid-cols-5 gap-2 mb-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`w-10 h-10 border-2 transition-all ${
                    selectedColor === color 
                      ? 'border-nier-bg scale-110' 
                      : 'border-nier-border/30 hover:border-nier-border/60'
                  }`}
                  style={{ 
                    backgroundColor: color,
                    boxShadow: selectedColor === color ? `0 0 12px ${color}40` : 'none'
                  }}
                />
              ))}
            </div>
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mb-2">
              How other people see you pointing, in every atrium.
            </p>
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
              className="w-full h-8 border border-nier-border/30 bg-nier-black cursor-pointer"
            />
          </div>

          {/* Moving around */}
          <div className="flex items-baseline gap-3 pt-2">
            <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">02</span>
            <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">Moving around</span>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
          </div>

          {/* Zoom Sensitivity */}
          <div>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
              Zoom speed: {zoomSensitivity.toFixed(2)}
            </label>
            <input
              type="range"
              min={MIN_ZOOM_SENSITIVITY}
              max={MAX_ZOOM_SENSITIVITY}
              step="0.01"
              value={zoomSensitivity}
              onChange={(e) => handleZoomSensitivityChange(parseFloat(e.target.value))}
              className="w-full accent-nier-bg"
            />
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              How far a notch of the wheel, or a pinch, moves you.
            </p>
          </div>

          {/* What you see */}
          <div className="flex items-baseline gap-3 pt-2">
            <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">03</span>
            <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">What you see</span>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
          </div>

          {/* Trace Point to off-screen traces Toggle */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-nier-strong text-xs tracking-[0.1em] uppercase">
                Point to off-screen traces
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                  showTraceIndicators ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
                }`}>
                  {showTraceIndicators && <span className="text-nier-bg text-xs">✓</span>}
                </div>
                <input
                  type="checkbox"
                  checked={showTraceIndicators}
                  onChange={() => setShowTraceIndicators(!showTraceIndicators)}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              Arrows at the edge, with how far away it is
            </p>
          </div>

          {/* Label each trace's type Toggle */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-nier-strong text-xs tracking-[0.1em] uppercase">
                Label each trace's type
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                  showTraceTypeLabels ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
                }`}>
                  {showTraceTypeLabels && <span className="text-nier-bg text-xs">✓</span>}
                </div>
                <input
                  type="checkbox"
                  checked={showTraceTypeLabels}
                  onChange={() => setShowTraceTypeLabels(!showTraceTypeLabels)}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              Always show each trace's type without needing to select it
            </p>
          </div>

          {/* Fade traces near the edge Toggle */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-nier-strong text-xs tracking-[0.1em] uppercase">
                Fade traces near the edge
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                  traceFadeEnabled ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
                }`}>
                  {traceFadeEnabled && <span className="text-nier-bg text-xs">✓</span>}
                </div>
                <input
                  type="checkbox"
                  checked={traceFadeEnabled}
                  onChange={() => setTraceFadeEnabled(!traceFadeEnabled)}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              Softly fade traces out as they leave the edge of your view
            </p>
          </div>

          {/* People in the room */}
          <div className="flex items-baseline gap-3 pt-2">
            <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">04</span>
            <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">People in the room</span>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
          </div>

          {/* Hide my name Toggle */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-nier-strong text-xs tracking-[0.1em] uppercase">
                Hide My Name Tag
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                  hideOwnNameTag ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
                }`}>
                  {hideOwnNameTag && <span className="text-nier-bg text-xs">✓</span>}
                </div>
                <input
                  type="checkbox"
                  checked={hideOwnNameTag}
                  onChange={() => setHideOwnNameTag(!hideOwnNameTag)}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              Hide your own username label above your cursor
            </p>
          </div>

          {/* Hide other names Toggle */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-nier-strong text-xs tracking-[0.1em] uppercase">
                Hide Others' Name Tags
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                  hideOtherNameTags ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
                }`}>
                  {hideOtherNameTags && <span className="text-nier-bg text-xs">✓</span>}
                </div>
                <input
                  type="checkbox"
                  checked={hideOtherNameTags}
                  onChange={() => setHideOtherNameTags(!hideOtherNameTags)}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              Hide username labels above other users' cursors
            </p>
          </div>

          {/* Hide other cursors Toggle */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-nier-strong text-xs tracking-[0.1em] uppercase">
                Hide Others' Cursors
              </label>
              <label className="flex items-center gap-2 cursor-pointer group">
                <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                  hideOtherCursors ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
                }`}>
                  {hideOtherCursors && <span className="text-nier-bg text-xs">✓</span>}
                </div>
                <input
                  type="checkbox"
                  checked={hideOtherCursors}
                  onChange={() => setHideOtherCursors(!hideOtherCursors)}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case mt-1.5">
              Completely hide other users' cursor indicators
            </p>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-xs tracking-wider">
              {error}
            </div>
          )}

          {success && (
            <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-xs tracking-wider">
              ✓ Profile updated
            </div>
          )}

          {/* Save Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
        </div>
      </div>
      </div>
    </>
  )
}
