/// <reference lib="webworker" />

// Reads a file's bytes off the thread that draws the atrium.
//
// A dropped file exists only as a browser-owned handle, and the one way to get
// at its bytes is slice().arrayBuffer() -- which, on the main thread, is the
// same thread rendering the canvas. That read is what made a large import
// stutter: not the copy (Rust and the OS do that on their own threads), but
// the fetching of the bytes to hand over.
//
// A worker has its own thread, and a Blob can be handed to one. So the reading
// happens here, and each chunk is TRANSFERRED back rather than copied -- the
// buffer changes owner instead of being duplicated. The main thread is left
// with nothing to do but pass it to Rust.
//
// Chunks are handed out on credit rather than as fast as they can be read. Two
// outstanding at a time is enough that this thread is reading the next chunk
// while the main thread is still sending the current one -- which is the whole
// point -- without letting an unbounded amount of a 500MB file pile up in
// memory waiting to be sent.

const ctx = self as unknown as DedicatedWorkerGlobalScope

let blob: Blob | null = null
let chunkSize = 0
let offset = 0
let credits = 0
let pumping = false

async function pump(): Promise<void> {
  // Re-entrant guard: a 'more' can arrive while this loop is awaiting a read.
  // It only needs to add a credit -- the loop below re-checks on every pass
  // and will pick it up without a second pump running alongside.
  if (pumping) return
  pumping = true
  try {
    while (blob && offset < blob.size && credits > 0) {
      credits--
      const end = Math.min(offset + chunkSize, blob.size)
      const buffer = await blob.slice(offset, end).arrayBuffer()
      offset = end
      ctx.postMessage({ type: 'chunk', buffer, last: offset >= blob.size }, [buffer])
    }
  } catch (error) {
    ctx.postMessage({ type: 'error', message: (error as Error)?.message ?? String(error) })
  } finally {
    pumping = false
  }
}

ctx.onmessage = (event: MessageEvent) => {
  const message = event.data
  if (message?.type === 'start') {
    blob = message.blob as Blob
    chunkSize = message.chunkSize as number
    offset = 0
    credits = 2
    void pump()
    return
  }
  if (message?.type === 'more') {
    credits++
    void pump()
  }
}

export {}
