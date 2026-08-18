// Reading a wheel event: is this a mouse asking to zoom, or a trackpad asking
// to pan?
//
// Extracted from LobbyScene so the contributors page navigates identically. It
// took three attempts to get right, and two canvases each carrying their own
// copy would have meant fixing it twice and forgetting once.
//
// A trackpad and a mouse wheel arrive through the very same event, so this has
// to be inferred, and the only signal that reliably belongs to one and not the
// other is horizontal movement: two fingers move in both axes, and a wheel has
// no horizontal axis to report.
//
// The tempting signals are traps. Fractional deltas look like a trackpad, but
// Windows reports 33.33 per notch when set to scroll one line at a time, and
// high-resolution wheels report small fractions by design. Small deltas look
// like a trackpad for the same reason. Judging on those two is exactly how the
// mouse got broken once already -- an ordinary wheel read as a trackpad, every
// notch panning instead of zooming.

const WHEEL_SIGNATURE_WINDOW_MS = 500
const WHEEL_SIGNATURE_EVENTS = 4

export type WheelIntent = 'zoom' | 'pan'

export interface WheelGestures {
  classify(event: WheelEvent): WheelIntent
  zoomDelta(event: WheelEvent): number
}

// Each canvas gets its own, since the latched reading is per-surface state.
export function createWheelGestures(): WheelGestures {
  // Starts at 'wheel' and only moves off it on positive evidence, because being
  // wrong about a mouse costs a canvas its primary zoom control.
  //
  // Latched rather than judged per-event, so once a trackpad has identified
  // itself a slow, perfectly vertical two-finger scroll still pans. A run of
  // identical notches switches back, so a laptop with a mouse plugged in works
  // both ways without a setting.
  let device: 'wheel' | 'trackpad' = 'wheel'
  const history: { at: number; magnitude: number }[] = []

  return {
    classify(event: WheelEvent): WheelIntent {
      if (event.ctrlKey) return 'zoom' // a pinch, reported as ctrl+wheel everywhere

      if (event.deltaMode !== 0) {
        // Lines or pages: only a wheel is ever reported this way.
        device = 'wheel'
        return 'zoom'
      }

      if (event.deltaX !== 0) {
        device = 'trackpad'
      } else {
        // A wheel at a steady speed emits the same magnitude every time,
        // whatever that magnitude is. A trackpad's varies continuously as the
        // fingers accelerate and slow, so several identical readings in a row
        // means a wheel -- without assuming anything about notch size.
        history.push({ at: event.timeStamp, magnitude: Math.abs(event.deltaY) })
        while (history.length > 0 && event.timeStamp - history[0].at > WHEEL_SIGNATURE_WINDOW_MS) {
          history.shift()
        }
        if (history.length > WHEEL_SIGNATURE_EVENTS * 2) history.shift()

        const uniform =
          history.length >= WHEEL_SIGNATURE_EVENTS &&
          history.every(entry => Math.abs(entry.magnitude - history[0].magnitude) < 0.5)
        if (uniform) device = 'wheel'
      }

      return device === 'trackpad' ? 'pan' : 'zoom'
    },

    zoomDelta(event: WheelEvent): number {
      let raw = event.deltaY
      if (event.deltaMode === 1) raw *= 16       // lines -> approximate pixels
      else if (event.deltaMode === 2) raw *= 100 // pages -> approximate pixels

      // Two tiers on each path, because the magnitude a device reports says
      // nothing about how much movement it represents. A wheel notch is ~100 on
      // most systems, 33.33 when set to scroll one line, smaller still on a
      // high-resolution wheel. A pinch is the same story: some drivers report a
      // few units per event, others report notch-sized numbers for the same
      // finger movement. Scaling a small reading by the large-reading factor is
      // what makes a device feel dead.
      //
      // The pinch factors are both well under the wheel's, because a pinch
      // fires continuously for as long as the fingers move where a wheel fires
      // once per notch.
      const perEvent = event.ctrlKey
        ? (Math.abs(raw) < 20 ? 0.02 : 0.002)
        : (Math.abs(raw) < 50 ? 0.01 : 0.001)

      // Clamped so one enormous event (some mice, some drivers) can't jump the
      // whole zoom range at once.
      return Math.max(-1, Math.min(1, -raw * perEvent))
    },
  }
}
