import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Lobby, ThemeSettings } from '../types/database'
import { ATRIUM_THEMES } from '../lib/atriumThemePresets'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'

interface ThemeCustomizationProps {
  lobby: Lobby
  onClose: () => void
  onUpdate: () => void
}

const THEME_PRESETS: Array<{ nameKey: string; descKey: string; values: ThemeSettings }> =
  ATRIUM_THEMES as Array<{ nameKey: string; descKey: string; values: ThemeSettings }>

export function ThemeCustomization({ lobby, onClose, onUpdate }: ThemeCustomizationProps) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState<ThemeSettings>({
    gridColor: '#3b82f6',
    gridOpacity: 0.2,
    gridEnabled: true,
    backgroundColor: '#0a0a0f',
    particlesEnabled: true,
    particleColor: '#ffffff',
    particleOpacity: 0.6,
    particleDensity: 1.0,
  })
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    loadThemeSettings()
  }, [lobby.id])

  const loadThemeSettings = async () => {
    if (!supabase) return

    const { data, error } = await (supabase
      .from('lobbies')
      .select('theme_settings')
      .eq('id', lobby.id)
      .single() as any)

    if (!error && data?.theme_settings) {
      setSettings(prev => ({ ...prev, ...data.theme_settings }))
    }
  }

  const saveThemeSettings = async () => {
    if (!supabase) return
    setIsSaving(true)
    setSaveError(null)

    try {
      // Use .select().single() to verify the update actually persisted
      const { data, error } = await ((supabase
        .from('lobbies') as any)
        .update({ theme_settings: settings })
        .eq('id', lobby.id)
        .select('theme_settings')
        .single())

      setIsSaving(false)

      if (error) {
        console.error('Failed to save theme settings:', error)
        setSaveError(error.message || t('atrium.theme.saveFailed'))
        return
      }

      if (!data) {
        setSaveError(t('atrium.theme.saveDenied'))
        return
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      onUpdate()
    } catch (err: any) {
      setIsSaving(false)
      console.error('Error saving theme settings:', err)
      setSaveError(err.message || t('atrium.theme.saveError'))
    }
  }

  const applyThemePreset = (presetValues: ThemeSettings) => {
    setSettings(prev => ({ ...prev, ...presetValues }))
  }

  const isPresetActive = (presetValues: ThemeSettings) => {
    return (
      (presetValues.gridColor === undefined || settings.gridColor === presetValues.gridColor) &&
      (presetValues.backgroundColor === undefined || settings.backgroundColor === presetValues.backgroundColor) &&
      (presetValues.particleColor === undefined || settings.particleColor === presetValues.particleColor)
    )
  }

  return (
    <div
      data-ui-element="true"
      className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] p-4"
      style={{ touchAction: 'auto', overscrollBehavior: 'contain' }}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={onClose}
    >
        {/* Corner brackets live on this outer, non-scrolling wrapper (capped
            at max-h-[90vh]) so they stay pinned to the modal's actual
            visible edges; content scrolls in the inner div below. They used
            to sit inside the same overflow-y-auto element as the content, so
            once enough theme options were added to make it scroll, bottom-0
            anchored to the bottom of the full scrollable content instead of
            the visible box. */}
        <div className="bg-nier-blackLight border border-nier-border/40 max-w-2xl w-full max-h-[90vh] relative flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-6 h-6 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-6 h-6 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-r border-b border-nier-border/60" />

        <div className="overflow-y-auto flex-1 min-h-0" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>

        {/* Header */}
        <div className="sticky top-0 bg-nier-blackLight border-b border-nier-border/20 px-6 py-4 flex justify-between items-center z-10">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
            <h2 className="text-lg text-nier-strong tracking-[0.15em] uppercase">{t('atrium.theme.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Theme Presets */}
          <div className="space-y-3">
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">01</span>
              <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{t('atrium.theme.presets')}</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {THEME_PRESETS.map((preset) => {
                const active = isPresetActive(preset.values)
                return (
                  <button
                    key={preset.nameKey}
                    type="button"
                    onClick={() => applyThemePreset(preset.values)}
                    className={`text-left border px-3 py-2 transition-colors ${
                      active
                        ? 'border-nier-bg bg-nier-bg/15 text-nier-bg'
                        : 'border-nier-border/30 bg-nier-black text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
                    }`}
                  >
                    <div className="text-xs tracking-[0.13em] uppercase">{t(preset.nameKey as TranslationKey)}</div>
                    <div className="text-xs tracking-wide opacity-75 mt-1">{t(preset.descKey as TranslationKey)}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Grid Settings */}
          <div className="space-y-3">
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">02</span>
              <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{t('atrium.theme.theGrid')}</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                (settings.gridEnabled ?? true) ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {(settings.gridEnabled ?? true) && <span className="text-nier-bg text-xs">✓</span>}
              </div>
              <input
                type="checkbox"
                id="gridEnabled"
                checked={settings.gridEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, gridEnabled: e.target.checked })}
                className="hidden"
              />
              <span className="text-nier-strong text-xs tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">
                {t('atrium.theme.showGrid')}
              </span>
            </label>

            <div className="space-y-2">
              <label className="block text-nier-strong text-xs tracking-[0.15em] uppercase">{t('atrium.theme.colour')}</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={settings.gridColor || '#3b82f6'}
                  onChange={(e) => setSettings({ ...settings, gridColor: e.target.value })}
                  className="w-12 h-8 border border-nier-border/30 bg-nier-black cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.gridColor || '#3b82f6'}
                  onChange={(e) => setSettings({ ...settings, gridColor: e.target.value })}
                  className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide font-mono placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                  placeholder="#3b82f6"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-nier-strong text-xs tracking-[0.15em] uppercase">
                {t('atrium.theme.gridOpacity', { value: ((settings.gridOpacity ?? 0.2) * 100).toFixed(0) })}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.gridOpacity ?? 0.2}
                onChange={(e) => setSettings({ ...settings, gridOpacity: parseFloat(e.target.value) })}
                className="w-full accent-nier-bg"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-nier-strong text-xs tracking-[0.15em] uppercase">
                {t('atrium.theme.gridSize', { value: settings.gridLineSpacing ?? 50 })}
              </label>
              <input
                type="range"
                min="10"
                max="200"
                step="5"
                value={settings.gridLineSpacing ?? 50}
                onChange={(e) => setSettings({ ...settings, gridLineSpacing: parseInt(e.target.value) })}
                className="w-full accent-nier-bg"
              />
              <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case">
                {t('atrium.theme.gridSizeHint')}
              </p>
            </div>
          </div>

          {/* Colour */}
          <div className="space-y-3">
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-nier-bg/40 text-xs tracking-[0.1em] tabular-nums">03</span>
              <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{t('atrium.theme.theRoom')}</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            
            <div className="space-y-2">
              <label className="block text-nier-strong text-xs tracking-[0.15em] uppercase">{t('atrium.theme.colour')}</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={settings.backgroundColor || '#0a0a0f'}
                  onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                  className="w-12 h-8 border border-nier-border/30 bg-nier-black cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.backgroundColor || '#0a0a0f'}
                  onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                  className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide font-mono placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                  placeholder="#0a0a0f"
                />
              </div>
            </div>
          </div>

          {/* Drifting particles */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-strong text-xs tracking-[0.15em] uppercase">{t('atrium.theme.driftingParticles')}</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                (settings.particlesEnabled ?? true) ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {(settings.particlesEnabled ?? true) && <span className="text-nier-bg text-xs">✓</span>}
              </div>
              <input
                type="checkbox"
                id="particlesEnabled"
                checked={settings.particlesEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, particlesEnabled: e.target.checked })}
                className="hidden"
              />
              <span className="text-nier-strong text-xs tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">
                {t('atrium.theme.enableParticles')}
              </span>
            </label>

            {settings.particlesEnabled && (
              <div className="space-y-3 ml-1">
                <div className="space-y-2">
                  <label className="block text-nier-strong text-xs tracking-[0.15em] uppercase">{t('atrium.theme.colour')}</label>
                  <div className="flex gap-2 items-center">
                    <input
                      type="color"
                      value={settings.particleColor || '#ffffff'}
                      onChange={(e) => setSettings({ ...settings, particleColor: e.target.value })}
                      className="w-12 h-8 border border-nier-border/30 bg-nier-black cursor-pointer"
                    />
                    <input
                      type="text"
                      value={settings.particleColor || '#ffffff'}
                      onChange={(e) => setSettings({ ...settings, particleColor: e.target.value })}
                      className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide font-mono placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                      placeholder="#ffffff"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="block text-nier-strong text-xs tracking-[0.15em] uppercase">
                    {t('atrium.theme.particleOpacity', { value: ((settings.particleOpacity ?? 0.6) * 100).toFixed(0) })}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.particleOpacity ?? 0.6}
                    onChange={(e) => setSettings({ ...settings, particleOpacity: parseFloat(e.target.value) })}
                    className="w-full accent-nier-bg"
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="block text-nier-strong text-xs tracking-[0.15em] uppercase">
                    {t('atrium.theme.particleDensity', { value: (settings.particleDensity ?? 1.0).toFixed(1) })}
                  </label>
                  <input
                    type="range"
                    min="0.1"
                    max="3.0"
                    step="0.1"
                    value={settings.particleDensity ?? 1.0}
                    onChange={(e) => setSettings({ ...settings, particleDensity: parseFloat(e.target.value) })}
                    className="w-full accent-nier-bg"
                  />
                  <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide normal-case">{t('atrium.theme.particleDensityHint')}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-nier-blackLight border-t border-nier-border/20 px-6 py-4 flex justify-end gap-3 items-center z-10">
          {saveError && (
            <span className="text-nier-bg/80 text-xs font-mono tracking-wider mr-auto border border-nier-red/40 bg-nier-red/10 px-3 py-1">
              ✕ {saveError}
            </span>
          )}
          {saveSuccess && !saveError && (
            <span className="text-nier-bg text-xs font-mono tracking-wider mr-auto">
              ✓ {t('atrium.theme.saved')}
            </span>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={saveThemeSettings}
            disabled={isSaving}
            className="px-6 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? t('atrium.theme.saving') : t('atrium.theme.saveTheme')}
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
