import { useEffect, useState } from 'react'
import PortalLoop from './PortalLoop'

interface DesktopIntroProps {
  onDone: () => void
}

// The launch sequence: the portal opening over black before the title screen,
// the way a game opens.
//
// The emblem here is the portal animation itself, not a still of it -- the mark
// this app is identified by is a moving one, and a launch is the one moment
// where showing it in motion costs nothing. It plays over true black rather
// than the app's near-black so the screen reads as the app not yet being there,
// and the whole sequence fades up from and back down to that black.
//
// Deliberately short and skippable. An intro is charming the first few times
// and an obstacle by the hundredth, and this app is opened to get work done --
// so any key, click or Escape ends it immediately, and it never runs on the web
// where a "launch" isn't a thing that happens.
const LEAD_IN_MS = 350      // black, before anything appears
const PORTAL_FADE_MS = 1100 // portal rises out of it
const TITLE_DELAY_MS = 700  // wordmark trails the portal rather than sharing it
const TITLE_FADE_MS = 900
const HOLD_MS = 850
const CONTENT_OUT_MS = 600  // everything sinks back into the black...
const BACKDROP_OUT_MS = 500 // ...and only then does the black itself lift

const T_PORTAL = LEAD_IN_MS
const T_TITLE = LEAD_IN_MS + TITLE_DELAY_MS
const T_OUT = LEAD_IN_MS + PORTAL_FADE_MS + HOLD_MS
const T_CLEAR = T_OUT + CONTENT_OUT_MS
const T_DONE = T_CLEAR + BACKDROP_OUT_MS

type Phase = 'lead' | 'portal' | 'title' | 'out' | 'clear'

export default function DesktopIntro({ onDone }: DesktopIntroProps) {
  const [phase, setPhase] = useState<Phase>('lead')

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase('portal'), T_PORTAL),
      window.setTimeout(() => setPhase('title'), T_TITLE),
      window.setTimeout(() => setPhase('out'), T_OUT),
      window.setTimeout(() => setPhase('clear'), T_CLEAR),
      window.setTimeout(onDone, T_DONE),
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [onDone])

  // Any input skips. Listening in the capture phase so nothing underneath can
  // swallow the first press -- being unable to skip an intro is worse than not
  // having one.
  useEffect(() => {
    const skip = () => onDone()
    window.addEventListener('keydown', skip, true)
    window.addEventListener('mousedown', skip, true)
    return () => {
      window.removeEventListener('keydown', skip, true)
      window.removeEventListener('mousedown', skip, true)
    }
  }, [onDone])

  const contentVisible = phase === 'portal' || phase === 'title' || phase === 'out'
  const portalUp = phase !== 'lead'
  const titleUp = phase === 'title' || phase === 'out'

  return (
    <div
      className="fixed inset-0 z-[10000500] flex items-center justify-center cursor-pointer overflow-hidden"
      style={{
        background: '#000',
        opacity: phase === 'clear' ? 0 : 1,
        transition: `opacity ${BACKDROP_OUT_MS}ms ease-out`,
      }}
    >
      {/* A faint pool of light under the portal, so it sits in the black
          instead of floating on top of it. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 55% 45% at 50% 45%, rgba(203,203,203,0.06), transparent 70%)',
          opacity: contentVisible && phase !== 'out' ? 1 : 0,
          transition: `opacity ${PORTAL_FADE_MS}ms ease-out`,
        }}
      />

      {/* Scanlines, matching the rest of the app's chrome. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203,203,203,0.1) 2px, rgba(203,203,203,0.1) 4px)',
        }}
      />

      <div
        className="flex flex-col items-center"
        style={{
          opacity: phase === 'out' ? 0 : 1,
          transition: `opacity ${CONTENT_OUT_MS}ms ease-in`,
        }}
      >
        {/* Sized off viewport height so it fills the screen on a laptop and
            still reads as an emblem on a large monitor. Slowed down: at launch
            scale the natural pace reads as busy rather than ceremonial. */}
        <div
          style={{
            opacity: portalUp ? 1 : 0,
            transform: portalUp ? 'scale(1)' : 'scale(0.88)',
            transition: `opacity ${PORTAL_FADE_MS}ms ease-out, transform ${PORTAL_FADE_MS + 900}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          }}
        >
          <PortalLoop className="h-[clamp(11rem,42vh,26rem)]" playbackRate={0.6} />
        </div>

        {/* The rules draw outward and the letters settle together -- the
            wordmark arriving rather than switching on. */}
        <div
          className="flex items-center gap-4 -mt-2"
          style={{
            opacity: titleUp ? 1 : 0,
            transition: `opacity ${TITLE_FADE_MS}ms ease-out`,
          }}
        >
          <div
            className="h-[1px] bg-gradient-to-r from-transparent to-nier-border/50"
            style={{
              width: titleUp ? '3.5rem' : '0rem',
              transition: `width ${TITLE_FADE_MS + 300}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            }}
          />
          <span
            className="text-nier-bg text-[11px] uppercase whitespace-nowrap"
            style={{
              letterSpacing: titleUp ? '0.4em' : '0.7em',
              transition: `letter-spacing ${TITLE_FADE_MS + 300}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            }}
          >
            Digital Atrium
          </span>
          <div
            className="h-[1px] bg-gradient-to-l from-transparent to-nier-border/50"
            style={{
              width: titleUp ? '3.5rem' : '0rem',
              transition: `width ${TITLE_FADE_MS + 300}ms cubic-bezier(0.16, 1, 0.3, 1)`,
            }}
          />
        </div>
      </div>

      {/* Held back until the sequence is established -- offering the exit
          before the thing has appeared undercuts it. */}
      <span
        className="absolute bottom-10 text-nier-border/30 text-[9px] tracking-[0.25em] uppercase"
        style={{
          opacity: titleUp ? 1 : 0,
          transition: 'opacity 700ms ease-out',
        }}
      >
        Press any key to skip
      </span>
    </div>
  )
}
