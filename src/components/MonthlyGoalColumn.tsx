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
  { left: 22, delay: 0, duration: 5.4, size: 4 },
  { left: 58, delay: 1.9, duration: 6.8, size: 3 },
  { left: 38, delay: 3.4, duration: 6.1, size: 3.5 },
  { left: 70, delay: 2.4, duration: 7.4, size: 3 },
  { left: 12, delay: 4.6, duration: 6.4, size: 3.5 },
]

// Quarter marks, outside the tube rather than in it. A gauge with a scale
// beside it reads as an instrument; the same marks printed across the fill
// would just be dirt on the glass.
const TICKS = [25, 50, 75]

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
      // A row rather than a stack, and aligned to the foot of the tube: the
      // sentence hangs from the bottom, where the fill it describes starts,
      // instead of floating against the middle of the glass.
      //
      // translateY is written into the transform rather than left to
      // -translate-y-1/2: an inline transform replaces the class outright, and
      // without it the column jumps to the middle of the screen.
      className={`hidden md:flex fixed top-1/2 z-20 items-end gap-3 group ${
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
          layout, so it wraps, selects and measures like text. The 180 makes it
          read upward, from the foot of the tube towards the surface. */}
      <span
        className="text-[10px] tracking-[0.18em] uppercase text-nier-bg/70 group-hover:text-nier-bg transition-colors whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {t(contributionCountKey(count), { count })}
      </span>

      {/* The wrapper exists so the corner brackets and the scale can sit
          outside the tube -- the tube itself has to clip, or the fill and the
          bubbles would escape it. */}
      <div className="relative">
        <div className="absolute -top-1 -left-1 w-2 h-2 border-l border-t border-nier-border/50 pointer-events-none" />
        <div className="absolute -top-1 -right-1 w-2 h-2 border-r border-t border-nier-border/50 pointer-events-none" />
        <div className="absolute -bottom-1 -left-1 w-2 h-2 border-l border-b border-nier-border/50 pointer-events-none" />
        <div className="absolute -bottom-1 -right-1 w-2 h-2 border-r border-b border-nier-border/50 pointer-events-none" />

        {TICKS.map(tick => (
          <div
            key={tick}
            className="absolute -left-2 w-1.5 h-px bg-nier-border/40 pointer-events-none"
            style={{ bottom: `${tick}%` }}
          />
        ))}

        {/* Narrower and taller than before: a gauge wants to be a column, and
            34px across was reading as a box that happened to be upright.
            isolate so the difference blend below has this box as its backdrop
            and nothing further out -- the button's transform already makes a
            stacking context, so this is belt and braces, but a blend mode that
            quietly reaches past its container is horrible to debug. */}
        <div className="relative isolate w-[26px] h-[clamp(190px,46vh,430px)] border border-nier-border/30 bg-nier-black overflow-hidden">
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

            {/* The surface itself, brighter than the body beneath it. What
                makes the fill read as a level rather than as a rectangle that
                happens to end. */}
            <div className="absolute inset-x-0 top-0 h-px bg-nier-strong/70" />
          </div>

          {/* The line it is trying to reach. */}
          <div className="absolute inset-x-0 top-0 h-px bg-nier-border/50" />

          {/* Inside the vessel, hanging from the top, and reading upward like
              the sentence beside it -- the two were turning opposite ways,
              which is the sort of thing you see immediately and cannot unsee.
              rotate(180) after the centring translate, so it turns about its
              own middle and stays over the tube.

              difference blending rather than a chosen colour, because the fill
              rises past this text: at 90% it sits on the fill, at 10% on the
              empty ground, and around the surface it lies across both at once.
              White differenced against whatever is behind it inverts, so it
              stays legible on either -- and it keeps working in light mode,
              where the two grounds swap over. Any fixed colour is wrong half
              the month. */}
          <span
            className="absolute top-2 left-1/2 text-[10px] tracking-[0.15em] uppercase whitespace-nowrap pointer-events-none tabular-nums"
            style={{
              writingMode: 'vertical-rl',
              transform: 'translateX(-50%) rotate(180deg)',
              color: '#ffffff',
              mixBlendMode: 'difference',
            }}
          >
            {t('goal.funded', { percent })}
          </span>
        </div>
      </div>
    </button>
  )
}
