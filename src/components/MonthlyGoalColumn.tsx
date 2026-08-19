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

interface MonthlyGoalColumnProps {
  month: MonthlyProgress | null
  onOpen: () => void
  side?: 'left' | 'right'
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

export default function MonthlyGoalColumn({ month, onOpen, side = 'left' }: MonthlyGoalColumnProps) {
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
  if (!month || month.goalCents <= 0) return null

  const percent = Math.min(100, (month.totalCents / month.goalCents) * 100)
  const raised = Math.round(month.totalCents / 100)
  const goal = Math.round(month.goalCents / 100)

  return (
    <button
      type="button"
      onClick={onOpen}
      // Hidden where there is no margin to put it in. On a narrow window the
      // column it would sit beside is the whole screen.
      className={`hidden lg:flex fixed top-1/2 -translate-y-1/2 z-20 flex-col items-center gap-4 group ${
        side === 'left' ? 'left-10 xl:left-16' : 'right-10 xl:right-16'
      }`}
      title="See who keeps this running"
    >
      {/* The goal sits at the top, where the column is trying to reach, and
          the figure raised sits at the bottom with the fill it describes. The
          other way round the two numbers were each at the wrong end of the
          thing they referred to. */}
      <span className="text-xs tracking-[0.2em] text-nier-bg/60 group-hover:text-nier-bg/80 transition-colors tabular-nums">
        €{goal}
      </span>

      <div className="relative w-[10px] h-[clamp(150px,34vh,300px)] border border-nier-border/30 bg-nier-black overflow-hidden">
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
      </div>

      <span className="text-sm tracking-[0.2em] text-nier-bg/85 group-hover:text-nier-strong transition-colors tabular-nums">
        €{raised}
      </span>

      {/* Set on its side rather than rotated with a transform: vertical-rl is
          real text layout, so it wraps, selects and measures like text. */}
      <span
        className="text-[11px] tracking-[0.28em] uppercase text-nier-bg/70 group-hover:text-nier-bg transition-colors whitespace-nowrap"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        Contributions this month
      </span>
    </button>
  )
}
