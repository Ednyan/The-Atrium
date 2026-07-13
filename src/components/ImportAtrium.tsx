import { useState, useRef } from 'react'
import { supabase, isDesktop } from '../lib/supabase'

interface ImportAtriumProps {
  onClose: () => void
  onImported: () => void
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

interface AtriumExport {
  version: number
  exportedAt: string
  app: string
  lobby: {
    name: string
    theme_settings: any
    is_public: boolean | number
    max_players: number
  }
  layers: Array<{
    name: string
    z_index: number
    is_group: boolean | number
    parent_id: string | null
    _local_id: string
  }>
  traces: Array<Record<string, any>>
}

export default function ImportAtrium({ onClose, onImported }: ImportAtriumProps) {
  const [status, setStatus] = useState<'select' | 'preview' | 'importing' | 'done' | 'error'>('select')
  const [parsed, setParsed] = useState<AtriumExport | null>(null)
  const [atriumName, setAtriumName] = useState('')
  const [fileSizeMB, setFileSizeMB] = useState('')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError('')

    if (file.size > MAX_FILE_SIZE) {
      setError(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is 10 MB.`)
      return
    }

    setFileSizeMB((file.size / (1024 * 1024)).toFixed(1))

    try {
      const text = await file.text()
      const data = JSON.parse(text) as AtriumExport

      if (!data.lobby || !data.traces || !Array.isArray(data.traces)) {
        setError('Invalid file format. Expected an atrium export file.')
        return
      }

      // Accept version 1 exports too (from older desktop builds) -- the
      // import logic below already tolerates missing/extra fields via
      // spreads and `||`/`??` fallbacks, so there's no real reason to hard-
      // reject anything except a genuinely unrecognized/future format.
      if (typeof data.version !== 'number' || data.version < 1 || data.version > 2) {
        setError('Unsupported export version. Please use a newer desktop app to export.')
        return
      }

      setParsed(data)
      setAtriumName(data.lobby.name)
      setStatus('preview')
    } catch {
      setError('Failed to parse file. Make sure it is a valid .json atrium export.')
    }
  }

  const handleImport = async () => {
    if (!parsed || !supabase) return

    if (atriumName.length < 3) {
      setError('Atrium name must be at least 3 characters')
      return
    }

    setStatus('importing')
    setError('')

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      if (!isDesktop) {
        setProgress('Checking atrium limit...')
        const { data: count } = await (supabase as any).rpc('get_user_lobby_count', {
          p_user_id: user.id
        })

        if (count != null && count >= 3) {
          setError('You already have 3 atriums. Delete one before importing.')
          setStatus('preview')
          return
        }
      }

      // Create the lobby
      setProgress('Creating atrium...')
      const { data: lobby, error: lobbyErr } = await (supabase
        .from('lobbies') as any)
        .insert({
          name: atriumName,
          owner_user_id: user.id,
          is_public: !!parsed.lobby.is_public,
          max_players: parsed.lobby.max_players || 50,
          theme_settings: parsed.lobby.theme_settings || null,
        })
        .select()
        .single()

      if (lobbyErr) throw lobbyErr

      const lobbyId = lobby.id

      // Create layers and build ID mapping
      const layerIdMap: Record<string, string> = {}
      if (parsed.layers.length > 0) {
        setProgress('Importing layers...')
        for (const layer of parsed.layers) {
          const { data: inserted, error: layerErr } = await (supabase
            .from('layers') as any)
            .insert({
              name: layer.name,
              z_index: layer.z_index,
              is_group: !!layer.is_group,
              parent_id: layer.parent_id ? layerIdMap[layer.parent_id] || null : null,
              user_id: user.id,
              lobby_id: lobbyId,
            })
            .select()
            .single()

          if (!layerErr && inserted) {
            layerIdMap[layer._local_id] = inserted.id
          }
        }
      }

      // Import traces
      setProgress('Importing traces...')
      let imported = 0
      let skipped = 0
      let failed = 0
      const total = parsed.traces.length

      for (const trace of parsed.traces) {
        // Traces referencing desktop-local vault storage (not embeds, not
        // data: URLs, not remote http(s) links) can't be resolved outside
        // the machine that made them -- skip rather than import broken.
        const needsLocalStorage = (url: any) =>
          typeof url === 'string' && url.startsWith('local://')

        if (needsLocalStorage(trace.media_url) || needsLocalStorage(trace.image_url)) {
          skipped++
          continue
        }

        // Handle base64 data URLs — upload to Supabase Storage
        let mediaUrl = trace.media_url
        if (mediaUrl && mediaUrl.startsWith('data:')) {
          try {
            const resp = await fetch(mediaUrl)
            const blob = await resp.blob()
            const ext = blob.type.split('/')[1]?.split(';')[0] || 'png'
            const fileName = `import_${user.id}_${Date.now()}_${imported}.${ext}`
            const { error: uploadErr } = await supabase.storage
              .from('traces')
              .upload(fileName, blob, { contentType: blob.type })

            if (!uploadErr) {
              const { data: { publicUrl } } = supabase.storage
                .from('traces')
                .getPublicUrl(fileName)
              mediaUrl = publicUrl
            } else {
              mediaUrl = null // Skip if upload fails
            }
          } catch {
            mediaUrl = null
          }
        }

        let imageUrl = trace.image_url
        if (imageUrl && imageUrl.startsWith('data:')) {
          try {
            const resp = await fetch(imageUrl)
            const blob = await resp.blob()
            const ext = blob.type.split('/')[1]?.split(';')[0] || 'png'
            const fileName = `import_${user.id}_${Date.now()}_img_${imported}.${ext}`
            const { error: uploadErr } = await supabase.storage
              .from('traces')
              .upload(fileName, blob, { contentType: blob.type })

            if (!uploadErr) {
              const { data: { publicUrl } } = supabase.storage
                .from('traces')
                .getPublicUrl(fileName)
              imageUrl = publicUrl
            } else {
              imageUrl = null
            }
          } catch {
            imageUrl = null
          }
        }

        // Strip local-only fields and remap IDs. `vault_media_path` /
        // `vault_image_path` come from the desktop's auto-synced vault
        // mirror file (not the manual "Export Atrium" format) and aren't
        // real trace columns -- including them makes the insert fail.
        const {
          _local_layer_id, layer_id, id: _id, created_at: _createdAt,
          vault_media_path, vault_image_path,
          ...rest
        } = trace
        const mappedLayerId = _local_layer_id ? layerIdMap[_local_layer_id] || null : null

        const traceData: Record<string, any> = {
          ...rest,
          user_id: user.id,
          lobby_id: lobbyId,
          layer_id: mappedLayerId,
          media_url: mediaUrl || null,
          image_url: imageUrl || null,
        }

        const { error: insertErr } = await (supabase.from('traces') as any).insert(traceData)
        if (insertErr) {
          failed++
        } else {
          imported++
        }
        if ((imported + failed + skipped) % 10 === 0 || imported + failed + skipped === total) {
          setProgress(`Importing traces... ${imported + failed + skipped}/${total}`)
        }
      }

      setStatus('done')
      const summary = [`${imported} traces`]
      if (skipped > 0) summary.push(`${skipped} skipped (local-only media)`)
      if (failed > 0) summary.push(`${failed} failed`)
      setProgress(`Imported "${atriumName}" — ${summary.join(', ')}, ${Object.keys(layerIdMap).length} layers`)
    } catch (e: any) {
      setError(e.message || String(e))
      setStatus('error')
    }
  }

  const traceCount = parsed?.traces.length ?? 0
  const layerCount = parsed?.layers.length ?? 0
  const mediaCount = parsed?.traces.filter(t =>
    t.media_url?.startsWith('data:') || t.image_url?.startsWith('data:')
  ).length ?? 0
  const localOnlyCount = parsed?.traces.filter(t =>
    t.media_url?.startsWith('local://') || t.image_url?.startsWith('local://')
  ).length ?? 0

  return (
    <div className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[100]">
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">Import Atrium</h3>
        </div>

        {status === 'select' && (
          <>
            <p className="text-nier-border/70 text-xs tracking-wide mb-4 leading-relaxed">
              Import an atrium exported from the desktop app. Max file size: 10 MB.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full py-3 border border-dashed border-nier-border/40 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors mb-4"
            >
              ◇ Choose .json File
            </button>
          </>
        )}

        {status === 'preview' && parsed && (
          <>
            <div className="bg-nier-black border border-nier-border/20 p-4 mb-4 space-y-2">
              <div className="text-[10px] text-nier-border/60 tracking-wider uppercase">Preview</div>
              <div className="text-nier-bg text-sm tracking-wide">{parsed.lobby.name}</div>
              <div className="flex gap-4 text-[10px] text-nier-border/50 tracking-wider">
                <span>{traceCount} traces</span>
                <span>{layerCount} layers</span>
                {mediaCount > 0 && <span>{mediaCount} media files</span>}
                <span>{fileSizeMB} MB</span>
              </div>
              <div className="text-[9px] text-nier-border/40 tracking-wider">
                Exported {new Date(parsed.exportedAt).toLocaleDateString()}
              </div>
              {localOnlyCount > 0 && (
                <div className="text-[9px] text-nier-red/70 tracking-wider">
                  {localOnlyCount} trace{localOnlyCount === 1 ? '' : 's'} reference local files on the source machine and will be skipped.
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Atrium Name</label>
              <input
                type="text"
                value={atriumName}
                onChange={(e) => setAtriumName(e.target.value)}
                placeholder="Name for the imported atrium"
                className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-2 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                maxLength={50}
              />
            </div>
          </>
        )}

        {status === 'done' && (
          <div className="text-center py-4">
            <p className="text-green-400 text-xs tracking-wider mb-2">{progress}</p>
            <p className="text-nier-border/50 text-[10px] tracking-wider">
              You can now enter the atrium from the browser.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500/40 p-3 mb-4">
            <p className="text-red-400 text-xs tracking-wide">{error}</p>
          </div>
        )}

        {progress && status === 'importing' && (
          <div className="bg-nier-black border border-nier-border/20 p-3 mb-4">
            <p className="text-nier-border text-[10px] tracking-wider uppercase">{progress}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => {
              if (status === 'done') {
                onImported()
                onClose()
              } else {
                onClose()
              }
            }}
            className="flex-1 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
            disabled={status === 'importing'}
          >
            {status === 'done' ? 'Close' : 'Cancel'}
          </button>
          {status === 'preview' && (
            <button
              onClick={handleImport}
              className="flex-1 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
            >
              ◇ Import
            </button>
          )}
          {status === 'error' && (
            <button
              onClick={() => { setStatus('select'); setError(''); setProgress(''); setParsed(null); }}
              className="flex-1 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
            >
              ◇ Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
