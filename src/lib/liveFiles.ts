// Live files (desktop): a spreadsheet's traces, and a deck's, follow the file
// they came from. Saved again in Excel, PowerPoint or LibreOffice, it's read
// again, and each sheet, chart and deck trace shows what its part of the file
// says now.
//
// Where the file is comes from the webview (main.rs listen_for_dropped_paths):
// a dropped or picked File knows its path only there. When it was last saved
// is asked every couple of seconds, for the files of traces in the atrium
// open -- the file itself is read only when that changes.
//
// A trace's own file (its media_url) is written over with the new reading, so
// nothing about the trace changes but what it shows -- no undo step, nothing
// to save -- unless a sheet's grid grew or shrank, when its box does too.
//
// Following stops for good: turned off in the panel, or to edit the sheet
// here (TraceOverlay asks first). Then it's its own copy, and the file can be
// anything. Which traces follow which file is kept on this computer, as the
// path only means anything here.

import { invoke } from '@tauri-apps/api/core'
import { supabase, isDesktop } from './supabase'
import { useGameStore } from '../store/gameStore'
import { readSpreadsheet, type ReadSpreadsheet } from './spreadsheet'
import { keepSheetFile, sheetFile, sheetSize } from './sheetDraw'
import { deckFile, keepDeckFile } from './deckDraw'
import { deckPictures, readDeck } from './deck'
import { uploadTraceFile } from './traceUpload'
import { currentLanguage } from './i18n'

// A trace's part of the file: its sheet, or its chart, by its place among
// them -- or the whole deck.
export interface Following { path: string; kind: 'sheet' | 'chart' | 'deck'; index: number; modified: number }

const KEY = 'atrium.liveFiles'
const EVERY_MS = 2000

let following: Record<string, Following> = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { return {} }
})()
const watchers = new Set<() => void>()
const changed = (next: Record<string, Following>) => {
  following = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* kept for this session */ }
  for (const fn of watchers) fn()
}

export const followed = () => following
export const watchFollowing = (fn: () => void) => { watchers.add(fn); return () => { watchers.delete(fn) } }
export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

// Where each of `files` is on disk -- null for any the webview won't say,
// and for all of them off the desktop app.
export async function filePaths(files: File[]): Promise<(string | null)[]> {
  const none = files.map(() => null)
  const webview = (window as any).chrome?.webview
  if (!isDesktop || files.length === 0 || typeof webview?.postMessageWithAdditionalObjects !== 'function') return none
  const { listen } = await import('@tauri-apps/api/event')
  const id = crypto.randomUUID()
  return new Promise(resolve => {
    let done = false
    let stop: (() => void) | undefined
    const finish = (paths: (string | null)[] | null) => {
      if (done) return
      done = true
      stop?.()
      window.clearTimeout(timer)
      resolve(paths ? files.map((_, i) => paths[i] ?? null) : none)
    }
    const timer = window.setTimeout(() => finish(null), 3000)
    void listen<{ id: string; paths: (string | null)[] }>('atrium-dropped-paths', e => {
      if (e.payload.id === id) finish(e.payload.paths)
    }).then(unlisten => {
      if (done) { unlisten(); return }
      stop = unlisten
      try { webview.postMessageWithAdditionalObjects(`atrium-dropped-paths:${id}`, files) } catch { finish(null) }
    }, () => finish(null))
  })
}

// The traces made from the file at `path` follow it from now on.
export async function followFile(path: string, traces: { id: string; kind: Following['kind']; index: number }[]) {
  const modified = await invoke<number>('file_modified', { path }).catch(() => 0)
  const next = { ...following }
  for (const t of traces) next[t.id] = { path, kind: t.kind, index: t.index, modified }
  changed(next)
}

export function stopFollowing(traceId: string) {
  if (!following[traceId]) return
  const { [traceId]: _, ...rest } = following
  changed(rest)
}

// Watches the files of the traces in the atrium open; stops when called.
export function followFiles(): () => void {
  if (!isDesktop) return () => {}
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const traces = useGameStore.getState().traces
      const byPath = new Map<string, string[]>()
      for (const t of traces) {
        const f = following[t.id]
        if (f) byPath.set(f.path, [...(byPath.get(f.path) ?? []), t.id])
      }
      for (const [path, ids] of byPath) {
        // Gone, or moved: the traces stay as they are, and it's asked again.
        const modified = await invoke<number>('file_modified', { path }).catch(() => null)
        if (modified === null || ids.every(id => following[id]?.modified === modified)) continue
        // Unreadable mid-save: the next tick reads it again.
        if (await refresh(path, ids).catch(e => { console.warn('[live] could not read', path, e); return false })) {
          const next = { ...following }
          for (const id of ids) if (next[id]) next[id] = { ...next[id], modified }
          changed(next)
        }
      }
    } finally {
      busy = false
    }
  }
  void tick()
  const timer = window.setInterval(() => void tick(), EVERY_MS)
  return () => window.clearInterval(timer)
}

// The file at `path` read again, into the traces `ids`.
async function refresh(path: string, ids: string[]): Promise<boolean> {
  const { readBinaryFile } = await import('./localDb')
  const file = new File([(await readBinaryFile(path)) as Uint8Array<ArrayBuffer>], fileName(path))
  let spreadsheet: Promise<ReadSpreadsheet> | undefined
  const store = useGameStore.getState()
  const write = async (url: string, data: unknown, lobbyId?: string) => {
    const { error } = await supabase!.storage.from('traces').upload(url.slice('local://traces/'.length), new Blob([JSON.stringify(data)], { type: 'application/json' }))
    if (error) throw new Error(error.message)
    window.dispatchEvent(new CustomEvent('atrium:vault-write-complete', { detail: { localUrl: url, lobbyId } }))
  }
  for (const id of ids) {
    const trace = store.traces.find(t => t.id === id)
    const f = following[id]
    const url = trace?.mediaUrl
    if (!trace || !f || !url?.startsWith('local://traces/')) continue
    if (f.kind === 'deck') {
      // Its pictures kept again only where they changed.
      const kept = deckPictures(await deckFile(url))
      const deck = await readDeck(file, (picture, hash) => kept.get(hash) ? Promise.resolve(kept.get(hash)!) : uploadTraceFile(picture, trace.lobbyId ?? '', store.userId ?? ''))
      keepDeckFile(url, deck)
      await write(url, deck, trace.lobbyId)
      continue
    }
    spreadsheet ??= readSpreadsheet(file, currentLanguage())
    const { sheets, charts } = await spreadsheet
    const part = f.kind === 'sheet' ? sheets[f.index] : charts[f.index]
    if (!part) continue
    const before = await sheetFile(url)
    keepSheetFile(url, part)
    await write(url, part, trace.lobbyId)
    // A sheet that grew or shrank: its box with it, stretched as it was.
    if (part.kind === 'sheet' && before?.kind === 'sheet') {
      const was = sheetSize(before), now = sheetSize(part)
      if (was.width && was.height && (was.width !== now.width || was.height !== now.height)) {
        store.addTrace({ ...trace, width: (trace.width ?? was.width) * now.width / was.width, height: (trace.height ?? was.height) * now.height / was.height })
        store.markTraceChanged(id)
      }
    }
  }
  return true
}
