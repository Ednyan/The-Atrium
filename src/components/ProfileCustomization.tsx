import { useState, useEffect } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import { useGamePick } from '../store/gameStore'
import { useTranslation } from '../lib/i18n'
import { Slider } from './ShapeStyleControls'
import { CustomizationPanel, Section, Switch } from './Customization'
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

// User Preferences, docked on the right as the Customization panel is: you
// (name and cursor colour, the account's, written on Save), then how you
// work, move around, what you see, the people in the room and animations --
// each this device's and taking effect at once, on/off ones as switches.
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
  const { t } = useTranslation()
  const { userId, username, setUsername, playerColor, setPlayerColor, showTraceIndicators, setShowTraceIndicators, showTraceTypeLabels, setShowTraceTypeLabels, hideOwnNameTag, setHideOwnNameTag, hideOtherNameTags, setHideOtherNameTags, hideOtherCursors, setHideOtherCursors, traceFadeEnabled, setTraceFadeEnabled, traceFloat, setTraceFloat, traceMomentum, setTraceMomentum, dragBounce, setDragBounce, autoOpenCustomization, setAutoOpenCustomization, confirmDelete, setConfirmDelete } = useGamePick('userId', 'username', 'setUsername', 'playerColor', 'setPlayerColor', 'showTraceIndicators', 'setShowTraceIndicators', 'showTraceTypeLabels', 'setShowTraceTypeLabels', 'hideOwnNameTag', 'setHideOwnNameTag', 'hideOtherNameTags', 'setHideOtherNameTags', 'hideOtherCursors', 'setHideOtherCursors', 'traceFadeEnabled', 'setTraceFadeEnabled', 'traceFloat', 'setTraceFloat', 'traceMomentum', 'setTraceMomentum', 'dragBounce', 'setDragBounce', 'autoOpenCustomization', 'setAutoOpenCustomization', 'confirmDelete', 'setConfirmDelete')
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

        // Never changed (no date): free to.
        if (!Number.isFinite(daysSinceChange) || daysSinceChange >= 15) {
          setCanChangeName(true)
        } else {
          setCanChangeName(false)
          setDaysUntilChange(Math.ceil(15 - daysSinceChange))
        }
      }
    }
  }

  const handleSave = async () => {
    setError('')
    setSuccess(false)
    setLoading(true)

    if (!supabase || !userId) return

    // Validate display name if attempting to change it (web only)
    const nameChanged = displayName !== username
    if (!isDesktop && nameChanged && !canChangeName) {
      setError(t('profile.canChangeIn', { days: daysUntilChange }))
      setLoading(false)
      return
    }

    if (displayName.length < 1 || displayName.length > 30) {
      setError(t('atrium.profile.nameLength'))
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
      setError(err.message || t('atrium.profile.updateFailed'))
    } finally {
      setLoading(false)
    }
  }

  // Name and colour are the account's, written on Save; everything else is
  // this device's and takes effect at once.
  const unsaved = displayName !== username || selectedColor !== playerColor
  const choice = (on: boolean) => `flex-1 py-2 border text-[10px] tracking-[0.15em] uppercase transition-colors ${
    on ? 'bg-nier-bg text-nier-black border-nier-bg' : 'border-nier-border/40 text-nier-bg/80 hover:border-nier-border/70'
  }`

  return (
    <CustomizationPanel
      subtitle={t('atrium.hud.profile')}
      onClose={onClose}
      zIndex={9999}
      actions={(
        <div className="w-full flex items-center gap-2 px-1">
          <span className={`min-w-0 flex-1 truncate text-[10px] tracking-wider ${error ? '' : 'text-nier-bg/70'}`} style={error ? { color: 'rgb(var(--c-danger))' } : undefined}>
            {error || (success ? `✓ ${t('atrium.profile.updated')}` : '')}
          </span>
          <button
            type="button"
            data-save-profile=""
            onClick={() => { void handleSave() }}
            disabled={loading || !unsaved}
            className="shrink-0 px-4 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-35 disabled:cursor-default"
          >
            {loading ? t('atrium.profile.saving') : t('atrium.profile.saveChanges')}
          </button>
        </div>
      )}
    >
      <Section id="you" title={t('atrium.profile.title')}>
        <div>
          <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
            {isDesktop ? t('atrium.profile.username') : t('atrium.profile.displayName')}
          </label>
          <input
            type="text"
            data-profile-name=""
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:outline-none focus:border-nier-border/60 transition-colors disabled:opacity-60"
            placeholder={isDesktop ? t('atrium.profile.yourUsername') : t('atrium.profile.yourDisplayName')}
            maxLength={30}
            disabled={!isDesktop && !canChangeName}
          />
          {!isDesktop && !canChangeName && (
            <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
              {t('atrium.profile.canChangeIn', { days: daysUntilChange })}
            </p>
          )}
        </div>
        <div>
          <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.profile.yourCursor')}</label>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                data-cursor-colour={color}
                aria-label={color}
                aria-pressed={selectedColor.toLowerCase() === color.toLowerCase()}
                onClick={() => setSelectedColor(color)}
                className={`h-9 border-2 transition-all ${
                  selectedColor.toLowerCase() === color.toLowerCase() ? 'border-nier-bg scale-105' : 'border-transparent hover:border-nier-border/60'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
            <label
              title={t('atrium.profile.anyOtherColour')}
              className={`relative h-9 border-2 cursor-pointer ${PRESET_COLORS.some(c => c.toLowerCase() === selectedColor.toLowerCase()) ? 'border-nier-border/30' : 'border-nier-bg'}`}
              style={{ background: PRESET_COLORS.some(c => c.toLowerCase() === selectedColor.toLowerCase()) ? 'conic-gradient(from 90deg, #ff6161, #e8c15a, #9ad4c4, #a8b6d9, #c77dff, #ff6161)' : selectedColor }}
            >
              <input
                type="color"
                value={selectedColor}
                onChange={(e) => setSelectedColor(e.target.value)}
                aria-label={t('atrium.profile.anyOtherColour')}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </label>
          </div>
          <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">{t('atrium.profile.cursorHint')}</p>
        </div>
      </Section>

      <Section id="work" title={t('atrium.profile.howYouWork')}>
        <Switch testId="auto-customize" label={t('atrium.profile.autoCustomize')} hint={t('atrium.profile.autoCustomizeHint')} on={autoOpenCustomization} onChange={setAutoOpenCustomization} />
        <Switch testId="confirm-delete" label={t('atrium.profile.confirmDelete')} hint={t('atrium.profile.confirmDeleteHint')} on={confirmDelete} onChange={setConfirmDelete} />
        <Slider
          label={t('atrium.profile.undoDepth', { count: undoDepth })}
          hint={t('atrium.profile.undoDepthHint')}
          min={1} max={MAX_UNDO_DEPTH} step={1} value={undoDepth}
          onChange={v => handleUndoDepthChange(Math.round(v))}
        />
        <div>
          <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.profile.batchShape')}</label>
          <div className="flex gap-2">
            {(['square', 'circle'] as const).map(shape => (
              <button key={shape} type="button" data-packing={shape} aria-pressed={packingShape === shape} onClick={() => handlePackingShapeChange(shape)} className={choice(packingShape === shape)}>
                {shape === 'square' ? t('atrium.profile.shapeSquare') : t('atrium.profile.shapeCircle')}
              </button>
            ))}
          </div>
          <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">{t('atrium.profile.batchShapeHint')}</p>
        </div>
      </Section>

      <Section id="moving" title={t('atrium.profile.movingAround')}>
        <Slider
          label={t('atrium.profile.zoomSpeed', { value: zoomSensitivity.toFixed(2) })}
          hint={t('atrium.profile.zoomHint')}
          min={MIN_ZOOM_SENSITIVITY} max={MAX_ZOOM_SENSITIVITY} step={0.01} value={zoomSensitivity}
          onChange={handleZoomSensitivityChange}
        />
      </Section>

      <Section id="see" title={t('atrium.profile.whatYouSee')}>
        <Switch testId="offscreen" label={t('atrium.profile.pointOffscreen')} hint={t('atrium.profile.pointOffscreenHint')} on={showTraceIndicators} onChange={setShowTraceIndicators} />
        <Switch testId="type-labels" label={t('atrium.profile.labelTraceType')} hint={t('atrium.profile.labelTraceTypeHint')} on={showTraceTypeLabels} onChange={setShowTraceTypeLabels} />
        <Switch testId="fade" label={t('atrium.profile.fadeEdge')} hint={t('atrium.profile.fadeEdgeHint')} on={traceFadeEnabled} onChange={setTraceFadeEnabled} />
      </Section>

      <Section id="people" title={t('atrium.profile.peopleInRoom')}>
        <Switch testId="my-name" label={t('atrium.profile.hideMyNameTag')} hint={t('atrium.profile.hideMyNameTagHint')} on={hideOwnNameTag} onChange={setHideOwnNameTag} />
        <Switch testId="their-names" label={t('atrium.profile.hideOtherNameTags')} hint={t('atrium.profile.hideOtherNameTagsHint')} on={hideOtherNameTags} onChange={setHideOtherNameTags} />
        <Switch testId="their-cursors" label={t('atrium.profile.hideOtherCursors')} hint={t('atrium.profile.hideOtherCursorsHint')} on={hideOtherCursors} onChange={setHideOtherCursors} />
      </Section>

      <Section id="motion" title={t('atrium.profile.animations')}>
        <Slider min={0} max={100} step={1} label={t('atrium.profile.dragBounce', { value: dragBounce })} hint={t('atrium.profile.dragBounceHint')} value={dragBounce} onChange={setDragBounce} />
        <Slider min={0} max={100} step={1} label={t('atrium.profile.floating', { value: traceFloat })} hint={t('atrium.profile.floatingHint')} value={traceFloat} onChange={setTraceFloat} />
        <Slider min={0} max={100} step={1} label={t('atrium.profile.momentum', { value: traceMomentum })} hint={t('atrium.profile.momentumHint')} value={traceMomentum} onChange={setTraceMomentum} />
      </Section>
    </CustomizationPanel>
  )
}
