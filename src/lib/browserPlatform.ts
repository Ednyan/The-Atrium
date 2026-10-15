// The desktop app's ground, in a browser (lib/localPlatform): what localDb
// stands on there -- its SQL database and the 20 native commands it calls --
// answered from this browser's private file system, through one worker
// (browserVault.worker). Same arguments, same results: localDb runs on it
// unchanged, vault folders, mirrors and media included.
//
// One tab at a time holds it (the worker's SQLite takes its files
// exclusively); another gets VAULT_IN_USE, as a desktop vault open twice does.

const VAULT = '/vault'

let worker: Worker | null = null
let next = 0
const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

function call<T>(op: string, args: Record<string, unknown> = {}, transfer: Transferable[] = []): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./browserVault.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const settle = waiting.get(data.id)
      waiting.delete(data.id)
      if (data.ok) settle?.resolve(data.value)
      else settle?.reject(new Error(data.error))
    }
  }
  const id = ++next
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker!.postMessage({ id, op, ...args }, transfer)
  })
}

// Held for as long as the tab lives; null when another tab has it.
let owned: Promise<boolean> | null = null
function own(): Promise<boolean> {
  if (!navigator.locks) return Promise.resolve(true)
  return owned ??= new Promise<boolean>(resolve => {
    void navigator.locks.request('atrium-browser-vault', { ifAvailable: true }, lock => {
      resolve(!!lock)
      return lock ? new Promise<void>(() => {}) : undefined
    })
  })
}

/** localDb's database, as the desktop's SQL plugin hands it over. */
export class BrowserDatabase {
  static async load(_path: string): Promise<BrowserDatabase> {
    if (!(await own())) throw new Error('VAULT_IN_USE')
    await call('open')
    return new BrowserDatabase()
  }
  execute(sql: string, params?: unknown[]) { return call<{ rowsAffected: number; lastInsertId: number }>('execute', { sql, params }) }
  select<T>(sql: string, params?: unknown[]) { return call<T>('select', { sql, params }) }
  close() { return Promise.resolve(true) }
}

// A binary command's body: a 4-byte length, a path (or stream token), the bytes.
function unpack(payload: Uint8Array): { head: string; bytes: Uint8Array } {
  const length = new DataView(payload.buffer, payload.byteOffset).getUint32(0, false)
  return { head: new TextDecoder().decode(payload.subarray(4, 4 + length)), bytes: payload.slice(4 + length) }
}
function written(args: any): { path: string; bytes: Uint8Array } {
  if (args instanceof Uint8Array) { const { head, bytes } = unpack(args); return { path: head, bytes } }
  return { path: args.path, bytes: Uint8Array.from(args.bytes ?? []) }
}

/** localDb's native commands. */
export async function invoke<T>(command: string, args: any = {}): Promise<T> {
  const answer = async (): Promise<unknown> => {
    switch (command) {
      case 'prepare_live_database': return `${VAULT}/_runtime/atrium.db`
      case 'get_or_create_device_id': {
        let device = ''
        try { device = localStorage.getItem('atrium.browser.device') ?? '' } catch { /* none */ }
        if (!device) {
          device = args.proposed
          try { localStorage.setItem('atrium.browser.device', device) } catch { /* this visit only */ }
        }
        return { device_id: device, os_user: '' }
      }
      case 'get_vault_base_path':
      case 'set_vault_base_path': return VAULT
      case 'consolidate_runtime_media': return 'nothing to migrate'
      case 'vault_path_exists': return call('exists', { path: args.path })
      case 'write_vault_text_file': return call('write', { path: args.path, bytes: new TextEncoder().encode(args.contents) })
      case 'write_binary_file': { const { path, bytes } = written(args); return call('write', { path, bytes }, [bytes.buffer]) }
      case 'append_binary_file': { const { path, bytes } = written(args); return call('write', { path, bytes, append: true }, [bytes.buffer]) }
      case 'open_binary_stream': return call('openStream', { path: args.path })
      case 'append_binary_stream': { const { head, bytes } = unpack(args); return call('appendStream', { token: head, bytes }, [bytes.buffer]) }
      case 'close_binary_stream': return call('closeStream', { token: args.token })
      case 'read_binary_file': return call('read', { path: args.path })
      case 'copy_file_to_path': return call('copy', { from: args.sourcePath, to: args.destinationPath })
      case 'move_path': return call('move', { from: args.sourcePath, to: args.destinationPath })
      case 'rename_path': return call('move', { from: args.oldPath, to: args.newPath })
      case 'remove_path': return call('remove', { path: args.path })
      case 'get_file_size':
      case 'get_dir_size': return call('size', { path: args.path })
      case 'list_vault_atrium_mirrors': return call('mirrors', { vault: VAULT })
      default: throw new Error(`not in the browser: ${command}`)
    }
  }
  return answer() as Promise<T>
}

export const appDataDir = async () => '/app'
export const join = async (...parts: string[]) => '/' + parts.flatMap(part => part.split(/[\\/]+/)).filter(Boolean).join('/')
export const mkdir = async (path: string, _options?: unknown) => { await call('mkdir', { path }) }
export const exists = (path: string) => call<boolean>('exists', { path })

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', pdf: 'application/pdf',
}
/** A file to show: what convertFileSrc is on the desktop. */
export async function fileUrl(path: string): Promise<string> {
  const bytes = await call<Uint8Array>('read', { path })
  const type = TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
}
