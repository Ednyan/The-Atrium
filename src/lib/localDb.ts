// Local database adapter that mimics the Supabase client API
// so all existing components work without changes.
// Uses Tauri SQL plugin (SQLite) for persistence.

import Database from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { mkdir, exists } from '@tauri-apps/plugin-fs'

let db: Database | null = null
let mediaBasePath: string = ''
let legacyMediaBasePath: string = ''
let vaultBasePath: string = ''

const LOCAL_USER_ID = 'local-user'
const LOCAL_USERNAME = 'Local User'
const LIVE_RUNTIME_DIR_NAME = '_runtime'
const LIVE_MEDIA_DIR_NAME = 'media'
const VAULT_SYNC_DELAY_MS = 1000
const pendingVaultSyncs = new Map<string, number>()
const lobbyNameCache = new Map<string, string>()

interface ParsedLocalUrl {
  bucket: string
  pathSegments: string[]
}

function sanitizeVaultNameSegment(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)

  return sanitized || fallback
}

function buildVaultLobbyFolderName(lobbyName: string, lobbyId: string): string {
  return `${sanitizeVaultNameSegment(lobbyName, 'Atrium')}__${lobbyId}`
}

async function joinPathSegments(base: string, segments: string[]): Promise<string> {
  let current = base

  for (const segment of segments) {
    current = await join(current, segment)
  }

  return current
}

async function initializeVaultBasePath(): Promise<void> {
  if (!vaultBasePath) {
    vaultBasePath = await invoke<string>('get_vault_base_path')
  }
}

export async function getVaultBasePath(): Promise<string> {
  if (!vaultBasePath) {
    await initializeVaultBasePath()
  }

  return vaultBasePath
}

export async function setVaultBasePath(path: string): Promise<string> {
  const trimmedPath = path.trim()
  if (!trimmedPath) {
    throw new Error('Vault folder path cannot be empty')
  }

  vaultBasePath = await invoke<string>('set_vault_base_path', { path: trimmedPath })
  mediaBasePath = await getLiveMediaBasePath()
  resolvedUrlCache.clear()
  await syncAllLobbiesToVault()
  return vaultBasePath
}

async function vaultPathExists(path: string): Promise<boolean> {
  return invoke<boolean>('vault_path_exists', { path })
}

async function writeVaultTextFile(path: string, contents: string): Promise<void> {
  await invoke('write_vault_text_file', { path, contents })
}

async function copyFileToPath(sourcePath: string, destinationPath: string): Promise<void> {
  await invoke('copy_file_to_path', { sourcePath, destinationPath })
}

async function movePath(sourcePath: string, destinationPath: string): Promise<void> {
  await invoke('move_path', { sourcePath, destinationPath })
}

async function removePath(path: string): Promise<void> {
  await invoke('remove_path', { path })
}

async function renamePath(oldPath: string, newPath: string): Promise<void> {
  await invoke('rename_path', { oldPath, newPath })
}

async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_binary_file', { path, bytes: Array.from(bytes) })
}

async function readBinaryFile(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('read_binary_file', { path })
  return Uint8Array.from(bytes)
}

async function getLiveRuntimeDirectory(): Promise<string> {
  return join(await getVaultBasePath(), LIVE_RUNTIME_DIR_NAME)
}

async function getLiveMediaBasePath(): Promise<string> {
  return join(await getLiveRuntimeDirectory(), LIVE_MEDIA_DIR_NAME)
}

function parseLocalUrl(url: string): ParsedLocalUrl | null {
  if (!url.startsWith('local://')) return null

  const parts = url.replace('local://', '').split('/').filter(Boolean)
  if (parts.length === 0) return null

  return {
    bucket: parts[0],
    pathSegments: parts.slice(1),
  }
}

async function getLobbyNameById(lobbyId: string): Promise<string | null> {
  if (!db || !lobbyId) return null

  const cachedName = lobbyNameCache.get(lobbyId)
  if (cachedName) return cachedName

  const rows = await db.select<any[]>('SELECT name FROM lobbies WHERE id = ? LIMIT 1', [lobbyId])
  const lobbyName = typeof rows[0]?.name === 'string' ? rows[0].name : null
  if (lobbyName) {
    lobbyNameCache.set(lobbyId, lobbyName)
  }

  return lobbyName
}

async function getRuntimeMediaBucketDirectory(bucket: string): Promise<string> {
  return join(mediaBasePath, bucket)
}

async function getRuntimeLobbyMediaDirectory(bucket: string, lobbyId: string, lobbyName?: string): Promise<string> {
  const resolvedLobbyName = lobbyName ?? await getLobbyNameById(lobbyId) ?? 'Atrium'
  return join(await getRuntimeMediaBucketDirectory(bucket), buildVaultLobbyFolderName(resolvedLobbyName, lobbyId))
}

async function renameRuntimeMediaLobbyDirectory(bucket: string, lobbyId: string, previousName: string, nextName: string): Promise<void> {
  const trimmedNextName = nextName.trim()
  if (!trimmedNextName || previousName.trim() === trimmedNextName) {
    return
  }

  const oldDir = await getRuntimeLobbyMediaDirectory(bucket, lobbyId, previousName)
  const newDir = await getRuntimeLobbyMediaDirectory(bucket, lobbyId, trimmedNextName)

  if (oldDir === newDir || !(await vaultPathExists(oldDir)) || (await vaultPathExists(newDir))) {
    return
  }

  await renamePath(oldDir, newDir)
}

async function getResolvedRuntimeMediaFilePath(bucket: string, pathSegments: string[]): Promise<string | null> {
  if (pathSegments.length === 0) return null

  if (bucket === 'traces' && pathSegments.length >= 2) {
    const [lobbyId, ...relativeSegments] = pathSegments
    const lobbyName = await getLobbyNameById(lobbyId)
    if (lobbyName) {
      return joinPathSegments(
        await getRuntimeLobbyMediaDirectory(bucket, lobbyId, lobbyName),
        relativeSegments,
      )
    }
  }

  return joinPathSegments(await getRuntimeMediaBucketDirectory(bucket), pathSegments)
}

async function resolveLocalMediaFilePath(url: string): Promise<string | null> {
  const parsed = parseLocalUrl(url)
  if (!parsed) return null

  const runtimePath = await getResolvedRuntimeMediaFilePath(parsed.bucket, parsed.pathSegments)
  if (runtimePath && await vaultPathExists(runtimePath)) {
    return runtimePath
  }

  if (legacyMediaBasePath) {
    const legacyPath = await joinPathSegments(await join(legacyMediaBasePath, parsed.bucket), parsed.pathSegments)
    if (await vaultPathExists(legacyPath)) {
      return legacyPath
    }
  }

  return runtimePath
}

function buildLobbyScopedLocalUrl(bucket: string, lobbyId: string, fileName: string): string {
  return `local://${bucket}/${lobbyId}/${fileName}`
}

async function migrateTraceLocalMediaUrl(currentUrl: string, lobbyId: string): Promise<string> {
  const parsed = parseLocalUrl(currentUrl)
  if (!parsed) return currentUrl

  const fileName = parsed.pathSegments[parsed.pathSegments.length - 1]
  if (!fileName) return currentUrl

  const desiredUrl = buildLobbyScopedLocalUrl(parsed.bucket, lobbyId, fileName)
  const desiredPath = await getResolvedRuntimeMediaFilePath(parsed.bucket, [lobbyId, fileName])
  if (!desiredPath) return currentUrl

  if (await vaultPathExists(desiredPath)) {
    return desiredUrl
  }

  const sourceCandidates = new Set<string>()

  const currentResolvedPath = await resolveLocalMediaFilePath(currentUrl)
  if (currentResolvedPath) {
    sourceCandidates.add(currentResolvedPath)
  }

  if (legacyMediaBasePath) {
    const legacyPath = await joinPathSegments(await join(legacyMediaBasePath, parsed.bucket), parsed.pathSegments)
    sourceCandidates.add(legacyPath)
  }

  const rawRuntimePath = await joinPathSegments(await getRuntimeMediaBucketDirectory(parsed.bucket), parsed.pathSegments)
  sourceCandidates.add(rawRuntimePath)

  for (const sourcePath of sourceCandidates) {
    if (sourcePath === desiredPath || !(await vaultPathExists(sourcePath))) {
      continue
    }

    await movePath(sourcePath, desiredPath)
    return desiredUrl
  }

  return currentUrl
}

async function migrateLegacyLocalMediaToRuntime(): Promise<void> {
  if (!db) return

  const traceRows = await db.select<any[]>(
    `SELECT id, lobby_id, media_url, image_url FROM traces WHERE media_url LIKE 'local://%' OR image_url LIKE 'local://%'`
  )

  for (const trace of traceRows) {
    if (!trace.lobby_id) continue

    const nextMediaUrl = typeof trace.media_url === 'string'
      ? await migrateTraceLocalMediaUrl(trace.media_url, trace.lobby_id)
      : trace.media_url

    const nextImageUrl = typeof trace.image_url === 'string'
      ? await migrateTraceLocalMediaUrl(trace.image_url, trace.lobby_id)
      : trace.image_url

    const setClauses: string[] = []
    const values: any[] = []

    if (nextMediaUrl !== trace.media_url) {
      setClauses.push('media_url = ?')
      values.push(nextMediaUrl)
    }

    if (nextImageUrl !== trace.image_url) {
      setClauses.push('image_url = ?')
      values.push(nextImageUrl)
    }

    if (setClauses.length > 0) {
      values.push(trace.id)
      await db.execute(`UPDATE traces SET ${setClauses.join(', ')} WHERE id = ?`, values)
    }
  }
}

async function getVaultLobbyDirectory(lobbyId: string, lobbyName: string): Promise<string> {
  const basePath = await getVaultBasePath()
  return join(basePath, buildVaultLobbyFolderName(lobbyName, lobbyId))
}

async function getVaultMirrorMediaFilePath(localUrl: string, lobbyId: string, lobbyName?: string): Promise<string | null> {
  const parsed = parseLocalUrl(localUrl)
  if (!parsed) return null

  const resolvedLobbyName = lobbyName ?? await getLobbyNameById(lobbyId)
  if (!resolvedLobbyName) return null

  const lobbyDir = await getVaultLobbyDirectory(lobbyId, resolvedLobbyName)
  return joinPathSegments(lobbyDir, ['media', parsed.bucket, ...parsed.pathSegments])
}

async function renameVaultLobbyDirectory(lobbyId: string, previousName: string, nextName: string): Promise<void> {
  const trimmedNextName = nextName.trim()
  if (!trimmedNextName || previousName.trim() === trimmedNextName) {
    return
  }

  const oldDir = await getVaultLobbyDirectory(lobbyId, previousName)
  const newDir = await getVaultLobbyDirectory(lobbyId, trimmedNextName)

  if (oldDir === newDir || !(await vaultPathExists(oldDir)) || (await vaultPathExists(newDir))) {
    return
  }

  await renamePath(oldDir, newDir)
}

async function copyLocalAssetToVault(localUrl: string, lobbyId: string, lobbyName: string): Promise<string | null> {
  if (!localUrl.startsWith('local://')) {
    return null
  }

  const sourceFilePath = await resolveLocalMediaFilePath(localUrl)
  if (!sourceFilePath || !(await vaultPathExists(sourceFilePath))) {
    return null
  }

  const relativeSourcePath = localUrl.replace('local://', '')

  const [bucket, ...pathSegments] = relativeSourcePath.split('/').filter(Boolean)
  if (!bucket || pathSegments.length === 0) {
    return null
  }

  const lobbyDir = await getVaultLobbyDirectory(lobbyId, lobbyName)
  const bucketDir = await joinPathSegments(lobbyDir, ['media', bucket])

  const subDirSegments = pathSegments.slice(0, -1)
  const destinationDir = subDirSegments.length > 0
    ? await joinPathSegments(bucketDir, subDirSegments)
    : bucketDir

  const destinationFilePath = await join(destinationDir, pathSegments[pathSegments.length - 1])
  if (!(await vaultPathExists(destinationFilePath))) {
    await copyFileToPath(sourceFilePath, destinationFilePath)
  }

  return ['media', bucket, ...pathSegments].join('/')
}

async function getLocalMediaReferenceCount(localUrl: string): Promise<number> {
  if (!db) return 0

  const rows = await db.select<any[]>(
    'SELECT COUNT(*) as count FROM traces WHERE media_url = ? OR image_url = ?',
    [localUrl, localUrl],
  )

  return Number(rows[0]?.count ?? 0)
}

function clearResolvedLocalUrlCache(localUrl: string) {
  const cachedUrl = resolvedUrlCache.get(localUrl)
  if (cachedUrl && cachedUrl.startsWith('blob:')) {
    URL.revokeObjectURL(cachedUrl)
  }

  resolvedUrlCache.delete(localUrl)
  pendingResolutions.delete(localUrl)
}

async function cleanupDeletedTraceMedia(previousRows: any[]): Promise<void> {
  if (!db) return

  const lobbyIdsByUrl = new Map<string, Set<string>>()

  for (const row of previousRows) {
    const lobbyId = typeof row.lobby_id === 'string' ? row.lobby_id : null
    if (!lobbyId) continue

    for (const value of [row.media_url, row.image_url]) {
      if (typeof value !== 'string' || !value.startsWith('local://')) {
        continue
      }

      const lobbyIds = lobbyIdsByUrl.get(value) ?? new Set<string>()
      lobbyIds.add(lobbyId)
      lobbyIdsByUrl.set(value, lobbyIds)
    }
  }

  for (const [localUrl, lobbyIds] of lobbyIdsByUrl.entries()) {
    const remainingReferences = await getLocalMediaReferenceCount(localUrl)
    if (remainingReferences > 0) {
      continue
    }

    const runtimeMediaPath = await resolveLocalMediaFilePath(localUrl)
    if (runtimeMediaPath && await vaultPathExists(runtimeMediaPath)) {
      await removePath(runtimeMediaPath)
    }

    for (const lobbyId of lobbyIds) {
      const mirrorPath = await getVaultMirrorMediaFilePath(localUrl, lobbyId)
      if (mirrorPath && await vaultPathExists(mirrorPath)) {
        await removePath(mirrorPath)
      }
    }

    clearResolvedLocalUrlCache(localUrl)
  }
}

async function writeLobbyVaultSnapshot(lobbyId: string): Promise<void> {
  if (!db) return

  const lobbyRows = await db.select<any[]>('SELECT * FROM lobbies WHERE id = ?', [lobbyId])
  const lobby = lobbyRows[0] ? convertRowFromSql('lobbies', lobbyRows[0]) : null
  if (!lobby) return

  const traceRows = await db.select<any[]>(
    'SELECT * FROM traces WHERE lobby_id = ? ORDER BY z_index DESC, created_at ASC',
    [lobbyId]
  )
  const traces = traceRows.map(row => convertRowFromSql('traces', row))

  const layerIds = Array.from(new Set(traces.map((trace: any) => trace.layer_id).filter(Boolean)))
  let layers: any[] = []
  if (layerIds.length > 0) {
    const placeholders = layerIds.map(() => '?').join(', ')
    const layerRows = await db.select<any[]>(`SELECT * FROM layers WHERE id IN (${placeholders})`, layerIds)
    layers = layerRows
      .map(row => convertRowFromSql('layers', row))
      .sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))
  }

  const lobbyDir = await getVaultLobbyDirectory(lobby.id, lobby.name)
  lobbyNameCache.set(lobby.id, lobby.name)

  const serializedTraces = []
  for (const trace of traces) {
    const vaultMediaPath = typeof trace.media_url === 'string'
      ? await copyLocalAssetToVault(trace.media_url, lobby.id, lobby.name)
      : null
    const vaultImagePath = typeof trace.image_url === 'string'
      ? await copyLocalAssetToVault(trace.image_url, lobby.id, lobby.name)
      : null

    serializedTraces.push({
      ...trace,
      vault_media_path: vaultMediaPath,
      vault_image_path: vaultImagePath,
    })
  }

  const snapshot = {
    version: 1,
    format: 'vault-mirror',
    syncedAt: new Date().toISOString(),
    app: 'Digital Atrium Desktop',
    lobby,
    layers,
    traces: serializedTraces,
  }

  const snapshotPath = await join(lobbyDir, 'atrium.json')
  await writeVaultTextFile(snapshotPath, JSON.stringify(snapshot, null, 2))
}

function scheduleLobbyVaultSync(lobbyId: string | null | undefined): void {
  if (!lobbyId) return

  const existingTimeout = pendingVaultSyncs.get(lobbyId)
  if (existingTimeout) {
    window.clearTimeout(existingTimeout)
  }

  const timeout = window.setTimeout(() => {
    pendingVaultSyncs.delete(lobbyId)
    void writeLobbyVaultSnapshot(lobbyId).catch(error => {
      console.error('Error syncing atrium vault:', error)
    })
  }, VAULT_SYNC_DELAY_MS)

  pendingVaultSyncs.set(lobbyId, timeout)
}

function scheduleLobbyVaultSyncs(lobbyIds: Array<string | null | undefined>): void {
  const uniqueLobbyIds = Array.from(new Set(lobbyIds.filter((lobbyId): lobbyId is string => !!lobbyId)))
  uniqueLobbyIds.forEach(scheduleLobbyVaultSync)
}

async function scheduleLayerVaultSyncs(layerIds: string[]): Promise<void> {
  if (!db || layerIds.length === 0) return

  const uniqueLayerIds = Array.from(new Set(layerIds.filter(Boolean)))
  if (uniqueLayerIds.length === 0) return

  const placeholders = uniqueLayerIds.map(() => '?').join(', ')
  const rows = await db.select<any[]>(
    `SELECT DISTINCT lobby_id FROM traces WHERE layer_id IN (${placeholders}) AND lobby_id IS NOT NULL`,
    uniqueLayerIds,
  )

  scheduleLobbyVaultSyncs(rows.map(row => row.lobby_id))
}

async function syncAllLobbiesToVault(): Promise<void> {
  if (!db) return

  const rows = await db.select<any[]>('SELECT id FROM lobbies')
  for (const row of rows) {
    await writeLobbyVaultSnapshot(row.id)
  }
}

async function readRowsForMutation(table: string, filters: QueryFilter[]): Promise<any[]> {
  if (!db) return []

  let sql = `SELECT * FROM ${table}`
  const params: any[] = []
  const whereClauses = buildWhereClauses(filters, params)
  if (whereClauses) sql += ` WHERE ${whereClauses}`

  return db.select<any[]>(sql, params)
}

async function handleVaultSyncAfterMutation(opts: QueryOptions, previousRows: any[], insertedRow?: any): Promise<void> {
  if (!db) return

  switch (opts.table) {
    case 'traces': {
      if (opts.operation === 'delete') {
        await cleanupDeletedTraceMedia(previousRows)
      }

      const nextLobbyIds = typeof opts.data?.lobby_id === 'string' ? [opts.data.lobby_id] : []
      if (insertedRow?.lobby_id) {
        nextLobbyIds.push(insertedRow.lobby_id)
      }

      scheduleLobbyVaultSyncs([
        ...previousRows.map(row => row.lobby_id),
        ...nextLobbyIds,
      ])
      return
    }

    case 'lobbies': {
      if (opts.operation === 'delete') {
        previousRows.forEach((row) => {
          if (row.id) {
            lobbyNameCache.delete(row.id)
          }
        })
        return
      }

      if (opts.operation === 'insert' && insertedRow?.id && typeof insertedRow?.name === 'string') {
        lobbyNameCache.set(insertedRow.id, insertedRow.name)
      }

      if (opts.operation === 'update' && typeof opts.data?.name === 'string') {
        await Promise.all(previousRows.map(async (row) => {
          lobbyNameCache.set(row.id, opts.data.name)
          await renameVaultLobbyDirectory(row.id, row.name, opts.data.name)
          await renameRuntimeMediaLobbyDirectory('traces', row.id, row.name, opts.data.name)
        }))
      }

      const lobbyIds = opts.operation === 'insert'
        ? [insertedRow?.id]
        : previousRows.map(row => row.id)

      scheduleLobbyVaultSyncs(lobbyIds)
      return
    }

    case 'layers': {
      if (opts.operation === 'insert') {
        return
      }

      await scheduleLayerVaultSyncs(previousRows.map(row => row.id))
      return
    }

    default:
      return
  }
}

// ---- Initialization ----

export async function initLocalDb(): Promise<void> {
  const liveDatabasePath = await invoke<string>('prepare_live_database')
  db = await Database.load(`sqlite:${liveDatabasePath}`)

  // Get app data directory for media files
  const appData = await appDataDir()
  legacyMediaBasePath = await join(appData, 'media')
  mediaBasePath = await getLiveMediaBasePath()
  const mediaExists = await exists(legacyMediaBasePath)
  if (!mediaExists) {
    await mkdir(legacyMediaBasePath, { recursive: true })
  }

  await initializeVaultBasePath()

  // Create tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      display_name TEXT DEFAULT '',
      display_name_last_changed TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      player_color TEXT DEFAULT '#ffffff',
      active_lobby_id TEXT
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS lobbies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      password_hash TEXT,
      max_players INTEGER DEFAULT 50,
      is_public INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      theme_settings TEXT,
      autosave_enabled INTEGER DEFAULT 0,
      autosave_interval_seconds INTEGER DEFAULT 60,
      admin_user_ids TEXT
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('text','image','audio','video','embed','shape')),
      content TEXT NOT NULL DEFAULT '',
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      image_url TEXT,
      media_url TEXT,
      scale REAL DEFAULT 1.0,
      scale_x REAL,
      scale_y REAL,
      rotation REAL DEFAULT 0.0,
      flip_horizontal INTEGER DEFAULT 0,
      flip_vertical INTEGER DEFAULT 0,
      show_border INTEGER DEFAULT 1,
      show_background INTEGER DEFAULT 1,
      border_color TEXT,
      border_opacity REAL,
      fill_color TEXT,
      fill_opacity REAL,
      show_description INTEGER DEFAULT 1,
      show_filename INTEGER DEFAULT 1,
      font_size TEXT DEFAULT '16',
      font_family TEXT DEFAULT 'sans',
      text_bold INTEGER DEFAULT 0,
      text_italic INTEGER DEFAULT 0,
      text_underline INTEGER DEFAULT 0,
      text_align TEXT DEFAULT 'center',
      text_color TEXT DEFAULT '#ffffff',
      is_locked INTEGER DEFAULT 0,
      border_radius REAL DEFAULT 8,
      crop_x REAL DEFAULT 0,
      crop_y REAL DEFAULT 0,
      crop_width REAL DEFAULT 1,
      crop_height REAL DEFAULT 1,
      illuminate INTEGER DEFAULT 0,
      light_color TEXT DEFAULT '#ffffff',
      light_intensity REAL DEFAULT 1.0,
      light_radius REAL DEFAULT 200,
      light_offset_x REAL DEFAULT 0,
      light_offset_y REAL DEFAULT 0,
      light_pulse INTEGER DEFAULT 0,
      light_pulse_speed REAL DEFAULT 2.0,
      enable_interaction INTEGER DEFAULT 0,
      ignore_clicks INTEGER DEFAULT 0,
      layer_id TEXT,
      z_index INTEGER DEFAULT 0,
      lobby_id TEXT,
      shape_type TEXT,
      shape_color TEXT,
      shape_opacity REAL,
      corner_radius REAL,
      shape_outline_only INTEGER,
      shape_no_fill INTEGER,
      shape_outline_color TEXT,
      shape_outline_width REAL,
      shape_points TEXT,
      path_curve_type TEXT,
      path_arrow_start TEXT,
      path_arrow_end TEXT,
      width REAL,
      height REAL
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS layers (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      z_index INTEGER NOT NULL DEFAULT 0,
      is_group INTEGER DEFAULT 1,
      parent_id TEXT,
      user_id TEXT NOT NULL,
      lobby_id TEXT
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS lobby_access_lists (
      id TEXT PRIMARY KEY,
      lobby_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      list_type TEXT NOT NULL CHECK(list_type IN ('whitelist','blacklist','admin')),
      added_at TEXT DEFAULT (datetime('now')),
      added_by TEXT,
      UNIQUE(lobby_id, user_id, list_type)
    )
  `)

  // Ensure theme_settings column exists (for DBs created before it was added)
  try {
    await db.execute('ALTER TABLE lobbies ADD COLUMN theme_settings TEXT')
  } catch {
    // Column already exists — ignore
  }

  // Ensure layers.lobby_id exists (for DBs created before atriums were scoped
  // per-lobby — see the cross-atrium layer leakage fix)
  try {
    await db.execute('ALTER TABLE layers ADD COLUMN lobby_id TEXT')
  } catch {
    // Column already exists — ignore
  }

  // Ensure traces flip columns exist (for DBs created before flip support)
  try {
    await db.execute('ALTER TABLE traces ADD COLUMN flip_horizontal INTEGER DEFAULT 0')
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE traces ADD COLUMN flip_vertical INTEGER DEFAULT 0')
  } catch {
    // Column already exists — ignore
  }

  // Ensure traces scale_x/scale_y exist (for DBs created before non-uniform
  // stretch was persisted independently of the single `scale` column) and
  // backfill them from the existing scale value so old rows keep their size.
  // No DEFAULT here (unlike the `scale` column) -- SQLite, unlike Postgres,
  // immediately applies a column DEFAULT to existing rows on ADD COLUMN, which
  // an earlier version of this migration used and it silently defeated the
  // `WHERE scale_x IS NULL` backfill below (every row already had 1.0, never
  // NULL), resetting every pre-existing trace's scale. New traces still get
  // the correct size via mapRowToTrace's `row.scale_x ?? row.scale ?? 1.0`
  // fallback, since every insert path already sets `scale` explicitly.
  try {
    await db.execute('ALTER TABLE traces ADD COLUMN scale_x REAL')
    await db.execute('UPDATE traces SET scale_x = scale WHERE scale_x IS NULL')
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE traces ADD COLUMN scale_y REAL')
    await db.execute('UPDATE traces SET scale_y = scale WHERE scale_y IS NULL')
  } catch {
    // Column already exists — ignore
  }

  // Repair for DBs that already went through the buggy version of the
  // migration above: scale_x=1.0 AND scale_y=1.0 AND scale<>1.0 can't happen
  // through normal use (saveAllChanges always writes `scale` as the average
  // of scale_x/scale_y), so it's a safe signal a trace's size was reset by
  // that bug -- recover it from the untouched `scale` column.
  try {
    await db.execute(
      'UPDATE traces SET scale_x = scale, scale_y = scale ' +
      'WHERE scale_x = 1.0 AND scale_y = 1.0 AND scale IS NOT NULL AND scale != 1.0'
    )
  } catch {
    // Best-effort repair — ignore failures
  }

  // Ensure lobbies autosave columns exist (for DBs created before autosave
  // was moved from a global browser preference to a per-atrium setting)
  try {
    await db.execute('ALTER TABLE lobbies ADD COLUMN autosave_enabled INTEGER DEFAULT 0')
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE lobbies ADD COLUMN autosave_interval_seconds INTEGER DEFAULT 60')
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE lobbies ADD COLUMN admin_user_ids TEXT')
  } catch {
    // Column already exists — ignore
  }

  // Ensure local user profile exists
  const profileRows = await db.select<any[]>('SELECT id FROM profiles WHERE id = ?', [LOCAL_USER_ID])
  if (profileRows.length === 0) {
    await db.execute(
      'INSERT INTO profiles (id, username, email, display_name, player_color) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_USER_ID, LOCAL_USERNAME, 'local@desktop', 'Local User', '#ffffff']
    )
  }

  await migrateLegacyLocalMediaToRuntime()

  void syncAllLobbiesToVault()
}

// ---- Helper: generate UUID ----
function uuid(): string {
  return crypto.randomUUID()
}

// ---- Helper: SQLite boolean conversion ----
function sqlBool(val: any): boolean {
  return val === 1 || val === true
}

function toSqlBool(val: any): number {
  if (val === undefined || val === null) return 0
  return val ? 1 : 0
}

// ---- Helper: parse JSON fields ----
function parseJsonField(val: any): any {
  if (!val) return val
  if (typeof val === 'string') {
    try { return JSON.parse(val) } catch { return val }
  }
  return val
}

// ---- Query Builder (mimics Supabase's chained API) ----

type FilterOp = 'eq' | 'in' | 'ilike' | 'neq'

interface QueryFilter {
  column: string
  op: FilterOp
  value: any
}

interface QueryOptions {
  table: string
  operation: 'select' | 'insert' | 'update' | 'delete'
  filters: QueryFilter[]
  data?: any
  selectColumns?: string
  orderBy?: { column: string; ascending: boolean }
  limitCount?: number
  isSingle?: boolean
  isMaybeSingle?: boolean
  isCount?: boolean
  isHead?: boolean
}

class QueryBuilder {
  private opts: QueryOptions

  constructor(table: string, operation: 'select' | 'insert' | 'update' | 'delete', data?: any, selectColumns?: string) {
    this.opts = {
      table,
      operation,
      filters: [],
      data,
      selectColumns,
    }
  }

  eq(column: string, value: any): QueryBuilder {
    this.opts.filters.push({ column, op: 'eq', value })
    return this
  }

  neq(column: string, value: any): QueryBuilder {
    this.opts.filters.push({ column, op: 'neq', value })
    return this
  }

  in(column: string, values: any[]): QueryBuilder {
    this.opts.filters.push({ column, op: 'in', value: values })
    return this
  }

  ilike(column: string, pattern: string): QueryBuilder {
    this.opts.filters.push({ column, op: 'ilike', value: pattern })
    return this
  }

  order(column: string, options?: { ascending?: boolean }): QueryBuilder {
    this.opts.orderBy = { column, ascending: options?.ascending ?? true }
    return this
  }

  limit(count: number): QueryBuilder {
    this.opts.limitCount = count
    return this
  }

  single(): QueryBuilder {
    this.opts.isSingle = true
    return this
  }

  maybeSingle(): QueryBuilder {
    this.opts.isMaybeSingle = true
    return this
  }

  select(columns?: string, options?: { count?: string; head?: boolean }): QueryBuilder {
    if (this.opts.operation === 'insert' || this.opts.operation === 'update') {
      // .insert({}).select() or .update({}).select() — return the data after mutation
      this.opts.selectColumns = columns || '*'
      if (options?.count) this.opts.isCount = true
      if (options?.head) this.opts.isHead = true
      return this
    }
    this.opts.selectColumns = columns || '*'
    if (options?.count) this.opts.isCount = true
    if (options?.head) this.opts.isHead = true
    return this
  }

  async then(resolve: (result: any) => void, reject?: (err: any) => void): Promise<void> {
    try {
      const result = await executeQuery(this.opts)
      resolve(result)
    } catch (e) {
      if (reject) reject(e)
      else throw e
    }
  }
}

// ---- Execute the built query against SQLite ----

async function executeQuery(opts: QueryOptions): Promise<{ data: any; error: any; count?: number }> {
  if (!db) return { data: null, error: { message: 'Database not initialized' } }

  try {
    switch (opts.operation) {
      case 'select': {
        let sql: string
        const params: any[] = []

        if (opts.isCount && opts.isHead) {
          sql = `SELECT COUNT(*) as count FROM ${opts.table}`
        } else {
          sql = `SELECT * FROM ${opts.table}`
        }

        const whereClauses = buildWhereClauses(opts.filters, params)
        if (whereClauses) sql += ` WHERE ${whereClauses}`

        if (opts.orderBy) {
          sql += ` ORDER BY ${opts.orderBy.column} ${opts.orderBy.ascending ? 'ASC' : 'DESC'}`
        }
        if (opts.limitCount) {
          sql += ` LIMIT ${opts.limitCount}`
        }

        const rows = await db!.select<any[]>(sql, params)

        if (opts.isCount && opts.isHead) {
          return { data: null, error: null, count: rows[0]?.count ?? 0 }
        }

        const mapped = rows.map(r => convertRowFromSql(opts.table, r))

        if (opts.isSingle) {
          return { data: mapped[0] || null, error: mapped[0] ? null : { message: 'No rows found', code: 'PGRST116' } }
        }
        if (opts.isMaybeSingle) {
          return { data: mapped[0] || null, error: null }
        }
        return { data: mapped, error: null }
      }

      case 'insert': {
        const inputRows = Array.isArray(opts.data) ? opts.data : [opts.data]
        const normalizedRows = inputRows.map((entry) => {
          const row = { ...entry }
          if (!row.id) row.id = uuid()
          if (!row.created_at) row.created_at = new Date().toISOString()
          return row
        })

        for (const row of normalizedRows) {
          const prepared = convertRowToSql(opts.table, row)
          const columns = Object.keys(prepared)
          const placeholders = columns.map(() => '?').join(', ')
          const values = columns.map(c => prepared[c])
          const sql = `INSERT OR REPLACE INTO ${opts.table} (${columns.join(', ')}) VALUES (${placeholders})`

          await db!.execute(sql, values)
          void handleVaultSyncAfterMutation({ ...opts, data: row }, [], row)
        }

        if (opts.selectColumns) {
          const insertedRows: any[] = []

          for (const row of normalizedRows) {
            const inserted = await db!.select<any[]>(`SELECT * FROM ${opts.table} WHERE id = ?`, [row.id])
            if (inserted[0]) {
              insertedRows.push(convertRowFromSql(opts.table, inserted[0]))
            }
          }

          if (opts.isSingle) return { data: insertedRows[0] || null, error: null }
          return { data: Array.isArray(opts.data) ? insertedRows : insertedRows[0] ? [insertedRows[0]] : [], error: null }
        }

        if (opts.isSingle) return { data: normalizedRows[0] || null, error: null }
        return { data: Array.isArray(opts.data) ? normalizedRows : normalizedRows[0], error: null }
      }

      case 'update': {
        const previousRows = await readRowsForMutation(opts.table, opts.filters)
        const updates = opts.data
        const prepared = convertRowToSql(opts.table, updates)
        const setClauses = Object.keys(prepared).map(k => `${k} = ?`).join(', ')
        const setValues = Object.values(prepared)
        const params: any[] = [...setValues]

        let sql = `UPDATE ${opts.table} SET ${setClauses}`
        const whereClauses = buildWhereClauses(opts.filters, params)
        if (whereClauses) sql += ` WHERE ${whereClauses}`

        await db!.execute(sql, params)
        void handleVaultSyncAfterMutation(opts, previousRows)

        if (opts.selectColumns) {
          // Return updated rows
          let selectSql = `SELECT * FROM ${opts.table}`
          const selectParams: any[] = []
          const selectWhere = buildWhereClauses(opts.filters, selectParams)
          if (selectWhere) selectSql += ` WHERE ${selectWhere}`
          const rows = await db!.select<any[]>(selectSql, selectParams)
          const mapped = rows.map(r => convertRowFromSql(opts.table, r))
          if (opts.isSingle) return { data: mapped[0] || null, error: null }
          return { data: mapped, error: null }
        }
        return { data: null, error: null }
      }

      case 'delete': {
        const previousRows = await readRowsForMutation(opts.table, opts.filters)
        const params: any[] = []
        let sql = `DELETE FROM ${opts.table}`
        const whereClauses = buildWhereClauses(opts.filters, params)
        if (whereClauses) sql += ` WHERE ${whereClauses}`
        await db!.execute(sql, params)
        void handleVaultSyncAfterMutation(opts, previousRows)

        if (opts.selectColumns) {
          // Rows can't be re-queried post-delete (they're gone); the rows
          // fetched above (before deleting, for the vault-sync diff) are
          // exactly what was deleted, so reuse them here too.
          const mapped = previousRows.map(r => convertRowFromSql(opts.table, r))
          if (opts.isSingle) return { data: mapped[0] || null, error: null }
          return { data: mapped, error: null }
        }
        return { data: null, error: null }
      }
    }
  } catch (e: any) {
    return { data: null, error: { message: e.message || String(e) } }
  }

  return { data: null, error: { message: 'Unknown operation' } }
}

function buildWhereClauses(filters: QueryFilter[], params: any[]): string {
  if (filters.length === 0) return ''
  return filters.map(f => {
    switch (f.op) {
      case 'eq':
        params.push(f.value)
        return `${f.column} = ?`
      case 'neq':
        params.push(f.value)
        return `${f.column} != ?`
      case 'in':
        const placeholders = f.value.map(() => '?').join(', ')
        params.push(...f.value)
        return `${f.column} IN (${placeholders})`
      case 'ilike':
        params.push(f.value.replace(/%/g, '%'))
        return `${f.column} LIKE ? COLLATE NOCASE`
      default:
        return '1=1'
    }
  }).join(' AND ')
}

// ---- Row conversion: SQLite (snake_case, integers for bools) <-> Supabase format ----

function convertRowFromSql(table: string, row: any): any {
  if (!row) return row
  const out: any = { ...row }

  // Convert SQLite integers to booleans for known boolean columns
  const boolColumns: Record<string, string[]> = {
    traces: ['show_border', 'show_background', 'show_description', 'show_filename',
      'text_bold', 'text_italic', 'text_underline', 'is_locked', 'illuminate',
      'light_pulse', 'enable_interaction', 'ignore_clicks', 'shape_outline_only', 'shape_no_fill',
      'flip_horizontal', 'flip_vertical'],
    lobbies: ['is_public', 'autosave_enabled'],
    layers: ['is_group'],
    profiles: [],
    lobby_access_lists: [],
  }

  const cols = boolColumns[table] || []
  for (const col of cols) {
    if (col in out) {
      out[col] = sqlBool(out[col])
    }
  }

  // Parse JSON fields
  if (table === 'traces' && out.shape_points) {
    out.shape_points = parseJsonField(out.shape_points)
  }
  if (table === 'lobbies' && out.theme_settings) {
    out.theme_settings = parseJsonField(out.theme_settings)
  }
  if (table === 'lobbies') {
    out.admin_user_ids = out.admin_user_ids ? parseJsonField(out.admin_user_ids) : []
  }

  // Convert font_size to numeric if it's a number string
  if (table === 'traces' && out.font_size) {
    const num = Number(out.font_size)
    if (!isNaN(num)) out.font_size = num
  }

  return out
}

function convertRowToSql(table: string, row: any): any {
  const out: any = { ...row }

  // Convert booleans to integers
  const boolColumns: Record<string, string[]> = {
    traces: ['show_border', 'show_background', 'show_description', 'show_filename',
      'text_bold', 'text_italic', 'text_underline', 'is_locked', 'illuminate',
      'light_pulse', 'enable_interaction', 'ignore_clicks', 'shape_outline_only', 'shape_no_fill',
      'flip_horizontal', 'flip_vertical'],
    lobbies: ['is_public', 'autosave_enabled'],
    layers: ['is_group'],
    profiles: [],
    lobby_access_lists: [],
  }

  const cols = boolColumns[table] || []
  for (const col of cols) {
    if (col in out && typeof out[col] === 'boolean') {
      out[col] = toSqlBool(out[col])
    }
  }

  // Serialize JSON fields
  if (table === 'traces' && out.shape_points && typeof out.shape_points !== 'string') {
    out.shape_points = JSON.stringify(out.shape_points)
  }
  if (table === 'lobbies' && out.theme_settings && typeof out.theme_settings !== 'string') {
    out.theme_settings = JSON.stringify(out.theme_settings)
  }
  if (table === 'lobbies' && out.admin_user_ids && typeof out.admin_user_ids !== 'string') {
    out.admin_user_ids = JSON.stringify(out.admin_user_ids)
  }

  return out
}

// ---- Local file storage (replaces Supabase Storage) ----

class LocalStorage {
  from(bucket: string) {
    return {
      async upload(path: string, fileData: Blob | File | Uint8Array, _options?: { contentType?: string }): Promise<{ data: any; error: any }> {
        try {
          let filePath: string
          if (bucket === 'traces') {
            filePath = await getResolvedRuntimeMediaFilePath(bucket, path.split('/').filter(Boolean)) ?? await joinPathSegments(mediaBasePath, [bucket, path])
          } else {
            filePath = await joinPathSegments(mediaBasePath, [bucket, ...path.split('/').filter(Boolean)])
          }

          let bytes: Uint8Array
          if (fileData instanceof Blob || fileData instanceof File) {
            const buffer = await fileData.arrayBuffer()
            bytes = new Uint8Array(buffer)
          } else {
            bytes = fileData
          }

          await writeBinaryFile(filePath, bytes)
          return { data: { path }, error: null }
        } catch (e: any) {
          return { data: null, error: { message: e.message || String(e) } }
        }
      },

      getPublicUrl(path: string): { data: { publicUrl: string } } {
        // Return a local:// URL that the renderer will resolve 
        return { data: { publicUrl: `local://${bucket}/${path}` } }
      },
    }
  }
}

// ---- RPC functions (local implementations) ----

async function localRpc(fnName: string, params: any): Promise<{ data: any; error: any }> {
  if (!db) return { data: null, error: { message: 'Database not initialized' } }

  try {
    switch (fnName) {
      case 'get_lobby_size_bytes': {
        // Sum the approximate size of all traces in this lobby
        const rows = await db.select<any[]>(
          `SELECT SUM(LENGTH(CAST(id AS TEXT)) + LENGTH(COALESCE(content,'')) + LENGTH(COALESCE(image_url,'')) + LENGTH(COALESCE(media_url,'')) + LENGTH(COALESCE(shape_points,'')) + 200) as total_bytes FROM traces WHERE lobby_id = ?`,
          [params.p_lobby_id]
        )
        return { data: rows[0]?.total_bytes || 0, error: null }
      }

      case 'lobby_has_password': {
        const rows = await db.select<any[]>(
          'SELECT password_hash FROM lobbies WHERE id = ?',
          [params.p_lobby_id]
        )
        return { data: rows[0]?.password_hash != null, error: null }
      }

      case 'get_user_lobby_count': {
        const rows = await db.select<any[]>(
          'SELECT COUNT(*) as count FROM lobbies WHERE owner_user_id = ?',
          [params.p_user_id]
        )
        return { data: rows[0]?.count || 0, error: null }
      }

      case 'get_user_lobby_access_status': {
        // In local mode, the user owns everything
        const rows = await db.select<any[]>(
          'SELECT owner_user_id FROM lobbies WHERE id = ?',
          [params.p_lobby_id]
        )
        if (rows[0]?.owner_user_id === params.p_user_id) {
          return { data: 'owner', error: null }
        }
        return { data: 'none', error: null }
      }

      case 'can_user_join_lobby': {
        // Local mode: always allowed
        return { data: true, error: null }
      }

      default:
        return { data: null, error: { message: `Unknown RPC function: ${fnName}` } }
    }
  } catch (e: any) {
    return { data: null, error: { message: e.message || String(e) } }
  }
}

// ---- Auth mock (no-op for local desktop) ----

const localAuth = {
  getSession: async () => ({
    data: {
      session: {
        user: { id: LOCAL_USER_ID, email: 'local@desktop' },
        access_token: 'local-token',
      }
    },
    error: null,
  }),

  getUser: async () => ({
    data: {
      user: { id: LOCAL_USER_ID, email: 'local@desktop' },
    },
    error: null,
  }),

  onAuthStateChange: (callback: (event: string, session: any) => void) => {
    // Fire immediately with local session
    setTimeout(() => {
      callback('SIGNED_IN', {
        user: { id: LOCAL_USER_ID, email: 'local@desktop' },
        access_token: 'local-token',
      })
    }, 0)
    return { data: { subscription: { unsubscribe: () => {} } } }
  },

  signUp: async () => ({
    data: { user: { id: LOCAL_USER_ID }, session: null },
    error: null,
  }),

  signInWithPassword: async () => ({
    data: {
      user: { id: LOCAL_USER_ID, email: 'local@desktop' },
      session: { user: { id: LOCAL_USER_ID }, access_token: 'local-token' },
    },
    error: null,
  }),

  resetPasswordForEmail: async () => ({ data: null, error: null }),
  updateUser: async () => ({ data: { user: { id: LOCAL_USER_ID } }, error: null }),
  signOut: async () => ({ error: null }),
}

// ---- Realtime mock (no-op for local desktop, single user) ----

class MockChannel {
  private presenceCallbacks: Map<string, Function> = new Map()

  on(type: string, filterOrCallback: any, callback?: Function): MockChannel {
    // For presence events: .on('presence', { event: 'sync' }, callback)
    if (type === 'presence' && callback) {
      this.presenceCallbacks.set(filterOrCallback.event, callback)
    }
    // postgres_changes: no-op in local mode (single user, direct DB access)
    return this
  }

  subscribe(callback?: (status: string) => void): MockChannel {
    // Simulate successful subscription
    setTimeout(() => {
      callback?.('SUBSCRIBED')
      // Fire initial presence sync with empty state
      const syncCb = this.presenceCallbacks.get('sync')
      if (syncCb) syncCb()
    }, 0)
    return this
  }

  track(_data: any): MockChannel {
    return this
  }

  send(_data: any): Promise<string> {
    return Promise.resolve('ok')
  }

  presenceState(): Record<string, any[]> {
    // Return empty — single user, no other players
    return {}
  }

  unsubscribe(): void {}
}

// ---- The main local client (drop-in for supabase) ----

export const localClient = {
  from(table: string) {
    return {
      select(columns?: string, options?: { count?: string; head?: boolean }): QueryBuilder {
        const qb = new QueryBuilder(table, 'select')
        if (columns) qb.select(columns, options)
        if (options?.count) (qb as any).opts.isCount = true
        if (options?.head) (qb as any).opts.isHead = true
        return qb
      },
      insert(data: any): QueryBuilder {
        return new QueryBuilder(table, 'insert', data)
      },
      update(data: any): QueryBuilder {
        return new QueryBuilder(table, 'update', data)
      },
      delete(): QueryBuilder {
        return new QueryBuilder(table, 'delete')
      },
    }
  },

  rpc(fnName: string, params?: any): Promise<{ data: any; error: any }> {
    return localRpc(fnName, params || {})
  },

  auth: localAuth,

  storage: new LocalStorage(),

  channel(_name: string, _opts?: any): MockChannel {
    return new MockChannel()
  },

  removeChannel(_channel: any): void {},
}

// ---- Resolve local:// URLs to filesystem paths ----

// Cache resolved blob URLs so repeated calls (and re-mounts) don't re-read from disk
const resolvedUrlCache = new Map<string, string>()
// Track in-flight resolutions to avoid duplicate reads for the same URL
const pendingResolutions = new Map<string, Promise<string>>()

export async function resolveLocalUrl(url: string): Promise<string> {
  if (!url.startsWith('local://')) return url

  // Return cached URL instantly
  const cached = resolvedUrlCache.get(url)
  if (cached) return cached

  const pending = pendingResolutions.get(url)
  if (pending) return pending

  const promise = (async () => {
    try {
      const filePath = await resolveLocalMediaFilePath(url)
      if (!filePath) {
        return url
      }

      const bytes = await readBinaryFile(filePath)
      const ext = filePath.split('.').pop()?.toLowerCase() || ''
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
        mp4: 'video/mp4', webm: 'video/webm',
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const blobBytes = new Uint8Array(bytes.byteLength)
      blobBytes.set(bytes)
      const blob = new Blob([blobBytes.buffer], { type: mime })
      const blobUrl = URL.createObjectURL(blob)
      resolvedUrlCache.set(url, blobUrl)
      return blobUrl
    } catch {
      return url
    } finally {
      pendingResolutions.delete(url)
    }
  })()

  pendingResolutions.set(url, promise)
  return promise
}

/**
 * Pre-seed the resolved URL cache so freshly uploaded files render instantly
 * without a redundant disk read.
 */
export function preCacheLocalUrl(localUrl: string, blobUrl: string) {
  resolvedUrlCache.set(localUrl, blobUrl)
}

// ---- Export helper to check if running in Tauri ----

export function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__
}

export { LOCAL_USER_ID, LOCAL_USERNAME }
