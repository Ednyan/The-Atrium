// The .atrium file's format, read: what one holds, whether a file is one,
// and where each of its traces and groups goes in its stack. Free of the
// app, so it can be tested; lib/atriumFile writes and imports them.

import { flattenLegacyOrder, keysFromNumbers } from './order.ts'

export interface AtriumFile {
  version: number
  exportedAt: string
  app: string
  lobby: {
    name: string
    theme_settings: any
    is_public: boolean | number
    max_players: number
  }
  layers: Array<{
    name: string
    z_index: number
    // From files made since order keys (lib/order); older ones have only z_index.
    order_key?: string | null
    is_group: boolean | number
    parent_id: string | null
    _local_id: string
  }>
  // Only present from version 3 onward. Older files simply have none.
  locations?: Array<{
    name: string
    position_x: number
    position_y: number
    zoom: number
    order_index: number
    is_locked?: boolean | number
  }>
  traces: Array<Record<string, any>>
  // 'flat' in files keyed as one stack (lib/order); older ones need lifting.
  layerOrder?: string
  // Threads between traces, by the traces' ids in this file. Newer files only.
  links?: Array<Record<string, any>>
}

// Why a file couldn't be read: not one of ours, from a version newer than
// this app, or not JSON at all.
export class AtriumFileError extends Error {
  reason: 'badFormat' | 'badVersion' | 'parseFailed'
  constructor(reason: AtriumFileError['reason']) {
    super(reason)
    this.reason = reason
  }
}

export function parseAtriumFile(text: string): AtriumFile {
  let data: AtriumFile
  try {
    data = JSON.parse(text)
  } catch {
    throw new AtriumFileError('parseFailed')
  }
  if (!data || !data.lobby || !Array.isArray(data.traces)) throw new AtriumFileError('badFormat')
  // Version 1 files (older desktop builds) are read too: what they lack, the
  // import fills in.
  if (typeof data.version !== 'number' || data.version < 1 || data.version > 3) throw new AtriumFileError('badVersion')
  if (!Array.isArray(data.layers)) data.layers = []
  return data
}

// Where each trace and group of a file goes in its stack: its own key, or
// -- an older file, ordered by number only -- keys made from those numbers.
// A file from before groups and loose traces were one stack has its groups
// lifted above its loose traces, as it was drawn.
export function fileOrderKeys(file: AtriumFile) {
  const layerKeys = keysFromNumbers(file.layers, l => l.z_index ?? 0)
  const traceKeys = keysFromNumbers(file.traces, tr => tr.z_index ?? 0, tr => tr._local_layer_id ?? null)
  const layerKeyOf = new Map(file.layers.map(l => [l, l.order_key ?? layerKeys.get(l) ?? null]))
  const traceKeyOf = new Map(file.traces.map(tr => [tr, tr.order_key ?? traceKeys.get(tr) ?? null]))
  if (file.layerOrder !== 'flat') {
    const lifted = flattenLegacyOrder(
      file.traces.map((tr, i) => ({ id: String(i), layerId: tr._local_layer_id ?? null, orderKey: traceKeyOf.get(tr) })),
      file.layers.map(l => ({ id: l._local_id, orderKey: layerKeyOf.get(l) })),
    )
    file.traces.forEach((tr, i) => { const key = lifted.traces.get(String(i)); if (key) traceKeyOf.set(tr, key) })
    file.layers.forEach(l => { const key = lifted.layers.get(l._local_id); if (key) layerKeyOf.set(l, key) })
  }
  return { traceKeyOf, layerKeyOf }
}

