// What the atrium is, and where in it you are looking: its name, beside the
// menu's button at the top left; the zoom, as a percentage, and the pointer's
// place in the world, at the foot of the left edge. (Your own name is shown
// nowhere: you know it.)

import { useGameStore } from '../store/gameStore'
import { useTranslation } from '../lib/i18n'

// The look the two share: a chip as tall as a button, its words a button's.
const CHIP = 'h-[2.125rem] px-3 flex items-center gap-3 border border-nier-border/40 font-mono text-[11px] tracking-[0.15em] uppercase'
const GROUND = { backgroundColor: 'rgb(var(--c-ground) / 0.94)' }

export function AtriumName({ name }: { name: string }) {
  return (
    <div data-atrium-name="" title={name} className={`${CHIP} max-w-[16rem] text-nier-strong pointer-events-auto`} style={GROUND}>
      <span className="truncate">{name}</span>
    </div>
  )
}

// The zoom and the pointer's place. A component of its own, subscribed on its
// own: the place changes with every movement of the mouse, and nothing else
// on screen needs drawing again for it.
export function ViewReadout({ zoom }: { zoom: number }) {
  const { t } = useTranslation()
  const position = useGameStore(state => state.position)
  return (
    <div data-view-readout="" data-hud="true" className={`${CHIP} shrink-0 pointer-events-auto`} style={GROUND}>
      <span className="text-nier-bg/60">{t('atrium.hud.zoom')}</span>
      <span className="text-nier-strong tabular-nums tracking-wider">{Math.round(zoom * 100)}%</span>
      <span className="text-nier-bg/60">X</span>
      <span className="text-nier-strong tabular-nums tracking-wider -ml-2">{Math.round(position.x)}</span>
      <span className="text-nier-bg/60">Y</span>
      <span className="text-nier-strong tabular-nums tracking-wider -ml-2">{Math.round(position.y)}</span>
    </div>
  )
}
