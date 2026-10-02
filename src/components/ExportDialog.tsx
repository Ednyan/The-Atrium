// Export, as Excalidraw's: the selection or the whole atrium, as an .atrium
// project file (lib/atriumFile) or a picture -- PNG or SVG, 1x to 3x, with or
// without the atrium's background (lib/exportImage) -- with a preview of the
// picture as it will be. A selection's picture is that selection alone, just
// big enough to hold it.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { useGamePick } from '../store/gameStore'
import { exportImage, type ExportScale } from '../lib/exportImage'
import { atriumFileBlob } from '../lib/atriumFile'
import { fileNameOf, saveFile } from '../lib/fileSave'
import { heldBy } from '../lib/frames'
import { showToast } from '../lib/toast'

export type Format = 'atrium' | 'png' | 'svg'

const FILTERS: Record<Format, { name: string; extensions: string[] }> = {
  atrium: { name: 'Atrium', extensions: ['atrium'] },
  png: { name: 'PNG', extensions: ['png'] },
  svg: { name: 'SVG', extensions: ['svg'] },
}

const choice = (on: boolean) => `flex-1 px-2 py-2 text-[10px] tracking-[0.12em] uppercase border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
  on ? 'bg-nier-bg text-nier-black border-nier-bg' : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
}`
const LABEL = 'block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2'

export default function ExportDialog({ lobbyName, lobbyMeta, background, selection, initialFormat = 'png', onClose }: {
  lobbyName: string
  lobbyMeta: { themeSettings: unknown; isPublic: boolean; maxPlayers: number }
  // The atrium's background, for a picture that keeps it.
  background: string
  // What was selected when it opened: offered first, when there's any.
  selection: string[]
  // What it's for: an .atrium file (Save Atrium to…), or -- any other -- a
  // picture (Export as image), which offers PNG and SVG.
  initialFormat?: Format
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { traces, links, layers, locations } = useGamePick('traces', 'links', 'layers', 'locations')
  const toFile = initialFormat === 'atrium'
  const formats: Format[] = toFile ? ['atrium'] : ['png', 'svg']
  // Saving the atrium means all of it, unless the selection is chosen.
  const [whole, setWhole] = useState(toFile || selection.length === 0)
  const [format, setFormat] = useState<Format>(initialFormat)
  const [scale, setScale] = useState<ExportScale>(2)
  const [withBackground, setWithBackground] = useState(true)
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // What's exported: the whole atrium, or the selection -- with what any
  // selected frame holds, as a frame is its contents.
  const scope = useMemo(() => {
    if (whole) return traces
    const chosen = new Set(selection)
    const frames = new Set(traces.filter(tr => chosen.has(tr.id) && tr.type === 'frame').map(tr => tr.id))
    for (const tr of heldBy(frames, traces)) chosen.add(tr.id)
    return traces.filter(tr => chosen.has(tr.id))
  }, [whole, traces, selection])

  // The picture, made again a moment after anything that changes it.
  const previewRef = useRef<string | null>(null)
  useEffect(() => {
    if (format === 'atrium' || scope.length === 0) { setPreview(null); return }
    let live = true
    const timer = window.setTimeout(async () => {
      try {
        const result = await exportImage(scope, links, layers, { format: 'png', scale, background: withBackground ? background : null })
        if (!live) return
        const url = URL.createObjectURL(result.blob)
        if (previewRef.current) URL.revokeObjectURL(previewRef.current)
        previewRef.current = url
        setPreview({ url, width: result.width, height: result.height })
      } catch {
        if (live) setPreview(null)
      }
    }, 250)
    return () => { live = false; window.clearTimeout(timer) }
  }, [format, scope, links, layers, scale, withBackground, background])
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current) }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [busy, onClose])

  const groupsIn = new Set(scope.map(tr => tr.layerId).filter(Boolean)).size
  const ids = new Set(scope.map(tr => tr.id))
  const linksIn = links.filter(l => ids.has(l.from) && ids.has(l.to)).length

  const run = async () => {
    if (scope.length === 0) return
    const name = `${fileNameOf(lobbyName)}${whole ? '' : '-selection'}.${format}`
    try {
      if (format === 'atrium') {
        setBusy(t('atrium.export.preparing'))
        const blob = await atriumFileBlob(
          { traces: scope, links, layers, locations: whole ? locations : [] },
          { name: lobbyName, ...lobbyMeta },
          (done, total) => setBusy(t('atrium.export.embedding', { done, total })),
        )
        if (!(await saveFile(blob, name, FILTERS.atrium))) { setBusy(null); return }
      } else {
        setBusy(t('atrium.export.preparing'))
        const result = await exportImage(scope, links, layers, { format, scale, background: withBackground ? background : null })
        if (!(await saveFile(result.blob, name, FILTERS[format]))) { setBusy(null); return }
        if (result.scale < scale) showToast(t('atrium.export.scaledDown', { scale: result.scale.toFixed(1), asked: scale }))
      }
      showToast(t('atrium.export.done'))
      onClose()
    } catch (e: any) {
      showToast(t('atrium.export.failed', { message: e?.message ?? '' }))
      setBusy(null)
    }
  }

  return (
    <div
      className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] pointer-events-auto"
      onClick={() => { if (!busy) onClose() }}
      role="dialog"
      aria-label={toFile ? t('atrium.hud.saveAtrium') : t('atrium.menu.exportImage')}
    >
      <div
        className="bg-nier-blackLight border border-nier-border/40 p-6 w-[440px] max-w-[calc(100vw-32px)] max-h-[90vh] overflow-y-auto relative font-mono"
        onClick={e => e.stopPropagation()}
        data-export-dialog=""
      >
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60 pointer-events-none" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60 pointer-events-none" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">{toFile ? t('atrium.hud.saveAtrium') : t('atrium.menu.exportImage')}</h2>
        </div>

        <div className="space-y-4">
          <div>
            <span className={LABEL}>{t('atrium.export.what')}</span>
            <div className="flex gap-2">
              <button type="button" data-scope="selection" disabled={selection.length === 0} onClick={() => setWhole(false)} className={choice(!whole)}>
                {t('atrium.export.selection', { count: selection.length })}
              </button>
              <button type="button" data-scope="whole" onClick={() => setWhole(true)} className={choice(whole)}>{t('atrium.export.whole')}</button>
            </div>
          </div>

          {formats.length > 1 && <div>
            <span className={LABEL}>{t('atrium.export.format')}</span>
            <div className="flex gap-2">
              {formats.map(f => (
                <button key={f} type="button" data-format={f} onClick={() => setFormat(f)} className={choice(format === f)}>
                  {f === 'atrium' ? t('atrium.export.formatAtrium') : f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>}

          {format === 'atrium' ? (
            <div className="space-y-1">
              <p className="text-nier-bg/80 text-xs tracking-wider">{t('atrium.export.summary', { traces: scope.length, groups: groupsIn, links: linksIn })}</p>
              <p className="text-nier-bg/60 text-[11px] tracking-wide leading-relaxed">{t('atrium.export.atriumHint')}</p>
            </div>
          ) : (
            <>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <span className={LABEL}>{t('atrium.export.scale')}</span>
                  <div className="flex gap-2">
                    {([1, 2, 3] as const).map(s => (
                      <button key={s} type="button" data-scale={s} onClick={() => setScale(s)} className={choice(scale === s)}>{s}×</button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer pb-2 text-nier-bg/80 text-[11px] tracking-[0.1em] uppercase">
                  <input type="checkbox" checked={withBackground} onChange={e => setWithBackground(e.target.checked)} className="accent-nier-bg" />
                  {t('atrium.export.background')}
                </label>
              </div>
              {/* As it will be: checked against the background it may go onto. */}
              <div
                className="h-52 border border-nier-border/30 flex items-center justify-center overflow-hidden"
                style={{ backgroundImage: 'repeating-conic-gradient(rgb(var(--c-fg) / 0.08) 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}
              >
                {preview
                  ? <img data-export-preview="" src={preview.url} alt="" className="max-w-full max-h-full object-contain" />
                  : <span className="text-nier-bg/50 text-[11px] tracking-[0.15em] uppercase">{t('atrium.export.preparing')}</span>}
              </div>
              {preview && format === 'png' && (
                <p className="text-nier-bg/60 text-[11px] tracking-wide text-right">{t('atrium.export.pixels', { width: preview.width, height: preview.height })}</p>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          <button type="button" onClick={onClose} disabled={!!busy} className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-2.5 text-[11px] tracking-[0.15em] uppercase transition-colors disabled:opacity-40">
            {t('common.cancel')}
          </button>
          <button type="button" data-export-run="" onClick={() => void run()} disabled={!!busy || scope.length === 0} className="flex-1 bg-nier-bg text-nier-black py-2.5 text-[11px] tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-50">
            {busy ?? t('atrium.export.run')}
          </button>
        </div>
      </div>
    </div>
  )
}
