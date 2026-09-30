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
// The bar always wins: whatever is under way -- drawing, a shape or path
// being placed, text being typed -- ends when another tool is picked here.
// Nothing is lost by it: a drawing's strokes are saved as they're drawn.
//
// Keys 1 to 9 pick the first nine, in the order shown.
//
// Two tools have kinds, in a flyout at their side (as the canvas menu's
// Transformations has), the button showing the kind in use:
//   Select -- Select, which takes a group whole, or Direct select, which
//     takes the trace itself wherever it is (in a group, in a frame).
//   Text -- text in a box, as a text trace has always been, or plain text:
//     no border, background or shadow, just the words (LobbyScene colours
//     them to stand out from the atrium's background).

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
// Text in a box: the T, framed.
const BOX_TEXT_ICON = (
  <>
    <rect x="3" y="3" width="18" height="18" />
    <path d="M8 8.5 V7.5 H16 V8.5 M12 7.5 V16.5 M10 16.5 H14" strokeLinecap="round" strokeLinejoin="round" />
  </>
)

// In the order shown; the first nine have number keys.
export const QUICK_ORDER: QuickAction[] = ['select', 'text', 'rectangle', 'circle', 'path', 'draw', 'image', 'embed', 'frame', 'pinterest']

// The tools with kinds, and which kind is in use: Select's direct, Text's
// plain -- both false for the first kind.
export type ToolKinds = { select: boolean; text: boolean }
type KindedTool = keyof ToolKinds

export default function QuickBar({ armed, drawing, kinds, onAction, onKind }: {
  armed: PlaceTool | null
  drawing: boolean
  kinds: ToolKinds
  onAction: (action: QuickAction) => void
  onKind: (tool: KindedTool, second: boolean) => void
}) {
  const { t } = useTranslation()
  // The open flyout: while the pointer is over it or its button, with a
  // moment's grace for the gap between them.
  const [flyout, setFlyout] = useState<KindedTool | null>(null)
  const closeTimer = useRef<number | null>(null)
  const keepFlyout = (tool: KindedTool) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    setFlyout(tool)
  }
  const letFlyoutGo = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setFlyout(null), 250)
  }
  // Each kinded tool's two kinds: icon, name, and what it does.
  const KIND: Record<KindedTool, { icon: ReactNode; name: string; hint: string; attr: string }[]> = {
    select: [
      { icon: ICONS.select, name: t('atrium.tools.select'), hint: t('atrium.tools.selectHint'), attr: 'group' },
      { icon: DIRECT_ICON, name: t('atrium.tools.directSelect'), hint: t('atrium.tools.directSelectHint'), attr: 'direct' },
    ],
    text: [
      { icon: BOX_TEXT_ICON, name: t('atrium.tools.textBox'), hint: t('atrium.tools.textBoxHint'), attr: 'box' },
      { icon: ICONS.text, name: t('atrium.tools.textPlain'), hint: t('atrium.tools.textPlainHint'), attr: 'plain' },
    ],
  }
  const kinded = (action: QuickAction): action is KindedTool => action === 'select' || action === 'text'
  const kindOf = (tool: KindedTool) => KIND[tool][kinds[tool] ? 1 : 0]
  const label: Record<QuickAction, string> = {
    select: kindOf('select').name,
    text: kindOf('text').name,
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
        const key = i < 9 ? String(i + 1) : null
        const withKinds = kinded(action)
        return (
          <div
            key={action}
            className="relative"
            onMouseEnter={withKinds ? () => keepFlyout(action) : undefined}
            onMouseLeave={withKinds ? letFlyoutGo : undefined}
          >
            {action === 'pinterest' && <div className="h-px mx-1 mb-1 bg-nier-border/30" />}
            <button
              type="button"
              data-quick={action}
              aria-pressed={on}
              aria-haspopup={withKinds ? 'true' : undefined}
              aria-expanded={withKinds ? flyout === action : undefined}
              title={key ? `${label[action]} — ${key}` : label[action]}
              onClick={() => {
                // A tool with kinds pressed while it's already in hand opens
                // them -- the way to them without hovering (touch).
                if (withKinds && on) {
                  setFlyout(open => (open === action ? null : action))
                  return
                }
                onAction(action)
              }}
              className={`relative w-9 h-9 flex items-center justify-center border transition-colors ${
                on
                  ? 'bg-nier-bg text-nier-black border-nier-bg'
                  : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                {withKinds ? kindOf(action).icon : ICONS[action]}
              </svg>
              {key && <span className="absolute right-0.5 bottom-0 text-[8px] leading-none font-mono opacity-50">{key}</span>}
              {/* More kinds, to the side. */}
              {withKinds && (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 w-0 h-0 opacity-60" style={{ borderTop: '4px solid currentColor', borderLeft: '4px solid transparent' }} />
              )}
            </button>
            {withKinds && flyout === action && (
              <div
                data-quick-flyout={action}
                className="absolute left-full top-0 ml-2 flex gap-1 p-1 border border-nier-border/40 z-10"
                style={{ backgroundColor: 'rgb(var(--c-ground) / 0.95)' }}
              >
                {KIND[action].map((kind, second) => (
                  <button
                    key={kind.attr}
                    type="button"
                    data-kind={kind.attr}
                    aria-pressed={kinds[action] === !!second}
                    title={kind.hint}
                    onClick={() => {
                      onKind(action, !!second)
                      // Picking a kind takes the tool up, in that kind.
                      if (!on) onAction(action)
                      setFlyout(null)
                    }}
                    className={`w-9 h-9 flex items-center justify-center border transition-colors ${
                      kinds[action] === !!second
                        ? 'bg-nier-bg text-nier-black border-nier-bg'
                        : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg'
                    }`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      {kind.icon}
                    </svg>
                  </button>
                ))}
              </div>
            )}
            {armed === action && hint && flyout !== action && (
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
