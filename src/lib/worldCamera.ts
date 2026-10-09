// The camera over the atrium's DOM world layer: TraceOverlay's traces,
// threads, handles and other people's cursors.
//
// They are laid out from the view -- the zoom, and where the world's origin
// is on screen -- by React. Laid out again on every frame of a pan or zoom,
// every trace was rendered, laid out and painted again each frame: three
// hundred of them, zoomed out, panned at under thirty frames a second. And
// each box edge and glyph was rounded to the pixel a little differently every
// time, so traces shifted as they grew or shrank.
//
// So while the view moves, the layer they were last laid out in is moved and
// scaled whole, by the compositor, to where a new layout would put them. A new
// layout is asked for (commit) once the view is still -- moving smoothly, then
// crisp at rest -- or sooner, when the layer can no longer stand in for one:
//
//   - the view is about to leave what the layer holds: the screen, and the
//     margin around it that was laid out with it;
//   - it has been scaled up by a quarter, past which it blurs;
//   - the caller says it can't this frame: a trace being dragged moves by the
//     view it was laid out at, so dragging needs the real one.
//
// What in the layer keeps its size on screen whatever the zoom -- a trace's
// name under it, a handle -- is marked data-keeps-size, and scaled back by as
// much as the layer is scaled up, about its own 0 0 (see index.css). One by
// one, which costs a style write each per frame of a zoom, and nothing during
// a pan; a single inherited CSS variable would be one write, but has the
// browser restyle the whole layer every frame, and was slower by far.
//
// While it's on the compositor the layer carries data-camera-moving. Its
// wrapper (TraceOverlay) keeps it an isolated group at rest too, so a blend
// mode inside it -- a light's screen -- looks the same moving or not.

// screen = world * zoom + (x, y)
export interface View {
  x: number
  y: number
  zoom: number
}

// Whether a layer laid out at `laid`, holding the screen and `reach` world
// units around it, still holds everything on a `width` x `height` screen at
// `now`.
export function layoutHolds(laid: View, now: View, width: number, height: number, reach: number): boolean {
  return -now.x / now.zoom >= -laid.x / laid.zoom - reach
    && (width - now.x) / now.zoom <= (width - laid.x) / laid.zoom + reach
    && -now.y / now.zoom >= -laid.y / laid.zoom - reach
    && (height - now.y) / now.zoom <= (height - laid.y) / laid.zoom + reach
}

// The transform, about the layer's 0 0, that shows a layout made at `laid` as
// one made at `now` would look.
export function layerTransform(laid: View, now: View): { k: number; tx: number; ty: number } {
  const k = now.zoom / laid.zoom
  return { k, tx: now.x - laid.x * k, ty: now.y - laid.y * k }
}

const sameView = (a: View, b: View) => a.x === b.x && a.y === b.y && a.zoom === b.zoom

export interface WorldCameraOptions {
  // Lay the layer out at `view`, before this frame paints (LobbyScene commits
  // its state with flushSync). `previous` is the view it was laid out at, or
  // null the first time.
  commit: (view: View, previous: View | null) => void
  // How far past the screen, in world units, a layout holds -- TraceOverlay's
  // cull margin. Only four fifths of it is used, so a layout is asked for
  // before its edge can show.
  margin: number
  // How long the view must be still to count as at rest.
  settleMs?: number
  // How far the layer may be scaled up before it blurs too much to stand in.
  maxGrowth?: number
}

export interface WorldCameraFrame {
  layer: HTMLElement | null
  view: View
  now: number
  width: number
  height: number
  // False while something is dragged by the laid-out view.
  canScale: boolean
}

export function createWorldCamera({ commit, margin, settleMs = 120, maxGrowth = 1.25 }: WorldCameraOptions) {
  let laid: View | null = null
  let last: View | null = null
  let settlesAt = 0
  // The layer is transformed, or still promoted from being so.
  let active = false
  let keepSize: HTMLElement[] | null = null
  let keepSizeAt = 1

  const unscale = () => {
    if (keepSize) for (const el of keepSize) el.style.scale = ''
    keepSize = null
    keepSizeAt = 1
  }

  return {
    // Once a frame. Returns whether the view moved since the last one.
    frame({ layer, view, now, width, height, canScale }: WorldCameraFrame): boolean {
      const moved = !last || !sameView(view, last)
      if (moved) settlesAt = now + settleMs
      last = view
      const moving = now < settlesAt

      if (layer && laid && moving && canScale && layoutHolds(laid, view, width, height, margin * 0.8)) {
        const { k, tx, ty } = layerTransform(laid, view)
        if (k < maxGrowth) {
          layer.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`
          layer.style.willChange = 'transform'
          layer.setAttribute('data-camera-moving', '')
          active = true
          keepSize ??= Array.from(layer.querySelectorAll<HTMLElement>('[data-keeps-size]'))
          if (k !== keepSizeAt) {
            for (const el of keepSize) el.style.scale = String(1 / k)
            keepSizeAt = k
          }
          return moved
        }
      }

      if (!laid || !sameView(view, laid)) {
        const previous = laid
        laid = view
        commit(view, previous)
      }
      // In the same frame as the layout it stood in for. Left promoted until
      // the view is still, though: let go at a new layout midway and taken
      // back the next frame, the layer was drawn twice over for it.
      if (layer && active) {
        layer.style.transform = ''
        unscale()
        if (!moving) {
          layer.style.willChange = ''
          layer.removeAttribute('data-camera-moving')
          active = false
        }
      }
      return moved
    },
  }
}

// ---- Recenter ----------------------------------------------------------------------------

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Insets { left: number; top: number; right: number; bottom: number }

// How far the menus at a `width` x `height` screen's edges reach into it,
// edge by edge: each menu counted against the edge it covers least of -- a
// tall one at the left against the left, a wide one at the top against the
// top. Something over most of the screen is a layer, not a menu, and is left out.
export function edgeInsets(rects: { left: number; top: number; right: number; bottom: number }[], width: number, height: number): Insets {
  const insets: Insets = { left: 0, top: 0, right: 0, bottom: 0 }
  for (const r of rects) {
    if (r.right <= r.left || r.bottom <= r.top || r.right - r.left > width * 0.6 || r.bottom - r.top > height * 0.6) continue
    const cover: Insets = { left: r.right, top: r.bottom, right: width - r.left, bottom: height - r.top }
    const side = (Object.keys(cover) as (keyof Insets)[]).reduce((a, b) => (cover[a] <= cover[b] ? a : b))
    insets[side] = Math.max(insets[side], cover[side])
  }
  return insets
}

// Where Recenter takes the camera: the world point for the middle of the
// screen, and the zoom. Every trace's box shown in the screen less `insets`,
// as Excalidraw's zoom to fit, no closer than `maxZoom`. When that would draw
// them smaller than `minZoom` -- a trace or two far off from the rest -- it's
// the room's worth at `minZoom` that holds the most of them instead, fitted to
// those. Null when there's nothing to show.
export function contentView(
  boxes: Bounds[], width: number, height: number, insets: Insets, minZoom: number, maxZoom: number,
): { cx: number; cy: number; zoom: number } | null {
  if (boxes.length === 0) return null
  const roomW = Math.max(width / 2, width - insets.left - insets.right)
  const roomH = Math.max(height / 2, height - insets.top - insets.bottom)
  const fit = (some: Bounds[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const b of some) {
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY)
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY)
    }
    const zoom = Math.min(maxZoom, roomW / Math.max(1, maxX - minX), roomH / Math.max(1, maxY - minY))
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom }
  }
  let view = fit(boxes)
  if (view.zoom < minZoom) {
    // The room's worth at minZoom, centred on each trace in turn, that has the
    // most traces' middles in it.
    // ponytail: O(n^2) over the traces, and windows centred on a trace only --
    // count into a grid if atriums reach tens of thousands of traces.
    const halfW = roomW / minZoom / 2, halfH = roomH / minZoom / 2
    const middles = boxes.map(b => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }))
    let most: Bounds[] = []
    for (const m of middles) {
      const inside = boxes.filter((_, i) => Math.abs(middles[i].x - m.x) <= halfW && Math.abs(middles[i].y - m.y) <= halfH)
      if (inside.length > most.length) most = inside
    }
    view = fit(most)
    view.zoom = Math.max(minZoom, view.zoom)
  }
  // The room's middle is off the screen's by half the difference of its
  // insets; the camera looks at the screen's.
  return {
    cx: view.x - (insets.left - insets.right) / 2 / view.zoom,
    cy: view.y - (insets.top - insets.bottom) / 2 / view.zoom,
    zoom: view.zoom,
  }
}
