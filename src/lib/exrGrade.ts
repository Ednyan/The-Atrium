// An EXR trace shown again in another look (lib/exr gradeExr): its original
// file graded to a PNG, full size to keep, or small to preview while a
// control is moved.
//
// In a worker (exr.worker.ts) that keeps the file last graded decoded, so
// only the first change waits on decoding it. The worker goes once nothing
// has been asked of it for a while: a decoded 4K render is over 100 MB.

import { fetchMedia } from './exportImage'
import type { ExrLook, ExrLut } from './exr'

type Reply = { id: number; image?: Blob; need?: 'source'; error?: string }

let worker: Worker | null = null
let nextId = 0
const waiting = new Map<number, (reply: Reply) => void>()
let idle = 0
const IDLE_MS = 30000

export class ExrSourceMissing extends Error {}

function start(): Worker {
  if (worker) return worker
  const made = new Worker(new URL('./exr.worker.ts', import.meta.url), { type: 'module' })
  made.onmessage = (event: MessageEvent<Reply>) => {
    waiting.get(event.data.id)?.(event.data)
    waiting.delete(event.data.id)
  }
  made.onerror = event => {
    event.preventDefault()
    for (const [id, answer] of waiting) answer({ id, error: 'the grading worker stopped' })
    waiting.clear()
    worker = null
  }
  return (worker = made)
}

const ask = (message: Record<string, unknown>) => new Promise<Reply>(resolve => {
  const id = ++nextId
  waiting.set(id, resolve)
  start().postMessage({ ...message, kind: 'grade', id })
})

// LUT files, read once each.
const luts = new Map<string, Promise<string>>()
const lutText = (url: string) => {
  let text = luts.get(url)
  if (!text) {
    text = fetchMedia(url).then(blob => {
      if (!blob) throw new Error('LUT file missing')
      return blob.text()
    })
    luts.set(url, text)
    text.catch(() => luts.delete(url))
  }
  return text
}

// A LUT just loaded here: known by its text, not read back from where it went.
export const rememberLut = (url: string, text: string) => { luts.set(url, Promise.resolve(text)) }

// `source` graded with `look` (and `lut`, a file's or one of ours): a PNG. No
// bigger than `maxSide` across when one is given. ExrSourceMissing when the
// original can't be read.
export async function gradeExrSource(source: string, look: ExrLook, chosen?: ExrLut, maxSide?: number): Promise<Blob> {
  window.clearTimeout(idle)
  try {
    const lut = !chosen ? null : 'preset' in chosen ? { preset: chosen.preset } : { text: await lutText(chosen.url) }
    let reply = await ask({ key: source, look, lut, maxSide })
    if (reply.need) {
      const file = await fetchMedia(source)
      if (!file) throw new ExrSourceMissing()
      reply = await ask({ key: source, source: file, look, lut, maxSide })
    }
    if (reply.error || !reply.image) throw new Error(reply.error || 'grading failed')
    return reply.image
  } finally {
    idle = window.setTimeout(() => {
      if (waiting.size) return
      worker?.terminate()
      worker = null
    }, IDLE_MS)
  }
}
