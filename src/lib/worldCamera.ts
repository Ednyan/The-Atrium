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
// While it's on the compositor the layer carries data-camera-moving. It is an
// isolated group then, so anything whose look depends on what's behind the
// layer -- a blend mode, a backdrop filter -- can't see it, and uses that to
// draw itself another way (see [data-blends-with-ground] in index.css).

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
