// What a new atrium looks like before anybody has decided.
//
// Two of them, because the app now has two temperatures and creating a bright
// room inside a bright interface -- or a dark one inside a dark interface --
// is what somebody expects without having to be asked. It is a starting point,
// not a setting: every atrium's theme is editable afterwards and neither of
// these is preferred by anything.
//
// Kept here rather than in the customisation panel so the panel and the
// creation flow cannot drift into offering different versions of the same
// named preset.

export const SOFT_SEPIA = {
  gridColor: '#9c9681',
  gridOpacity: 0.24,
  backgroundColor: '#1a1a18',
  particlesEnabled: true,
  particleColor: '#9c9681',
  particleOpacity: 0.45,
  particleDensity: 0.8,
  groundParticlesEnabled: false,
  groundParticleOpacity: 0.82,
  groundPatternMode: 'grid',
  gridSpacing: 125,
  groundElementScale: 0.06,
  groundElementScaleRange: 0.02,
  groundElementDensity: 0.55,
}

// Cold scanning-room green on near-black.
export const TECHNICAL = {
  gridColor: '#6f8a7d',
  gridOpacity: 0.3,
  backgroundColor: '#0f1311',
  particlesEnabled: true,
  particleColor: '#6f8a7d',
  particleOpacity: 0.55,
  particleDensity: 1.2,
  groundParticlesEnabled: false,
  groundParticleOpacity: 0.9,
  groundPatternMode: 'grid',
  gridSpacing: 90,
  groundElementScale: 0.055,
  groundElementScaleRange: 0.03,
  groundElementDensity: 0.8,
}

// Near-white walls, faint grey grid, particles in the same grey so they
// read as part of the room rather than against it.
export const WHITE_ROOM = {
  gridColor: '#9a9a9a',
  gridOpacity: 0.3,
  backgroundColor: '#F2F2EF',
  particlesEnabled: true,
  particleColor: '#9a9a9a',
  particleOpacity: 0.65,
  particleDensity: 1,
  groundParticlesEnabled: false,
  groundParticleOpacity: 0.68,
  groundPatternMode: 'random',
  groundElementScale: 0.07,
  groundElementScaleRange: 0.05,
  groundElementDensity: 0.45,
}
