import { useState, useEffect } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import { deleteMyAccount } from '../lib/account'
import { useTranslation } from '../lib/i18n'
import RichText from './RichText'
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
  const { t } = useTranslation()
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

  // Delete-account state -- web only, irreversible, so it's gated behind
  // typing the account's own username as an explicit confirmation.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  // Accounts created through Google have no password, so there is nothing to
  // ask them for -- and asking anyway would leave them unable to delete their
  // own account. Assumed true until the identities come back, so the field is
  // never missing for someone who does need it. The Edge Function decides
  // this again from its own copy of the user; this is only what to show.
  const [hasPassword, setHasPassword] = useState(true)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  // The three settings that follow the person rather than the atrium. They
  // live in localStorage, so they are readable before the profile row is.
  const [selectedColor, setSelectedColor] = useState(playerColor)
  const [colorSaved, setColorSaved] = useState(false)
  const [undoDepth, setUndoDepth] = useState(() => readUndoDepth())
  const [packingShape, setPackingShape] = useState(() => readPackingShape())

  // Whether the colour in use came from the picker rather than the five
  // presets, which decides whether the picker cell shows that colour or the
  // plus that invites you to choose one. Case-folded because an <input
  // type="color"> always reports lowercase hex while the presets are written
  // in upper -- comparing them raw would call every preset "custom".
  const isCustomColour = !PRESET_COLORS.some(
    c => c.toLowerCase() === selectedColor.toLowerCase(),
  )

  useEffect(() => {
    loadProfile()
    if (!isDesktop) {
      loadHasPassword()
    }
  }, [])

  const loadHasPassword = async () => {
    if (!supabase) return
    const { data } = await supabase.auth.getUser()
    const identities = data?.user?.identities ?? []
    if (identities.length > 0) {
      setHasPassword(identities.some((identity: { provider: string }) => identity.provider === 'email'))
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
      setError(updateError.message || t('profile.errCursorColour'))
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
      setError(t('profile.canChangeIn', { days: daysUntilChange }))
      setLoading(false)
      return
    }

    if (displayName.length < 1 || displayName.length > 30) {
      setError(t('profile.errNameLength'))
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
      setError(err.message || t('profile.errUpdateName'))
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
      setPasswordError(t('auth.errUnavailable'))
      setPasswordLoading(false)
      return
    }

    if (newPassword.length < 6) {
      setPasswordError(t('profile.errPasswordLength'))
      setPasswordLoading(false)
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError(t('auth.passwordsDoNotMatch'))
      setPasswordLoading(false)
      return
    }

    if (!currentPassword) {
      setPasswordError(t('profile.errEnterCurrent'))
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
        setPasswordError(t('profile.errWrongCurrent'))
        setPasswordLoading(false)
        return
      }

      if (currentPassword === newPassword) {
        setPasswordError(t('profile.errSamePassword'))
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
      setPasswordError(err.message || t('profile.errUpdatePassword'))
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleDeleteAccount = async () => {
    // actualUsername is empty until the profile row loads, and an empty
    // confirmation box matches an empty expected name -- which would turn
    // "type your username" into "type nothing" on the one action in this
    // panel that cannot be undone. Loading has to have happened first.
    if (!actualUsername || deleteConfirmText !== actualUsername) return
    setDeleteError('')

    if (hasPassword && !deletePassword) {
      setDeleteError(t('profile.errEnterCurrent'))
      return
    }

    setDeleteLoading(true)

    // The password goes to the Edge Function and is checked there, rather
    // than being checked here first. Verifying in the browser would only ever
    // be a gate in front of the request -- the endpoint would still delete on
    // a valid session alone, so anything that skipped this panel skipped the
    // password with it. One check, on the side that cannot be bypassed.
    const result = await deleteMyAccount(deletePassword)

    if (!result.success) {
      setDeleteError(
        result.code === 'invalid_password'
          ? t('profile.errWrongCurrent')
          : result.code === 'password_required'
            ? t('profile.errEnterCurrent')
            : result.error || 'Failed to delete account.',
      )
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
      // Clicking the backdrop deliberately does nothing: this panel holds
      // half-typed passwords and a delete-account confirmation, and a stray
      // click beside it should not throw that away. The × is the way out.
      // The stop is explicit rather than merely omitted so that no ancestor
      // added later can quietly turn a miss-click back into a dismissal.
      onClick={(e) => e.stopPropagation()}
    >
      {/* Capped and scrolling, like every other panel in the app. The brackets
          sit on this outer, non-scrolling wrapper so they stay pinned to the
          visible edges rather than to the bottom of the scrollable content. */}
      <div className="bg-nier-blackLight border border-nier-border/40 max-w-md w-full mx-4 max-h-[90vh] relative flex flex-col">
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

        {/* Outside the scroller, so the way out stays on screen.
            The title and the × used to be the first thing inside the
            scrolling area, which meant the only control that closes this
            panel scrolled off the top the moment anybody went looking for
            the delete-account section at the bottom -- the furthest point
            from the exit is exactly where somebody is most likely to want
            it. The padding splits with it: the header keeps the top, the
            scroller keeps the sides and the bottom. */}
        <div className="flex justify-between items-center gap-3 px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60 shrink-0" />
            <h2 className="text-lg text-white tracking-[0.15em] uppercase truncate">{t('profile.title')}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="w-8 h-8 shrink-0 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
          >
            ×
          </button>
        </div>

        <div
          className="px-6 pb-6 overflow-y-auto flex-1 min-h-0"
          style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}
        >
        <div className="space-y-4">
          {/* Username (permanent) - only show on web */}
          {!isDesktop && (
            <div>
              <label className="block text-nier-bg/70 text-xs tracking-[0.1em] uppercase mb-2">{t('profile.usernamePermanent')}</label>
              <div className="bg-nier-black border border-nier-border/20 px-3 py-2 text-nier-bg/75 text-sm tracking-wide">
                {actualUsername}
              </div>
            </div>
          )}

          <form onSubmit={handleUpdateDisplayName}>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
              {isDesktop ? t('auth.username') : t('profile.displayName')}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
              placeholder={isDesktop ? t('profile.yourUsername') : t('profile.yourDisplayName')}
              maxLength={30}
              disabled={!isDesktop && !canChange}
            />
            
            {!isDesktop && !canChange && (
              <p className="text-nier-bg/70 text-[0.8rem] leading-relaxed tracking-wide mt-2">
                ◇ {t('profile.canChangeIn', { days: daysUntilChange })}
              </p>
            )}

            {!isDesktop && canChange && (
              <p className="text-nier-bg/60 text-[0.8rem] leading-relaxed tracking-wide mt-2">
                ✓ {t('profile.canChangeNow')}
              </p>
            )}

            {error && (
              <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[0.8rem] leading-relaxed tracking-wide mt-2">
                {error}
              </div>
            )}

            {success && (
              <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[0.8rem] leading-relaxed tracking-wide mt-2">
                ✓ {isDesktop ? t('auth.username') : t('profile.displayName')} {t('common.updated')}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!isDesktop && !canChange) || displayName === username}
              className="w-full mt-4 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {loading ? t('profile.updating') : isDesktop ? t('profile.updateUsername') : t('profile.updateDisplayName')}
            </button>
          </form>


          <div className="h-[1px] bg-gradient-to-r from-nier-border/30 via-nier-border/20 to-transparent my-4" />

          {/* The settings that follow the person into every atrium. They are
              the same three the in-atrium profile panel offers, reading and
              writing the same keys -- changed here, they apply there. */}
          <div className="flex items-baseline gap-3">
            <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{t('profile.howYouWork')}</span>
            <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
          </div>

          <div>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('profile.yourCursor')}</label>
            <div className="grid grid-cols-6 gap-2 mb-2">
              {/* First cell, and it is "anything else" -- the colour you chose
                  yourself belongs at the head of the row rather than tacked
                  on after the five suggestions. It has to read as a control
                  rather than as another preset that happens to be a
                  different colour. A bare <input type="color"> renders as a
                  filled swatch identical in shape to the five beside it, so
                  the only thing saying it opens a picker was a title
                  attribute -- which is a tooltip nobody hovers for and no
                  touch device shows at all.

                  So the native input is stretched over the cell at zero
                  opacity (it stays the real click target, and the OS picker
                  it opens is the point), and what shows through is a dashed
                  cell with a plus: the shape "add your own" takes everywhere
                  else. Dashed against five solid swatches is the difference
                  you can see without reading anything. */}
              <div
                className={`relative w-full h-10 border-2 border-dashed transition-colors cursor-pointer group ${
                  isCustomColour
                    ? 'border-nier-bg'
                    : 'border-nier-border/50 hover:border-nier-border/80'
                }`}
                style={{
                  backgroundColor: isCustomColour ? selectedColor : 'transparent',
                  boxShadow: isCustomColour ? `0 0 12px ${selectedColor}40` : 'none',
                }}
              >
                <input
                  type="color"
                  value={selectedColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                  title={t('profile.anyOtherColour')}
                  aria-label={t('profile.anyOtherColour')}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                {/* Hidden once the cell is carrying a colour of its own, where
                    it would be a plus sitting on top of the answer. */}
                {!isCustomColour && (
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-base leading-none text-nier-bg/70 group-hover:text-nier-bg transition-colors">
                    +
                  </span>
                )}
              </div>
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
            <p className="text-nier-bg/70 text-[0.8rem] leading-relaxed tracking-wide mt-1.5">
              {t('profile.cursorNote')}
              {colorSaved && <span className="text-nier-bg/80"> {t('profile.saved')}</span>}
            </p>
          </div>

          <div>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
              {t('profile.undoSteps', { count: undoDepth })}
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
            <p className="text-nier-bg/70 text-[0.8rem] leading-relaxed tracking-wide mt-1.5">
              {t('profile.undoNote')}
            </p>
          </div>

          <div>
            <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
              {t('profile.batchShape')}
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
                  {shape === 'square' ? t('profile.shapeSquare') : t('profile.shapeCircle')}
                </button>
              ))}
            </div>
            <p className="text-nier-bg/70 text-[0.8rem] leading-relaxed tracking-wide mt-1.5">
              {t('profile.batchNote')}
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
                  <span>{t('profile.changePassword')}</span>
                  <span className="text-nier-bg/70">{showPasswordChange ? '▼' : '▶'}</span>
                </button>
                
                {showPasswordChange && (
                  <form onSubmit={handlePasswordChange} className="space-y-3 mt-3">
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">{t('profile.currentPassword')}</label>
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
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">{t('profile.newPassword')}</label>
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
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">{t('profile.confirmNewPassword')}</label>
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
                      <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[0.8rem] leading-relaxed tracking-wide">
                        {passwordError}
                      </div>
                    )}

                    {passwordSuccess && (
                      <div className="border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-[0.8rem] leading-relaxed tracking-wide">
                        ✓ {t('profile.passwordUpdated')}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
                      className="w-full py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {passwordLoading ? t('profile.updating') : t('profile.updatePassword')}
                    </button>
                  </form>
                )}
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
                {t('landing.privacy')}
              </a>
              <span className="text-nier-bg/50 text-[0.7rem]">◇</span>
              <a
                href="/terms.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nier-bg/70 hover:text-nier-bg/80 text-[0.7rem] tracking-[0.1em] uppercase transition-colors"
              >
                {t('landing.terms')}
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
                  {t('profile.deleteAccount')}
                </button>
              ) : (
                <div className="border border-nier-red/60 bg-nier-red/10 p-3 space-y-3">
                  <p className="text-nier-bg text-[0.8rem] leading-relaxed tracking-wide">
                    {t('profile.deleteWarning')}
                  </p>
                  {/* This line was hardcoded English -- "Type X to confirm"
                      spliced around a <span> -- while two catalogue keys for
                      it sat unused. It is one key now, with the name inside
                      the sentence, because the name lands in a different
                      place in every language. RichText renders that run in
                      the username's real case so it can be copied exactly,
                      which is the whole reason it was a span to begin with. */}
                  <p className="text-nier-bg/75 text-xs tracking-[0.1em] uppercase">
                    <RichText
                      text={t('profile.deleteTypeToConfirm', { name: actualUsername })}
                      className="text-nier-bg normal-case"
                    />
                  </p>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="w-full bg-nier-black border border-nier-red/40 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-red/60 transition-colors"
                    placeholder={actualUsername}
                    autoComplete="off"
                  />

                  {/* And the account password on top of it. Typing a username
                      that is printed on the screen directly above the box is
                      a guard against misclicking, not against a stranger at
                      an unlocked machine -- the password is what tells those
                      two apart. Hidden for accounts that signed up through
                      Google, which have no password to give. */}
                  {hasPassword && (
                  <div>
                    <label
                      htmlFor="delete-account-password"
                      className="block text-nier-bg/75 text-xs tracking-[0.1em] uppercase mb-2"
                    >
                      {t('profile.currentPassword')}
                    </label>
                    <input
                      id="delete-account-password"
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      className="w-full bg-nier-black border border-nier-red/40 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-red/60 transition-colors"
                      autoComplete="current-password"
                    />
                  </div>
                  )}

                  {deleteError && (
                    <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[0.8rem] leading-relaxed tracking-wide">
                      {deleteError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={handleDeleteAccount}
                      disabled={deleteLoading || !actualUsername || deleteConfirmText !== actualUsername || (hasPassword && !deletePassword)}
                      className="flex-1 py-2 bg-nier-red/80 text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-red transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deleteLoading ? t('profile.deleting') : t('profile.deletePermanently')}
                    </button>
                    <button
                      onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeletePassword(''); setDeleteError('') }}
                      disabled={deleteLoading}
                      className="flex-1 py-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors disabled:opacity-30"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </div>
      </div>
    </div>
  )
}
