import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'

interface ProfileSettingsProps {
  onClose: () => void
}

export default function ProfileSettings({ onClose }: ProfileSettingsProps) {
  const { userId, username, setUsername } = useGameStore()
  const [displayName, setDisplayName] = useState(username)
  const [actualUsername, setActualUsername] = useState('')
  const [canChange, setCanChange] = useState(false)
  const [daysUntilChange, setDaysUntilChange] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  
  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

  const loadProfile = async () => {
    if (!supabase || !userId) return

    const { data } = await (supabase
      .from('profiles') as any)
      .select('username, display_name, display_name_last_changed')
      .eq('id', userId)
      .single()

    if (data) {
      setActualUsername(data.username)
      setDisplayName(data.display_name || data.username)
      
      // Check if user can change display name
      const lastChanged = new Date(data.display_name_last_changed)
      const daysSinceChange = (Date.now() - lastChanged.getTime()) / (1000 * 60 * 60 * 24)
      
      if (daysSinceChange >= 15) {
        setCanChange(true)
      } else {
        setCanChange(false)
        setDaysUntilChange(Math.ceil(15 - daysSinceChange))
      }
    }
  }

  const handleUpdateDisplayName = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    if (!supabase || !userId) return

    if (!canChange) {
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
      const { error: updateError } = await (supabase
        .from('profiles') as any)
        .update({
          display_name: displayName,
          display_name_last_changed: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId)

      if (updateError) throw updateError

      setUsername(displayName)
      setSuccess(true)
      setCanChange(false)
      setDaysUntilChange(15)
      
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'Failed to update display name')
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError('')
    setPasswordSuccess(false)
    setPasswordLoading(true)

    if (!supabase) {
      setPasswordError('Authentication not available')
      setPasswordLoading(false)
      return
    }

    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters')
      setPasswordLoading(false)
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      setPasswordLoading(false)
      return
    }

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (updateError) throw updateError

      setPasswordSuccess(true)
      setNewPassword('')
      setConfirmPassword('')
      
      setTimeout(() => {
        setShowPasswordChange(false)
        setPasswordSuccess(false)
      }, 2000)
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to update password')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleLogout = async () => {
    if (!supabase) return
    
    // Clear active_lobby_id before signing out
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await (supabase
        .from('profiles') as any)
        .update({ active_lobby_id: null })
        .eq('id', user.id)
    }
    
    await supabase.auth.signOut()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-lobby-dark border-2 border-lobby-accent rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-white">Profile Settings</h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-white/60 text-sm mb-1">Username (permanent)</label>
            <div className="bg-black/50 border border-white/20 rounded px-3 py-2 text-white/60">
              {actualUsername}
            </div>
          </div>

          <form onSubmit={handleUpdateDisplayName}>
            <label className="block text-white/80 text-sm font-semibold mb-2">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-white focus:outline-none focus:border-lobby-accent"
              placeholder="Your display name"
              maxLength={30}
              disabled={!canChange}
            />
            
            {!canChange && (
              <p className="text-yellow-400 text-xs mt-2">
                ⏰ You can change your display name in {daysUntilChange} days
              </p>
            )}

            {canChange && (
              <p className="text-green-400 text-xs mt-2">
                ✓ You can change your display name now
              </p>
            )}

            {error && (
              <div className="bg-red-500/20 border border-red-500 rounded px-3 py-2 text-red-200 text-sm mt-2">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-500/20 border border-green-500 rounded px-3 py-2 text-green-200 text-sm mt-2">
                ✓ Display name updated successfully!
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !canChange || displayName === username}
              className="w-full mt-4 bg-lobby-accent hover:bg-lobby-accent/80 disabled:bg-lobby-accent/30 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded transition-colors"
            >
              {loading ? 'Updating...' : 'Update Display Name'}
            </button>
          </form>

          <hr className="border-white/20 my-4" />

          {/* Password Change Section */}
          <div>
            <button
              onClick={() => setShowPasswordChange(!showPasswordChange)}
              className="w-full text-left text-white/80 text-sm font-semibold mb-2 flex items-center justify-between hover:text-white transition-colors"
            >
              <span>Change Password</span>
              <span className="text-white/40">{showPasswordChange ? '▼' : '▶'}</span>
            </button>
            
            {showPasswordChange && (
              <form onSubmit={handlePasswordChange} className="space-y-3 mt-3">
                <div>
                  <label className="block text-white/60 text-xs mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-lobby-accent"
                    placeholder="••••••••"
                    minLength={6}
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-white/60 text-xs mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-lobby-accent"
                    placeholder="••••••••"
                    minLength={6}
                    required
                  />
                </div>

                {passwordError && (
                  <div className="bg-red-500/20 border border-red-500 rounded px-3 py-2 text-red-200 text-xs">
                    {passwordError}
                  </div>
                )}

                {passwordSuccess && (
                  <div className="bg-green-500/20 border border-green-500 rounded px-3 py-2 text-green-200 text-xs">
                    ✓ Password updated successfully!
                  </div>
                )}

                <button
                  type="submit"
                  disabled={passwordLoading || !newPassword || !confirmPassword}
                  className="w-full bg-lobby-accent/80 hover:bg-lobby-accent disabled:bg-lobby-accent/30 disabled:cursor-not-allowed text-white font-semibold py-2 px-4 rounded text-sm transition-colors"
                >
                  {passwordLoading ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            )}
          </div>

          <hr className="border-white/20 my-4" />

          <button
            onClick={handleLogout}
            className="w-full bg-red-500/20 hover:bg-red-500/30 border border-red-500 text-red-200 font-semibold py-2 px-4 rounded transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  )
}
