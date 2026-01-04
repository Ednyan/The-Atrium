import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'

interface ProfileCustomizationProps {
  onClose: () => void
  position: { x: number; y: number }
}

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

export default function ProfileCustomization({ onClose, position }: ProfileCustomizationProps) {
  const { userId, username, setUsername, playerColor, setPlayerColor } = useGameStore()
  const [displayName, setDisplayName] = useState(username)
  const [selectedColor, setSelectedColor] = useState(playerColor)
  const [canChangeName, setCanChangeName] = useState(false)
  const [daysUntilChange, setDaysUntilChange] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

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
      
      // Check if user can change display name
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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    if (!supabase || !userId) return

    // Validate display name if attempting to change it
    const nameChanged = displayName !== username
    if (nameChanged && !canChangeName) {
      setError(`You can change your display name in ${daysUntilChange} days`)
      setLoading(false)
      return
    }

    if (displayName.length < 1 || displayName.length > 30) {
      setError('Display name must be 1-30 characters')
      setLoading(false)
      return
    }

    try {
      const updateData: any = {
        player_color: selectedColor,
        updated_at: new Date().toISOString(),
      }

      // Only update display name if it changed and user can change it
      if (nameChanged && canChangeName) {
        updateData.display_name = displayName
        updateData.display_name_last_changed = new Date().toISOString()
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
        className="fixed inset-0 z-[100] bg-black/20" 
        onClick={onClose}
      />
      
      {/* Context Menu */}
      <div 
        className="fixed z-[101] bg-black/95 border-2 border-white/20 rounded-lg p-4 w-80 pointer-events-auto"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          boxShadow: '0 0 30px rgba(255, 255, 255, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-white font-semibold text-lg">Customize Profile</h3>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Color Picker */}
          <div>
            <label className="block text-white/80 text-sm font-semibold mb-2">
              Cursor Color
            </label>
            <div className="grid grid-cols-5 gap-2 mb-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`w-10 h-10 rounded-full border-2 transition-all ${
                    selectedColor === color 
                      ? 'border-white scale-110' 
                      : 'border-white/30 hover:border-white/60'
                  }`}
                  style={{ 
                    backgroundColor: color,
                    boxShadow: selectedColor === color ? `0 0 15px ${color}` : 'none'
                  }}
                />
              ))}
            </div>
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => setSelectedColor(e.target.value)}
              className="w-full h-10 rounded border-2 border-white/20 bg-black/50 cursor-pointer"
            />
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-white/80 text-sm font-semibold mb-2">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-white focus:outline-none focus:border-white/60"
              placeholder="Your display name"
              maxLength={30}
              disabled={!canChangeName}
            />
            
            {!canChangeName && (
              <p className="text-yellow-400/80 text-xs mt-1">
                ⏰ Can change in {daysUntilChange} days
              </p>
            )}
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded px-3 py-2 text-red-200 text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-500/20 border border-green-500 rounded px-3 py-2 text-green-200 text-sm">
              ✓ Profile updated!
            </div>
          )}

          {/* Save Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-white/90 hover:bg-white disabled:bg-white/30 disabled:cursor-not-allowed text-black font-semibold py-2 px-4 rounded transition-colors"
            style={{
              boxShadow: '0 0 20px rgba(255, 255, 255, 0.3)',
            }}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </>
  )
}
