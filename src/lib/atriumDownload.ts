import { supabase } from './supabase'
import { fetchAllLobbyTraces } from '../hooks/useTraces'
import { drawRanks, inOrder } from './order'

// Produces the same version-2 export envelope ExportDatabase writes on
// desktop, so a web download drops straight into the desktop app's existing
// Import Atrium flow with no format negotiation between the two.
//
// Media deliberately keeps its https:// Supabase Storage URLs rather than
// being inlined as base64 like the desktop export does. Desktop inlines
// because its local:// paths mean nothing on another machine; web URLs are
// already publicly reachable, and inlining them would balloon a normal
// atrium past the importer's 10MB ceiling. The trade-off: an imported atrium
// still pulls its images from the network rather than the vault.

// The export file, for the web download below and the desktop's Export
// Atrium alike, so a file from either imports into the other.
//
// Version 3: files carry `locations` (bumped from 2; the importer accepts 1
// and 2 and simply finds none, so only a v3 file in an old build is refused,
// which is the direction that matters). `links` came later and is optional:
// threads between traces, named by the traces' ids, which the traces keep
// here for that. Every importer gives traces new ids -- older builds drop the
// id, and the threads with it.
export function atriumEnvelope(
  app: string,
  lobby: { name: string; theme_settings: any; is_public: boolean | number; max_players: number },
  layers: any[],
  locations: any[],
  traces: any[],
  links: any[],
) {
  // Order travels as keys. For versions from before them, which order by
  // number, each group's and each trace's place is also given as z_index,
  // counted from the bottom.
  const layerRank = new Map(inOrder(layers.map((l: any) => ({ id: l.id, orderKey: l.order_key ?? null })))
    .map((l, i) => [l.id, i + 1]))
  const traceRank = drawRanks(
    traces.map((t: any) => ({ id: t.id, layerId: t.layer_id ?? null, orderKey: t.order_key ?? null })),
    layers.map((l: any) => ({ id: l.id, orderKey: l.order_key ?? null })),
  )
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    app,
    lobby,
    layers: layers.map((l: any) => ({
      name: l.name,
      order_key: l.order_key ?? null,
      z_index: layerRank.get(l.id) ?? 0,
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
    traces: traces.map((t: any) => {
      // Ownership is the importer's to reassign, to its own atrium and user.
      const { created_at, user_id, lobby_id, ...rest } = t
      return { ...rest, z_index: traceRank.get(t.id) ?? 0, _local_layer_id: t.layer_id }
    }),
    links: links.map((l: any) => ({
      from_trace: l.from_trace,
      to_trace: l.to_trace,
      arrow: l.arrow,
      color: l.color,
      width: l.width,
      label: l.label,
      label_on_hover: l.label_on_hover,
      straight: l.straight,
      to_center: l.to_center,
    })),
  }
}

export interface AtriumDownloadResult {
  traceCount: number
  layerCount: number
  locationCount: number
  sizeMB: string
}

export async function downloadAtrium(
  lobbyId: string,
  onProgress?: (message: string) => void,
): Promise<AtriumDownloadResult> {
  if (!supabase) throw new Error('Not connected')

  onProgress?.('Reading atrium...')
  const { data: lobby, error: lobbyError } = await (supabase
    .from('lobbies') as any)
    .select('name, theme_settings, is_public, max_players')
    .eq('id', lobbyId)
    .single()

  if (lobbyError || !lobby) throw new Error('Could not read this atrium')

  onProgress?.('Reading traces...')
  // Paged, not a capped select -- a large atrium would otherwise export only
  // its newest slice and silently lose the rest.
  const traces = await fetchAllLobbyTraces(supabase, lobbyId)

  onProgress?.('Reading layers...')
  const { data: layerRows } = await (supabase
    .from('layers') as any)
    .select('*')
    .eq('lobby_id', lobbyId)

  // Only layers something actually references, matching the desktop export.
  const referenced = new Set<string>()
  for (const t of traces) if (t.layer_id) referenced.add(t.layer_id)
  const layers = (layerRows || []).filter((l: any) => referenced.has(l.id))

  // Saved camera views. Part of how an atrium is meant to be read -- a
  // presentation order, the framing someone composed -- so exporting without
  // them loses authored work, not just a convenience.
  onProgress?.('Reading locations...')
  const { data: locationRows } = await (supabase
    .from('lobby_locations') as any)
    .select('*')
    .eq('lobby_id', lobbyId)
    .order('order_index', { ascending: true })

  const { data: linkRows } = await (supabase
    .from('trace_links') as any)
    .select('*')
    .eq('lobby_id', lobbyId)

  const exportData = atriumEnvelope(
    'Digital Atrium Web',
    {
      name: lobby.name,
      // Already JSON on the web side; desktop stores it as a string and
      // parses on the way out.
      theme_settings: lobby.theme_settings ?? null,
      is_public: lobby.is_public,
      max_players: lobby.max_players,
    },
    layers,
    locationRows || [],
    traces,
    linkRows || [],
  )

  const jsonString = JSON.stringify(exportData)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const sizeMB = (blob.size / (1024 * 1024)).toFixed(1)

  onProgress?.(`Saving file (${sizeMB} MB)...`)
  const safeName = String(lobby.name).replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40) || 'atrium'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName}.atrium.json`
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Revoked on a delay: revoking synchronously can cancel the download in
  // some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10000)

  return {
    traceCount: traces.length,
    layerCount: layers.length,
    locationCount: (locationRows || []).length,
    sizeMB,
  }
}
