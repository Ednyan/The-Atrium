import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { localClient } from '../lib/localDb'

interface UploadToOnlineProps {
  onClose: () => void
}

export default function UploadToOnline({ onClose }: UploadToOnlineProps) {
  const [supabaseUrl, setSupabaseUrl] = useState('')
  const [supabaseKey, setSupabaseKey] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<'credentials' | 'auth' | 'uploading' | 'done' | 'error'>('credentials')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const handleUpload = async () => {
    if (!supabaseUrl || !supabaseKey) {
      setError('Please enter your Supabase URL and anon key')
      return
    }
    if (!email || !password) {
      setError('Please enter your online account credentials')
      return
    }

    setError('')
    setStatus('auth')
    setProgress('Authenticating with online server...')

    try {
      // Create a temporary Supabase client for upload
      const remote = createClient(supabaseUrl, supabaseKey)

      // Authenticate
      const { data: authData, error: authError } = await remote.auth.signInWithPassword({ email, password })
      if (authError || !authData.user) {
        setError(`Authentication failed: ${authError?.message || 'Unknown error'}`)
        setStatus('credentials')
        return
      }

      const remoteUserId = authData.user.id
      setStatus('uploading')

      // 1. Upload lobbies
      setProgress('Uploading atriums...')
      const { data: localLobbies } = await localClient.from('lobbies').select('*')

      const lobbyIdMap: Record<string, string> = {}
      if (localLobbies?.length) {
        for (const lobby of localLobbies) {
          const { data: inserted, error: lobbyErr } = await remote
            .from('lobbies')
            .insert({
              name: lobby.name,
              owner_user_id: remoteUserId,
              password_hash: lobby.password_hash,
              max_players: lobby.max_players,
              is_public: lobby.is_public,
              theme_settings: lobby.theme_settings,
            })
            .select()
            .single()

          if (lobbyErr) {
            console.error('Lobby upload error:', lobbyErr)
            continue
          }
          if (inserted) {
            lobbyIdMap[lobby.id] = inserted.id
          }
        }
      }

      // 2. Upload layers
      setProgress('Uploading layers...')
      const { data: localLayers } = await localClient.from('layers').select('*')
      
      const layerIdMap: Record<string, string> = {}
      if (localLayers?.length) {
        for (const layer of localLayers) {
          const mappedLobbyIdForLayer = layer.lobby_id ? lobbyIdMap[layer.lobby_id] : null
          if (!mappedLobbyIdForLayer && layer.lobby_id) {
            // Skip layers whose lobby failed to upload, or that were left
            // orphaned (no lobby_id) by the cross-atrium layer leakage fix
            continue
          }

          const { data: inserted, error: layerErr } = await remote
            .from('layers')
            .insert({
              name: layer.name,
              z_index: layer.z_index,
              is_group: layer.is_group,
              parent_id: layer.parent_id ? layerIdMap[layer.parent_id] || null : null,
              user_id: remoteUserId,
              lobby_id: mappedLobbyIdForLayer,
            })
            .select()
            .single()

          if (layerErr) {
            console.error('Layer upload error:', layerErr)
            continue
          }
          if (inserted) {
            layerIdMap[layer.id] = inserted.id
          }
        }
      }

      // 3. Upload traces
      setProgress('Uploading traces...')
      const { data: localTraces } = await localClient.from('traces').select('*')

      if (localTraces?.length) {
        let uploaded = 0
        for (const trace of localTraces) {
          const mappedLobbyId = trace.lobby_id ? lobbyIdMap[trace.lobby_id] : null
          if (!mappedLobbyId && trace.lobby_id) {
            // Skip traces for lobbies that failed to upload
            continue
          }

          // Handle local:// URLs — replace with placeholder
          let mediaUrl = trace.media_url
          let imageUrl = trace.image_url
          if (mediaUrl?.startsWith('local://')) {
            mediaUrl = null // Local file — empty placeholder in online version
          }
          if (imageUrl?.startsWith('local://')) {
            imageUrl = null
          }

          const traceData: Record<string, any> = {
            user_id: remoteUserId,
            username: trace.username,
            type: trace.type,
            content: trace.content,
            position_x: trace.position_x,
            position_y: trace.position_y,
            image_url: imageUrl,
            media_url: mediaUrl,
            scale: trace.scale,
            rotation: trace.rotation,
            show_border: trace.show_border,
            show_background: trace.show_background,
            border_color: trace.border_color,
            border_opacity: trace.border_opacity,
            fill_color: trace.fill_color,
            fill_opacity: trace.fill_opacity,
            show_description: trace.show_description,
            show_filename: trace.show_filename,
            font_size: trace.font_size,
            font_family: trace.font_family,
            text_bold: trace.text_bold,
            text_italic: trace.text_italic,
            text_underline: trace.text_underline,
            text_align: trace.text_align,
            text_color: trace.text_color,
            is_locked: trace.is_locked,
            border_radius: trace.border_radius,
            crop_x: trace.crop_x,
            crop_y: trace.crop_y,
            crop_width: trace.crop_width,
            crop_height: trace.crop_height,
            illuminate: trace.illuminate,
            light_color: trace.light_color,
            light_intensity: trace.light_intensity,
            light_radius: trace.light_radius,
            light_offset_x: trace.light_offset_x,
            light_offset_y: trace.light_offset_y,
            light_pulse: trace.light_pulse,
            light_pulse_speed: trace.light_pulse_speed,
            enable_interaction: trace.enable_interaction,
            ignore_clicks: trace.ignore_clicks,
            layer_id: trace.layer_id ? layerIdMap[trace.layer_id] || null : null,
            z_index: trace.z_index,
            lobby_id: mappedLobbyId,
            shape_type: trace.shape_type,
            shape_color: trace.shape_color,
            shape_opacity: trace.shape_opacity,
            corner_radius: trace.corner_radius,
            shape_outline_only: trace.shape_outline_only,
            shape_no_fill: trace.shape_no_fill,
            shape_outline_color: trace.shape_outline_color,
            shape_outline_width: trace.shape_outline_width,
            shape_points: trace.shape_points,
            path_curve_type: trace.path_curve_type,
            path_arrow_start: trace.path_arrow_start,
            path_arrow_end: trace.path_arrow_end,
            width: trace.width,
            height: trace.height,
          }

          const { error: traceErr } = await remote.from('traces').insert(traceData)
          if (traceErr) {
            console.error('Trace upload error:', traceErr)
          }
          uploaded++
          setProgress(`Uploading traces... ${uploaded}/${localTraces.length}`)
        }
      }

      setStatus('done')
      setProgress(`Upload complete! ${Object.keys(lobbyIdMap).length} atriums, ${Object.keys(layerIdMap).length} layers, ${localTraces?.length || 0} traces uploaded.`)

    } catch (e: any) {
      setError(e.message || String(e))
      setStatus('error')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 font-mono">
      <div className="bg-nier-black border border-nier-border/30 p-8 max-w-md w-full mx-4 relative">
        {/* Corner decorations */}
        <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-white/40" />
        <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-white/40" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-white/40" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-white/40" />

        <h2 className="text-nier-bg text-sm tracking-[0.25em] uppercase mb-6 text-center">
          Upload to Online
        </h2>

        {status === 'done' ? (
          <div className="text-center">
            <p className="text-green-400 text-xs tracking-wider mb-4">{progress}</p>
            <p className="text-nier-border/60 text-[10px] tracking-wider mb-6">
              Note: Local files (images/audio stored on this PC) were not uploaded. Their frames appear as empty placeholders online.
            </p>
            <button onClick={onClose} className="px-6 py-2 bg-nier-bg text-nier-black text-[10px] tracking-wider uppercase hover:bg-nier-bgDark transition-colors">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3 mb-6">
              <div>
                <label className="text-nier-border/60 text-[9px] tracking-wider uppercase block mb-1">Supabase URL</label>
                <input
                  type="url"
                  value={supabaseUrl}
                  onChange={e => setSupabaseUrl(e.target.value)}
                  placeholder="https://xxx.supabase.co"
                  className="w-full px-3 py-2 bg-transparent border border-nier-border/30 text-nier-bg text-xs tracking-wider"
                  disabled={status !== 'credentials'}
                />
              </div>
              <div>
                <label className="text-nier-border/60 text-[9px] tracking-wider uppercase block mb-1">Anon Key</label>
                <input
                  type="password"
                  value={supabaseKey}
                  onChange={e => setSupabaseKey(e.target.value)}
                  placeholder="eyJhbGc..."
                  className="w-full px-3 py-2 bg-transparent border border-nier-border/30 text-nier-bg text-xs tracking-wider"
                  disabled={status !== 'credentials'}
                />
              </div>
              <div className="border-t border-nier-border/20 pt-3">
                <label className="text-nier-border/60 text-[9px] tracking-wider uppercase block mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-transparent border border-nier-border/30 text-nier-bg text-xs tracking-wider"
                  disabled={status !== 'credentials'}
                />
              </div>
              <div>
                <label className="text-nier-border/60 text-[9px] tracking-wider uppercase block mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-transparent border border-nier-border/30 text-nier-bg text-xs tracking-wider"
                  disabled={status !== 'credentials'}
                />
              </div>
            </div>

            {error && (
              <p className="text-red-400 text-[10px] tracking-wider mb-4">{error}</p>
            )}

            {progress && status !== 'credentials' && (
              <p className="text-nier-border/60 text-[10px] tracking-wider mb-4">{progress}</p>
            )}

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-nier-border/30 text-nier-border/60 text-[10px] tracking-wider uppercase hover:bg-nier-border/10 transition-colors"
                disabled={status === 'uploading' || status === 'auth'}
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                className="flex-1 px-4 py-2 bg-nier-bg text-nier-black text-[10px] tracking-wider uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-50"
                disabled={status === 'uploading' || status === 'auth'}
              >
                {status === 'uploading' || status === 'auth' ? 'Uploading...' : 'Upload'}
              </button>
            </div>

            <p className="text-nier-border/40 text-[8px] tracking-wider mt-4 text-center">
              Local files (images/audio on this PC) will appear as empty placeholders online.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
