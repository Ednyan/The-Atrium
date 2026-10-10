/// <reference lib="webworker" />

// EXR work off the thread that draws the atrium.
//
// An import: a dropped EXR made a PNG, in the look it starts with -- see
// exrFileToPng in exr.ts, which starts this and falls back to doing the same
// work itself if this can't run.
//
// A grade (lib/exrGrade): an EXR trace shown again in another look. The file
// last graded is kept decoded, so each change after the first only grades --
// decoding a 4K render takes seconds -- and a picture shrunk from it is kept
// for previews.

import { decodeExr, encodePng, gradeExr, importExr, parseCube, presetLut, type CubeLut, type DecodedExr, type ExrLook, type LutPreset } from './exr'

const ctx = self as unknown as DedicatedWorkerGlobalScope

type Ask =
  | { kind: 'import'; file: Blob; fileName: string }
  | { kind: 'grade'; id: number; key: string; source?: Blob; look: ExrLook; lut: { text: string } | { preset: LutPreset } | null; maxSide?: number }

let held: { key: string; exr: DecodedExr; small: Map<number, DecodedExr> } | null = null
let heldLut: { text: string; lut: CubeLut } | null = null

ctx.onmessage = async (event: MessageEvent<Ask>) => {
  const ask = event.data
  if (ask.kind === 'import') {
    try {
      ctx.postMessage(await importExr(ask.file, ask.fileName))
    } catch (error) {
      ctx.postMessage({ error: error instanceof Error ? error.message : String(error) })
    }
    return
  }
  try {
    if (held?.key !== ask.key) {
      if (!ask.source) { ctx.postMessage({ id: ask.id, need: 'source' }); return }
      held = null // let the last one go before reading the next
      held = { key: ask.key, exr: await decodeExr(await ask.source.arrayBuffer()), small: new Map() }
    }
    const exr = ask.maxSide ? shrunk(held, ask.maxSide) : held.exr
    let lut: CubeLut | null = null
    if (ask.lut && 'preset' in ask.lut) lut = presetLut(ask.lut.preset)
    else if (ask.lut) {
      if (heldLut?.text !== ask.lut.text) heldLut = { text: ask.lut.text, lut: parseCube(ask.lut.text) }
      lut = heldLut.lut
    }
    ctx.postMessage({ id: ask.id, image: await encodePng(exr.width, exr.height, gradeExr(exr, ask.look, lut)) })
  } catch (error) {
    ctx.postMessage({ id: ask.id, error: error instanceof Error ? error.message : String(error) })
  }
}

// The picture no bigger than `maxSide` on its longer side, nearest pixel:
// for a preview, drawn while a control is moved.
function shrunk(from: { exr: DecodedExr; small: Map<number, DecodedExr> }, maxSide: number): DecodedExr {
  const { exr } = from
  const scale = maxSide / Math.max(exr.width, exr.height)
  if (scale >= 1) return exr
  const known = from.small.get(maxSide)
  if (known) return known
  const width = Math.max(1, Math.round(exr.width * scale)), height = Math.max(1, Math.round(exr.height * scale))
  const c = exr.channels
  const data = new Float32Array(width * height * c)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(exr.height - 1, Math.floor((y + 0.5) / scale))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(exr.width - 1, Math.floor((x + 0.5) / scale))
      data.set(exr.data.subarray((sy * exr.width + sx) * c, (sy * exr.width + sx + 1) * c), (y * width + x) * c)
    }
  }
  const small = { width, height, channels: exr.channels, data }
  from.small.set(maxSide, small)
  return small
}
