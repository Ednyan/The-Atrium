// The overlay (lib/overlay), under its button in the desktop app's view bar:
// the window always on top, click-through -- the menus still clickable, or
// not -- the menus hidden, its background gone, its canvas's opacity, as
// PureRef has them, with its keys: Ctrl+Shift+A, Ctrl+T. And the way out of
// it all.

import { useTranslation } from '../lib/i18n'
import { exitOverlay, inOverlayMode, seeThroughHere, setOverlay, useOverlay } from '../lib/overlay'
import { Switch } from './Customization'
import { Slider } from './ShapeStyleControls'

export default function OverlayPanel() {
  const { t } = useTranslation()
  const overlay = useOverlay()
  return (
    <div
      data-overlay-panel=""
      data-hud="true"
      className="panel-in w-72 p-3 space-y-3 border border-nier-border/40 font-mono pointer-events-auto"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.97)' }}
    >
      <Switch testId="on-top" label={t('atrium.overlay.onTop')} hint={t('atrium.overlay.onTopHint')} on={overlay.onTop} onChange={on => void setOverlay({ onTop: on })} />
      <Switch testId="click-through" label={t('atrium.overlay.clickThrough')} hint={t('atrium.overlay.clickThroughHint')} on={overlay.clickThrough} onChange={on => void setOverlay({ clickThrough: on })} />
      {seeThroughHere && (
        <div className="pl-3 border-l border-nier-border/40">
          <Switch testId="menus-clickable" label={t('atrium.overlay.menusClickable')} hint={t('atrium.overlay.menusClickableHint')} on={overlay.menusClickable} onChange={on => void setOverlay({ menusClickable: on })} />
        </div>
      )}
      <Switch testId="hide-menus" label={t('atrium.overlay.hideMenus')} hint={t('atrium.overlay.hideMenusHint')} on={overlay.hideMenus} onChange={on => void setOverlay({ hideMenus: on })} />
      {seeThroughHere && (
        <>
          <Switch testId="clear-background" label={t('atrium.overlay.clearBackground')} hint={t('atrium.overlay.clearBackgroundHint')} on={overlay.clearBackground} onChange={on => void setOverlay({ clearBackground: on })} />
          <Slider
            label={t('atrium.overlay.opacity', { value: Math.round(overlay.opacity * 100) })}
            min={0} max={100} step={1} value={Math.round(overlay.opacity * 100)}
            onChange={value => void setOverlay({ opacity: value / 100 })}
          />
        </>
      )}
      {inOverlayMode(overlay) && (
        <div className="pt-1 space-y-1.5">
          <button type="button" data-exit-overlay="" onClick={() => void exitOverlay()} className="w-full py-1.5 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.12em] uppercase hover:border-nier-bg">
            {t('atrium.overlay.exit')}
          </button>
          <p className="text-nier-bg/60 text-[10px] leading-relaxed">{t('atrium.overlay.exitHint')}</p>
        </div>
      )}
    </div>
  )
}
