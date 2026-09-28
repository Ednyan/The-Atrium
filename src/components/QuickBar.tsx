// The quick bar: a column of tools down the left edge, one per kind of trace
// and what makes one, instead of reaching for the canvas menu or the Leave
// Trace panel.
//
// Two kinds of tool. Those that need a place -- text, square, circle, path,
// frame -- are armed: the next press on the canvas places the trace, a click
// where it goes or a drag for its size (LobbyScene). Esc, the select tool, or
// placing one lets go of it. The rest act at once: Draw toggles drawing,
// Image and Embed open the Leave Trace panel on that type, and Pinterest
// opens the board import.
//
// Keys 1 to 9 pick the first nine, in the order shown.
//
// Select has two kinds, in a flyout at its side (as the canvas menu's
// Transformations has): Select, which takes a group whole, and Direct
// select, which takes the trace itself wherever it is -- in a group, in a
// frame. The button shows the kind in use.

import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'

export type PlaceTool = 'text' | 'rectangle' | 'circle' | 'path' | 'frame'
export type QuickAction = 'select' | PlaceTool | 'draw' | 'image' | 'embed' | 'pinterest'

// Drawn in a 24 box, stroked in the current colour.
const ICONS: Record<QuickAction, ReactNode> = {
  select: <path d="M6 3.5 L18 12 L12.6 13.1 L15.4 19.2 L13.2 20.2 L10.4 14.2 L6 17.6 Z" strokeLinejoin="round" />,
  text: <path d="M5 6 V4.5 H19 V6 M12 4.5 V19.5 M9 19.5 H15" strokeLinecap="round" strokeLinejoin="round" />,
  rectangle: <rect x="4.5" y="5.5" width="15" height="13" />,
  circle: <circle cx="12" cy="12" r="7.5" />,
  path: (
    <>
      <path d="M4 18.5 L9.5 11 L13.5 14.5 L19.5 6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 5.6 L19.5 6 L19.3 10" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  draw: <path d="M5 19 L6 15 L16 5 L19 8 L9 18 Z M14 7 L17 10" strokeLinejoin="round" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" />
      <path d="M3.5 16 L8.5 11.5 L12.5 15 L15 12.5 L20.5 17.5" strokeLinejoin="round" />
      <circle cx="15.5" cy="9" r="1.4" />
    </>
  ),
  embed: <path d="M9 7 L4 12 L9 17 M15 7 L20 12 L15 17" strokeLinecap="round" strokeLinejoin="round" />,
  frame: <path d="M8 3 V21 M16 3 V21 M3 8 H21 M3 16 H21" strokeLinecap="round" />,
  pinterest: (
    <>
      <path d="M9 3.5 H15 L14 9 L17 12 H7 L10 9 Z" strokeLinejoin="round" />
      <path d="M12 12 V20.5" strokeLinecap="round" />
    </>
  ),
}

// Direct select: the pointer, into a dashed box.
const DIRECT_ICON = (
  <>
    <rect x="3.5" y="3.5" width="11" height="11" strokeDasharray="2 2" />
    <path d="M10 9 L19 15.5 L15 16.3 L17 20.6 L15.4 21.3 L13.4 17 L10 19.6 Z" strokeLinejoin="round" />
  </>
)

// In the order shown; the first nine have number keys.
export const QUICK_ORDER: QuickAction[] = ['select', 'text', 'rectangle', 'circle', 'path', 'draw', 'image', 'embed', 'frame', 'pinterest']

export default function QuickBar({ armed, drawing, direct, onAction, onDirect }: {
  armed: PlaceTool | null
  drawing: boolean
  // Direct select is the kind of Select in use.
  direct: boolean
  onAction: (action: QuickAction) => void
  onDirect: (direct: boolean) => void
}) {
  const { t } = useTranslation()
  // Select's flyout: open while the pointer is over it or its button, with a
  // moment's grace for the gap between them.
  const [flyout, setFlyout] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const keepFlyout = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    setFlyout(true)
  }
  const letFlyoutGo = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setFlyout(false), 250)
  }
  const label: Record<QuickAction, string> = {
    select: direct ? t('atrium.tools.directSelect') : t('atrium.tools.select'),
    text: t('atrium.trace.type.text'),
    rectangle: t('atrium.trace.shape.rectangle'),
    circle: t('atrium.trace.shape.circle'),
    path: t('atrium.trace.shape.path'),
    draw: t('atrium.draw.button'),
    image: t('atrium.trace.type.image'),
    embed: t('atrium.trace.type.embed'),
    frame: t('atrium.trace.type.frame'),
    pinterest: t('atrium.canvas.pinterestBoards'),
  }
  // What an armed tool does with the canvas, beside it.
  const hint = armed === 'text' ? t('atrium.tools.hintText')
    : armed === 'path' ? t('atrium.tools.hintPath')
    : armed ? t('atrium.tools.hintBox')
    : null

  return (
    <div
      data-ui-element="true"
      data-hud="true"
      data-quick-bar=""
      role="toolbar"
      aria-label={t('atrium.tools.title')}
      aria-orientation="vertical"
      className="fixed left-4 top-1/2 -translate-y-1/2 z-[9999] pointer-events-auto flex flex-col gap-1 p-1 border border-nier-border/40"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}
    >
      {QUICK_ORDER.map((action, i) => {
        const on = action === 'select' ? !armed && !drawing : action === 'draw' ? drawing : armed === action
        // While drawing, only Draw (which ends it) is to hand: switching to
        // anything else would throw the drawing away unsaved.
        const off = drawing && action !== 'draw'
        const key = i < 9 ? String(i + 1) : null
        return (
          <div
            key={action}
            className="relative"
            onMouseEnter={action === 'select' && !off ? keepFlyout : undefined}
            onMouseLeave={action === 'select' ? letFlyoutGo : undefined}
          >
            {action === 'pinterest' && <div className="h-px mx-1 mb-1 bg-nier-border/30" />}
            <button
              type="button"
              data-quick={action}
              aria-pressed={on}
              aria-haspopup={action === 'select' ? 'true' : undefined}
              aria-expanded={action === 'select' ? flyout : undefined}
              disabled={off}
              title={key ? `${label[action]} — ${key}` : label[action]}
              onClick={() => {
                // Select pressed while it's already in hand opens its kinds --
                // the way to them without hovering (touch).
                if (action === 'select' && on) setFlyout(open => !open)
                onAction(action)
              }}
              className={`relative w-9 h-9 flex items-center justify-center border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                on
                  ? 'bg-nier-bg text-nier-black border-nier-bg'
                  : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                {action === 'select' && direct ? DIRECT_ICON : ICONS[action]}
              </svg>
              {key && <span className="absolute right-0.5 bottom-0 text-[8px] leading-none font-mono opacity-50">{key}</span>}
              {/* More kinds, to the side. */}
              {action === 'select' && (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 w-0 h-0 opacity-60" style={{ borderTop: '4px solid currentColor', borderLeft: '4px solid transparent' }} />
              )}
            </button>
            {action === 'select' && flyout && !off && (
              <div
                data-quick-flyout=""
                className="absolute left-full top-0 ml-2 flex gap-1 p-1 border border-nier-border/40"
                style={{ backgroundColor: 'rgb(var(--c-ground) / 0.95)' }}
              >
                {[false, true].map(kind => (
                  <button
                    key={String(kind)}
                    type="button"
                    data-select-kind={kind ? 'direct' : 'group'}
                    aria-pressed={direct === kind}
                    title={kind ? t('atrium.tools.directSelectHint') : t('atrium.tools.selectHint')}
                    onClick={() => {
                      onDirect(kind)
                      onAction('select')
                      setFlyout(false)
                    }}
                    className={`w-9 h-9 flex items-center justify-center border transition-colors ${
                      direct === kind
                        ? 'bg-nier-bg text-nier-black border-nier-bg'
                        : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg'
                    }`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      {kind ? DIRECT_ICON : ICONS.select}
                    </svg>
                  </button>
                ))}
              </div>
            )}
            {armed === action && hint && (
              <div
                className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2 py-1 border font-mono text-[10px] tracking-wider whitespace-nowrap pointer-events-none"
                style={{ color: 'rgb(var(--c-fg))', background: 'rgb(var(--c-ground) / 0.92)', borderColor: 'rgb(var(--c-fg) / 0.3)' }}
              >
                {hint}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
