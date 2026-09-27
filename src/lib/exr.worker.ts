/// <reference lib="webworker" />

// Turns a dropped EXR into a PNG off the thread that draws the atrium -- see
// exrFileToPng in exr.ts, which starts this and falls back to doing the same
// work itself if this can't run.

import { exrToPngBlob } from './exr'

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = async (event: MessageEvent<{ file: Blob; fileName: string }>) => {
  try {
    ctx.postMessage({ png: await exrToPngBlob(event.data.file, event.data.fileName) })
  } catch (error) {
    ctx.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
