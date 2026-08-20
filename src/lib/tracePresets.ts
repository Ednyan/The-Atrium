// The three looks a trace can be given, and which one is currently in force.
//
// Choosing a preset while editing one trace sets the house style for that
// atrium: every trace made afterwards arrives wearing it, until somebody picks
// a different one. That is what people mean when they reach for a preset --
// not "make this one look like that" but "this is how they should look here".
//
// Remembered per atrium and per machine. It is a working preference rather
// than a property of the atrium: two people can be building the same space
// with different habits, and neither should be overwriting the other's.

import { resolveThemeNow } from './useLandingTheme'

export interface TracePreset {
  id: 'sepia' | 'abyss' | 'markerboard'
  label: string
  border: string
  fill: string
  text?: string
}

export const TRACE_PRESETS: TracePreset[] = [
  { id: 'sepia', label: 'Soft Sepia', border: '#9c9374', fill: '#b9b39d' },
  { id: 'abyss', label: 'Abyss', border: '#5f7485', fill: '#141414' },
  { id: 'markerboard', label: 'Markerboard', border: '#000000', fill: '#eae8e1', text: '#000000' },
]

const key = (lobbyId: string) => `atrium_trace_preset_${lobbyId}`

export function rememberTracePreset(lobbyId: string, id: TracePreset['id']) {
  try {
    localStorage.setItem(key(lobbyId), id)
  } catch {
    // Storage refused. The preset still applies to the trace being edited;
    // only the habit is forgotten.
  }
}

// The preset new traces should be born with: whatever was chosen last in this
// atrium, or -- for an atrium nobody has chosen in yet -- the one that suits
// the room the interface is currently in. A bright board in a bright
// interface, a dark one in a dark one.
export function currentTracePreset(lobbyId: string): TracePreset {
  let stored: string | null = null
  try {
    stored = localStorage.getItem(key(lobbyId))
  } catch {
    stored = null
  }

  const chosen = TRACE_PRESETS.find(preset => preset.id === stored)
  if (chosen) return chosen

  return resolveThemeNow() === 'light'
    ? TRACE_PRESETS[2]
    : TRACE_PRESETS[1]
}
