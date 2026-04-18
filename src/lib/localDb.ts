// Local database adapter that mimics the Supabase client API
// so all existing components work without changes.
// Uses Tauri SQL plugin (SQLite) for persistence.

import Database from '@tauri-apps/plugin-sql'
import { appDataDir, join } from '@tauri-apps/api/path'
import { mkdir, exists, writeFile, readFile } from '@tauri-apps/plugin-fs'

let db: Database | null = null
let mediaBasePath: string = ''

const LOCAL_USER_ID = 'local-user'
const LOCAL_USERNAME = 'Local User'

// ---- Initialization ----

export async function initLocalDb(): Promise<void> {
  db = await Database.load('sqlite:atrium.db')

  // Get app data directory for media files
  const appData = await appDataDir()
  mediaBasePath = await join(appData, 'media')
  const mediaExists = await exists(mediaBasePath)
  if (!mediaExists) {
    await mkdir(mediaBasePath, { recursive: true })
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
      theme_settings TEXT
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
      rotation REAL DEFAULT 0.0,
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
      user_id TEXT NOT NULL
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS lobby_access_lists (
      id TEXT PRIMARY KEY,
      lobby_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      list_type TEXT NOT NULL CHECK(list_type IN ('whitelist','blacklist')),
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

  // Ensure local user profile exists
  const profileRows = await db.select<any[]>('SELECT id FROM profiles WHERE id = ?', [LOCAL_USER_ID])
  if (profileRows.length === 0) {
    await db.execute(
      'INSERT INTO profiles (id, username, email, display_name, player_color) VALUES (?, ?, ?, ?, ?)',
      [LOCAL_USER_ID, LOCAL_USERNAME, 'local@desktop', 'Local User', '#ffffff']
    )
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
        const row = opts.data
        if (!row.id) row.id = uuid()
        if (!row.created_at) row.created_at = new Date().toISOString()

        // Serialize JSON fields
        const prepared = convertRowToSql(opts.table, row)

        const columns = Object.keys(prepared)
        const placeholders = columns.map(() => '?').join(', ')
        const values = columns.map(c => prepared[c])

        const sql = `INSERT OR REPLACE INTO ${opts.table} (${columns.join(', ')}) VALUES (${placeholders})`
        await db!.execute(sql, values)

        if (opts.selectColumns) {
          const inserted = await db!.select<any[]>(`SELECT * FROM ${opts.table} WHERE id = ?`, [row.id])
          const mapped = inserted.map(r => convertRowFromSql(opts.table, r))
          if (opts.isSingle) return { data: mapped[0] || null, error: null }
          return { data: mapped, error: null }
        }
        return { data: row, error: null }
      }

      case 'update': {
        const updates = opts.data
        const prepared = convertRowToSql(opts.table, updates)
        const setClauses = Object.keys(prepared).map(k => `${k} = ?`).join(', ')
        const setValues = Object.values(prepared)
        const params: any[] = [...setValues]

        let sql = `UPDATE ${opts.table} SET ${setClauses}`
        const whereClauses = buildWhereClauses(opts.filters, params)
        if (whereClauses) sql += ` WHERE ${whereClauses}`

        await db!.execute(sql, params)

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
        const params: any[] = []
        let sql = `DELETE FROM ${opts.table}`
        const whereClauses = buildWhereClauses(opts.filters, params)
        if (whereClauses) sql += ` WHERE ${whereClauses}`
        await db!.execute(sql, params)
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
      'light_pulse', 'enable_interaction', 'ignore_clicks', 'shape_outline_only', 'shape_no_fill'],
    lobbies: ['is_public'],
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
      'light_pulse', 'enable_interaction', 'ignore_clicks', 'shape_outline_only', 'shape_no_fill'],
    lobbies: ['is_public'],
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

  return out
}

// ---- Local file storage (replaces Supabase Storage) ----

class LocalStorage {
  from(bucket: string) {
    return {
      async upload(path: string, fileData: Blob | File | Uint8Array, _options?: { contentType?: string }): Promise<{ data: any; error: any }> {
        try {
          const dir = await join(mediaBasePath, bucket)
          const dirExists = await exists(dir)
          if (!dirExists) {
            await mkdir(dir, { recursive: true })
          }

          const filePath = await join(dir, path)

          // Ensure subdirectories exist
          const lastSlash = path.lastIndexOf('/')
          if (lastSlash > 0) {
            const subDir = await join(dir, path.substring(0, lastSlash))
            const subDirExists = await exists(subDir)
            if (!subDirExists) {
              await mkdir(subDir, { recursive: true })
            }
          }

          let bytes: Uint8Array
          if (fileData instanceof Blob || fileData instanceof File) {
            const buffer = await fileData.arrayBuffer()
            bytes = new Uint8Array(buffer)
          } else {
            bytes = fileData
          }

          await writeFile(filePath, bytes)
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

  const relativePath = url.replace('local://', '')
  const filePath = await join(mediaBasePath, relativePath)

  try {
    // Use Tauri's asset protocol for instant loading (no file read into JS memory)
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const assetUrl = convertFileSrc(filePath)
    resolvedUrlCache.set(url, assetUrl)
    return assetUrl
  } catch {
    // Fallback: read file and create blob URL
    const pending = pendingResolutions.get(url)
    if (pending) return pending

    const promise = (async () => {
      try {
        const bytes = await readFile(filePath)
        const ext = filePath.split('.').pop()?.toLowerCase() || ''
        const mimeMap: Record<string, string> = {
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
          gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
          mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
          mp4: 'video/mp4', webm: 'video/webm',
        }
        const mime = mimeMap[ext] || 'application/octet-stream'
        const blob = new Blob([bytes], { type: mime })
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
