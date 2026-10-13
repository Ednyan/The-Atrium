// The palette (lib/palette), beside the view bar: a row of colours, and two
// more rows opened out. A colour pressed goes on what's selected -- a shape's
// fill, a line's, text's, a frame's border (TraceOverlay) -- or, with nothing
// selected that takes one, is copied as its code. An empty place, pressed,
// takes a colour chosen by hand; the dropper takes one off the canvas (in
// Chrome and Edge, off anything on screen). I, over the canvas, does the same
// where the pointer is (LobbyScene).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '../lib/i18n'
import { APPLY_COLOUR_EVENT, PALETTE_ROW, PALETTE_SIZE, setColour, usePalette, type ApplyColour } from '../lib/palette'
import { hasNativePicker, nativePick, takeColour, takeColourAt } from '../lib/eyedropper'
import { useGameStore } from '../store/gameStore'
import { showToast } from '../lib/toast'
import { MenuIcon } from './AtriumMenu'

const DROPPER = 'M11 7l6 6M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4z'
const MORE = 'M6 9l6 6l6 -6'

export default function PalettePanel({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const slots = usePalette()
  const [more, setMore] = useState(false)
  const [picking, setPicking] = useState(false)
  const chooser = useRef<HTMLInputElement>(null)
  const choosing = useRef<number | null>(null)
  const root = useRef<HTMLDivElement>(null)

  // Closed, it's still there for its slide: out of reach of Tab and readers.
  useEffect(() => { if (root.current) root.current.inert = !open }, [open])
  useEffect(() => { if (!open) setPicking(false) }, [open])
  useEffect(() => {
    if (!picking) return
    const stop = (e: KeyboardEvent) => { if (e.key === 'Escape') setPicking(false) }
    window.addEventListener('keydown', stop)
    return () => window.removeEventListener('keydown', stop)
  }, [picking])

  const use = (colour: string) => {
    const ask: ApplyColour = { colour, applied: false }
    window.dispatchEvent(new CustomEvent(APPLY_COLOUR_EVENT, { detail: ask }))
    if (ask.applied) return
    void navigator.clipboard?.writeText(colour).then(
      () => showToast(t('atrium.palette.copied', { hex: colour })),
      () => showToast(colour),
    )
  }
  const choose = (index: number) => {
    choosing.current = index
    if (chooser.current) {
      chooser.current.value = slots[index] ?? '#ffffff'
      chooser.current.click()
    }
  }
  const drop = async () => {
    if (!hasNativePicker()) { setPicking(on => !on); return }
    const colour = await nativePick()
    if (colour) takeColour(colour)
  }

  const swatch = (index: number) => {
    const colour = slots[index]
    if (!colour) {
      return (
        <button
          key={index}
          type="button"
          data-palette-slot={index}
          onClick={() => choose(index)}
          title={t('atrium.palette.add')}
          aria-label={t('atrium.palette.add')}
          className="group relative w-9 h-9 border border-dashed border-nier-border/40 hover:border-nier-border/80 transition-colors"
        >
          <svg className="absolute inset-0 w-full h-full text-nier-border/40 group-hover:opacity-0 transition-opacity" preserveAspectRatio="none" viewBox="0 0 100 100" aria-hidden="true">
            <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-nier-strong text-base opacity-0 group-hover:opacity-100 transition-opacity">+</span>
        </button>
      )
    }
    return (
      <div key={index} className="group relative">
        <button
          type="button"
          data-palette-colour={colour}
          onClick={() => use(colour)}
          onContextMenu={e => { e.preventDefault(); choose(index) }}
          title={t('atrium.palette.swatch', { hex: colour })}
          aria-label={t('atrium.palette.swatch', { hex: colour })}
          className="block w-9 h-9 border border-nier-border/40 hover:border-nier-bg/80 p-[3px] transition-colors"
        >
          <span className="block w-full h-full" style={{ backgroundColor: colour }} />
        </button>
        <button
          type="button"
          onClick={() => setColour(index, null)}
          title={t('atrium.palette.remove')}
          aria-label={t('atrium.palette.remove')}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center text-[10px] leading-none border border-nier-border/60 text-nier-bg opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          style={{ backgroundColor: 'rgb(var(--c-ground))' }}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div
      ref={root}
      data-palette=""
      data-hud="true"
      aria-hidden={!open}
      className="flex items-start gap-1 p-1 border border-nier-border/40 font-mono pointer-events-auto"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}
    >
      <div>
        <div className="grid grid-cols-6 gap-1">
          {Array.from({ length: PALETTE_ROW }, (_, i) => swatch(i))}
        </div>
        {/* Two more rows, opened out below. */}
        <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: more ? '1fr' : '0fr' }}>
          <div className="min-h-0 overflow-hidden">
            <div className="grid grid-cols-6 gap-1 pt-1">
              {Array.from({ length: PALETTE_SIZE - PALETTE_ROW }, (_, i) => swatch(PALETTE_ROW + i))}
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-1 pl-1 border-l border-nier-border/30">
        <button
          type="button"
          data-palette-dropper=""
          onClick={() => void drop()}
          aria-pressed={picking}
          title={hasNativePicker() ? t('atrium.palette.pickAnywhere') : t('atrium.palette.pick')}
          aria-label={t('atrium.palette.pick')}
          className={`w-9 h-9 flex items-center justify-center border transition-colors ${
            picking ? 'bg-nier-bg text-nier-black border-nier-bg' : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg'
          }`}
        >
          <MenuIcon d={DROPPER} size={18} />
        </button>
        <button
          type="button"
          data-palette-more=""
          onClick={() => setMore(on => !on)}
          aria-expanded={more}
          title={more ? t('atrium.palette.fewer') : t('atrium.palette.more')}
          aria-label={more ? t('atrium.palette.fewer') : t('atrium.palette.more')}
          className="w-9 h-9 flex items-center justify-center border bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg transition-colors"
        >
          <span className={`transition-transform duration-300 ${more ? 'rotate-180' : ''}`}><MenuIcon d={MORE} size={18} /></span>
        </button>
      </div>
      {/* The browser's own colour chooser, for an empty place, or a colour
          right-clicked to change it. */}
      <input
        ref={chooser}
        type="color"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={e => { if (choosing.current !== null) setColour(choosing.current, e.target.value) }}
      />
      {/* Picking off the canvas, where the browser has no picker of its own:
          the next press takes the colour under it. Over the page, so it's
          fixed to the screen (the bar it opens from is moved by a transform). */}
      {picking && createPortal(
        <div
          data-palette-picking=""
          className="fixed inset-0 z-[10000] cursor-crosshair"
          onPointerDown={e => {
            e.preventDefault()
            e.stopPropagation()
            setPicking(false)
            void takeColourAt(e.clientX, e.clientY, useGameStore.getState().traces)
          }}
        >
          <div className="absolute top-20 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs font-mono text-nier-bg border border-nier-border/40 pointer-events-none" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}>
            {t('atrium.palette.pickHint')}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
