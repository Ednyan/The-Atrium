// A trace's look (lib/traceLook): the SVG filter its picture is drawn through,
// and the controls that set it.
//
// The filter, by `filter: url(#id)`: the exposure's gain on linear light, then
// brightness and contrast on the shown values -- each step in its own space,
// as an EXR's grade does them -- over the picture's box exactly, so nothing
// spills past its edges.

import { useTranslation } from '../lib/i18n'
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

const LABEL = 'block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2'
const signed = (v: number, digits = 0) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`

/** Its three controls, as an EXR's (ExrGradePanel), and Reset: each move a
 *  new look, shown at once. Reset is the neutral look, kept as such. */
export function LookControls({ look, onChange }: { look: TraceLook; onChange: (look: TraceLook) => void }) {
  const { t } = useTranslation()
  const set = (change: Partial<TraceLook>) => onChange({ ...look, ...change })
  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL}>{t('atrium.exr.exposure', { value: signed(look.exposure, 1) })}</label>
        <input type="range" min="-3" max="3" step="0.1" value={look.exposure} onChange={e => set({ exposure: parseFloat(e.target.value) })} className="w-full accent-nier-bg" />
      </div>
      <div>
        <label className={LABEL}>{t('atrium.exr.brightness', { value: signed(Math.round(look.brightness * 100)) })}</label>
        <input type="range" min="-100" max="100" step="1" value={Math.round(look.brightness * 100)} onChange={e => set({ brightness: parseInt(e.target.value, 10) / 100 })} className="w-full accent-nier-bg" />
      </div>
      <div>
        <label className={LABEL}>{t('atrium.exr.contrast', { value: signed(Math.round(look.contrast * 100)) })}</label>
        <input type="range" min="-100" max="100" step="1" value={Math.round(look.contrast * 100)} onChange={e => set({ contrast: parseInt(e.target.value, 10) / 100 })} className="w-full accent-nier-bg" />
      </div>
      <button
        type="button"
        onClick={() => onChange(NEUTRAL_LOOK)}
        className="px-3 py-1.5 border border-nier-border/40 text-nier-bg text-xs tracking-[0.1em] uppercase hover:border-nier-border/80"
      >
        {t('atrium.exr.reset')}
      </button>
    </div>
  )
}
