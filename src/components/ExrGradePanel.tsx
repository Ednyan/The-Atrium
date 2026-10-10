// An EXR trace's colour (lib/exr): exposure, brightness and contrast, the
// colour space its light is in, the view transform it's shown through, and a
// LUT -- one of ours, or a .cube file. Moved, a control grades a small picture to show at once
// (onPreview); let go, the whole picture is graded, kept as a new file, and
// the trace pointed at it -- one step of undo (onCommit).

import { useEffect, useRef, useState } from 'react'
import type { Trace } from '../types/database'
import { EXR_INPUTS, EXR_VIEWS, LUT_PRESETS, lutKey, parseCube, type ExrGrade, type ExrLook, type ExrLut, type LutPreset } from '../lib/exr'
import { ExrSourceMissing, gradeExrSource, rememberLut } from '../lib/exrGrade'
import { uploadTraceFile } from '../lib/traceUpload'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'

// Across, at most, the picture shown while a control moves.
const PREVIEW_SIDE = 1024

const lookOf = (grade: ExrGrade): ExrLook => ({ view: grade.view, input: grade.input, exposure: grade.exposure, brightness: grade.brightness, contrast: grade.contrast })
const same = (a: ExrLook, b: ExrLook) => (Object.keys(a) as (keyof ExrLook)[]).every(k => a[k] === b[k])

const LABEL = 'block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2'
const SELECT = 'w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60 disabled:opacity-40'
const BUTTON = 'px-3 py-1.5 border border-nier-border/40 text-nier-bg text-xs tracking-[0.1em] uppercase hover:border-nier-border/80 disabled:opacity-40'

export default function ExrGradePanel({ trace, lobbyId, userId, onPreview, onCommit }: {
  trace: Trace & { exr: ExrGrade }
  lobbyId: string
  userId: string
  onPreview: (traceId: string, url: string | null) => void
  onCommit: (traceId: string, updates: Partial<Trace>) => void
}) {
  const { t } = useTranslation()
  const grade = trace.exr
  const [look, setLook] = useState<ExrLook>(() => lookOf(grade))
  const [lut, setLut] = useState(grade.lut)
  const [status, setStatus] = useState<'idle' | 'busy' | 'missing' | { error: string }>('idle')

  // What's kept (the trace's), and what's shown: the preview's file, let go
  // when the next takes its place.
  const kept = useRef({ look: lookOf(grade), lut: grade.lut })
  const shown = useRef<string | null>(null)
  // Closed, a grade still finishing keeps its file but shows nothing: the
  // trace shows its own file from then on.
  const open = useRef(true)
  const show = (url: string | null) => {
    if (shown.current) URL.revokeObjectURL(shown.current)
    shown.current = open.current ? url : null
    if (!open.current) { if (url) URL.revokeObjectURL(url); return }
    onPreview(trace.id, url)
  }

  // One grade at a time; asked again while one runs, only the latest is done
  // after it.
  const running = useRef(false)
  const next = useRef<{ look: ExrLook; lut?: ExrLut; full: boolean } | null>(null)
  const run = async (job: { look: ExrLook; lut?: ExrLut; full: boolean }) => {
    if (running.current) { next.current = job.full || !next.current?.full ? job : next.current; return }
    running.current = true
    setStatus('busy')
    try {
      const image = await gradeExrSource(grade.source, job.look, job.lut, job.full ? undefined : PREVIEW_SIDE)
      if (job.full) {
        const name = `${(trace.content || 'exr').replace(/[^\w.-]+/g, '_')}.png`
        const url = await uploadTraceFile(new File([image], name, { type: 'image/png' }), lobbyId, userId)
        kept.current = { look: job.look, lut: job.lut }
        onCommit(trace.id, { mediaUrl: url, exr: { ...grade, ...job.look, lut: job.lut } })
      }
      show(URL.createObjectURL(image))
      setStatus('idle')
    } catch (error) {
      setStatus(error instanceof ExrSourceMissing ? 'missing' : { error: error instanceof Error ? error.message : String(error) })
    } finally {
      running.current = false
      const queued = next.current
      next.current = null
      if (queued) void run(queued)
    }
  }

  const preview = (nextLook: ExrLook, nextLut = lut) => void run({ look: nextLook, lut: nextLut, full: false })
  const commit = (nextLook = look, nextLut = lut) => {
    if (same(nextLook, kept.current.look) && lutKey(nextLut) === lutKey(kept.current.lut)) return
    void run({ look: nextLook, lut: nextLut, full: true })
  }

  // Changed and not yet kept when the panel closes: kept then. The preview
  // goes, and the trace shows its own file again.
  const latest = useRef({ look, lut, commit, onPreview, id: trace.id })
  latest.current = { look, lut, commit, onPreview, id: trace.id }
  useEffect(() => () => {
    const last = latest.current
    last.commit(last.look, last.lut)
    open.current = false
    if (shown.current) URL.revokeObjectURL(shown.current)
    shown.current = null
    last.onPreview(last.id, null)
  }, [])

  const set = (change: Partial<ExrLook>, now = false) => {
    const nextLook = { ...look, ...change }
    setLook(nextLook)
    if (now) commit(nextLook)
    else preview(nextLook)
  }
  // A slider keeps its picture when it's let go of -- by the pointer, or the keys.
  const release = { onPointerUp: () => commit(), onKeyUp: () => commit(), onBlur: () => commit() }

  const fileInput = useRef<HTMLInputElement>(null)
  const loadLut = async (file: File) => {
    try {
      const text = await file.text()
      parseCube(text)
      const url = await uploadTraceFile(file, lobbyId, userId)
      rememberLut(url, text)
      const nextLut = { url, name: file.name }
      setLut(nextLut)
      commit(look, nextLut)
    } catch (error) {
      setStatus({ error: t('atrium.exr.lutUnreadable', { reason: error instanceof Error ? error.message : String(error) }) })
    }
  }

  const missing = status === 'missing'
  const isData = look.view === 'data'
  const signed = (v: number, digits = 0) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`

  return (
    <>
      <div>
        <label className={LABEL}>{t('atrium.exr.view')}</label>
        <select value={look.view} disabled={missing} onChange={e => set({ view: e.target.value as ExrLook['view'] }, true)} className={SELECT}>
          {EXR_VIEWS.map(view => <option key={view} value={view}>{t(`atrium.exr.view.${view}` as TranslationKey)}</option>)}
        </select>
      </div>
      <div>
        <label className={LABEL}>{t('atrium.exr.input')}</label>
        <select value={look.input} disabled={missing || isData} onChange={e => set({ input: e.target.value as ExrLook['input'] }, true)} className={SELECT}>
          {EXR_INPUTS.map(input => <option key={input} value={input}>{t(`atrium.exr.input.${input}` as TranslationKey)}</option>)}
        </select>
      </div>
      <div>
        <label className={LABEL}>{t('atrium.exr.exposure', { value: signed(look.exposure, 1) })}</label>
        <input type="range" min="-6" max="6" step="0.1" value={look.exposure} disabled={missing || isData}
          onChange={e => set({ exposure: parseFloat(e.target.value) })} {...release} className="w-full accent-nier-bg disabled:opacity-40" />
      </div>
      <div>
        <label className={LABEL}>{t('atrium.exr.brightness', { value: signed(Math.round(look.brightness * 100)) })}</label>
        <input type="range" min="-100" max="100" step="1" value={Math.round(look.brightness * 100)} disabled={missing}
          onChange={e => set({ brightness: parseInt(e.target.value, 10) / 100 })} {...release} className="w-full accent-nier-bg disabled:opacity-40" />
      </div>
      <div>
        <label className={LABEL}>{t('atrium.exr.contrast', { value: signed(Math.round(look.contrast * 100)) })}</label>
        <input type="range" min="-100" max="100" step="1" value={Math.round(look.contrast * 100)} disabled={missing}
          onChange={e => set({ contrast: parseInt(e.target.value, 10) / 100 })} {...release} className="w-full accent-nier-bg disabled:opacity-40" />
      </div>
      <div>
        <label className={LABEL}>{t('atrium.exr.lut')}</label>
        <div className="flex items-center gap-2">
          <select
            value={!lut ? 'none' : 'preset' in lut ? lut.preset : 'file'}
            disabled={missing}
            onChange={e => {
              const value = e.target.value
              if (value === 'file') return
              const nextLut = value === 'none' ? undefined : { preset: value as LutPreset }
              setLut(nextLut)
              commit(look, nextLut)
            }}
            className={`${SELECT} min-w-0 flex-1`}
          >
            <option value="none">{t('atrium.exr.lutNone')}</option>
            {LUT_PRESETS.map(preset => <option key={preset} value={preset}>{t(`atrium.exr.preset.${preset}` as TranslationKey)}</option>)}
            {lut && 'url' in lut && <option value="file">{lut.name}</option>}
          </select>
          <button type="button" disabled={missing} onClick={() => fileInput.current?.click()} className={`${BUTTON} shrink-0 py-2`}>{t('atrium.exr.lutLoad')}</button>
          <input ref={fileInput} type="file" accept=".cube" className="hidden"
            onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void loadLut(file) }} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={missing || (look.exposure === 0 && look.brightness === 0 && look.contrast === 0)}
          onClick={() => set({ exposure: 0, brightness: 0, contrast: 0 }, true)} className={BUTTON}>{t('atrium.exr.reset')}</button>
        <span role="status" className="min-w-0 text-[0.7rem] leading-relaxed tracking-wide text-nier-bg/60">
          {status === 'busy' ? t('atrium.exr.grading')
            : missing ? t('atrium.exr.missing')
            : typeof status === 'object' ? t('atrium.exr.failed', { reason: status.error })
            : null}
        </span>
      </div>
    </>
  )
}
