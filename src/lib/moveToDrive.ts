// A cloud atrium moved out of Supabase: into its owner's Google Drive (phase
// 9), or into the Atrium's own cloud, the hosted store (phase 10 -- by itself,
// on its owner's next visit). Copied whole into this browser -- the same ids,
// so its threads, frames and groups hold, and its address and room are the
// same -- with its files fetched from the cloud into the browser's vault; kept
// in Drive or the hosted store (lib/driveSync, keepInDrive); its people
// brought with it; and, only once all of it is there, the original deleted.
//
// Its people (bringPeople): its admins as admins (in Drive, which shares by
// Google address, as editors), whoever was whitelisted or an editor as
// editors -- or viewers, as its edit mode had it -- and its blacklist kept
// out. Their invitations join by themselves. Its password goes: the invite
// link and asking to join stand in for it. A public one is public still,
// visitors reading it.
//
// Begun again after a stop, it picks up where it was. Before the new place has
// it, the copy is made again, over the last; after, the copy there is the
// atrium (opening its address opens it, App), so it's only finished: its
// people, what's left sent, then the original let go. Nothing changed in the
// cloud original while it's being moved -- the seconds it takes -- is carried.
import { cloudClient } from './supabase'
import { fetchAllLobbyTraces } from '../hooks/useTraces'
import type { Role } from './driveFormat'

// Where the cloud keeps an atrium's files (Supabase Storage, the traces bucket).
const CLOUD_FILES = '/storage/v1/object/public/traces/'

export async function moveToDrive(lobbyId: string, me: { id: string; name: string }, hosted = false): Promise<void> {
  const { data: lobby, error } = await cloudClient.from('lobbies').select('*').eq('id', lobbyId).single()
  if (error) throw error
  if (lobby.owner_user_id !== me.id) throw new Error('NOT_OWNER')
  const [{ browserEngine, rememberBrowserAtrium }, sync] = await Promise.all([import('./browserAtriums'), import('./driveSync')])
  if (!sync.isDriveAtrium(lobbyId)) {
    await copyIntoBrowser(lobby, await browserEngine())
    await sync.keepInDrive(lobbyId, lobby.name, me, hosted)
  }
  // This browser's only once it's kept there: a copy that didn't get there is
  // no atrium of anyone's here -- made again, over itself, next time.
  rememberBrowserAtrium(lobbyId)
  // Its people, while the cloud still has its lists -- and the worker can
  // still vouch for their invitations from them.
  await bringPeople(lobby, me.id, sync.addPeople)
  if (lobby.is_public && !sync.isPublicAtrium(lobbyId)) await sync.makePublic(lobbyId, me.id)
  // Nothing of it still to go up, rows or files: only then is the original let go.
  if (!(await sync.driveHasEverything(lobbyId, me.id))) throw new Error('MOVE_INCOMPLETE')
  const { error: removed } = await cloudClient.from('lobbies').delete().eq('id', lobbyId)
  if (removed) throw removed
}

type Assignable = Exclude<Role, 'owner'>

/** Who a cloud atrium's people are, from its row and lists, and the role each
 *  had -- handed to lib/driveSync's addPeople. */
async function bringPeople(lobby: Record<string, any>, me: string, addPeople: typeof import('./driveSync').addPeople): Promise<void> {
  const { data: lists, error } = await cloudClient.from('lobby_access_lists').select('user_id, list_type').eq('lobby_id', lobby.id)
  if (error) throw error
  const rows = (lists ?? []) as { user_id: string; list_type: string }[]
  const listed = (type: string) => new Set(rows.filter(row => row.list_type === type).map(row => row.user_id))
  const admins = new Set<string>(lobby.admin_user_ids ?? [])
  const editors = listed('editor')
  const blocked = listed('blacklist')
  const roleOf = (user: string): Assignable =>
    admins.has(user) ? 'admin'
      : lobby.edit_permission_mode === 'none' || (lobby.edit_permission_mode === 'selected' && !editors.has(user)) ? 'viewer'
        : 'editor'
  const users = [...new Set([...admins, ...editors, ...listed('whitelist')])].filter(user => user !== me && !blocked.has(user))
  if (!users.length && !blocked.size) return
  // Their names as the cloud knows them: not everyone is in the directory yet.
  const { data: profiles } = users.length ? await cloudClient.from('profiles').select('id, username, display_name').in('id', users) : { data: [] }
  const nameOf = new Map(((profiles ?? []) as { id: string; username: string | null; display_name: string | null }[]).map(row => [row.id, row.display_name || row.username || '']))
  await addPeople(lobby.id, me, users.map(user => ({ user, name: nameOf.get(user) ?? '', role: roleOf(user) })), [...blocked].filter(user => user !== me))
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
