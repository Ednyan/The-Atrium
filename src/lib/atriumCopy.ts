// An atrium copied whole, in this device's vault: every row with a new id --
// its groups and their nesting, its frames and its threads remapped with
// them -- and its files copied into the copy's own folder, so nothing of it
// leans on the original. As a new atrium (copyAtrium: the desktop's offline
// copy of an online one, or an offline one put online as a new one), or into
// one that's there (copyInto: an online one's contents replaced by an
// offline one's, lib/driveSync replaceContents).
//
// ponytail: a deck's own pictures are named inside its file, and still point
// at the original's; copy them too if offline copies of decks get deleted
// originals.

type Row = Record<string, any>
type Local = typeof import('./localDb')
const FILE_COLUMNS = ['media_url', 'image_url'] as const

/** `fromId`'s rows, made `toId`'s: new ids throughout, its files copied. */
async function copiedRows(local: Local, fromId: string, toId: string) {
  const rows = await local.atriumRows(fromId)
  const ids = new Map<string, string>()
  for (const table of ['layers', 'traces', 'trace_links', 'lobby_locations']) for (const row of rows[table]) ids.set(row.id, crypto.randomUUID())
  const mapped = (id: unknown) => (typeof id === 'string' ? ids.get(id) ?? null : null)

  // Each file once, into the copy's folder (the vault files them by atrium).
  const storage = local.localClient.storage.from('traces')
  const { fetchMedia } = await import('./exportImage')
  const files = new Map<string, string>()
  for (const url of new Set(rows.traces.flatMap(row => FILE_COLUMNS.map(column => row[column])).filter((url): url is string => typeof url === 'string' && url.startsWith('local://')))) {
    const blob = await fetchMedia(url)
    if (!blob) continue
    const path = `${toId}/${crypto.randomUUID()}-${url.split('/').pop()}`
    const { error } = await storage.upload(path, blob, { contentType: blob.type || undefined })
    if (!error) files.set(url, storage.getPublicUrl(path).data.publicUrl)
  }

  return {
    lobby: rows.lobbies[0] as Row | undefined,
    layers: rows.layers.map(row => ({ ...row, id: mapped(row.id), parent_id: mapped(row.parent_id), lobby_id: toId })),
    traces: rows.traces.map(row => ({
      ...row, id: mapped(row.id), lobby_id: toId, layer_id: mapped(row.layer_id), frame_id: mapped(row.frame_id),
      ...Object.fromEntries(FILE_COLUMNS.map(column => [column, files.get(row[column]) ?? row[column]])),
    })),
    trace_links: rows.trace_links.map(row => ({ ...row, id: mapped(row.id), lobby_id: toId, from_trace: mapped(row.from_trace), to_trace: mapped(row.to_trace) })),
    lobby_locations: rows.lobby_locations.map(row => ({ ...row, id: mapped(row.id), lobby_id: toId })),
  }
}

async function put(local: Local, toId: string, copied: Awaited<ReturnType<typeof copiedRows>>) {
  for (const table of ['layers', 'traces', 'trace_links', 'lobby_locations'] as const) await local.takeAtriumRows(toId, table, copied[table], [])
}

/** A new atrium of `fromId`'s, called `name`, owned by `owner`: kept here
 *  alone -- private, no password, no admins. Its id. */
export async function copyAtrium(fromId: string, name: string, owner: string): Promise<string> {
  const local = await import('./localDb')
  const toId = crypto.randomUUID()
  const source = (await local.atriumRows(fromId)).lobbies[0]
  if (!source) throw new Error('no such atrium')
  // Its row first: the vault files an atrium's media in a folder named after it.
  await local.takeAtriumRows(toId, 'lobbies', [{
    ...source, id: toId, name, owner_user_id: owner, is_public: false, password_hash: null, admin_user_ids: [],
    edit_permission_mode: 'all', preview_url: null, preview_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }], [])
  await put(local, toId, await copiedRows(local, fromId, toId))
  return toId
}

/** `intoId`'s contents -- its traces, groups, threads, places, its theme --
 *  replaced by `fromId`'s, its name and who's in it as they were. */
export async function copyInto(fromId: string, intoId: string): Promise<void> {
  const local = await import('./localDb')
  const [from, into] = await Promise.all([local.atriumRows(fromId), local.atriumRows(intoId)])
  if (!from.lobbies[0] || !into.lobbies[0]) throw new Error('no such atrium')
  const copied = await copiedRows(local, fromId, intoId)
  for (const table of ['trace_links', 'traces', 'layers', 'lobby_locations'] as const) await local.takeAtriumRows(intoId, table, [], into[table].map(row => row.id))
  await local.takeAtriumRows(intoId, 'lobbies', [{ ...into.lobbies[0], theme_settings: from.lobbies[0].theme_settings ?? null }], [])
  await put(local, intoId, copied)
}
