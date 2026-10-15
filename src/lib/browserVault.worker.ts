// The browser's vault (lib/browserPlatform): the desktop app's local database
// and its files, kept in this browser's private file system (OPFS) -- SQLite
// compiled to WebAssembly, on its "SAH pool" VFS, which needs no special
// headers (the ones the other OPFS VFS needs would break every embed). Both
// live here, in a worker: synchronous file access is a worker's alone.
//
// The pool takes its files exclusively: one tab at a time (Web Locks, on the
// page's side, decides which).

import sqlite3InitModule from '@sqlite.org/sqlite-wasm'

type Request = { id: number; op: string; [key: string]: any }

let database: any = null
const streams = new Map<string, { handle: any; at: number }>()

async function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

const partsOf = (path: string) => path.split(/[\\/]+/).filter(Boolean)

async function directory(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await root()
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create })
  return dir
}

async function fileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
  const parts = partsOf(path)
  const name = parts.pop()
  if (!name) throw new Error(`not a file: ${path}`)
  return (await directory(parts, create)).getFileHandle(name, { create })
}

// What's at a path: a file, a folder, or nothing.
async function entry(path: string): Promise<FileSystemHandle | null> {
  const parts = partsOf(path)
  const name = parts.pop()
  if (!name) return root()
  try {
    const dir = await directory(parts, false)
    try { return await dir.getFileHandle(name) } catch { return await dir.getDirectoryHandle(name) }
  } catch {
    return null
  }
}

async function writeFile(path: string, bytes: Uint8Array, append = false) {
  const handle: any = await (await fileHandle(path, true)).createSyncAccessHandle()
  try {
    if (!append) handle.truncate(0)
    handle.write(bytes, { at: append ? handle.getSize() : 0 })
    handle.flush()
  } finally {
    handle.close()
  }
}

async function readFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await (await (await fileHandle(path, false)).getFile()).arrayBuffer())
}

async function remove(path: string) {
  const parts = partsOf(path)
  const name = parts.pop()
  if (!name) return
  try { await (await directory(parts, false)).removeEntry(name, { recursive: true }) } catch { /* not there */ }
}

async function copy(from: string, to: string) {
  const what = await entry(from)
  if (!what) throw new Error(`not found: ${from}`)
  if (what.kind === 'file') { await writeFile(to, await readFile(from)); return }
  await directory(partsOf(to), true)
  for await (const name of (what as any).keys()) await copy(`${from}/${name}`, `${to}/${name}`)
}

async function size(path: string): Promise<number> {
  const what = await entry(path)
  if (!what) return 0
  if (what.kind === 'file') return (await (what as FileSystemFileHandle).getFile()).size
  let total = 0
  for await (const name of (what as any).keys()) total += await size(`${path}/${name}`)
  return total
}

// Every <vault>/<atrium folder>/atrium.json -- as list_vault_atrium_mirrors.
async function mirrors(vault: string): Promise<string[]> {
  const found: string[] = []
  const base = await entry(vault)
  if (!base || base.kind !== 'directory') return found
  for await (const [name, handle] of (base as any).entries()) {
    if (handle.kind !== 'directory') continue
    try { await handle.getFileHandle('atrium.json'); found.push(`${vault}/${name}/atrium.json`) } catch { /* no mirror */ }
  }
  return found
}

// Bound as the desktop's SQL plugin binds them: JSON for objects, NULL for
// undefined.
const bindable = (params: unknown[] | undefined) => (params ?? []).map(value =>
  value === undefined ? null
    : typeof value === 'boolean' ? (value ? 1 : 0)
    : value instanceof Uint8Array || value === null || typeof value !== 'object' ? value
    : JSON.stringify(value))

async function handle(request: Request): Promise<unknown> {
  switch (request.op) {
    case 'open': {
      if (database) return true
      // What the engine needs that a browser can refuse -- WebAssembly (a site
      // policy, Safari's Lockdown Mode) or its private files (a private
      // window) -- said as one thing the page can explain.
      let pool: any
      try {
        const sqlite3: any = await sqlite3InitModule()
        pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'atrium-vault', directory: '/.atrium-db' })
      } catch (error) {
        console.error('[browser vault] refused:', error)
        throw new Error('VAULT_UNSUPPORTED')
      }
      database = new pool.OpfsSAHPoolDb('/atrium.db')
      return true
    }
    case 'select':
      return database.exec({ sql: request.sql, bind: bindable(request.params), rowMode: 'object', returnValue: 'resultRows' })
    case 'execute': {
      database.exec({ sql: request.sql, bind: bindable(request.params) })
      return { rowsAffected: database.changes(), lastInsertId: Number(database.selectValue('SELECT last_insert_rowid()')) }
    }
    case 'write': return writeFile(request.path, request.bytes, !!request.append)
    case 'read': return readFile(request.path)
    case 'exists': return !!(await entry(request.path))
    case 'mkdir': await directory(partsOf(request.path), true); return null
    case 'remove': return remove(request.path)
    case 'copy': return copy(request.from, request.to)
    case 'move': await copy(request.from, request.to); return remove(request.from)
    case 'size': return size(request.path)
    case 'mirrors': return mirrors(request.vault)
    case 'openStream': {
      const handle: any = await (await fileHandle(request.path, true)).createSyncAccessHandle()
      handle.truncate(0)
      const token = crypto.randomUUID()
      streams.set(token, { handle, at: 0 })
      return token
    }
    case 'appendStream': {
      const stream = streams.get(request.token)
      if (!stream) throw new Error('no such stream')
      stream.at += stream.handle.write(request.bytes, { at: stream.at })
      return null
    }
    case 'closeStream': {
      const stream = streams.get(request.token)
      streams.delete(request.token)
      if (stream) { stream.handle.flush(); stream.handle.close() }
      return null
    }
    default:
      throw new Error(`unknown op ${request.op}`)
  }
}

const page = self as unknown as Worker
page.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data
  try {
    const value = await handle(request)
    const transfer = value instanceof Uint8Array ? [value.buffer] : []
    page.postMessage({ id: request.id, ok: true, value }, transfer as Transferable[])
  } catch (error) {
    page.postMessage({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
