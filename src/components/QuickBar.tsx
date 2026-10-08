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
// One column, as tall as the room it's in allows; what doesn't fit is under
// More (the three dots at its foot), with Customize quick bar, where the tools
// are put in an order of one's own (QuickBarEditor) -- kept on this device.
//
// Keys 1 to 9 pick the first nine, in the order they come in, wherever they're
// put; K the laser pointer.
// Each tool's name slides out beside it under the pointer, as the atrium
// menu's do (SlideLabel) -- or, for a tool with a flyout, at the flyout's
// start. What the tool in hand does is said at the foot of the screen
// (ToolHint, placed by LobbyScene).
//
// The laser pointer (LaserLayer) is in hand like Draw is, and has its
// colour and particle effect in a flyout of its own.
//
// Shapes holds the shapes drawn in a box -- rectangle, triangle, circle,
// diamond, parallelogram -- in a flyout, the button showing the one in use;
// Other holds the kinds of file a trace can be besides a picture -- sound,
// video, a PDF, a spreadsheet -- each picked and placed at once, as a drop is.
// Embed is a tool like Text: a click says where, and a box asks for the link
// (EmbedLinkBox).
//
// Two tools have kinds, in a flyout at their side (as the canvas menu's
// Transformations has), the button showing the kind in use:
//   Select -- Select, which takes a group whole, or Direct select, which
//     takes the trace itself wherever it is (in a group, in a frame).
//   Text -- text in a box, as a text trace has always been, or plain text:
//     no border, background or shadow, just the words (LobbyScene colours
//     them to stand out from the atrium's background).

import { PAN_ICON } from './AtriumInfo'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useHistoryReach } from '../lib/actionHistory'
import { BOX_SHAPES, isBoxShape, type BoxShape } from '../lib/shapeStyle'
import { SlideLabel } from './AtriumMenu'
import { CustomizationPanel } from './Customization'
import { useGamePick } from '../store/gameStore'
import { useTranslation } from '../lib/i18n'
import { LASER_EFFECTS, TRAIL_MAX_MS, TRAIL_MIN_MS, type LaserEffect, type LaserSettings } from '../lib/laser'
import type { TranslationKey } from '../locales/en'

export type PlaceTool = 'text' | BoxShape | 'path' | 'frame' | 'embed'
// The kinds of file the Other button offers.
export type OtherTrace = 'sound' | 'video' | 'document' | 'sheet'
const OTHER_TRACES: OtherTrace[] = ['sound', 'video', 'document', 'sheet']
// What the bar does: take a tool up, or act.
export type QuickAction = 'select' | 'pan' | PlaceTool | 'draw' | 'image' | 'laser' | 'pinterest' | OtherTrace
// What the bar shows: a button each. Shapes and Other each hold several.
export type QuickButton = 'select' | 'pan' | 'text' | 'shape' | 'path' | 'draw' | 'image' | 'embed' | 'frame' | 'other' | 'laser' | 'pinterest'

// Drawn in a 24 box, stroked in the current colour.
const ICONS: Record<QuickAction | 'other', ReactNode> = {
  select: <path d="M6 3.5 L18 12 L12.6 13.1 L15.4 19.2 L13.2 20.2 L10.4 14.2 L6 17.6 Z" strokeLinejoin="round" />,
  // Move the view: four arrows (AtriumInfo's PAN_ICON).
  pan: <path d={PAN_ICON} strokeLinecap="round" strokeLinejoin="round" />,
  text: <path d="M5 6 V4.5 H19 V6 M12 4.5 V19.5 M9 19.5 H15" strokeLinecap="round" strokeLinejoin="round" />,
  rectangle: <rect x="4.5" y="5.5" width="15" height="13" />,
  triangle: <path d="M12 4.5 L20 19 H4 Z" strokeLinejoin="round" />,
  circle: <circle cx="12" cy="12" r="7.5" />,
  diamond: <path d="M12 3.5 L20.5 12 L12 20.5 L3.5 12 Z" strokeLinejoin="round" />,
  parallelogram: <path d="M8 5.5 H20.5 L16 18.5 H3.5 Z" strokeLinejoin="round" />,
  // Other: a little of everything -- three boxes and a ring.
  other: (
    <>
      <path d="M4 4h6v6h-6z M14 4h6v6h-6z M4 14h6v6h-6z" strokeLinejoin="round" />
      <circle cx="17" cy="17" r="3" />
    </>
  ),
  sound: (
    <>
      <path d="M9 17 V5.5 L19 3.5 V15" strokeLinejoin="round" />
      <circle cx="6.5" cy="17" r="2.5" />
      <circle cx="16.5" cy="15" r="2.5" />
    </>
  ),
  video: (
    <>
      <rect x="3.5" y="5" width="17" height="14" />
      <path d="M10 9.5 L15 12 L10 14.5 Z" strokeLinejoin="round" />
    </>
  ),
  document: <path d="M6 3.5 H14 L18.5 8 V20.5 H6 Z M14 3.5 V8 H18.5 M9 12 H15.5 M9 15.5 H15.5" strokeLinejoin="round" />,
  sheet: (
    <>
      <rect x="4" y="5" width="16" height="14" />
      <path d="M4 10 H20 M4 14.5 H20 M10 5 V19" />
    </>
  ),
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
  // A pointer with its light at the tip.
  laser: (
    <>
      <path d="M4.5 19.5 L12.5 11.5" strokeLinecap="round" />
      <circle cx="15.5" cy="8.5" r="2.2" />
      <path d="M15.5 3.5 V4.6 M20.5 8.5 H19.4 M19 5 L18.2 5.8 M19 12 L18.2 11.2" strokeLinecap="round" />
    </>
  ),
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

// In the order shown; the first eight have number keys. (Locations, a way of
// looking rather than making, is with the viewing tools on the right.)
// The numbered tools, 1 to 9 in this order. Move sits after Select on the
// bar with H for its key, so the numbers stayed where hands know them.
export const QUICK_ORDER: QuickButton[] = ['select', 'text', 'shape', 'path', 'draw', 'image', 'embed', 'frame', 'other', 'laser', 'pinterest']
const ON_THE_BAR: QuickButton[] = ['select', 'pan', ...QUICK_ORDER.slice(1)]

// The bar's order: as chosen (Customize), with any tool the choice predates
// at the end -- or as it comes, with none chosen.
export function barOrder(chosen: string[] | null): QuickButton[] {
  const known = (chosen ?? []).filter((tool, i, all): tool is QuickButton => (ON_THE_BAR as string[]).includes(tool) && all.indexOf(tool) === i)
  return [...known, ...ON_THE_BAR.filter(tool => !known.includes(tool))]
}

// A tool's key: its place in the order it comes in, not where it's been put.
const keyOf = (action: QuickButton): string | null => {
  if (action === 'other') return null
  if (action === 'pan') return 'H'
  if (action === 'laser') return 'K'
  const number = QUICK_ORDER.indexOf(action)
  return number >= 0 && number < 9 ? String(number + 1) : null
}

// More: three dots. Customize: the bar's tools, one being moved.
const MORE_ICON = <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" strokeWidth="3" strokeLinecap="round" />
const CUSTOMIZE_ICON = <path d="M4 6h9M4 12h5M4 18h9M17 4v6M14.5 7.5L17 10l2.5-2.5M17 20v-6M14.5 16.5L17 14l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
// Hold here to move a row: six dots.
const GRIP_ICON = <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="2.5" strokeLinecap="round" />

const EFFECT_LABEL: Record<LaserEffect, TranslationKey> = {
  none: 'atrium.tools.effectNone',
  sparks: 'atrium.tools.effectSparks',
  embers: 'atrium.tools.effectEmbers',
  stardust: 'atrium.tools.effectStardust',
}

// The tools with kinds, and which kind is in use: Select's direct, Text's
// plain -- both false for the first kind.
export type ToolKinds = { select: boolean; text: boolean }
type KindedTool = keyof ToolKinds
// The buttons with a flyout at their side.
type FlyoutTool = KindedTool | 'shape' | 'other' | 'laser'

// Undo and redo as buttons, for the history Ctrl+Z walks, each greyed out
// with nothing to take back or bring back. A component of its own, so the
// history changing redraws these two and nothing else.
const HISTORY = [
  { direction: 'undo', label: 'common.undo', keys: 'Ctrl+Z', icon: 'M9 14l-4 -4l4 -4M5 10h11a4 4 0 1 1 0 8h-1' },
  { direction: 'redo', label: 'common.redo', keys: 'Ctrl+Shift+Z', icon: 'M15 14l4 -4l-4 -4M19 10h-11a4 4 0 1 0 0 8h1' },
] as const

export function HistoryButtons({ onStep }: { onStep: (direction: 'undo' | 'redo') => void }) {
  const { t } = useTranslation()
  const reach = useHistoryReach()
  return (
    <div
      data-hud="true"
      className="shrink-0 flex border border-nier-border/40 pointer-events-auto"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}
    >
      {HISTORY.map(({ direction, label, keys, icon }) => (
        <button
          key={direction}
          type="button"
          data-history={direction}
          disabled={!reach[direction]}
          onClick={() => onStep(direction)}
          aria-label={t(label)}
          title={`${t(label)} — ${keys}`}
          className="w-9 h-8 flex items-center justify-center text-nier-bg/80 transition-colors hover:text-nier-bg hover:bg-nier-bg/10 disabled:opacity-30 disabled:pointer-events-none"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={icon} />
          </svg>
        </button>
      ))}
    </div>
  )
}

export default function QuickBar({ armed, drawing, laser, panning, laserSettings, kinds, shapeKind, onAction, onKind, onShapeKind, onLaserSettings, onCustomize }: {
  armed: PlaceTool | null
  drawing: boolean
  laser: boolean
  // Move the view taken up (LobbyScene).
  panning: boolean
  laserSettings: LaserSettings
  kinds: ToolKinds
  onAction: (action: QuickAction) => void
  onKind: (tool: KindedTool, second: boolean) => void
  // The shape the Shapes button takes up, and its choosing.
  shapeKind: BoxShape
  onShapeKind: (kind: BoxShape) => void
  onLaserSettings: (settings: LaserSettings) => void
  // Customize quick bar, from More: its editor opened (LobbyScene).
  onCustomize: () => void
}) {
  const { t } = useTranslation()
  const { quickBarOrder } = useGamePick('quickBarOrder')
  const tools = barOrder(quickBarOrder)
  // The open flyout: while the pointer is over it or its button, with a
  // moment's grace for the gap between them.
  const [flyout, setFlyout] = useState<FlyoutTool | null>(null)

  // As many tools down as the room it's in is tall, More taking the last
  // place; the rest are under More. It used to go on in more columns, which
  // on a short screen climbed up beside Save.
  const barRef = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState(tools.length + 1)
  useLayoutEffect(() => {
    const room = barRef.current?.parentElement
    if (!room) return
    // A tool is 36px with 4 between; the bar adds 10 (padding and border).
    const fit = () => {
      const style = getComputedStyle(room)
      const height = room.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      setRows(Math.max(1, Math.floor((height - 6) / 40)))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(room)
    return () => observer.disconnect()
  }, [])
  const shown = tools.length + 1 <= rows ? tools : tools.slice(0, Math.max(0, rows - 1))
  const hidden = tools.slice(shown.length)
  // More's panel, open: apart from `flyout`, so a tool in it can open its own.
  const [moreOpen, setMoreOpen] = useState(false)
  const moreTimer = useRef<number | null>(null)
  const keepMore = () => {
    if (moreTimer.current) window.clearTimeout(moreTimer.current)
    moreTimer.current = null
    setMoreOpen(true)
  }
  const letMoreGo = () => {
    if (moreTimer.current) window.clearTimeout(moreTimer.current)
    moreTimer.current = window.setTimeout(() => {
      if (!flyoutRef.current?.contains(document.activeElement)) setMoreOpen(false)
    }, 250)
  }
  const closeTimer = useRef<number | null>(null)
  const keepFlyout = (tool: FlyoutTool) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    setFlyout(tool)
  }
  // Not while something in it is in use: picking a colour opens the system's
  // picker, which takes the pointer off the page -- and closing the flyout
  // under it took the colour input away before its colour came back, so the
  // colour picked was never set.
  const flyoutRef = useRef<HTMLDivElement>(null)
  const letFlyoutGo = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => {
      if (!flyoutRef.current?.contains(document.activeElement)) setFlyout(null)
    }, 250)
  }
  // A press anywhere off the bar puts it away, in use or not.
  useEffect(() => {
    if (!flyout && !moreOpen) return
    const press = (e: PointerEvent) => {
      if (barRef.current?.contains(e.target as Node)) return
      setFlyout(null)
      setMoreOpen(false)
    }
    window.addEventListener('pointerdown', press, true)
    return () => window.removeEventListener('pointerdown', press, true)
  }, [flyout, moreOpen])
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
  const kinded = (action: QuickButton): action is KindedTool => action === 'select' || action === 'text'
  const hasFlyout = (action: QuickButton): action is FlyoutTool => kinded(action) || action === 'shape' || action === 'other' || action === 'laser'
  const kindOf = (tool: KindedTool) => KIND[tool][kinds[tool] ? 1 : 0]
  const label: Record<QuickButton | QuickAction, string> = {
    select: kindOf('select').name,
    pan: t('atrium.hud.panTool'),
    text: kindOf('text').name,
    shape: t(`atrium.trace.shape.${shapeKind}` as const),
    rectangle: t('atrium.trace.shape.rectangle'),
    triangle: t('atrium.trace.shape.triangle'),
    circle: t('atrium.trace.shape.circle'),
    diamond: t('atrium.trace.shape.diamond'),
    parallelogram: t('atrium.trace.shape.parallelogram'),
    other: t('atrium.tools.other'),
    sound: t('atrium.trace.type.sound'),
    video: t('atrium.trace.type.video'),
    document: t('atrium.trace.type.document'),
    sheet: t('atrium.trace.type.spreadsheet'),
    path: t('atrium.trace.shape.path'),
    draw: t('atrium.draw.button'),
    image: t('atrium.trace.type.image'),
    embed: t('atrium.trace.type.embed'),
    frame: t('atrium.trace.type.frame'),
    laser: t('atrium.tools.laser'),
    pinterest: t('atrium.canvas.pinterestBoards'),
  }
  return (
    <div
      data-ui-element="true"
      data-hud="true"
      data-quick-bar=""
      role="toolbar"
      aria-label={t('atrium.tools.title')}
      aria-orientation="vertical"
      ref={barRef}
      className="pointer-events-auto flex flex-col gap-1 p-1 border border-nier-border/40"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}
    >
      {shown.map((action, i) => renderTool(action, i))}
      {/* More: what didn't fit, and Customize quick bar. */}
      <div className="group relative" onMouseEnter={keepMore} onMouseLeave={letMoreGo}>
        <button
          type="button"
          data-quick="more"
          aria-haspopup="true"
          aria-expanded={moreOpen}
          aria-label={t('atrium.tools.more')}
          onClick={() => setMoreOpen(open => !open)}
          className={`peer relative w-9 h-9 flex items-center justify-center border transition-colors ${
            moreOpen ? 'border-nier-border/60 text-nier-bg' : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg'
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{MORE_ICON}</svg>
        </button>
        {!moreOpen && <SlideLabel text={t('atrium.tools.more')} onPress={() => setMoreOpen(true)} />}
        {moreOpen && (
          <div
            data-quick-more=""
            className="slide-in absolute left-full bottom-0 ml-2 flex flex-col gap-1 p-1 border border-nier-border/40 z-10"
            style={{ backgroundColor: 'rgb(var(--c-ground) / 0.95)' }}
          >
            <ToolName name={t('atrium.tools.more')} keyName={null} />
            {hidden.length > 0 && (
              <div className="grid grid-cols-4 gap-1 pb-1 border-b border-nier-border/25">
                {hidden.map((action, i) => renderTool(action, i, true))}
              </div>
            )}
            <button
              type="button"
              data-quick-customize=""
              onClick={() => { setMoreOpen(false); onCustomize() }}
              className="flex items-center gap-2 h-9 px-2 border border-transparent text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg transition-colors whitespace-nowrap text-[11px] tracking-[0.12em] uppercase"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{CUSTOMIZE_ICON}</svg>
              {t('atrium.tools.customizeBar')}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  // A tool's button, with its name sliding out beside it and its flyout --
  // on the bar, or in More's panel (inPanel: named by its title there, a
  // sliding name crossing the tools beside it).
  function renderTool(action: QuickButton, i: number, inPanel = false) {
        const on = action === 'select' ? !armed && !drawing && !laser && !panning
          : action === 'pan' ? panning
          : action === 'shape' ? isBoxShape(armed)
          : action === 'other' ? false
          : action === 'draw' ? drawing
          : action === 'laser' ? laser
          : armed === action
        const key = keyOf(action)
        const withKinds = kinded(action)
        const withFlyout = hasFlyout(action)
        const press = () => {
          // A tool with kinds (or options) pressed while it's already in
          // hand opens them -- the way to them without hovering (touch).
          if ((withFlyout && on) || action === 'other') {
            setFlyout(open => (open === action ? null : action))
            return
          }
          if (inPanel) setMoreOpen(false)
          onAction(action === 'shape' ? shapeKind : action)
        }
        return (
          <div
            key={action}
            className="group relative"
            onMouseEnter={withFlyout ? () => keepFlyout(action) : undefined}
            onMouseLeave={withFlyout ? letFlyoutGo : undefined}
          >
            {/* In the gap above, so every tool keeps its row's height -- and
                only with a tool above it to set it apart from. */}
            {action === 'pinterest' && i !== 0 && !inPanel && <div className="absolute -top-[3px] inset-x-1 h-px bg-nier-border/30" />}
            <button
              type="button"
              data-quick={action}
              aria-pressed={on}
              aria-haspopup={withFlyout ? 'true' : undefined}
              aria-expanded={withFlyout ? flyout === action : undefined}
              aria-label={label[action]}
              aria-keyshortcuts={key ?? undefined}
              title={inPanel ? label[action] : undefined}
              onClick={press}
              className={`peer relative w-9 h-9 flex items-center justify-center border transition-colors ${
                on
                  ? 'bg-nier-bg text-nier-black border-nier-bg'
                  : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg'
              }`}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                {withKinds ? kindOf(action).icon : action === 'shape' ? ICONS[shapeKind] : ICONS[action]}
              </svg>
              {key && <span className="absolute right-0.5 bottom-0 text-[8px] leading-none font-mono opacity-50">{key}</span>}
              {/* More kinds, to the side. */}
              {withFlyout && (
                <span aria-hidden="true" className="absolute right-0.5 top-0.5 w-0 h-0 opacity-60" style={{ borderTop: '4px solid currentColor', borderLeft: '4px solid transparent' }} />
              )}
            </button>
            {flyout !== action && !inPanel && <SlideLabel text={label[action]} hint={key ?? undefined} onPress={press} />}
            {withKinds && flyout === action && (
              <div
                ref={flyoutRef}
                data-quick-flyout={action}
                className="slide-in absolute left-full top-0 ml-2 flex items-center gap-1 p-1 border border-nier-border/40 z-10"
                style={{ backgroundColor: 'rgb(var(--c-ground) / 0.95)' }}
              >
                <ToolName name={label[action]} keyName={key} />
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
            {/* Shapes: each kind, the one in use pressed; picking one takes it up. */}
            {action === 'shape' && flyout === 'shape' && (
              <div
                ref={flyoutRef}
                data-quick-flyout="shape"
                className="slide-in absolute left-full top-0 ml-2 flex items-center gap-1 p-1 border border-nier-border/40 z-10"
                style={{ backgroundColor: 'rgb(var(--c-ground) / 0.95)' }}
              >
                <ToolName name={t('atrium.tools.shapes')} keyName={key} />
                {BOX_SHAPES.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    data-shape-kind={kind}
                    aria-pressed={shapeKind === kind}
                    aria-label={label[kind]}
                    title={label[kind]}
                    onClick={() => {
                      onShapeKind(kind)
                      if (armed !== kind) onAction(kind)
                      setFlyout(null)
                    }}
                    className={`w-9 h-9 flex items-center justify-center border transition-colors ${
                      shapeKind === kind
                        ? 'bg-nier-bg text-nier-black border-nier-bg'
                        : 'bg-transparent text-nier-bg/80 border-transparent hover:border-nier-border/60 hover:text-nier-bg'
                    }`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{ICONS[kind]}</svg>
                  </button>
                ))}
              </div>
            )}
            {/* Other: a file of each kind, picked and placed at once. */}
            {action === 'other' && flyout === 'other' && (
              <div
                ref={flyoutRef}
                data-quick-flyout="other"
                className="slide-in absolute left-full top-0 ml-2 flex items-center gap-1 p-1 border border-nier-border/40 z-10"
                style={{ backgroundColor: 'rgb(var(--c-ground) / 0.95)' }}
              >
                <ToolName name={label.other} keyName={null} />
                {OTHER_TRACES.map(kind => (
                  <button
                    key={kind}
                    type="button"
                    data-other-trace={kind}
                    aria-label={label[kind]}
                    title={label[kind]}
                    onClick={() => {
                      onAction(kind)
                      setFlyout(null)
                    }}
                    className="w-9 h-9 flex items-center justify-center border border-transparent text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{ICONS[kind]}</svg>
                  </button>
                ))}
              </div>
            )}
            {action === 'laser' && flyout === 'laser' && (
              <div
                ref={flyoutRef}
                data-quick-flyout="laser"
                className="slide-in absolute left-full top-0 ml-2 p-2 border border-nier-border/40 z-10 flex flex-col gap-2 w-48 font-mono"
                style={{ backgroundColor: 'rgb(var(--c-ground) / 0.95)' }}
              >
                <ToolName name={label.laser} keyName="K" />
                <label className="flex items-center justify-between gap-2 text-[10px] tracking-[0.12em] uppercase text-nier-bg/80">
                  {t('atrium.tools.laserColour')}
                  <input
                    type="color"
                    value={laserSettings.color}
                    onChange={e => onLaserSettings({ ...laserSettings, color: e.target.value })}
                    className="atrium-swatch w-14 h-6 cursor-pointer border border-nier-border/40"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[10px] tracking-[0.12em] uppercase text-nier-bg/80">
                  <span className="flex items-center justify-between gap-2">
                    {t('atrium.tools.laserTrail')}
                    <span className="text-nier-bg/60 tabular-nums">{(laserSettings.trail / 1000).toFixed(1)} s</span>
                  </span>
                  <input
                    type="range"
                    data-laser-trail=""
                    min={TRAIL_MIN_MS}
                    max={TRAIL_MAX_MS}
                    step={50}
                    value={laserSettings.trail}
                    onChange={e => onLaserSettings({ ...laserSettings, trail: Number(e.target.value) })}
                    className="w-full accent-nier-bg"
                  />
                </label>
                <span className="text-[10px] tracking-[0.12em] uppercase text-nier-bg/60">{t('atrium.tools.laserEffect')}</span>
                <div className="grid grid-cols-2 gap-1">
                  {LASER_EFFECTS.map(effect => (
                    <button
                      key={effect}
                      type="button"
                      data-effect={effect}
                      aria-pressed={laserSettings.effect === effect}
                      onClick={() => {
                        onLaserSettings({ ...laserSettings, effect })
                        if (!on) onAction('laser')
                      }}
                      className={`px-2 py-1.5 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
                        laserSettings.effect === effect
                          ? 'bg-nier-bg text-nier-black border-nier-bg'
                          : 'bg-transparent text-nier-bg/80 border-nier-border/30 hover:border-nier-border/60 hover:text-nier-bg'
                      }`}
                    >
                      {t(EFFECT_LABEL[effect])}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
  }
}

// A tool's name at the start of its flyout, where the sliding name would be.
function ToolName({ name, keyName }: { name: string; keyName: string | null }) {
  return (
    <span className="px-2 whitespace-nowrap text-nier-strong text-[11px] tracking-[0.15em] uppercase">
      {name}
      {keyName && <span className="ml-2 text-nier-bg/50 normal-case tracking-normal">{keyName}</span>}
    </span>
  )
}

// Each tool by its own name, whichever kind of it is in hand.
const TOOL_NAME: Record<QuickButton, TranslationKey> = {
  select: 'atrium.tools.select',
  pan: 'atrium.hud.panTool',
  text: 'atrium.tools.textBox',
  shape: 'atrium.tools.shapes',
  path: 'atrium.trace.shape.path',
  draw: 'atrium.draw.button',
  image: 'atrium.trace.type.image',
  embed: 'atrium.trace.type.embed',
  frame: 'atrium.trace.type.frame',
  other: 'atrium.tools.other',
  laser: 'atrium.tools.laser',
  pinterest: 'atrium.canvas.pinterestBoards',
}

// Customize quick bar: the tools in the bar's order, each dragged by its row
// to where it's wanted, as the Layer panel's are -- the bar following at
// once. Reset puts them back as they come. Docked where the other panels are.
export function QuickBarEditor({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { quickBarOrder, setQuickBarOrder } = useGamePick('quickBarOrder', 'setQuickBarOrder')
  const order = barOrder(quickBarOrder)
  // The row held, and the order as it would be let go of now.
  const [held, setHeld] = useState<{ tool: QuickButton; order: QuickButton[] } | null>(null)
  const rowRefs = useRef(new Map<QuickButton, HTMLLIElement>())
  const list = held?.order ?? order
  const move = (y: number) => {
    if (!held) return
    // Before the first row whose middle is below the pointer.
    const others = list.filter(tool => tool !== held.tool)
    let at = others.findIndex(tool => {
      const r = rowRefs.current.get(tool)?.getBoundingClientRect()
      return !!r && y < r.top + r.height / 2
    })
    if (at < 0) at = others.length
    const next = [...others.slice(0, at), held.tool, ...others.slice(at)]
    if (next.join() !== list.join()) setHeld({ tool: held.tool, order: next })
  }
  const letGo = () => {
    if (held && held.order.join() !== order.join()) setQuickBarOrder(held.order)
    setHeld(null)
  }
  return (
    <CustomizationPanel
      subtitle={t('atrium.tools.customizeBar')}
      onClose={onClose}
      zIndex={9999}
      actions={(
        <button
          type="button"
          data-quick-reset=""
          disabled={!quickBarOrder}
          onClick={() => setQuickBarOrder(null)}
          className="w-full py-2 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.15em] uppercase hover:border-nier-bg transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          {t('atrium.tools.resetBar')}
        </button>
      )}
    >
      <div className="px-4 py-3">
        <p className="text-nier-bg/60 text-[0.7rem] leading-relaxed tracking-wide mb-3">{t('atrium.tools.customizeBarHint')}</p>
        <ul className="flex flex-col gap-1" data-quick-editor="">
          {list.map(tool => (
            <li
              key={tool}
              ref={el => { if (el) rowRefs.current.set(tool, el); else rowRefs.current.delete(tool) }}
              data-quick-row={tool}
              onPointerDown={e => {
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                setHeld({ tool, order: list })
              }}
              onPointerMove={e => move(e.clientY)}
              onPointerUp={letGo}
              onPointerCancel={() => setHeld(null)}
              className={`flex items-center gap-3 h-10 px-2 border select-none touch-none transition-colors ${
                held?.tool === tool ? 'border-nier-bg bg-nier-bg/10 cursor-grabbing' : 'border-nier-border/30 hover:border-nier-border/60 cursor-grab'
              }`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-nier-bg/50 shrink-0" aria-hidden="true">{GRIP_ICON}</svg>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-nier-bg shrink-0" aria-hidden="true">{tool === 'shape' ? ICONS.rectangle : ICONS[tool]}</svg>
              <span className="flex-1 min-w-0 truncate text-nier-strong text-[11px] tracking-[0.12em] uppercase">{t(TOOL_NAME[tool])}</span>
              {keyOf(tool) && <span className="text-nier-bg/50 text-[10px] font-mono">{keyOf(tool)}</span>}
            </li>
          ))}
        </ul>
      </div>
    </CustomizationPanel>
  )
}

// What the tool in hand does with the canvas, at the foot of the screen in
// the middle (LobbyScene) while it's in hand.
export function ToolHint({ armed, laser, drawing, panning }: { armed: PlaceTool | null; laser: boolean; drawing: boolean; panning: boolean }) {
  const { t } = useTranslation()
  const text = drawing ? t('atrium.draw.hint')
    : panning ? t('atrium.tools.hintPan')
    : laser ? t('atrium.tools.hintLaser')
    : armed === 'embed' ? t('atrium.tools.hintEmbed')
    : armed === 'text' ? t('atrium.tools.hintText')
    : armed === 'path' ? t('atrium.tools.hintPath')
    : armed ? t('atrium.tools.hintBox')
    : null
  if (!text) return null
  return (
    <p
      data-tool-hint=""
      className="panel-in px-3 py-1.5 border font-mono text-[11px] tracking-wider whitespace-nowrap"
      style={{ color: 'rgb(var(--c-fg))', background: 'rgb(var(--c-ground) / 0.92)', borderColor: 'rgb(var(--c-fg) / 0.3)' }}
    >
      {text}
    </p>
  )
}
