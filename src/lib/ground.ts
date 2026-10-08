// Things on the ground (a theme's Ground): small pictures scattered across the
// atrium's floor, under the grid and everything on it -- the built-in ones in
// public/ground, drawn in white so a colour can tint them, or pictures of
// one's own by link. Drawn once into a tile (groundTile), which the canvas
// repeats under the view as a single sprite (LobbyScene): nothing is made or
// culled as the view moves. (The ground elements taken out in c394ef5 were
// made and culled around the camera every other frame, and twelve of the
// thirteen pictures they asked for didn't exist.)

import type { ThemeSettings } from '../types/database'
import { fetchMedia } from './exportImage'

export const GROUND_ELEMENTS = ['pebbles', 'grass', 'leaf', 'crack', 'moss', 'marker', 'ring', 'flagstone', 'flower', 'stardust'] as const
export type GroundElement = typeof GROUND_ELEMENTS[number]
export const groundSrc = (id: GroundElement) => `/ground/${id}.svg`
export const isBuiltIn = (item: string): item is GroundElement => (GROUND_ELEMENTS as readonly string[]).includes(item)

// The tile, in world units a side, drawn at so many pixels a unit (the sprite
// scales it back): elements stay sharp to a zoom of 150%.
export const GROUND_TILE = 1024
export const GROUND_PX = 1.5
// An element at size 100%, in world units.
const BASE_SIZE = 56
// What has an up, and only leans a little: turned any way, a tuft of grass
// reads as an arrow. A picture of one's own may have one too.
const UPRIGHT = new Set<string>(['grass'])
const LEAN = 0.35

export const GROUND_DEFAULTS = {
  groundColor: '#ffffff',
  groundOpacity: 0.35,
  groundDensity: 1,
  groundScale: 1,
  groundScaleRange: 0.4,
  groundPattern: 'random' as const,
  groundSpacing: 200,
  // How far a scattered element may turn: 0 not at all, 1 any way.
  groundRotation: 1,
}

// What the tile is drawn from, as one string -- null for no ground. Colour and
// opacity aren't in it: they're the sprite's tint and alpha, changed without
// drawing anything again.
export function groundKey(theme: ThemeSettings | null | undefined): string | null {
  if (!theme?.groundEnabled || !theme.groundElements?.length) return null
  return JSON.stringify([theme.groundElements, theme.groundDensity, theme.groundScale, theme.groundScaleRange, theme.groundPattern, theme.groundSpacing, theme.groundRotation])
}

// The same scatter for the same settings, every visit and for everyone.
function seeded(text: string) {
  let a = 0
  for (let i = 0; i < text.length; i++) a = (Math.imul(a, 31) + text.charCodeAt(i)) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A picture, read: a built-in from the app, one's own through fetchMedia (the
// vault on desktop, the image proxy on the web), so the tile can be drawn on
// without the canvas being refused as another site's.
async function picture(item: string): Promise<{ img: HTMLImageElement; upright: boolean } | null> {
  let url = isBuiltIn(item) ? groundSrc(item) : null
  let own: string | null = null
  try {
    if (!url) {
      const blob = await fetchMedia(item)
      if (!blob) return null
      url = own = URL.createObjectURL(blob)
    }
    const img = new Image()
    img.src = url
    await img.decode()
    return { img, upright: !isBuiltIn(item) || UPRIGHT.has(item) }
  } catch {
    return null
  } finally {
    // Decoded: the picture no longer needs its address.
    if (own) setTimeout(() => URL.revokeObjectURL(own!), 0)
  }
}

// The tile: the theme's elements scattered over it (or in rows), each a size
// around its Size, turned any way when scattered. Each is drawn again across
// any edge it reaches over, so the seams where the tile repeats don't show.
export async function groundTile(theme: ThemeSettings): Promise<HTMLCanvasElement | null> {
  const key = groundKey(theme)
  if (!key) return null
  const pictures = (await Promise.all(theme.groundElements!.map(picture))).filter((p): p is { img: HTMLImageElement; upright: boolean } => !!p)
  if (pictures.length === 0) return null
  const grid = theme.groundPattern === 'grid'
  const spacing = Math.max(40, theme.groundSpacing ?? GROUND_DEFAULTS.groundSpacing)
  // A whole number of places across, so the tile meets itself at the seams.
  const size = spacing * Math.max(1, Math.round(GROUND_TILE / spacing))
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.round(size * GROUND_PX)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(GROUND_PX, GROUND_PX)
  const random = seeded(key)
  const density = theme.groundDensity ?? GROUND_DEFAULTS.groundDensity
  const scale = theme.groundScale ?? GROUND_DEFAULTS.groundScale
  const range = theme.groundScaleRange ?? GROUND_DEFAULTS.groundScaleRange
  const rotation = theme.groundRotation ?? GROUND_DEFAULTS.groundRotation
  // A place every `spacing`, density the share of them taken. In rows, each
  // at its place, square on; scattered, anywhere in its own cell (so they're
  // spaced, not clumped), turned as far as Rotation lets it.
  const spots: { x: number; y: number; turn: number }[] = []
  const across = size / spacing
  for (let i = 0; i < across; i++) for (let j = 0; j < across; j++) {
    if (random() >= density) continue
    spots.push(grid
      ? { x: (i + 0.5) * spacing, y: (j + 0.5) * spacing, turn: 0 }
      : { x: (i + 0.1 + random() * 0.8) * spacing, y: (j + 0.1 + random() * 0.8) * spacing, turn: (random() - 0.5) * Math.PI * 2 * rotation })
  }
  for (const spot of spots) {
    const { img: pic, upright } = pictures[Math.floor(random() * pictures.length)]
    const turn = upright ? (random() - 0.5) * LEAN : spot.turn
    const longest = BASE_SIZE * scale * Math.max(0.1, 1 + (random() * 2 - 1) * range)
    // Its own shape, its longer side the size.
    const fit = longest / Math.max(pic.naturalWidth || 1, pic.naturalHeight || 1)
    const w = (pic.naturalWidth || 1) * fit, h = (pic.naturalHeight || 1) * fit
    const reach = Math.hypot(w, h) / 2
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      const x = spot.x + dx, y = spot.y + dy
      if (x + reach < 0 || y + reach < 0 || x - reach > size || y - reach > size) continue
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(turn)
      ctx.drawImage(pic, -w / 2, -h / 2, w, h)
      ctx.restore()
    }
  }
  return canvas
}
