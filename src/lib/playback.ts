// When to show what someone else did, on this side's clock (RemoteCursors,
// lib/laser). Their moments come stamped on their own clock, and each one
// arriving says how late it is here, the two clocks' difference included.
// Shown as late as the latest arrival of the last second -- by then every
// moment of their motion is here, so it plays back as evenly as it was made
// through a jittery network, at the least delay that allows -- but never more
// than SPREAD_MS behind the quickest: past that, a straggler just jumps.

const WINDOW_MS = 1000
const SPREAD_MS = 150
// The timer's own unevenness.
const MARGIN_MS = 4
/** A moment older than the latest by more than this: their clock started
 *  again (a reload), rather than one overtaken on the way. */
export const RESTART_MS = 10_000

export class Playback {
  private lates: { at: number; late: number }[] = []

  /** Something from moment `t` on their clock, arriving here at `at`. */
  heard(t: number, at: number) {
    this.lates.push({ at, late: at - t })
    while (this.lates.length > 1 && at - this.lates[0].at > WINDOW_MS) this.lates.shift()
  }

  /** Their moment `t` is shown here at `t + lag()`. */
  lag() {
    if (this.lates.length === 0) return MARGIN_MS
    let least = Infinity, most = -Infinity
    for (const { late } of this.lates) {
      least = Math.min(least, late)
      most = Math.max(most, late)
    }
    return Math.min(most, least + SPREAD_MS) + MARGIN_MS
  }
}
