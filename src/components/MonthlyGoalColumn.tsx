// This month's contributions, stood on end in the margin.
//
// It used to be a horizontal rule under the welcome menu and another one
// wedged into the middle of the atrium browser, both competing for width with
// the thing you actually came to that screen for. Both screens are a centred
// column with a great deal of nothing either side of it, and a gauge is one of
// the few things that reads better vertical than horizontal -- it fills the way
// a vessel fills, which is what it is describing.
//
// It fills on mount rather than appearing filled. The number does not change
// often enough for anyone to watch it move, so the only chance to show that it
// moves at all is the moment it arrives.

import { useEffect, useState } from 'react'
import type { MonthlyProgress } from '../lib/contributions'
import { useTranslation } from '../lib/i18n'
import { contributionCountKey, gaugeFigures } from '../lib/monthlyGauge'

interface MonthlyGoalColumnProps {
  month: MonthlyProgress | null
  onOpen: () => void
  side?: 'left' | 'right'
  // Shared with the welcome screen's own menu, so the two shrink together
  // rather than one of them disappearing while the other adapts.
  scale?: number
}

// Fixed positions and timings. Randomising them per render means a column that
// reshuffles itself whenever anything above it re-renders.
const BUBBLES = [
  { left: 22, delay: 0, duration: 5.4, size: 3 },
  { left: 58, delay: 1.9, duration: 6.8, size: 2 },
  { left: 38, delay: 3.4, duration: 6.1, size: 2.5 },
  { left: 70, delay: 2.4, duration: 7.4, size: 2 },
  { left: 12, delay: 4.6, duration: 6.4, size: 2.5 },
]

export default function MonthlyGoalColumn({ month, onOpen, side = 'left', scale = 1 }: MonthlyGoalColumnProps) {
  const { t } = useTranslation()
  // Starts empty and is told to fill one frame later, so the transition has
  // something to travel from. Setting the real height immediately would paint
  // it full and animate nothing.
  const [filled, setFilled] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFilled(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // Nothing at all rather than an empty gauge: a machine that has never been
  // online has no figure to show, and a bar reading zero is a claim.
  const figures = gaugeFigures(month)
  if (!figures) return null

  const { percent, count } = figures

  return (
    <button
      type="button"
      onClick={onOpen}
      // Shrinks with the rest of the screen before it gives up.
      //
      // This was hidden below lg, which is a WIDTH breakpoint -- so making the
      // window shorter, where the menu beside it merely scales down, made the
      // gauge vanish outright. It takes the same scale now and holds on to md,
      // by which point the centre column really has taken the margin it lives
      // in.
      //
      // translateY is written into the transform rather than left to
      // -translate-y-1/2: an inline transform replaces the class outright, and
      // without it the column jumps to the middle of the screen.
      // A row rather than a stack. Both figures used to sit above and below
      // the bar, which made a tall thing taller and pushed the fill off centre
      // on a short window. Beside it, the caption borrows height the bar
      // already has.
      className={`hidden md:flex fixed top-1/2 z-20 items-center gap-3 group ${
        side === 'left' ? 'left-10 xl:left-16 flex-row' : 'right-10 xl:right-16 flex-row-reverse'
      }`}
      style={{
        transform: `translateY(-50%) scale(${scale})`,
        transformOrigin: side === 'left' ? 'left center' : 'right center',
      }}
      title={t('goal.seeWho')}
    >
      {/* One sentence, on its side, beside the thing it describes. Set with
          vertical-rl rather than rotated with a transform: that is real text
          layout, so it wraps, selects and measures like text.

          Tighter and a shade smaller than the old label because it is a whole
          sentence now rather than three words, and it has only the bar's
          height to live in. */}
      <span
        className="text-[10px] tracking-[0.18em] uppercase text-nier-bg/70 group-hover:text-nier-bg transition-colors whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {t(contributionCountKey(count), { count })}
      </span>

      {/* Wide enough to be written in. It was a 10px sliver with both figures
          stacked outside it; the percentage belongs inside the vessel it is
          describing, which needs room for a line of type. */}
      {/* isolate so the difference blend below has this box as its backdrop and
          nothing further out. The button's own transform already makes a
          stacking context, so this is belt and braces -- but a blend mode that
          quietly reaches past its container is a horrible thing to debug. */}
      <div className="relative isolate w-[34px] h-[clamp(150px,34vh,300px)] border border-nier-border/30 bg-nier-black overflow-hidden">
        <div
          className="absolute inset-x-0 bottom-0 bg-nier-bg/75 group-hover:bg-nier-bg transition-[height,background-color] duration-[1600ms] ease-out overflow-hidden"
          style={{ height: filled ? `${percent}%` : '0%' }}
        >
          {/* Rising inside the filled part only, so the column reads as
              holding something rather than as a painted rectangle. Clipped by
              the fill, which means they disappear at the surface. */}
          {BUBBLES.map((bubble, index) => (
            <span
              key={index}
              className="absolute rounded-full goal-bubble"
              style={{
                left: `${bubble.left}%`,
                bottom: 0,
                width: bubble.size,
                height: bubble.size,
                background: 'rgb(var(--c-ground) / 0.55)',
                animation: `goal-bubble ${bubble.duration}s ease-in ${bubble.delay}s infinite`,
              }}
            />
          ))}
        </div>

        {/* The line it is trying to reach. */}
        <div className="absolute inset-x-0 top-0 h-px bg-nier-border/50" />

        {/* Inside the vessel, hanging from the top, so it is read as a
            property of the bar rather than a caption near it.

            difference blending rather than a chosen colour, because the fill
            rises past this text: at 90% it sits on the fill, at 10% on the
            empty ground, and around the surface it lies across both at once.
            White differenced against whatever is behind it inverts, so it
            stays legible on either -- and it keeps working in light mode,
            where the two grounds swap over. Any fixed colour is wrong half the
            month. */}
        <span
          className="absolute top-2 left-1/2 text-[10px] tracking-[0.15em] uppercase whitespace-nowrap pointer-events-none tabular-nums"
          style={{
            writingMode: 'vertical-rl',
            transform: 'translateX(-50%)',
            color: '#ffffff',
            mixBlendMode: 'difference',
          }}
        >
          {t('goal.funded', { percent })}
        </span>
      </div>
    </button>
  )
}
