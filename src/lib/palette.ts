// Each person's colour palette (PalettePanel, from the view bar): up to
// PALETTE_SIZE colours, kept in this browser and the same in every atrium --
// picked up from what's on the canvas (lib/eyedropper) or chosen by hand. A
// place can be empty, and stays where it is when another is cleared.

import { useSyncExternalStore } from 'react'

export const PALETTE_SIZE = 18
// Shown at once; the rest, two more rows of as many, when opened out.
export const PALETTE_ROW = 6

// A colour from the palette, for whatever is selected on the canvas
// (TraceOverlay): `applied` says whether anything took it.
export const APPLY_COLOUR_EVENT = 'atrium-apply-colour'
export interface ApplyColour { colour: string; applied: boolean }

const KEY = 'atrium.palette'
const HEX = /^#[0-9a-f]{6}$/

export const normalHex = (colour: string): string | null => {
  const hex = colour.trim().toLowerCase()
  return HEX.test(hex) ? hex : null
}

function load(): (string | null)[] {
  const slots: (string | null)[] = Array(PALETTE_SIZE).fill(null)
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (Array.isArray(kept)) kept.slice(0, PALETTE_SIZE).forEach((c, i) => { slots[i] = typeof c === 'string' ? normalHex(c) : null })
  } catch { /* none kept */ }
  return slots
}

let slots = load()
const watchers = new Set<() => void>()
const subscribe = (watcher: () => void) => { watchers.add(watcher); return () => { watchers.delete(watcher) } }
export const usePalette = () => useSyncExternalStore(subscribe, () => slots, () => slots)
export const paletteNow = () => slots

function set(next: (string | null)[]) {
  slots = next
  try { localStorage.setItem(KEY, JSON.stringify(slots)) } catch { /* this visit only */ }
  watchers.forEach(watcher => watcher())
}

/** Into the first empty place -- or where it is already. The place, or null
 *  when every place is taken. */
export function addColour(colour: string): number | null {
  const hex = normalHex(colour)
  if (!hex) return null
  const had = slots.indexOf(hex)
  if (had >= 0) return had
  const free = slots.indexOf(null)
  if (free < 0) return null
  set(slots.map((c, i) => (i === free ? hex : c)))
  return free
}

export function setColour(index: number, colour: string | null) {
  if (index < 0 || index >= PALETTE_SIZE) return
  set(slots.map((c, i) => (i === index ? (colour === null ? null : normalHex(colour)) : c)))
}
