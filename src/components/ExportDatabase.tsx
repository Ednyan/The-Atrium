import { useState, useEffect } from 'react'
import { localClient, resolveLocalUrl } from '../lib/localDb'

interface ExportDatabaseProps {
  onClose: () => void
}

interface LocalLobby {
  id: string
  name: string
  created_at: string
  // Already an object by the time it gets here: SQLite stores it as TEXT, but
  // localDb's convertRowFromSql parses it on the way out. Typing it as `string`
  // is what led to it being JSON.parse'd a second time below.
  theme_settings: Record<string, any> | null
  password_hash: string | null
  max_players: number
  is_public: number
}

// Tolerates either shape. Malformed JSON exports as null rather than taking
// the whole export down with it -- theme settings are cosmetic, and losing
// them is a far better outcome than losing the atrium.
function parseThemeSettings(value: unknown): Record<string, any> | null {
  if (!value) return null
  if (typeof value !== 'string') return value as Record<string, any>
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export default function ExportDatabase({ onClose }: ExportDatabaseProps) {
  const [status, setStatus] = useState<'select' | 'exporting' | 'done' | 'error'>('select')
  const [lobbies, setLobbies] = useState<LocalLobby[]>([])
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const loadLobbies = async () => {
      const { data } = await localClient.from('lobbies').select('*')
      if (data) setLobbies(data as LocalLobby[])
    }
    loadLobbies()
  }, [])

  const handleExport = async () => {
    if (!selectedLobbyId) return
    const lobby = lobbies.find(l => l.id === selectedLobbyId)
    if (!lobby) return

    setStatus('exporting')
    setError('')

    try {
      // Get traces for this lobby
      setProgress('Reading traces...')
      const { data: traces } = await localClient.from('traces').select('*').eq('lobby_id', selectedLobbyId)
      const lobbyTraces = (traces || []) as any[]

      // Collect referenced layer IDs
      const layerIds = new Set<string>()
      for (const t of lobbyTraces) {
        if (t.layer_id) layerIds.add(t.layer_id)
      }

      // Get referenced layers, scoped to this atrium
      setProgress('Reading layers...')
      const { data: lobbyLayers } = await localClient.from('layers').select('*').eq('lobby_id', selectedLobbyId)
      const layers = (lobbyLayers || []).filter((l: any) => layerIds.has(l.id))

      // Saved camera views -- see the note in lib/atriumDownload.ts. Kept in
      // step with the web export so a file from either side carries the same
      // things.
      setProgress('Reading locations...')
      const { data: locationRows } = await localClient
        .from('lobby_locations')
        .select('*')
        .eq('lobby_id', selectedLobbyId)
        .order('order_index', { ascending: true })
      const locations = (locationRows || []) as any[]

      // Embed local:// media as base64 data URLs
      setProgress('Embedding media files...')
      let embedded = 0
      for (const trace of lobbyTraces) {
        if (trace.media_url?.startsWith('local://')) {
          try {
            const dataUrl = await resolveLocalUrl(trace.media_url)
            if (dataUrl !== trace.media_url) {
              trace.media_url = dataUrl
              embedded++
              setProgress(`Embedding media files... ${embedded}`)
            }
          } catch { /* leave as-is if file missing */ }
        }
        if (trace.image_url?.startsWith('local://')) {
          try {
            const dataUrl = await resolveLocalUrl(trace.image_url)
            if (dataUrl !== trace.image_url) {
              trace.image_url = dataUrl
              embedded++
            }
          } catch { /* leave as-is if file missing */ }
        }
      }

      const exportData = {
        // See lib/atriumDownload.ts: 3 means the file carries `locations`.
        version: 3,
        exportedAt: new Date().toISOString(),
        app: 'Digital Atrium Desktop',
        lobby: {
          name: lobby.name,
          // NOT JSON.parse'd. localDb already parsed it on read, so parsing
          // again threw `"[object Object]" is not valid JSON` -- the string
          // form of the object it was handed -- and aborted every export.
          // The string branch is kept only for vaults old enough to predate
          // that conversion.
          theme_settings: parseThemeSettings(lobby.theme_settings),
          is_public: lobby.is_public,
          max_players: lobby.max_players,
        },
        layers: layers.map((l: any) => ({
          name: l.name,
          z_index: l.z_index,
          is_group: l.is_group,
          parent_id: l.parent_id,
          _local_id: l.id,
        })),
        locations: locations.map((l: any) => ({
          name: l.name,
          position_x: l.position_x,
          position_y: l.position_y,
          zoom: l.zoom,
          order_index: l.order_index,
          is_locked: l.is_locked,
        })),
        traces: lobbyTraces.map((t: any) => {
          const { id, created_at, user_id, lobby_id, ...rest } = t
          return { ...rest, _local_layer_id: t.layer_id }
        }),
      }

      const jsonString = JSON.stringify(exportData)
      const sizeMB = (new Blob([jsonString]).size / (1024 * 1024)).toFixed(1)

      // Use Tauri dialog to pick save location
      setProgress(`Saving file (${sizeMB} MB)...`)
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')

      const safeName = lobby.name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40)
      const filePath = await save({
        title: 'Export Atrium',
        defaultPath: `${safeName}.atrium.json`,
        filters: [{ name: 'Atrium Export', extensions: ['json'] }],
      })

      if (!filePath) {
        setStatus('select')
        setProgress('')
        return
      }

      await writeTextFile(filePath, jsonString)

      setStatus('done')
      setProgress(`Exported "${lobby.name}" — ${lobbyTraces.length} traces, ${layers.length} layers, ${locations.length} locations (${sizeMB} MB)`)
    } catch (e: any) {
      setError(e.message || String(e))
      setStatus('error')
    }
  }

  const selectedLobby = lobbies.find(l => l.id === selectedLobbyId)

  return (
    <div className="fixed inset-0 bg-nier-black/90 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203, 203, 203, 0.1) 2px, rgba(203, 203, 203, 0.1) 4px)',
        }}
      />

      <div className="bg-nier-blackLight border border-nier-border/40 p-8 max-w-md w-full mx-4 relative">
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-6">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">Export Atrium</h2>
        </div>

        {status === 'select' && (
          <>
            <p className="text-nier-bg/80 text-xs tracking-wide mb-4 leading-relaxed">
              Choose an atrium to export. The file can be imported on the web version.
            </p>

            {lobbies.length === 0 ? (
              <p className="text-nier-bg/70 text-xs tracking-wide mb-6">No atriums found.</p>
            ) : (
              <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
                {lobbies.map(lobby => (
                  <button
                    key={lobby.id}
                    onClick={() => setSelectedLobbyId(lobby.id)}
                    className={`w-full text-left px-4 py-3 border transition-all ${
                      selectedLobbyId === lobby.id
                        ? 'border-nier-bg/60 bg-nier-bg/10 text-nier-bg'
                        : 'border-nier-border/20 text-nier-bg/80 hover:border-nier-border/40'
                    }`}
                  >
                    <div className="text-xs tracking-wide">{lobby.name}</div>
                    <div className="text-[9px] tracking-wider text-nier-bg/70 mt-1">
                      Created {new Date(lobby.created_at).toLocaleDateString()}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mb-4">
            <p className="text-red-400 text-xs tracking-wide">{error}</p>
          </div>
        )}

        {progress && (
          <div className="bg-nier-black border border-nier-border/20 p-3 mb-4">
            <p className="text-nier-bg/80 text-[10px] tracking-wider uppercase">{progress}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
          >
            {status === 'done' ? 'Close' : 'Cancel'}
          </button>
          {status === 'select' && (
            <button
              type="button"
              onClick={handleExport}
              disabled={!selectedLobbyId}
              className="flex-1 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ◇ Export {selectedLobby ? `"${selectedLobby.name}"` : ''}
            </button>
          )}
          {status === 'error' && (
            <button
              type="button"
              onClick={() => { setStatus('select'); setError(''); setProgress(''); }}
              className="flex-1 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
            >
              ◇ Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
