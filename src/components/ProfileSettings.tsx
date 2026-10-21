import { useState, useEffect } from 'react'
import { friendlyAuthError } from '../lib/authErrors'
import { supabase, isDesktop } from '../lib/supabase'
import { useGamePick } from '../store/gameStore'
import { deleteMyAccount, markFarewell, requestDeletionCode } from '../lib/account'
import { useTranslation } from '../lib/i18n'
import RichText from './RichText'
import {
  MAX_UNDO_DEPTH,
  readUndoDepth,
  writeUndoDepth,
  readPackingShape,
  writePackingShape,
} from '../lib/atriumPreferences'
import { goTo } from '../lib/route'
import { daysUntilNameChange, loadMyProfile, saveMyProfile } from '../lib/profile'
import { googleAccount, workerAccount } from '../lib/signedIn'
import { adopt, changePassword, deleteEmailAccount } from '../lib/emailAccount'
import GoogleButton from './GoogleButton'

// The same five the in-atrium panel offers, from the palette the rest of the
// app is drawn in. The picker under them still takes anything.
const PRESET_COLORS = ['#FF8A3D', '#E8C15A', '#9AD4C4', '#A8B6D9', '#C77DFF']

interface ProfileSettingsProps {
  onClose: () => void
}

export default function ProfileSettings({ onClose }: ProfileSettingsProps) {
  const { t } = useTranslation()
  const { userId, username, setUsername, playerColor, setPlayerColor } = useGamePick('userId', 'username', 'setUsername', 'playerColor', 'setPlayerColor')
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
  // Confirmation is an emailed code now, for every account rather than only the
  // ones with a password -- see add_account_deletion_codes.sql. So there is no
  // longer anything to look up about how somebody signed in: the flow is the
  // same either way.
  const [deleteCode, setDeleteCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeSending, setCodeSending] = useState(false)
  // Seconds until another code may be asked for. The server enforces this; the
  // countdown only stops the button offering something that will be refused.
  const [resendIn, setResendIn] = useState(0)
  const [deleteLoading, setDeleteLoading] = useState(false)
  // A Google account (lib/signedIn) is deleted on Google's word, not a code --
  // and has no password to change. An email account (lib/emailAccount) is
  // deleted with its password, and changes it at the worker.
  const google = !!googleAccount()
  const emailAccount = workerAccount()?.kind === 'email'
  const [deletePassword, setDeletePassword] = useState('')
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
  }, [])

  // Ticks the resend cooldown down to zero. Cleared on unmount so closing the
  // panel mid-countdown does not leave an interval running against a component
  // that is gone.
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setInterval(() => setResendIn(seconds => Math.max(0, seconds - 1)), 1000)
    return () => clearInterval(timer)
  }, [resendIn])

  // Either kind of account's (lib/profile).
  const loadProfile = async () => {
    if (!userId) return
    const profile = await loadMyProfile(userId).catch(() => null)
    if (!profile) return
    setActualUsername(profile.username)
    setDisplayName(profile.displayName)
    if (profile.color) {
      setSelectedColor(profile.color)
      setPlayerColor(profile.color)
    }
    const days = daysUntilNameChange(profile.nameChangedAt)
    setCanChange(days === 0)
    setDaysUntilChange(days)
  }

  // Saved on click rather than with the name form: that form's button is
  // disabled while the name is unchanged, so a colour picked on its own could
  // never be submitted through it.
  const handleColorChange = async (color: string) => {
    setSelectedColor(color)
    setPlayerColor(color)
    setColorSaved(false)
    if (!userId) return
    try {
      await saveMyProfile(userId, { color })
    } catch (updateError: any) {
      setError(updateError?.message || t('profile.errCursorColour'))
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

    if (!userId) return

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
      // The web's waits its days; the desktop's is its username too (lib/profile).
      await saveMyProfile(userId, { displayName })

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
      setError(err?.message === 'NAME_TOO_SOON'
        ? t('profile.canChangeIn', { days: daysUntilNameChange(null, err.until) })
        : err?.message || t('profile.errUpdateName'))
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

    // An email account: the worker checks the current one and sets the new
    // (lib/emailAccount); every other sign-in of it ends.
    if (emailAccount) {
      try {
        if (currentPassword === newPassword) throw new Error('SAME')
        await changePassword(currentPassword, newPassword)
        setPasswordSuccess(true)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => { setShowPasswordChange(false); setPasswordSuccess(false) }, 2000)
      } catch (err: any) {
        setPasswordError(err?.message === 'WRONG_PASSWORD' ? t('profile.errWrongCurrent') : err?.message === 'SAME' ? t('profile.errSamePassword') : t('profile.errUpdatePassword'))
      } finally {
        setPasswordLoading(false)
      }
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

      // The worker's copy of it too (lib/emailAccount), with the sign-in just made.
      const { data: { session: fresh } } = await supabase.auth.getSession()
      if (fresh && actualUsername) void adopt(fresh.access_token, email, actualUsername, newPassword)

      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      
      setTimeout(() => {
        setShowPasswordChange(false)
        setPasswordSuccess(false)
      }, 2000)
    } catch (err: any) {
      setPasswordError(friendlyAuthError(err, t('profile.errUpdatePassword')))
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleSendDeletionCode = async () => {
    // Guarded on the username as well, so the first thing this flow does is
    // never to email somebody about deleting an account because a stranger
    // opened the panel and pressed a button.
    if (!actualUsername || deleteConfirmText !== actualUsername) return
    setDeleteError('')
    setCodeSending(true)

    const result = await requestDeletionCode()
    setCodeSending(false)

    if (!result.success) {
      if (result.code === 'too_soon') {
        // Not an error worth a red box: a code is already in their inbox.
        setCodeSent(true)
        setResendIn(result.retryAfter ?? 60)
        return
      }
      setDeleteError(
        result.code === 'email_not_configured' || result.code === 'send_failed'
          ? t('profile.errCodeNotSent')
          : result.error || t('profile.errCodeNotSent'),
      )
      return
    }

    setCodeSent(true)
    setResendIn(60)
  }

  const handleDeleteAccount = async () => {
    // actualUsername is empty until the profile row loads, and an empty
    // confirmation box matches an empty expected name -- which would turn
    // "type your username" into "type nothing" on the one action in this
    // panel that cannot be undone. Loading has to have happened first.
    if (!actualUsername || deleteConfirmText !== actualUsername) return
    setDeleteError('')

    if (!deleteCode) {
      setDeleteError(t('profile.errEnterCode'))
      return
    }

    setDeleteLoading(true)

    // The code goes to the Edge Function and is checked there, rather than
    // being checked here first. Verifying in the browser would only ever be a
    // gate in front of the request -- the endpoint would still delete on a
    // valid session alone, so anything that skipped this panel skipped the
    // check with it. One check, on the side that cannot be bypassed.
    const result = await deleteMyAccount(deleteCode)

    if (!result.success) {
      setDeleteError(
        result.code === 'invalid_code'
          ? t('profile.errWrongCode')
          : result.code === 'code_expired'
            ? t('profile.errCodeExpired')
            : result.code === 'code_required'
              ? t('profile.errEnterCode')
              : result.error || t('profile.errDeleteAccount'),
      )
      // An expired or spent code cannot be retyped into working, so the panel
      // goes back to offering a new one instead of leaving a dead box.
      if (result.code === 'code_expired') {
        setCodeSent(false)
        setDeleteCode('')
        setResendIn(0)
      }
      setDeleteLoading(false)
      return
    }

    leaveAfterDeletion()
  }

  // An email account's: its password, once more -- the worker checks it, and
  // this browser is signed out as it goes (lib/emailAccount).
  const handleDeleteEmailAccount = async () => {
    if (!actualUsername || deleteConfirmText !== actualUsername || !deletePassword) return
    setDeleteError('')
    setDeleteLoading(true)
    try {
      await deleteEmailAccount(deletePassword)
    } catch (err: any) {
      setDeleteError(err?.message === 'WRONG_PASSWORD' ? t('profile.errWrongCurrent') : t('profile.errDeleteAccount'))
      setDeleteLoading(false)
      return
    }
    leaveAfterDeletion()
  }

  // A Google account's: confirmed by a sign-in with its Google just now (the
  // button below), which the worker checks -- no code to email. It signs this
  // browser out as it goes (lib/drive).
  const handleDeleteGoogleAccount = async (idToken: string) => {
    if (!actualUsername || deleteConfirmText !== actualUsername) return
    setDeleteError('')
    setDeleteLoading(true)
    try {
      await (await import('../lib/drive')).deleteGoogleAccount(idToken)
    } catch (err: any) {
      setDeleteError(err?.message || t('profile.errDeleteAccount'))
      setDeleteLoading(false)
      return
    }
    leaveAfterDeletion()
  }

  // Gone: what this browser kept of where one was, and on to the start --
  // where it's said, with thanks (App's FarewellNotice).
  const leaveAfterDeletion = () => {
    markFarewell()
    localStorage.removeItem('lobby_hasEntered')
    localStorage.removeItem('lobby_currentLobbyId')
    localStorage.removeItem('lobby_showBrowser')
    goTo('/')
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

          {/* Password Change Section - only on the web, for an account with a password */}
          {!isDesktop && !google && (
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
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nier-bg/70 hover:text-nier-bg/80 text-[0.7rem] tracking-[0.1em] uppercase transition-colors"
              >
                {t('landing.privacy')}
              </a>
              <span className="text-nier-bg/50 text-[0.7rem]">◇</span>
              <a
                href="/terms"
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

                  {/* And a code emailed to the account, on top of it. Typing a
                      username printed on the screen directly above the box is a
                      guard against misclicking, not against a stranger at an
                      unlocked machine -- the code is what tells those two
                      apart, and unlike the password it replaced, every account
                      has one. */}
                  {google ? (
                    // A Google account confirms with Google, once its name is typed.
                    actualUsername && deleteConfirmText === actualUsername && (
                      <div className="space-y-2">
                        <p className="text-nier-bg/70 text-[0.75rem] leading-relaxed tracking-wide normal-case">{t('profile.deleteWithGoogle')}</p>
                        <GoogleButton busy={deleteLoading} onCredential={idToken => void handleDeleteGoogleAccount(idToken)} />
                      </div>
                    )
                  ) : emailAccount ? (
                    // An email account confirms with its password, once its name is typed.
                    actualUsername && deleteConfirmText === actualUsername && (
                      <div>
                        <label htmlFor="delete-account-password" className="block text-nier-bg/75 text-xs tracking-[0.1em] uppercase mb-2">
                          {t('profile.deleteWithPassword')}
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
                    )
                  ) : !codeSent ? (
                    <button
                      onClick={handleSendDeletionCode}
                      disabled={codeSending || !actualUsername || deleteConfirmText !== actualUsername}
                      className="w-full py-2 border border-nier-red/60 text-nier-red text-xs tracking-[0.1em] uppercase hover:bg-nier-red/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {codeSending ? t('profile.sendingCode') : t('profile.sendCode')}
                    </button>
                  ) : (
                    <div>
                      <label
                        htmlFor="delete-account-code"
                        className="block text-nier-bg/75 text-xs tracking-[0.1em] uppercase mb-2"
                      >
                        {t('profile.deleteCode')}
                      </label>
                      <p className="text-nier-bg/60 text-[0.75rem] leading-relaxed tracking-wide mb-2 normal-case">
                        {t('profile.deleteCodeSent')}
                      </p>
                      <input
                        id="delete-account-code"
                        type="text"
                        inputMode="numeric"
                        // Six digits, so anything longer is a paste of
                        // something else and anything non-numeric is a typo.
                        // Filtered rather than validated, because a box that
                        // silently refuses the wrong character is quicker to
                        // understand than one that complains afterwards.
                        value={deleteCode}
                        onChange={(e) => setDeleteCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        className="w-full bg-nier-black border border-nier-red/40 text-nier-bg px-3 py-2 text-sm tracking-[0.4em] placeholder-nier-bg/50 focus:border-nier-red/60 transition-colors"
                        placeholder="000000"
                        autoComplete="one-time-code"
                      />
                      <button
                        onClick={handleSendDeletionCode}
                        disabled={codeSending || resendIn > 0}
                        className="mt-2 text-nier-bg/60 text-[0.75rem] tracking-wide underline hover:text-nier-bg transition-colors disabled:no-underline disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {resendIn > 0 ? t('profile.resendCodeIn', { seconds: String(resendIn) }) : t('profile.resendCode')}
                      </button>
                    </div>
                  )}

                  {deleteError && (
                    <div className="border border-nier-red/40 bg-nier-red/10 px-3 py-2 text-nier-bg/80 text-[0.8rem] leading-relaxed tracking-wide">
                      {deleteError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {!google && <button
                      onClick={emailAccount ? handleDeleteEmailAccount : handleDeleteAccount}
                      disabled={deleteLoading || !actualUsername || deleteConfirmText !== actualUsername || (emailAccount ? !deletePassword : !codeSent || deleteCode.length < 6)}
                      className="flex-1 py-2 bg-nier-red/80 text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-red transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deleteLoading ? t('profile.deleting') : t('profile.deletePermanently')}
                    </button>}
                    <button
                      onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteCode(''); setDeletePassword(''); setCodeSent(false); setResendIn(0); setDeleteError('') }}
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
