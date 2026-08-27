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
  // Raw bytes over Tauri's binary channel, the same fix read_binary_file
  // already had. `Array.from(bytes)` built a JS array with one element per
  // byte, which Tauri then serialised as JSON text roughly 3.6x the size of
  // the file -- 18MB for a 5MB photo, 180MB for a 50MB video, most of a second
  // just in Array.from before anything was sent. That is what made importing
  // feel slow next to a native app, and what made large videos look like they
  // had hung: the webview was building one gigantic string.
  //
  // Tauri sends a raw body only when the payload itself is the binary, so the
  // path rides inside it -- see write_binary_file in main.rs for the layout.
  const payload = binaryPayload(path, bytes)

  try {
    await invoke('write_binary_file', payload)
  } catch (rawError) {
    // An app mid-update can be running this file against the previous binary,
    // whose write_binary_file still expects { path, bytes } -- the same window
    // read_binary_file keeps its array branch for. One slow retry beats a
    // failed import; a genuine write failure just fails twice.
    try {
      await invoke('write_binary_file', { path, bytes: Array.from(bytes) })
    } catch {
      throw rawError
    }
  }
}

// The path header the two binary write commands share -- see
// write_binary_file in main.rs.
function binaryPayload(path: string, bytes: Uint8Array): Uint8Array {
  const pathBytes = new TextEncoder().encode(path)
  const payload = new Uint8Array(4 + pathBytes.length + bytes.length)
  new DataView(payload.buffer).setUint32(0, pathBytes.length, false)
  payload.set(pathBytes, 4)
  payload.set(bytes, 4 + pathBytes.length)
  return payload
}

// How much of a file is in memory at once while it is being written.
//
// One megabyte, because this is now the ONLY main-thread work left in a write
// and it happens on every frame.
//
// Reading moved to a worker, so what remains here is handing each chunk to
// Rust: a copy into the IPC, plus the garbage a buffer that size leaves
// behind. At four megabytes a frame that was a steady few milliseconds out of
// sixteen, every frame, for as long as the import ran -- which is exactly what
// a stuttering cursor is. The video itself played fine; it was the canvas
// around it that could not keep up.
//
// A quarter the size is a quarter the per-frame cost, at the price of four
// times as many frames to finish. The file takes longer to land, and the trace
// says "Preparing" for longer, which is the right way round: a wait you can
// see beats an app that stops responding to the mouse.
const WRITE_CHUNK_BYTES = 1024 * 1024

// Streams a blob to disk in slices, so peak memory is one chunk rather than
// the whole file.
//
// Reading a 500MB video with arrayBuffer() means that video exists complete in
// the webview, again in the IPC payload, and again on the Rust side, all at the
// same instant. Slicing keeps every one of those the size of a chunk. Blob
// slices are lazy: the bytes are only read when a slice is turned into a
// buffer, so this never materialises the original either.
// Drives the worker: it reads, this sends, and the two overlap.
//
// Returns false if a worker could not be started at all, so the caller can
// fall back to reading on this thread rather than failing the import.
async function streamBlobViaWorker(token: string, blob: Blob): Promise<boolean> {
  let worker: Worker
  try {
    worker = new Worker(new URL('./vaultWriter.worker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    console.warn('[vault] no worker available, reading on the main thread:', error)
    return false
  }

  try {
    await new Promise<void>((resolve, reject) => {
      worker.onerror = event => reject(new Error(event.message || 'vault writer worker failed'))
      worker.onmessage = async event => {
        const message = event.data
        if (message?.type === 'error') {
          reject(new Error(message.message))
          return
        }
        if (message?.type !== 'chunk') return
        try {
          await invoke('append_binary_stream', new Uint8Array(message.buffer), {
            headers: { 'x-stream-token': token },
          })
          if (message.last) {
            resolve()
            return
          }
          // A frame between chunks. The read is off this thread now, but the
          // transfer to Rust still happens here, and awaits alone resolve in
          // microtasks -- which run to exhaustion before the browser paints.
          await new Promise<void>(done => requestAnimationFrame(() => done()))
          worker.postMessage({ type: 'more' })
        } catch (error) {
          reject(error)
        }
      }
      worker.postMessage({ type: 'start', blob, chunkSize: WRITE_CHUNK_BYTES })
    })
    return true
  } finally {
    worker.terminate()
  }
}

async function writeBlobToFile(path: string, blob: Blob): Promise<void> {
  if (blob.size <= WRITE_CHUNK_BYTES) {
    await writeBinaryFile(path, new Uint8Array(await blob.arrayBuffer()))
    return
  }

  // Name the file once, then send nothing but bytes.
  //
  // The fallback below prefixes the destination path to every chunk, which
  // costs a second buffer the size of the chunk to glue them together here
  // and another to split them apart in Rust -- two whole copies of every
  // byte, on the thread drawing the atrium, to repeat a path that never
  // changes. Opening the file once and passing the token in an IPC header
  // means the raw body is the chunk itself and goes straight to disk.
  let token: string | null = null
  try {
    token = await invoke<string>('open_binary_stream', { path })
  } catch {
    // An older binary during an in-place update won't have the command.
    token = null
  }

  if (token) {
    // Preferred path: the bytes are read on a worker thread and only handed
    // through this one.
    try {
      if (await streamBlobViaWorker(token, blob)) {
        await invoke('close_binary_stream', { token })
        return
      }
    } catch (workerError) {
      await invoke('close_binary_stream', { token }).catch(() => {})
      console.warn('[vault] worker write failed, falling back:', workerError)
      token = null
    }
  }

  if (token) {
    try {
      for (let at = 0; at < blob.size; at += WRITE_CHUNK_BYTES) {
        const bytes = new Uint8Array(await blob.slice(at, at + WRITE_CHUNK_BYTES).arrayBuffer())
        await invoke('append_binary_stream', bytes, { headers: { 'x-stream-token': token } })
        if (at + WRITE_CHUNK_BYTES < blob.size) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
        }
      }
      await invoke('close_binary_stream', { token })
      return
    } catch (streamError) {
      // Close before falling back, or the handle outlives the attempt.
      await invoke('close_binary_stream', { token }).catch(() => {})
      console.warn('[vault] streamed write failed, falling back to append:', streamError)
    }
  }

  let offset = 0
  while (offset < blob.size) {
    const slice = blob.slice(offset, offset + WRITE_CHUNK_BYTES)
    const bytes = new Uint8Array(await slice.arrayBuffer())
    if (offset === 0) {
      // Truncating, so re-importing over an existing path cannot leave the
      // tail of a longer old file stranded after the new one.
      await writeBinaryFile(path, bytes)
    } else {
      try {
        await invoke('append_binary_file', binaryPayload(path, bytes))
      } catch (rawError) {
        // Same two-shape fallback as writeBinaryFile: the command takes
        // either encoding, so if the raw channel is unavailable the JSON one
        // still lands the bytes. Slower, and a written file beats a fast
        // half of one.
        await invoke('append_binary_file', { path, bytes: Array.from(bytes) })
          .catch(() => { throw rawError })
      }
    }
    offset += WRITE_CHUNK_BYTES

    // Hand a frame back between chunks.
    //
    // Every step here is awaited, but awaits resolve in microtasks, which run
    // to exhaustion before the browser paints -- so a long file's worth of
    // slicing and copying lands as one unbroken block of work and the window
    // stops responding for the duration. This is the lag right after an
    // import finishes: the trace is already on screen from its blob URL, the
    // panel has gone, and the vault write is still going.
    //
    // One frame per chunk, so a 200MB video spends a fraction of a second more
    // in total and none of it holding the app still.
    if (offset < blob.size) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }
  }
}

async function readBinaryFile(path: string): Promise<Uint8Array> {
  // The Rust side now answers with raw bytes over Tauri's binary channel
  // (see read_binary_file), which arrive as an ArrayBuffer. It used to return
  // a Vec<u8>, which Tauri serialises as a JSON array with one number per
  // byte -- tens of megabytes of text for a 10MB file, built, transferred,
  // parsed and then walked element by element into a Uint8Array.
  //
  // The array branch is kept because this file is also loaded by a running
  // app during an update, where the front end can briefly be newer than the
  // binary it's talking to.
  const result = await invoke<ArrayBuffer | number[]>('read_binary_file', { path })
  if (result instanceof ArrayBuffer) return new Uint8Array(result)
  if (ArrayBuffer.isView(result)) return new Uint8Array((result as ArrayBufferView).buffer)
  return Uint8Array.from(result as number[])
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

// Where a media file lives: inside its own atrium's folder, the one the user
// can see and copy elsewhere.
//
// This used to be two places. Files were written into _runtime and then copied
// into the atrium's folder as a mirror, so every byte was on disk twice. The
// visible copy is the useful one -- it's browsable, it travels with the atrium,
// and it's what a restore reads -- so it became the only one, leaving _runtime
// holding just atrium.db, which is what it was created to protect.
//
// Returns null when the atrium isn't known (an unknown lobby id, or a bucket
// that isn't lobby-scoped), and callers fall back to the runtime layout.
async function getAtriumMediaFilePath(bucket: string, pathSegments: string[], lobbyName?: string): Promise<string | null> {
  if (bucket !== 'traces' || pathSegments.length < 2) return null

  const lobbyId = pathSegments[0]
  const resolvedLobbyName = lobbyName ?? await getLobbyNameById(lobbyId)
  if (!resolvedLobbyName) return null

  const lobbyDir = await getVaultLobbyDirectory(lobbyId, resolvedLobbyName)
  return joinPathSegments(lobbyDir, ['media', bucket, ...pathSegments])
}

async function resolveLocalMediaFilePath(url: string): Promise<string | null> {
  const parsed = parseLocalUrl(url)
  if (!parsed) return null

  const atriumPath = await getAtriumMediaFilePath(parsed.bucket, parsed.pathSegments)
  if (atriumPath && await vaultPathExists(atriumPath)) {
    return atriumPath
  }

  // Installs from before media was consolidated, and anything the migration
  // couldn't place. Still read from, never written to.
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

  // Nothing exists yet: hand back where it should go, so callers writing a new
  // file put it in the right place.
  return atriumPath ?? runtimePath
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

  // Now that media is written straight into the atrium's folder, source and
  // destination are usually the same path and this copies nothing -- it still
  // earns its place for an install whose media hasn't been consolidated yet,
  // where the file is in _runtime and needs bringing across.
  const destinationFilePath = await join(destinationDir, pathSegments[pathSegments.length - 1])
  if (sourceFilePath !== destinationFilePath && !(await vaultPathExists(destinationFilePath))) {
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

// Set when the database opens but fails PRAGMA integrity_check.
//
// Corruption previously surfaced one query at a time, as "database disk image
// is malformed" attached to whatever the user happened to be doing -- an
// import, entering an atrium -- which reads as that action failing rather than
// as the database being damaged. Checked once at startup instead, so the app
// can say what's actually wrong and offer to rebuild from the vault mirrors.
let databaseIntegrityError: string | null = null
export function getDatabaseIntegrityError(): string | null {
  return databaseIntegrityError
}

export async function initLocalDb(): Promise<void> {
  const liveDatabasePath = await invoke<string>('prepare_live_database')
  db = await Database.load(`sqlite:${liveDatabasePath}`)

  try {
    const rows = await db.select<any[]>('PRAGMA integrity_check')
    const result = rows?.[0] ? String(Object.values(rows[0])[0]) : 'ok'
    databaseIntegrityError = result === 'ok' ? null : result
  } catch (e: any) {
    // The check itself throwing is the strongest signal there is.
    databaseIntegrityError = e?.message || String(e)
  }
  if (databaseIntegrityError) {
    console.error('Local database failed its integrity check:', databaseIntegrityError)
  }

  // Get app data directory for media files
  const appData = await appDataDir()
  legacyMediaBasePath = await join(appData, 'media')
  mediaBasePath = await getLiveMediaBasePath()
  const mediaExists = await exists(legacyMediaBasePath)
  if (!mediaExists) {
    await mkdir(legacyMediaBasePath, { recursive: true })
  }

  await initializeVaultBasePath()

  // Media used to be written into _runtime and then copied into each atrium's
  // folder, so every file was on disk twice. The visible copy is the one that
  // stays; this moves anything still in _runtime across and takes the empty
  // folder away, leaving _runtime holding only atrium.db.
  //
  // Runs on every start and costs one directory check once there's nothing
  // left to move, which is what makes it safe to leave in rather than needing
  // to be remembered as a one-off.
  try {
    const result = await invoke<string>('consolidate_runtime_media')
    if (result !== 'nothing to migrate') {
      console.log('Vault media consolidated:', result)
    }
  } catch (error) {
    // Not fatal: media still resolves from _runtime, which is exactly what the
    // fallback in resolveLocalMediaFilePath is for. Better a vault that's still
    // duplicated than an app that won't open.
    console.error('Could not consolidate vault media:', error)
  }

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
      admin_user_ids TEXT,
      edit_permission_mode TEXT DEFAULT 'all'
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      -- Deliberately unconstrained. A CHECK here has to be rebuilt (copying
      -- every trace) each time a type is added, and Postgres doesn't enforce
      -- one either -- so it only ever caused the two platforms to disagree.
      -- See dropTraceTypeCheckConstraint for existing vaults.
      type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      image_url TEXT,
      media_url TEXT,
      link_url TEXT,
      scale REAL DEFAULT 1.0,
      scale_x REAL,
      scale_y REAL,
      rotation REAL DEFAULT 0.0,
      flip_horizontal INTEGER DEFAULT 0,
      flip_vertical INTEGER DEFAULT 0,
      show_border INTEGER DEFAULT 1,
      show_background INTEGER DEFAULT 1,
      border_color TEXT,
      border_width REAL DEFAULT 2,
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
      text_scale_with_box INTEGER DEFAULT 1,
      show_shadow INTEGER DEFAULT 1,
      is_locked INTEGER DEFAULT 0,
      is_clickable INTEGER DEFAULT 0,
      border_radius REAL DEFAULT 0,
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
      shape_outline_opacity REAL,
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
      list_type TEXT NOT NULL CHECK(list_type IN ('whitelist','blacklist','admin','editor')),
      added_at TEXT DEFAULT (datetime('now')),
      added_by TEXT,
      UNIQUE(lobby_id, user_id, list_type)
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS lobby_locations (
      id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      lobby_id TEXT NOT NULL,
      name TEXT NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      zoom REAL NOT NULL DEFAULT 1,
      order_index INTEGER NOT NULL DEFAULT 0,
      user_id TEXT,
      is_locked INTEGER DEFAULT 0
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
  try {
    await db.execute("ALTER TABLE lobbies ADD COLUMN edit_permission_mode TEXT DEFAULT 'all'")
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE traces ADD COLUMN shape_outline_opacity REAL')
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE lobby_locations ADD COLUMN is_locked INTEGER DEFAULT 0')
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE traces ADD COLUMN is_clickable INTEGER DEFAULT 0')
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE traces ADD COLUMN border_width REAL DEFAULT 2')
  } catch {
    // Column already exists — ignore
  }
  try {
    await db.execute('ALTER TABLE traces ADD COLUMN link_url TEXT')
  } catch {
    // Column already exists — ignore
  }
  try {
    // Defaults to 1 so existing traces keep the scale-with-box behavior.
    await db.execute('ALTER TABLE traces ADD COLUMN text_scale_with_box INTEGER DEFAULT 1')
  } catch {
    // Column already exists — ignore
  }
  try {
    // Defaults to 1 so existing traces keep their shadow.
    await db.execute('ALTER TABLE traces ADD COLUMN show_shadow INTEGER DEFAULT 1')
  } catch {
    // Column already exists — ignore
  }

  await dropTraceTypeCheckConstraint(db)

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

// Removes the CHECK(type IN (...)) constraint from the traces table.
//
// SQLite can't alter a CHECK -- it's part of the table definition -- so the
// only way is to rebuild the table. Postgres has no equivalent constraint (it
// was dropped there at some point; a 'button' row is accepted today), so
// desktop was the only side that would reject a new trace type, and every
// future type would otherwise need another rebuild of a table holding the
// user's entire atrium.
//
// Written to be safe on real vaults:
//   - Runs only when the constraint is actually present, so it is a one-time
//     event and a no-op on every launch afterwards.
//   - Runs AFTER the additive ALTERs above, so every column the new table
//     names is guaranteed to exist on the old one.
//   - Names columns explicitly rather than INSERT ... SELECT *, because the
//     column order of a table built up through ALTERs doesn't match a freshly
//     created one, and a positional copy would silently shuffle values
//     between columns.
//   - Wrapped in a transaction, so an interruption leaves the original table
//     intact rather than half-copied.
async function dropTraceTypeCheckConstraint(db: Database): Promise<void> {
  try {
    const rows = await db.select<any[]>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'traces'"
    )
    const ddl: string = rows?.[0]?.sql ?? ''
    if (!/CHECK\s*\(\s*type\s+IN/i.test(ddl)) return

    const columnRows = await db.select<any[]>('PRAGMA table_info(traces)')
    const columns: string[] = columnRows.map(c => c.name)
    if (columns.length === 0) return
    const columnList = columns.join(', ')

    // The new definition, identical to the old one minus the CHECK. Built by
    // stripping it from the live DDL rather than restating the schema, so this
    // can't drift from whatever the table actually looks like.
    const newDdl = ddl.replace(
      /,?\s*CHECK\s*\(\s*type\s+IN\s*\([^)]*\)\s*\)/i,
      ''
    ).replace(/CREATE TABLE\s+"?traces"?/i, 'CREATE TABLE traces_rebuilt')

    await db.execute('BEGIN TRANSACTION')
    try {
      await db.execute(newDdl)
      await db.execute(`INSERT INTO traces_rebuilt (${columnList}) SELECT ${columnList} FROM traces`)
      await db.execute('DROP TABLE traces')
      await db.execute('ALTER TABLE traces_rebuilt RENAME TO traces')
      await db.execute('COMMIT')
    } catch (e) {
      await db.execute('ROLLBACK')
      throw e
    }
  } catch (e) {
    // Non-fatal: the vault still works, new trace types just won't insert.
    // Better than refusing to start the app over a constraint.
    console.error('Could not remove the traces type CHECK constraint:', e)
  }
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

        // Deleting a trace row left its file behind in the vault, so removing
        // traces freed nothing on disk and the folder grew with every deleted
        // image. Runs after the DELETE so the "is anything else still using
        // this?" check inside sees the rows that remain.
        if (opts.table === 'traces') void removeOrphanedTraceMedia(previousRows)

        // Deleting an atrium left its rows, its media and its vault mirror
        // behind -- see removeDeletedLobbyData.
        if (opts.table === 'lobbies') void removeDeletedLobbyData(previousRows)

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
      'text_bold', 'text_italic', 'text_underline', 'is_locked', 'is_clickable', 'illuminate',
      'light_pulse', 'enable_interaction', 'ignore_clicks', 'shape_outline_only', 'shape_no_fill',
      'flip_horizontal', 'flip_vertical', 'text_scale_with_box', 'show_shadow'],
    lobbies: ['is_public', 'autosave_enabled'],
    layers: ['is_group'],
    profiles: [],
    lobby_access_lists: [],
    lobby_locations: ['is_locked'],
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
      'text_bold', 'text_italic', 'text_underline', 'is_locked', 'is_clickable', 'illuminate',
      'light_pulse', 'enable_interaction', 'ignore_clicks', 'shape_outline_only', 'shape_no_fill',
      'flip_horizontal', 'flip_vertical', 'text_scale_with_box', 'show_shadow'],
    lobbies: ['is_public', 'autosave_enabled'],
    layers: ['is_group'],
    profiles: [],
    lobby_access_lists: [],
    lobby_locations: ['is_locked'],
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
            const segments = path.split('/').filter(Boolean)
            // Straight into the atrium's own folder -- there is no longer a
            // separate runtime copy to write first and mirror afterwards.
            filePath = await getAtriumMediaFilePath(bucket, segments)
              ?? await getResolvedRuntimeMediaFilePath(bucket, segments)
              ?? await joinPathSegments(mediaBasePath, [bucket, path])
          } else {
            filePath = await joinPathSegments(mediaBasePath, [bucket, ...path.split('/').filter(Boolean)])
          }

          // A Blob is streamed rather than read whole -- see writeBlobToFile.
          // Anything already in memory as bytes (a clipboard image, a
          // converted embed) is written in one go, because it is already the
          // thing streaming exists to avoid.
          if (fileData instanceof Blob || fileData instanceof File) {
            await writeBlobToFile(filePath, fileData)
          } else {
            await writeBinaryFile(filePath, fileData)
          }
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
        // Sum the approximate row size of all traces in this lobby...
        const rows = await db.select<any[]>(
          `SELECT SUM(LENGTH(CAST(id AS TEXT)) + LENGTH(COALESCE(content,'')) + LENGTH(COALESCE(image_url,'')) + LENGTH(COALESCE(media_url,'')) + LENGTH(COALESCE(shape_points,'')) + 200) as total_bytes FROM traces WHERE lobby_id = ?`,
          [params.p_lobby_id]
        )
        const rowBytes = rows[0]?.total_bytes || 0

        // ...plus the ACTUAL size of any local media file each trace points
        // at (image/audio/video uploads) -- media_url is just a short
        // local:// reference string, so the row-size sum above never
        // reflects real file size the way it does on web (where the
        // Postgres version of this function sums real Supabase Storage
        // object sizes). Desktop has no equivalent limit enforced
        // (isLobbyFull() is hardcoded false there), but the usage figure is
        // still shown to the user, so it should be real.
        const mediaRows = await db.select<any[]>(
          `SELECT media_url FROM traces WHERE lobby_id = ? AND media_url LIKE 'local://%'`,
          [params.p_lobby_id]
        )
        let mediaBytes = 0
        for (const row of mediaRows) {
          try {
            const filePath = await resolveLocalMediaFilePath(row.media_url)
            if (!filePath) continue
            mediaBytes += await invoke<number>('get_file_size', { path: filePath })
          } catch {
            // A trace whose underlying file is missing/unreadable just
            // doesn't contribute to the total -- not fatal to the estimate.
          }
        }

        return { data: rowBytes + mediaBytes, error: null }
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
// The same for asset-protocol URLs, which are cheap to build but still cost a
// vault path lookup each time.
const resolvedStreamUrlCache = new Map<string, string>()
// Track in-flight resolutions to avoid duplicate reads for the same URL
const pendingResolutions = new Map<string, Promise<string>>()

// Deletes the vault files belonging to traces that have just been removed.
//
// Deliberately checks whether anything else still points at each file before
// unlinking it: duplicating a trace copies its media_url, so two traces can
// share one file, and deleting either would otherwise break the other. The
// check runs against the table after the DELETE, so it sees exactly what
// survives.
//
// Never throws into the caller. A file that can't be removed is wasted disk,
// which is a far better outcome than a delete that appears to fail.
async function removeOrphanedTraceMedia(deletedRows: any[]): Promise<void> {
  if (!db || deletedRows.length === 0) return

  for (const row of deletedRows) {
    for (const url of [row?.media_url, row?.image_url]) {
      if (typeof url !== 'string' || !url.startsWith('local://')) continue
      try {
        const stillUsed = await db.select<any[]>(
          'SELECT 1 FROM traces WHERE media_url = ? OR image_url = ? LIMIT 1',
          [url, url],
        )
        if (stillUsed.length > 0) continue

        const filePath = await resolveLocalMediaFilePath(url)
        if (filePath) await removePath(filePath)

        // Drop the cached blob URL too, or the bytes stay in memory for a
        // file that no longer exists.
        const cachedUrl = resolvedUrlCache.get(url)
        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl)
          resolvedUrlCache.delete(url)
        }
      } catch {
        // Ignored on purpose -- see above.
      }
    }

    // Rendered PDF pages live in a folder named after the trace, so the whole
    // cache goes with the trace rather than being left behind page by page.
    if (row?.type === 'document' && row?.lobby_id && row?.id) {
      try {
        const pagesDir = await resolveLocalMediaFilePath(`local://traces/${row.lobby_id}/${row.id}_pages`)
        if (pagesDir) await removePath(pagesDir)
      } catch {
        // Ignored on purpose.
      }
    }
  }
}

// Everything a deleted atrium leaves behind.
//
// Deleting the lobbies row used to be the entire operation. Its traces, layers,
// locations and access lists stayed in the database; its media stayed in
// _runtime; and its vault mirror stayed on disk, offering to restore an atrium
// the user had deliberately thrown away. Nothing else was ever going to collect
// them -- the local schema declares no foreign keys, so SQLite has no cascade
// to run, and the media cleanup that follows a trace delete never fires because
// the trace rows are never deleted.
//
// Deliberately destructive, and the one place in the vault that is. Removing
// the mirror means a deleted atrium is genuinely gone rather than recoverable
// from Restore From Vault -- which is the point: a backup that survives the
// thing being deleted on purpose isn't a backup, it's a copy the user can't get
// rid of.
async function removeDeletedLobbyData(deletedRows: any[]): Promise<void> {
  if (!db || deletedRows.length === 0) return

  for (const row of deletedRows) {
    const lobbyId = typeof row?.id === 'string' ? row.id : null
    if (!lobbyId) continue

    // A mirror write already queued for this atrium would recreate the
    // directory removed below, moments after it goes.
    const pendingSync = pendingVaultSyncs.get(lobbyId)
    if (pendingSync !== undefined) {
      clearTimeout(pendingSync)
      pendingVaultSyncs.delete(lobbyId)
    }

    // The name is read from the deleted row rather than looked up: the lookup
    // reads the lobbies table, and by now the row is gone.
    const lobbyName = typeof row?.name === 'string' ? row.name : null

    for (const table of ['traces', 'layers', 'lobby_locations', 'lobby_access_lists']) {
      try {
        await db.execute(`DELETE FROM ${table} WHERE lobby_id = ?`, [lobbyId])
      } catch {
        // Best-effort, like the rest of this: the atrium is already gone from
        // the user's point of view, and throwing here would surface as the
        // delete itself having failed when it didn't.
      }
    }

    try {
      const mediaDir = await getRuntimeLobbyMediaDirectory('traces', lobbyId, lobbyName ?? undefined)
      if (await vaultPathExists(mediaDir)) await removePath(mediaDir)
    } catch {
      // Ignored on purpose -- see above.
    }

    if (lobbyName) {
      try {
        const mirrorDir = await getVaultLobbyDirectory(lobbyId, lobbyName)
        if (await vaultPathExists(mirrorDir)) await removePath(mirrorDir)
      } catch {
        // Ignored on purpose -- see above.
      }
    }

    // A rename that didn't reach the vault would leave the mirror under the old
    // folder name, which the path above would miss. The snapshots carry the
    // atrium id, so this catches those regardless of what the folder is called.
    try {
      const snapshotPaths = await invoke<string[]>('list_vault_atrium_mirrors')
      for (const snapshotPath of snapshotPaths) {
        try {
          const snapshot = JSON.parse(new TextDecoder().decode(await readBinaryFile(snapshotPath)))
          if (snapshot?.lobby?.id !== lobbyId) continue
          // list_vault_atrium_mirrors only ever returns <vault>/<dir>/atrium.json,
          // so the mirror directory is the path minus its last segment.
          const strayDir = snapshotPath.replace(/[\\/][^\\/]*$/, '')
          if (strayDir && strayDir !== snapshotPath && await vaultPathExists(strayDir)) {
            await removePath(strayDir)
          }
        } catch {
          // One unreadable mirror shouldn't stop the others being checked.
        }
      }
    } catch {
      // Ignored on purpose -- see above.
    }

    lobbyNameCache.delete(lobbyId)

    // Blob URLs for files that no longer exist would otherwise hold their bytes
    // in memory for the rest of the session.
    for (const [localUrl, objectUrl] of Array.from(resolvedUrlCache.entries())) {
      if (!localUrl.startsWith(`local://traces/${lobbyId}/`)) continue
      URL.revokeObjectURL(objectUrl)
      resolvedUrlCache.delete(localUrl)
    }
  }
}

export interface VaultMirror {
  snapshotPath: string
  lobbyId: string
  lobbyName: string
  traceCount: number
  layerCount: number
  syncedAt: string | null
  // True when no atrium with this id is in the database -- i.e. this mirror is
  // of something that has been lost, which is the case restoring exists for.
  missingFromDatabase: boolean
}

// Every atrium mirror in the vault, with whether the database still has it.
export async function listVaultMirrors(): Promise<VaultMirror[]> {
  if (!db) return []

  const paths = await invoke<string[]>('list_vault_atrium_mirrors')
  const mirrors: VaultMirror[] = []

  for (const snapshotPath of paths) {
    try {
      const bytes = await readBinaryFile(snapshotPath)
      const snapshot = JSON.parse(new TextDecoder().decode(bytes))
      const lobby = snapshot?.lobby
      if (!lobby?.id) continue

      const existing = await db.select<any[]>('SELECT id FROM lobbies WHERE id = ? LIMIT 1', [lobby.id])
      mirrors.push({
        snapshotPath,
        lobbyId: lobby.id,
        lobbyName: lobby.name ?? 'Atrium',
        traceCount: snapshot?.traces?.length ?? 0,
        layerCount: snapshot?.layers?.length ?? 0,
        syncedAt: snapshot?.syncedAt ?? null,
        missingFromDatabase: existing.length === 0,
      })
    } catch {
      // A mirror that can't be parsed is skipped rather than failing the list;
      // the others are still restorable.
    }
  }

  return mirrors.sort((a, b) => a.lobbyName.localeCompare(b.lobbyName))
}

export interface RestoreResult {
  lobbyName: string
  traces: number
  layers: number
  mediaFiles: number
  mediaMissing: number
  // The files that weren't there, by name. A count alone tells you something is
  // wrong without telling you what, which on a large atrium is the difference
  // between "go and find it" and "go and find it among four hundred traces".
  missingNames: string[]
}

// Rebuilds an atrium from its vault mirror.
//
// The mirror was previously a copy nothing could read back: the Import Atrium
// flow skips local:// media outright, and the mirror's layers carry raw ids
// rather than the _local_id fields the importer maps through -- so importing
// one gave you ungrouped text traces and no images. It looked like a backup
// without being one, which is the worst kind.
//
// Restoring keeps the original ids when the atrium is genuinely gone, so
// layer_id references and media paths line up exactly as they did. When the
// atrium still exists it restores as a copy with fresh ids instead, rather
// than overwriting something the user still has.
export async function restoreAtriumFromMirror(snapshotPath: string): Promise<RestoreResult> {
  if (!db) throw new Error('Local database not ready')

  const bytes = await readBinaryFile(snapshotPath)
  const snapshot = JSON.parse(new TextDecoder().decode(bytes))
  const lobby = snapshot?.lobby
  if (!lobby?.id) throw new Error('This mirror has no atrium in it')

  const existing = await db.select<any[]>('SELECT id FROM lobbies WHERE id = ? LIMIT 1', [lobby.id])
  const asCopy = existing.length > 0

  const lobbyId = asCopy ? uuid() : lobby.id
  const lobbyName = asCopy ? `${lobby.name ?? 'Atrium'} (restored)` : (lobby.name ?? 'Atrium')

  const lobbyRow = convertRowToSql('lobbies', {
    ...lobby,
    id: lobbyId,
    name: lobbyName,
    owner_user_id: LOCAL_USER_ID,
  })
  const lobbyColumns = Object.keys(lobbyRow)
  await db.execute(
    `INSERT OR REPLACE INTO lobbies (${lobbyColumns.join(', ')}) VALUES (${lobbyColumns.map(() => '?').join(', ')})`,
    lobbyColumns.map(c => lobbyRow[c]),
  )

  // Old layer id -> new, so traces can be repointed when restoring as a copy.
  const layerIdMap = new Map<string, string>()
  for (const layer of snapshot.layers ?? []) {
    const newId = asCopy ? uuid() : layer.id
    layerIdMap.set(layer.id, newId)
    const row = convertRowToSql('layers', { ...layer, id: newId, lobby_id: lobbyId, user_id: LOCAL_USER_ID })
    const columns = Object.keys(row)
    await db.execute(
      `INSERT OR REPLACE INTO layers (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map(c => row[c]),
    )
  }

  let mediaFiles = 0
  let mediaMissing = 0
  const missingNames: string[] = []

  // Copies a mirrored file back into the live media store and returns the
  // local:// URL pointing at it.
  const restoreAsset = async (localUrl: unknown, mirrorPath: unknown): Promise<string | null> => {
    if (typeof localUrl !== 'string' || !localUrl.startsWith('local://')) {
      return typeof localUrl === 'string' ? localUrl : null
    }
    const parsed = parseLocalUrl(localUrl)
    const fileName = parsed?.pathSegments[parsed.pathSegments.length - 1]
    if (!parsed || !fileName) return localUrl

    const restoredUrl = buildLobbyScopedLocalUrl(parsed.bucket, lobbyId, fileName)
    // The atrium's own folder is where media lives now, which is also where a
    // mirror's files already sit -- so for a restore in place, source and
    // destination are the same path and there is nothing to copy.
    const destination = await getAtriumMediaFilePath(parsed.bucket, [lobbyId, fileName], lobbyName)
      ?? await getResolvedRuntimeMediaFilePath(parsed.bucket, [lobbyId, fileName])
    if (!destination) return restoredUrl

    try {
      if (await vaultPathExists(destination)) {
        mediaFiles++
        return restoredUrl
      }
      if (typeof mirrorPath === 'string' && mirrorPath !== destination && await vaultPathExists(mirrorPath)) {
        await copyFileToPath(mirrorPath, destination)
        mediaFiles++
      } else {
        // The row is kept regardless: a trace with a missing file still holds
        // its position, size and grouping, and is far more useful than a gap.
        mediaMissing++
        missingNames.push(fileName)
      }
    } catch {
      mediaMissing++
      missingNames.push(fileName)
    }
    return restoredUrl
  }

  let traces = 0
  for (const trace of snapshot.traces ?? []) {
    // Mirror-only bookkeeping, not columns on the table.
    const { vault_media_path, vault_image_path, ...rest } = trace

    const mediaUrl = await restoreAsset(rest.media_url, vault_media_path)
    const imageUrl = await restoreAsset(rest.image_url, vault_image_path)

    const row = convertRowToSql('traces', {
      ...rest,
      id: asCopy ? uuid() : rest.id,
      lobby_id: lobbyId,
      user_id: LOCAL_USER_ID,
      media_url: mediaUrl,
      image_url: imageUrl,
      layer_id: rest.layer_id ? layerIdMap.get(rest.layer_id) ?? null : null,
    })
    const columns = Object.keys(row)
    await db.execute(
      `INSERT OR REPLACE INTO traces (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map(c => row[c]),
    )
    traces++
  }

  lobbyNameCache.set(lobbyId, lobbyName)
  resolvedUrlCache.clear()

  return { lobbyName, traces, layers: layerIdMap.size, mediaFiles, mediaMissing, missingNames }
}

// Raw bytes for a local:// URL, straight from disk.
//
// Exists because resolveLocalUrl hands back a blob: URL, and fetching one is
// a connect-src request -- which the desktop CSP doesn't allow blob: for
// (img-src and media-src do, which is why images and video were fine). That
// surfaced as a bare "Failed to fetch" when a PDF trace tried to read its own
// file. The CSP now permits it, but reading the file directly is better
// regardless: no blob round-trip, no dependency on a CSP directive for
// something that is just a local file read.
//
// Returns null when the file isn't there, so callers can tell "not written
// yet" apart from "unreadable" and retry.
export async function readLocalFileBytes(url: string): Promise<Uint8Array | null> {
  if (!url.startsWith('local://')) return null
  try {
    const filePath = await resolveLocalMediaFilePath(url)
    if (!filePath || !(await vaultPathExists(filePath))) return null
    return await readBinaryFile(filePath)
  } catch {
    return null
  }
}

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
        pdf: 'application/pdf',
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      // The cast rather than a copy. This built a second Uint8Array and
      // copied every byte into it, which for the paths still coming through
      // here -- a PDF being rendered, an atrium being exported -- meant
      // holding the file twice. The copy was only ever satisfying the type:
      // Uint8Array's buffer is ArrayBufferLike, which admits SharedArrayBuffer
      // and so is not a BlobPart. readBinaryFile never returns a shared
      // buffer, so this is a promise about provenance, not a change in
      // behaviour.
      const blob = new Blob([bytes as unknown as BlobPart], { type: mime })
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
 * A URL a <video> or <audio> can stream from, without reading the file first.
 *
 * resolveLocalUrl below reads the whole file over IPC, copies it again into a
 * Uint8Array, and wraps that in a Blob -- roughly three times the file in
 * memory, and nothing plays until every byte has arrived. For a photo that is
 * a hiccup. For a folder of videos it is the reason opening the atrium takes
 * so long: each one is read end to end before it can be shown, when all that
 * was wanted was the first frame.
 *
 * Tauri's asset protocol hands the webview a URL it can fetch itself, so the
 * player streams -- it reads what it needs, when it needs it, and honours
 * range requests, which is also what makes seeking work rather than
 * re-downloading. The vault directory is added to the protocol's scope at
 * startup (see main.rs); anything outside it is refused, so this is not a
 * general file-reading capability.
 *
 * Deliberately separate from resolveLocalUrl rather than replacing it. That
 * one's blob: URL is what the database export embeds and what PDF rendering
 * reads bytes back out of, and an asset: URL is neither of those things --
 * it means nothing on another machine, and connect-src does not allow
 * fetching it.
 */
export async function resolveLocalStreamUrl(url: string): Promise<string> {
  if (!url.startsWith('local://')) return url

  const cached = resolvedStreamUrlCache.get(url)
  if (cached) return cached

  try {
    const filePath = await resolveLocalMediaFilePath(url)
    if (!filePath) return url

    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const streamUrl = convertFileSrc(filePath)
    resolvedStreamUrlCache.set(url, streamUrl)
    return streamUrl
  } catch {
    // A machine where the asset protocol is unavailable still gets its video,
    // just the slow way.
    return resolveLocalUrl(url)
  }
}

/**
 * Pre-seed the resolved URL cache so freshly uploaded files render instantly
 * without a redundant disk read.
 */
export function preCacheLocalUrl(localUrl: string, blobUrl: string) {
  resolvedUrlCache.set(localUrl, blobUrl)
}

// The same, for the cache the video and audio resolver actually reads.
//
// preCacheLocalUrl seeds resolvedUrlCache, but resolveLocalStreamUrl consults
// resolvedStreamUrlCache and nothing else -- so a freshly imported video never
// saw the pre-seeded blob at all. It got an asset URL for a file that was still
// being written, and played only once the write happened to catch up.
//
// Seeding this one instead means the trace plays from the file the user
// dropped, which is complete and sitting still, from the moment it appears.
export function preCacheLocalStreamUrl(localUrl: string, blobUrl: string) {
  resolvedStreamUrlCache.set(localUrl, blobUrl)
}

// Re-resolve a local:// URL, ignoring what is already cached for it.
//
// An import caches a blob URL for the dropped file so the trace can appear
// before anything has been written. Once the vault copy lands, that blob is no
// longer the best answer: the file on disk is, and it can be streamed by the
// browser instead of held as an object URL over the original.
//
// The old blob URL is deliberately NOT revoked. Something may still be reading
// through it -- a video part-way through buffering, most obviously -- and
// pulling it out from under a playing element is worse than leaving a handle
// to a file that is already on disk.
export async function refreshLocalUrl(localUrl: string): Promise<string> {
  resolvedUrlCache.delete(localUrl)
  // Both caches, or the blob seeded at import would be handed back forever and
  // the vault copy -- the whole point of writing one -- would never be read.
  resolvedStreamUrlCache.delete(localUrl)
  return resolveLocalStreamUrl(localUrl)
}

// ---- Export helper to check if running in Tauri ----

export function isTauri(): boolean {
  return !!(window as any).__TAURI_INTERNALS__
}

export { LOCAL_USER_ID, LOCAL_USERNAME }
