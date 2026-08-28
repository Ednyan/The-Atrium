// The three looks a trace can be given, and which one is currently in force.
//
// They are the three atrium themes, worn by a trace: each takes its border
// from that theme's grid colour and its fill from that theme's background.
// A trace in a Soft Sepia atrium is then made of the room it is standing in,
// which is what a house style ought to mean -- and it leaves one set of three
// names to learn instead of two.
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
import { SOFT_SEPIA, TECHNICAL, WHITE_ROOM } from './atriumThemePresets'

export interface TracePreset {
  id: 'sepia' | 'technical' | 'whiteRoom'
  labelKey: string
  border: string
  fill: string
  text: string
}

// Perceived lightness of a #rrggbb, 0..1. Only used to decide which way round
// the text should go, so the cheap sRGB weighting is enough.
function lightness(hex: string): number {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

// Derived rather than written out, so the presets cannot drift from the
// atrium themes they are named after, and so the text stays readable if
// those palettes are ever retuned.
function fromTheme(
  id: TracePreset['id'],
  labelKey: string,
  theme: { gridColor: string; backgroundColor: string },
): TracePreset {
  return {
    id,
    labelKey,
    border: theme.gridColor,
    fill: theme.backgroundColor,
    text: lightness(theme.backgroundColor) > 0.55 ? '#000000' : '#ffffff',
  }
}

export const TRACE_PRESETS: TracePreset[] = [
  fromTheme('sepia', 'atrium.theme.presetSepia', SOFT_SEPIA),
  fromTheme('technical', 'atrium.theme.presetTechnical', TECHNICAL),
  fromTheme('whiteRoom', 'atrium.theme.presetWhiteRoom', WHITE_ROOM),
]

// The two ids that existed before the presets became the atrium themes.
// Somebody who had settled on Markerboard meant "the light one" and somebody
// on Abyss meant "the dark one", so that is what they keep.
const LEGACY_IDS: Record<string, TracePreset['id']> = {
  abyss: 'technical',
  markerboard: 'whiteRoom',
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

  // Picked by what the fill actually is rather than by position, so
  // reordering the list cannot quietly invert this.
  const light = resolveThemeNow() === 'light'
  return (
    TRACE_PRESETS.find(preset => (lightness(preset.fill) > 0.55) === light) ??
    TRACE_PRESETS[0]
  )
}
