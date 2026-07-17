import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Lobby } from '../types/database'

interface ThemeSettings {
  gridColor?: string
  gridOpacity?: number
  gridEnabled?: boolean
  backgroundColor?: string
  particlesEnabled?: boolean
  particleColor?: string
  particleOpacity?: number
  particleDensity?: number
  groundParticlesEnabled?: boolean
  groundParticleUrls?: string[]
  groundElementScale?: number
  groundElementScaleRange?: number
  groundElementDensity?: number
  groundParticleOpacity?: number
  groundPatternMode?: 'grid' | 'random'
  gridSpacing?: number
}

interface ThemeCustomizationProps {
  lobby: Lobby
  onClose: () => void
  onUpdate: () => void
}

const THEME_PRESETS: Array<{ name: string; description: string; values: ThemeSettings }> = [
  {
    name: 'Soft Sepia',
    description: 'Warm and calm NieR-like ambience',
    values: {
      gridColor: '#9c9681',
      gridOpacity: 0.24,
      backgroundColor: '#1a1a18',
      particlesEnabled: true,
      particleColor: '#dad4bb',
      particleOpacity: 0.45,
      particleDensity: 0.8,
      groundParticlesEnabled: false,
      groundParticleOpacity: 0.82,
      groundPatternMode: 'grid',
      gridSpacing: 125,
      groundElementScale: 0.06,
      groundElementScaleRange: 0.02,
      groundElementDensity: 0.55,
    },
  },
  {
    name: 'Technical',
    description: 'Cold scanning-room look',
    values: {
      gridColor: '#6f8a7d',
      gridOpacity: 0.3,
      backgroundColor: '#0f1311',
      particlesEnabled: true,
      particleColor: '#b9d6c9',
      particleOpacity: 0.55,
      particleDensity: 1.2,
      groundParticlesEnabled: false,
      groundParticleOpacity: 0.9,
      groundPatternMode: 'grid',
      gridSpacing: 90,
      groundElementScale: 0.055,
      groundElementScaleRange: 0.03,
      groundElementDensity: 0.8,
    },
  },
  {
    name: 'Archive',
    description: 'Dusty monochrome memory vault',
    values: {
      gridColor: '#7a7568',
      gridOpacity: 0.16,
      backgroundColor: '#151412',
      particlesEnabled: true,
      particleColor: '#cbc7ba',
      particleOpacity: 0.35,
      particleDensity: 0.5,
      groundParticlesEnabled: false,
      groundParticleOpacity: 0.68,
      groundPatternMode: 'random',
      groundElementScale: 0.07,
      groundElementScaleRange: 0.05,
      groundElementDensity: 0.45,
    },
  },
]

export function ThemeCustomization({ lobby, onClose, onUpdate }: ThemeCustomizationProps) {
  const [settings, setSettings] = useState<ThemeSettings>({
    gridColor: '#3b82f6',
    gridOpacity: 0.2,
    gridEnabled: true,
    backgroundColor: '#0a0a0f',
    particlesEnabled: true,
    particleColor: '#ffffff',
    particleOpacity: 0.6,
    particleDensity: 1.0,
    groundParticlesEnabled: true,
    groundParticleUrls: [],
    groundElementScale: 0.0625,
    groundElementScaleRange: 0.025,
    groundElementDensity: 0.5,
    groundParticleOpacity: 1.0,
    groundPatternMode: 'grid'
  })
  const [newGroundUrl, setNewGroundUrl] = useState('')
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
        setSaveError(error.message || 'Failed to save')
        return
      }

      if (!data) {
        setSaveError('Save failed — lobby not found or access denied')
        return
      }

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      onUpdate()
    } catch (err: any) {
      setIsSaving(false)
      console.error('Error saving theme settings:', err)
      setSaveError(err.message || 'Unexpected error saving theme')
    }
  }

  const addGroundUrl = () => {
    if (!newGroundUrl.trim()) return
    
    setSettings({
      ...settings,
      groundParticleUrls: [...(settings.groundParticleUrls || []), newGroundUrl.trim()]
    })
    setNewGroundUrl('')
  }

  const removeGroundUrl = (index: number) => {
    const updated = [...(settings.groundParticleUrls || [])]
    updated.splice(index, 1)
    setSettings({
      ...settings,
      groundParticleUrls: updated
    })
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
      className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] p-4"
      style={{ touchAction: 'auto', overscrollBehavior: 'contain' }}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
        {/* Corner brackets live on this outer, non-scrolling wrapper (capped
            at max-h-[90vh]) so they stay pinned to the modal's actual
            visible edges; content scrolls in the inner div below. They used
            to sit inside the same overflow-y-auto element as the content, so
            once enough theme options were added to make it scroll, bottom-0
            anchored to the bottom of the full scrollable content instead of
            the visible box. */}
        <div className="bg-nier-blackLight border border-nier-border/40 max-w-2xl w-full max-h-[90vh] relative flex flex-col">
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
            <h2 className="text-lg text-white tracking-[0.15em] uppercase">Customize Theme</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-border hover:text-nier-bg hover:border-nier-border/60 transition-colors"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Theme Presets */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Theme Presets</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {THEME_PRESETS.map((preset) => {
                const active = isPresetActive(preset.values)
                return (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyThemePreset(preset.values)}
                    className={`text-left border px-3 py-2 transition-colors ${
                      active
                        ? 'border-nier-bg bg-nier-bg/15 text-nier-bg'
                        : 'border-nier-border/30 bg-nier-black text-nier-border hover:border-nier-border/60 hover:text-nier-bg'
                    }`}
                  >
                    <div className="text-[10px] tracking-[0.13em] uppercase">{preset.name}</div>
                    <div className="text-[9px] tracking-wide opacity-75 mt-1">{preset.description}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Grid Settings */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Grid Settings</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>

            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                (settings.gridEnabled ?? true) ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {(settings.gridEnabled ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
              </div>
              <input
                type="checkbox"
                id="gridEnabled"
                checked={settings.gridEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, gridEnabled: e.target.checked })}
                className="hidden"
              />
              <span className="text-nier-border text-[10px] tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">
                Show grid
              </span>
            </label>

            <div className="space-y-2">
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">Grid Color</label>
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
                  className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide font-mono placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                  placeholder="#3b82f6"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                Grid Opacity: {((settings.gridOpacity ?? 0.2) * 100).toFixed(0)}%
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
          </div>

          {/* Background Color */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Background</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            
            <div className="space-y-2">
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">Background Color</label>
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
                  className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide font-mono placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                  placeholder="#0a0a0f"
                />
              </div>
            </div>
          </div>

          {/* Floating Particles */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Floating Particles</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                (settings.particlesEnabled ?? true) ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {(settings.particlesEnabled ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
              </div>
              <input
                type="checkbox"
                id="particlesEnabled"
                checked={settings.particlesEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, particlesEnabled: e.target.checked })}
                className="hidden"
              />
              <span className="text-nier-border text-[10px] tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">
                Enable floating particles
              </span>
            </label>

            {settings.particlesEnabled && (
              <div className="space-y-3 ml-1">
                <div className="space-y-2">
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">Particle Color</label>
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
                      className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide font-mono placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                      placeholder="#ffffff"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                    Particle Opacity: {((settings.particleOpacity ?? 0.6) * 100).toFixed(0)}%
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
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                    Particle Density: {(settings.particleDensity ?? 1.0).toFixed(1)}x
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
                  <p className="text-[10px] text-nier-border/50 tracking-wider">Number of floating particles (0.1 = very few, 3.0 = many)</p>
                </div>
              </div>
            )}
          </div>

          {/* Ground Particles */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Ground Elements</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
            </div>
            
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                (settings.groundParticlesEnabled ?? true) ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
              }`}>
                {(settings.groundParticlesEnabled ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
              </div>
              <input
                type="checkbox"
                id="groundParticlesEnabled"
                checked={settings.groundParticlesEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, groundParticlesEnabled: e.target.checked })}
                className="hidden"
              />
              <span className="text-nier-border text-[10px] tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">
                Enable ground elements
              </span>
            </label>

            {settings.groundParticlesEnabled && (
              <div className="space-y-3 ml-1">
                <div className="space-y-2">
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                    Ground Element URLs
                  </label>
                  <div className="border border-nier-border/20 bg-nier-black/50 p-2 mb-2">
                    <p className="text-nier-border/60 text-[10px] tracking-wider">
                      ◇ Most image URLs work, including Pinterest, Google Images, and Reddit.
                    </p>
                    <p className="text-nier-border/40 text-[10px] tracking-wider mt-1">
                      ◦ Failed images are automatically retried through a proxy.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newGroundUrl}
                      onChange={(e) => setNewGroundUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addGroundUrl()}
                      className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                      placeholder="https://i.imgur.com/example.png"
                    />
                    <button
                      onClick={addGroundUrl}
                      className="px-4 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {(settings.groundParticleUrls && settings.groundParticleUrls.length > 0) && (
                  <div className="space-y-2">
                    <p className="text-[10px] text-nier-border/50 tracking-wider uppercase">
                      {settings.groundParticleUrls.length} element{settings.groundParticleUrls.length !== 1 ? 's' : ''} configured
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {settings.groundParticleUrls.map((url, index) => (
                        <div key={index} className="flex items-center gap-2 bg-nier-black border border-nier-border/20 px-3 py-2">
                          <span className="flex-1 text-sm text-nier-border/80 truncate font-mono">
                            {url}
                          </span>
                          <button
                            onClick={() => removeGroundUrl(index)}
                            className="text-nier-border/60 hover:text-nier-bg transition-colors text-sm"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-nier-border/40 tracking-wider">
                  ◇ Upload to <a href="https://imgur.com" target="_blank" rel="noopener noreferrer" className="text-nier-border/60 hover:text-nier-bg transition-colors">imgur.com</a> for free hosting, or use /public/themes/ground/
                </p>
                <p className="text-[10px] text-nier-border/40 tracking-wider">
                  ◦ PNG with transparency works best. JPG also supported.
                </p>

                {/* Scale Controls */}
                <div className="space-y-3 mt-4 pt-4 border-t border-nier-border/20">
                  <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Appearance Settings</span>
                  
                  <div className="space-y-2">
                    <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                      Opacity: {((settings.groundParticleOpacity ?? 1.0) * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={settings.groundParticleOpacity ?? 1.0}
                      onChange={(e) => setSettings({ ...settings, groundParticleOpacity: parseFloat(e.target.value) })}
                      className="w-full accent-nier-bg"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">Layout Pattern</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <div className={`w-3 h-3 border transition-colors ${
                          (settings.groundPatternMode === 'grid' || !settings.groundPatternMode) ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/40'
                        }`} />
                        <input
                          type="radio"
                          name="groundPattern"
                          checked={settings.groundPatternMode === 'grid' || !settings.groundPatternMode}
                          onChange={() => setSettings({ ...settings, groundPatternMode: 'grid' })}
                          className="hidden"
                        />
                        <span className="text-nier-border text-[10px] tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">Grid</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <div className={`w-3 h-3 border transition-colors ${
                          settings.groundPatternMode === 'random' ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/40'
                        }`} />
                        <input
                          type="radio"
                          name="groundPattern"
                          checked={settings.groundPatternMode === 'random'}
                          onChange={() => setSettings({ ...settings, groundPatternMode: 'random' })}
                          className="hidden"
                        />
                        <span className="text-nier-border text-[10px] tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">Random</span>
                      </label>
                    </div>
                    <p className="text-[10px] text-nier-border/40 tracking-wider">Grid = uniform spacing, Random = organic placement</p>
                  </div>
                  
                  {/* Grid Spacing Control (only show in grid mode) */}
                  {(settings.groundPatternMode === 'grid' || !settings.groundPatternMode) && (
                    <div className="space-y-2">
                      <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                        Grid Spacing: {settings.gridSpacing || 100}px
                      </label>
                      <input
                        type="range"
                        min="25"
                        max="300"
                        step="25"
                        value={settings.gridSpacing || 100}
                        onChange={(e) => setSettings({ ...settings, gridSpacing: parseInt(e.target.value) })}
                        className="w-full accent-nier-bg"
                      />
                      <p className="text-[10px] text-nier-border/40 tracking-wider">Distance between grid elements (smaller = denser)</p>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                      Base Scale: {(settings.groundElementScale ?? 0.0625).toFixed(4)} ({Math.round((settings.groundElementScale ?? 0.0625) * 100)}%)
                    </label>
                    <input
                      type="range"
                      min="0.01"
                      max="0.3"
                      step="0.005"
                      value={settings.groundElementScale ?? 0.0625}
                      onChange={(e) => setSettings({ ...settings, groundElementScale: parseFloat(e.target.value) })}
                      className="w-full accent-nier-bg"
                    />
                    <p className="text-[10px] text-nier-border/40 tracking-wider">Controls the average size of ground elements</p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                      Scale Variation: +{(settings.groundElementScaleRange ?? 0.025).toFixed(4)} ({Math.round((settings.groundElementScaleRange ?? 0.025) * 100)}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="0.1"
                      step="0.005"
                      value={settings.groundElementScaleRange ?? 0.025}
                      onChange={(e) => setSettings({ ...settings, groundElementScaleRange: parseFloat(e.target.value) })}
                      className="w-full accent-nier-bg"
                    />
                    <p className="text-[10px] text-nier-border/40 tracking-wider">Random size variation added to base scale (0 = all same size)</p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                      Density: {(settings.groundElementDensity ?? 0.5).toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="3.0"
                      step="0.1"
                      value={settings.groundElementDensity ?? 0.5}
                      onChange={(e) => setSettings({ ...settings, groundElementDensity: parseFloat(e.target.value) })}
                      className="w-full accent-nier-bg"
                    />
                    <p className="text-[10px] text-nier-border/40 tracking-wider">How many ground elements appear (0 = off, 3.0 = dense)</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-nier-blackLight border-t border-nier-border/20 px-6 py-4 flex justify-end gap-3 items-center z-10">
          {saveError && (
            <span className="text-nier-border/80 text-[10px] font-mono tracking-wider mr-auto border border-nier-red/40 bg-nier-red/10 px-3 py-1">
              ✕ {saveError}
            </span>
          )}
          {saveSuccess && !saveError && (
            <span className="text-nier-bg text-[10px] font-mono tracking-wider mr-auto">
              ✓ Theme saved
            </span>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={saveThemeSettings}
            disabled={isSaving}
            className="px-6 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Theme'}
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
