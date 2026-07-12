import { useState, useEffect } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'

interface ProfileSettingsProps {
  onClose: () => void
}

export default function ProfileSettings({ onClose }: ProfileSettingsProps) {
  const { userId, username, setUsername } = useGameStore()
  const [zoomSensitivity, setZoomSensitivity] = useState(0.16)
  const [displayName, setDisplayName] = useState(username)
  const [actualUsername, setActualUsername] = useState('')
  const [canChange, setCanChange] = useState(isDesktop) // Desktop: always allowed
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
    try {
      const stored = localStorage.getItem('lobby_zoomSensitivity')
      if (stored) {
        const parsed = parseFloat(stored)
        if (Number.isFinite(parsed)) {
          setZoomSensitivity(Math.max(0.04, Math.min(0.6, parsed)))
        }
      }
    } catch {
      // Ignore localStorage access failures
    }
  }, [])

  const handleZoomSensitivityChange = (value: number) => {
    const clamped = Math.max(0.04, Math.min(0.6, value))
    setZoomSensitivity(clamped)
    try {
      localStorage.setItem('lobby_zoomSensitivity', clamped.toString())
    } catch {
      // Ignore localStorage access failures
    }
    window.dispatchEvent(new CustomEvent('lobby-zoom-sensitivity-changed', { detail: clamped }))
  }

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
      
      // Desktop: no name change restrictions
      if (!isDesktop) {
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
  }

  const handleUpdateDisplayName = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    if (!supabase || !userId) return

    if (!isDesktop && !canChange) {
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
        updated_at: new Date().toISOString(),
      }

      if (isDesktop) {
        // Desktop: update both username and display_name, no cooldown
        updateData.display_name = displayName
        updateData.username = displayName
      } else {
        // Web: only update display_name with cooldown
        updateData.display_name = displayName
        updateData.display_name_last_changed = new Date().toISOString()
      }

      const { error: updateError } = await (supabase
        .from('profiles') as any)
        .update(updateData)
        .eq('id', userId)

      if (updateError) throw updateError

      setUsername(displayName)
      setSuccess(true)
      if (!isDesktop) {
        setCanChange(false)
        setDaysUntilChange(15)
      }
      
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'Failed to update name')
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
    
    // Clear local storage
    localStorage.removeItem('lobby_hasEntered')
    localStorage.removeItem('lobby_currentLobbyId')
    localStorage.removeItem('lobby_showBrowser')
    
    await supabase.auth.signOut()
    
    // Force navigation to landing page
    window.location.hash = '/'
    window.location.reload()
  }

  return (
    <div
      className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000] p-4"
      style={{ touchAction: 'auto', overscrollBehavior: 'contain' }}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
            <h2 className="text-lg text-white tracking-[0.15em] uppercase">Profile Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-border hover:text-nier-bg hover:border-nier-border/60 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Username (permanent) - only show on web */}
          {!isDesktop && (
            <div>
              <label className="block text-nier-border/50 text-[9px] tracking-[0.15em] uppercase mb-2">Username (permanent)</label>
              <div className="bg-nier-black border border-nier-border/20 px-3 py-2 text-nier-border/60 text-sm tracking-wide">
                {actualUsername}
              </div>
            </div>
          )}

          <form onSubmit={handleUpdateDisplayName}>
            <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
              {isDesktop ? 'Username' : 'Display Name'}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
              placeholder={isDesktop ? 'Your username' : 'Your display name'}
              maxLength={30}
              disabled={!isDesktop && !canChange}
            />
            
            {!isDesktop && !canChange && (
              <p className="text-nier-border/50 text-[10px] tracking-wider mt-2">
                ◇ You can change your display name in {daysUntilChange} days
              </p>
            )}

            {!isDesktop && canChange && (
              <p className="text-nier-bg/60 text-[10px] tracking-wider mt-2">
                ✓ You can change your display name now
              </p>
            )}

            {error && (
              <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[10px] tracking-wider mt-2">
                {error}
              </div>
            )}

            {success && (
              <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[10px] tracking-wider mt-2">
                ✓ {isDesktop ? 'Username' : 'Display name'} updated
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!isDesktop && !canChange) || displayName === username}
              className="w-full mt-4 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? 'Updating...' : isDesktop ? 'Update Username' : 'Update Display Name'}
            </button>
          </form>

          <div>
            <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
              Zoom Sensitivity: {zoomSensitivity.toFixed(2)}
            </label>
            <input
              type="range"
              min="0.04"
              max="0.6"
              step="0.01"
              value={zoomSensitivity}
              onChange={(e) => handleZoomSensitivityChange(parseFloat(e.target.value))}
              className="w-full accent-nier-bg"
            />
            <p className="text-nier-border/50 text-[10px] tracking-wider mt-2">
              ◇ Higher values zoom faster for mouse wheel and trackpad.
            </p>
          </div>

          <div className="h-[1px] bg-gradient-to-r from-nier-border/30 via-nier-border/20 to-transparent my-4" />

          {/* Password Change Section - only show on web */}
          {!isDesktop && (
            <>
              <div>
                <button
                  onClick={() => setShowPasswordChange(!showPasswordChange)}
                  className="w-full text-left text-nier-border text-[10px] tracking-[0.15em] uppercase flex items-center justify-between hover:text-nier-bg transition-colors"
                >
                  <span>Change Password</span>
                  <span className="text-nier-border/40">{showPasswordChange ? '▼' : '▶'}</span>
                </button>
                
                {showPasswordChange && (
                  <form onSubmit={handlePasswordChange} className="space-y-3 mt-3">
                    <div>
                      <label className="block text-nier-border/60 text-[9px] tracking-[0.15em] uppercase mb-1">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                        placeholder="••••••••"
                        minLength={6}
                        required
                      />
                    </div>
                    
                    <div>
                      <label className="block text-nier-border/60 text-[9px] tracking-[0.15em] uppercase mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                        placeholder="••••••••"
                        minLength={6}
                        required
                      />
                    </div>

                    {passwordError && (
                      <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[10px] tracking-wider">
                        {passwordError}
                      </div>
                    )}

                    {passwordSuccess && (
                      <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[10px] tracking-wider">
                        ✓ Password updated
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={passwordLoading || !newPassword || !confirmPassword}
                      className="w-full py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {passwordLoading ? 'Updating...' : 'Update Password'}
                    </button>
                  </form>
                )}
              </div>

              <div className="h-[1px] bg-gradient-to-r from-nier-border/30 via-nier-border/20 to-transparent my-4" />
            </>
          )}

          <button
            onClick={handleLogout}
            className="w-full py-2 border border-nier-red/40 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:bg-nier-red/20 hover:text-nier-bg transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  )
}
