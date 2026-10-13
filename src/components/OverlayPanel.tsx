// The overlay (lib/overlay), beside the view bar in the desktop app: the
// window always on top, click-through, and its opacity -- as PureRef has them,
// with its keys: Ctrl+Shift+A, Ctrl+T.

import { useEffect, useRef } from 'react'
import { useTranslation } from '../lib/i18n'
import { opacityHere, MIN_OPACITY, setOverlay, useOverlay } from '../lib/overlay'
import { Switch } from './Customization'
import { Slider } from './ShapeStyleControls'

export default function OverlayPanel({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const overlay = useOverlay()
  const root = useRef<HTMLDivElement>(null)
  // Closed, it's still there for its slide: out of reach of Tab and readers.
  useEffect(() => { if (root.current) root.current.inert = !open }, [open])
  const percent = Math.round(overlay.opacity * 100)
  return (
    <div
      ref={root}
      data-overlay-panel=""
      data-hud="true"
      aria-hidden={!open}
      className="w-72 p-3 space-y-3 border border-nier-border/40 font-mono pointer-events-auto"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}
    >
      <Switch testId="on-top" label={t('atrium.overlay.onTop')} hint={t('atrium.overlay.onTopHint')} on={overlay.onTop} onChange={on => void setOverlay({ onTop: on })} />
      <Switch testId="click-through" label={t('atrium.overlay.clickThrough')} hint={t('atrium.overlay.clickThroughHint')} on={overlay.clickThrough} onChange={on => void setOverlay({ clickThrough: on })} />
      {opacityHere && (
        <Slider
          label={t('atrium.overlay.opacity', { value: percent })}
          min={Math.round(MIN_OPACITY * 100)} max={100} step={1} value={percent}
          onChange={value => void setOverlay({ opacity: value / 100 })}
        />
      )}
    </div>
  )
}
