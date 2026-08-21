// The Donate button, wherever it appears.
//
// One component because it now sits in four places -- the website's top bar,
// the welcome screen, the atrium browser and the contributors wall -- and a
// button that means the same thing in all of them should not be four different
// buttons that drifted apart.
//
// Hearts drift up behind the word, the way Blender's does. They sit behind the
// label and are clipped to the button, so they read as texture rather than as
// decoration parked next to the text.

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../lib/i18n'

interface DonateButtonProps {
  onClick: () => void
  // 'accent' is the orange one that asks; 'quiet' is the outlined one for
  // places where a loud button would be shouting over the room it is in.
  variant?: 'accent' | 'quiet'
  label?: string
  className?: string
  // Layout classes for the wrapper rather than the button. The wrapper is a
  // real box now (the bubble is positioned against it), so a caller that needs
  // the button to stretch has to say so here -- flex-1 on the button inside an
  // inline-flex wrapper stretches nothing.
  wrapperClassName?: string
}

// Fixed rather than random. A button that rearranges itself on every render is
// a button that flickers, and eight is already enough to read as a drift.
const HEARTS = [
  { left: 8, delay: 0, duration: 4.2, size: 9, drift: 6 },
  { left: 22, delay: 1.5, duration: 5.1, size: 7, drift: -5 },
  { left: 35, delay: 0.7, duration: 4.6, size: 11, drift: 4 },
  { left: 48, delay: 2.3, duration: 5.4, size: 8, drift: -7 },
  { left: 61, delay: 1.1, duration: 4.4, size: 10, drift: 5 },
  { left: 74, delay: 3.0, duration: 5.0, size: 7, drift: -4 },
  { left: 86, delay: 0.4, duration: 4.8, size: 9, drift: 6 },
  { left: 94, delay: 2.6, duration: 5.6, size: 6, drift: -3 },
]

// The one shape here borrowed from somewhere other than NieR. The cut corner
// is what stops a monospace slab of capitals reading as a terminal.
export const DONATE_CUT =
  'polygon(0 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%)'

export function DonateHearts({ color }: { color: string }) {
  return (
    <span className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {HEARTS.map((heart, index) => (
        <span
          key={index}
          className="absolute select-none donate-heart"
          style={{
            left: `${heart.left}%`,
            bottom: '-30%',
            fontSize: heart.size,
            lineHeight: 1,
            color,
            // Its own sideways drift, so they do not all travel one line.
            ['--drift' as string]: `${heart.drift}px`,
            animation: `donate-heart ${heart.duration}s linear ${heart.delay}s infinite`,
          }}
        >
          ♥
        </span>
      ))}
    </span>
  )
}

export default function DonateButton({
  onClick,
  variant = 'accent',
  label,
  className = '',
  wrapperClassName = '',
}: DonateButtonProps) {
  const accent = variant === 'accent'
  const { t } = useTranslation()

  // The bubble is placed by measurement rather than by CSS offsets, and
  // rendered into document.body rather than into the button.
  //
  // Two things were cutting it off on the contributors page at once. The
  // button sits at bottom-6 right-6, so a bubble pinned below it and centred
  // on it ran off both the bottom and the right of the screen -- and that page
  // is fixed inset-0 overflow-hidden, so even a bubble in the right place
  // would have been clipped by an ancestor it had no way to escape. A portal
  // answers the second; flipping and clamping answers the first.
  const wrapRef = useRef<HTMLSpanElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false)
  const [place, setPlace] = useState<
    { left: number; top: number; tail: number; side: 'top' | 'bottom' } | null
  >(null)

  // Before paint, so the bubble never shows in the wrong place first.
  useLayoutEffect(() => {
    if (!hovered) { setPlace(null); return }
    const anchor = wrapRef.current
    const bubble = bubbleRef.current
    if (!anchor || !bubble) return

    const a = anchor.getBoundingClientRect()
    const width = bubble.offsetWidth
    const height = bubble.offsetHeight
    const gap = 11
    const margin = 8

    // Below unless below would not fit and above would.
    const fitsBelow = a.bottom + gap + height + margin <= window.innerHeight
    const fitsAbove = a.top - gap - height - margin >= 0
    const side: 'top' | 'bottom' = fitsBelow || !fitsAbove ? 'bottom' : 'top'

    const wanted = a.left + a.width / 2 - width / 2
    const left = Math.max(margin, Math.min(wanted, window.innerWidth - width - margin))

    setPlace({
      left,
      top: side === 'bottom' ? a.bottom + gap : a.top - gap - height,
      // The tail keeps pointing at the button even after the body has been
      // pushed back inside the screen.
      tail: Math.max(10, Math.min(a.left + a.width / 2 - left, width - 10)),
      side,
    })
  }, [hovered])

  // Pointer only. On a touchscreen the first tap would show the bubble and the
  // second would press the button, which is a worse button.
  const canHover = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover)').matches

  // Wrapped, because the button carries a clip-path for its cut corner and a
  // clip-path cuts its children too -- a bubble sitting below the button would
  // have been sliced off at the button's edge. The wrapper is what the hover
  // is read from, and what the bubble is positioned against.
  return (
    <span
      ref={wrapRef}
      className={`donate-btn-wrap ${wrapperClassName}`}
      onMouseEnter={() => canHover && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => canHover && setHovered(true)}
      onBlur={() => setHovered(false)}
    >
    <button
      type="button"
      onClick={onClick}
      className={`donate-btn relative px-4 sm:px-5 py-2.5 text-[11px] tracking-[0.18em] uppercase transition-transform hover:scale-[1.03] active:scale-[0.99] ${
        accent ? 'text-nier-black font-semibold' : 'border border-nier-border/40 text-nier-bg/85 hover:text-nier-bg'
      } ${className}`}
      // The glow travels with the button. It is the one thing on any screen
      // asking for money, and it should be findable at a glance in a room
      // built out of thin grey lines.
      style={accent
        ? { background: '#FF8A3D', clipPath: DONATE_CUT, boxShadow: '0 0 22px rgba(255,138,61,0.30), 0 0 52px rgba(255,138,61,0.14)' }
        : { clipPath: DONATE_CUT }}
    >
      {/* Dark hearts on the orange fill, orange ones on the dark outline: in
          both cases the hearts are the ground showing through rather than a
          second colour introduced on top. */}
      <DonateHearts color={accent ? 'rgb(var(--c-ground) / 0.42)' : 'rgba(255,138,61,0.30)'} />
      {/* A heart, not a diamond. The diamond is this app's punctuation and it
          means "an item" everywhere else; on the one button that asks for
          money it should say what it is asking for. Drawn as two arcs and a
          point rather than the emoji, which arrives in a different typeface on
          every machine and in colour on most of them. It beats while the
          pointer is on the button -- see .donate-heartbeat. */}
      <span className="relative inline-flex items-center gap-2">
        <svg viewBox="0 0 24 22" width="11" height="10" aria-hidden="true" className="shrink-0 donate-heartbeat">
          <path
            d="M12 21S2.5 14.6 2.5 8.2A5.7 5.7 0 0 1 12 4.4a5.7 5.7 0 0 1 9.5 3.8C21.5 14.6 12 21 12 21Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </svg>
        {label ?? t('landing.donate')}
      </span>
    </button>

      {/* What it is asking for, said only when somebody points at it. */}
      {hovered && createPortal(
        <span
          ref={bubbleRef}
          className="donate-bubble"
          aria-hidden="true"
          data-side={place?.side ?? 'bottom'}
          data-ready={place ? 'true' : 'false'}
          style={place
            ? { left: place.left, top: place.top, ['--tail-x' as string]: `${place.tail}px` }
            // First paint is a measurement: laid out where it will end up
            // horizontally so wrapping matches, but not yet shown.
            : { left: 0, top: 0 }}
        >
          <span>{t('donate.tooltip')}</span>
        </span>,
        document.body,
      )}
    </span>
  )
}
