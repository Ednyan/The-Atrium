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

interface DonateButtonProps {
  onClick: () => void
  // 'accent' is the orange one that asks; 'quiet' is the outlined one for
  // places where a loud button would be shouting over the room it is in.
  variant?: 'accent' | 'quiet'
  label?: string
  className?: string
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
  label = 'Donate',
  className = '',
}: DonateButtonProps) {
  const accent = variant === 'accent'

  return (
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
        {label}
      </span>
    </button>
  )
}
