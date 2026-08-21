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
import { useTranslation } from '../lib/i18n'

export default function ThemeToggle({ className = '', variant = 'panel' }: {
  className?: string
  // Inside an atrium every control shares one definition, so the toggle drops
  // its own styling and takes that instead -- otherwise it is a different
  // height from everything standing next to it.
  variant?: 'panel' | 'atrium'
}) {
  const { preference, resolved, cycle } = useLandingTheme()
  const { t } = useTranslation()

  const label = preference === 'system'
    ? t('theme.auto', { mode: resolved === 'dark' ? t('theme.modeDark') : t('theme.modeLight') })
    : preference === 'dark' ? t('theme.dark') : t('theme.light')

  return (
    <button
      type="button"
      onClick={cycle}
      title={t('theme.label', { mode: label })}
      aria-label={t('theme.change', { mode: label })}
      className={variant === 'atrium'
        ? `atrium-btn ${className}`
        : `cut-corner inline-flex items-center justify-center h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/70 text-[11px] tracking-[0.15em] uppercase leading-none transition-colors ${className}`}
      // Its own ground and the same cut as its neighbours. Without a
      // background it was transparent, which is fine on a page and wrong over
      // an atrium, where whatever is on the canvas showed through it.
      style={variant === 'atrium' ? undefined : { backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
    >
      {preference === 'system' ? '◐' : resolved === 'dark' ? '☾' : '☀'}
      <span className="hidden 2xl:inline ml-2">{label}</span>
    </button>
  )
}
