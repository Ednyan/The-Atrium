// The three looks a trace can be given, and which one is currently in force.
//
// These three colour pairs are the app's palette. The atrium themes of the
// same names are built from them -- see atriumThemePresets -- so a trace
// wearing Abyss and a room wearing Abyss are made of the same two colours,
// and there is one set of three names to learn rather than two.
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
  labelKey: string
  descKey: string
  border: string
  fill: string
  text: string
}

export const TRACE_PRESETS: TracePreset[] = [
  {
    id: 'sepia',
    labelKey: 'atrium.theme.presetSepia',
    descKey: 'atrium.theme.presetSepiaDesc',
    border: '#9c9374',
    fill: '#b9b39d',
    text: '#000000',
  },
  {
    id: 'abyss',
    labelKey: 'atrium.theme.presetAbyss',
    descKey: 'atrium.theme.presetAbyssDesc',
    border: '#5f7485',
    fill: '#141414',
    text: '#ffffff',
  },
  {
    id: 'markerboard',
    labelKey: 'atrium.theme.presetMarkerboard',
    descKey: 'atrium.theme.presetMarkerboardDesc',
    border: '#000000',
    fill: '#eae8e1',
    text: '#000000',
  },
]

// Which one a bright interface and a dark interface start in. Two of the
// three are bright, so this is a choice rather than something to read off
// the colours: the plain board when the room is light, the dark one when it
// is dark. Soft Sepia is a look somebody picks, not one they are handed.
export const DEFAULT_PRESET: Record<'light' | 'dark', TracePreset['id']> = {
  light: 'markerboard',
  dark: 'abyss',
}

export function defaultPresetFor(light: boolean): TracePreset {
  const id = DEFAULT_PRESET[light ? 'light' : 'dark']
  return TRACE_PRESETS.find(preset => preset.id === id) ?? TRACE_PRESETS[0]
}

// Briefly -- one commit -- the presets were named after two atrium themes
// that no longer exist. Anybody who chose in that window keeps what they
// picked: the dark one, or the bright one.
const LEGACY_IDS: Record<string, TracePreset['id']> = {
  technical: 'abyss',
  whiteRoom: 'markerboard',
}

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

  const wanted = stored ? (LEGACY_IDS[stored] ?? stored) : null
  const chosen = TRACE_PRESETS.find(preset => preset.id === wanted)
  if (chosen) return chosen

  return defaultPresetFor(resolveThemeNow() === 'light')
}
