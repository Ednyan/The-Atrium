// A drawing's strokes changed after they're drawn: their colour, width,
// softness and brush, painted again from what's kept of each (lib/drawingFiles
// changeStrokes) -- each change one step of undo. A drawing from before
// strokes were kept has only its picture, so only its colour can change.
//
// Each control applies as it's let go of -- the picker closed, the slider
// released -- not at every step of a drag through it: a change saves every
// stroke again.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { useGamePick } from '../store/gameStore'
import { asStrokeData, BUILTIN_BRUSHES, inkColour, strokesIn } from '../lib/brushes'
import { changeStrokes, loadDrawingPicture, type StrokeChange } from '../lib/drawingFiles'
import BrushGlyph, { BRUSH_LABELS } from './BrushGlyph'

const LABEL = 'text-nier-bg/75 text-[11px] tracking-[0.15em] uppercase whitespace-nowrap'

// An input that reports only when it's let go of: its native change event,
// which a colour picker fires as it closes and a range as it's released.
// React's onChange is the input event, every step of the way.
function useLetGo(commit: (value: string) => void) {
  const ref = useRef<HTMLInputElement>(null)
  const latest = useRef(commit)
  latest.current = commit
  useEffect(() => {
    const input = ref.current
    if (!input) return
    const letGo = () => latest.current(input.value)
    input.addEventListener('change', letGo)
    return () => input.removeEventListener('change', letGo)
  }, [])
  return ref
}

function RangeField({ label, value, min, max, step, disabled, onLetGo }: {
  label: string; value: number; min: number; max: number; step: number; disabled: boolean; onLetGo: (value: number) => void
}) {
  // Moves with the pointer; applies once released.
  const [shown, setShown] = useState(value)
  useEffect(() => setShown(value), [value])
  const ref = useLetGo(v => onLetGo(Number(v)))
  return (
    <div className="flex items-center gap-2">
      <span className={LABEL}>{label}</span>
      <input ref={ref} type="range" min={min} max={max} step={step} value={shown} disabled={disabled}
        onChange={e => setShown(Number(e.target.value))} className="flex-1 accent-nier-bg disabled:opacity-50" />
      <span className="text-nier-bg/80 text-xs w-8 text-right">{shown}</span>
    </div>
  )
}

export default function StrokeStyleField({ traceIds, lobbyId, userId }: { traceIds: string[]; lobbyId: string; userId: string | null }) {
  const { t } = useTranslation()
  const { traces } = useGamePick('traces')
  const [busy, setBusy] = useState(false)
  // The first stroke of the first of them that's kept: what the controls show.
  const first = traceIds
    .map(id => asStrokeData(traces.find(tr => tr.id === id)?.strokeData))
    .map(data => (data ? strokesIn(data)[0] : undefined))
    .find(Boolean) ?? null
  const firstTrace = traces.find(tr => tr.id === traceIds[0])

  // The colour shown: the first kept stroke's, or -- a drawing from before --
  // the colour its picture is drawn in.
  const [colour, setColour] = useState(first?.color ?? '#ffffff')
  useEffect(() => {
    if (first) {
      setColour(first.color)
      return
    }
    let live = true
    if (firstTrace?.mediaUrl) {
      void loadDrawingPicture(firstTrace.mediaUrl).then(picture => {
        const found = picture && inkColour(picture)
        if (live && found) setColour(found)
      })
    }
    return () => { live = false }
  }, [first?.color, firstTrace?.mediaUrl])

  const apply = (change: StrokeChange) => {
    setBusy(true)
    void changeStrokes(traceIds, change, lobbyId, userId).finally(() => setBusy(false))
  }
  const colourRef = useLetGo(picked => apply({ color: picked }))
  const brush = first?.brush ?? 'pen'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className={LABEL}>{t('atrium.draw.strokeColour')}</span>
        <input
          ref={colourRef}
          type="color"
          value={colour}
          disabled={busy}
          onChange={e => setColour(e.target.value)}
          className="atrium-swatch flex-1 h-7 cursor-pointer border border-nier-border/40 disabled:opacity-50"
        />
      </div>
      {/* Only what's kept can be painted again another way. */}
      {first && (
        <>
          <RangeField label={t('atrium.draw.width')} value={Math.round(first.width)} min={1} max={100} step={1} disabled={busy} onLetGo={width => apply({ width })} />
          <RangeField label={t('atrium.draw.hardness')} value={Math.round((first.hardness ?? 1) * 100)} min={0} max={100} step={1} disabled={busy} onLetGo={hardness => apply({ hardness: hardness / 100 })} />
          <div className="grid grid-cols-5 gap-1">
            {BUILTIN_BRUSHES.map(kind => (
              <button
                key={kind}
                type="button"
                disabled={busy}
                onClick={() => apply({ brush: kind })}
                title={t(BRUSH_LABELS[kind])}
                aria-label={t(BRUSH_LABELS[kind])}
                aria-pressed={brush === kind}
                className={`h-7 flex items-center justify-center border transition-colors disabled:opacity-50 ${
                  brush === kind
                    ? 'border-nier-bg bg-nier-bg/15 text-nier-strong'
                    : 'border-nier-border/40 text-nier-bg/70 hover:border-nier-border/70 hover:text-nier-strong'
                }`}
              >
                <BrushGlyph brush={kind} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
