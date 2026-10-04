// What the atrium is, and where in it you are looking: its name, beside the
// menu's button at the top left; the zoom, as a percentage, and the pointer's
// place in the world, at the foot of the left edge. (Your own name is shown
// nowhere: you know it.)

import type { PointerEvent as ReactPointerEvent } from 'react'
import { useGameStore } from '../store/gameStore'
import { useTranslation } from '../lib/i18n'
import { MenuIcon } from './AtriumMenu'

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

// The zoom and the pointer's place, with what changes the view by hand: out
// and in either side of the zoom (pressed, the zoom itself goes back to 100%),
// and Move the view held: while it's pressed the pointer is gone and moving
// the mouse moves the view; let go, all is as it was. (The quick bar's Move,
// H, is the same as a tool that stays in hand.) A component
// of its own, subscribed on its own: the place changes with every movement of
// the mouse, and nothing else on screen needs drawing again for it.
// Arrows four ways (after Tabler's arrows-move, MIT): the button, and the
// cursor while it's on (TraceOverlay's OwnCursor).
export const PAN_ICON = 'M18 9l3 3l-3 3M15 12h6M6 9l-3 3l3 3M3 12h6M9 18l3 3l3 -3M12 15v6M15 6l-3 -3l-3 3M12 3v6'
const STEP = 'w-6 h-6 flex items-center justify-center border border-transparent text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-strong transition-colors'

export function ViewReadout({ zoom, onZoom, onZoomReset, holding, onHold }: {
  zoom: number
  onZoom: (direction: 1 | -1) => void
  onZoomReset: () => void
  holding: boolean
  onHold: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const { t } = useTranslation()
  const position = useGameStore(state => state.position)
  return (
    <div data-view-readout="" data-hud="true" className={`${CHIP} shrink-0 pointer-events-auto pl-1.5 pr-1.5 gap-2`} style={GROUND}>
      <button type="button" data-zoom="out" onClick={() => onZoom(-1)} aria-label={t('atrium.hud.zoomOut')} title={`${t('atrium.hud.zoomOut')} (−)`} className={STEP}>
        <MenuIcon d="M5 12h14" size={14} />
      </button>
      <button
        type="button"
        data-zoom="reset"
        onClick={onZoomReset}
        title={`${t('atrium.hud.zoomReset')} (0)`}
        // A button's text isn't the chip's: uppercase and spacing again.
        className="flex items-center gap-2 uppercase tracking-[0.15em] hover:text-nier-strong"
      >
        <span className="text-nier-bg/60">{t('atrium.hud.zoom')}</span>
        <span className="text-nier-strong tabular-nums tracking-wider min-w-[2.5rem]">{Math.round(zoom * 100)}%</span>
      </button>
      <button type="button" data-zoom="in" onClick={() => onZoom(1)} aria-label={t('atrium.hud.zoomIn')} title={`${t('atrium.hud.zoomIn')} (+)`} className={STEP}>
        <MenuIcon d="M12 5v14M5 12h14" size={14} />
      </button>
      <span className="w-px self-stretch my-2 bg-nier-border/30" />
      <span className="text-nier-bg/60">X</span>
      <span className="text-nier-strong tabular-nums tracking-wider -ml-1">{Math.round(position.x)}</span>
      <span className="text-nier-bg/60">Y</span>
      <span className="text-nier-strong tabular-nums tracking-wider -ml-1">{Math.round(position.y)}</span>
      <span className="w-px self-stretch my-2 bg-nier-border/30" />
      <button
        type="button"
        data-pan-hold=""
        onPointerDown={onHold}
        aria-pressed={holding}
        aria-label={t('atrium.hud.panHold')}
        title={t('atrium.hud.panHold')}
        className={holding ? 'w-6 h-6 flex items-center justify-center border bg-nier-bg text-nier-black border-nier-bg' : STEP}
      >
        <MenuIcon d={PAN_ICON} size={15} />
      </button>
    </div>
  )
}
