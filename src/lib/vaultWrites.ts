// Files being written into the desktop vault, by their local:// address: how
// far along each one is, and when it's done.
//
// A dropped file appears at once, shown from the dropped file itself, while
// its copy is written into the vault in the background (traceUpload). Anything
// reading the vault copy meanwhile read whatever had landed so far: a PDF half
// written is "Invalid PDF structure", and stayed an error though the file was
// fine. So a read of a file still being written waits for it
// (readLocalFileBytes), and a broken file is only ever a whole one that is;
// and a trace whose file is being written shows how far (VaultWriteBar).
// Import-free, for the tests.

interface Write { done: Promise<void>; fraction: number }
const writes = new Map<string, Write>()
const watchers = new Set<() => void>()
const tell = () => watchers.forEach(fn => fn())

// A write started for `url`, finished (or failed) when `done` settles.
export function trackVaultWrite(url: string, done: Promise<unknown>) {
  const write: Write = { done: done.then(() => {}, () => {}), fraction: 0 }
  writes.set(url, write)
  tell()
  void write.done.then(() => {
    if (writes.get(url) === write) writes.delete(url)
    tell()
  })
}

// How far along `url`'s write is, 0-1. Told only as it moves by a percent or
// more: a long video is hundreds of chunks.
export function setVaultWriteProgress(url: string, fraction: number) {
  const write = writes.get(url)
  if (!write || fraction - write.fraction < 0.01) return
  write.fraction = Math.min(1, fraction)
  tell()
}

// When `url`'s file is whole on disk: now, if nothing is writing it.
export const vaultWriteDone = (url: string): Promise<void> => writes.get(url)?.done ?? Promise.resolve()

// How far along `url`'s write is, or null when nothing is writing it.
export function vaultWriteProgress(url: string | null | undefined): number | null {
  const write = url ? writes.get(url) : undefined
  return write ? write.fraction : null
}

export function watchVaultWrites(fn: () => void): () => void {
  watchers.add(fn)
  return () => { watchers.delete(fn) }
}
