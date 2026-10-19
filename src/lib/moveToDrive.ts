// A cloud atrium moved into its owner's Google Drive (phase 9). Copied whole
// into this browser -- the same ids, so its threads, frames and groups hold,
// and its address and room are the same -- with its files fetched from the
// cloud into the browser's vault; kept in Drive (lib/driveSync, keepInDrive);
// and, only once Drive has all of it, the cloud original deleted.
//
// Begun again after a stop, it picks up where it was. Before Drive has it,
// the copy is made again, over the last; after, the copy in Drive is the
// atrium (opening its address opens it, App), so it's only finished: sent
// what's left, then the original let go.
//
// Who it was shared with in the cloud isn't carried: a Drive atrium's members
// are its roster's, added again from its settings. Nor is anything changed in
// the cloud original while it's being moved -- the seconds it takes.
import { cloudClient } from './supabase'
import { fetchAllLobbyTraces } from '../hooks/useTraces'

// Where the cloud keeps an atrium's files (Supabase Storage, the traces bucket).
const CLOUD_FILES = '/storage/v1/object/public/traces/'

export async function moveToDrive(lobbyId: string, me: { id: string; name: string }): Promise<void> {
  const { data: lobby, error } = await cloudClient.from('lobbies').select('*').eq('id', lobbyId).single()
  if (error) throw error
  if (lobby.owner_user_id !== me.id) throw new Error('NOT_OWNER')
  const [{ browserEngine, rememberBrowserAtrium }, sync] = await Promise.all([import('./browserAtriums'), import('./driveSync')])
  if (!sync.isDriveAtrium(lobbyId)) {
    await copyIntoBrowser(lobby, await browserEngine())
    rememberBrowserAtrium(lobbyId)
    await sync.keepInDrive(lobbyId, lobby.name, me)
  }
  // Nothing of it still to go up, rows or files: only then is the original let go.
  if (!(await sync.driveHasEverything(lobbyId, me.id))) throw new Error('MOVE_INCOMPLETE')
  const { error: removed } = await cloudClient.from('lobbies').delete().eq('id', lobbyId)
  if (removed) throw removed
}

async function copyIntoBrowser(lobby: Record<string, any>, local: typeof import('./localDb')): Promise<void> {
  const lobbyId: string = lobby.id
  const inAtrium = async (table: string): Promise<Record<string, any>[]> => {
    const { data, error } = await cloudClient.from(table).select('*').eq('lobby_id', lobbyId)
    if (error) throw error
    return data ?? []
  }
  const [traces, layers, links, locations] = await Promise.all([
    fetchAllLobbyTraces(cloudClient, lobbyId), inAtrium('layers'), inAtrium('trace_links'), inAtrium('lobby_locations'),
  ])

  // The atrium's row first -- the vault files an atrium's media in a folder
  // named after it -- as one kept in the browser is: no password, not
  // listed, its owner's.
  await local.takeAtriumRows(lobbyId, 'lobbies', [{ ...lobby, password_hash: null, is_public: false }], [])

  // Its files, from the cloud into the vault: every one, or nothing is moved
  // -- the cloud's go with the original.
  const storage = local.localClient.storage.from('traces')
  const here = new Map<string, string>()
  let failed = 0
  for (const url of new Set(traces.flatMap(row => [row.media_url, row.image_url]).filter((url): url is string => typeof url === 'string' && url.includes(CLOUD_FILES)))) {
    const inBucket = decodeURIComponent(url.split(CLOUD_FILES)[1].split(/[?#]/)[0])
    // In the atrium's own folder, wherever the cloud had it.
    const path = inBucket.startsWith(`${lobbyId}/`) ? inBucket : `${lobbyId}/${inBucket}`
    // Straight from the cloud's own storage -- not through the image proxy,
    // whose answer for a file that isn't there needn't be a refusal.
    const response = await fetch(url).catch(() => null)
    const blob = response?.ok ? await response.blob() : null
    const stored = blob && await storage.upload(path, blob, { contentType: blob.type || undefined })
    if (!blob || stored?.error) { failed++; continue }
    here.set(url, storage.getPublicUrl(path).data.publicUrl)
  }
  if (failed) throw Object.assign(new Error('MOVE_FILES_FAILED'), { count: failed })

  await local.takeAtriumRows(lobbyId, 'layers', layers, [])
  await local.takeAtriumRows(lobbyId, 'traces', traces.map(row => ({ ...row, media_url: here.get(row.media_url) ?? row.media_url, image_url: here.get(row.image_url) ?? row.image_url })), [])
  await local.takeAtriumRows(lobbyId, 'trace_links', links, [])
  await local.takeAtriumRows(lobbyId, 'lobby_locations', locations, [])
}
