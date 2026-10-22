// A cloud atrium moved out of Supabase: into its owner's Google Drive (phase
// 9), or into the Atrium's own cloud, the hosted store (phase 10 -- by itself,
// on its owner's next visit) -- or, held for its owner by the Atrium since
// (lib/held), from there into the hosted store (restoreHeld). Either way the
// same: copied whole into this browser -- the same ids,
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

type Row = Record<string, any>
/** Who an atrium's people were: its admins, its edit mode, its lists, and
 *  their names as the cloud knew them (not everyone is in the directory yet). */
interface People { admins: string[]; editMode: string; lists: { user_id: string; list_type: string }[]; names: Record<string, string> }
/** Where an atrium is moved from: Supabase, or held for its owner. A file
 *  'gone' was gone there already, and is left as it was. */
interface Source {
  lobby: Row
  rows(): Promise<{ traces: Row[]; layers: Row[]; links: Row[]; locations: Row[] }>
  file(url: string): Promise<Blob | null | 'gone'>
  people(): Promise<People>
  release(): Promise<void>
}

export async function moveToDrive(lobbyId: string, me: { id: string; name: string }, hosted = false): Promise<void> {
  const { data: lobby, error } = await cloudClient.from('lobbies').select('*').eq('id', lobbyId).single()
  if (error) throw error
  const inAtrium = async (table: string): Promise<Row[]> => {
    const { data, error } = await cloudClient.from(table).select('*').eq('lobby_id', lobbyId)
    if (error) throw error
    return data ?? []
  }
  await place({
    lobby,
    rows: async () => {
      const [traces, layers, links, locations] = await Promise.all([
        fetchAllLobbyTraces(cloudClient, lobbyId), inAtrium('layers'), inAtrium('trace_links'), inAtrium('lobby_locations'),
      ])
      return { traces, layers, links, locations }
    },
    // Straight from the cloud's own storage -- not through the image proxy,
    // whose answer for a file that isn't there needn't be a refusal.
    file: async url => {
      const response = await fetch(url).catch(() => null)
      return response?.ok ? response.blob() : null
    },
    people: async () => {
      const { data: lists, error } = await cloudClient.from('lobby_access_lists').select('user_id, list_type').eq('lobby_id', lobbyId)
      if (error) throw error
      const users = [...new Set<string>([...(lobby.admin_user_ids ?? []), ...(lists ?? []).map((row: { user_id: string }) => row.user_id)])]
      const { data: profiles } = users.length ? await cloudClient.from('profiles').select('id, username, display_name').in('id', users) : { data: [] }
      const names = Object.fromEntries(((profiles ?? []) as { id: string; username: string | null; display_name: string | null }[]).map(row => [row.id, row.display_name || row.username || '']))
      return { admins: lobby.admin_user_ids ?? [], editMode: lobby.edit_permission_mode ?? 'all', lists: lists ?? [], names }
    },
    release: async () => {
      const { error: removed } = await cloudClient.from('lobbies').delete().eq('id', lobbyId)
      if (removed) throw removed
    },
  }, me, hosted)
}

/** One held for its owner (lib/held) made a hosted atrium, as moving it
 *  from Supabase would have: its people invited back, joining by themselves
 *  (the worker vouches from what's held), and then no longer held. */
export async function restoreHeld(lobbyId: string, me: { id: string; name: string }): Promise<void> {
  const { readHeld, heldDone } = await import('./held')
  const part = async (name: 'manifest' | 'atrium') => {
    const response = await readHeld(lobbyId, name)
    if (!response.ok) throw new Error(`HELD_${name.toUpperCase()}_${response.status}`)
    return response.json()
  }
  const manifest = await part('manifest') as People & { files: string[] }
  const { lobby, traces, layers, links, locations } = await part('atrium') as { lobby: Row; traces: Row[]; layers: Row[]; links: Row[]; locations: Row[] }
  await place({
    lobby,
    rows: async () => ({ traces, layers, links, locations }),
    file: async url => {
      const idx = manifest.files.indexOf(url)
      const response = idx < 0 ? null : await readHeld(lobbyId, idx).catch(() => null)
      return response?.ok ? response.blob() : response?.status === 404 ? 'gone' : null
    },
    people: async () => manifest,
    release: () => heldDone(lobbyId),
  }, me, true)
}

async function place(source: Source, me: { id: string; name: string }, hosted: boolean): Promise<void> {
  const { lobby } = source
  const lobbyId: string = lobby.id
  if (lobby.owner_user_id !== me.id) throw new Error('NOT_OWNER')
  const [{ browserEngine, rememberBrowserAtrium }, sync] = await Promise.all([import('./browserAtriums'), import('./driveSync')])
  if (!sync.isDriveAtrium(lobbyId)) {
    await copyIntoBrowser(source, await browserEngine())
    await sync.keepInDrive(lobbyId, lobby.name, me, hosted)
  }
  // This browser's only once it's kept there: a copy that didn't get there is
  // no atrium of anyone's here -- made again, over itself, next time.
  rememberBrowserAtrium(lobbyId)
  // Its people, while the source still has them -- and the worker can still
  // vouch for their invitations from them.
  await bringPeople(lobbyId, await source.people(), me.id, sync.addPeople)
  if (lobby.is_public && !sync.isPublicAtrium(lobbyId)) await sync.makePublic(lobbyId, me.id)
  // Nothing of it still to go up, rows or files: only then is the original let go.
  if (!(await sync.driveHasEverything(lobbyId, me.id))) throw new Error('MOVE_INCOMPLETE')
  await source.release()
}

type Assignable = Exclude<Role, 'owner'>

/** Who an atrium's people are, and the role each had -- handed to
 *  lib/driveSync's addPeople. */
async function bringPeople(lobbyId: string, people: People, me: string, addPeople: typeof import('./driveSync').addPeople): Promise<void> {
  const listed = (type: string) => new Set(people.lists.filter(row => row.list_type === type).map(row => row.user_id))
  const admins = new Set<string>(people.admins)
  const editors = listed('editor')
  const blocked = listed('blacklist')
  const roleOf = (user: string): Assignable =>
    admins.has(user) ? 'admin'
      : people.editMode === 'none' || (people.editMode === 'selected' && !editors.has(user)) ? 'viewer'
        : 'editor'
  const users = [...new Set([...admins, ...editors, ...listed('whitelist')])].filter(user => user !== me && !blocked.has(user))
  if (!users.length && !blocked.size) return
  await addPeople(lobbyId, me, users.map(user => ({ user, name: people.names[user] ?? '', role: roleOf(user) })), [...blocked].filter(user => user !== me))
}

async function copyIntoBrowser(source: Source, local: typeof import('./localDb')): Promise<void> {
  const { lobby } = source
  const lobbyId: string = lobby.id
  const { traces, layers, links, locations } = await source.rows()

  // The atrium's row first -- the vault files an atrium's media in a folder
  // named after it -- as one kept in the browser is: no password, not
  // listed, its owner's.
  await local.takeAtriumRows(lobbyId, 'lobbies', [{ ...lobby, password_hash: null, is_public: false }], [])

  // Its files, from the cloud into the vault: every one, or nothing is moved
  // -- the cloud's go with the original. One already gone there stays as it was.
  const storage = local.localClient.storage.from('traces')
  const here = new Map<string, string>()
  let failed = 0
  for (const url of new Set(traces.flatMap(row => [row.media_url, row.image_url]).filter((url): url is string => typeof url === 'string' && url.includes(CLOUD_FILES)))) {
    const inBucket = decodeURIComponent(url.split(CLOUD_FILES)[1].split(/[?#]/)[0])
    // In the atrium's own folder, wherever the cloud had it.
    const path = inBucket.startsWith(`${lobbyId}/`) ? inBucket : `${lobbyId}/${inBucket}`
    const blob = await source.file(url)
    if (blob === 'gone') continue
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
