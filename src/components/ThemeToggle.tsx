// The light/dark switch, on every page that has chrome of its own.
//
// One control, one stored preference: changing it on the welcome screen
// changes it on the website, because it is the same value read from the same
// place. There is nothing per-page about it, and a switch that only applied to
// the page you happened to be on would be a worse version of no switch at all.
//
// Three states, not two. "Auto" follows the machine and is not the same as
// having picked whichever mode the machine is in right now -- somebody whose
// laptop turns dark at sunset should turn with it.

import { useLandingTheme } from '../lib/useLandingTheme'

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { preference, resolved, cycle } = useLandingTheme()

  const label = preference === 'system'
    ? `Auto · ${resolved}`
    : preference === 'dark' ? 'Dark' : 'Light'

  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${label}`}
      aria-label={`Theme: ${label}. Click to change.`}
      className={`px-3 py-2 border border-nier-border/30 text-nier-bg/75 hover:text-nier-bg hover:border-nier-border/60 text-[11px] tracking-[0.15em] uppercase transition-colors ${className}`}
    >
      {preference === 'system' ? '◐' : resolved === 'dark' ? '☾' : '☀'}
      <span className="hidden sm:inline ml-2">{label}</span>
    </button>
  )
}
