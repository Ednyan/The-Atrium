// A drawing's strokes given another colour after they're drawn: each one's
// picture painted over in it, its shading kept (lib/brushes tintPicture), all
// of them as one step of undo (lib/drawingFiles recolourStrokes).
//
// Applied when the picker is closed -- its change event, not every step of a
// drag through it -- since each application saves every stroke again.

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { useGameStore } from '../store/gameStore'
import { inkColour } from '../lib/brushes'
import { loadDrawingPicture, recolourStrokes } from '../lib/drawingFiles'

export default function StrokeColourField({ traceIds, lobbyId, userId }: { traceIds: string[]; lobbyId: string; userId: string | null }) {
  const { t } = useTranslation()
  const [colour, setColour] = useState('#ffffff')
  const [busy, setBusy] = useState(false)
  const ids = traceIds.join(',')

  // Starts at the colour the first of them is drawn in.
  useEffect(() => {
    let live = true
    const first = useGameStore.getState().traces.find(tr => tr.id === traceIds[0])
    if (first?.mediaUrl) {
      void loadDrawingPicture(first.mediaUrl).then(picture => {
        const found = picture && inkColour(picture)
        if (live && found) setColour(found)
      })
    }
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  const inputRef = useRef<HTMLInputElement>(null)
  const apply = useRef((_: string) => {})
  apply.current = (picked: string) => {
    setBusy(true)
    void recolourStrokes(traceIds, picked, lobbyId, userId).finally(() => setBusy(false))
  }
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const commit = () => apply.current(input.value)
    input.addEventListener('change', commit)
    return () => input.removeEventListener('change', commit)
  }, [])

  return (
    <div className="flex items-center gap-2">
      <span className="text-nier-bg/75 text-[11px] tracking-[0.15em] uppercase whitespace-nowrap">{t('atrium.draw.strokeColour')}</span>
      <input
        ref={inputRef}
        type="color"
        value={colour}
        disabled={busy}
        onChange={e => setColour(e.target.value)}
        className="atrium-swatch flex-1 h-7 cursor-pointer border border-nier-border/40 disabled:opacity-50"
      />
    </div>
  )
}
