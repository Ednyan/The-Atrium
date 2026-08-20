import { useState, useRef } from 'react'
import { supabase, isDesktop } from '../lib/supabase'

interface ImportAtriumProps {
  onClose: () => void
  onImported: () => void
}

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

// Enough names to go looking with, not so many that the notice becomes a wall.
const MISSING_NAMES_SHOWN = 4

// Something the user can actually find on the canvas. The file's own name is
// the most recognisable thing available -- it's what they'd see in the folder
// the file was supposed to be in -- then the caption, then the bare type.
function describeTrace(trace: Record<string, any>): string {
  for (const url of [trace.media_url, trace.image_url]) {
    if (typeof url === 'string' && url.startsWith('local://')) {
      const name = url.split('/').filter(Boolean).pop()
      if (name) return name
    }
  }

  const caption = typeof trace.content === 'string' ? trace.content.trim() : ''
  if (caption) return caption.length > 40 ? `${caption.slice(0, 40)}…` : caption

  return `${trace.type ?? 'trace'} trace`
}

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
  // Only present from version 3 onward. Older files simply have none.
  locations?: Array<{
    name: string
    position_x: number
    position_y: number
    zoom: number
    order_index: number
    is_locked?: boolean | number
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
  // Import succeeded but something was lost or refused -- distinct from
  // `error`, which means the import didn't happen.
  const [notice, setNotice] = useState('')
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
      if (typeof data.version !== 'number' || data.version < 1 || data.version > 3) {
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
      // Imported, but without their file. Counted apart from `imported` so an
      // import that lost media can't report itself as having gone fine.
      let mediaMissing = 0
      let failed = 0
      let firstFailure = ''
      let firstMissingReason = ''
      const missingNames: string[] = []
      const total = parsed.traces.length

      // Columns this database doesn't have, learned as we go (see insertTrace).
      const droppedColumns = new Set<string>()

      // Desktop and web schemas drift: the desktop vault has carried
      // traces.link_url since the Pinterest work, and any web database whose
      // add_pinterest_integration.sql migration hasn't been applied does not.
      // Every exported trace carries that key, so a single missing column
      // failed all of them and reported nothing but a count.
      //
      // Rather than hardcode a column list that would need updating on both
      // sides forever, learn from the rejection: PostgREST names the offending
      // column (PGRST204), so drop it and retry, remembering it for the rest
      // of the run. Unknown columns then cost one wasted insert in total
      // instead of failing the entire import.
      // Columns where the desktop row holds NULL but Postgres declares NOT
      // NULL -- crop_x/crop_y/crop_width/crop_height are the ones seen in
      // practice. SQLite is content with a null in a column that has a
      // DEFAULT; Postgres is not, and rejects the row outright.
      //
      // The fix is to omit the key rather than send null, which lets the
      // column's own DEFAULT apply. Deliberately not done by stripping every
      // null in the payload up front: for a nullable column, null is a real
      // value that means something (no media, no layer), and replacing it
      // with a default would quietly change the trace. Only columns the
      // database has actually complained about get this treatment.
      const nullRejectedColumns = new Set<string>()

      const UNKNOWN_COLUMN = /Could not find the '([^']+)' column/
      const NOT_NULL_VIOLATION = /null value in column "([^"]+)"/
      const insertTrace = async (payload: Record<string, any>): Promise<string | null> => {
        // Bounded: each pass either succeeds, fails for an unrelated reason,
        // or learns one new column, so it cannot spin.
        for (let attempt = 0; attempt < 24; attempt++) {
          const body = { ...payload }
          for (const col of droppedColumns) delete body[col]
          for (const col of nullRejectedColumns) {
            if (body[col] === null || body[col] === undefined) delete body[col]
          }

          const { error: insertErr } = await (supabase!.from('traces') as any).insert(body)
          if (!insertErr) return null

          const message = insertErr.message || ''

          const missing = UNKNOWN_COLUMN.exec(message)
          if (missing && !droppedColumns.has(missing[1])) {
            droppedColumns.add(missing[1])
            continue
          }

          const notNull = NOT_NULL_VIOLATION.exec(message)
          if (notNull && !nullRejectedColumns.has(notNull[1])) {
            nullRejectedColumns.add(notNull[1])
            continue
          }

          return message || 'Unknown error'
        }
        return 'Too many rejected columns'
      }

      for (const trace of parsed.traces) {
        // Traces referencing desktop-local vault storage (not embeds, not
        // data: URLs, not remote http(s) links) can't be resolved outside
        // the machine that made them -- skip rather than import broken.
        const needsLocalStorage = (url: any) =>
          typeof url === 'string' && url.startsWith('local://')

        if (needsLocalStorage(trace.media_url) || needsLocalStorage(trace.image_url)) {
          // Kept, not dropped. Restoring from the vault has always placed a
          // trace whose file is missing -- it still holds its position, size and
          // grouping, and reads as "Missing file" on the canvas. Importing threw
          // the same trace away, so which door you came through decided whether
          // your layout survived. A trace you can see and re-point is easier to
          // fix than one that silently never arrived.
          mediaMissing++
          missingNames.push(describeTrace(trace))
          if (!firstMissingReason) {
            firstMissingReason = 'their media still pointed at the source machine’s vault, so the files were never embedded in the export'
          }
        }

        // Uploads a base64 data URL to Storage and returns its public URL.
        // Returns the reason on failure instead of just null, so a trace that
        // loses its media can say why rather than arriving blank.
        const uploadDataUrl = async (
          dataUrl: string,
          suffix: string,
        ): Promise<{ url: string } | { error: string }> => {
          try {
            const resp = await fetch(dataUrl)
            const blob = await resp.blob()
            const ext = blob.type.split('/')[1]?.split(';')[0] || 'png'
            const fileName = `import_${user.id}_${Date.now()}_${suffix}_${imported}.${ext}`
            const { error: uploadErr } = await supabase!.storage
              .from('traces')
              .upload(fileName, blob, { contentType: blob.type })

            if (uploadErr) return { error: uploadErr.message || 'upload rejected' }

            const { data: { publicUrl } } = supabase!.storage
              .from('traces')
              .getPublicUrl(fileName)
            return { url: publicUrl }
          } catch (e: any) {
            return { error: e?.message || 'could not read the embedded file' }
          }
        }

        let mediaUrl = trace.media_url
        let imageUrl = trace.image_url
        let mediaError = ''

        if (mediaUrl && mediaUrl.startsWith('data:')) {
          const result = await uploadDataUrl(mediaUrl, 'media')
          if ('url' in result) mediaUrl = result.url
          else { mediaUrl = null; mediaError = result.error }
        }

        if (imageUrl && imageUrl.startsWith('data:')) {
          const result = await uploadDataUrl(imageUrl, 'img')
          if ('url' in result) imageUrl = result.url
          else { imageUrl = null; if (!mediaError) mediaError = result.error }
        }

        // A media trace whose file didn't make it is imported anyway, and said
        // out loud. The original problem here was never that the trace existed
        // -- it was that an empty frame was counted as a success, so the import
        // read as "went fine" while having quietly lost things. Counting it
        // separately and naming it fixes that without throwing away the
        // trace's position, size and grouping, which is the part that's
        // laborious to rebuild by hand.
        const MEDIA_TYPES = ['image', 'audio', 'video']
        if (MEDIA_TYPES.includes(trace.type) && !mediaUrl && !imageUrl) {
          mediaMissing++
          missingNames.push(describeTrace(trace))
          if (!firstMissingReason) {
            firstMissingReason = mediaError
              ? `their media could not be uploaded (${mediaError})`
              : 'they carried no embedded file'
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

        const failure = await insertTrace(traceData)
        if (failure) {
          failed++
          // Kept so the summary can say *why*. Silently counting failures is
          // what made this look like "traces just don't load".
          if (!firstFailure) firstFailure = failure
        } else {
          imported++
        }
        if ((imported + failed) % 10 === 0 || imported + failed === total) {
          setProgress(`Importing traces... ${imported + failed}/${total}`)
        }
      }

      // Locations last: they're independent of traces and layers, so a
      // failure here costs the saved views but not the atrium's contents.
      let locationsImported = 0
      if (parsed.locations && parsed.locations.length > 0) {
        setProgress('Importing locations...')
        const rows = parsed.locations.map((loc, index) => ({
          lobby_id: lobbyId,
          name: loc.name,
          position_x: loc.position_x,
          position_y: loc.position_y,
          zoom: loc.zoom ?? 1,
          // Renumbered from the array's own order rather than trusting
          // order_index, which can have gaps or repeats in an older file.
          order_index: index,
          user_id: user.id,
          is_locked: !!loc.is_locked,
        }))

        const { error: locErr } = await (supabase.from('lobby_locations') as any).insert(rows)
        if (locErr) {
          // is_locked only exists once add_location_lock.sql has been applied.
          // Retry without it rather than losing every location over one column.
          const { error: retryErr } = await (supabase.from('lobby_locations') as any)
            .insert(rows.map(({ is_locked: _isLocked, ...rest }) => rest))
          if (!retryErr) locationsImported = rows.length
        } else {
          locationsImported = rows.length
        }
      }

      setStatus('done')
      const summary = [`${imported} traces`]
      if (mediaMissing > 0) summary.push(`${mediaMissing} without their files`)
      if (failed > 0) summary.push(`${failed} failed`)
      if (locationsImported > 0) summary.push(`${locationsImported} locations`)
      setProgress(`Imported "${atriumName}" — ${summary.join(', ')}, ${Object.keys(layerIdMap).length} layers`)

      // Surfaced, not buried: anything dropped or skipped means data didn't
      // make the trip, and a loss the user can't see is one they can't report.
      const notices: string[] = []
      if (failed > 0 && firstFailure) {
        notices.push(`${failed} trace${failed === 1 ? '' : 's'} could not be imported: ${firstFailure}`)
      }
      if (mediaMissing > 0) {
        const shown = missingNames.slice(0, MISSING_NAMES_SHOWN)
        const rest = missingNames.length - shown.length
        notices.push(
          `${mediaMissing} trace${mediaMissing === 1 ? '' : 's'} came in without ${mediaMissing === 1 ? 'its file' : 'their files'}` +
          (firstMissingReason ? ` — ${firstMissingReason}` : '') +
          `. ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}. They kept their place on the canvas and show as "Missing file".`,
        )
      }
      if (droppedColumns.size > 0) {
        notices.push(`This database has no ${[...droppedColumns].join(', ')} column, so those values were dropped.`)
      }
      setNotice(notices.join(' '))
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
    <div className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[100]">
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
            <p className="text-nier-bg/80 text-xs tracking-wide mb-4 leading-relaxed">
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
              className="w-full py-3 border border-dashed border-nier-border/40 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors mb-4"
            >
              ◇ Choose .json File
            </button>
          </>
        )}

        {status === 'preview' && parsed && (
          <>
            <div className="bg-nier-black border border-nier-border/20 p-4 mb-4 space-y-2">
              <div className="text-[10px] text-nier-bg/75 tracking-wider uppercase">Preview</div>
              <div className="text-nier-bg text-sm tracking-wide">{parsed.lobby.name}</div>
              <div className="flex gap-4 text-[10px] text-nier-bg/70 tracking-wider">
                <span>{traceCount} traces</span>
                <span>{layerCount} layers</span>
                {(parsed.locations?.length ?? 0) > 0 && <span>{parsed.locations!.length} locations</span>}
                {mediaCount > 0 && <span>{mediaCount} media files</span>}
                <span>{fileSizeMB} MB</span>
              </div>
              <div className="text-[9px] text-nier-bg/70 tracking-wider">
                Exported {new Date(parsed.exportedAt).toLocaleDateString()}
              </div>
              {localOnlyCount > 0 && (
                <div className="text-[9px] text-nier-red/70 tracking-wider">
                  {localOnlyCount} trace{localOnlyCount === 1 ? '' : 's'} reference local files on the source machine.
                  They&apos;ll come in without those files, keeping their place on the canvas.
                </div>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-2">Atrium Name</label>
              <input
                type="text"
                value={atriumName}
                onChange={(e) => setAtriumName(e.target.value)}
                placeholder="Name for the imported atrium"
                className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                maxLength={50}
              />
            </div>
          </>
        )}

        {status === 'done' && (
          <div className="text-center py-4">
            <p className="text-green-400 text-xs tracking-wider mb-2">{progress}</p>
            {notice && (
              <p className="text-yellow-400/80 text-[10px] tracking-wider leading-relaxed mb-2 text-left">
                {notice}
              </p>
            )}
            <p className="text-nier-bg/70 text-[10px] tracking-wider">
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
            <p className="text-nier-bg/80 text-[10px] tracking-wider uppercase">{progress}</p>
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
            className="flex-1 py-2 border border-nier-border/30 text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
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
              onClick={() => { setStatus('select'); setError(''); setProgress(''); setNotice(''); setParsed(null); }}
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
