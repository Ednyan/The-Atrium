// The three atrium themes, and which one a new atrium starts in.
//
// They are the trace presets worn by a room: each takes its grid colour from
// that preset's border and its background from that preset's fill, with the
// particles carrying the grid colour so a room reads as one palette rather
// than two. Derived rather than written out, so a trace wearing Abyss and a
// room wearing Abyss can never drift apart.
//
// What is written out here is only what a room has and a trace does not --
// how strong the grid is, how far apart, how many particles, what sits on the
// floor. Those are tuned per theme by eye.
//
// Kept here rather than in the customisation panel so the panel and the
// creation flow cannot end up offering different versions of the same named
// preset.

import { TRACE_PRESETS, defaultPresetFor, type TracePreset } from './tracePresets'

// The room-only knobs. A bright room wants a firmer grid and darker, sparser
// particles than a dark one, or nothing reads against the floor.
interface RoomFeel {
  gridOpacity: number
  particleOpacity: number
  particleDensity: number
  groundParticleOpacity: number
  groundPatternMode: string
  gridSpacing?: number
  groundElementScale: number
  groundElementScaleRange: number
  groundElementDensity: number
}

const FEEL: Record<TracePreset['id'], RoomFeel> = {
  sepia: {
    gridOpacity: 0.24,
    particleOpacity: 0.45,
    particleDensity: 0.8,
    groundParticleOpacity: 0.82,
    groundPatternMode: 'grid',
    gridSpacing: 125,
    groundElementScale: 0.06,
    groundElementScaleRange: 0.02,
    groundElementDensity: 0.55,
  },
  abyss: {
    gridOpacity: 0.3,
    particleOpacity: 0.55,
    particleDensity: 1.2,
    groundParticleOpacity: 0.9,
    groundPatternMode: 'grid',
    gridSpacing: 90,
    groundElementScale: 0.055,
    groundElementScaleRange: 0.03,
    groundElementDensity: 0.8,
  },
  markerboard: {
    // Its grid is pure black, where the other two are mid-tones, so the same
    // number reads far heavier here. A tenth is a ruled line on a board.
    gridOpacity: 0.1,
    particleOpacity: 0.65,
    particleDensity: 1,
    groundParticleOpacity: 0.68,
    groundPatternMode: 'random',
    groundElementScale: 0.07,
    groundElementScaleRange: 0.05,
    groundElementDensity: 0.45,
  },
}

function roomFrom(preset: TracePreset) {
  const feel = FEEL[preset.id]
  return {
    nameKey: preset.labelKey,
    descKey: preset.descKey,
    values: {
      gridColor: preset.border,
      backgroundColor: preset.fill,
      particlesEnabled: true,
      particleColor: preset.border,
      groundParticlesEnabled: false,
      ...feel,
    },
  }
}

export const ATRIUM_THEMES = TRACE_PRESETS.map(roomFrom)

const byId = (id: TracePreset['id']) =>
  ATRIUM_THEMES[TRACE_PRESETS.findIndex(p => p.id === id)].values

export const SOFT_SEPIA = byId('sepia')
export const ABYSS = byId('abyss')
export const MARKERBOARD = byId('markerboard')

// What a new atrium looks like before anybody has decided.
//
// The app has two temperatures, and creating a bright room inside a bright
// interface -- or a dark one inside a dark interface -- is what somebody
// expects without having to be asked. The same pair a new trace starts from,
// so a fresh atrium and the first trace in it agree. It is a starting point,
// not a setting: every atrium's theme is editable afterwards.
export function startingAtriumTheme(light: boolean) {
  return byId(defaultPresetFor(light).id)
}
