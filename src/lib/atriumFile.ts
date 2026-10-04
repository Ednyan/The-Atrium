// The .atrium file (its format: lib/atriumFormat): an atrium, or some of its traces, as one file that opens
// again anywhere, as Excalidraw's .excalidraw does -- with its pictures,
// sounds and videos inside it rather than pointing at where they're kept.
// The envelope is the one the atrium download and the desktop's Export Atrium
// write (atriumEnvelope, version 3), so any of them reads as any other.
//
// Import Atrium (components/ImportAtrium) makes a new atrium of one;
// importIntoAtrium adds one's traces to the atrium that's open, where the
// view is, as one step of undo.

import { supabase, isDesktop } from './supabase'
import { useGameStore, LOBBY_SIZE_LIMIT } from '../store/gameStore'
import { mapRowToTrace } from '../hooks/useTraces'
import { createGroup } from '../hooks/useLayers'
import { atriumEnvelope } from './atriumDownload'
import { traceRow } from './traceInsert'
import { carryLinks, linkRow, mapRowToLink, type TraceLink } from './traceLinks'
import { locationRow } from './locations'
import { carriedFrameId } from './frames'
import { keysBetween, keysOnTop, topLevel } from './order'
import { fileOrderKeys, type AtriumFile } from './atriumFormat'
import { firstFreeName, placeholderNames } from './traceNames'
import { queueLayerChange } from './layerQueue'
import { withLayerUndo } from './layerUndo'
import { uploadTraceFile } from './traceUpload'
import { fetchMedia } from './exportImage'
import { traceBox } from './traceGeometry'
import { isPathTrace, pathWorldBounds } from './pathBounds'
import { t } from './i18n'
import type { Layer, LobbyLocation, Trace } from '../types/database'

// Names for a file's traces saved before they had them: its text traces
// numbered Text N (returned, as their layer names), its shapes and drawings
// under a placeholder renamed in place (lib/traceNames). `taken`: text names
// the destination already has.
export function nameFileTraces(file: AtriumFile, taken: string[] = []): Map<Record<string, any>, string> {
  const textNames = new Map<Record<string, any>, string>()
  const namesTaken = [...taken, ...file.traces.filter(tr => tr.type === 'text' && tr.layer_name).map(tr => tr.layer_name)]
  for (const tr of file.traces) {
    if (tr.type !== 'text' || tr.layer_name) continue
    const name = firstFreeName(namesTaken, n => t('atrium.layers.numberedText', { n }))
    namesTaken.push(name)
    textNames.set(tr, name)
  }
  const placeheld = placeholderNames(
    file.traces.map((tr, i) => ({ id: String(i), type: tr.type, shapeType: tr.shape_type, content: tr.content, layerId: tr._local_layer_id ?? null, mediaUrl: tr.media_url, strokeData: tr.stroke_data })),
    file.layers.map(l => l.name),
    {
      shape: n => t('atrium.layers.numberedShape', { n }),
      path: n => t('atrium.layers.numberedPath', { n }),
      stroke: n => t('atrium.layers.numberedStroke', { n }),
      drawing: n => t('atrium.layers.numberedDrawing', { n }),
    },
  )
  file.traces.forEach((tr, i) => { const name = placeheld.get(String(i)); if (name) tr.content = name })
  return textNames
}

const readAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

// An .atrium file of these traces -- with the groups they're in, the
// connections between them, and the locations given -- their files inside
// it. A file that can't be read (another site's picture that won't share it)
// is left as its address.
export async function atriumFileBlob(
  scope: { traces: Trace[]; links: TraceLink[]; layers: Layer[]; locations: LobbyLocation[] },
  lobby: { name: string; themeSettings: unknown; isPublic: boolean; maxPlayers: number },
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const ids = new Set(scope.traces.map(tr => tr.id))
  const rows: Record<string, any>[] = scope.traces.map(trace => ({ ...traceRow(trace), layer_id: trace.layerId ?? null }))
  const withFiles = rows.filter(row => [row.media_url, row.image_url].some(u => typeof u === 'string' && u && !u.startsWith('data:')))
  let done = 0
  for (const row of withFiles) {
    for (const key of ['media_url', 'image_url'] as const) {
      const url = row[key]
      // Embeds are addresses, not files.
      if (typeof url !== 'string' || !url || url.startsWith('data:') || row.type === 'embed') continue
      const blob = await fetchMedia(url)
      if (blob) row[key] = await readAsDataUrl(blob)
    }
    onProgress?.(++done, withFiles.length)
  }
  const used = new Set(scope.traces.map(tr => tr.layerId).filter(Boolean))
  const layers = scope.layers.filter(l => used.has(l.id)).map(l => ({ id: l.id, name: l.name, order_key: l.orderKey ?? null, is_group: l.isGroup, parent_id: l.parentId ?? null }))
  const links = scope.links.filter(l => ids.has(l.from) && ids.has(l.to)).map(linkRow)
  const envelope = atriumEnvelope(
    isDesktop ? 'Digital Atrium Desktop' : 'Digital Atrium Web',
    { name: lobby.name, theme_settings: lobby.themeSettings ?? null, is_public: lobby.isPublic, max_players: lobby.maxPlayers },
    layers,
    scope.locations.map(locationRow),
    rows,
    links,
  )
  return new Blob([JSON.stringify(envelope)], { type: 'application/json' })
}

// The bytes a data URL holds, near enough.
const dataUrlBytes = (url: unknown) => (typeof url === 'string' && url.startsWith('data:') ? Math.floor((url.length - url.indexOf(',') - 1) * 0.75) : 0)

export class ImportTooLargeError extends Error {
  needed: number
  free: number
  constructor(needed: number, free: number) {
    super('too large')
    this.needed = needed
    this.free = free
  }
}

export interface ImportIntoResult { added: number; missing: number; failed: number }

// A file's traces added to the atrium that's open: as its own groups and
// connections, centred on `at`, on top of everything, as one step of undo
// (lib/layerUndo) -- Ctrl+Z takes the whole import back. Its pictures and
// sounds are saved here as any new file is. Its locations, theme and name
// stay with it: they're the atrium's, not the traces'. How far it's got goes
// to `onProgress`: each file saved and each trace written is one of `total`.
// Its traces are put on the canvas together, once all are written, so it
// arrives as the one action it is.
export function importIntoAtrium(file: AtriumFile, at: { x: number; y: number }, lobbyId: string, userId: string, onProgress?: (done: number, total: number) => void): Promise<ImportIntoResult> {
  // Room for it, on the web, where an atrium has a size.
  if (!isDesktop) {
    const needed = file.traces.reduce((sum, tr) => sum + dataUrlBytes(tr.media_url) + dataUrlBytes(tr.image_url), 0)
    const free = Math.max(0, LOBBY_SIZE_LIMIT - useGameStore.getState().getLobbySizeBytes())
    if (needed > free) return Promise.reject(new ImportTooLargeError(needed, free))
  }
  return queueLayerChange(() => withLayerUndo('import', async () => {
    const db = supabase
    if (!db) return { added: 0, missing: 0, failed: 0 }
    const store = useGameStore.getState()
    const { traceKeyOf, layerKeyOf } = fileOrderKeys(file)
    const textNames = nameFileTraces(file, store.traces.filter(tr => tr.type === 'text').map(tr => tr.layerName ?? ''))

    // The file's traces, as this atrium would have them.
    const now = new Date().toISOString()
    const parsed = file.traces.map(row => ({ row, trace: mapRowToTrace({ ...row, id: row.id ?? crypto.randomUUID(), lobby_id: lobbyId, user_id: userId, created_at: now }) }))
    if (parsed.length === 0) return { added: 0, missing: 0, failed: 0 }
    const uploads = parsed.reduce((n, { trace }) => n + [trace.mediaUrl, trace.imageUrl].filter(url => typeof url === 'string' && url.startsWith('data:')).length, 0)
    const total = uploads + parsed.length
    let done = 0
    onProgress?.(done, total)

    // Moved so their middle is where the view is.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { trace } of parsed) {
      const box = isPathTrace(trace) ? pathWorldBounds(trace.shapePoints, trace.shapeOutlineWidth ?? 2) : null
      if (box) {
        minX = Math.min(minX, box.minX); maxX = Math.max(maxX, box.maxX); minY = Math.min(minY, box.minY); maxY = Math.max(maxY, box.maxY)
      } else {
        const b = traceBox(trace)
        minX = Math.min(minX, b.cx - b.halfW); maxX = Math.max(maxX, b.cx + b.halfW); minY = Math.min(minY, b.cy - b.halfH); maxY = Math.max(maxY, b.cy + b.halfH)
      }
    }
    const dx = at.x - (minX + maxX) / 2, dy = at.y - (minY + maxY) / 2

    // Its groups, each a new one here, and its loose traces: on top of
    // everything, in the file's order among themselves.
    const groupsUsed = new Set(file.traces.map(tr => tr._local_layer_id).filter(Boolean))
    const groups = file.layers.filter(l => groupsUsed.has(l._local_id))
    const loose = parsed.filter(({ row }) => !row._local_layer_id || !groupsUsed.has(row._local_layer_id))
    const top: ({ group: AtriumFile['layers'][number] } | { piece: typeof parsed[number] })[] = [
      ...groups.map(group => ({ group })),
      ...loose.map(piece => ({ piece })),
    ]
    const keyOfTop = (item: typeof top[number]) => ('group' in item ? layerKeyOf.get(item.group) : traceKeyOf.get(item.piece.row)) ?? ''
    top.sort((a, b) => (keyOfTop(a) < keyOfTop(b) ? -1 : keyOfTop(a) > keyOfTop(b) ? 1 : 0))
    const topKeys = keysOnTop(topLevel(store.traces, store.layers), top.length)
    const groupIds = new Map<string, string>()
    const newKey = new Map<Record<string, any>, string>()
    for (const [i, item] of top.entries()) {
      if ('group' in item) {
        const made = await createGroup(lobbyId, item.group.name, userId, topKeys[i])
        groupIds.set(item.group._local_id, made.id)
        const inside = parsed.filter(({ row }) => row._local_layer_id === item.group._local_id)
          .sort((a, b) => ((traceKeyOf.get(a.row) ?? '') < (traceKeyOf.get(b.row) ?? '') ? -1 : 1))
        keysBetween(null, null, inside.length).forEach((key, j) => newKey.set(inside[j].row, key))
      } else {
        newKey.set(item.piece.row, topKeys[i])
      }
    }

    // New ids up front, so a frame and what it holds point at each other
    // whatever order they go in (lib/frames).
    const ids = new Map<string, string>()
    for (const { row } of parsed) if (row.id) ids.set(row.id, crypto.randomUUID())

    let missing = 0
    const rows: Record<string, any>[] = []
    for (const { row, trace } of parsed) {
      const shift = (p: any) => ({
        ...p, x: p.x + dx, y: p.y + dy,
        ...(p.cp1x !== undefined ? { cp1x: p.cp1x + dx, cp1y: p.cp1y + dy } : {}),
        ...(p.cp2x !== undefined ? { cp2x: p.cp2x + dx, cp2y: p.cp2y + dy } : {}),
      })
      const placed: Trace = {
        ...trace,
        id: (row.id && ids.get(row.id)) || crypto.randomUUID(),
        lobbyId,
        userId,
        layerId: row._local_layer_id ? groupIds.get(row._local_layer_id) ?? null : null,
        frameId: carriedFrameId(row.frame_id, ids),
        orderKey: newKey.get(row) ?? null,
        layerName: trace.type === 'text' ? (trace.layerName ?? textNames.get(row) ?? null) : trace.layerName,
        x: trace.x + dx,
        y: trace.y + dy,
        shapePoints: trace.shapePoints?.map(shift),
      }
      // Its files saved here, as a file dropped here would be; one left in
      // the vault it came from can't come with it, and is said so.
      for (const key of ['mediaUrl', 'imageUrl'] as const) {
        const url = placed[key]
        if (typeof url !== 'string' || !url) continue
        if (url.startsWith('local://')) {
          placed[key] = undefined
          missing++
        } else if (url.startsWith('data:')) {
          try {
            const blob = await (await fetch(url)).blob()
            const ext = blob.type.split('/')[1]?.split(/[;+]/)[0] || 'bin'
            placed[key] = await uploadTraceFile(new File([blob], `import.${ext}`, { type: blob.type }), lobbyId, userId)
          } catch {
            placed[key] = undefined
            missing++
          }
          onProgress?.(++done, total)
        }
      }
      rows.push(traceRow(placed))
    }

    // Written a batch at a time, then put on the canvas all at once.
    let failed = 0
    const written: Record<string, any>[] = []
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50)
      const { error } = await (db.from('traces') as any).insert(batch)
      if (error) failed += batch.length
      else written.push(...batch)
      done += batch.length
      onProgress?.(done, total)
    }
    for (const row of written) useGameStore.getState().addTrace(mapRowToTrace(row))
    const added = written.length

    // Threads, once both their traces are in.
    const linkRows = carryLinks(file.links, ids).map(l => ({ ...l, lobby_id: lobbyId }))
    if (linkRows.length > 0) {
      const { data } = await (db.from('trace_links') as any).insert(linkRows).select()
      if (Array.isArray(data)) for (const row of data) useGameStore.getState().receiveLink(mapRowToLink(row))
    }
    window.dispatchEvent(new Event('atrium:layers-changed'))
    return { added, missing, failed }
  }))
}
