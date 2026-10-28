// A trace's look (lib/traceLook): the SVG filter its picture is drawn through,
// and the controls that set it.
//
// The filter, by `filter: url(#id)`: the exposure's gain on linear light, then
// brightness and contrast on the shown values -- each step in its own space,
// as an EXR's grade does them -- over the picture's box exactly, so nothing
// spills past its edges.

import { useTranslation } from '../lib/i18n'
import { Slider } from './ShapeStyleControls'
import { lookSteps, NEUTRAL_LOOK, type TraceLook } from '../lib/traceLook'

export default function LookFilter({ id, look }: { id: string; look: TraceLook }) {
  const { gain, slope, intercept } = lookSteps(look)
  return (
    <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
      <filter id={id} x="0" y="0" width="1" height="1">
        <feComponentTransfer colorInterpolationFilters="linearRGB">
          <feFuncR type="linear" slope={gain} />
          <feFuncG type="linear" slope={gain} />
          <feFuncB type="linear" slope={gain} />
        </feComponentTransfer>
        <feComponentTransfer colorInterpolationFilters="sRGB">
          <feFuncR type="linear" slope={slope} intercept={intercept} />
          <feFuncG type="linear" slope={slope} intercept={intercept} />
          <feFuncB type="linear" slope={slope} intercept={intercept} />
        </feComponentTransfer>
      </filter>
    </svg>
  )
}

const signed = (v: number, digits = 0) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`

/** Its three controls, as an EXR's (ExrGradePanel), and Reset: each move a
 *  new look, shown at once. Reset is the neutral look, kept as such. */
export function LookControls({ look, onChange }: { look: TraceLook; onChange: (look: TraceLook) => void }) {
  const { t } = useTranslation()
  const set = (change: Partial<TraceLook>) => onChange({ ...look, ...change })
  return (
    <div className="space-y-2.5">
      <Slider label={t('atrium.customize.rowExposure')} min={-3} max={3} step={0.1} value={look.exposure} shown={signed(look.exposure, 1)} onChange={exposure => set({ exposure })} />
      <Slider label={t('atrium.customize.rowBrightness')} min={-100} max={100} step={1} value={Math.round(look.brightness * 100)} shown={signed(Math.round(look.brightness * 100))} onChange={v => set({ brightness: v / 100 })} />
      <Slider label={t('atrium.customize.rowContrast')} min={-100} max={100} step={1} value={Math.round(look.contrast * 100)} shown={signed(Math.round(look.contrast * 100))} onChange={v => set({ contrast: v / 100 })} />
      <button
        type="button"
        onClick={() => onChange(NEUTRAL_LOOK)}
        className="h-8 px-3 border border-nier-border/40 text-nier-bg text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/80"
      >
        {t('atrium.exr.reset')}
      </button>
    </div>
  )
}
