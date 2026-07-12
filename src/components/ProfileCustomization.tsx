import { useState, useEffect } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'

interface ProfileCustomizationProps {
  onClose: () => void
  lobbyId?: string
}

const DEFAULT_UNDO_DEPTH = 25
const MAX_UNDO_DEPTH = 100

const PRESET_COLORS = [
  '#ffffff', // White
  '#ff6b6b', // Red
  '#4ecdc4', // Cyan
  '#ffd93d', // Yellow
  '#95e1d3', // Mint
  '#c38fff', // Purple
  '#ff9a8c', // Salmon
  '#6bcf7f', // Green
  '#ff85a2', // Pink
  '#89a4f4', // Blue
]

export default function ProfileCustomization({ onClose, lobbyId }: ProfileCustomizationProps) {
  const { userId, username, setUsername, playerColor, setPlayerColor, showTraceIndicators, setShowTraceIndicators, showTraceTypeLabels, setShowTraceTypeLabels, hideOwnNameTag, setHideOwnNameTag, hideOtherNameTags, setHideOtherNameTags } = useGameStore()
  const [displayName, setDisplayName] = useState(username)
  const [selectedColor, setSelectedColor] = useState(playerColor)
  const [canChangeName, setCanChangeName] = useState(isDesktop) // Desktop: always allowed
  const [daysUntilChange, setDaysUntilChange] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [undoDepth, setUndoDepth] = useState(DEFAULT_UNDO_DEPTH)

  useEffect(() => {
    loadProfile()
    if (!lobbyId) return
    try {
      const raw = localStorage.getItem(`lobby_${lobbyId}_undoDepth`)
      const parsed = raw ? parseInt(raw, 10) : NaN
      if (Number.isFinite(parsed)) {
        setUndoDepth(Math.max(1, Math.min(MAX_UNDO_DEPTH, parsed)))
      }
    } catch {
      // Ignore localStorage access failures
    }
  }, [lobbyId])

  const handleUndoDepthChange = (value: number) => {
    if (!lobbyId) return
    const clamped = Math.max(1, Math.min(MAX_UNDO_DEPTH, value))
    setUndoDepth(clamped)
    try {
      localStorage.setItem(`lobby_${lobbyId}_undoDepth`, clamped.toString())
    } catch {
      // Ignore localStorage access failures
    }
    window.dispatchEvent(new CustomEvent('lobby-undo-depth-changed', { detail: clamped }))
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
        className="fixed inset-0 z-[10000] bg-nier-black/80 flex items-center justify-center p-4" 
        onClick={onClose}
        style={{ touchAction: 'auto', overscrollBehavior: 'contain' }}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
      
      {/* Modal */}
      <div 
        className="z-[10000] bg-nier-blackLight border border-nier-border/40 p-5 w-80 max-h-[90vh] overflow-y-auto pointer-events-auto relative"
        style={{
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
            <h3 className="text-lg text-white tracking-[0.15em] uppercase">Profile</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-border hover:text-nier-bg hover:border-nier-border/60 transition-colors"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          {/* Color Picker */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Cursor Color</span>
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
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
              className="w-full h-8 border border-nier-border/30 bg-nier-black cursor-pointer"
            />
          </div>

          {/* Trace Distance Indicators Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-nier-border text-[10px] tracking-[0.1em] uppercase">
              Distance Indicators
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                showTraceIndicators ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {showTraceIndicators && <span className="text-nier-bg text-[10px]">✓</span>}
              </div>
              <input
                type="checkbox"
                checked={showTraceIndicators}
                onChange={() => setShowTraceIndicators(!showTraceIndicators)}
                className="hidden"
              />
            </label>
          </div>
          <p className="text-nier-border/40 text-[10px] tracking-wider -mt-3">
            Show off-screen trace direction &amp; distance
          </p>

          {/* Trace Type Labels Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-nier-border text-[10px] tracking-[0.1em] uppercase">
              Trace Type Labels
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                showTraceTypeLabels ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {showTraceTypeLabels && <span className="text-nier-bg text-[10px]">✓</span>}
              </div>
              <input
                type="checkbox"
                checked={showTraceTypeLabels}
                onChange={() => setShowTraceTypeLabels(!showTraceTypeLabels)}
                className="hidden"
              />
            </label>
          </div>
          <p className="text-nier-border/40 text-[10px] tracking-wider -mt-3">
            Always show each trace's type without needing to select it
          </p>

          {/* Hide Own Name Tag Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-nier-border text-[10px] tracking-[0.1em] uppercase">
              Hide My Name Tag
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                hideOwnNameTag ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {hideOwnNameTag && <span className="text-nier-bg text-[10px]">✓</span>}
              </div>
              <input
                type="checkbox"
                checked={hideOwnNameTag}
                onChange={() => setHideOwnNameTag(!hideOwnNameTag)}
                className="hidden"
              />
            </label>
          </div>
          <p className="text-nier-border/40 text-[10px] tracking-wider -mt-3">
            Hide your own username label above your cursor
          </p>

          {/* Hide Other Users' Name Tags Toggle */}
          <div className="flex items-center justify-between">
            <label className="text-nier-border text-[10px] tracking-[0.1em] uppercase">
              Hide Others' Name Tags
            </label>
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                hideOtherNameTags ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {hideOtherNameTags && <span className="text-nier-bg text-[10px]">✓</span>}
              </div>
              <input
                type="checkbox"
                checked={hideOtherNameTags}
                onChange={() => setHideOtherNameTags(!hideOtherNameTags)}
                className="hidden"
              />
            </label>
          </div>
          <p className="text-nier-border/40 text-[10px] tracking-wider -mt-3">
            Hide username labels above other users' cursors
          </p>

          {/* Undo History Depth (per-atrium) */}
          {lobbyId && (
            <div>
              <label className="block text-nier-border text-[10px] tracking-[0.1em] uppercase mb-2">
                Undo History Depth: {undoDepth}
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
              <p className="text-nier-border/40 text-[10px] tracking-wider mt-2">
                How many Ctrl+Z steps to remember in this atrium. Kept only in this browser/session — never saved online.
              </p>
            </div>
          )}

          {/* Display Name */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">
                {isDesktop ? 'Username' : 'Display Name'}
              </span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
              placeholder={isDesktop ? 'Your username' : 'Your display name'}
              maxLength={30}
              disabled={!isDesktop && !canChangeName}
            />
            
            {!isDesktop && !canChangeName && (
              <p className="text-nier-border/50 text-[10px] tracking-wider mt-2">
                ◇ Can change in {daysUntilChange} days
              </p>
            )}
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[10px] tracking-wider">
              {error}
            </div>
          )}

          {success && (
            <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[10px] tracking-wider">
              ✓ Profile updated
            </div>
          )}

          {/* Save Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
      </div>
    </>
  )
}
