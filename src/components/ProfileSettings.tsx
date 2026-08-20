import { useState, useEffect } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import { isPinterestConfigured, initiatePinterestConnect, getPinterestConnectionStatus, disconnectPinterest } from '../lib/pinterest'
import { deleteMyAccount } from '../lib/account'
import {
  MAX_UNDO_DEPTH,
  readUndoDepth,
  writeUndoDepth,
  readPackingShape,
  writePackingShape,
} from '../lib/atriumPreferences'

// The same five the in-atrium panel offers, from the palette the rest of the
// app is drawn in. The picker under them still takes anything.
const PRESET_COLORS = ['#FF8A3D', '#E8C15A', '#9AD4C4', '#A8B6D9', '#C77DFF']

interface ProfileSettingsProps {
  onClose: () => void
}

export default function ProfileSettings({ onClose }: ProfileSettingsProps) {
  const { userId, username, setUsername, playerColor, setPlayerColor } = useGameStore()
  const [displayName, setDisplayName] = useState(username)
  const [actualUsername, setActualUsername] = useState('')
  const [canChange, setCanChange] = useState(isDesktop) // Desktop: always allowed
  const [daysUntilChange, setDaysUntilChange] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  
  // Password change state
  const [showPasswordChange, setShowPasswordChange] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  // Pinterest connection state -- web only (desktop OAuth needs deep-link
  // support this app doesn't have yet, see src/lib/pinterest.ts)
  const [pinterestConnected, setPinterestConnected] = useState(false)
  const [pinterestUsername, setPinterestUsername] = useState<string | null>(null)
  const [pinterestStatusLoading, setPinterestStatusLoading] = useState(!isDesktop)
  const [pinterestDisconnecting, setPinterestDisconnecting] = useState(false)

  // Delete-account state -- web only, irreversible, so it's gated behind
  // typing the account's own username as an explicit confirmation.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // The three settings that follow the person rather than the atrium. They
  // live in localStorage, so they are readable before the profile row is.
  const [selectedColor, setSelectedColor] = useState(playerColor)
  const [colorSaved, setColorSaved] = useState(false)
  const [undoDepth, setUndoDepth] = useState(() => readUndoDepth())
  const [packingShape, setPackingShape] = useState(() => readPackingShape())

  useEffect(() => {
    loadProfile()
    if (!isDesktop) loadPinterestStatus()
  }, [])

  const loadPinterestStatus = async () => {
    setPinterestStatusLoading(true)
    const { connected, username } = await getPinterestConnectionStatus()
    setPinterestConnected(connected)
    setPinterestUsername(username)
    setPinterestStatusLoading(false)
  }

  const handleDisconnectPinterest = async () => {
    setPinterestDisconnecting(true)
    try {
      await disconnectPinterest()
      setPinterestConnected(false)
      setPinterestUsername(null)
    } finally {
      setPinterestDisconnecting(false)
    }
  }

  const loadProfile = async () => {
    if (!supabase || !userId) return

    const { data } = await (supabase
      .from('profiles') as any)
      .select('username, display_name, display_name_last_changed, player_color')
      .eq('id', userId)
      .single()

    if (data) {
      setActualUsername(data.username)
      setDisplayName(data.display_name || data.username)
      if (data.player_color) {
        setSelectedColor(data.player_color)
        setPlayerColor(data.player_color)
      }
      
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

  // Saved on click rather than with the name form: that form's button is
  // disabled while the name is unchanged, so a colour picked on its own could
  // never be submitted through it.
  const handleColorChange = async (color: string) => {
    setSelectedColor(color)
    setPlayerColor(color)
    setColorSaved(false)
    if (!supabase || !userId) return
    const { error: updateError } = await (supabase
      .from('profiles') as any)
      .update({ player_color: color, updated_at: new Date().toISOString() })
      .eq('id', userId)
    if (updateError) {
      setError(updateError.message || 'Failed to save your cursor colour')
      return
    }
    setColorSaved(true)
    setTimeout(() => setColorSaved(false), 1600)
  }

  const handleUndoDepthChange = (value: number) => {
    const clamped = Math.max(1, Math.min(MAX_UNDO_DEPTH, value))
    setUndoDepth(clamped)
    writeUndoDepth(clamped)
    // An atrium open behind this screen picks it up without a reload.
    window.dispatchEvent(new CustomEvent('lobby-undo-depth-changed', { detail: clamped }))
  }

  const handlePackingShapeChange = (shape: 'square' | 'circle') => {
    setPackingShape(shape)
    writePackingShape(shape)
    window.dispatchEvent(new CustomEvent('lobby-packing-shape-changed', { detail: { lobbyId: null, shape } }))
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

    if (!currentPassword) {
      setPasswordError('Enter your current password')
      setPasswordLoading(false)
      return
    }

    try {
      // Prove it is the account holder at the keyboard before changing the
      // password. A session left open on a shared machine is enough to change
      // it otherwise, which locks the real owner out of their own account.
      // Supabase has no verify-password call, so the check is a sign-in with
      // the same credentials: it fails harmlessly on a wrong password and
      // leaves the existing session alone.
      const { data: userData } = await supabase.auth.getUser()
      const email = userData?.user?.email
      if (!email) throw new Error('Could not confirm which account this is')

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })
      if (reauthError) {
        setPasswordError('That is not your current password')
        setPasswordLoading(false)
        return
      }

      if (currentPassword === newPassword) {
        setPasswordError('The new password is the same as the current one')
        setPasswordLoading(false)
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (updateError) throw updateError

      setPasswordSuccess(true)
      setCurrentPassword('')
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

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== actualUsername) return
    setDeleteError('')
    setDeleteLoading(true)

    const result = await deleteMyAccount()

    if (!result.success) {
      setDeleteError(result.error || 'Failed to delete account.')
      setDeleteLoading(false)
      return
    }

    localStorage.removeItem('lobby_hasEntered')
    localStorage.removeItem('lobby_currentLobbyId')
    localStorage.removeItem('lobby_showBrowser')

    window.location.hash = '/'
    window.location.reload()
  }

  return (
    <div
      className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000] p-4"
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
            className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="space-y-4">
          {/* Username (permanent) - only show on web */}
          {!isDesktop && (
            <div>
              <label className="block text-nier-bg/70 text-xs tracking-[0.1em] uppercase mb-2">Username (permanent)</label>
              <div className="bg-nier-black border border-nier-border/20 px-3 py-2 text-nier-bg/75 text-sm tracking-wide">
                {actualUsername}
              </div>
            </div>
          )}

          <form onSubmit={handleUpdateDisplayName}>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
              {isDesktop ? 'Username' : 'Display Name'}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
              placeholder={isDesktop ? 'Your username' : 'Your display name'}
              maxLength={30}
              disabled={!isDesktop && !canChange}
            />
            
            {!isDesktop && !canChange && (
              <p className="text-nier-bg/70 text-[0.7rem] leading-relaxed tracking-wide mt-2">
                ◇ You can change your display name in {daysUntilChange} days
              </p>
            )}

            {!isDesktop && canChange && (
              <p className="text-nier-bg/60 text-[0.7rem] leading-relaxed tracking-wide mt-2">
                ✓ You can change your display name now
              </p>
            )}

            {error && (
              <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[0.7rem] leading-relaxed tracking-wide mt-2">
                {error}
              </div>
            )}

            {success && (
              <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[0.7rem] leading-relaxed tracking-wide mt-2">
                ✓ {isDesktop ? 'Username' : 'Display name'} updated
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!isDesktop && !canChange) || displayName === username}
              className="w-full mt-4 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? 'Updating...' : isDesktop ? 'Update Username' : 'Update Display Name'}
            </button>
          </form>


          <div className="h-[1px] bg-gradient-to-r from-nier-border/30 via-nier-border/20 to-transparent my-4" />

          {/* The settings that follow the person into every atrium. They are
              the same three the in-atrium profile panel offers, reading and
              writing the same keys -- changed here, they apply there. */}
          <div className="flex items-baseline gap-3">
            <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">How you work</span>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
          </div>

          <div>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Your cursor</label>
            <div className="grid grid-cols-5 gap-2 mb-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => handleColorChange(color)}
                  className={`w-full h-10 border-2 transition-all ${
                    selectedColor === color
                      ? 'border-nier-bg scale-105'
                      : 'border-nier-border/30 hover:border-nier-border/60'
                  }`}
                  style={{
                    backgroundColor: color,
                    boxShadow: selectedColor === color ? `0 0 12px ${color}40` : 'none',
                  }}
                />
              ))}
            </div>
            <input
              type="color"
              value={selectedColor}
              onChange={(e) => handleColorChange(e.target.value)}
              className="atrium-swatch w-full h-8 border border-nier-border/30 bg-nier-black cursor-pointer"
            />
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
              How other people see you pointing, in every atrium.
              {colorSaved && <span className="text-nier-bg/80"> Saved.</span>}
            </p>
          </div>

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
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
              How many Ctrl+Z steps to remember, in every atrium. Kept in this browser only, never saved online.
            </p>
          </div>

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
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
              How dropping or pasting several files at once gets arranged, in every atrium.
              Reorganize Selected asks for a shape each time and ignores this.
            </p>
          </div>

          <div className="h-[1px] bg-gradient-to-r from-nier-border/30 via-nier-border/20 to-transparent my-4" />

          {/* Password Change Section - only show on web */}
          {!isDesktop && (
            <>
              <div>
                <button
                  onClick={() => {
                    setShowPasswordChange(!showPasswordChange)
                    setCurrentPassword('')
                    setNewPassword('')
                    setConfirmPassword('')
                    setPasswordError('')
                  }}
                  className="w-full text-left text-nier-bg/80 text-xs tracking-[0.1em] uppercase flex items-center justify-between hover:text-nier-bg transition-colors"
                >
                  <span>Change Password</span>
                  <span className="text-nier-bg/70">{showPasswordChange ? '▼' : '▶'}</span>
                </button>
                
                {showPasswordChange && (
                  <form onSubmit={handlePasswordChange} className="space-y-3 mt-3">
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">Current Password</label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">New Password</label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                        placeholder="••••••••"
                        minLength={6}
                        required
                      />
                    </div>
                    
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">Confirm New Password</label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                        placeholder="••••••••"
                        minLength={6}
                        required
                      />
                    </div>

                    {passwordError && (
                      <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[0.7rem] leading-relaxed tracking-wide">
                        {passwordError}
                      </div>
                    )}

                    {passwordSuccess && (
                      <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[0.7rem] leading-relaxed tracking-wide">
                        ✓ Password updated
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
                      className="w-full py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {passwordLoading ? 'Updating...' : 'Update Password'}
                    </button>
                  </form>
                )}
              </div>

              <div className="h-[1px] bg-gradient-to-r from-nier-border/30 via-nier-border/20 to-transparent my-4" />
            </>
          )}

          {/* Pinterest Connection - web only (desktop OAuth needs deep-link
              support this app doesn't have yet) */}
          {!isDesktop && (
            <>
              <div>
                <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                  Pinterest
                </label>
                {pinterestStatusLoading ? (
                  <p className="text-nier-bg/70 text-[0.7rem] leading-relaxed tracking-wide">Checking connection...</p>
                ) : pinterestConnected ? (
                  <div className="space-y-2">
                    <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[0.7rem] leading-relaxed tracking-wide">
                      ✓ Connected{pinterestUsername ? ` as @${pinterestUsername}` : ''}
                    </div>
                    <button
                      onClick={handleDisconnectPinterest}
                      disabled={pinterestDisconnecting}
                      className="w-full py-2 border border-nier-red/40 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:bg-nier-red/20 hover:text-nier-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {pinterestDisconnecting ? 'Disconnecting...' : 'Disconnect Pinterest'}
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={initiatePinterestConnect}
                      disabled={!isPinterestConfigured()}
                      className="w-full py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Connect Pinterest
                    </button>
                    {!isPinterestConfigured() && (
                      <p className="text-nier-bg/70 text-[0.7rem] leading-relaxed tracking-wide mt-2">
                        Pinterest integration isn't configured yet.
                      </p>
                    )}
                  </>
                )}
                <p className="text-nier-bg/70 text-[0.7rem] leading-relaxed tracking-wide mt-2">
                  Lets you import a board's pins as traces from inside an atrium.
                </p>
              </div>

              <div className="h-[1px] bg-gradient-to-r from-nier-border/30 via-nier-border/20 to-transparent my-4" />
            </>
          )}

          {!isDesktop && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <a
                href="/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nier-bg/70 hover:text-nier-bg/80 text-[0.7rem] tracking-[0.1em] uppercase transition-colors"
              >
                Privacy Policy
              </a>
              <span className="text-nier-bg/50 text-[0.7rem]">◇</span>
              <a
                href="/terms.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nier-bg/70 hover:text-nier-bg/80 text-[0.7rem] tracking-[0.1em] uppercase transition-colors"
              >
                Terms of Service
              </a>
            </div>
          )}

          {/* Delete Account -- web only, irreversible */}
          {!isDesktop && (
            <>
              <div className="h-[1px] bg-gradient-to-r from-nier-red/30 via-nier-red/10 to-transparent my-4" />

              {!showDeleteConfirm ? (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full py-2 border border-nier-red/60 text-nier-red text-xs tracking-[0.1em] uppercase hover:bg-nier-red/20 transition-colors"
                >
                  Delete Account
                </button>
              ) : (
                <div className="border border-nier-red/60 bg-nier-red/10 p-3 space-y-3">
                  <p className="text-nier-bg text-[0.7rem] leading-relaxed tracking-wide">
                    This permanently deletes your account, profile, and every atrium you own. Content you placed in atriums owned by other people stays, but is anonymized to "Deleted User" instead of your name. This cannot be undone.
                  </p>
                  <p className="text-nier-bg/75 text-xs tracking-[0.1em] uppercase">
                    Type <span className="text-nier-bg normal-case">{actualUsername}</span> to confirm
                  </p>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="w-full bg-nier-black border border-nier-red/40 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-red/60 transition-colors"
                    placeholder={actualUsername}
                    autoComplete="off"
                  />

                  {deleteError && (
                    <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[0.7rem] leading-relaxed tracking-wide">
                      {deleteError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleteLoading || deleteConfirmText !== actualUsername}
                      className="flex-1 py-2 bg-nier-red/80 text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-red transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deleteLoading ? 'Deleting...' : 'Delete Permanently'}
                    </button>
                    <button
                      onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteError('') }}
                      disabled={deleteLoading}
                      className="flex-1 py-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors disabled:opacity-30"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
