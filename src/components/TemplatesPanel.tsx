// Templates: an inventory beside the canvas. Folders inside folders, ready-made
// traces dragged out of them onto the canvas -- or clicked, to land in the middle
// of the view -- and a few pinned at the foot, to hand. Pins are kept on this
// device, as the quick bar's order is.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { isCanvasTarget } from '../lib/editableTarget'
import { allTemplates, DIGITAL_ATRIUM_FOLDER, type TemplateContext, type TemplateFolder, type TemplateItem, type TemplateNode } from '../lib/templates'
import type { AtriumFile } from '../lib/atriumFormat'

const PINS_KEY = 'atrium.templates.quick'
const MOST_PINNED = 8
const DRAG_PX = 4

const readPins = (): string[] => {
  try {
    const kept = JSON.parse(localStorage.getItem(PINS_KEY) ?? '[]')
    return Array.isArray(kept) ? kept.filter(id => typeof id === 'string').slice(0, MOST_PINNED) : []
  } catch { return [] }
}

// The template as a little plan of itself.
function Thumb({ file, size = 44 }: { file: AtriumFile; size?: number }) {
  const rows = file.traces as any[]
  const left = Math.min(...rows.map(r => r.position_x - r.width / 2)), right = Math.max(...rows.map(r => r.position_x + r.width / 2))
  const top = Math.min(...rows.map(r => r.position_y - r.height / 2)), bottom = Math.max(...rows.map(r => r.position_y + r.height / 2))
  const pad = Math.max(right - left, bottom - top) * 0.04
  return (
    <svg width={size} height={size * 0.72} viewBox={`${left - pad} ${top - pad} ${right - left + pad * 2} ${bottom - top + pad * 2}`} aria-hidden="true" className="shrink-0 text-nier-bg">
      {rows.map((r, i) => {
        const shape = r.type === 'shape'
        const wordsAlone = r.type === 'text' && !r.show_background
        if (wordsAlone) return <rect key={i} x={r.position_x - r.width * 0.3} y={r.position_y - r.height * 0.12} width={r.width * 0.6} height={r.height * 0.24} fill="currentColor" opacity={0.45} />
        return (
          <rect
            key={i}
            x={r.position_x - r.width / 2} y={r.position_y - r.height / 2} width={r.width} height={r.height}
            fill={shape ? r.shape_color : r.type === 'text' ? 'currentColor' : 'none'}
            fillOpacity={shape ? 1 : 0.25}
            stroke={shape ? 'none' : 'currentColor'}
            strokeWidth={Math.max(right - left, bottom - top) * 0.012}
            vectorEffect="none"
          />
        )
      })}
    </svg>
  )
}

export default function TemplatesPanel({ context, onPlace, onClose }: {
  context: TemplateContext
  // A template to place: where the pointer let go, or (none) the middle of the view.
  onPlace: (file: AtriumFile, screen?: { x: number; y: number }) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [pins, setPins] = useState(readPins)
  const [open, setOpen] = useState<Set<string>>(() => new Set(['digital-atrium', 'boards', 'diagrams', 'pieces']))
  const [ghost, setGhost] = useState<{ template: TemplateItem; x: number; y: number } | null>(null)
  const press = useRef<{ template: TemplateItem; x: number; y: number; dragging: boolean } | null>(null)

  const nameOf = (name: string) => (name.startsWith('templates.') ? t(name as any) : name)
  // Made once for the panel: a plan of each to show.
  const files = useMemo(() => new Map(allTemplates(DIGITAL_ATRIUM_FOLDER).map(template => [template.id, template.build(context)])), [context])
  const byId = useMemo(() => new Map(allTemplates(DIGITAL_ATRIUM_FOLDER).map(template => [template.id, template])), [])
  const pinned = pins.flatMap(id => byId.get(id) ?? [])

  useEffect(() => {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(pins)) } catch { /* for this visit, then */ }
  }, [pins])

  // Esc drops what's being dragged, and otherwise closes the panel.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (press.current?.dragging) { press.current = null; setGhost(null) }
      else onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  const togglePin = (id: string) => setPins(now => (now.includes(id) ? now.filter(pin => pin !== id) : now.length < MOST_PINNED ? [...now, id] : now))

  const dragHandlers = (template: TemplateItem) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      press.current = { template, x: e.clientX, y: e.clientY, dragging: false }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const held = press.current
      if (!held) return
      if (!held.dragging && Math.hypot(e.clientX - held.x, e.clientY - held.y) < DRAG_PX) return
      held.dragging = true
      setGhost({ template, x: e.clientX, y: e.clientY })
    },
    onPointerUp: (e: React.PointerEvent) => {
      const held = press.current
      press.current = null
      setGhost(null)
      if (!held) return
      // Each drop is built anew: its ids are its own, however many are placed.
      if (!held.dragging) { onPlace(template.build(context)); return }
      if (isCanvasTarget(document.elementFromPoint(e.clientX, e.clientY))) onPlace(template.build(context), { x: e.clientX, y: e.clientY })
    },
    onPointerCancel: () => { press.current = null; setGhost(null) },
  })

  const renderNode = (node: TemplateNode, depth: number) => {
    if (node.kind === 'folder') return renderFolder(node, depth)
    const pin = pins.includes(node.id)
    return (
      <div key={node.id} className="group flex items-center gap-1" style={{ paddingLeft: depth * 12 }}>
        <button
          type="button"
          data-template={node.id}
          {...dragHandlers(node)}
          title={t('templates.hint')}
          className="flex-1 min-w-0 flex items-center gap-2 p-1.5 border border-transparent hover:border-nier-border/50 cursor-grab active:cursor-grabbing select-none touch-pan-y text-left transition-colors"
        >
          <Thumb file={files.get(node.id)!} />
          <span className="min-w-0 truncate text-nier-strong text-xs">{nameOf(node.name)}</span>
        </button>
        <button
          type="button"
          data-template-pin={node.id}
          aria-pressed={pin}
          aria-label={t(pin ? 'templates.unpin' : 'templates.pin')}
          title={t(pin ? 'templates.unpin' : 'templates.pin')}
          disabled={!pin && pins.length >= MOST_PINNED}
          onClick={() => togglePin(node.id)}
          className={`shrink-0 w-7 h-7 flex items-center justify-center transition-opacity disabled:hidden ${pin ? 'text-nier-strong opacity-100' : 'text-nier-bg/70 opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100'}`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={pin ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M9 3.5 H15 L14 9 L17 12 H7 L10 9 Z M12 12 V20.5" /></svg>
        </button>
      </div>
    )
  }

  const renderFolder = (folder: TemplateFolder, depth: number) => {
    const isOpen = open.has(folder.id)
    return (
      <div key={folder.id} data-template-folder={folder.id}>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setOpen(now => { const next = new Set(now); if (isOpen) next.delete(folder.id); else next.add(folder.id); return next })}
          className="w-full flex items-center gap-2 py-1.5 text-left text-nier-bg/85 hover:text-nier-strong transition-colors"
          style={{ paddingLeft: depth * 12 }}
        >
          <span aria-hidden="true" className="w-3 text-[10px]">{isOpen ? '▾' : '▸'}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M4 5.5 H9.5 L11.5 8 H20 V18.5 H4 Z" /></svg>
          <span className="text-[11px] tracking-[0.12em] uppercase">{nameOf(folder.name)}</span>
        </button>
        {isOpen && folder.items.map(node => renderNode(node, depth + 1))}
      </div>
    )
  }

  return (
    <div
      data-templates-panel=""
      data-ui-element="true"
      className="layer-panel docked-panel panel-in-right fixed flex flex-col w-80 top-20 h-[calc(100vh-160px)] border-2 border-nier-bg shadow-2xl overflow-hidden font-mono"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.98)' }}
      onWheel={e => e.stopPropagation()}
    >
      <div className="shrink-0 bg-nier-black border-b border-nier-border/40 p-3 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rotate-45 border border-gray-400" />
          <h2 className="text-sm text-nier-strong tracking-[0.15em] uppercase">{t('templates.title')}</h2>
        </div>
        <button type="button" data-templates-close="" onClick={onClose} aria-label={t('common.close')} className="w-7 h-7 flex items-center justify-center text-nier-bg/70 hover:text-nier-strong transition-colors">×</button>
      </div>
      <p className="shrink-0 px-3 pt-3 text-nier-bg/60 text-[11px] leading-relaxed">{t('templates.hint')}</p>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">{renderFolder(DIGITAL_ATRIUM_FOLDER, 0)}</div>
      {/* To hand: what's pinned, dragged or clicked as it is above. */}
      <div data-template-quick="" className="shrink-0 border-t border-nier-border/30 p-3">
        <p className="mb-2 text-nier-bg/70 text-[10px] tracking-[0.15em] uppercase">{t('templates.quick')}</p>
        {pinned.length === 0 ? (
          <p className="text-nier-bg/55 text-[11px] leading-relaxed">{t('templates.quickHint', { most: MOST_PINNED })}</p>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {pinned.map(template => (
              <button
                key={template.id}
                type="button"
                data-template-quick-item={template.id}
                {...dragHandlers(template)}
                title={nameOf(template.name)}
                aria-label={nameOf(template.name)}
                className="flex items-center justify-center p-1.5 border border-nier-border/30 hover:border-nier-bg cursor-grab active:cursor-grabbing select-none touch-none transition-colors"
              >
                <Thumb file={files.get(template.id)!} size={48} />
              </button>
            ))}
          </div>
        )}
      </div>
      {ghost && (
        <div
          data-template-ghost=""
          className="fixed z-[10000300] pointer-events-none flex items-center gap-2 px-2 py-1.5 border border-nier-bg text-nier-strong text-xs"
          style={{ left: ghost.x + 12, top: ghost.y + 12, backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}
        >
          <Thumb file={files.get(ghost.template.id)!} />
          {nameOf(ghost.template.name)}
        </div>
      )}
    </div>
  )
}
