import { useEffect, useState } from 'react'

interface DesktopIntroProps {
  onDone: () => void
}

// The launch sequence: a logo fade over black before the title screen, the way
// a game or Steam Big Picture opens.
//
// Deliberately short and skippable. An intro is charming the first few times
// and an obstacle by the hundredth, and this app is opened to get work done --
// so any key, click or Escape ends it immediately, and it never runs on the
// web where a "launch" isn't a thing that happens.
const FADE_IN_MS = 900
const HOLD_MS = 700
const FADE_OUT_MS = 600

export default function DesktopIntro({ onDone }: DesktopIntroProps) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in')

  useEffect(() => {
    const toHold = window.setTimeout(() => setPhase('hold'), FADE_IN_MS)
    const toOut = window.setTimeout(() => setPhase('out'), FADE_IN_MS + HOLD_MS)
    const finish = window.setTimeout(onDone, FADE_IN_MS + HOLD_MS + FADE_OUT_MS)
    return () => {
      window.clearTimeout(toHold)
      window.clearTimeout(toOut)
      window.clearTimeout(finish)
    }
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

  return (
    <div
      className="fixed inset-0 z-[10000500] bg-nier-black flex items-center justify-center cursor-pointer"
      style={{
        opacity: phase === 'out' ? 0 : 1,
        transition: `opacity ${FADE_OUT_MS}ms ease-in`,
      }}
    >
      {/* Scanlines, matching the rest of the app's chrome. */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203,203,203,0.1) 2px, rgba(203,203,203,0.1) 4px)',
        }}
      />

      <div
        className="flex flex-col items-center gap-6"
        style={{
          opacity: phase === 'in' ? 0 : 1,
          transform: phase === 'in' ? 'scale(0.97)' : 'scale(1)',
          transition: `opacity ${FADE_IN_MS}ms ease-out, transform ${FADE_IN_MS + 400}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      >
        {/* The same emblem the app icon and favicon use, so the launch reads
            as this app opening rather than a generic splash. */}
        <img
          src="/glass_dome_small_icon.png"
          alt=""
          className="w-24 h-24 opacity-90"
          draggable={false}
        />
        <div className="flex items-center gap-4">
          <div className="w-10 h-[1px] bg-gradient-to-r from-transparent to-nier-border/50" />
          <span className="text-nier-bg text-[11px] tracking-[0.4em] uppercase">Digital Atrium</span>
          <div className="w-10 h-[1px] bg-gradient-to-l from-transparent to-nier-border/50" />
        </div>
      </div>

      <span className="absolute bottom-10 text-nier-border/30 text-[9px] tracking-[0.25em] uppercase">
        Press any key to skip
      </span>
    </div>
  )
}
