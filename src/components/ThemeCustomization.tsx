import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Lobby } from '../types/database'

interface ThemeSettings {
  gridColor?: string
  gridOpacity?: number
  backgroundColor?: string
  particlesEnabled?: boolean
  particleColor?: string
  groundParticlesEnabled?: boolean
  groundParticleUrls?: string[]
  groundElementScale?: number
  groundElementScaleRange?: number
  groundElementDensity?: number
}

interface ThemeCustomizationProps {
  lobby: Lobby
  onClose: () => void
  onUpdate: () => void
}

export function ThemeCustomization({ lobby, onClose, onUpdate }: ThemeCustomizationProps) {
  const [settings, setSettings] = useState<ThemeSettings>({
    gridColor: '#3b82f6',
    gridOpacity: 0.2,
    backgroundColor: '#0a0a0f',
    particlesEnabled: true,
    particleColor: '#ffffff',
    groundParticlesEnabled: true,
    groundParticleUrls: [],
    groundElementScale: 0.0625,
    groundElementScaleRange: 0.025,
    groundElementDensity: 0.5
  })
  const [newGroundUrl, setNewGroundUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)

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
      setSettings({ ...settings, ...data.theme_settings })
    }
  }

  const saveThemeSettings = async () => {
    if (!supabase) return
    setIsSaving(true)

    const { error } = await ((supabase
      .from('lobbies') as any)
      .update({ theme_settings: settings })
      .eq('id', lobby.id))

    setIsSaving(false)

    if (error) {
      console.error('Failed to save theme settings:', error)
      alert('Failed to save theme settings')
    } else {
      alert('Theme settings saved!')
      onUpdate()
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-lobby-darker border-2 border-lobby-accent rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-lobby-darker border-b border-lobby-accent/30 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">🎨 Customize Theme</h2>
          <button
            onClick={onClose}
            className="text-lobby-light/60 hover:text-white transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Grid Settings */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-lobby-accent">Grid Settings</h3>
            
            <div className="space-y-2">
              <label className="block text-sm text-lobby-light">Grid Color</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={settings.gridColor || '#3b82f6'}
                  onChange={(e) => setSettings({ ...settings, gridColor: e.target.value })}
                  className="w-16 h-10 rounded border-2 border-lobby-accent/30 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.gridColor || '#3b82f6'}
                  onChange={(e) => setSettings({ ...settings, gridColor: e.target.value })}
                  className="flex-1 bg-lobby-muted text-white px-3 py-2 rounded border-2 border-lobby-accent/30 font-mono text-sm"
                  placeholder="#3b82f6"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm text-lobby-light">
                Grid Opacity: {((settings.gridOpacity || 0.2) * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.gridOpacity || 0.2}
                onChange={(e) => setSettings({ ...settings, gridOpacity: parseFloat(e.target.value) })}
                className="w-full"
              />
            </div>
          </div>

          {/* Background Color */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-lobby-accent">Background</h3>
            
            <div className="space-y-2">
              <label className="block text-sm text-lobby-light">Background Color</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={settings.backgroundColor || '#0a0a0f'}
                  onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                  className="w-16 h-10 rounded border-2 border-lobby-accent/30 cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.backgroundColor || '#0a0a0f'}
                  onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                  className="flex-1 bg-lobby-muted text-white px-3 py-2 rounded border-2 border-lobby-accent/30 font-mono text-sm"
                  placeholder="#0a0a0f"
                />
              </div>
            </div>
          </div>

          {/* Floating Particles */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-lobby-accent">Floating Particles</h3>
            
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="particlesEnabled"
                checked={settings.particlesEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, particlesEnabled: e.target.checked })}
                className="w-5 h-5 rounded border-2 border-lobby-accent/30"
              />
              <label htmlFor="particlesEnabled" className="text-sm text-lobby-light cursor-pointer">
                Enable floating particles
              </label>
            </div>

            {settings.particlesEnabled && (
              <div className="space-y-2">
                <label className="block text-sm text-lobby-light">Particle Color</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={settings.particleColor || '#ffffff'}
                    onChange={(e) => setSettings({ ...settings, particleColor: e.target.value })}
                    className="w-16 h-10 rounded border-2 border-lobby-accent/30 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={settings.particleColor || '#ffffff'}
                    onChange={(e) => setSettings({ ...settings, particleColor: e.target.value })}
                    className="flex-1 bg-lobby-muted text-white px-3 py-2 rounded border-2 border-lobby-accent/30 font-mono text-sm"
                    placeholder="#ffffff"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Ground Particles */}
          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-lobby-accent">Ground Elements</h3>
            
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="groundParticlesEnabled"
                checked={settings.groundParticlesEnabled ?? true}
                onChange={(e) => setSettings({ ...settings, groundParticlesEnabled: e.target.checked })}
                className="w-5 h-5 rounded border-2 border-lobby-accent/30"
              />
              <label htmlFor="groundParticlesEnabled" className="text-sm text-lobby-light cursor-pointer">
                Enable ground elements
              </label>
            </div>

            {settings.groundParticlesEnabled && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="block text-sm text-lobby-light">
                    Ground Element URLs (images that will appear on the ground)
                  </label>
                  <div className="bg-blue-900/20 border border-blue-600/30 rounded p-2 mb-2">
                    <p className="text-blue-200 text-xs">
                      ✨ <strong>Image Proxy:</strong> Most image URLs now work, including Pinterest, Google Images, and Reddit!
                    </p>
                    <p className="text-blue-200/80 text-xs mt-1">
                      🚀 The system automatically retries failed images through a proxy to bypass CORS restrictions.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newGroundUrl}
                      onChange={(e) => setNewGroundUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addGroundUrl()}
                      className="flex-1 bg-lobby-muted text-white px-3 py-2 rounded border-2 border-lobby-accent/30 text-sm"
                      placeholder="https://i.imgur.com/example.png or /themes/ground/rock.png"
                    />
                    <button
                      onClick={addGroundUrl}
                      className="bg-lobby-accent hover:bg-lobby-accent/80 text-lobby-dark px-4 py-2 rounded font-semibold transition-all text-sm"
                    >
                      Add
                    </button>
                  </div>
                </div>

                {(settings.groundParticleUrls && settings.groundParticleUrls.length > 0) && (
                  <div className="space-y-2">
                    <p className="text-xs text-lobby-light/60">
                      {settings.groundParticleUrls.length} element{settings.groundParticleUrls.length !== 1 ? 's' : ''} configured
                    </p>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {settings.groundParticleUrls.map((url, index) => (
                        <div key={index} className="flex items-center gap-2 bg-lobby-muted/50 px-3 py-2 rounded">
                          <span className="flex-1 text-sm text-lobby-light/80 truncate font-mono">
                            {url}
                          </span>
                          <button
                            onClick={() => removeGroundUrl(index)}
                            className="text-red-400 hover:text-red-300 transition-colors text-sm font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-lobby-light/50">
                  💡 <strong>Recommended sources:</strong> Upload images to <a href="https://imgur.com" target="_blank" rel="noopener noreferrer" className="text-lobby-accent hover:underline">imgur.com</a> for free hosting, or use local files in /public/themes/ground/
                </p>
                <p className="text-xs text-lobby-light/50 mt-1">
                  🖼️ <strong>Best formats:</strong> PNG with transparency works best. JPG also supported.
                </p>

                {/* Scale Controls */}
                <div className="space-y-3 mt-4 pt-4 border-t border-lobby-accent/20">
                  <h4 className="text-sm font-semibold text-lobby-light">Appearance Settings</h4>
                  
                  <div className="space-y-2">
                    <label className="block text-sm text-lobby-light">
                      Base Scale: {(settings.groundElementScale || 0.0625).toFixed(4)} ({Math.round((settings.groundElementScale || 0.0625) * 100)}%)
                    </label>
                    <input
                      type="range"
                      min="0.01"
                      max="0.3"
                      step="0.005"
                      value={settings.groundElementScale || 0.0625}
                      onChange={(e) => setSettings({ ...settings, groundElementScale: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                    <p className="text-xs text-lobby-light/50">Controls the average size of ground elements</p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm text-lobby-light">
                      Scale Variation: +{(settings.groundElementScaleRange || 0.025).toFixed(4)} ({Math.round((settings.groundElementScaleRange || 0.025) * 100)}%)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="0.1"
                      step="0.005"
                      value={settings.groundElementScaleRange || 0.025}
                      onChange={(e) => setSettings({ ...settings, groundElementScaleRange: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                    <p className="text-xs text-lobby-light/50">Random size variation added to base scale (0 = all same size)</p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm text-lobby-light">
                      Density: {(settings.groundElementDensity || 0.5).toFixed(2)}
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="3.0"
                      step="0.1"
                      value={settings.groundElementDensity || 0.5}
                      onChange={(e) => setSettings({ ...settings, groundElementDensity: parseFloat(e.target.value) })}
                      className="w-full"
                    />
                    <p className="text-xs text-lobby-light/50">How many ground elements appear (0.1 = sparse, 3.0 = dense)</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-lobby-darker border-t border-lobby-accent/30 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-lobby-light hover:bg-lobby-muted/50 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={saveThemeSettings}
            disabled={isSaving}
            className="bg-lobby-accent hover:bg-lobby-accent/80 text-lobby-dark px-6 py-2 rounded font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save Theme'}
          </button>
        </div>
      </div>
    </div>
  )
}
