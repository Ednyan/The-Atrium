// ...existing code...
// ...existing code...
// ...existing code...
// Removed useEffectOnce, use standard useEffect
import { corsReady, useSpatialSound } from '../lib/spatialSound'
import { dashProps } from '../lib/strokeStyle'
import { UNSUPPORTED } from '../lib/atriumFile'
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, useSyncExternalStore } from 'react'
import type { Trace } from '../types/database'
import { supabase, isDesktop } from '../lib/supabase'
import { useGameStore, lobbyFullMessage, useGamePick } from '../store/gameStore'
import { useLatestHandlers } from '../hooks/useLatestHandlers'
import { showToast } from '../lib/toast'
import { useTranslation } from '../lib/i18n'
import { isCanvasTarget, isEditableTarget } from '../lib/editableTarget'

// Video and audio stream from the vault rather than being read into memory.
import { resolveLocalStreamUrl } from '../lib/localMedia'

import ProfileCustomization from './ProfileCustomization'
import { saveAllChanges, TRACE_DISCARD_COMPLETED_EVENT, TRACE_SAVE_COMPLETED_EVENT } from '../lib/traceSave'
import { convertEmbedToInternalImage } from '../lib/traceConvert'
import { computeAutoFitTextSize, fittedTextBox, fontPxOf, resolveFontFamilyCss, fitFontSize } from '../lib/textFit'
import { baseSizeOf, borderColourOf, boundsOf, FRAME_DEFAULT, roundedPolygonPath, shapePolygon, storedTransformOf, traceBox } from '../lib/traceGeometry'
import { TRACE_PRESETS, currentTracePreset, rememberTracePreset } from '../lib/tracePresets'
import type { TranslationKey } from '../locales/en'
import { readUndoDepth } from '../lib/atriumPreferences'
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition'
import { openExternalUrl } from '../lib/openExternal'
import { throughRelay, toEmbedUrl, withPlayerApi } from '../lib/embedUrl'
import { compareOrder, drawRanks, groupIdOf, inOrder, keyAt, keysAt, keysBetween, keysOnTop, keysOnTopOfGroup, reorder, siblingsOf, topLevel, type Ordered } from '../lib/order'
import { createGroup, reloadLayers, writeGroupKey } from '../hooks/useLayers'
import { buildTraceInsertRow } from '../lib/traceInsert'
import { boxContains, frameAround, heldBy, isFrame, newFrame, placeUnits, putInFrame, unitMiddle, unitsOf, type FrameBox } from '../lib/frames'
import { ELBOW_RADIUS, elbowRoute, elbowThrough, lineCrosses, roundedPath } from '../lib/elbow'
import { alignedHandle, boxHolds, borderMarks, curvePath, handlesAt, pointBetween, snapToBorder, type PathCurve, type PathPoint, type TurnedBox } from '../lib/pathGeometry'
import { packBoxesAroundCenter, probeRemoteImageDimensions, scaleToDisplayBox } from '../lib/binPack'
import { pathWorldBounds, isPathTrace } from '../lib/pathBounds'
import ShapeStyleControls, { Check, ScaleControls, StrokeStylePicker } from './ShapeStyleControls'
import BatchEditPanel from './BatchEditPanel'
import { has } from '../lib/traceKinds'
import { copiedStyle, copyStyle, shownValue, stylePatchFor } from '../lib/traceStyle'
import FontSizeField from './FontSizeField'
import TraceNameField from './TraceNameField'
import { ARROW_SCALE, previewFrameColour, rememberShapeStyle, shapePaint, shapeStyleOf, type ShapeStyle } from '../lib/shapeStyle'
import { ACTION_ICONS, CustomizationPanel, PanelAction, Section, Switch, traceKindLabel } from './Customization'
import ConfirmBox, { ConfirmButtons } from './ConfirmBox'
import DeckSlide from './DeckSlide'
import { isDeckFile } from '../lib/deckDraw'
import { fileName, followed, stopFollowing, watchFollowing } from '../lib/liveFiles'
import { asStrokeData, drawingOf, isDrawingTrace, strokeDensity, strokesIn } from '../lib/brushes'
import { changeStrokes, rasterizeDrawings, splitDrawing } from '../lib/drawingFiles'
import { extractPages } from '../lib/pdfTraces'
import { DEFAULT_LABEL_SIZE, DEFAULT_LINK_OPACITY, DEFAULT_LINK_WIDTH, boxCrosses, joins, threadCrosses, type Box, type TraceLink, boxInLasso, threadInLasso } from '../lib/traceLinks'
import TraceLinksLayer, { LinkMenu, type LinkEnd } from './TraceLinksLayer'
import RotateHandles from './RotateHandles'
import StrokeStyleField from './StrokeStyleField'
import StrokeCanvas from './StrokeCanvas'
import TraceGlitch from './TraceGlitch'
import { insertTrace } from '../lib/traceWrites'
import { cropClip, flipInBox } from '../lib/traceFlip'
import { WHOLE, boxFromWindow, cropOf, cropShift, dragCrop, turn, type Crop } from '../lib/traceCrop'
import { layerChangeUnderWay, queueLayerChange } from '../lib/layerQueue'
import { setActionRecorder, setHistoryReach, type ActionEntry } from '../lib/actionHistory'
import { layerChangeAdopts, withLayerUndo } from '../lib/layerUndo'
import { UNLOCKED, isLockedTrace } from '../lib/traceLock'
import { PAN_ICON } from './AtriumInfo'
import { feelRest, feelSpring, feelStep, type FeelSpring } from '../lib/dragFeel'
import { overPanel, panelDrop } from '../lib/panelDrop'
import { firstFreeName, nextTextName } from '../lib/traceNames'
import SheetTrace from './SheetTrace'
import { CUSTOM_FONTS } from '../lib/customFonts'
import { vaultWriteProgress, watchVaultWrites } from '../lib/vaultWrites'

// The Font Family dropdown's full option list: the built-in generic fonts
// plus every custom family, all sorted together alphabetically by label
// (rather than built-ins first, customs after) so the whole list reads as
// one alphabetical menu.
const FONT_FAMILY_OPTIONS: { value: string; label: string }[] = [
  { value: 'sans', label: 'Sans-serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Monospace' },
  { value: 'palatino', label: 'Palatino' },
  { value: 'garamond', label: 'Garamond' },
  { value: 'comic', label: 'Comic Sans MS' },
  { value: 'impact', label: 'Impact' },
  { value: 'cursive', label: 'Cursive' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'system-ui', label: 'System UI' },
  // Web-safe OS fonts -- no files to bundle, just relying on what's
  // typically installed, with a real CSS fallback stack (see
  // FONT_FAMILY_CSS_MAP) unlike the single-token entries above.
  { value: 'arial', label: 'Arial' },
  { value: 'times', label: 'Times New Roman' },
  { value: 'georgia', label: 'Georgia' },
  { value: 'courier', label: 'Courier New' },
  { value: 'verdana', label: 'Verdana' },
  { value: 'tahoma', label: 'Tahoma' },
  { value: 'trebuchet', label: 'Trebuchet MS' },
  { value: 'segoe', label: 'Segoe UI' },
  { value: 'calibri', label: 'Calibri' },
  { value: 'consolas', label: 'Consolas' },
  { value: 'century-gothic', label: 'Century Gothic' },
  ...CUSTOM_FONTS.map(({ name }) => ({ value: name, label: name })),
].sort((a, b) => a.label.localeCompare(b.label))

interface TraceOverlayProps {
  traces: Trace[]
  // A paste that isn't copied traces: LobbyScene's to make something of (a
  // link, a picture) -- whether it did.
  onPaste?: (data: DataTransfer) => boolean
  // The atrium's own background, so the cursor can be outlined against it.
  // Without the drop shadow that used to separate them, a pale cursor on a
  // pale atrium is a pale cursor on a pale atrium.
  atriumBackground?: string
  // The atrium's grid line spacing, so Shift-dragging snaps to the lines that
  // are actually drawn rather than to a number this file decided on its own.
  gridLineSpacing?: number
  zoom: number
  worldOffset: { x: number; y: number }
  // The layer of world content, for LobbyScene to scale whole while a zoom
  // is under way.
  worldLayerRef?: React.Ref<HTMLDivElement>
  // Moves the camera by a world-space delta. The camera lives in LobbyScene,
  // so dragging a trace past the edge of the view has to ask for the scroll
  // rather than perform it.
  onEdgePan?: (worldDx: number, worldDy: number) => void
  lobbyId?: string
  selectedTraceId: string | null
  setSelectedTraceId: (id: string | null) => void
  // One-shot request to multi-select a set of traces -- from the Layer
  // panel (a group's traces) or from a canvas area/rubber-band selection.
  // A new array reference is sent each time (even for the same set), so
  // the effect that consumes it always fires.
  multiSelectRequest?: string[] | null
  // A canvas area selection (LobbyScene's shift+drag), in world units: the
  // traces it reaches into and the threads it crosses are selected here,
  // where each trace's real size is known. A new object each time.
  areaSelectRequest?: Box | null
  // A lasso let go (the quick bar's Selection), in world points.
  lassoSelectRequest?: { x: number; y: number }[] | null
  // The Selection tool in hand: the cursor is a crosshair over the canvas.
  selecting?: boolean
  // A tool is in hand that the next press on the canvas places with (the
  // quick bar's): the cursor's a crosshair.
  placing?: boolean
  // One-shot request from the Layer panel: open the customize UI for these
  // traces. One id opens that trace's own panel; several select them and open
  // batch edit. A new array reference is sent each time, like
  // multiSelectRequest above, so asking twice for the same set still fires.
  customizeRequest?: string[] | null
  // One-shot request from LobbyScene: a brand-new path trace (just inserted
  // with a single starting point) that should be selected and immediately
  // put into point-placing mode, instead of leaving the user to find the
  // Customize panel's "Add Points" button themselves. Trace ids are always
  // freshly generated, so a plain useEffect keyed on this value fires
  // correctly for every new path without needing to be reset back to null.
  newPathRequest?: string | null
  // One-shot request: a text trace just created from the canvas menu or the
  // quick bar, to be selected and opened for typing -- `drawn` when its box
  // was dragged out, so the box keeps that size (fitTextLive). A fresh object
  // each time, so a plain effect keyed on it fires for every one.
  newTextRequest?: { id: string; drawn?: boolean } | null
  // The quick bar's Direct select: a click picks the trace itself, even in a
  // group (which a click otherwise takes whole) -- or in a frame.
  directSelect?: boolean
  // A frame to make, from the canvas menu or the quick bar: where, its size
  // when a box was dragged out for it (else its default), whether to open its
  // Customize panel, and a fresh object each time so asking twice at one
  // point still makes two.
  frameRequest?: { x: number; y: number; width?: number; height?: number; customize?: boolean } | null
  // While true, Ctrl+Z/Ctrl+Shift+Z are owned by the drawing-mode stroke
  // undo (see LobbyScene) instead of this file's trace undo/redo history.
  isDrawingMode?: boolean
  // True while the pointer is over the drawing canvas, where the brush circle
  // stands in for the cursor.
  hideCursor?: boolean
  // Move the view is taken up (LobbyScene): the cursor says so.
  panning?: boolean
  // Edit Drawing, handed up; and the strokes of the drawing being drawn, kept
  // off the canvas while they're in the drawing layer instead (LobbyScene).
  onEditDrawing?: (traceId: string) => void
  hiddenTraceIds?: ReadonlySet<string>
  // Counts up each time a tool is picked in the quick bar, which ends
  // whatever was under way here: a path's points, crop mode, a connection
  // being made, a colour being picked.
  toolSwitch?: number
  // Reports this file's current multi-selection up to LobbyScene so the
  // Layer panel (a sibling, not a child, of this component) can highlight
  // every multi-selected trace/group, not just the single selectedTraceId.
  onMultiSelectionChange?: (ids: string[]) => void
  // Export (LobbyScene's ExportDialog), on these traces.
  onExport?: (ids: string[]) => void
  // A trace's customize panel (or the batch one) opened -- LobbyScene clears
  // the Layer, Locations and Create Trace panels from around it.
  onCustomizeOpen?: () => void
  // Mirrors LobbyScene's canEdit (per lobbies.edit_permission_mode). Server
  // enforcement lives in RLS (user_can_edit_lobby); this just keeps the
  // editing UI (context menu, Customize/Batch Edit panels) from opening for
  // a user whose writes would be rejected anyway. Defaults to true so
  // callers that don't pass it (none currently) aren't silently locked out.
  canEdit?: boolean
}
type TransformMode = 'none' | 'move' | 'scale' | 'rotate' | 'crop' | 'point' | 'control-in' | 'control-out' | 'move-path' | 'group-scale' | 'group-rotate'

// Holding Shift while rotating snaps to these increments. Read from the live
// mousemove event rather than latched at drag start, so Shift can be pressed
// or released mid-rotation and take effect immediately.
// Where an image URL should point when loading it directly didn't work.
//
// /api/proxy-image is a web-only endpoint. On desktop the same relative path
// resolves inside the app bundle, where nothing serves it, so falling back to
// it guaranteed a broken image -- which is why an embed could show fine on the
// web and blankly fail in the desktop app. Empty string means "use the
// original URL", so desktop at least gets a real attempt, and a genuine
// failure surfaces as one instead of hiding behind a dead path.
//
// This also fires on the 8s preflight timeout, not just on error, so a slow
// but perfectly good image was being swapped onto the proxy too.
const proxyFallbackFor = (url: string) =>
  isDesktop ? '' : `/api/proxy-image?url=${encodeURIComponent(url)}`

// Floating (Profile > Animations): each trace drifts at its own pace and
// phase, taken from its id, so a room of them moves out of step instead of
// bobbing together. See trace-float in index.css.
function floatTiming(id: string): { duration: number; delay: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const u = (h >>> 0) / 4294967296
  return { duration: 9 + u * 6, delay: -u * 15 }
}

// How far, in screen pixels, a trace drifts at Floating 100%.
const FLOAT_MAX_PX = 8

// A drawing's strokes as outlines to hit, once per kept drawing: each a line
// through its points, as wide as it was drawn. Erasing isn't taken off them.
// Null for a trace with no strokes kept.
const strokeHitCache = new WeakMap<object, { d: string; width: number }[]>()
function strokeHits(kept: unknown): { d: string; width: number }[] | null {
  if (!kept) return null
  // Kept by what the trace holds: asStrokeData reads it into a new object each time.
  let hits = typeof kept === 'object' ? strokeHitCache.get(kept) : undefined
  if (!hits) {
    const data = asStrokeData(kept)
    if (!data) return null
    hits = data.ops.filter(op => !op.isEraser && op.points.length > 0).map(op => ({
      d: op.points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('') + (op.points.length === 1 ? 'l0.01 0' : ''),
      width: op.width,
    }))
    if (typeof kept === 'object') strokeHitCache.set(kept, hits)
  }
  return hits
}

// A #rrggbb colour as numbers, white for anything else. For the cursors.
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 255, g: 255, b: 255 }
}

// A colour as the channels "r g b", for rgb(var(...) / alpha).
const rgbChannels = (hex: string) => { const c = hexToRgb(hex); return `${c.r} ${c.g} ${c.b}` }

// A light's falloff from its middle: a disc blurred by a third of its radius,
// as the CSS blur used to draw it -- here as a gradient, painted with the
// rest of the layer rather than a filter the compositor applies. A filter
// went with the view's moves on the web but vanished for their whole length
// in the desktop app's webview. Stops are the blurred disc's own values
// (out to 1.6 radii, where it's next to nothing), in --light-rgb.
const LIGHT_FALLOFF = [[0, 1], [31, 0.95], [44, 0.84], [62.5, 0.5], [81, 0.16], [90, 0.05], [100, 0]]
  .map(([at, a]) => `rgb(var(--light-rgb) / ${a}) ${at}%`).join(', ')

// A cursor's outline, which is what separates it from the atrium: near-black
// on a light one, white on a dark one.
function cursorEdgeOn(background: string | undefined) {
  const g = hexToRgb(background || '#0a0a0f')
  return (0.2126 * g.r + 0.7152 * g.g + 0.0722 * g.b) / 255 > 0.5 ? '#1a1a1a' : '#ffffff'
}

// What Shift snaps a dragged trace onto when the atrium has no grid size of
// its own. The same fallback LobbyScene draws with, so an atrium saved before
// the setting existed snaps to the lines it is actually showing.
const GRID_SNAP_FALLBACK = 50

// How close an edge has to come before it snaps, in SCREEN pixels.
//
// Screen rather than world, so it feels the same however far in or out the
// view is zoomed: a world-space threshold would be impossible to trigger
// zoomed out and impossible to escape zoomed in.
const ALIGN_SNAP_PX = 6

// How far away a trace can be and still be worth aligning to, in screen
// pixels. Anything further is not something the eye is relating the dragged
// trace to, and letting it snap to something off in the distance reads as the
// trace catching on nothing.
const ALIGN_NEIGHBOURHOOD_PX = 1200

// The six lines a box offers on each axis: its two edges and its middle.
type AlignEdge = { at: number; kind: 'start' | 'middle' | 'end' }

const ROTATION_SNAP_DEGREES = 5

// How close to the viewport edge the cursor has to get before dragging a
// trace starts scrolling the canvas, and how far it scrolls per frame at the
// very edge (screen pixels, converted to world units at the current zoom).
const EDGE_PAN_ZONE_PX = 64
const EDGE_PAN_MAX_SPEED_PX = 14

// The crop frame's handles: the edges each moves (lib/traceCrop's dragCrop),
// and where on the window it sits, as shares of it across and down.
const CROP_HANDLES = [
  { key: 'tl', u: 0, v: 0 }, { key: 't', u: 0.5, v: 0 }, { key: 'tr', u: 1, v: 0 },
  { key: 'l', u: 0, v: 0.5 }, { key: 'r', u: 1, v: 0.5 },
  { key: 'bl', u: 0, v: 1 }, { key: 'b', u: 0.5, v: 1 }, { key: 'br', u: 1, v: 1 },
] as const

// Room left around a selection wrapped in a frame, in world units.
const FRAME_PADDING = 40
// How far either side of its border a press takes a frame, in screen pixels.
// Its inside is left to what it holds, and to the canvas under it.
const FRAME_GRIP_PX = 6

// Wraps any angle into [0, 360) -- plain `% 360` keeps negative values.
const normalizeAngle = (deg: number) => ((deg % 360) + 360) % 360

const TRACE_CLIPBOARD_MIME = 'application/x-digital-atrium-traces'
const TRACE_CLIPBOARD_TEXT_SENTINEL = '__DIGITAL_ATRIUM_TRACE_CLIPBOARD__'

// A trace's z-index is its place in the drawing order (lib/order's
// drawRanks: 1 at the bottom, up to the number of traces). Selection handles (the `z-[1000000]` Tailwind classes below),
// other users' cursors, and the local player's own cursor all need to stay
// above every trace regardless, so they use fixed values far above any
// realistic trace z-index rather than a small constant the traces have to
// stay under. Ordered handles < other users' cursors < own cursor, matching
// this file's original (pre-uncapped-trace-zIndex) hardcoded values of 50,
// 999, and 10003 respectively.
const OTHER_USER_CURSOR_Z_INDEX = 2_000_000
// Own-cursor z-index floor: playerZIndex*100 (a stored setting, 1000 by
// default) is far below the handle/other-cursor z-index above, since it was
// never designed with editing UI in mind. Flooring the value used for both
// sort position and the cursor's rendered zIndex keeps the player's own
// cursor on top. This also has to clear
// the menu/panel z-index further down (Manage/Profile/Layer panels etc.) --
// the own cursor indicator is expected to stay visible above open menus,
// unlike traces/handles/other users' cursors.
const OWN_CURSOR_MIN_Z_INDEX = 20_000_000

// Menus/panels/dialogs (context menu, Customize/Batch Edit panels, delete
// confirmation, full-view/text-preview modal) must stay above canvas
// content -- traces, handles, and cursors -- regardless of how those scale.
// They previously used small values (50-300) left over from before trace
// z-index was uncapped, which put the handle/cursor z-index bumps above (in
// front of) these menus once a trace's own z-index or a handle exceeded
// ~300. The Customize and Batch Edit panels lay nothing over the rest of the
// screen: they follow the selection instead (see "The panels follow the
// selection"), so the canvas, the quick bar and the HUD all go on working
// while one is open.
const MENU_PANEL_Z_INDEX = 10_000_100

type TraceClipboardPayload = {
  version: 1
  lobbyId?: string
  traces: Trace[]
}

function cloneTraceSnapshot(trace: Trace): Trace {
  return {
    ...trace,
    shapePoints: trace.shapePoints?.map(point => ({ ...point })),
  }
}

function parseTraceClipboardPayload(rawValue: string): TraceClipboardPayload | null {
  try {
    const parsed = JSON.parse(rawValue) as Partial<TraceClipboardPayload>
    if (parsed.version !== 1 || !Array.isArray(parsed.traces)) {
      return null
    }

    return {
      version: 1,
      lobbyId: parsed.lobbyId,
      traces: parsed.traces.map(trace => cloneTraceSnapshot(trace as Trace)),
    }
  } catch {
    return null
  }
}

// A trace's file being written into the vault (lib/vaultWrites): how far, as a
// bar along its foot and the percent. Its own component, listening for itself,
// so a write's progress re-renders the bar and not the trace (TraceSlot).
// Light on dark in either theme, over whatever the trace shows.
function VaultWriteBar({ url }: { url: string }) {
  const fraction = useSyncExternalStore(watchVaultWrites, () => vaultWriteProgress(url))
  if (fraction === null) return null
  const percent = Math.round(fraction * 100)
  return (
    <div
      data-vault-write=""
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="absolute inset-x-0 bottom-0 pointer-events-none"
      style={{ zIndex: 3 }}
    >
      <div className="flex justify-end px-1.5 pb-1">
        <span className="font-mono text-[10px] tracking-[0.12em] tabular-nums text-white/90 bg-black/60 px-1.5 py-0.5">{percent}%</span>
      </div>
      <div className="h-1.5 bg-black/55">
        <div className="h-full bg-white/85 transition-[width] duration-200" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

// Your own cursor. A component of its own, subscribed on its own: its look
// changes as it passes over traces (cursorState), and inside TraceOverlay
// every crossing drew every trace again.
//
// Placed straight from the pointer, not by rendering. It was placed from the
// position in the store, which is only written after the mouse has moved two
// world pixels -- so it stepped, zoomed in -- and which drew the whole overlay
// again each time. On a layer of its own, too, so moving it doesn't repaint
// the traces it passes over. Mounted while hidden, so it knows where to be
// when it's shown again.
let pointerAt: { x: number; y: number } | null = null

function OwnCursor({ hidden, zIndex, pointerInWindow, crosshair, pan }: {
  hidden: boolean
  zIndex: number
  pointerInWindow: boolean
  // Something is being placed or picked on the canvas: a crosshair over it,
  // the usual cursor over the interface.
  crosshair: boolean
  // Move the view is taken up: its four arrows over the canvas.
  pan: boolean
}) {
  const { username, playerColor, cursorState, hideOwnNameTag } = useGamePick('username', 'playerColor', 'cursorState', 'hideOwnNameTag')
  const elRef = useRef<HTMLDivElement | null>(null)
  // The outline's layer, beside the cursor's rather than in it (see below).
  const edgeRef = useRef<HTMLDivElement | null>(null)
  // Whether the pointer is over the canvas; a render only when that changes.
  const [overCanvas, setOverCanvas] = useState(true)
  const overCanvasRef = useRef(true)
  // Unseen until the pointer has been somewhere, rather than in the corner.
  const putAtPointer = (el: HTMLDivElement | null) => {
    if (!el) return
    el.style.visibility = pointerAt ? '' : 'hidden'
    if (pointerAt) el.style.transform = `translate(${pointerAt.x}px, ${pointerAt.y}px)`
  }
  const place = useCallback((el: HTMLDivElement | null) => { elRef.current = el; putAtPointer(el) }, [])
  const placeEdge = useCallback((el: HTMLDivElement | null) => { edgeRef.current = el; putAtPointer(el) }, [])
  useEffect(() => {
    const follow = (e: PointerEvent) => {
      pointerAt = { x: e.clientX, y: e.clientY }
      const onCanvas = isCanvasTarget(e.target)
      if (onCanvas !== overCanvasRef.current) setOverCanvas(overCanvasRef.current = onCanvas)
      for (const el of [elRef.current, edgeRef.current]) {
        if (!el) continue
        el.style.visibility = ''
        el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      }
    }
    const options = { capture: true, passive: true }
    window.addEventListener('pointermove', follow, options)
    window.addEventListener('pointerdown', follow, options)
    return () => {
      window.removeEventListener('pointermove', follow, options)
      window.removeEventListener('pointerdown', follow, options)
    }
  }, [])

    // Over the drawing canvas the brush circle is the cursor; a
    // second one beside it only hides what is being drawn. Off it --
    // on the drawing panel, a button -- the cursor is needed again.
    if (hidden) return null
    const rgb = hexToRgb(playerColor)

    // Two layers. The outline, white, on a layer of its own that takes the
    // difference with whatever is under it -- dark over light, light over
    // dark, as Windows' inverted pointer -- and over it the body in the
    // player's colour, which hides the outline's inner half. It was black or
    // white by the atrium's background alone, and vanished over a trace of
    // the same lightness. Beside the cursor's layer, not in it: that layer is
    // moved by a transform, and what's inside one blends only with the rest
    // of it, never with the traces and ground beneath.
    //
    // Grabbing and not-allowed keep their coloured edges: those say something.
    // Each icon at its own point -- an arrow's tip, the four arrows' middle --
    // at once. It was eased there, so changing icon slid the cursor across.
    const at = (transform: string) => ({
      width: 24,
      height: 24,
      viewBox: '0 0 24 24',
      style: { transform } as React.CSSProperties,
    })
    const ARROW = 'M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z'
    let outline: React.ReactNode = null
    let body: React.ReactNode
    if (crosshair && overCanvas) {
      // Centred on the point, where the arrow's tip is at it.
      const arms = 'M12 2v6M12 16v6M2 12h6M16 12h6'
      outline = (
        <svg {...at('translate(-12px, -12px)')}>
          <path d={arms} stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="1.6" fill="#fff" />
        </svg>
      )
      body = (
        <svg {...at('translate(-12px, -12px)')}>
          <path d={arms} stroke={playerColor} strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="12" cy="12" r="1" fill={playerColor} />
        </svg>
      )
    } else if (cursorState === 'grabbing') {
      // Held -- a trace being dragged: the same four arrows, edged orange.
      body = (
        <svg {...at('translate(-12px, -12px) scale(0.95)')}>
          <path d={PAN_ICON} fill="none" stroke="#ff8a3d" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d={PAN_ICON} fill="none" stroke={playerColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    } else if (cursorState === 'pointer' || (pan && overCanvas)) {
      // Four arrows, centred on the point: over a trace, that it can be
      // moved; with Move the view, that the view will be (the readout's
      // PAN_ICON). It was a drop of paint, which said neither.
      outline = (
        <svg {...at('translate(-12px, -12px)')}>
          <path d={PAN_ICON} fill="none" stroke="#fff" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
      body = (
        <svg {...at('translate(-12px, -12px)')}>
          <path d={PAN_ICON} fill="none" stroke={playerColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    } else if (cursorState === 'grab' || cursorState === 'not-allowed') {
      // Draggable, or a red edge (not allowed).
      const look = cursorState === 'grab' ? { edge: '#90EE90', scale: 1.1 } : { edge: '#FF4444', scale: 1 }
      body = (
        <svg {...at(`translate(-2px, -2px) scale(${look.scale})`)}>
          <path d={ARROW} fill={playerColor} stroke={look.edge} strokeWidth="2" />
        </svg>
      )
    } else {
      outline = (
        <svg {...at('translate(-2px, -2px)')}>
          <path d={ARROW} fill="none" stroke="#fff" strokeWidth="3" strokeLinejoin="round" />
        </svg>
      )
      body = (
        <svg {...at('translate(-2px, -2px)')}>
          <path d={ARROW} fill={playerColor} />
        </svg>
      )
    }

    // Moved by putAtPointer and the pointer's own events, not by a render.
    const layer: React.CSSProperties = {
      position: 'absolute',
      left: 0,
      top: 0,
      willChange: 'transform',
      pointerEvents: 'none',
      zIndex,
      // Out of the window, it fades away rather than standing where the
      // pointer left; back in, it's there at once.
      opacity: pointerInWindow ? 1 : 0,
      transition: pointerInWindow ? undefined : 'opacity 700ms ease',
    }

    // Player cursor
    return (
      <>
      {outline && <div ref={placeEdge} data-cursor-edge="" style={{ ...layer, mixBlendMode: 'difference' }}>{outline}</div>}
      <div
        key="player-cursor"
        ref={place}
        style={layer}
      >
        {body}
        {/* Player label -- a user-chosen dark/near-black color used
            to glow/blend into the also-dark background+canvas,
            making the tag unreadable. Perceived luminance decides
            whether the glow is the player's own color (fine for
            lighter colors, which already contrast against the dark
            backdrop) or a fixed light stroke/glow (for dark colors,
            which otherwise vanish into their own background). */}
        {!hideOwnNameTag && (() => {
          const luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
          const isDarkColor = luminance < 90
          return (
          <div
            style={{
              position: 'absolute',
              top: 20,
              left: 12,
              color: playerColor,
              fontSize: '11px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              textShadow: isDarkColor
                ? '0 0 6px rgba(255,255,255,0.9), 0 0 2px rgba(255,255,255,0.9)'
                : `0 0 8px rgba(${rgb.r},${rgb.g},${rgb.b},0.5), 0 2px 4px rgba(0,0,0,0.8)`,
              WebkitTextStroke: isDarkColor ? '0.5px rgba(255,255,255,0.6)' : undefined,
              letterSpacing: '0.5px',
              background: isDarkColor ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.6)',
              border: isDarkColor ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
              padding: '2px 6px',
              borderRadius: '3px',
            }}
          >
            {username}
          </div>
          )
        })()}
      </div>
      </>
    )
}

// The desktop app on macOS and Linux runs from tauri://localhost, whose frames
// carry no Referer, and YouTube won't play without one: videos go through the
// site's relay page there (see throughRelay).
const EMBED_NEEDS_RELAY = isDesktop && !/Windows/i.test(navigator.userAgent)

// How long the trace stays visibly pressed after the click before the link
// actually opens, so the press reads as a press rather than the atrium
// seeming to jump straight to a browser.
const LINK_OPEN_DELAY_MS = 1000

// One trace, drawn again only when something it shows has changed.
//
// TraceOverlay draws every trace in one render, so any change anywhere -- a
// trace dragged, a selection, an image loaded -- drew all of them again:
// dragging one of three hundred on screen ran at 23 frames a second in
// development, 63 in production, 10 on a slower machine. Each trace's drawing
// is now kept while its signature (traceSignature) is unchanged, and only the
// traces a change touches are drawn again.
type TraceSlotProps = { trace: Trace; render: (trace: Trace) => React.ReactNode; signature: unknown[] }
const TraceSlot = React.memo(
  function TraceSlot({ trace, render }: TraceSlotProps) {
    return <>{render(trace)}</>
  },
  (a, b) => a.trace === b.trace
    && a.signature.length === b.signature.length
    && a.signature.every((value, i) => Object.is(value, b.signature[i])),
)

// How far past the edges of the screen, in world units, traces are still
// mounted. Also how far LobbyScene can slide this layer while a pan or zoom
// runs before it has to be laid out again.
export const CULL_MARGIN = 500

export default function TraceOverlay({ traces, onPaste, atriumBackground, gridLineSpacing, zoom, worldOffset, worldLayerRef, onEdgePan, lobbyId, selectedTraceId, setSelectedTraceId, multiSelectRequest, areaSelectRequest, lassoSelectRequest, selecting = false, customizeRequest, newPathRequest, newTextRequest, directSelect = false, frameRequest, isDrawingMode, hideCursor, panning = false, placing = false, onEditDrawing, hiddenTraceIds, toolSwitch = 0, onMultiSelectionChange, onExport, onCustomizeOpen, canEdit = true }: TraceOverlayProps) {
  const { t, language } = useTranslation()
    // Register an @font-face for each custom font bundled from
    // src/assets/fonts (see CUSTOM_FONTS above). Build-time resolved, so no
    // runtime directory listing is involved.
    useEffect(() => {
      const styleElements: HTMLStyleElement[] = []
      CUSTOM_FONTS.forEach(({ name, url }) => {
        if (!document.querySelector(`style[data-font="${name}"]`)) {
          const style = document.createElement('style');
          style.setAttribute('data-font', name);
          style.innerHTML = `@font-face { font-family: '${name}'; src: url('${url}'); font-display: swap; }`;
          document.head.appendChild(style);
          styleElements.push(style);
        }
      });
      return () => {
        styleElements.forEach(style => {
          if (style.parentNode) {
            style.parentNode.removeChild(style);
          }
        });
      };
    }, []);
  const { username, playerZIndex, setCursorState, otherUsers, removeTrace, userId, addTrace, markTraceChanged, markTraceDeleted, showTraceTypeLabels, hideOtherNameTags, hideOtherCursors, traceFadeEnabled, traceFloat, traceMomentum, dragBounce, links, putLink, dropLink, layers, confirmDelete } = useGamePick('username', 'playerZIndex', 'setCursorState', 'otherUsers', 'removeTrace', 'userId', 'addTrace', 'markTraceChanged', 'markTraceDeleted', 'showTraceTypeLabels', 'hideOtherNameTags', 'hideOtherCursors', 'traceFadeEnabled', 'traceFloat', 'traceMomentum', 'dragBounce', 'links', 'putLink', 'dropLink', 'layers', 'confirmDelete')
  const [showPlayerMenu, setShowPlayerMenu] = useState(false)
  const [transformMode, setTransformMode] = useState<TransformMode>('none')
  const [isCropMode, setIsCropMode] = useState(false)
  const [localTraceTransforms, setLocalTraceTransforms] = useState<Record<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number }>>({})
  const justDraggedRef = useRef(false)
  // Distinguishes a genuine click on empty canvas (should deselect) from a
  // click+drag that happens to end on the same element, e.g. panning the
  // map (should NOT deselect) -- native 'click' events fire after mouseup
  // regardless of how far the mouse moved in between, so this is tracked
  // separately from justDraggedRef, which only covers dragging a trace.
  const mouseDownScreenPosRef = useRef<{ x: number; y: number } | null>(null)
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({})
  const [modalTrace, setModalTrace] = useState<Trace | null>(null)
  // Tracked live (not just read once) so the image modal below stays
  // correctly sized if the window is resized while it's open.
  const [modalViewportSize, setModalViewportSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    if (!modalTrace) return
    const handleResize = () => setModalViewportSize({ width: window.innerWidth, height: window.innerHeight })
    // Measured when the modal opens, not only on subsequent resizes. The
    // initial value is captured once when this component mounts and the
    // listener below only runs while a modal is open, so every resize that
    // happened in between was missed -- and the modal then sized itself to a
    // window that no longer existed. Rare on the web, routine on desktop,
    // where the window is maximised, resized and toggled to fullscreen, which
    // is why the desktop modal came out smaller than the web one.
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [modalTrace])
  const [copiedModalText, setCopiedModalText] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; traceId: string } | null>(null)
  // Declared at the top level rather than beside the menu's JSX, which sits
  // inside an IIFE where a hook can't be called.
  // Whether this click should follow the trace's link.
  //
  // A press-drag-release fires a click event too, so the drag has to be ruled
  // out explicitly or repositioning a clickable trace would navigate away the
  // moment you let go. Two independent guards, because each misses a case the
  // other catches: justDraggedRef is only set once a move actually happens,
  // while the distance check also covers a drag that moved the pointer without
  // the trace (a locked trace, or a drag that started on a child element).
  // The clickable trace currently held down. Drives both the press animation
  // and the handle suppression above.
  // Paged PDF traces. Only the page currently being looked at is rasterized,
  // keyed `traceId:pageNumber` so flipping back to a page you've already seen
  // is instant and a long document never holds every page in memory at once.
  const [documentPage, setDocumentPage] = useState<Record<string, number>>({})
  const [documentPageCount, setDocumentPageCount] = useState<Record<string, number>>({})
  // Mirrored for the prefetch, which runs outside render and would otherwise
  // close over a stale count.
  const documentPageCountRef = useRef<Record<string, number>>({})
  useEffect(() => { documentPageCountRef.current = documentPageCount }, [documentPageCount])
  // A deck (a document trace whose file is its slides: lib/deck) says how
  // many it has once it's read (DeckSlide).
  const countSlides = useCallback((id: string, count: number) => {
    setDocumentPageCount(prev => (prev[id] === count ? prev : { ...prev, [id]: count }))
  }, [])
  // Rendered pages held at once, across every PDF trace in the atrium. Enough
  // that paging back and forth stays instant, small enough that a long
  // document can't fill memory with full-resolution bitmaps.
  // Kept small: a rendered page is held as a decoded bitmap, which is far
  // larger than the compressed file it came from, so this is the setting that
  // decides how heavy a paged document feels. Enough to step back and forth
  // without re-rendering.
  const MAX_CACHED_PDF_PAGES = 4
  const [documentPages, setDocumentPages] = useState<Record<string, string>>({})
  const [documentError, setDocumentError] = useState<Record<string, string>>({})
  // Which trace+page combinations have already been started, so a re-render
  // mid-render doesn't kick off the same work again.
  const documentRenderingRef = useRef<Set<string>>(new Set())
  // Retry bookkeeping for a file that isn't on disk yet. The tick is state
  // purely to re-run the effect below -- the counts themselves live in a ref
  // so a retry doesn't cascade renders.
  const documentRetryRef = useRef<Record<string, number>>({})
  const [documentRetryTick, setDocumentRetryTick] = useState(0)

  // Leaving the atrium closes any open PDF, which otherwise keeps its worker
  // and parsed structure alive for a document nobody is looking at.
  useEffect(() => () => {
    import('../lib/pdf').then(m => m.releaseAllPdfDocuments()).catch(() => {})
  }, [])

  // Stores a rendered page and evicts the oldest beyond the cap, revoking the
  // URLs it drops -- a blob URL is never reclaimed while a reference exists.
  const rememberPage = useCallback((key: string, url: string) => {
    setDocumentPages(prev => {
      const next = { ...prev, [key]: url }
      const keys = Object.keys(next)
      if (keys.length > MAX_CACHED_PDF_PAGES) {
        for (const stale of keys.slice(0, keys.length - MAX_CACHED_PDF_PAGES)) {
          // Never drop the page currently on screen, whatever the insertion
          // order happens to be.
          if (stale === key) continue
          URL.revokeObjectURL(next[stale])
          delete next[stale]
        }
      }
      return next
    })
  }, [])

  // Renders the following page in the background and writes it to the vault.
  //
  // Reading is overwhelmingly forwards, so by the time the next page is asked
  // for it's usually already on disk. Deliberately fire-and-forget and only
  // one page ahead: this is a nicety, and racing further ahead would compete
  // with the page the user is actually looking at.
  const prefetchNextPage = useCallback(async (trace: Trace, currentPage: number) => {
    if (!isDesktop || !supabase || !lobbyId || !trace.mediaUrl) return
    const total = documentPageCountRef.current[trace.id]
    const next = currentPage + 1
    if (!total || next > total) return

    const cachePath = `${lobbyId}/${trace.id}_pages/${next}.webp`
    try {
      const { readLocalFileBytes } = await import('../lib/localDb')
      if (await readLocalFileBytes(`local://traces/${cachePath}`)) return

      const { renderPdfPage } = await import('../lib/pdf')
      const rendered = await renderPdfPage(trace.id, async () => {
        const bytes = await readLocalFileBytes(trace.mediaUrl!)
        if (!bytes) throw new Error('not-on-disk')
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      }, next)
      if (!rendered) return
      await supabase.storage.from('traces').upload(cachePath, rendered.blob)
    } catch {
      // A prefetch that fails costs nothing -- the page renders on demand.
    }
  }, [lobbyId])

  // The page position is deliberately local and unsaved. In a shared atrium,
  // persisting it would mean one person paging through moved the document for
  // everyone else reading it.
  useEffect(() => {
    if (!isDesktop) return

    for (const trace of traces) {
      if (trace.type !== 'document' || !trace.mediaUrl || isDeckFile(trace.mediaUrl)) continue
      const page = documentPage[trace.id] ?? 1
      const key = `${trace.id}:${page}`
      if (documentPages[key] || documentRenderingRef.current.has(key)) continue
      documentRenderingRef.current.add(key)

      ;(async () => {
        try {
          // Read straight off disk rather than resolving to a blob: URL and
          // fetching it -- fetching a blob is a connect-src request, which
          // the desktop CSP doesn't allow blob: for, and it failed with a
          // bare "Failed to fetch".
          //
          // Only ever called on the first page of a document: the loader is
          // handed to the pdf module, which keeps the parsed document open, so
          // later pages neither re-read the file nor re-parse it.
          const { readLocalFileBytes } = await import('../lib/localDb')
          let missing = false
          const loadBytes = async () => {
            const bytes = await readLocalFileBytes(trace.mediaUrl!)
            if (!bytes) {
              missing = true
              throw new Error('not-on-disk')
            }
            // Copied into a standalone ArrayBuffer: the bytes may be a view
            // onto a larger buffer, and pdfjs would otherwise read past the
            // end of the file.
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer
          }

          const { renderPdfPage, getOpenPdfPageCount } = await import('../lib/pdf')

          if (documentPageCount[trace.id] === undefined) {
            try {
              const count = await getOpenPdfPageCount(trace.id, loadBytes)
              setDocumentPageCount(prev => ({ ...prev, [trace.id]: count }))
            } catch (e) {
              if (!missing) throw e
            }
          }

          // The file isn't on disk yet. Treated as "not ready" rather than a
          // failure: a freshly created trace can reach here before its own
          // file has finished being written.
          if (missing) {
            documentRenderingRef.current.delete(key)
            const attempts = (documentRetryRef.current[key] ?? 0) + 1
            documentRetryRef.current[key] = attempts
            if (attempts <= 10) {
              window.setTimeout(() => setDocumentRetryTick(t => t + 1), 400)
            } else {
              setDocumentError(prev => ({ ...prev, [trace.id]: t('atrium.error.fileNotInVault') }))
            }
            return
          }

          // Rendered pages are cached in the vault, keyed by trace and page.
          //
          // This is the whole difference in feel between the two modes.
          // Page-per-trace rasterizes once at import and then displays plain
          // images, so pdfjs is never involved again. The paged viewer was
          // re-rasterizing on every single view -- keeping the document open
          // removed the parsing cost but not the rendering, which for a
          // complex page is most of it. Caching to disk means a page is
          // rendered once ever, and returning to it is just an image load.
          const cacheUrl = `local://traces/${lobbyId}/${trace.id}_pages/${page}.webp`

          const cachedBytes = await readLocalFileBytes(cacheUrl)
          if (cachedBytes) {
            const cachedBlob = new Blob([cachedBytes as unknown as BlobPart], { type: 'image/webp' })
            rememberPage(key, URL.createObjectURL(cachedBlob))
            void prefetchNextPage(trace, page)
            return
          }

          const rendered = await renderPdfPage(trace.id, loadBytes, page)
          if (!rendered) return

          // Written for next time. Not awaited -- the page is already on
          // screen by then, and a failed write costs a re-render later rather
          // than anything the user sees now.
          if (supabase && lobbyId) {
            void supabase.storage
              .from('traces')
              .upload(`${lobbyId}/${trace.id}_pages/${page}.webp`, rendered.blob)
          }
          rememberPage(key, URL.createObjectURL(rendered.blob))
          void prefetchNextPage(trace, page)
          setDocumentError(prev => {
            if (!prev[trace.id]) return prev
            const next = { ...prev }
            delete next[trace.id]
            return next
          })
        } catch (err) {
          // Only ever a whole file: a read waits for a file still being written
          // (readLocalFileBytes, lib/vaultWrites), so this is a PDF that is
          // broken, not one that hadn't finished landing.
          console.error('PDF page render failed:', err)
          // The real message, not a generic one -- "could not read this PDF"
          // told nobody anything when this went wrong.
          setDocumentError(prev => ({
            ...prev,
            [trace.id]: err instanceof Error ? err.message : t('atrium.error.pdfUnreadable'),
          }))
        } finally {
          documentRenderingRef.current.delete(key)
        }
      })()
    }
  }, [traces, documentPage, documentPages, documentPageCount, documentRetryTick])

  const [pressedClickableId, setPressedClickableId] = useState<string | null>(null)

  // The trace whose link is about to open. Keeps the pressed styling on (and
  // the handles off) through the delay, after the button has been released.
  const [pendingLinkTraceId, setPendingLinkTraceId] = useState<string | null>(null)
  const pendingLinkTimerRef = useRef<number | null>(null)

  // Cancels a pending open if the overlay goes away first -- switching atriums
  // mid-delay shouldn't still launch a browser a second later.
  useEffect(() => () => {
    if (pendingLinkTimerRef.current) window.clearTimeout(pendingLinkTimerRef.current)
  }, [])
  // Mirrored, because handleMouseMove runs from a window listener and reads
  // this on every frame of a drag -- state there would be a stale closure.
  const pressedClickableIdRef = useRef<string | null>(null)
  useEffect(() => { pressedClickableIdRef.current = pressedClickableId }, [pressedClickableId])

  const CLICK_DRAG_TOLERANCE_PX = 5
  const isClickThrough = (trace: Trace, e: React.MouseEvent): boolean => {
    if (!trace.isClickable || !trace.linkUrl) return false
    // Modifier clicks mean selection, not navigation.
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
    if (justDraggedRef.current) return false
    // Never while editing the trace's own text, or mid path-drawing.
    if (inlineEditingTraceId === trace.id || pathCreationMode) return false

    const downPos = mouseDownScreenPosRef.current
    if (downPos) {
      const travelled = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
      if (travelled > CLICK_DRAG_TOLERANCE_PX) return false
    }
    return true
  }

  const lastPointerRef = useRef<{ x: number; y: number; shiftKey: boolean } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuPos = useClampedMenuPosition(contextMenuRef, contextMenu?.x ?? 0, contextMenu?.y ?? 0)
  // Side-flyout submenus inside the trace context menu (Move Layer,
  // Transformations) -- opened/closed on hover rather than click, with a
  // short close delay so moving the mouse diagonally from the trigger row
  // to the flyout doesn't close it prematurely.
  const [contextMenuMoveOpen, setContextMenuMoveOpen] = useState(false)
  const [contextMenuTransformOpen, setContextMenuTransformOpen] = useState(false)
  // Flyouts are positioned via `position: fixed` computed from the
  // trigger's own bounding rect (captured here) rather than `position:
  // absolute` inside the menu -- the menu has `overflow-y-auto`, and per
  // the CSS overflow spec, setting only overflow-y to a non-visible value
  // forces overflow-x to compute as auto too, which clipped an absolutely
  // positioned flyout into a scrollbar instead of letting it render outside
  // the menu's box.
  const [moveFlyoutRect, setMoveFlyoutRect] = useState<{ top: number; left: number; right: number } | null>(null)
  const [transformFlyoutRect, setTransformFlyoutRect] = useState<{ top: number; left: number; right: number } | null>(null)
  const moveFlyoutCloseTimer = useRef<number | null>(null)
  const transformFlyoutCloseTimer = useRef<number | null>(null)
  const openMoveFlyout = (e: React.MouseEvent<HTMLElement>) => {
    if (moveFlyoutCloseTimer.current) window.clearTimeout(moveFlyoutCloseTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setMoveFlyoutRect({ top: rect.top, left: rect.left, right: rect.right })
    setContextMenuMoveOpen(true)
  }
  const keepMoveFlyoutOpen = () => {
    if (moveFlyoutCloseTimer.current) window.clearTimeout(moveFlyoutCloseTimer.current)
  }
  const scheduleCloseMoveFlyout = () => {
    if (moveFlyoutCloseTimer.current) window.clearTimeout(moveFlyoutCloseTimer.current)
    moveFlyoutCloseTimer.current = window.setTimeout(() => setContextMenuMoveOpen(false), 200)
  }
  const openTransformFlyout = (e: React.MouseEvent<HTMLElement>) => {
    if (transformFlyoutCloseTimer.current) window.clearTimeout(transformFlyoutCloseTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setTransformFlyoutRect({ top: rect.top, left: rect.left, right: rect.right })
    setContextMenuTransformOpen(true)
  }
  const keepTransformFlyoutOpen = () => {
    if (transformFlyoutCloseTimer.current) window.clearTimeout(transformFlyoutCloseTimer.current)
  }
  const scheduleCloseTransformFlyout = () => {
    if (transformFlyoutCloseTimer.current) window.clearTimeout(transformFlyoutCloseTimer.current)
    transformFlyoutCloseTimer.current = window.setTimeout(() => setContextMenuTransformOpen(false), 200)
  }
  // "Reorganize Selected" side flyout -- the packing shape used to be a
  // persisted preference set in the Profile panel, which meant choosing it
  // was separated from the one action that uses it. It's now picked at the
  // moment of use, like the other flyouts here.
  const [contextMenuReorganizeOpen, setContextMenuReorganizeOpen] = useState(false)
  const [reorganizeFlyoutRect, setReorganizeFlyoutRect] = useState<{ top: number; left: number; right: number } | null>(null)
  const reorganizeFlyoutCloseTimer = useRef<number | null>(null)
  const openReorganizeFlyout = (e: React.MouseEvent<HTMLElement>) => {
    if (reorganizeFlyoutCloseTimer.current) window.clearTimeout(reorganizeFlyoutCloseTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setReorganizeFlyoutRect({ top: rect.top, left: rect.left, right: rect.right })
    setContextMenuReorganizeOpen(true)
  }
  const keepReorganizeFlyoutOpen = () => {
    if (reorganizeFlyoutCloseTimer.current) window.clearTimeout(reorganizeFlyoutCloseTimer.current)
  }
  const scheduleCloseReorganizeFlyout = () => {
    if (reorganizeFlyoutCloseTimer.current) window.clearTimeout(reorganizeFlyoutCloseTimer.current)
    reorganizeFlyoutCloseTimer.current = window.setTimeout(() => setContextMenuReorganizeOpen(false), 200)
  }

  useEffect(() => {
    setContextMenuMoveOpen(false)
    setContextMenuTransformOpen(false)
    setContextMenuGroupOpen(false)
    setContextMenuReorganizeOpen(false)
  }, [contextMenu?.traceId])
  // "Move to Group" side flyout -- lets the user reassign the selected
  // trace(s) to a layer group (or Ungrouped) straight from the canvas
  // context menu, without opening the Layer panel. The groups are the store's
  // (hooks/useLayers).
  const [contextMenuGroupOpen, setContextMenuGroupOpen] = useState(false)
  const [groupFlyoutRect, setGroupFlyoutRect] = useState<{ top: number; left: number; right: number } | null>(null)
  const groupFlyoutCloseTimer = useRef<number | null>(null)
  const openGroupFlyout = (e: React.MouseEvent<HTMLElement>) => {
    if (groupFlyoutCloseTimer.current) window.clearTimeout(groupFlyoutCloseTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setGroupFlyoutRect({ top: rect.top, left: rect.left, right: rect.right })
    setContextMenuGroupOpen(true)
    // Re-read the groups every time the flyout opens.
    //
    // The list below is otherwise loaded once on mount and kept current by a
    // postgres_changes subscription -- which does nothing at all on desktop,
    // where `supabase` is the local shim and `channel()` hands back a mock. So
    // a group made in the Layer panel never reached this menu, and the only
    // way to see it was to leave the atrium and come back, which remounts and
    // re-runs the initial load.
    //
    // Asking on open fixes it on both platforms without depending on realtime:
    // it is one small query, at the moment somebody is about to read the
    // answer, and it cannot be stale by the time the flyout paints.
    if (lobbyId) void reloadLayers(lobbyId)
  }
  const keepGroupFlyoutOpen = () => {
    if (groupFlyoutCloseTimer.current) window.clearTimeout(groupFlyoutCloseTimer.current)
  }
  const scheduleCloseGroupFlyout = () => {
    if (groupFlyoutCloseTimer.current) window.clearTimeout(groupFlyoutCloseTimer.current)
    groupFlyoutCloseTimer.current = window.setTimeout(() => setContextMenuGroupOpen(false), 200)
  }
  // "Select" side flyout. Same open/keep/close trio as the flyouts above it;
  // they are separate pieces of state so hovering one closes the others rather
  // than leaving two open side by side.
  // The alignment guides currently being shown, in world coordinates. Set
  // while a trace is being Shift-dragged and cleared when the drag ends.
  const [alignGuides, setAlignGuides] = useState<{
    x?: { at: number; from: number; to: number }
    y?: { at: number; from: number; to: number }
  } | null>(null)

  // Mirrored for the move handler, which is bound to the document and so
  // closes over whatever these were when it was attached.
  const alignGuidesRef = useRef<typeof alignGuides>(null)
  useEffect(() => { alignGuidesRef.current = alignGuides }, [alignGuides])

  const [contextMenuSelectOpen, setContextMenuSelectOpen] = useState(false)
  const [selectFlyoutRect, setSelectFlyoutRect] = useState<{ top: number; left: number; right: number } | null>(null)
  const selectFlyoutCloseTimer = useRef<number | null>(null)
  const selectTriggerRef = useRef<HTMLDivElement>(null)
  const openSelectFlyout = () => {
    if (selectFlyoutCloseTimer.current) window.clearTimeout(selectFlyoutCloseTimer.current)
    setContextMenuSelectOpen(true)
  }

  // Measured after layout, not during the mouseenter that opened it.
  //
  // Reading getBoundingClientRect() inside the event handler takes the row's
  // position as it is at that instant -- but the context menu places itself
  // twice: once where the click was, then again once useClampedMenuPosition
  // has measured it and pulled it back inside the window. Hovering before
  // that second placement stored a rect from the first, so the flyout opened
  // beside where the row used to be. Clicking elsewhere and reopening looked
  // like a refresh because by then the menu was already settled.
  //
  // A layout effect keyed on the menu's own position reads the row where it
  // actually ended up, and re-reads it if the menu ever moves underneath.
  useLayoutEffect(() => {
    if (!contextMenuSelectOpen) return
    const el = selectTriggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setSelectFlyoutRect({ top: rect.top, left: rect.left, right: rect.right })
  }, [contextMenuSelectOpen, contextMenuPos.x, contextMenuPos.y])
  const keepSelectFlyoutOpen = () => {
    if (selectFlyoutCloseTimer.current) window.clearTimeout(selectFlyoutCloseTimer.current)
  }
  const scheduleCloseSelectFlyout = () => {
    if (selectFlyoutCloseTimer.current) window.clearTimeout(selectFlyoutCloseTimer.current)
    selectFlyoutCloseTimer.current = window.setTimeout(() => setContextMenuSelectOpen(false), 200)
  }

  const groupLayers = React.useMemo(() => inOrder(layers).reverse(), [layers])
  // Each trace's place in the drawing order (lib/order) -- the stack from the
  // bottom up, a group's traces where the group is -- as its CSS z-index. Tripled,
  // so between it and the trace under it there are two levels of its own: its
  // light, one below it, and under that the threads whose lower end it is
  // (TraceLinksLayer).
  const drawRank = React.useMemo(() => drawRanks(traces, layers), [traces, layers])
  const zOf = (trace: Trace) => (drawRank.get(trace.id) ?? 0) * 3

  // How many rows of the Move to Group flyout are shown before it scrolls:
  // New Group, Ungrouped, and three groups.
  const GROUP_FLYOUT_VISIBLE_ROWS = 5
  const groupFlyoutListRef = useRef<HTMLDivElement>(null)
  const [groupFlyoutMaxHeight, setGroupFlyoutMaxHeight] = useState<number | undefined>(undefined)

  // Cap the flyout at the bottom of its fifth row.
  //
  // Measured rather than written as a pixel constant, because the constant
  // would be a copy of the row's padding and line-height kept in a second
  // place -- correct until someone changes the type scale, and then quietly
  // cutting a row in half. Reading the fifth row's own position also takes in
  // the divider above it without having to know it is there.
  useLayoutEffect(() => {
    const el = groupFlyoutListRef.current
    if (!contextMenuGroupOpen || !el) {
      setGroupFlyoutMaxHeight(undefined)
      return
    }
    const rows = el.querySelectorAll<HTMLElement>('[data-group-row]')
    // Everything fits: no cap, so the flyout keeps its natural height.
    if (rows.length <= GROUP_FLYOUT_VISIBLE_ROWS) {
      setGroupFlyoutMaxHeight(undefined)
      return
    }
    const last = rows[GROUP_FLYOUT_VISIBLE_ROWS - 1]
    const style = window.getComputedStyle(el)
    // offsetTop is measured inside the border, and box-sizing is border-box
    // globally, so both borders and the bottom padding have to be added back
    // for the fifth row to end up whole rather than clipped.
    const padBottom = parseFloat(style.paddingBottom) || 0
    const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    setGroupFlyoutMaxHeight(last.offsetTop + last.offsetHeight + padBottom + borders)
  }, [contextMenuGroupOpen, groupLayers.length])
  // One trace's new group (null: none) and key: shown, then written.
  const writeTraceGroupKey = async (trace: Trace, layerId: string | null, orderKey: string) => {
    const { error } = await (supabase!.from('traces') as any)
      .update({ layer_id: layerId, order_key: orderKey })
      .eq('id', trace.id)
    if (error) return
    // As it is now, not as it was read: edits waiting for Save stay.
    const now = useGameStore.getState().traces.find(t => t.id === trace.id) ?? trace
    useGameStore.getState().addTrace({ ...now, layerId, orderKey })
  }

  // Into a group, on top of it, in the order they were drawn in. One write
  // each: the trace's group and its key there. (Out of one: releaseFromGroups.)
  const moveIntoGroup = useCallback(async (traceIds: string[], targetLayerId: string) => {
    if (!supabase || !canEdit || traceIds.length === 0) return
    const store = useGameStore.getState()
    const idSet = new Set(traceIds)
    const ranks = drawRanks(store.traces, store.layers)
    const moving = store.traces
      .filter(t => idSet.has(t.id) && t.layerId !== targetLayerId)
      .sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0))
    const keys = keysOnTopOfGroup(store.traces.filter(t => !idSet.has(t.id)), targetLayerId, moving.length)
    for (let i = 0; i < moving.length; i++) await writeTraceGroupKey(moving[i], targetLayerId, keys[i])
  }, [canEdit])

  // Out of their groups, into the stack (lib/order): each group's traces just
  // above it, in the order they were drawn in -- where they were, as near as
  // can be. Ungroup, for traces picked out of a group or for all of one.
  const releaseFromGroups = useCallback(async (traceIds: string[]) => {
    if (!supabase || !canEdit || traceIds.length === 0) return
    const idSet = new Set(traceIds)
    const byGroup = new Map<string, string[]>()
    for (const tr of useGameStore.getState().traces) {
      if (idSet.has(tr.id) && tr.layerId) byGroup.set(tr.layerId, [...(byGroup.get(tr.layerId) ?? []), tr.id])
    }
    for (const [layerId, ids] of byGroup) {
      // Read again for each group: the one before it has moved things.
      const store = useGameStore.getState()
      const moving = inOrder(store.traces.filter(t => ids.includes(t.id)))
      const stack = inOrder(topLevel(store.traces, store.layers))
      const at = stack.findIndex(item => item.id === layerId)
      const keys = (at === -1 ? null : keysAt(stack, at + 1, moving.length)) ?? keysOnTop(stack, moving.length)
      for (let i = 0; i < moving.length; i++) await writeTraceGroupKey(moving[i], null, keys[i])
    }
  }, [canEdit])

  // Makes a group and drops the traces straight into it. The group stands
  // where the highest of them did -- as Photoshop's does -- so grouping
  // doesn't send them over or under what they were among.
  const makeGroupWith = useCallback(async (traceIds: string[], rawName: string) => {
    const name = rawName.trim()
    if (!supabase || !lobbyId || !name) return

    const store = useGameStore.getState()
    const idSet = new Set(traceIds)
    const ranks = drawRanks(store.traces, store.layers)
    const highest = store.traces.filter(t => idSet.has(t.id)).sort((a, b) => (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0))[0]
    const stack = inOrder(topLevel(store.traces.filter(t => !idSet.has(t.id)), store.layers))
    let orderKey: string | undefined
    if (highest) {
      // Its group, in the stack; or -- loose, so not in it -- where it was.
      const inGroup = groupIdOf(highest, store.layers)
      const at = inGroup ? stack.findIndex(item => item.id === inGroup) + 1 : stack.filter(item => compareOrder(item, highest) < 0).length
      orderKey = keyAt(stack, at) ?? undefined
    }

    let group
    try {
      group = await createGroup(lobbyId, name, userId, orderKey)
    } catch (err) {
      console.error('[layers] could not create group:', err)
      return
    }
    if (traceIds.length > 0) await moveIntoGroup(traceIds, group.id)
  }, [lobbyId, userId, moveIntoGroup])

  // Ctrl+G: the selection into a new group called "Group N", N the lowest
  // number no group here already has. Names are read fresh rather than from
  // groupLayers, which on desktop can miss a group the Layer panel just made.
  //
  // A second Ctrl+G while a layer change is under way is ignored: queued, it
  // would make another group and move everything into that one.
  //
  // Each group change is one undoable step (lib/layerUndo).
  const groupSelection = useCallback(async (traceIds: string[]) => {
    if (!supabase || !lobbyId || !canEdit || traceIds.length === 0 || layerChangeUnderWay()) return
    await queueLayerChange(() => withLayerUndo('group', async () => {
      const { data } = await (supabase!.from('layers') as any).select('name').eq('lobby_id', lobbyId)
      const taken = ((data ?? []) as { name: string | null }[]).map(l => l.name)
      await makeGroupWith(traceIds, firstFreeName(taken, n => t('atrium.layers.numberedGroup', { n })))
    }))
  }, [lobbyId, canEdit, makeGroupWith])

  // The same two from the menus and the New Group dialog, through the layer
  // queue (lib/layerQueue); the unqueued ones above are for inside a change.
  const moveTracesToGroup = (traceIds: string[], targetLayerId: string | null) =>
    queueLayerChange(() => withLayerUndo('move to group', () =>
      targetLayerId ? moveIntoGroup(traceIds, targetLayerId) : releaseFromGroups(traceIds)))
  const createGroupAndMove = (traceIds: string[], name: string) =>
    queueLayerChange(() => withLayerUndo('new group', () => makeGroupWith(traceIds, name)))

  // Ungroup (the canvas menu, Ctrl+Shift+G), for what's selected: a group
  // selected whole is undone -- its traces left where it stood, the group
  // gone, as the Layer panel's Ungroup does -- and traces picked out of a
  // group (a second click, or Direct select) leave it on their own, just
  // above it, the group kept. One step for all of it.
  const ungroupSelection = (traceIds: string[]) => {
    if (!supabase || !canEdit || traceIds.length === 0) return
    const store = useGameStore.getState()
    const idSet = new Set(traceIds)
    const whole: string[] = []
    const picked: string[] = []
    for (const layerId of groupsOf(traceIds)) {
      const members = store.traces.filter(tr => tr.layerId === layerId)
      if (members.every(m => idSet.has(m.id))) whole.push(layerId)
      else picked.push(...members.filter(m => idSet.has(m.id)).map(m => m.id))
    }
    if (whole.length === 0 && picked.length === 0) return
    return queueLayerChange(() => withLayerUndo('ungroup', async () => {
      await releaseFromGroups(picked)
      for (const layerId of whole) {
        const members = useGameStore.getState().traces.filter(tr => tr.layerId === layerId).map(tr => tr.id)
        await releaseFromGroups(members)
        const { error } = await (supabase!.from('layers') as any).delete().eq('id', layerId)
        if (error) {
          console.error('[layers] could not remove the group:', error)
          continue
        }
        useGameStore.getState().forgetLayer(layerId)
      }
      window.dispatchEvent(new Event('atrium:layers-changed'))
    }))
  }
  // The groups some traces are in.
  const groupsOf = (traceIds: string[]) => {
    const all = useGameStore.getState()
    const ids = new Set(traceIds)
    return [...new Set(all.traces.filter(tr => ids.has(tr.id) && tr.layerId && all.layers.some(l => l.id === tr.layerId)).map(tr => tr.layerId!))]
  }

  // A vault write finished, so the file it was copying now exists on disk and
  // the trace should read from there rather than through the blob URL it was
  // given at import. Re-resolving changes the element's src, which is also
  // what clears a <video> that failed to load while the write had the thread.
  useEffect(() => {
    const onWritten = (event: Event) => {
      const localUrl = (event as CustomEvent).detail?.localUrl as string | undefined
      if (!localUrl) return
      const affected = tracesRef.current.filter(t => t.mediaUrl === localUrl)
      if (affected.length === 0) return
      void resolveLocalStreamUrl(localUrl).then(resolved => {
        setLocalMediaUrls(prev => {
          const next = { ...prev }
          for (const t of affected) next[t.id] = resolved
          return next
        })
      }).catch(() => {})
    }
    window.addEventListener('atrium:vault-write-complete', onWritten)
    return () => window.removeEventListener('atrium:vault-write-complete', onWritten)
  }, [])

  // Whether the pointer is over the window at all, for the cursor to fade.
  const [pointerInWindow, setPointerInWindow] = useState(true)
  useEffect(() => {
    const root = document.documentElement
    const left = () => setPointerInWindow(false)
    const back = () => setPointerInWindow(true)
    root.addEventListener('mouseleave', left)
    root.addEventListener('mouseenter', back)
    return () => {
      root.removeEventListener('mouseleave', left)
      root.removeEventListener('mouseenter', back)
    }
  }, [])

  const [editingTrace, setEditingTrace] = useState<Trace | null>(null)
  const [imageProxySources, setImageProxySources] = useState<Record<string, string>>({}) // Track which images use proxy
  const [localMediaUrls, setLocalMediaUrls] = useState<Record<string, string>>({}) // Track resolved local:// URLs for audio/video
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{ traceIds: string[]; linkIds: string[] } | null>(null)
  // "New group" from the Move to Group flyout: which traces are going into it,
  // and the name being typed. Kept here rather than in the Layer panel because
  // the panel is not necessarily open -- the whole point of the flyout is to
  // reach groups without it.
  const [newGroupDialog, setNewGroupDialog] = useState<{ traceIds: string[]; name: string } | null>(null)
  const [newGroupBusy, setNewGroupBusy] = useState(false)
  const [playingMedia, setPlayingMedia] = useState<Set<string>>(new Set()) // Track traces with playing media
  // Which videos have already been given their one retry after a failed load.
  const videoRetriedRef = useRef<Set<string>>(new Set())
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set()) // Track traces with failed image loads
  const [imageRetryCount, setImageRetryCount] = useState<Record<string, number>>({}) // Track retry attempts per trace
  const processedImageIds = React.useRef<Set<string>>(new Set()) // Track which images have been preflight-tested
  // Sounds and videos that wouldn't load (TraceGlitch shows it).
  const [failedMedia, setFailedMedia] = useState<Set<string>>(new Set())
  const [confirmedImageIds, setConfirmedImageIds] = useState<Set<string>>(new Set()) // Track embeds confirmed to be actual images (even without file extension)
  const [pathCreationMode, setPathCreationMode] = useState(false) // Track if we're in path creation mode
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null) // Track selected point for control handle editing
  const selectedPointIndexRef = useRef(selectedPointIndex)
  selectedPointIndexRef.current = selectedPointIndex
  // Which end of the path a click on the canvas adds to while adding points:
  // the end, as when drawing one, or the start, once its first point is
  // clicked.
  const [pathAddAt, setPathAddAt] = useState<'start' | 'end'>('end')
  const pathAddAtRef = useRef(pathAddAt)
  pathAddAtRef.current = pathAddAt
  // Where the pointer is while adding points, on screen: a dashed run from
  // the end being added to shows where the next point goes.
  const [pathPointer, setPathPointer] = useState<{ x: number; y: number } | null>(null)
  // A path's point dragged with Shift over another trace, onto its border
  // (lib/pathGeometry): that trace's box, and where on it the point went.
  const [borderSnap, setBorderSnap] = useState<{ box: TurnedBox; at: { x: number; y: number } } | null>(null)
  const borderSnapRef = useRef(borderSnap)
  // Whether the press on a handle has moved past a click's few pixels.
  const pressMovedRef = useRef(false)
  const [localShapePoints, setLocalShapePoints] = useState<Record<string, any[]>>({}) // Track shape points during drag
  const [colorPickerCallback, setColorPickerCallback] = useState<((color: string) => void) | null>(null) // For fallback color picker
  const [inlineEditingTraceId, setInlineEditingTraceId] = useState<string | null>(null) // Track which text trace is being inline edited
  const copiedTraceClipboardRef = useRef<TraceClipboardPayload | null>(null)
  const [inlineEditText, setInlineEditText] = useState<string>('') // Track the text being edited
  // A sheet's cell being edited: which sheet, and where it was double-clicked
  // (SheetTrace finds the cell).
  const [sheetEditAt, setSheetEditAt] = useState<{ traceId: string; fx: number; fy: number } | null>(null)
  // Traces that follow the file they came from (lib/liveFiles), and the one
  // being asked about: stop following it -- and, when that's to edit it
  // here, then the edit.
  const following = useSyncExternalStore(watchFollowing, followed)
  const [unfollowAsk, setUnfollowAsk] = useState<{ traceId: string; then?: () => void } | null>(null)
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set()) // Track multi-selected traces
  const [showBatchEditPanel, setShowBatchEditPanel] = useState(false) // Batch-edit shared properties across multiSelectedIds
  // Opening a customize panel clears the ones around it (onCustomizeOpen), so
  // the view isn't crowded.
  const customizing = (!!editingTrace && canEdit) || showBatchEditPanel
  useEffect(() => {
    if (customizing) onCustomizeOpen?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customizing])

  // Report the current multi-selection up to LobbyScene so the Layer panel
  // (a sibling component) can mirror the highlight.
  useEffect(() => {
    onMultiSelectionChange?.(Array.from(multiSelectedIds))
  }, [multiSelectedIds, onMultiSelectionChange])

  const startPosRef = useRef<{ x: number; y: number; corner: string; initialPoint?: {x: number, y: number}; initialCpx?: number; initialCpy?: number; initialOther?: { x: number; y: number }; initialPoints?: any[] }>({ x: 0, y: 0, corner: '' })
  const startTransformRef = useRef({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
  const startCropRef = useRef({ cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 })
  const centerRef = useRef({ x: 0, y: 0 })
  const multiStartTransformsRef = useRef<Record<string, { x: number; y: number }>>({}) // Store starting positions for multi-select move
  const multiStartPathPointsRef = useRef<Record<string, any[]>>({}) // Store starting shapePoints for path traces in multi-select
  // True only while an actual multi-select move/move-path drag is in progress
  // (set in handleMouseDown, cleared in handleMouseUp) -- multiStartTransformsRef
  // itself is never reset between drags, so it can't be used on its own to tell
  // whether the drag that just ended was a batch move or a lone single-trace one.
  const isMultiDragActiveRef = useRef(false)
  // Start state for a group scale/rotate drag: the shared world-space pivot
  // every selected trace orbits around, plus each trace's own starting
  // transform (and path points, which live in world space and so must be
  // transformed individually rather than via x/y+scale).
  const groupStartRef = useRef<{
    center: { x: number; y: number }
    bounds: { minX: number; minY: number; maxX: number; maxY: number }
    traces: Record<string, any>
  }>({ center: { x: 0, y: 0 }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, traces: {} })

  // Live angle badge shown while a rotation drag is in progress. `delta` marks
  // a group rotation, where the useful number is how far the selection turned
  // rather than any one trace's absolute angle.
  const [rotationReadout, setRotationReadout] = useState<
    { screenX: number; screenY: number; angle: number; snapped: boolean; delta: boolean } | null
  >(null)

  // Refs to store latest values for event handlers (to avoid stale closures)
  const tracesRef = useRef(traces)
  const editingTraceRef = useRef(editingTrace)
  const localShapePointsRef = useRef(localShapePoints)
  const zoomRef = useRef(zoom)
  const multiSelectedIdsRef = useRef(multiSelectedIds)
  const transformModeRef = useRef<TransformMode>(transformMode)
  const selectedTraceIdRef = useRef<string | null>(selectedTraceId)
  const pathCreationModeRef = useRef(pathCreationMode)
  // Which path's points are being added (endPathPoints): its own, not the
  // selection's, which can move on.
  const pathIdRef = useRef<string | null>(null)
  const addPointsTo = (id: string) => {
    pathIdRef.current = id
    setPathCreationMode(true)
  }
  const onPasteRef = useRef(onPaste)
  onPasteRef.current = onPaste
  const worldOffsetRef = useRef(worldOffset)
  worldOffsetRef.current = worldOffset

  // Keep refs updated
  useEffect(() => { tracesRef.current = traces }, [traces])
  useEffect(() => { editingTraceRef.current = editingTrace }, [editingTrace])
  useEffect(() => { localShapePointsRef.current = localShapePoints }, [localShapePoints])
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { multiSelectedIdsRef.current = multiSelectedIds }, [multiSelectedIds])
  useEffect(() => { transformModeRef.current = transformMode }, [transformMode])
  useEffect(() => { selectedTraceIdRef.current = selectedTraceId }, [selectedTraceId])
  useEffect(() => { pathCreationModeRef.current = pathCreationMode }, [pathCreationMode])

  // Apply a group-select request from the Layer panel (clicking a group
  // header selects all its traces so they're easier to move together).
  useEffect(() => {
    if (!multiSelectRequest) return
    setMultiSelectedIds(new Set(multiSelectRequest))
    setSelectedTraceId(multiSelectRequest[0] ?? null)
  }, [multiSelectRequest, setSelectedTraceId])

  // Open the customize UI for a set asked for from the Layer panel.
  //
  // Traces are read through the ref rather than the prop, and the prop is left
  // out of the dependency array, for the same reason newPathRequest does it
  // below: traces changes constantly, and this should fire once per request
  // rather than every time anything on the canvas moves.
  //
  // A trace named in the request may have been deleted between the menu
  // opening and this running, so what is missing is dropped rather than
  // trusted -- and if that leaves one trace, it opens the single panel, which
  // is what one trace deserves however many were asked for.
  useEffect(() => {
    if (!customizeRequest || customizeRequest.length === 0) return
    const present = customizeRequest.filter(id => tracesRef.current.some(t => t.id === id))
    if (present.length === 0) return

    requestedRef.current = present.length === 1 ? present[0] : [...present].sort().join(',')
    if (present.length === 1) {
      const trace = tracesRef.current.find(t => t.id === present[0])!
      setShowBatchEditPanel(false)
      setMultiSelectedIds(new Set())
      setSelectedTraceId(trace.id)
      setEditingTrace(trace)
      return
    }

    // Closed first: the single panel and the batch panel occupy the same
    // corner, and leaving one open behind the other looks like a bug.
    setEditingTrace(null)
    setMultiSelectedIds(new Set(present))
    setSelectedTraceId(present[0])
    setShowBatchEditPanel(true)
  }, [customizeRequest, setSelectedTraceId])

  // A brand-new path was just created (single starting point) -- select it,
  // open its Customize panel, and drop straight into point-placing mode so
  // the user keeps clicking to extend it immediately. Reads traces via ref
  // (not the traces prop directly) and omits it from the dependency array --
  // traces changes on every point placed while drawing, and this should
  // only ever fire once per genuinely new request, not on every edit made
  // while newPathRequest happens to still be set (LobbyScene never resets
  // it back to null, same as the multiSelectRequest signal above).
  useEffect(() => {
    if (!newPathRequest) return
    const trace = tracesRef.current.find(t => t.id === newPathRequest)
    if (!trace) return
    setSelectedTraceId(trace.id)
    setEditingTrace(trace)
    addPointsTo(trace.id)
  }, [newPathRequest, setSelectedTraceId])

  // The text equivalent: typed into straight away -- inline editing, the same
  // trio of states the double-click handler sets, whose textarea autoFocuses
  // once inlineEditingTraceId names the trace -- with its Customize panel
  // open beside it, as a new shape's is. (It once opened only the panel,
  // and still needed a double-click before anything could be typed.)
  useEffect(() => {
    if (!newTextRequest) return
    const trace = tracesRef.current.find(t => t.id === newTextRequest.id)
    if (!trace) return
    if (newTextRequest.drawn) drawnTextIdRef.current = trace.id
    freshTextIdsRef.current.add(trace.id)
    setSelectedTraceId(trace.id)
    setEditingTrace(trace)
    setInlineEditingTraceId(trace.id)
    setInlineEditText(trace.content ?? '')
  }, [newTextRequest, setSelectedTraceId])

  // New texts not written in yet. One still empty once it's let go of -- no
  // longer typed in or selected; its Customize panel, open or not, doesn't
  // hold it -- goes, as if it had never been made: from the database at once
  // (it was written there when it was made), and from the undo history.
  // Clicking into its panel keeps it selected, so it stays for that.
  const freshTextIdsRef = useRef(new Set<string>())
  useEffect(() => {
    const fresh = freshTextIdsRef.current
    for (const id of [...fresh]) {
      if (id === inlineEditingTraceId || id === selectedTraceId || multiSelectedIds.has(id)) continue
      fresh.delete(id)
      const trace = tracesRef.current.find(t => t.id === id)
      if (!trace || (trace.content ?? '').trim()) continue
      if (editingTraceRef.current?.id === id) setEditingTrace(null)
      const store = useGameStore.getState()
      store.removeTrace(id)
      // Nothing left to save or delete for it at Save.
      store.markTraceDeleted(id)
      store.unmarkTraceDeleted(id)
      knownTraceIdsRef.current?.delete(id)
      undoStackRef.current = undoStackRef.current.filter(op => !((op.kind === 'add' || op.kind === 'update') && op.traceId === id))
      showReach()
      // Then'd, not just called: a query is only sent once it's awaited.
      if (supabase) (supabase.from('traces') as any).delete().eq('id', id).then(({ error }: { error: unknown }) => {
        if (error) console.error('[text] could not remove an empty text:', error)
      })
    }
  }, [inlineEditingTraceId, selectedTraceId, multiSelectedIds])

  // Cleanup stale entries from state objects when traces are removed
  useEffect(() => {
    const traceIds = new Set(traces.map(t => t.id))
    
    // Clean up imageProxySources
    setImageProxySources(prev => {
      const filtered: Record<string, string> = {}
      for (const id in prev) {
        if (traceIds.has(id)) filtered[id] = prev[id]
      }
      return Object.keys(filtered).length === Object.keys(prev).length ? prev : filtered
    })

    // Clean up processedImageIds ref (keys are "traceId::type::url", see below)
    processedImageIds.current.forEach(key => {
      const id = key.split('::')[0]
      if (!traceIds.has(id)) processedImageIds.current.delete(key)
    })
    
    // Clean up imageDimensions
    setImageDimensions(prev => {
      const filtered: Record<string, { width: number; height: number }> = {}
      for (const id in prev) {
        if (traceIds.has(id)) filtered[id] = prev[id]
      }
      return Object.keys(filtered).length === Object.keys(prev).length ? prev : filtered
    })
    
    // Clean up localShapePoints
    setLocalShapePoints(prev => {
      const filtered: Record<string, any[]> = {}
      for (const id in prev) {
        if (traceIds.has(id)) filtered[id] = prev[id]
      }
      return Object.keys(filtered).length === Object.keys(prev).length ? prev : filtered
    })
    
    // Clean up playingMedia
    setPlayingMedia(prev => {
      const filtered = new Set<string>()
      prev.forEach(id => {
        if (traceIds.has(id)) filtered.add(id)
      })
      return filtered.size === prev.size ? prev : filtered
    })
  }, [traces])

  // Cancel inline editing when selecting a different trace
  useEffect(() => {
    if (inlineEditingTraceId && selectedTraceId !== inlineEditingTraceId) {
      setInlineEditingTraceId(null)
      setInlineEditText('')
    }
  }, [selectedTraceId, inlineEditingTraceId])

  // What was found out about a trace's file -- it failed, it's a picture
  // after all, it needed the proxy, how big it is -- is about that file, not
  // the trace: its address changed (an embed's, in its panel), it's found
  // out again. Kept by the trace, it outlived the address: an embed that had
  // been a picture that failed stayed a broken link card whatever was put in.
  const mediaSeenRef = useRef(new Map<string, string>())
  useEffect(() => {
    const changed: string[] = []
    for (const trace of traces) {
      const url = trace.mediaUrl || trace.imageUrl || ''
      const was = mediaSeenRef.current.get(trace.id)
      if (was !== undefined && was !== url) changed.push(trace.id)
      mediaSeenRef.current.set(trace.id, url)
    }
    if (changed.length === 0) return
    const without = <T,>(prev: Record<string, T>) => {
      const next = { ...prev }
      for (const id of changed) delete next[id]
      return next
    }
    const withoutIds = (prev: Set<string>) => new Set([...prev].filter(id => !changed.includes(id)))
    setFailedImages(withoutIds)
    setFailedMedia(withoutIds)
    setConfirmedImageIds(withoutIds)
    setImageProxySources(without)
    setImageRetryCount(without)
    setImageDimensions(without)
  }, [traces])

  // Proactively test image URLs and use proxy for blocked ones
  // Uses a ref to track processed IDs so each image is only tested once,
  // and state changes don't cancel pending preflight tests for other images
  useEffect(() => {
    traces.forEach(trace => {
      // Handle both 'image' type and 'embed' type that contains direct image URLs
      if ((trace.type === 'image' || trace.type === 'embed') && (trace.mediaUrl || trace.imageUrl)) {
        const url = trace.mediaUrl || trace.imageUrl
        
        // Skip if already processed (using ref to avoid re-renders cancelling other preflights).
        // Keyed by id+type+url (not just id) so a trace whose type/URL changes later --
        // e.g. an embed converted to an internal image via "Convert to Image" -- gets
        // re-resolved instead of keeping its stale (and now wrong) imageProxySources entry,
        // which otherwise left it stuck showing "Loading..." until the atrium was reloaded.
        if (!url) return
        const processKey = `${trace.id}::${trace.type}::${url}`
        if (processedImageIds.current.has(processKey)) return
        processedImageIds.current.add(processKey)
        
        // Data URLs (e.g. from freehand drawing) need no proxy, and a
        // stand-in's address (Force import) is no picture to fetch.
        if (url.startsWith('data:') || url.startsWith(UNSUPPORTED)) {
          setImageProxySources(prev => ({ ...prev, [trace.id]: '' }))
          return
        }
        
        // Local desktop files. The streaming resolver, so the picture is
        // fetched by the browser rather than read into JS first -- see
        // resolveLocalStreamUrl. This only decides what goes in an <img src>;
        // the export and PDF paths still use the blob resolver.
        if (url.startsWith('local://')) {
          resolveLocalStreamUrl(url).then(resolvedUrl => {
            const img = new Image()
            img.onload = () => {
              if (img.naturalWidth && img.naturalHeight) {
                setImageDimensions(prev => ({
                  ...prev,
                  [trace.id]: { width: img.naturalWidth, height: img.naturalHeight }
                }))
              }
              if (trace.type === 'embed') {
                setConfirmedImageIds(prev => new Set(prev).add(trace.id))
              }
              setImageProxySources(prev => ({ ...prev, [trace.id]: resolvedUrl }))
              setFailedImages(prev => { const next = new Set(prev); next.delete(trace.id); return next })
              setImageRetryCount(prev => { const next = { ...prev }; delete next[trace.id]; return next })
            }
            img.onerror = () => {
              setImageProxySources(prev => ({ ...prev, [trace.id]: resolvedUrl }))
            }
            img.src = resolvedUrl
          }).catch(() => {
            // Resolving can reject outright -- the vault module won't load at
            // all on the web, which a local:// trace can now reach, since an
            // import brings those in rather than dropping them. Settling on the
            // raw local:// URL is what marks it missing to the render above;
            // leaving the promise unsettled would leave "Loading..." forever.
            setImageProxySources(prev => ({ ...prev, [trace.id]: url }))
          })
          return
        }
        
        // Always try loading as an image first (handles extensionless image URLs like Google Images)
        const img = new Image()
        
        const timeout = setTimeout(() => {
          if (!img.complete) {
            // Timed out — use proxy for this URL
            setImageProxySources(prev => ({
              ...prev,
              [trace.id]: proxyFallbackFor(url)
            }))
          }
        }, 8000)
        
        img.onload = () => {
          clearTimeout(timeout)
          // URL is a valid image! Capture dimensions and mark as confirmed image
          if (img.naturalWidth && img.naturalHeight) {
            setImageDimensions(prev => ({
              ...prev,
              [trace.id]: { width: img.naturalWidth, height: img.naturalHeight }
            }))
          }
          // Mark this embed as a confirmed image (so render uses <img> not <iframe>)
          if (trace.type === 'embed') {
            setConfirmedImageIds(prev => new Set(prev).add(trace.id))
          }
          // Loaded directly (empty string means use original URL)
          setImageProxySources(prev => ({
            ...prev,
            [trace.id]: ''
          }))
        }
        
        img.onerror = () => {
          clearTimeout(timeout)
          // Failed to load as image — use proxy
          // The proxy will try to fetch; if it's actually an image, the render <img> onLoad will confirm it
          setImageProxySources(prev => ({
            ...prev,
            [trace.id]: proxyFallbackFor(url)
          }))
        }
        
        img.src = url
      }
    })
    // No cleanup needed - each image's preflight is independent and tracked by ref
  }, [traces])

  // Resolve local:// URLs for audio/video traces in desktop mode
  useEffect(() => {
    if (!isDesktop) return
    traces.forEach(trace => {
      if ((trace.type === 'audio' || trace.type === 'video') && trace.mediaUrl?.startsWith('local://')) {
        if (localMediaUrls[trace.id]) return
        // A file still being written is never resolved here: an import seeds
        // the dropped file itself (preCacheLocalUrl), which this reads first.
        // Before that, it was:
        //
        // resolveLocalStreamUrl builds an asset URL out of the path without
        // asking whether anything is there yet, so a freshly imported video
        // was handed a URL for a file Rust was still appending to. The webview
        // then fetched it over and over as it grew underneath -- partial
        // reads, ranges that could not be satisfied, each failure retried --
        // against the same file, on the same disk, that the write was busy
        // with. That is what kept the canvas stuttering for the whole import,
        // and why it happened for video and not for a PDF of any size: only
        // video and audio resolve through here.
        // Streamed, not read. This is the difference between opening an
        // atrium of videos and waiting for every one of them to be copied
        // into memory first.
        resolveLocalStreamUrl(trace.mediaUrl).then(resolved => {
          setLocalMediaUrls(prev => ({ ...prev, [trace.id]: resolved }))
        }).catch(() => {
          // Deliberately left unset. A local:// URL means nothing to a media
          // element, so putting one in here only builds a broken element that
          // something has to recover from later.
        })
      }
    })
  }, [traces])

  // Ends placing a path's points. A path of two or more is kept; one of
  // fewer -- nothing drawn yet -- is removed rather than left as a stray
  // trace. True when it was removed. Reads refs, so the key handler below,
  // registered once, can use it.
  const endPathPoints = () => {
    setPathCreationMode(false)
    // The path being added to, by its own id: the selection may have moved
    // on, and a trace selected meanwhile is no path to throw away.
    const id = pathIdRef.current
    pathIdRef.current = null
    if (!id) return false
    const trace = tracesRef.current.find(t => t.id === id)
    const editing = editingTraceRef.current
    const points = (editing && editing.id === id ? editing.shapePoints : trace?.shapePoints) || []
    if (points.length >= 2) return false
    removeTrace(id)
    markTraceDeleted(id)
    knownTraceIdsRef.current?.delete(id)
    return true
  }
  // Adding ends when the path is no longer what's selected -- picked in the
  // Layer panel, say; a press on another trace only places a point.
  useEffect(() => {
    if (pathCreationMode && selectedTraceId !== pathIdRef.current) endPathPoints()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTraceId, pathCreationMode])

  // ESC key to deselect trace and close menus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Cancel color picker if active
        if (colorPickerCallback) {
          setColorPickerCallback(null)
          document.body.style.cursor = 'default'
          return
        }
        // Escape while placing a path's points ends it (endPathPoints). A
        // path worth keeping stays selected: this Escape ends the adding,
        // and the next one lets go of it.
        if (pathCreationModeRef.current && !endPathPoints()) return
        setSelectedTraceId(null)
        setMultiSelectedIds(new Set()) // Clear multi-selection on Escape
        setTransformMode('none')
        setIsCropMode(false)
        setContextMenu(null)
        setEditingTrace(null)
      } else if (e.key === 'Enter' && pathCreationModeRef.current) {
        // Enter finishes placing points -- same safety net as Escape for an
        // incomplete path, but (unlike Escape) leaves the Customize panel
        // open on a successfully-finished path so its arrow-config section
        // (right above Path Points there) is immediately at hand.
        const target = e.target as HTMLElement | null
        const typingHere = isEditableTarget(target)
        if (typingHere) return
        e.preventDefault()
        if (endPathPoints()) {
          setSelectedTraceId(null)
          setEditingTrace(null)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [colorPickerCallback])


  // Fallback color picker - capture canvas and sample color on click
  useEffect(() => {
    if (!colorPickerCallback) return

    document.body.style.cursor = 'crosshair'

    const handleClick = (e: MouseEvent) => {
      // Don't pick from UI elements
      const target = e.target as HTMLElement
      if (target.closest('.customize-menu') || target.closest('button')) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      // Try to capture the WebGL canvas
      const canvas = document.querySelector('canvas') as HTMLCanvasElement
      if (canvas) {
        try {
          // Create a temporary 2D canvas from the WebGL canvas snapshot
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = canvas.width
          tempCanvas.height = canvas.height
          const ctx = tempCanvas.getContext('2d')
          if (ctx) {
            // Draw the WebGL canvas to our 2D canvas
            ctx.drawImage(canvas, 0, 0)
            
            // Get click position relative to canvas
            const rect = canvas.getBoundingClientRect()
            const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width))
            const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height))
            
            // Read the pixel
            const pixelData = ctx.getImageData(x, y, 1, 1).data
            const color = `#${pixelData[0].toString(16).padStart(2, '0')}${pixelData[1].toString(16).padStart(2, '0')}${pixelData[2].toString(16).padStart(2, '0')}`
            
            colorPickerCallback(color)
          }
        } catch (err) {
          console.warn('Could not capture canvas color:', err)
        }
      }

      // Reset
      setColorPickerCallback(null)
      document.body.style.cursor = 'default'
    }

    // Use capture phase
    window.addEventListener('click', handleClick, true)
    return () => {
      window.removeEventListener('click', handleClick, true)
      document.body.style.cursor = 'default'
    }
  }, [colorPickerCallback])

  const getScreenPosition = useCallback((worldX: number, worldY: number) => {
    const screenX = (worldX * zoom) + worldOffset.x
    const screenY = (worldY * zoom) + worldOffset.y
    return { screenX, screenY }
  }, [zoom, worldOffset.x, worldOffset.y])

  const getTraceTransform = useCallback((trace: Trace) => {
    const local = localTraceTransforms[trace.id]
    if (local) return local
    return storedTransformOf(trace)
  }, [localTraceTransforms])

  // --- Undo/redo history ---------------------------------------------------
  // Client-side only: this stack is never persisted or sent to Supabase, on
  // either desktop or web. It resets whenever this component (re)mounts, i.e.
  // on every atrium switch and on every page reload. History depth is a
  // profile-wide preference (see ProfileCustomization.tsx), kept intentionally
  // small/bounded to avoid unbounded memory growth in a browser tab.
  const UNDO_COALESCE_WINDOW_MS = 800
  const MAX_UNDO_DEPTH = 100
  // Whether an update changes anything. A click on a trace ends a drag that
  // took it nowhere, and that was a step: the next Ctrl+Z took back nothing.
  const changesSomething = (before: Partial<Trace>, after: Partial<Trace>) =>
    (Object.keys(after) as (keyof Trace)[]).some(k => before[k] !== after[k] && JSON.stringify(before[k]) !== JSON.stringify(after[k]))

  // Read from the profile rather than from this atrium. It used to be keyed by
  // lobby, so every new atrium quietly reset it to twenty.
  const getStoredUndoDepth = useCallback(() => readUndoDepth(lobbyId), [lobbyId])

  type UndoOp =
    | { kind: 'add'; traceId: string; trace: Trace }
    // A trace's connections go with it, and come back with it on undo.
    | { kind: 'delete'; trace: Trace; links?: TraceLink[] }
    // Traces deleted together -- a group, a selection -- as one step, each
    // with the connections that went with it.
    | { kind: 'batchDelete'; items: { trace: Trace; links: TraceLink[] }[] }
    // Connections made, removed or changed: the ones there before and after.
    | { kind: 'links'; before: TraceLink[]; after: TraceLink[]; ts: number }
    | { kind: 'update'; traceId: string; before: Partial<Trace>; after: Partial<Trace>; ts: number }
    // One atomic undo step covering every trace moved together in a
    // multi-select drag -- without this, moving N selected traces pushes N
    // (or, per mousemove frame, many more than N) separate 'update' ops, so
    // a single Ctrl+Z only walks the move back one trace at a time.
    | { kind: 'batch'; ops: { traceId: string; before: Partial<Trace>; after: Partial<Trace> }[]; ts: number }
    // Same idea as 'batch', but for creation: every trace that shows up in
    // the same traces-prop update (batch embed placement, a multi-file
    // drop/paste, etc.) is one atomic undo step instead of N separate 'add'
    // ops -- see the "detect new traces" effect below.
    | { kind: 'batchAdd'; traces: Trace[] }
    // Done elsewhere and recorded here (lib/actionHistory) -- a layer change,
    // which writes to the database, so its undo and redo are writes too.
    | { kind: 'action'; entry: ActionEntry }

  const undoStackRef = useRef<UndoOp[]>([])
  const redoStackRef = useRef<UndoOp[]>([])
  const maxUndoDepthRef = useRef(getStoredUndoDepth())
  // Whether there's a step to undo or redo, for the buttons (lib/actionHistory).
  const showReach = () => setHistoryReach(undoStackRef.current.length > 0, redoStackRef.current.length > 0)
  // A new step: the oldest goes past the depth kept, and what was undone can
  // no longer be redone.
  const pushUndo = useCallback((op: UndoOp) => {
    undoStackRef.current.push(op)
    if (undoStackRef.current.length > maxUndoDepthRef.current) undoStackRef.current.shift()
    redoStackRef.current = []
    showReach()
  }, [])

  // The history is its atrium's, and ends when the atrium is left. With it go
  // the files of traces deleted there, kept until now in case an undo brought
  // them back (lib/localDb releaseHeldMedia).
  useEffect(() => () => {
    undoStackRef.current = []
    redoStackRef.current = []
    setHistoryReach(false, false)
    if (isDesktop && lobbyId) void import('../lib/localDb').then(m => m.releaseHeldMedia(lobbyId))
  }, [lobbyId])
  const knownTraceIdsRef = useRef<Set<string> | null>(null)

  // Keep the configured history depth in sync with the per-atrium profile setting
  useEffect(() => {
    maxUndoDepthRef.current = getStoredUndoDepth()
    const handleUndoDepthChanged = (event: Event) => {
      const customEvent = event as CustomEvent<number>
      maxUndoDepthRef.current = typeof customEvent.detail === 'number'
        ? Math.max(1, Math.min(MAX_UNDO_DEPTH, customEvent.detail))
        : getStoredUndoDepth()
      // Trim the stack immediately if the depth was lowered
      while (undoStackRef.current.length > maxUndoDepthRef.current) {
        undoStackRef.current.shift()
      }
      showReach()
    }
    window.addEventListener('lobby-undo-depth-changed', handleUndoDepthChanged as EventListener)
    return () => window.removeEventListener('lobby-undo-depth-changed', handleUndoDepthChanged as EventListener)
  }, [getStoredUndoDepth])

  // History goes on across saves (lib/traceSave): an undo is a change like
  // any other, saved the same way -- written over the row, or the row
  // put back if it went. It used to be cleared at every save, when saving was
  // a button: an undo then wrote nothing, and a trace undeleted after its row
  // was gone had nothing to update.
  //
  // What a save does drop is the local drag-preview overrides
  // (localTraceTransforms / localShapePoints). These render ON TOP of the
  // store's trace data so a drag feels instant; left after the save, they
  // went on drawing that local copy over every later realtime UPDATE another
  // user made to the same trace. The store stays authoritative. Saves wait
  // for a gesture to end, so none of this goes from under a drag.
  useEffect(() => {
    const handleSaveCompleted = () => {
      setLocalTraceTransforms({})
      setLocalShapePoints({})
    }
    window.addEventListener(TRACE_SAVE_COMPLETED_EVENT, handleSaveCompleted)
    // Don't Save: the history's steps were from changes that are gone.
    const handleDiscarded = () => {
      handleSaveCompleted()
      undoStackRef.current = []
      redoStackRef.current = []
      setHistoryReach(false, false)
    }
    window.addEventListener(TRACE_DISCARD_COMPLETED_EVENT, handleDiscarded)
    return () => {
      window.removeEventListener(TRACE_SAVE_COMPLETED_EVENT, handleSaveCompleted)
      window.removeEventListener(TRACE_DISCARD_COMPLETED_EVENT, handleDiscarded)
    }
  }, [])

  // One action, one undo step: while `inOneStep` runs an action, the trace
  // updates it makes are gathered here instead of each pushing its own step,
  // and become a single step when it ends. For anything done to several
  // traces at once -- the batch-edit panel, a font set across a selection, a
  // group re-keyed to make room.
  const gatheringRef = useRef<Map<string, { before: Partial<Trace>; after: Partial<Trace> }> | null>(null)
  const pushUpdateOp = useCallback((traceId: string, before: Partial<Trace>, after: Partial<Trace>) => {
    const gathering = gatheringRef.current
    if (gathering) {
      const had = gathering.get(traceId)
      gathering.set(traceId, had
        ? { before: { ...before, ...had.before }, after: { ...had.after, ...after } }
        : { before, after: { ...after } })
      return
    }
    const stack = undoStackRef.current
    const last = stack[stack.length - 1]
    const now = Date.now()
    // Coalesce rapid-fire updates to the same trace (e.g. dragging a slider or
    // moving/resizing/rotating a trace fires many updates per second) into a
    // single undo step, keeping the original "before" and the latest "after".
    if (last && last.kind === 'update' && last.traceId === traceId && (now - last.ts) < UNDO_COALESCE_WINDOW_MS) {
      // A key this gesture hasn't touched yet -- a drag's frameId, set as it
      // ends -- keeps the value it had before, or undo would leave it changed.
      last.before = { ...before, ...last.before }
      last.after = { ...last.after, ...after }
      last.ts = now
      return
    }
    if (changesSomething(before, after)) pushUndo({ kind: 'update', traceId, before, after: { ...after }, ts: now })
  }, [])

  // Pushes every trace moved together in a multi-select drag as ONE undo
  // step (see the 'batch' UndoOp comment above). Falls back to a plain
  // 'update' push for the trivial single-trace case.
  const pushBatchUpdateOp = useCallback((all: { traceId: string; before: Partial<Trace>; after: Partial<Trace> }[], coalesce = false) => {
    const ops = all.filter(op => changesSomething(op.before, op.after))
    if (ops.length === 0) return
    // The same traces changed again straight after (a colour picker dragged
    // across a selection): still the one step, as pushUpdateOp does for one.
    const last = undoStackRef.current[undoStackRef.current.length - 1]
    if (coalesce && ops.length > 1 && last?.kind === 'batch' && Date.now() - last.ts < UNDO_COALESCE_WINDOW_MS
      && last.ops.length === ops.length && ops.every(op => last.ops.some(o => o.traceId === op.traceId))) {
      for (const op of ops) {
        const had = last.ops.find(o => o.traceId === op.traceId)!
        had.before = { ...op.before, ...had.before }
        had.after = { ...had.after, ...op.after }
      }
      last.ts = Date.now()
      return
    }
    if (ops.length === 1) {
      pushUndo({ kind: 'update', traceId: ops[0].traceId, before: ops[0].before, after: { ...ops[0].after }, ts: Date.now() })
      return
    }
    pushUndo({ kind: 'batch', ops, ts: Date.now() })
  }, [])

  const inOneStep = (action: () => void) => {
    if (gatheringRef.current) {
      action()
      return
    }
    const gathering = new Map<string, { before: Partial<Trace>; after: Partial<Trace> }>()
    gatheringRef.current = gathering
    try {
      action()
    } finally {
      gatheringRef.current = null
      const ops = [...gathering].map(([traceId, change]) => ({ traceId, ...change }))
      if (ops.length === 1) pushUpdateOp(ops[0].traceId, ops[0].before, ops[0].after)
      else pushBatchUpdateOp(ops, true)
    }
  }

  // Pushes every trace that appeared together (in the same traces-prop
  // update) as ONE undo step. Falls back to a plain 'add' for the trivial
  // single-trace case, matching pushBatchUpdateOp's pattern.
  const pushBatchAddOp = useCallback((newTraces: Trace[]) => {
    if (newTraces.length === 0) return
    pushUndo(newTraces.length === 1
      ? { kind: 'add', traceId: newTraces[0].id, trace: cloneTraceSnapshot(newTraces[0]) }
      : { kind: 'batchAdd', traces: newTraces.map(cloneTraceSnapshot) })
  }, [])

  // One undo step for everything deleted at once: a single trace as a plain
  // 'delete', several as a 'batchDelete'. Each used to be its own step, so
  // deleting a selected group of twelve took twelve Ctrl+Z to bring back.
  const pushDeleteOp = useCallback((items: { trace: Trace; links: TraceLink[] }[]) => {
    if (items.length === 0) return
    pushUndo(items.length === 1
      ? { kind: 'delete', trace: cloneTraceSnapshot(items[0].trace), links: items[0].links }
      : { kind: 'batchDelete', items: items.map(item => ({ trace: cloneTraceSnapshot(item.trace), links: item.links })) })
  }, [])

  // Detect newly-created traces (via the "Leave a Trace" panel, duplication,
  // the freehand-draw "Print" action, or a batch embed/multi-file placement)
  // by diffing the traces prop, so adds become undoable without needing to
  // instrument every trace-creation call site individually. Pre-existing
  // traces at mount are not treated as adds.
  //
  // Every trace discovered in the SAME effect run (i.e. the same traces-prop
  // update) is collected and pushed as one batch op -- a batch-inserted
  // group of traces all lands in one store update, so without this a single
  // Ctrl+Z only undid one trace of the batch at a time instead of the whole
  // placement.
  useEffect(() => {
    if (knownTraceIdsRef.current === null) {
      knownTraceIdsRef.current = new Set(traces.map(t => t.id))
      return
    }
    const known = knownTraceIdsRef.current
    const newlyDiscovered: Trace[] = []
    for (const trace of traces) {
      if (!known.has(trace.id)) {
        known.add(trace.id)
        // One a layer change brought in (a duplicated group, a deleted one
        // restored) is that change's step, not an addition of its own.
        if (!layerChangeAdopts(trace.id)) newlyDiscovered.push(trace)
      }
    }
    if (newlyDiscovered.length > 0) {
      pushBatchAddOp(newlyDiscovered)
    }
    // Keep the known-ids set from growing unboundedly across a long session
    if (known.size > traces.length) {
      const currentIds = new Set(traces.map(t => t.id))
      known.forEach(id => { if (!currentIds.has(id)) known.delete(id) })
    }
  }, [traces, pushBatchAddOp])

  // Deletion goes through the save like edits: removeTrace() gives an
  // instant local UI update, and markTraceDeleted() queues the database
  // delete for the next save. Undone before then, unmarkTraceDeleted()
  // cancels it; undone after, the trace is written back (lib/traceSave).
  // Shared by the 'update' and 'batch' cases below. Applies one trace's
  // before/after target and clears whatever local drag-preview state would
  // otherwise keep rendering the stale (pre-undo) value on top of it --
  // localTraceTransforms for moved/scaled/rotated traces, localShapePoints
  // for path traces. Missing the shapePoints clear here previously meant a
  // path's undo silently had no visible effect whenever it wasn't the trace
  // that originally started the drag (e.g. one of several traces moved
  // together in a multi-select), since its stale local override kept
  // rendering over the reverted store value.
  const applyUpdateTarget = (store: ReturnType<typeof useGameStore.getState>, traceId: string, target: Partial<Trace>) => {
    const current = store.traces.find(t => t.id === traceId)
    if (!current) return
    const updated = { ...current, ...target }
    store.addTrace(updated)
    store.markTraceChanged(traceId)
    setLocalTraceTransforms(prev => {
      if (!(traceId in prev)) return prev
      const next = { ...prev }
      delete next[traceId]
      return next
    })
    if ('shapePoints' in target) {
      setLocalShapePoints(prev => {
        if (!(traceId in prev)) return prev
        const next = { ...prev }
        delete next[traceId]
        return next
      })
    }
    if (editingTraceRef.current?.id === traceId) {
      setEditingTrace({ ...editingTraceRef.current, ...target })
    }
  }

  const applyUndoOp = useCallback((op: UndoOp, direction: 'undo' | 'redo') => {
    const store = useGameStore.getState()
    if (op.kind === 'add') {
      if (direction === 'undo') {
        store.removeTrace(op.traceId)
        store.markTraceDeleted(op.traceId)
        // Synchronously drop from the known-ids set the "detect new traces"
        // effect uses (below) -- see the matching comment in the redo branch
        // for why this matters on the restoring side; harmless here too.
        knownTraceIdsRef.current?.delete(op.traceId)
        if (editingTraceRef.current?.id === op.traceId) setEditingTrace(null)
        if (selectedTraceIdRef.current === op.traceId) setSelectedTraceId(null)
      } else {
        store.addTrace(cloneTraceSnapshot(op.trace))
        store.unmarkTraceDeleted(op.traceId)
        store.markTraceChanged(op.traceId)
        // Must happen synchronously, in the same tick as addTrace: the
        // "detect new traces" effect below diffs the traces prop against
        // this set on every traces change, and a restored trace's id was
        // already pruned from it when the trace was originally deleted.
        // Without marking it known again here, that effect sees the
        // restore as a brand-new trace and pushes a spurious 'add' op on
        // top of the undo stack -- which then undoes the very restore that
        // just happened on the *next* Ctrl+Z, instead of moving on to
        // whatever should actually be undone next.
        knownTraceIdsRef.current?.add(op.traceId)
      }
    } else if (op.kind === 'links') {
      const [gone, back] = direction === 'undo' ? [op.after, op.before] : [op.before, op.after]
      for (const link of gone) store.dropLink(link.id)
      for (const link of back) store.putLink(link)
    } else if (op.kind === 'delete') {
      if (direction === 'undo') {
        store.addTrace(cloneTraceSnapshot(op.trace))
        store.unmarkTraceDeleted(op.trace.id)
        store.markTraceChanged(op.trace.id)
        // See the matching comment in the 'add' redo branch above.
        knownTraceIdsRef.current?.add(op.trace.id)
        for (const link of op.links ?? []) store.putLink(link)
      } else {
        for (const link of op.links ?? []) store.dropLink(link.id)
        store.removeTrace(op.trace.id)
        store.markTraceDeleted(op.trace.id)
        knownTraceIdsRef.current?.delete(op.trace.id)
        if (editingTraceRef.current?.id === op.trace.id) setEditingTrace(null)
        if (selectedTraceIdRef.current === op.trace.id) setSelectedTraceId(null)
      }
    } else if (op.kind === 'action') {
      void (direction === 'undo' ? op.entry.undo() : op.entry.redo())
    } else if (op.kind === 'batchDelete') {
      if (direction === 'undo') {
        // Every trace back before any connection, so a connection between
        // two of them has both its ends when it returns.
        for (const { trace } of op.items) {
          store.addTrace(cloneTraceSnapshot(trace))
          store.unmarkTraceDeleted(trace.id)
          store.markTraceChanged(trace.id)
          knownTraceIdsRef.current?.add(trace.id)
        }
        for (const { links } of op.items) for (const link of links) store.putLink(link)
      } else {
        for (const { links } of op.items) for (const link of links) store.dropLink(link.id)
        for (const { trace } of op.items) {
          store.removeTrace(trace.id)
          store.markTraceDeleted(trace.id)
          knownTraceIdsRef.current?.delete(trace.id)
          if (editingTraceRef.current?.id === trace.id) setEditingTrace(null)
          if (selectedTraceIdRef.current === trace.id) setSelectedTraceId(null)
        }
      }
    } else if (op.kind === 'batch') {
      for (const subOp of op.ops) {
        const target = direction === 'undo' ? subOp.before : subOp.after
        applyUpdateTarget(store, subOp.traceId, target)
      }
    } else if (op.kind === 'batchAdd') {
      for (const trace of op.traces) {
        if (direction === 'undo') {
          store.removeTrace(trace.id)
          store.markTraceDeleted(trace.id)
          knownTraceIdsRef.current?.delete(trace.id)
          if (editingTraceRef.current?.id === trace.id) setEditingTrace(null)
          if (selectedTraceIdRef.current === trace.id) setSelectedTraceId(null)
        } else {
          store.addTrace(cloneTraceSnapshot(trace))
          store.unmarkTraceDeleted(trace.id)
          store.markTraceChanged(trace.id)
          knownTraceIdsRef.current?.add(trace.id)
        }
      }
    } else {
      const target = direction === 'undo' ? op.before : op.after
      applyUpdateTarget(store, op.traceId, target)
    }
  }, [])

  // Actions done elsewhere -- the Layer panel's, the group changes below --
  // take their place in this history as they happen.
  useEffect(() => setActionRecorder(entry => pushUndo({ kind: 'action', entry })), [])

  const undo = useCallback(() => {
    const op = undoStackRef.current.pop()
    if (!op) return
    redoStackRef.current.push(op)
    showReach()
    applyUndoOp(op, 'undo')
  }, [applyUndoOp])

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop()
    if (!op) return
    undoStackRef.current.push(op)
    showReach()
    applyUndoOp(op, 'redo')
  }, [applyUndoOp])

  // Undo and redo asked for from outside: drawing mode has the keys while
  // it's on (LobbyScene), and waits for its strokes to be saved first.
  useEffect(() => {
    const back = () => undo()
    const forward = () => redo()
    window.addEventListener('atrium:undo', back)
    window.addEventListener('atrium:redo', forward)
    return () => {
      window.removeEventListener('atrium:undo', back)
      window.removeEventListener('atrium:redo', forward)
    }
  }, [undo, redo])

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo/redo shortcut
  const isDrawingModeRef = useRef(isDrawingMode)
  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode
  }, [isDrawingMode])
  useEffect(() => {
    const handleUndoRedoShortcut = (e: KeyboardEvent) => {
      // While drawing, LobbyScene takes these keys: it waits for the strokes
      // drawn to be saved, each its own step, then asks for this undo
      // (atrium:undo) -- so it isn't done twice.
      if (isDrawingModeRef.current) return
      if (isEditableTarget(e.target)) return
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handleUndoRedoShortcut)
    return () => window.removeEventListener('keydown', handleUndoRedoShortcut)
  }, [undo, redo])
  // --- End undo/redo history ------------------------------------------------

  const updateTraceTransform = (traceId: string, updates: Partial<{ x: number; y: number; scale?: number; scaleX?: number; scaleY?: number; rotation: number }>, options?: { skipUndo?: boolean }) => {
    const trace = traces.find(t => t.id === traceId)
    if (!trace) return

    const current = getTraceTransform(trace)
    // Merge updates; normalize to scaleX/scaleY
    const merged: any = { ...current, ...updates }
    if (updates.scale !== undefined) {
      merged.scaleX = updates.scale
      merged.scaleY = updates.scale
    }
    const newTransform = merged

    const before: Partial<Trace> = {
      x: current.x, y: current.y, scaleX: current.scaleX, scaleY: current.scaleY, rotation: current.rotation,
    }
    const after: Partial<Trace> = {
      x: newTransform.x, y: newTransform.y, scaleX: newTransform.scaleX, scaleY: newTransform.scaleY, rotation: newTransform.rotation,
    }
    if (!options?.skipUndo) {
      pushUpdateOp(traceId, before, after)
    }

    // Update local state immediately for smooth UI
    setLocalTraceTransforms(prev => ({ ...prev, [traceId]: newTransform }))

    // Update the trace in the store (local only - no DB sync)
    const updatedTrace: Trace = {
      ...trace,
      x: newTransform.x,
      y: newTransform.y,
      scaleX: newTransform.scaleX,
      scaleY: newTransform.scaleY,
      rotation: newTransform.rotation,
    }
    addTrace(updatedTrace)

    // Mark as having pending changes
    markTraceChanged(traceId)
  }

  // ---- Momentum: a thrown trace glides on and settles ----------------------
  //
  // Let go of a trace while it's moving and it carries on, slowing, and comes
  // to rest with a slight overshoot and settle -- a damped spring that starts
  // at the speed it was let go at, so there's no jolt. Let go of it still and
  // it stays exactly where it was put. The Momentum setting (Profile >
  // Animations) scales how far and for how long, and the shape with them: a
  // spring of fixed timing asked to stop short of where a fast throw carries
  // it would fly past several times over.
  //
  // The glide is part of the move: its steps skip the undo stack, and when it
  // settles the move's own undo entry is given the final position, so one
  // Ctrl+Z still takes the whole throw back.
  const dragSamplesRef = useRef<{ x: number; y: number; t: number }[]>([])
  const dragShiftRef = useRef(false)
  // True while a moved trace is carried over the Layer panel (lib/panelDrop).
  const inPanelRef = useRef(false)
  const updateTraceTransformRef = useRef(updateTraceTransform)
  updateTraceTransformRef.current = updateTraceTransform
  const traceMomentumRef = useRef(traceMomentum)
  traceMomentumRef.current = traceMomentum
  const glideRef = useRef<{ finish: () => void } | null>(null)
  // Held still while they glide, so floating doesn't fight the motion.
  const [glidingIds, setGlidingIds] = useState<Set<string>>(new Set())

  const stopGlide = () => glideRef.current?.finish()

  // Whether it glides; `onRest` is called when it stops, however it stops.
  const startGlide = (ids: string[], onRest?: () => void): boolean => {
    const strength = traceMomentumRef.current / 100
    const samples = dragSamplesRef.current
    dragSamplesRef.current = []
    // Not after lining up with Shift: gliding on would undo the alignment.
    if (!strength || dragShiftRef.current || ids.length === 0) return false

    const now = performance.now()
    const recent = samples.filter(p => now - p.t < 100)
    // Stopped before letting go: set down, not thrown.
    if (recent.length < 2 || now - recent[recent.length - 1].t > 60) return false
    const first = recent[0], latest = recent[recent.length - 1]
    const span = latest.t - first.t
    if (span <= 0) return false
    const screenVX = (latest.x - first.x) / span, screenVY = (latest.y - first.y) / span
    if (Math.hypot(screenVX, screenVY) < 0.15) return false

    const moving = ids.map(id => useGameStore.getState().traces.find(t => t.id === id))
    // A path moves by its points, not by a position, so a selection with one
    // in it is simply set down.
    if (moving.some(t => !t || isPathTrace(t))) return false
    const origins = moving.map(t => ({ id: t!.id, x: t!.x, y: t!.y }))

    // Where it comes to rest: carried on at the speed it was let go at, and
    // never more than a few hundred pixels whatever the flick.
    const zoomNow = zoomRef.current || 1
    const carry = 240 * strength
    const omega = (2 * Math.PI) / Math.max(80, 650 * strength)
    const damping = 0.62
    let vx = screenVX / zoomNow, vy = screenVY / zoomNow
    let targetX = vx * carry, targetY = vy * carry
    const cap = 360 / zoomNow, reach = Math.hypot(targetX, targetY)
    if (reach > cap) {
      const k = cap / reach
      targetX *= k; targetY *= k; vx *= k; vy *= k
    }

    let ox = 0, oy = 0, last = now, raf = 0
    const began = now
    const place = (x: number, y: number) => {
      for (const o of origins) updateTraceTransformRef.current(o.id, { x: o.x + x, y: o.y + y }, { skipUndo: true })
    }
    const finish = () => {
      cancelAnimationFrame(raf)
      glideRef.current = null
      setGlidingIds(new Set())
      // The move's undo entry is the top one; it ends where the glide did.
      const top = undoStackRef.current[undoStackRef.current.length - 1]
      const ends: Record<string, { x: number; y: number }> = {}
      for (const o of origins) ends[o.id] = { x: o.x + ox, y: o.y + oy }
      if (top?.kind === 'update' && ends[top.traceId]) {
        top.after = { ...top.after, ...ends[top.traceId] }
      } else if (top?.kind === 'batch') {
        for (const op of top.ops) if (ends[op.traceId]) op.after = { ...op.after, ...ends[op.traceId] }
      }
      onRest?.()
    }
    const tick = (t: number) => {
      let dt = Math.min(t - last, 48)
      last = t
      // Small fixed steps, so a slow frame can't make the spring overshoot
      // more than it should.
      while (dt > 0) {
        const h = Math.min(dt, 4)
        dt -= h
        vx += (omega * omega * (targetX - ox) - 2 * damping * omega * vx) * h
        vy += (omega * omega * (targetY - oy) - 2 * damping * omega * vy) * h
        ox += vx * h
        oy += vy * h
      }
      const settled = Math.hypot(targetX - ox, targetY - oy) * zoomNow < 0.3 && Math.hypot(vx, vy) * zoomNow < 0.01
      if (settled || t - began > 2000) {
        ox = targetX; oy = targetY
        place(ox, oy)
        finish()
        return
      }
      place(ox, oy)
      raf = requestAnimationFrame(tick)
    }
    stopGlide()
    glideRef.current = { finish }
    setGlidingIds(new Set(ids))
    raf = requestAnimationFrame(tick)
    return true
  }

  // ---- Drag feel: a held trace trails, leans and settles --------------------
  //
  // While a trace is dragged it follows the pointer on a spring rather than
  // rigidly: a little behind when pulled fast, leaning into the pull, and
  // settling with a small bounce when it stops or is let go. Only the drawing
  // is offset -- through the element's own translate and rotate, which apply
  // alongside the transform it already has -- so where the trace actually is,
  // what gets saved, snapped and aligned, still follows the pointer exactly.
  //
  // Its handles and everything else attached to it hide while it moves.
  const dragBounceRef = useRef(dragBounce)
  dragBounceRef.current = dragBounce
  const dragFeelRef = useRef<{ held: boolean; stop: () => void } | null>(null)
  // Traces being moved -- set on the first movement of a drag, not on the
  // press, so clicking a trace doesn't flicker its handles -- and cleared once
  // they come to rest.
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set())
  const movingRef = useRef(false)
  const endMoving = () => {
    movingRef.current = false
    setMovingIds(prev => (prev.size ? new Set() : prev))
  }

  const startDragFeel = (ids: string[]) => {
    dragFeelRef.current?.stop()
    const strength = dragBounceRef.current / 100
    if (!strength || ids.length === 0) return
    // One spring for everything dragged together, as one body: it chases the
    // middle of their box as they're drawn right now -- their own left/top --
    // rather than the pointer (the pointer and the position React last drew
    // can be a frame apart, and a spring chasing one while added to the other
    // made it twitch). Sized by their box, so a group is a bigger, heavier
    // thing that trails and leans as one, turning about its own middle --
    // not each of its traces swinging on a spring of its own.
    let spring: FeelSpring | null = null
    const moved = new Set<HTMLElement>()
    let raf = 0, last = performance.now()
    const feel = {
      held: true,
      stop: () => {
        cancelAnimationFrame(raf)
        for (const el of moved) { el.style.translate = ''; el.style.rotate = '' }
        for (const id of ids) dragOffsetsRef.current.delete(id)
        wakeLinksRef.current()
        if (dragFeelRef.current === feel) dragFeelRef.current = null
        if (!feel.held) endMoving()
      },
    }
    const tick = (now: number) => {
      const dt = Math.min(now - last, 48)
      last = now
      const boxes: { id: string; el: HTMLElement; x: number; y: number; w: number; h: number }[] = []
      for (const id of ids) {
        const el = document.querySelector<HTMLElement>(`[data-trace-id="${CSS.escape(id)}"]`)
        if (el) boxes.push({ id, el, x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: el.offsetWidth, h: el.offsetHeight })
      }
      if (boxes.length === 0) { raf = requestAnimationFrame(tick); return }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const b of boxes) {
        minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2)
        minY = Math.min(minY, b.y - b.h / 2); maxY = Math.max(maxY, b.y + b.h / 2)
      }
      const gx = (minX + maxX) / 2, gy = (minY + maxY) / 2
      if (!spring) spring = feelSpring(gx, gy, maxX - minX, maxY - minY, strength)
      // Shift is for placing exactly -- snapping, centring, lining up -- so
      // while it's held the drag is rigid, as it always was, and lets go of
      // any trail at once. Released mid-drag, the feel starts again from rest.
      if (dragShiftRef.current) {
        feelRest(spring, gx, gy)
        for (const b of boxes) {
          b.el.style.translate = ''
          b.el.style.rotate = ''
          dragOffsetsRef.current.delete(b.id)
        }
        raf = requestAnimationFrame(tick)
        return
      }
      const { ox, oy, lean, moving } = feelStep(spring, gx, gy, dt)
      const cos = Math.cos(lean), sin = Math.sin(lean)
      for (const b of boxes) {
        // Where the body's turn about its middle carries this trace's centre,
        const rx = b.x - gx, ry = b.y - gy
        const sx = rx * cos - ry * sin - rx, sy = rx * sin + ry * cos - ry
        // and the trace turned with it: a rotate pivots on the element's
        // layout box's centre, but the trace is drawn shifted back half its
        // size from there, which the extra translate undoes.
        const dx = -b.w / 2, dy = -b.h / 2
        b.el.style.translate = `${dx - (dx * cos - dy * sin) + ox + sx}px ${dy - (dx * sin + dy * cos) + oy + sy}px`
        b.el.style.rotate = `${lean}rad`
        moved.add(b.el)
        // Its light, carried along: wherever its middle is, moved as that
        // point of the body is, and turned with it.
        const light = document.querySelector<HTMLElement>(`[data-light-for="${CSS.escape(b.id)}"]`)
        if (light) {
          // Every light is centred by its margins, so it turns about its own
          // middle, and only that point need be carried.
          const lx = parseFloat(light.style.left) - gx, ly = parseFloat(light.style.top) - gy
          light.style.translate = `${lx * cos - ly * sin - lx + ox}px ${lx * sin + ly * cos - ly + oy}px`
          light.style.rotate = `${lean}rad`
          moved.add(light)
        }
        dragOffsetsRef.current.set(b.id, { x: ox + sx, y: oy + sy })
      }
      wakeLinksRef.current()
      if (!feel.held && !moving) {
        feel.stop()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    dragFeelRef.current = feel
    raf = requestAnimationFrame(tick)
  }

  // ---- Connections between traces ------------------------------------------
  //
  // Threads from one trace's centre to another's, drawn under every trace --
  // the traces are the nodes. "Connect to..." on the right-click menu takes
  // the trace, or the whole selection, and waits for a trace to be clicked;
  // each of them is joined to it. A thread is clicked to select it, then
  // deleted with its button or the Delete key. All of it waits for Save, and
  // undoes, like any trace edit.
  const [connectFrom, setConnectFrom] = useState<string[] | null>(null)
  const connectFromRef = useRef<string[] | null>(null)
  connectFromRef.current = connectFrom

  // A tool picked in the quick bar ends whatever was under way here (the
  // bar always wins; Esc isn't the only way out).
  useEffect(() => {
    if (!toolSwitch) return
    if (pathCreationModeRef.current && endPathPoints()) {
      setSelectedTraceId(null)
      setEditingTrace(null)
    }
    setIsCropMode(false)
    setConnectFrom(null)
    setColorPickerCallback(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolSwitch])
  // A tool taken in hand puts the selection down, as Excalidraw's do: the
  // Customization panel is then the tool's (LobbyScene).
  useEffect(() => {
    if (!placing) return
    setSelectedTraceId(null)
    setMultiSelectedIds(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing])
  const [connectPointer, setConnectPointer] = useState<{ x: number; y: number } | null>(null)
  // Threads selected -- Shift adds and removes. Deleted with Delete or from
  // their menu: a delete button on the thread itself sat in the way of
  // taking hold of it.
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set())
  const selectedLinksRef = useRef(selectedLinks)
  selectedLinksRef.current = selectedLinks
  const [linkMenuAt, setLinkMenuAt] = useState<{ x: number; y: number } | null>(null)
  // The drag feel's trail on each moving trace, for the threads to follow, and
  // how to wake the threads' animation when it changes.
  const dragOffsetsRef = useRef(new Map<string, { x: number; y: number }>())
  const wakeLinksRef = useRef<() => void>(() => {})

  // `fold`: a run of the same edit to the same threads -- a colour dragged, a
  // label typed -- is one undo step rather than one per change.
  const pushLinksOp = useCallback((before: TraceLink[], after: TraceLink[], fold = false) => {
    const stack = undoStackRef.current
    const top = stack[stack.length - 1]
    const now = Date.now()
    if (fold && top?.kind === 'links' && now - top.ts < UNDO_COALESCE_WINDOW_MS
      && top.after.length === after.length && top.after.every((l, i) => l.id === after[i].id)) {
      top.after = after
      top.ts = now
      return
    }
    pushUndo({ kind: 'links', before, after, ts: now })
  }, [])

  const clearLinkSelection = () => {
    setSelectedLinks(new Set())
    setLinkMenuAt(null)
  }

  // An area selection: every trace the area reaches into, measured as it is
  // drawn -- its picture's own shape, its crop, its turn -- and every thread
  // it crosses where the thread shows. It used to be measured in LobbyScene
  // from the stored width and height, or a default size per type, which for
  // a picture drawn at another shape reached far past it: an area drawn
  // nowhere near a trace could take it. The first thread carries the delete
  // button, with their count -- the plainest sign they were taken.
  useEffect(() => {
    if (!areaSelectRequest) return
    const area = areaSelectRequest
    const { traces: all, links: threads } = useGameStore.getState()
    const boxes = new Map(all.map(t => [t.id, traceBoxFor(t)]))
    const picked = all.filter(t => {
      const b = boxes.get(t.id)!
      // A frame only when all of it is in the area: one drawn inside a frame,
      // to take some of what's in it, shouldn't take the frame too.
      if (isFrame(t)) return b.cx - b.halfW >= area.left && b.cx + b.halfW <= area.right && b.cy - b.halfH >= area.top && b.cy + b.halfH <= area.bottom
      const turn = isPathTrace(t) ? 0 : ((getTraceTransform(t).rotation ?? 0) * Math.PI) / 180
      return boxCrosses(b.cx, b.cy, b.halfW, b.halfH, turn, area)
    }).map(t => t.id)
    const edges = (id: string) => {
      const b = boxes.get(id)
      return b && { left: b.cx - b.halfW, top: b.cy - b.halfH, right: b.cx + b.halfW, bottom: b.cy + b.halfH }
    }
    const centred = (e: { left: number; top: number; right: number; bottom: number }) =>
      ({ x: (e.left + e.right) / 2, y: (e.top + e.bottom) / 2, hw: (e.right - e.left) / 2, hh: (e.bottom - e.top) / 2 })
    const crossed = threads.filter(l => {
      const a = edges(l.from), b = edges(l.to)
      if (!a || !b) return false
      return l.elbow ? lineCrosses(elbowRoute(centred(a), centred(b), l.elbowAt), area) : threadCrosses(a, b, area, l.straight)
    }).map(l => l.id)
    // Added to what's selected already, not in place of it, so one area after
    // another gathers a selection.
    setMultiSelectedIds(prev => {
      const next = new Set([...prev, ...picked])
      if (selectedTraceId) next.add(selectedTraceId)
      return next
    })
    setSelectedTraceId(selectedTraceId ?? picked[0] ?? null)
    setSelectedLinks(prev => new Set([...prev, ...crossed]))
    setLinkMenuAt(null)
  }, [areaSelectRequest])

  // A lasso: every trace it goes round any of (its middle or a corner -- a
  // frame only whole), and every thread it takes in where the thread shows;
  // added to the selection, as an area is.
  useEffect(() => {
    if (!lassoSelectRequest) return
    const lasso = lassoSelectRequest
    const { traces: all, links: threads } = useGameStore.getState()
    const boxes = new Map(all.map(t => [t.id, traceBoxFor(t)]))
    const picked = all.filter(t => {
      const b = boxes.get(t.id)!
      const turn = isPathTrace(t) ? 0 : ((getTraceTransform(t).rotation ?? 0) * Math.PI) / 180
      return boxInLasso(b.cx, b.cy, b.halfW, b.halfH, turn, lasso, isFrame(t))
    }).map(t => t.id)
    const edges = (id: string) => {
      const b = boxes.get(id)
      return b && { left: b.cx - b.halfW, top: b.cy - b.halfH, right: b.cx + b.halfW, bottom: b.cy + b.halfH }
    }
    const crossed = threads.filter(l => {
      const a = edges(l.from), b = edges(l.to)
      return !!a && !!b && threadInLasso(a, b, lasso, l.straight)
    }).map(l => l.id)
    setMultiSelectedIds(prev => {
      const next = new Set([...prev, ...picked])
      if (selectedTraceId) next.add(selectedTraceId)
      return next
    })
    setSelectedTraceId(selectedTraceId ?? picked[0] ?? null)
    setSelectedLinks(prev => new Set([...prev, ...crossed]))
    setLinkMenuAt(null)
  }, [lassoSelectRequest])

  const deleteLinks = (ids: Iterable<string>) => {
    const gone = useGameStore.getState().links.filter(l => new Set(ids).has(l.id))
    clearLinkSelection()
    if (gone.length === 0) return
    for (const link of gone) dropLink(link.id)
    pushLinksOp(gone, [])
  }

  const editLinks = (patch: Partial<TraceLink>) => {
    const before = useGameStore.getState().links.filter(l => selectedLinksRef.current.has(l.id))
    if (before.length === 0) return
    const after = before.map(l => ({ ...l, ...patch }))
    for (const link of after) putLink(link)
    pushLinksOp(before, after, true)
  }

  // An elbow's middle run dragged (TraceLinksLayer): shown as it goes, and
  // one undo step when it's let go.
  const elbowDragStartRef = useRef<TraceLink | null>(null)
  const dragElbow = (id: string, at: number, done: boolean) => {
    const live = useGameStore.getState().links.find(l => l.id === id)
    if (!live) return
    if (!elbowDragStartRef.current) elbowDragStartRef.current = live
    const moved = { ...live, elbowAt: at }
    putLink(moved)
    if (!done) return
    const before = elbowDragStartRef.current
    elbowDragStartRef.current = null
    if (before.elbowAt !== at) pushLinksOp([before], [moved])
  }

  // This thread and nothing else.
  const selectOnlyLink = (id: string) => {
    setSelectedTraceId(null)
    setMultiSelectedIds(new Set())
    setSelectedLinks(new Set([id]))
  }

  const pressLink = (id: string, e: React.PointerEvent) => {
    e.stopPropagation()
    // A right-press is the menu's, which keeps the selection when this thread
    // is in it. Handled here, it collapsed the selection to this one first.
    if (e.button === 2) return
    if (!e.shiftKey || !canEdit) {
      selectOnlyLink(id)
      return
    }
    // Shift adds or takes away this one, and leaves the rest, traces included.
    setSelectedLinks(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openLinkMenu = (id: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!canEdit) return
    if (!selectedLinksRef.current.has(id)) selectOnlyLink(id)
    setLinkMenuAt({ x: e.clientX, y: e.clientY })
  }

  const finishConnect = (target: string) => {
    const sources = connectFromRef.current ?? []
    setConnectFrom(null)
    setConnectPointer(null)
    if (!canEdit || !lobbyId) return
    const existing = useGameStore.getState().links
    const made: TraceLink[] = []
    for (const from of sources) {
      // Not to itself, and not twice: one thread per pair, either way round.
      if (from === target || existing.some(l => joins(l, from, target)) || made.some(l => joins(l, from, target))) continue
      made.push({ id: crypto.randomUUID(), lobbyId, from, to: target, arrow: 'none', color: null, width: DEFAULT_LINK_WIDTH, label: '', labelOnHover: false, straight: false, toCenter: false, labelSize: DEFAULT_LABEL_SIZE, elbow: false, elbowAt: 0.5, opacity: DEFAULT_LINK_OPACITY })
    }
    if (made.length === 0) return
    for (const link of made) putLink(link)
    pushLinksOp([], made)
  }


  // While connecting: a preview thread to the pointer, and a press anywhere
  // but a trace gives up.
  useEffect(() => {
    if (!connectFrom) return
    const move = (e: PointerEvent) => setConnectPointer({ x: e.clientX, y: e.clientY })
    const press = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[data-trace-element="true"]')) {
        setConnectFrom(null)
        setConnectPointer(null)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', press, true)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', press, true)
    }
  }, [connectFrom])

  // Selected threads let go when anything else is pressed (their menu and
  // delete button carry data-link, so using those doesn't).
  useEffect(() => {
    if (selectedLinks.size === 0) return
    const press = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.('[data-link]')) clearLinkSelection()
    }
    window.addEventListener('pointerdown', press, true)
    return () => window.removeEventListener('pointerdown', press, true)
  }, [selectedLinks])

  const traceById = React.useMemo(() => new Map(traces.map(t => [t.id, t])), [traces])
  // Where a thread's end is: the trace's centre and box in world units, as it
  // stands now (mid-drag included), its border colour, and its level.
  const placeTrace = (id: string): LinkEnd | null => {
    const trace = traceById.get(id)
    if (!trace) return null
    // A path is where its points are (mid-drag, the local ones), not its x/y.
    const box = localShapePoints[id]
      ? traceBoxFor({ ...trace, shapePoints: localShapePoints[id] })
      : traceBoxFor(trace, localTraceTransforms[id])
    // A path's box is its points', already turned; anything else turns about its centre.
    const turn = isPathTrace(trace) ? 0 : (((localTraceTransforms[id] || getTraceTransform(trace)).rotation ?? 0) * Math.PI) / 180
    return { x: box.cx, y: box.cy, hw: box.halfW, hh: box.halfH, turn, colour: trace.borderColor || borderColourOf(trace.type), z: zOf(trace) }
  }

  // Ctrl+S: Save (lib/traceSave).
  useEffect(() => {
    const handleSaveShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void saveAllChanges()
      }
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [])

  const getSelectedTraceSnapshots = useCallback((preferredTraceId?: string): Trace[] => {
    const selectedIds = new Set<string>()

    if (multiSelectedIdsRef.current.size > 0 && (!preferredTraceId || multiSelectedIdsRef.current.has(preferredTraceId))) {
      multiSelectedIdsRef.current.forEach(id => selectedIds.add(id))
    }

    if (selectedTraceIdRef.current) {
      selectedIds.add(selectedTraceIdRef.current)
    }

    if (selectedIds.size === 0 && preferredTraceId) {
      selectedIds.add(preferredTraceId)
    }

    return tracesRef.current
      .filter(trace => selectedIds.has(trace.id))
      .map(trace => cloneTraceSnapshot(trace))
  }, [])

  const buildDuplicateInsert = useCallback((trace: Trace, offsetX: number, offsetY: number) => {
    return buildTraceInsertRow(trace, userId, username, lobbyId, offsetX, offsetY)
  }, [lobbyId, userId, username])

  // `at`: where the copies go, their middle on it (a paste, at the pointer);
  // without, each just below and right of its original (Duplicate).
  const duplicateTraces = useCallback(async (sourceTraces: Trace[], at?: { x: number; y: number }) => {
    if (!userId || sourceTraces.length === 0) return

    if (useGameStore.getState().isLobbyFull()) {
      showToast(lobbyFullMessage())
      return
    }

    setContextMenu(null)

    let offsetX = 50
    let offsetY = 50
    if (at) {
      const boxes = sourceTraces.map(trace => traceBoxFor(trace, undefined, 1, true))
      const left = Math.min(...boxes.map(b => b.cx - b.halfW)), right = Math.max(...boxes.map(b => b.cx + b.halfW))
      const top = Math.min(...boxes.map(b => b.cy - b.halfH)), bottom = Math.max(...boxes.map(b => b.cy + b.halfH))
      offsetX = at.x - (left + right) / 2
      offsetY = at.y - (top + bottom) / 2
    }

    // Each copy just above its original, among what that's ordered among (its
    // group, or the stack). A pasted trace from another atrium has no original
    // here, and its group isn't this atrium's: it goes on top of the stack.
    const store = useGameStore.getState()
    const known = new Set(store.layers.map(l => l.id))
    const working = new Map<string | null, Ordered[]>()
    const namedCopies: string[] = []
    const placed = sourceTraces.map(trace => {
      const layerId = trace.layerId && known.has(trace.layerId) ? trace.layerId : null
      if (!working.has(layerId)) working.set(layerId, layerId ? store.traces.filter(t => t.layerId === layerId) : topLevel(store.traces, store.layers))
      const group = working.get(layerId)!
      const sorted = inOrder(group)
      const at = sorted.findIndex(t => t.id === trace.id)
      const key = (at === -1 ? null : keyAt(sorted, at + 1)) ?? keysOnTop(group)[0]
      // Seen by the copies after it, so two from one group don't collide.
      group.push({ id: `copy-${group.length}`, orderKey: key })
      // A copied text trace is a new one, with the next free name.
      const layerName = trace.type === 'text' ? nextTextName(store.traces, n => t('atrium.layers.numberedText', { n }), namedCopies) : trace.layerName ?? null
      if (trace.type === 'text' && layerName) namedCopies.push(layerName)
      return { layerId, orderKey: key, layerName }
    })

    if (supabase) {
      const insertRows = sourceTraces.map((trace, index) => ({
        ...buildDuplicateInsert(trace, offsetX, offsetY),
        layer_id: placed[index].layerId,
        order_key: placed[index].orderKey,
        layer_name: placed[index].layerName,
      }))
      const { data, error } = await (supabase.from('traces') as any).insert(insertRows).select()

      if (error) {
        showToast(t('atrium.error.duplicateFailed', { message: error.message }))
        return
      }

      const insertedRows = Array.isArray(data) ? data : []
      const duplicatedTraces = sourceTraces.map((trace, index) => {
        const insertedRow = insertedRows[index] as any
        return {
          ...cloneTraceSnapshot(trace),
          id: insertedRow?.id ?? `trace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          userId: insertedRow?.user_id ?? userId,
          username: insertedRow?.username ?? username,
          x: insertedRow?.position_x ?? trace.x + offsetX,
          y: insertedRow?.position_y ?? trace.y + offsetY,
          createdAt: insertedRow?.created_at ?? new Date().toISOString(),
          lobbyId: insertedRow?.lobby_id ?? lobbyId ?? trace.lobbyId,
          isLocked: false,
          layerId: placed[index].layerId,
          orderKey: placed[index].orderKey,
          layerName: placed[index].layerName,
        }
      })

      duplicatedTraces.forEach(trace => addTrace(trace))

      if (duplicatedTraces.length > 0) {
        setSelectedTraceId(duplicatedTraces[0].id)
        setMultiSelectedIds(new Set(duplicatedTraces.map(trace => trace.id)))
      }
      return
    }

    const duplicatedTraces = sourceTraces.map((trace, index) => ({
      ...cloneTraceSnapshot(trace),
      id: `trace_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 9)}`,
      userId,
      username,
      x: trace.x + offsetX,
      y: trace.y + offsetY,
      createdAt: new Date().toISOString(),
      lobbyId: lobbyId ?? trace.lobbyId,
      isLocked: false,
    }))

    duplicatedTraces.forEach(trace => addTrace(trace))
    setSelectedTraceId(duplicatedTraces[0]?.id ?? null)
    setMultiSelectedIds(new Set(duplicatedTraces.map(trace => trace.id)))
  }, [addTrace, buildDuplicateInsert, lobbyId, setSelectedTraceId, userId, username])

  // Ctrl+C / Ctrl+V keyboard shortcuts for copy/paste traces
  useEffect(() => {
    const getClipboardPayload = (preferredTraceId?: string): TraceClipboardPayload | null => {
      const selectedTraces = getSelectedTraceSnapshots(preferredTraceId)
      if (selectedTraces.length === 0) {
        return null
      }

      return {
        version: 1,
        lobbyId,
        traces: selectedTraces,
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const payload = getClipboardPayload()
        if (payload) {
          copiedTraceClipboardRef.current = payload
        }
      }
    }

    const handleCopy = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return

      const payload = getClipboardPayload()
      if (!payload) return

      copiedTraceClipboardRef.current = payload
      e.preventDefault()
      e.clipboardData?.setData(TRACE_CLIPBOARD_MIME, JSON.stringify(payload))
      e.clipboardData?.setData('text/plain', TRACE_CLIPBOARD_TEXT_SENTINEL)
    }

    const handlePaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (!canEdit) return

      const customPayload = e.clipboardData?.getData(TRACE_CLIPBOARD_MIME)
      const sentinel = e.clipboardData?.getData('text/plain')
      const payload = customPayload
        ? parseTraceClipboardPayload(customPayload)
        : sentinel === TRACE_CLIPBOARD_TEXT_SENTINEL
          ? copiedTraceClipboardRef.current
          : null

      if (payload?.traces.length) {
        e.preventDefault()
        // At the pointer, as a pasted picture goes.
        void duplicateTraces(payload.traces.map(trace => cloneTraceSnapshot(trace)), useGameStore.getState().position)
      } else if (e.clipboardData && onPasteRef.current?.(e.clipboardData)) {
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('copy', handleCopy)
    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('copy', handleCopy)
      window.removeEventListener('paste', handlePaste)
    }
  }, [duplicateTraces, getSelectedTraceSnapshots, lobbyId, canEdit])

  // `linkIds`: connections selected along with the traces (an area select
  // takes both), deleted with them as the same one step.
  // Copy Style / Paste Style (lib/traceStyle), from the menu or Ctrl+Alt+C / V:
  // one trace's look, given to others -- each takes what it has of it, as one
  // step of undo. A text box fits its text again in a font or size pasted on
  // it, as when one is set; a drawing's strokes go to drawings.
  // The drawings among `ids` made one picture, for good (lib/drawingFiles
  // rasterizeDrawings): as sharp as they're seen now, named as the drawing --
  // or, several of one group, as the group. Selected once made.
  const rasterize = (ids: string[]) => {
    const drawings = traces.filter(tr => ids.includes(tr.id) && isDrawingTrace(tr))
    if (!canEdit || drawings.length === 0) return
    const groupId = drawings[0].layerId
    const group = drawings.length > 1 && groupId && drawings.every(d => d.layerId === groupId) ? useGameStore.getState().layers.find(l => l.id === groupId)?.name : null
    const name = group || drawings[drawings.length - 1].content || t('atrium.layers.numberedDrawing', { n: 1 })
    setEditingTrace(null)
    setSelectedTraceId(null)
    setMultiSelectedIds(new Set())
    void rasterizeDrawings(drawings.map(d => d.id), Math.max(1, zoom * (window.devicePixelRatio || 1)), name)
      .then(id => {
        showToast(id ? t('atrium.toast.rasterized') : t('atrium.toast.rasterizeFailed'))
        if (id) setSelectedTraceId(id)
      })
      .catch(err => {
        console.error('[drawing] could not rasterize:', err)
        showToast(t('atrium.toast.rasterizeFailed'))
      })
  }

  const copyTraceStyle = (id: string) => {
    const trace = traces.find(tr => tr.id === id)
    if (!trace) return
    copyStyle(trace)
    showToast(t('atrium.toast.styleCopied'))
  }
  const pasteTraceStyle = (ids: string[]) => {
    const style = copiedStyle()
    if (!style || !canEdit) return
    const targets = traces.filter(tr => ids.includes(tr.id))
    const changed = new Set<string>()
    inOneStep(() => {
      for (const trace of targets) {
        const patch = stylePatchFor(trace, style)
        if (Object.keys(patch).length === 0) continue
        // A text filling its box keeps the box; its text refits to it.
        const refit = trace.type === 'text' && !(patch.textFit ?? trace.textFit) && ('fontFamily' in patch || 'fontSize' in patch)
        updateTraceCustomization(trace.id, refit ? { ...patch, ...fittedTextBox({ ...trace, ...patch }) } : patch)
        changed.add(trace.id)
      }
    })
    const drawings = style.strokes ? targets.filter(tr => has(tr, 'strokes')).map(tr => tr.id) : []
    if (drawings.length > 0 && lobbyId) {
      for (const id of drawings) changed.add(id)
      void changeStrokes(drawings, style.strokes!, lobbyId, userId)
    }
    showToast(changed.size > 0 ? t('atrium.toast.stylePasted') : t('atrium.toast.styleNoMatch'))
  }

  const deleteTraces = (traceIds: string[], linkIds: string[] = []) => {
    if (traceIds.length === 0) return
    const dontAskAgain = !useGameStore.getState().confirmDelete

    if (!dontAskAgain) {
      // Show custom confirmation dialog
      setDeleteConfirmDialog({ traceIds, linkIds })
      return
    }

    // Execute deletion
    executeDelete(traceIds, linkIds)
  }

  const executeDelete = (traceIds: string[], linkIds: string[] = []) => {
    setContextMenu(null)
    setDeleteConfirmDialog(null)
    setMultiSelectedIds(new Set())

    // Each connection goes with the first of its traces to be deleted. All of
    // it is one undo step (pushDeleteOp), which brings every trace back before
    // any connection.
    const takenLinks = new Set<string>()
    const deleted: { trace: Trace; links: TraceLink[] }[] = []
    // Selected connections first, whatever they join.
    const wanted = new Set(linkIds)
    const loose = useGameStore.getState().links.filter(l => wanted.has(l.id))
    for (const link of loose) {
      takenLinks.add(link.id)
      dropLink(link.id)
    }
    if (loose.length > 0) clearLinkSelection()
    for (const traceId of traceIds) {
      const traceBeingDeleted = traces.find(t => t.id === traceId)
      const itsLinks = useGameStore.getState().links.filter(l =>
        (l.from === traceId || l.to === traceId) && !takenLinks.has(l.id))
      for (const link of itsLinks) {
        takenLinks.add(link.id)
        dropLink(link.id)
      }

      // Immediately remove from local state for instant UI update
      removeTrace(traceId)
      if (selectedTraceId === traceId) setSelectedTraceId(null)

      // Mark for deletion (will be deleted on save)
      markTraceDeleted(traceId)
      // Keep the "detect new traces" effect's known-ids set (below) in sync
      // synchronously, so an undo restoring this trace isn't mistaken for a
      // brand-new one -- see the comments in applyUndoOp's delete/add
      // branches for the full explanation.
      knownTraceIdsRef.current?.delete(traceId)

      if (traceBeingDeleted) deleted.push({ trace: traceBeingDeleted, links: itsLinks })
    }
    if (deleted.length === 0) {
      if (loose.length > 0) pushLinksOp(loose, [])
      return
    }
    // The selected connections ride on the first trace's entry: undo brings
    // them back with the rest.
    deleted[0].links = [...loose, ...deleted[0].links]
    pushDeleteOp(deleted)
  }

  const duplicateTrace = async (traceId: string) => {
    const tracesToDuplicate = getSelectedTraceSnapshots(traceId)
    if (tracesToDuplicate.length === 0) return

    await duplicateTraces(tracesToDuplicate)
  }

  // The ids of the traces in a trace's group, when it is in one that exists
  // and has others in it; null for a trace on its own.
  const groupMembersOf = (trace: Trace): string[] | null => {
    if (!trace.layerId || !layers.some(l => l.id === trace.layerId)) return null
    const members = traces.filter(t => t.layerId === trace.layerId).map(t => t.id)
    return members.length > 1 ? members : null
  }
  // The trace pressed inside an already-selected group; picked out of it if
  // the press turns out to be a click (handleMouseUp).
  const groupClickRef = useRef<string | null>(null)

  // Traces moved in the drawing order (lib/order reorder): within their
  // group, or the stack when in none -- a whole group selected moves as the
  // group, in the stack. The right-click menu's Move Layer and the
  // Customization panel's foot, as Excalidraw's layer buttons. Traces' places
  // wait for Save as any change does, one step of undo; a group's is written
  // now, as the Layer panel's are, its own step.
  const moveInOrder = (ids: string[], how: 'up' | 'down' | 'top' | 'bottom') => {
    setContextMenu(null)
    if (!canEdit) return
    const chosen = traces.filter(t => ids.includes(t.id))
    // Whole groups: all a group's traces, among several selected.
    const whole = new Set(chosen.length > 1 ? layers.filter(l => {
      const members = traces.filter(t => t.layerId === l.id)
      return members.length > 0 && members.every(m => ids.includes(m.id))
    }).map(l => l.id) : [])
    const pools = new Map<string, Set<string>>()
    for (const trace of chosen) {
      const group = groupIdOf(trace, layers)
      const [pool, id] = group && whole.has(group) ? ['', group] : [group ?? '', trace.id]
      pools.set(pool, (pools.get(pool) ?? new Set<string>()).add(id))
    }
    const traceKeys = new Map<string, string>()
    const groupKeys = new Map<string, string>()
    for (const [group, moving] of pools) {
      let pool: Ordered[] = group ? traces.filter(t => t.layerId === group) : topLevel(traces, layers)
      let keys = reorder(pool, moving, how)
      // No room between two of a group's traces: rekeyed in their order first.
      if (!keys && group) {
        const fresh = keysBetween(null, null, pool.length)
        pool = inOrder(pool).map((t, i) => ({ ...t, orderKey: fresh[i] }))
        for (const t of pool) traceKeys.set(t.id, t.orderKey!)
        keys = reorder(pool, moving, how)
      }
      for (const [id, key] of keys ?? []) (layers.some(l => l.id === id) ? groupKeys : traceKeys).set(id, key)
    }
    if (traceKeys.size > 0) inOneStep(() => { for (const [id, orderKey] of traceKeys) updateTraceCustomization(id, { orderKey }) })
    if (groupKeys.size > 0 && lobbyId) {
      void queueLayerChange(() => withLayerUndo('move group', async () => {
        for (const [id, key] of groupKeys) {
          const layer = useGameStore.getState().layers.find(l => l.id === id)
          if (layer) await writeGroupKey(layer, key, lobbyId)
        }
      }))
    }
  }
  // Its four buttons' names: to the top of a group, or of everything.
  const orderLabels = (inGroup: boolean) => ({
    up: t('atrium.menu.moveUp'),
    down: t('atrium.menu.moveDown'),
    top: inGroup ? t('atrium.menu.moveTopOfGroup') : t('atrium.menu.moveToTop'),
    bottom: inGroup ? t('atrium.menu.moveBottomOfGroup') : t('atrium.menu.moveToBottom'),
  })

  const MAX_REORGANIZE_TRACES = 100

  // Right-click > "Reorganize Selected" -- re-packs the current
  // multi-selection with the same bin-packing algorithm used for a fresh
  // batch embed/multi-file placement, but around the selection's own
  // current center instead of a drop point. Capped at 100 traces since a
  // much larger multi-select is an unusual case not worth the packer's
  // overlap-check (circle mode) or skyline-scan (square mode) overhead.
  //
  // The shape is an argument rather than a stored preference: it's chosen in
  // the submenu at the moment of use, so there's nothing to remember and no
  // way for the setting to disagree with what the user just clicked.
  const reorganizeSelectedTraces = async (packingShape: 'square' | 'circle') => {
    const ids = Array.from(multiSelectedIds)
    if (ids.length < 2 || ids.length > MAX_REORGANIZE_TRACES) {
      setContextMenu(null)
      return
    }
    const selected = ids
      .map(id => traces.find(t => t.id === id))
      .filter((t): t is Trace => !!t)
    if (selected.length < 2) {
      setContextMenu(null)
      return
    }

    setContextMenu(null)

    const anchorX = selected.reduce((sum, t) => sum + t.x, 0) / selected.length
    const anchorY = selected.reduce((sum, t) => sum + t.y, 0) / selected.length

    // Two things determine a trace's real on-canvas footprint, and both were
    // being missed:
    //
    // 1. getTraceSize only knows an image/embed's true dimensions once its
    //    <img> has actually rendered and loaded on screen (imageDimensions[id]
    //    is populated by that element's own onLoad). A selected trace that's
    //    off-screen, culled by zoom/distance, or never scrolled into view yet
    //    never populated that cache, so packing it at getTraceSize's flat
    //    fallback default caused the same overlap a fresh batch embed had
    //    before it probed real dimensions up front -- so probe anything still
    //    missing from the cache.
    // 2. getTraceSize returns the BASE (unscaled) box, but a trace also has a
    //    scaleX/scaleY (from resizing/zoom-to-fit), and it renders at
    //    base * scale world units. Packing the base size while the trace
    //    draws bigger is itself enough to overlap -- a fresh batch embed is
    //    always scale 1 so this never showed up there, but an existing
    //    selection can be any scale. Multiply the packed box by each trace's
    //    real scale.
    const sizes = await Promise.all(selected.map(async (trace) => {
      const transform = getTraceTransform(trace)
      const sx = Math.abs(transform.scaleX) || 1
      const sy = Math.abs(transform.scaleY) || 1
      let base = getTraceSize(trace)
      const needsProbe =
        (trace.type === 'image' || trace.type === 'embed') &&
        !(trace.width && trace.height) &&
        !imageDimensions[trace.id]
      if (needsProbe) {
        const url = localMediaUrls[trace.id] || trace.mediaUrl
        if (url) {
          const probed = await probeRemoteImageDimensions(url)
          if (probed) base = scaleToDisplayBox(probed)
        }
      }
      return { width: base.width * sx, height: base.height * sy }
    }))
    const offsets = packBoxesAroundCenter(sizes, 24, packingShape)

    const batchOps: { traceId: string; before: Partial<Trace>; after: Partial<Trace> }[] = []
    selected.forEach((trace, i) => {
      const newX = anchorX + offsets[i].x
      const newY = anchorY + offsets[i].y
      batchOps.push({ traceId: trace.id, before: { x: trace.x, y: trace.y }, after: { x: newX, y: newY } })
      updateTraceTransform(trace.id, { x: newX, y: newY }, { skipUndo: true })
    })
    pushBatchUpdateOp(batchOps)
  }

  const updateTraceCustomization = (traceId: string, updates: Partial<Trace>, options?: { skipUndo?: boolean }) => {
    // Find the trace
    const trace = traces.find(t => t.id === traceId)
    if (!trace) return

    // As it showed, defaults included: undone, a field that had no value
    // gets its default written back (lib/traceStyle shownValue).
    const before: Partial<Trace> = {}
    for (const key of Object.keys(updates) as (keyof Trace)[]) {
      (before as any)[key] = shownValue(trace, key)
    }
    if (!options?.skipUndo) {
      pushUpdateOp(traceId, before, updates)
    }

    // Update editingTrace immediately if it matches
    if (editingTrace && editingTrace.id === traceId) {
      setEditingTrace({ ...editingTrace, ...updates })
    }

    // Update the trace in the store (local only - no DB sync)
    const updatedTrace: Trace = { ...trace, ...updates }
    addTrace(updatedTrace)

    // Mark as having pending changes
    markTraceChanged(traceId)
  }

  // A text box fits its text as it is typed, not only once typing stops.
  // Each keystroke resizes the trace without an undo entry of its own; the
  // edit as a whole becomes one entry when it ends, measured from how the
  // trace was before the first keystroke.
  const textEditStartRef = useRef<{ id: string; content: string; width?: number; height?: number } | null>(null)
  // The text box last dragged out for new text, whose size its typing keeps.
  const drawnTextIdRef = useRef<string | null>(null)
  const fitTextLive = (trace: Trace, content: string, fontSize: number, fontFamily: string) => {
    if (textEditStartRef.current?.id !== trace.id) {
      textEditStartRef.current = { id: trace.id, content: trace.content ?? '', width: trace.width, height: trace.height }
    }
    // A new box dragged out for its text (the quick bar's Text) keeps its
    // size, and grows from it only once the text outgrows it. Any other box
    // fits its text from the usual size.
    const start = textEditStartRef.current
    // A text filling its box keeps the box: its font fits the text instead.
    if (trace.textFit) {
      updateTraceCustomization(trace.id, { content }, { skipUndo: true })
      return
    }
    const drawn = drawnTextIdRef.current === trace.id && !!start.width && !!start.height
    const size = computeAutoFitTextSize(content, fontSize, drawn ? { fontFamily, baseWidth: start.width, baseHeight: start.height } : { fontFamily })
    updateTraceCustomization(trace.id, { content, width: size.width, height: size.height }, { skipUndo: true })
  }
  // A sheet's cell changed (SheetTrace): a new file of the sheet with it
  // changed (lib/sheetEdit), the trace pointed at it -- a step of undo.
  const commitSheetCell = async (trace: Trace, row: number, col: number, text: string) => {
    if (!trace.mediaUrl || !lobbyId || !userId) return
    const { editSheetCell } = await import('../lib/sheetEdit')
    const url = await editSheetCell(trace.mediaUrl, row, col, text, lobbyId, userId)
    if (url) updateTraceCustomization(trace.id, { mediaUrl: url })
  }
  // cancel puts the text and box back as they were (Escape).
  const endTextEdit = (traceId: string, cancel = false) => {
    const start = textEditStartRef.current
    textEditStartRef.current = null
    if (!start || start.id !== traceId) return
    const before = { content: start.content, width: start.width, height: start.height }
    if (cancel) {
      updateTraceCustomization(traceId, before, { skipUndo: true })
      return
    }
    const live = useGameStore.getState().traces.find(t => t.id === traceId)
    if (live && live.content !== start.content) {
      pushUpdateOp(traceId, before, { content: live.content, width: live.width, height: live.height })
    }
  }

  // Touch adapter: converts a TouchEvent into a fake React.MouseEvent for handleMouseDown
  const handleTouchDown = (e: React.TouchEvent, trace: Trace, mode: TransformMode, corner?: string) => {
    if (e.touches.length !== 1) return
    e.preventDefault()
    const touch = e.touches[0]
    // Create a synthetic React-like MouseEvent from the touch
    const synth = {
      button: 0,
      clientX: touch.clientX,
      clientY: touch.clientY,
      shiftKey: false,
      stopPropagation: () => e.stopPropagation(),
      preventDefault: () => e.preventDefault(),
    } as unknown as React.MouseEvent
    handleMouseDown(synth, trace, mode, corner)
  }

  const handleMouseDown = (e: React.MouseEvent, trace: Trace, mode: TransformMode, corner?: string) => {
    // Adding a path's points: another trace pressed is only where the next
    // point goes (handleClickOutside) -- not taken, nor selected.
    if (pathCreationModeRef.current && trace.id !== pathIdRef.current && e.button === 0) return
    if (connectFromRef.current) {
      e.stopPropagation()
      e.preventDefault()
      finishConnect(trace.id)
      return
    }
    // A right press is the menu's (onContextMenu). It ran as a left press
    // did, so a group selected whole was taken apart by its release (the
    // "second click" below) and the menu came up for one trace of it. Now it
    // only settles what the menu is for: a selection this trace is in stays
    // as it is; otherwise what a left click would take -- its group, unless
    // picking directly, or unless one of the group is already picked out.
    if (e.button === 2) {
      e.stopPropagation()
      if (!multiSelectedIds.has(trace.id)) {
        const members = directSelect || e.ctrlKey || e.metaKey ? null : groupMembersOf(trace)
        const opened = multiSelectedIds.size === 0 && !!selectedTraceId && !!members?.includes(selectedTraceId)
        setMultiSelectedIds(new Set(members && !opened ? members : []))
      }
      setSelectedTraceId(trace.id)
      return
    }
    // Locked: selected by a click -- where its lock button is, to unlock it --
    // and not moved, sized or turned. Crop still works on it.
    if (isLockedTrace(trace) && mode !== 'crop') {
      if (mode === 'move') {
        e.stopPropagation()
        setMultiSelectedIds(new Set())
        setSelectedTraceId(trace.id)
      }
      return
    }

    // A trace in a group is taken as its group: pressed, the whole group is
    // selected, and moves. Pressed again without moving -- a second click --
    // it is the trace alone (see handleMouseUp). Once one of a group's traces
    // is selected on its own, the group is open: its other traces are taken
    // on their own too, until something outside it is chosen. Shift-click
    // still adds or removes a single trace.
    let selection = multiSelectedIds
    groupClickRef.current = null
    // Direct select (the quick bar's, or Ctrl/Cmd for one click) takes the
    // trace itself, as if it were in no group.
    const direct = directSelect || e.ctrlKey || e.metaKey
    const members = mode === 'move' && !e.shiftKey && !direct ? groupMembersOf(trace) : null
    if (members) {
      if (members.every(id => multiSelectedIds.has(id))) {
        // Already selected, the group alone: a drag moves it, a click opens it.
        if (multiSelectedIds.size === members.length) groupClickRef.current = trace.id
      } else if (!(multiSelectedIds.size === 0 && selectedTraceId && members.includes(selectedTraceId))) {
        selection = new Set(members)
        setMultiSelectedIds(selection)
      }
    }
    // Direct, on a trace of a group selected whole: that trace alone. A
    // selection made any other way -- an area, Shift -- still moves together.
    if (direct && mode === 'move' && !e.shiftKey && selection.has(trace.id)) {
      const group = groupMembersOf(trace)
      if (group && selection.size === group.length && group.every(id => selection.has(id))) {
        selection = new Set()
        setMultiSelectedIds(selection)
      }
    }

    e.stopPropagation()
    
    // Handle multi-select with Shift key
    if (e.shiftKey && mode === 'move') {
      setMultiSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(trace.id)) {
          next.delete(trace.id) // Deselect if already selected
        } else {
          next.add(trace.id) // Add to selection
        }
        // Also add the currently selected trace if not already in selection
        if (selectedTraceId && !next.has(selectedTraceId)) {
          next.add(selectedTraceId)
        }
        return next
      })
      setSelectedTraceId(trace.id)
      return // Don't start dragging on shift-click, just toggle selection
    }
    
    // If clicking on a trace that's part of multi-selection, keep the selection
    // Otherwise, clear multi-selection
    if (!selection.has(trace.id)) {
      selection = new Set()
      setMultiSelectedIds(selection)
    }

    // A path is where its points are, so on its own it moves by them
    // ('move-path'): a 'move' would shift its x/y, which nothing draws from.
    // With others -- its group, a selection -- it moves with them as usual.
    if (mode === 'move' && isPathTrace(trace) && selection.size === 0) mode = 'move-path'

    // A plain press on a clickable trace: hold back its handles and show the
    // pressed state until we know whether this is a click or a drag.
    if (mode === 'move' && trace.isClickable && trace.linkUrl && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Ref set alongside the state: a mousemove can arrive before React has
      // re-rendered, and it reads the ref.
      pressedClickableIdRef.current = trace.id
      setPressedClickableId(trace.id)
    }

    setSelectedTraceId(trace.id)

    // Selecting a trace (to view it) is always allowed; only arming an
    // actual drag/transform is gated. Handles themselves already don't
    // render for a non-editor (see the isSelected && canEdit guards), so in
    // practice only 'move' (clicking the trace body itself) can reach here.
    if (!canEdit) return

    // Taking hold of a trace ends any glide still running, where it has got to.
    stopGlide()
    dragSamplesRef.current = mode === 'move' ? [{ x: e.clientX, y: e.clientY, t: performance.now() }] : []
    dragShiftRef.current = false

    setTransformMode(mode)
    selectedTraceIdRef.current = trace.id
    transformModeRef.current = mode
    pressMovedRef.current = false
    setCursorState('grabbing') // Change cursor to grabbing while dragging
    
    // Prevent text selection during drag
    document.body.classList.add('dragging')
    
    const transform = getTraceTransform(trace)
    startPosRef.current = { x: e.clientX, y: e.clientY, corner: corner || '' }
    // copy transform including scaleX/scaleY
    startTransformRef.current = { ...transform }
    // Cropping writes the trace's position with its crop, to the store alone
    // (see the crop drag), so a local override left from an earlier drag
    // goes: it would go on placing the trace where it was. It holds what the
    // store holds, and is gone before the first step renders -- a press is
    // rendered at once.
    if (mode === 'crop') {
      setLocalTraceTransforms(prev => {
        if (!(trace.id in prev)) return prev
        const next = { ...prev }
        delete next[trace.id]
        return next
      })
    }
    // Store starting crop values
    startCropRef.current = {
      cropX: trace.cropX ?? 0,
      cropY: trace.cropY ?? 0,
      cropWidth: trace.cropWidth ?? 1,
      cropHeight: trace.cropHeight ?? 1,
    }
    
    // What moves: the selection, or the trace alone -- and what any frame
    // among them holds (lib/frames), selected or not.
    const taken = selection.size > 0 ? [...selection] : [trace.id]
    const takenFrames = new Set(taken.filter(id => traces.some(t => t.id === id && isFrame(t))))
    const carriedByFrames = mode === 'move' ? heldBy(takenFrames, traces).map(t => t.id) : []
    const dragIds = new Set([...selection, ...carriedByFrames])

    // Store starting transforms for all multi-selected traces
    if (dragIds.size > 0 && (mode === 'move' || mode === 'move-path')) {
      const startTransforms: Record<string, { x: number; y: number }> = {}
      const startPathPoints: Record<string, any[]> = {}
      dragIds.forEach(id => {
        const t = traces.find(tr => tr.id === id)
        if (t) {
          const tTransform = getTraceTransform(t)
          startTransforms[id] = { x: tTransform.x, y: tTransform.y }
          // For path shapes, also store starting shapePoints
          if (t.type === 'shape' && t.shapeType === 'path' && t.shapePoints) {
            startPathPoints[id] = t.shapePoints.map(p => ({ ...p }))
          }
        }
      })
      // Also include the clicked trace
      startTransforms[trace.id] = { x: transform.x, y: transform.y }
      if (trace.type === 'shape' && trace.shapeType === 'path' && trace.shapePoints) {
        startPathPoints[trace.id] = trace.shapePoints.map(p => ({ ...p }))
      }
      multiStartTransformsRef.current = startTransforms
      multiStartPathPointsRef.current = startPathPoints
      isMultiDragActiveRef.current = true
    }
    
    const { screenX, screenY } = getScreenPosition(transform.x, transform.y)
    centerRef.current = { x: screenX, y: screenY }

    if (mode === 'move') {
      startDragFeel(isMultiDragActiveRef.current ? Object.keys(multiStartTransformsRef.current) : [trace.id])
    }
  }

  // Starts a scale/rotate drag on the multi-selection as a whole. Unlike
  // handleMouseDown this isn't anchored to any one trace -- the pivot is the
  // shared bounding-box center, so every selected trace orbits it together.
  // The corner is the whole difference between growing a selection from its
  // middle and dragging one edge of it. Rotation still turns about the centre,
  // which is the only fixed point a rotation has.
  const groupPivotFor = (bounds: { minX: number; minY: number; maxX: number; maxY: number }, corner: string) => ({
    x: corner.includes('l') ? bounds.maxX : bounds.minX,
    y: corner.includes('t') ? bounds.maxY : bounds.minY,
  })
  const groupCornerFor = (bounds: { minX: number; minY: number; maxX: number; maxY: number }, corner: string) => ({
    x: corner.includes('l') ? bounds.minX : bounds.maxX,
    y: corner.includes('t') ? bounds.minY : bounds.maxY,
  })

  const handleGroupMouseDown = (e: React.MouseEvent, mode: 'group-scale' | 'group-rotate', corner = 'br') => {
    if (!canEdit) return
    e.stopPropagation()
    e.preventDefault()

    const ids = Array.from(multiSelectedIds)
    const bounds = getGroupBounds(ids)
    if (!bounds) return

    const startTraces: Record<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number; shapePoints?: any[] }> = {}
    for (const id of ids) {
      const t = traces.find(tr => tr.id === id)
      if (!t) continue
      const tf = localTraceTransforms[id] || getTraceTransform(t)
      const entry: any = { x: tf.x, y: tf.y, scaleX: tf.scaleX, scaleY: tf.scaleY, rotation: tf.rotation }
      if (t.type === 'shape' && t.shapeType === 'path') {
        const pts = localShapePoints[id] || t.shapePoints
        if (pts) entry.shapePoints = pts.map((p: any) => ({ ...p }))
      }
      startTraces[id] = entry
    }

    groupStartRef.current = { center: { x: bounds.centerX, y: bounds.centerY }, bounds, traces: startTraces }

    setTransformMode(mode)
    transformModeRef.current = mode
    startPosRef.current = { x: e.clientX, y: e.clientY, corner: mode === 'group-scale' ? `group-${corner}` : 'group' }
    // Scaling measures from the anchored corner, so that is what the distance
    // ratio has to be taken against; rotating measures from the centre.
    const pivot = mode === 'group-scale'
      ? groupPivotFor(bounds, corner)
      : { x: bounds.centerX, y: bounds.centerY }
    const { screenX, screenY } = getScreenPosition(pivot.x, pivot.y)
    centerRef.current = { x: screenX, y: screenY }
    isMultiDragActiveRef.current = true
    setCursorState('grabbing')
    document.body.classList.add('dragging')
  }

  const handleGroupTouchDown = (e: React.TouchEvent, mode: 'group-scale' | 'group-rotate', corner = 'br') => {
    if (e.touches.length !== 1) return
    e.preventDefault()
    const touch = e.touches[0]
    const synth = {
      button: 0,
      clientX: touch.clientX,
      clientY: touch.clientY,
      shiftKey: false,
      stopPropagation: () => e.stopPropagation(),
      preventDefault: () => e.preventDefault(),
    } as unknown as React.MouseEvent
    handleGroupMouseDown(synth, mode, corner)
  }

  const handleMouseMove = (e: MouseEvent) => {
    const activeTransformMode = transformModeRef.current
    const activeSelectedTraceId = selectedTraceIdRef.current
    if (activeTransformMode === 'none') return

    // Group transforms pivot around the shared bounding-box center rather
    // than any one trace, so they run before (and independently of) the
    // single-trace lookup below.
    if (activeTransformMode === 'group-scale' || activeTransformMode === 'group-rotate') {
      justDraggedRef.current = true
      const { center, bounds, traces: startTraces } = groupStartRef.current
      const groupZoom = zoomRef.current || 1
      const groupCorner = startPosRef.current.corner.startsWith('group-')
        ? startPosRef.current.corner.slice(6)
        : 'br'
      // Everything below scales away from this point, so the opposite corner
      // of the selection stays exactly where it was -- the same anchoring a
      // single trace has always had. Scaling from the centre instead meant the
      // selection grew in every direction at once and the corner under the
      // cursor never went where it was put.
      const pivot = activeTransformMode === 'group-scale'
        ? groupPivotFor(bounds, groupCorner)
        : center
      const startAngle = Math.atan2(startPosRef.current.y - centerRef.current.y, startPosRef.current.x - centerRef.current.x)
      const currentAngle = Math.atan2(e.clientY - centerRef.current.y, e.clientX - centerRef.current.x)

      let factor = 1
      let angleDeg = 0
      if (activeTransformMode === 'group-scale') {
        const startDist = Math.hypot(startPosRef.current.x - centerRef.current.x, startPosRef.current.y - centerRef.current.y)
        const currentDist = Math.hypot(e.clientX - centerRef.current.x, e.clientY - centerRef.current.y)
        factor = startDist > 0 ? Math.max(0.01, currentDist / startDist) : 1

        // Shift lines the selection's dragged corner up with its neighbours,
        // the same as it does for one trace. The correction lands on the
        // FACTOR rather than on a position, because that is the only handle a
        // group scale has: solve for the factor that puts the corner on the
        // target and every trace in the selection follows it.
        const startCorner = groupCornerFor(bounds, groupCorner)
        let guides: { x?: { at: number; from: number; to: number }; y?: { at: number; from: number; to: number } } | null = null

        if (e.shiftKey) {
          const held = multiSelectedIdsRef.current
          const tolerance = ALIGN_SNAP_PX / groupZoom
          const reach = ALIGN_NEIGHBOURHOOD_PX / groupZoom
          const cornerX = pivot.x + (startCorner.x - pivot.x) * factor
          const cornerY = pivot.y + (startCorner.y - pivot.y) * factor

          let bestX: { at: number; d: number; from: number; to: number } | null = null
          let bestY: { at: number; d: number; from: number; to: number } | null = null

          for (const other of visibleTracesRef.current) {
            if (held.has(other.id)) continue
            const box = traceBoxFor(other, undefined, groupZoom)
            if (Math.abs(box.cx - center.x) > reach && Math.abs(box.cy - center.y) > reach) continue
            const xs = box.rotated ? [box.cx] : [box.cx - box.halfW, box.cx, box.cx + box.halfW]
            const ys = box.rotated ? [box.cy] : [box.cy - box.halfH, box.cy, box.cy + box.halfH]
            for (const at of xs) {
              const d = Math.abs(at - cornerX)
              if (d <= tolerance && (!bestX || d < bestX.d)) {
                bestX = { at, d, from: box.cy - box.halfH, to: box.cy + box.halfH }
              }
            }
            for (const at of ys) {
              const d = Math.abs(at - cornerY)
              if (d <= tolerance && (!bestY || d < bestY.d)) {
                bestY = { at, d, from: box.cx - box.halfW, to: box.cx + box.halfW }
              }
            }
          }

          // One axis only. A group scale is uniform, so honouring both would
          // need two different factors and the selection would distort.
          const spanX = startCorner.x - pivot.x
          const spanY = startCorner.y - pivot.y
          const takeX = bestX && (!bestY || bestX.d <= bestY.d) && Math.abs(spanX) > 0.001
          const takeY = !takeX && bestY && Math.abs(spanY) > 0.001

          if (takeX && bestX) {
            factor = Math.max(0.01, (bestX.at - pivot.x) / spanX)
          } else if (takeY && bestY) {
            factor = Math.max(0.01, (bestY.at - pivot.y) / spanY)
          }

          const gy1 = pivot.y + (bounds.minY - pivot.y) * factor
          const gy2 = pivot.y + (bounds.maxY - pivot.y) * factor
          const gx1 = pivot.x + (bounds.minX - pivot.x) * factor
          const gx2 = pivot.x + (bounds.maxX - pivot.x) * factor
          if (takeX && bestX) {
            guides = { x: { at: bestX.at, from: Math.min(bestX.from, gy1, gy2), to: Math.max(bestX.to, gy1, gy2) } }
          } else if (takeY && bestY) {
            guides = { y: { at: bestY.at, from: Math.min(bestY.from, gx1, gx2), to: Math.max(bestY.to, gx1, gx2) } }
          }
        }
        setAlignGuides(guides)
      } else {
        angleDeg = (currentAngle - startAngle) * (180 / Math.PI)
        // A group has no single "current angle" to snap onto -- its members
        // each carry their own rotation -- so the delta itself is snapped,
        // keeping the turn a clean multiple while preserving the relative
        // angles within the selection.
        if (e.shiftKey) {
          angleDeg = Math.round(angleDeg / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES
        }
        setRotationReadout({
          screenX: e.clientX,
          screenY: e.clientY,
          angle: angleDeg,
          snapped: e.shiftKey,
          delta: true,
        })
      }

      const rad = (angleDeg * Math.PI) / 180
      const cos = Math.cos(rad)
      const sin = Math.sin(rad)
      // Maps a world point through the group transform: scale outward from
      // the pivot, or orbit around it.
      const mapPoint = (px: number, py: number) => {
        const dx = px - center.x
        const dy = py - center.y
        if (activeTransformMode === 'group-scale') {
          return { x: pivot.x + (px - pivot.x) * factor, y: pivot.y + (py - pivot.y) * factor }
        }
        return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
      }

      for (const [id, start] of Object.entries(startTraces)) {
        if (start.shapePoints) {
          const newPoints = start.shapePoints.map((p: any) => {
            const moved = mapPoint(p.x, p.y)
            const next: any = { ...p, x: moved.x, y: moved.y }
            if (p.cp1x !== undefined && p.cp1y !== undefined) {
              const c1 = mapPoint(p.cp1x, p.cp1y)
              next.cp1x = c1.x; next.cp1y = c1.y
            }
            if (p.cp2x !== undefined && p.cp2y !== undefined) {
              const c2 = mapPoint(p.cp2x, p.cp2y)
              next.cp2x = c2.x; next.cp2y = c2.y
            }
            return next
          })
          setLocalShapePoints(prev => ({ ...prev, [id]: newPoints }))
          updateTraceCustomization(id, { shapePoints: newPoints }, { skipUndo: true })
        } else {
          const moved = mapPoint(start.x, start.y)
          updateTraceTransform(id, {
            x: moved.x,
            y: moved.y,
            scaleX: activeTransformMode === 'group-scale' ? Math.max(0.01, start.scaleX * factor) : start.scaleX,
            scaleY: activeTransformMode === 'group-scale' ? Math.max(0.01, start.scaleY * factor) : start.scaleY,
            rotation: activeTransformMode === 'group-rotate' ? start.rotation + angleDeg : start.rotation,
          }, { skipUndo: true })
        }
      }
      return
    }

    if (!activeSelectedTraceId) return

    // Use refs to get latest values (avoid stale closures)
    const currentTraces = tracesRef.current
    const currentEditingTrace = editingTraceRef.current
    const currentLocalShapePoints = localShapePointsRef.current
    const currentZoom = zoomRef.current

    const trace = currentTraces.find(t => t.id === activeSelectedTraceId)
    if (!trace) return
    
    // Use editingTrace if available for the most up-to-date data
    const currentTrace = (currentEditingTrace && currentEditingTrace.id === activeSelectedTraceId) ? currentEditingTrace : trace

    // Remembered so the edge-pan loop can keep applying the drag while the
    // cursor is held still against the edge and only the camera is moving.
    lastPointerRef.current = { x: e.clientX, y: e.clientY, shiftKey: !!e.shiftKey }

    // Carried over the Layer panel, a moved trace goes back to where it
    // started -- the move is worked out as no move at all -- and the panel
    // shows a card of it to place in the list instead (lib/panelDrop).
    const isMove = activeTransformMode === 'move' || activeTransformMode === 'move-path'
    const inPanel = isMove && overPanel(e.clientX, e.clientY)
    if (isMove) {
      const carried = isMultiDragActiveRef.current ? Object.keys(multiStartTransformsRef.current) : activeSelectedTraceId ? [activeSelectedTraceId] : []
      if (inPanel) panelDrop.current?.hover(carried, e.clientX, e.clientY)
      else if (inPanelRef.current) panelDrop.current?.leave()
      inPanelRef.current = inPanel
    }
    const deltaX = inPanel ? 0 : e.clientX - startPosRef.current.x
    const deltaY = inPanel ? 0 : e.clientY - startPosRef.current.y
    
    // If mouse has moved more than 3 pixels, consider it a drag
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      justDraggedRef.current = true
      pressMovedRef.current = true
      // It's a drag, not a click: let the handles through and drop the
      // pressed styling, so moving a clickable trace looks like moving any
      // other one.
      if (pressedClickableIdRef.current) {
        pressedClickableIdRef.current = null
        setPressedClickableId(null)
      }
    }

  if (activeTransformMode === 'move') {
      // The pointer's recent path, for the speed it's let go at.
      const samples = dragSamplesRef.current
      samples.push({ x: e.clientX, y: e.clientY, t: performance.now() })
      if (samples.length > 8) samples.shift()
      dragShiftRef.current = !!e.shiftKey
      if (!movingRef.current) {
        movingRef.current = true
        setMovingIds(new Set(isMultiDragActiveRef.current ? Object.keys(multiStartTransformsRef.current) : [activeSelectedTraceId]))
      }

      // Convert screen delta to world delta
      let worldDeltaX = deltaX / currentZoom
      let worldDeltaY = deltaY / currentZoom

      // Shift snaps the trace onto the grid it is being dragged over.
      //
      // Shift already means "snap" here -- it is what rounds a rotation to a
      // clean multiple -- so this is the same key doing the same job to the
      // other half of a transform. It is read on every move rather than at
      // mousedown, which matters twice over: Shift at mousedown already means
      // "add to selection", and holding it partway through a drag is how
      // somebody actually reaches for this, having started the drag and then
      // decided they want it lined up.
      //
      // The delta is adjusted rather than the final position, so a
      // multi-selection keeps its internal arrangement: the trace under the
      // cursor lands on the grid and everything selected with it travels the
      // same distance, instead of every trace independently collapsing onto
      // the nearest line and destroying the spacing between them.
      if (e.shiftKey && startTransformRef.current) {
        // Line up with the traces around it first, and with the grid only
        // when there is nothing to line up with.
        //
        // Both live on Shift because they answer the same request -- "put this
        // somewhere tidy" -- and which one is wanted depends entirely on
        // whether there is anything nearby. Giving them separate keys would
        // mean deciding, mid-drag, which kind of tidy was on offer.
        const activeTrace = tracesRef.current.find(t => t.id === activeSelectedTraceId)
        const moving = activeTrace
          ? traceBoxFor(activeTrace, {
              x: startTransformRef.current.x + worldDeltaX,
              y: startTransformRef.current.y + worldDeltaY,
            }, currentZoom)
          : null

        let guides: { x?: { at: number; from: number; to: number }; y?: { at: number; from: number; to: number } } | null = null

        if (moving) {
          // Everything except the traces travelling with the cursor. Aligning
          // to something being dragged alongside would be aligning to a
          // moving target.
          const held = isMultiDragActiveRef.current ? new Set(Object.keys(multiStartTransformsRef.current)) : multiSelectedIdsRef.current
          const candidates = visibleTracesRef.current.filter((t: Trace) =>
            t.id !== activeSelectedTraceId && !held.has(t.id))

          const { bestX, bestY } = findAlignment(moving, candidates, currentZoom)

          if (bestX || bestY) {
            guides = {}
            if (bestX) {
              worldDeltaX += bestX.delta
              guides.x = {
                at: bestX.at,
                from: Math.min(bestX.otherTop, moving.cy - moving.halfH),
                to: Math.max(bestX.otherBottom, moving.cy + moving.halfH),
              }
            }
            if (bestY) {
              worldDeltaY += bestY.delta
              guides.y = {
                at: bestY.at,
                from: Math.min(bestY.otherLeft, moving.cx - moving.halfW),
                to: Math.max(bestY.otherRight, moving.cx + moving.halfW),
              }
            }
          }
        }

        // No neighbour on an axis: fall back to the grid for that axis, by the
        // trace's top-left corner rather than its centre. A trace whose corner
        // sits on an intersection sits inside the squares; one whose centre
        // does straddles four of them, which is not what a grid is for.
        if (!guides?.x || !guides?.y) {
          const grid = gridLineSpacing && gridLineSpacing > 0 ? gridLineSpacing : GRID_SNAP_FALLBACK
          const box = moving ?? { halfW: 0, halfH: 0 }

          if (!guides?.x) {
            const left = startTransformRef.current.x + worldDeltaX - box.halfW
            worldDeltaX += Math.round(left / grid) * grid - left
          }
          if (!guides?.y) {
            const top = startTransformRef.current.y + worldDeltaY - box.halfH
            worldDeltaY += Math.round(top / grid) * grid - top
          }
        }

        setAlignGuides(guides)
      } else if (alignGuidesRef.current) {
        // Shift released mid-drag: the lines should go with it.
        setAlignGuides(null)
      }
      
      // Everything taken hold of together: the selection with the trace
      // pressed, and what any frame among them holds.
      const takenIds = Object.keys(multiStartTransformsRef.current)
      if (isMultiDragActiveRef.current && takenIds.length > 0) {
        takenIds.forEach(id => {
          const t = tracesRef.current.find(tr => tr.id === id)
          // For path shapes, move all points instead of transform
          if (t && t.type === 'shape' && t.shapeType === 'path') {
            const startPoints = multiStartPathPointsRef.current[id]
            if (startPoints) {
              const newPoints = startPoints.map(p => {
                const newP: any = { ...p, x: p.x + worldDeltaX, y: p.y + worldDeltaY }
                // Also offset control points if they exist
                if (p.cp1x !== undefined) newP.cp1x = p.cp1x + worldDeltaX
                if (p.cp1y !== undefined) newP.cp1y = p.cp1y + worldDeltaY
                if (p.cp2x !== undefined) newP.cp2x = p.cp2x + worldDeltaX
                if (p.cp2y !== undefined) newP.cp2y = p.cp2y + worldDeltaY
                return newP
              })
              setLocalShapePoints(prev => ({ ...prev, [id]: newPoints }))
              // skipUndo -- this whole multi-select move is recorded as ONE
              // batched undo step on mouseup instead of per-trace-per-frame.
              updateTraceCustomization(id, { shapePoints: newPoints }, { skipUndo: true })
            }
          } else {
            const startPos = multiStartTransformsRef.current[id]
            if (startPos) {
              updateTraceTransform(id, {
                x: startPos.x + worldDeltaX,
                y: startPos.y + worldDeltaY,
              }, { skipUndo: true })
            }
          }
        })
      } else {
        // Single trace move
        updateTraceTransform(activeSelectedTraceId, {
          x: startTransformRef.current.x + worldDeltaX,
          y: startTransformRef.current.y + worldDeltaY,
        })
      }
    } else if (transformMode === 'crop') {
      // The pointer's travel, turned into the trace's own axes and measured
      // in shares of its whole box, moves the handle's edges (lib/traceCrop).
      // The trace sits centred on its window, so it moves by as much as the
      // window's centre did: the edges not being dragged stay put on screen.
      // A shape is cropped in place, in a box that doesn't move.
      const start = startTransformRef.current
      const { width, height } = getTraceSize(trace)
      const boxW = (trace.type === 'shape' ? (trace.width || 200) : width) * start.scaleX
      const boxH = (trace.type === 'shape' ? (trace.height || 200) : height) * start.scaleY
      const local = turn(deltaX / currentZoom, deltaY / currentZoom, -start.rotation)
      const startCrop = startCropRef.current
      const from: Crop = { x: startCrop.cropX, y: startCrop.cropY, w: startCrop.cropWidth, h: startCrop.cropHeight }
      const next = dragCrop(from, startPosRef.current.corner, local.x / boxW, local.y / boxH)
      const crop = { cropX: next.x, cropY: next.y, cropWidth: next.w, cropHeight: next.h }
      const shift = trace.type === 'shape' ? { x: 0, y: 0 } : (() => {
        const d = cropShift(from, next)
        return turn(d.u * boxW, d.v * boxH, start.rotation)
      })()
      const position = { x: start.x + shift.x, y: start.y + shift.y }
      // One undo step for the crop and the move together, from where the
      // drag began (updates to one trace in a gesture are merged).
      pushUpdateOp(activeSelectedTraceId, { ...startCrop, x: start.x, y: start.y }, { ...crop, ...position })
      // Crop and position in one write to the store, and nowhere else. The
      // position also went to the local override (updateTraceTransform),
      // which React renders on its own schedule: for a frame the trace was
      // drawn with the new crop at the old place, then put right -- a
      // jitter on every step of the drag.
      updateTraceCustomization(activeSelectedTraceId, { ...crop, ...position }, { skipUndo: true })
    } else if (transformMode === 'scale') {
      // Anchors the handle's OPPOSITE edge/corner in place, so dragging the
      // bottom only grows downward (not also upward from the center), and
      // dragging a corner only grows toward that corner -- matching how
      // resize handles behave in most editors. Traces render center-anchored
      // (translate(-50%,-50%)), so keeping the anchor fixed requires shifting
      // the trace's center by half of whatever size change results, in the
      // trace's own (possibly rotated) local axes.
      //
      // Scale itself tracks the mouse 1:1 in world space (grow the box by
      // exactly how far the handle moved) rather than an arbitrary
      // sensitivity multiplier -- zoom-correct and much less twitchy than
      // the old fixed-percent-per-screen-pixel formula.
      const startScaleX = (startTransformRef.current as any).scaleX ?? (startTransformRef.current as any).scale ?? 1
      const startScaleY = (startTransformRef.current as any).scaleY ?? (startTransformRef.current as any).scale ?? 1
      const corner = startPosRef.current.corner
      const isCorner = corner.length === 2 // 'tl', 'tr', 'bl', 'br'

      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom
      const { width: baseWidth, height: baseHeight } = getTraceSize(currentTrace)

      // What one unit of scale is actually worth on screen.
      //
      // getTraceSize returns the UNCROPPED size, but a cropped trace draws at
      // size * crop * scale -- the same span traceBoxFor measures and the same
      // one the border is drawn around (see the borderWidth calculation in the
      // render). Scaling against the uncropped number makes a cropped trace
      // resize faster than the cursor and drags its anchored edge along with
      // it; snapping cannot hold an edge that is already drifting.
      const spanW = baseWidth * (currentTrace.type === 'shape' ? 1 : (currentTrace.cropWidth ?? 1))
      const spanH = baseHeight * (currentTrace.type === 'shape' ? 1 : (currentTrace.cropHeight ?? 1))

      let newScaleX = startScaleX
      let newScaleY = startScaleY
      let localDx = 0
      let localDy = 0

      if (isCorner) {
        // Uniform scaling (preserves aspect ratio), driven by distance from
        // center -- same metric as before, just anchored at the opposite
        // corner instead of the center.
        const startDist = Math.hypot(startPosRef.current.x - centerRef.current.x, startPosRef.current.y - centerRef.current.y)
        const currentDist = Math.hypot(e.clientX - centerRef.current.x, e.clientY - centerRef.current.y)
        const scaleFactor = startDist > 0 ? currentDist / startDist : 1
        newScaleX = Math.max(0.01, startScaleX * scaleFactor)
        newScaleY = Math.max(0.01, startScaleY * scaleFactor)
      } else if (corner === 'l' || corner === 'r') {
        // Horizontal edge - scale X only
        const sign = corner === 'r' ? 1 : -1
        newScaleX = Math.max(0.01, startScaleX + (sign * worldDeltaX) / spanW)
      } else if (corner === 't' || corner === 'b') {
        // Vertical edge - scale Y only
        const sign = corner === 'b' ? 1 : -1
        newScaleY = Math.max(0.01, startScaleY + (sign * worldDeltaY) / spanH)
      }

      // Shift lands the edge being dragged on a neighbour's edge.
      //
      // The same idea as Shift-dragging a trace, applied to the other half of
      // a transform: while moving snaps the whole box, resizing snaps the one
      // edge under the cursor and leaves the anchored edge exactly where it
      // is. Which means the correction is applied to the SCALE rather than to
      // a position -- solving for the scale that puts the moving edge on the
      // target, instead of nudging the box and dragging the anchor with it.
      //
      // Rotated traces are left alone. Their edges are not axis-aligned, so
      // there is no single world coordinate for "the right-hand edge" to snap
      // to a vertical line.
      const rotatedForSnap = (currentTrace.rotation ?? 0) % 360 !== 0
      let resizeGuides: { x?: { at: number; from: number; to: number }; y?: { at: number; from: number; to: number } } | null = null

      if (e.shiftKey && !rotatedForSnap) {
        const held = multiSelectedIdsRef.current
        const candidates = visibleTracesRef.current.filter((t: Trace) =>
          t.id !== activeSelectedTraceId && !held.has(t.id))

        // The frame is drawn outside the box, so it offsets every edge by a
        // constant number of world units -- see traceBoxFor.
        const hasFrame = currentTrace.type !== 'shape' && (currentTrace.showBorder ?? true)
        const frame = hasFrame ? (currentTrace.borderWidth ?? 2) : 0

        const tolerance = ALIGN_SNAP_PX / currentZoom
        const reach = ALIGN_NEIGHBOURHOOD_PX / currentZoom
        const startHalfW = (spanW * startScaleX) / 2 + frame
        const startHalfH = (spanH * startScaleY) / 2 + frame

        // The edge that stays put, in world coordinates.
        const anchorX = corner.includes('l')
          ? startTransformRef.current.x + startHalfW
          : startTransformRef.current.x - startHalfW
        const anchorY = corner.includes('t')
          ? startTransformRef.current.y + startHalfH
          : startTransformRef.current.y - startHalfH

        const movesX = corner.includes('l') || corner.includes('r')
        const movesY = corner.includes('t') || corner.includes('b')

        // Where the dragged edge currently sits, given the scale worked out
        // above.
        const edgeX = corner.includes('l')
          ? anchorX - (spanW * newScaleX + 2 * frame)
          : anchorX + (spanW * newScaleX + 2 * frame)
        const edgeY = corner.includes('t')
          ? anchorY - (spanH * newScaleY + 2 * frame)
          : anchorY + (spanH * newScaleY + 2 * frame)

        // `guide` is false for a grid match: the grid already draws itself, so
        // a line on top of one of its own would be noise. `from`/`to` is the
        // CANDIDATE's extent only -- the moving trace's half is added after the
        // snap, since resizing is what changes it.
        let bestX: { at: number; distance: number; from: number; to: number; guide: boolean } | null = null
        let bestY: { at: number; distance: number; from: number; to: number; guide: boolean } | null = null

        for (const other of candidates) {
          const box = traceBoxFor(other, undefined, currentZoom)
          if (Math.abs(box.cx - startTransformRef.current.x) > reach
            && Math.abs(box.cy - startTransformRef.current.y) > reach) continue

          // A rotated neighbour offers its centre and nothing else, exactly as
          // it does when dragging -- its edges are not axis-aligned lines.
          const otherX = box.rotated ? [box.cx] : [box.cx - box.halfW, box.cx, box.cx + box.halfW]
          const otherY = box.rotated ? [box.cy] : [box.cy - box.halfH, box.cy, box.cy + box.halfH]

          if (movesX) {
            for (const at of otherX) {
              const distance = Math.abs(at - edgeX)
              if (distance > tolerance) continue
              if (!bestX || distance < bestX.distance) {
                bestX = { at, distance, guide: true, from: box.cy - box.halfH, to: box.cy + box.halfH }
              }
            }
          }

          if (movesY) {
            for (const at of otherY) {
              const distance = Math.abs(at - edgeY)
              if (distance > tolerance) continue
              if (!bestY || distance < bestY.distance) {
                bestY = { at, distance, guide: true, from: box.cx - box.halfW, to: box.cx + box.halfW }
              }
            }
          }
        }

        // Nothing to align to on an axis: fall back to the grid, the same way
        // Shift-dragging does. Without this, holding Shift while resizing in an
        // empty part of the atrium would do nothing at all -- and the modifier
        // means the same thing in both gestures.
        const grid = gridLineSpacing && gridLineSpacing > 0 ? gridLineSpacing : GRID_SNAP_FALLBACK
        if (movesX && !bestX) {
          const at = Math.round(edgeX / grid) * grid
          bestX = { at, distance: Math.abs(at - edgeX), guide: false, from: 0, to: 0 }
        }
        if (movesY && !bestY) {
          const at = Math.round(edgeY / grid) * grid
          bestY = { at, distance: Math.abs(at - edgeY), guide: false, from: 0, to: 0 }
        }

        // A corner drags both axes at once and has to stay uniform, so only
        // the closer of the two matches is taken and the other axis follows
        // it. Picking both would mean two different scale factors and a trace
        // that changes shape as it snaps.
        const finalSpan = (axis: 'x' | 'y') => {
          const near = axis === 'x' ? corner.includes('l') : corner.includes('t')
          const far = axis === 'x' ? corner.includes('r') : corner.includes('b')
          const anchor = axis === 'x' ? anchorX : anchorY
          const length = axis === 'x' ? spanW * newScaleX + 2 * frame : spanH * newScaleY + 2 * frame
          if (near) return { from: anchor - length, to: anchor }
          if (far) return { from: anchor, to: anchor + length }
          // This axis is not being dragged, so it stays where it started.
          const c = axis === 'x' ? startTransformRef.current.x : startTransformRef.current.y
          const half = axis === 'x' ? startHalfW : startHalfH
          return { from: c - half, to: c + half }
        }

        const preferX = bestX && bestY && bestX.guide !== bestY.guide ? bestX.guide : null
        const useX = bestX && (!bestY || (preferX ?? bestX.distance <= bestY.distance))
        const useY = bestY && (!bestX || !(preferX ?? bestX!.distance <= bestY.distance))

        if (movesX && bestX && (!isCorner || useX)) {
          const width = Math.abs(bestX.at - anchorX) - 2 * frame
          if (width > 0) {
            const factor = width / spanW / (newScaleX || 1)
            newScaleX = Math.max(0.01, width / spanW)
            if (isCorner) newScaleY = Math.max(0.01, newScaleY * factor)
            if (bestX.guide) {
              const own = finalSpan('y')
              resizeGuides = {
                ...(resizeGuides ?? {}),
                x: { at: bestX.at, from: Math.min(bestX.from, own.from), to: Math.max(bestX.to, own.to) },
              }
            }
          }
        }

        if (movesY && bestY && (!isCorner || useY)) {
          const height = Math.abs(bestY.at - anchorY) - 2 * frame
          if (height > 0) {
            const factor = height / spanH / (newScaleY || 1)
            newScaleY = Math.max(0.01, height / spanH)
            if (isCorner) newScaleX = Math.max(0.01, newScaleX * factor)
            if (bestY.guide) {
              const own = finalSpan('x')
              resizeGuides = {
                ...(resizeGuides ?? {}),
                y: { at: bestY.at, from: Math.min(bestY.from, own.from), to: Math.max(bestY.to, own.to) },
              }
            }
          }
        }
      }

      setAlignGuides(resizeGuides)

      // The centre shift that keeps the anchored edge still, worked out from
      // the final scales -- so a snapped edge moves the centre by the snapped
      // amount rather than the raw one.
      if (isCorner) {
        const widthDelta = (spanW * newScaleX) / 2 - (spanW * startScaleX) / 2
        const heightDelta = (spanH * newScaleY) / 2 - (spanH * startScaleY) / 2
        localDx = corner.includes('r') ? widthDelta : -widthDelta
        localDy = corner.includes('b') ? heightDelta : -heightDelta
      } else if (corner === 'l' || corner === 'r') {
        const widthDelta = (spanW * newScaleX) / 2 - (spanW * startScaleX) / 2
        localDx = corner === 'r' ? widthDelta : -widthDelta
      } else if (corner === 't' || corner === 'b') {
        const heightDelta = (spanH * newScaleY) / 2 - (spanH * startScaleY) / 2
        localDy = corner === 'b' ? heightDelta : -heightDelta
      }

      const rotationRad = (startTransformRef.current.rotation * Math.PI) / 180
      const cos = Math.cos(rotationRad)
      const sin = Math.sin(rotationRad)
      const worldDx = localDx * cos - localDy * sin
      const worldDy = localDx * sin + localDy * cos

      updateTraceTransform(activeSelectedTraceId, {
        x: startTransformRef.current.x + worldDx,
        y: startTransformRef.current.y + worldDy,
        scaleX: newScaleX,
        scaleY: newScaleY,
      })
    } else if (activeTransformMode === 'rotate') {
      // Calculate rotation based on angle from center
      const startAngle = Math.atan2(
        startPosRef.current.y - centerRef.current.y,
        startPosRef.current.x - centerRef.current.x
      )
      const currentAngle = Math.atan2(
        e.clientY - centerRef.current.y,
        e.clientX - centerRef.current.x
      )
      
      const angleDelta = (currentAngle - startAngle) * (180 / Math.PI)
      // Snap the resulting absolute angle, not the delta, so shift-rotating
      // always lands on a clean multiple of the increment regardless of what
      // angle the trace started at.
      const snap = e.shiftKey
      const rawRotation = startTransformRef.current.rotation + angleDelta
      const newRotation = normalizeAngle(
        snap ? Math.round(rawRotation / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES : rawRotation
      )

      updateTraceTransform(activeSelectedTraceId, { rotation: newRotation })
      setRotationReadout({
        screenX: e.clientX,
        screenY: e.clientY,
        angle: newRotation,
        snapped: snap,
        delta: false,
      })
    } else if (activeTransformMode === 'point') {
      // Edit individual points for path shapes using world coordinates
      const pointIndex = parseInt(startPosRef.current.corner)
      if (isNaN(pointIndex)) return
      // Not moved past a click's few pixels: still a click, which on an end
      // point starts adding points there (handleMouseUp).
      if (!pressMovedRef.current) return

      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom

      // Use local points if available, otherwise use currentTrace points (which uses editingTrace if available)
      const currentPoints = currentLocalShapePoints[activeSelectedTraceId] || currentTrace.shapePoints || []
      const newPoints = [...currentPoints]
      if (newPoints[pointIndex]) {
        // Store initial point if not already stored
        if (!startPosRef.current.initialPoint) {
          startPosRef.current.initialPoint = { ...currentPoints[pointIndex] }
        }

        const initial = startPosRef.current.initialPoint as PathPoint
        let x = initial.x + worldDeltaX, y = initial.y + worldDeltaY
        // Shift, over another trace: onto its border.
        const offset = worldOffsetRef.current
        const snap = e.shiftKey ? borderSnapAt({ x: (e.clientX - offset.x) / currentZoom, y: (e.clientY - offset.y) / currentZoom }, currentZoom) : null
        showBorderSnap(snap)
        if (snap) { x = snap.at.x; y = snap.at.y }
        const dx = x - initial.x, dy = y - initial.y

        // Move point and control handles together
        newPoints[pointIndex] = {
          ...initial,
          x, y,
          cp1x: initial.cp1x !== undefined ? initial.cp1x + dx : undefined,
          cp1y: initial.cp1y !== undefined ? initial.cp1y + dy : undefined,
          cp2x: initial.cp2x !== undefined ? initial.cp2x + dx : undefined,
          cp2y: initial.cp2y !== undefined ? initial.cp2y + dy : undefined,
        }
        // Update local state for instant feedback, DB update on mouseup
        setLocalShapePoints(prev => ({ ...prev, [activeSelectedTraceId]: newPoints }))
      }
    } else if (activeTransformMode === 'control-in' || activeTransformMode === 'control-out') {
      // A curve handle dragged. The point's other handle turns with it, in
      // line through the point at its own length (an aligned node), so the
      // curve stays smooth there; with Alt it's left where it is, for a
      // corner. Both are set from then on.
      const pointIndex = parseInt(startPosRef.current.corner)
      if (isNaN(pointIndex)) return

      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom

      const currentPoints: PathPoint[] = currentLocalShapePoints[activeSelectedTraceId] || currentTrace.shapePoints || []
      const newPoints = [...currentPoints]
      const point = currentPoints[pointIndex]
      if (point) {
        const inward = activeTransformMode === 'control-in'
        // Where both handles were when the drag began: as set, or where an
        // unset one is drawn (handlesAt).
        if (startPosRef.current.initialCpx === undefined) {
          const { cp1, cp2 } = handlesAt(currentPoints, pointIndex)
          const [moved, other] = inward ? [cp1, cp2] : [cp2, cp1]
          startPosRef.current.initialCpx = moved.x
          startPosRef.current.initialCpy = moved.y
          startPosRef.current.initialOther = other
        }
        const moved = { x: startPosRef.current.initialCpx + worldDeltaX, y: (startPosRef.current.initialCpy ?? 0) + worldDeltaY }
        const startOther = startPosRef.current.initialOther ?? moved
        const other = e.altKey ? startOther : alignedHandle(point, moved, startOther)
        const [cp1, cp2] = inward ? [moved, other] : [other, moved]
        newPoints[pointIndex] = { ...point, cp1x: cp1.x, cp1y: cp1.y, cp2x: cp2.x, cp2y: cp2.y }
        // Update local state for instant feedback, DB update on mouseup
        setLocalShapePoints(prev => ({ ...prev, [activeSelectedTraceId]: newPoints }))
      }
    } else if (activeTransformMode === 'move-path') {
      // Move all points of a path shape together -- once the press is a
      // drag: a click on the line only selects it.
      if (!pressMovedRef.current) return
      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom
      
      // Use local points if available (during drag), otherwise use currentTrace points
      const currentPoints = currentLocalShapePoints[activeSelectedTraceId] || currentTrace.shapePoints || []
      
      // Store initial points if not already stored
      const initialPoints = startPosRef.current.initialPoints ?? currentPoints.map((p: any) => ({ ...p }))
      startPosRef.current.initialPoints = initialPoints
      
      const newPoints = initialPoints.map((p: any) => ({
        x: p.x + worldDeltaX,
        y: p.y + worldDeltaY,
        cp1x: p.cp1x !== undefined ? p.cp1x + worldDeltaX : undefined,
        cp1y: p.cp1y !== undefined ? p.cp1y + worldDeltaY : undefined,
        cp2x: p.cp2x !== undefined ? p.cp2x + worldDeltaX : undefined,
        cp2y: p.cp2y !== undefined ? p.cp2y + worldDeltaY : undefined,
      }))
      
      // Update local state for instant feedback, DB update on mouseup
      setLocalShapePoints(prev => ({ ...prev, [activeSelectedTraceId]: newPoints }))
      
      // Also move other multi-selected traces
      const currentMultiSelected = multiSelectedIdsRef.current
      if (currentMultiSelected.size > 0) {
        currentMultiSelected.forEach(id => {
          if (id === activeSelectedTraceId) return // Already handled above
          const t = tracesRef.current.find(tr => tr.id === id)
          if (!t) return
          
          // For path shapes, move all points
          if (t.type === 'shape' && t.shapeType === 'path') {
            const startPoints = multiStartPathPointsRef.current[id]
            if (startPoints) {
              const newPathPoints = startPoints.map(p => ({
                x: p.x + worldDeltaX,
                y: p.y + worldDeltaY,
                cp1x: p.cp1x !== undefined ? p.cp1x + worldDeltaX : undefined,
                cp1y: p.cp1y !== undefined ? p.cp1y + worldDeltaY : undefined,
                cp2x: p.cp2x !== undefined ? p.cp2x + worldDeltaX : undefined,
                cp2y: p.cp2y !== undefined ? p.cp2y + worldDeltaY : undefined,
              }))
              setLocalShapePoints(prev => ({ ...prev, [id]: newPathPoints }))
              // skipUndo -- batched into ONE undo step on mouseup, see the
              // primary path's own shapePoints commit there too.
              updateTraceCustomization(id, { shapePoints: newPathPoints }, { skipUndo: true })
            }
          } else {
            // For non-path traces, move by transform
            const startPos = multiStartTransformsRef.current[id]
            if (startPos) {
              updateTraceTransform(id, {
                x: startPos.x + worldDeltaX,
                y: startPos.y + worldDeltaY,
              }, { skipUndo: true })
            }
          }
        })
      }
    }
  }

  const handleMouseUp = async () => {
    const activeTransformMode = transformModeRef.current
    const activeSelectedTraceId = selectedTraceIdRef.current
    const dragged = justDraggedRef.current
    transformModeRef.current = 'none'
    // What was being moved, taken now: the refs that say so are cleared below.
    const carried = isMultiDragActiveRef.current ? Object.keys(multiStartTransformsRef.current) : activeSelectedTraceId ? [activeSelectedTraceId] : []
    // Let go over the Layer panel: the traces are already back where they
    // started, and the panel places them in its list. Nothing is thrown.
    const releasedInPanel = inPanelRef.current
    inPanelRef.current = false
    if (releasedInPanel) {
      const at = lastPointerRef.current
      if (at) panelDrop.current?.drop(carried, at.x, at.y)
      else panelDrop.current?.leave()
    }
    const thrown = activeTransformMode === 'move' && !releasedInPanel ? carried : []
    // Let go: it settles onto where the trace now is, and its handles come
    // back once it has; with no settling to wait for, now.
    if (dragFeelRef.current) dragFeelRef.current.held = false
    else endMoving()

    // Cleared unconditionally: this runs before every early return below, so
    // the badge can't outlive its drag.
    setRotationReadout(null)
    // Same for the alignment guides -- they describe a drag in progress, and
    // there is no longer one.
    setAlignGuides(null)

    // Remove dragging class from body
    document.body.classList.remove('dragging')

    // Cleared after the click event, not during mouseup.
    //
    // click fires after mouseup, and it's the click handler that decides
    // whether to follow the link and deselect. Clearing here directly would
    // un-suppress the handles in between, which can paint a frame of the
    // transform frame before the click removes it again -- exactly the flash
    // the suppression exists to prevent. A zero-delay timeout lands after the
    // click, and the guard keeps it from clobbering a newer press.
    if (pressedClickableIdRef.current) {
      const releasedId = pressedClickableIdRef.current
      setTimeout(() => {
        if (pressedClickableIdRef.current !== releasedId) return
        pressedClickableIdRef.current = null
        setPressedClickableId(null)
      }, 0)
    }
    
    // Let go of a path's point: any border it was snapped to is let go too.
    showBorderSnap(null)
    // A click, not a drag, on a path's point. On an end point, clicks on the
    // canvas add points beyond that end from then on -- or, already adding
    // there, it's done. On any other, adding is done.
    if (activeTransformMode === 'point' && !pressMovedRef.current && activeSelectedTraceId && canEdit) {
      const index = parseInt(startPosRef.current.corner)
      const trace = tracesRef.current.find(t => t.id === activeSelectedTraceId)
      const points = localShapePointsRef.current[activeSelectedTraceId] || trace?.shapePoints || []
      const end = points.length < 2 ? null : index === 0 ? 'start' : index === points.length - 1 ? 'end' : null
      if (end && !(pathCreationModeRef.current && pathAddAtRef.current === end)) {
        setPathAddAt(end)
        addPointsTo(activeSelectedTraceId)
      } else if (points.length >= 2) {
        setPathCreationMode(false)
      }
    }

    // Pressed on a trace of a selected group and let go without moving it:
    // the second click, which picks that trace out of its group.
    const pickedFromGroup = groupClickRef.current
    groupClickRef.current = null
    if (pickedFromGroup && activeTransformMode === 'move' && !justDraggedRef.current) {
      setMultiSelectedIds(new Set())
      setSelectedTraceId(pickedFromGroup)
    }

    // If we actually dragged, prevent immediate deselection
    if (justDraggedRef.current) {
      // Clear the flag after a short delay (longer than click event)
      setTimeout(() => {
        justDraggedRef.current = false
      }, 100)
    }
    
    // Use refs to get latest values (avoid stale closures)
    const currentLocalShapePoints = localShapePointsRef.current
    const currentTraces = tracesRef.current
    const currentEditingTrace = editingTraceRef.current
    
    // Save local shape points to database if any
    if (activeSelectedTraceId && currentLocalShapePoints[activeSelectedTraceId]) {
      const pointsToSave = currentLocalShapePoints[activeSelectedTraceId]
      const trace = currentTraces.find(t => t.id === activeSelectedTraceId)
      
      // Update editingTrace immediately so it has the latest data
      if (trace) {
        if (currentEditingTrace && currentEditingTrace.id === activeSelectedTraceId) {
          setEditingTrace({ ...currentEditingTrace, shapePoints: pointsToSave })
        }
        // Don't create a new editingTrace here - that would open the customize panel
        // The panel should only open via right-click > Customize or double-click
      }
      
      // Update database -- skip its own undo push when this was part of a
      // multi-select batch drag; it's folded into the single batch op below instead.
      await updateTraceCustomization(activeSelectedTraceId, { shapePoints: pointsToSave }, { skipUndo: isMultiDragActiveRef.current })

      // Clear local state after saving so new points can be added without interference
      setLocalShapePoints(prev => {
        const next = { ...prev }
        delete next[activeSelectedTraceId]
        return next
      })
    }

    // If this drag moved a multi-selection together, record the whole move
    // as ONE undo step -- every per-trace update above was pushed with
    // skipUndo so it wouldn't get recorded piecemeal (or, for paths, dozens
    // of times per drag; see the 'batch' UndoOp comment).
    if (isMultiDragActiveRef.current && (activeTransformMode === 'move' || activeTransformMode === 'move-path')) {
      const batchOps: { traceId: string; before: Partial<Trace>; after: Partial<Trace> }[] = []
      for (const id of Object.keys(multiStartTransformsRef.current)) {
        const finalTrace = currentTraces.find(t => t.id === id)
        if (!finalTrace) continue
        const startPoints = multiStartPathPointsRef.current[id]
        if (startPoints) {
          batchOps.push({ traceId: id, before: { shapePoints: startPoints }, after: { shapePoints: finalTrace.shapePoints } })
        } else {
          const startPos = multiStartTransformsRef.current[id]
          batchOps.push({ traceId: id, before: { x: startPos.x, y: startPos.y }, after: { x: finalTrace.x, y: finalTrace.y } })
        }
      }
      pushBatchUpdateOp(batchOps)
    }

    // Same one-step-per-drag treatment for a group scale/rotate: every
    // per-trace update during the drag was pushed with skipUndo.
    if (activeTransformMode === 'group-scale' || activeTransformMode === 'group-rotate') {
      const batchOps: { traceId: string; before: Partial<Trace>; after: Partial<Trace> }[] = []
      for (const [id, start] of Object.entries(groupStartRef.current.traces)) {
        const finalTrace = currentTraces.find(t => t.id === id)
        if (!finalTrace) continue
        if (start.shapePoints) {
          const finalPoints = currentLocalShapePoints[id] || finalTrace.shapePoints
          batchOps.push({ traceId: id, before: { shapePoints: start.shapePoints }, after: { shapePoints: finalPoints } })
          if (currentLocalShapePoints[id]) {
            await updateTraceCustomization(id, { shapePoints: currentLocalShapePoints[id] }, { skipUndo: true })
          }
        } else {
          batchOps.push({
            traceId: id,
            before: { x: start.x, y: start.y, scaleX: start.scaleX, scaleY: start.scaleY, rotation: start.rotation },
            after: { x: finalTrace.x, y: finalTrace.y, scaleX: finalTrace.scaleX, scaleY: finalTrace.scaleY, rotation: finalTrace.rotation },
          })
        }
      }
      pushBatchUpdateOp(batchOps)
      setLocalShapePoints(prev => {
        const next = { ...prev }
        for (const id of Object.keys(groupStartRef.current.traces)) delete next[id]
        return next
      })
      groupStartRef.current = { center: { x: 0, y: 0 }, bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, traces: {} }
    }

    isMultiDragActiveRef.current = false
    multiStartTransformsRef.current = {}
    multiStartPathPointsRef.current = {}

    // Clear initial point/control point references
    if (startPosRef.current.initialPoint) {
      startPosRef.current.initialPoint = undefined
    }
    if (startPosRef.current.initialCpx !== undefined) {
      startPosRef.current.initialCpx = undefined
      startPosRef.current.initialCpy = undefined
      startPosRef.current.initialOther = undefined
    }
    if (startPosRef.current.initialPoints) {
      startPosRef.current.initialPoints = undefined
    }
    
    // Reset cursor state when done dragging
    setCursorState('default')
    
    // If in crop mode, clear transform mode but keep isCropMode active for more adjustments
    // For point/control editing, keep the trace selected but clear transform mode
    // This allows clicking on control handles after dragging a point
    if (activeTransformMode === 'crop') {
      setTransformMode('none')
      // isCropMode stays true so crop handles remain visible
    } else if (activeTransformMode !== 'point' && activeTransformMode !== 'control-in' && activeTransformMode !== 'control-out' && activeTransformMode !== 'move-path') {
      setTransformMode('none')
    } else if (activeTransformMode === 'point' || activeTransformMode === 'control-in' || activeTransformMode === 'control-out' || activeTransformMode === 'move-path') {
      // For path point editing, keep the point selected but clear transform mode
      // This allows clicking control handles after dragging
      setTransformMode('none')
      // Note: selectedPointIndex remains set so control handles stay visible
    }

    // Where what moved belongs now, frame-wise (lib/frames), once it's at
    // rest: where a glide ends, or here. After the move's undo entry exists,
    // so the glide can finish it and the frames fold into it.
    const settle = () => {
      if (activeTransformMode === 'move' && dragged && !releasedInPanel) settleInFrames(carried)
      else if (activeTransformMode === 'scale' && dragged && activeSelectedTraceId) settleFrameResize(activeSelectedTraceId)
    }
    if (!(thrown.length > 0 && startGlide(thrown, settle))) settle()
  }

  // A press held that began on a trace, and each letting go of one: the
  // Customization panel opens on the release (below) -- of a click only. A
  // press that moved was a drag, and the panel stays as it was for that
  // selection (draggedKeyRef) until a click on it.
  const pressHeldRef = useRef(false)
  const pressAtRef = useRef<{ x: number; y: number } | null>(null)
  const draggedKeyRef = useRef<string | null>(null)
  const [releaseTick, setReleaseTick] = useState(0)
  // Where the press now under way began (handleClickOutside). In the
  // capture phase, ahead of anything the press might change.
  const pressTargetRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const note = (e: MouseEvent) => {
      pressTargetRef.current = e.target as HTMLElement | null
      if (e.button === 0) {
        pressHeldRef.current = !!(e.target as HTMLElement | null)?.closest?.('[data-trace-element="true"]')
        pressAtRef.current = { x: e.clientX, y: e.clientY }
      }
    }
    const letGo = (e: MouseEvent) => {
      if (!pressHeldRef.current) return
      pressHeldRef.current = false
      const from = pressAtRef.current
      draggedKeyRef.current = from && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4 ? selectionKey() : null
      setReleaseTick(n => n + 1)
    }
    window.addEventListener('mousedown', note, true)
    window.addEventListener('mouseup', letGo, true)
    return () => {
      window.removeEventListener('mousedown', note, true)
      window.removeEventListener('mouseup', letGo, true)
    }
  }, [])

  // Click outside to deselect
  useEffect(() => {
    // On a trace -- or, while a path's points are being added, on that path
    // alone (its line, its handles): every other trace is only where the
    // next point goes.
    const onTrace = (el: HTMLElement | null) => {
      if (!el?.closest) return false
      if (!pathCreationMode) return !!el.closest('[data-trace-element="true"]')
      const owner = el.closest('[data-path-of]')?.getAttribute('data-path-of') ?? el.closest('[data-trace-id]')?.getAttribute('data-trace-id')
      return owner === pathIdRef.current
    }
    const handleClickOutside = (e: MouseEvent) => {
      // If a trace element was clicked, don't deselect
      const target = e.target as HTMLElement
      if (onTrace(target)) {
        return
      }
      // Nor if the press began on one. A press can put something new under
      // the pointer -- selecting a path shows its handles, one of them maybe
      // right there -- and a click that starts on one element and ends on
      // another goes to what they share, which is no trace at all.
      if (onTrace(pressTargetRef.current)) {
        return
      }
      
      // Don't deselect if we just finished dragging
      if (justDraggedRef.current) {
        return
      }

      // Don't deselect if this click is the tail end of a click+drag (e.g.
      // panning the map) -- only a genuine, near-stationary click should
      // clear the multi-selection.
      const downPos = mouseDownScreenPosRef.current
      if (downPos) {
        const dragDistance = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
        if (dragDistance > 6) {
          return
        }
      }

      // CRITICAL: If in path creation mode, prevent ANY deselection
      if (pathCreationMode) {
        const target = e.target as HTMLElement
        
        // If clicking on UI elements, just ignore the click
        if (target.closest('.layer-panel') ||
            target.closest('[role="dialog"]') ||
            target.closest('.customize-menu') ||
            target.closest('button') ||
            target.closest('select') ||
            target.closest('input')) {
          return
        }
        
        // Add new point at click location
        // Use editingTrace first if available (has latest local changes), then fall back to trace from store
        if (selectedTraceId) {
          const trace = traces.find(t => t.id === selectedTraceId)
          
          if (trace && trace.shapeType === 'path') {
            let at = { x: (e.clientX - worldOffset.x) / zoom, y: (e.clientY - worldOffset.y) / zoom }
            // Shift, over another trace: onto its border, as a dragged point.
            const snap = e.shiftKey ? borderSnapAt(at, zoom) : null
            if (snap) at = snap.at

            // Use editingTrace's points if available (most up-to-date), otherwise use trace's points
            const sourceTrace = (editingTrace && editingTrace.id === selectedTraceId) ? editingTrace : trace
            const currentPoints = sourceTrace.shapePoints || []
            // Beyond whichever end is being added to; the new point is that
            // end now, and selected, so Delete takes it back.
            const atStart = pathAddAt === 'start' && currentPoints.length > 0
            const newPoints = atStart ? [at, ...currentPoints] : [...currentPoints, at]
            setSelectedPointIndex(atStart ? 0 : newPoints.length - 1)

            // The Customize panel follows along when it's open on this path;
            // it isn't opened for it.
            if (editingTrace && editingTrace.id === selectedTraceId) setEditingTrace({ ...trace, shapePoints: newPoints })
            updateTraceCustomization(selectedTraceId, { shapePoints: newPoints })
          }
        }
        
        // IMPORTANT: Always return when in creation mode - never deselect
        return
      }
      
      // Normal click outside behavior - only when NOT in creation mode
      const clickTarget = e.target as HTMLElement
      if (!clickTarget.closest('[data-trace-element]') && 
          !clickTarget.closest('.layer-panel') &&
          !clickTarget.closest('[role="dialog"]') &&
          !clickTarget.closest('.customize-menu') &&
          !clickTarget.closest('button') &&
          !clickTarget.closest('select') &&
          !clickTarget.closest('input')) {
        // If in crop mode, just exit crop (apply it) without deselecting
        if (isCropMode) {
          setIsCropMode(false)
          setTransformMode('none')
          return
        }
        setSelectedTraceId(null)
        setMultiSelectedIds(new Set()) // Clear multi-selection when clicking outside
        setTransformMode('none')
        setIsCropMode(false)
      }
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete key to delete the whole multi-selection if there is one,
      // otherwise just the single selected trace. Must not fire while the
      // user is editing text inside an input/textarea (e.g. the Customize
      // panel's text content field) -- otherwise pressing Delete to remove
      // a character deletes the entire trace instead.
      const target = e.target as HTMLElement | null
      const typingHere = isEditableTarget(target)
      if (connectFromRef.current && e.key === 'Escape') {
        setConnectFrom(null)
        setConnectPointer(null)
        return
      }
      // Ctrl+Alt+C / Ctrl+Alt+V: Copy Style from the selected trace, Paste
      // Style on the selection, as in Excalidraw. By the key's place, not its
      // character: Alt changes the character on some layouts.
      if ((e.ctrlKey || e.metaKey) && e.altKey && !typingHere && !isDrawingModeRef.current && (e.code === 'KeyC' || e.code === 'KeyV')) {
        const selection = multiSelectedIds.size > 0 ? [...multiSelectedIds] : selectedTraceId ? [selectedTraceId] : []
        if (selection.length === 0) return
        e.preventDefault()
        if (e.code === 'KeyC') copyTraceStyle(selectedTraceId ?? selection[0])
        else pasteTraceStyle(selection)
        return
      }
      // Connections alone go here; with traces selected too, they go with
      // the traces below, as one undo step.
      if (selectedLinksRef.current.size > 0 && (e.key === 'Delete' || e.key === 'Backspace') && !typingHere && canEdit
        && !selectedTraceId && multiSelectedIds.size === 0) {
        e.preventDefault()
        deleteLinks(selectedLinksRef.current)
        return
      }
      // Backspace as well as Delete, because on a Mac keyboard the key marked
      // "delete" IS Backspace -- most of them have no Delete key at all, so the
      // shortcut simply did not exist there.
      //
      // Worse than not existing: WebKit still treats an unhandled Backspace
      // outside a text field as "go back", and every route here is a hash, so
      // it left the atrium -- going nowhere near the leave path, which is why
      // nothing asked about saving first. Prevented whether or not there is
      // anything selected to delete, because the navigation is wrong either
      // way.
      const isDeleteKey = e.key === 'Delete' || e.key === 'Backspace'
      // A path's point selected: that point goes, and the path stays -- while
      // it has more than two. With two, the path goes as it would unselected.
      const pointIndex = selectedPointIndexRef.current
      const pathOfPoint = pointIndex !== null && selectedTraceId && multiSelectedIds.size === 0
        ? traces.find(t => t.id === selectedTraceId && isPathTrace(t))
        : undefined
      if (isDeleteKey && !typingHere && !isDrawingModeRef.current && canEdit && pathOfPoint && pointIndex !== null && (pathOfPoint.shapePoints?.length ?? 0) > 2) {
        e.preventDefault()
        const points = pathOfPoint.shapePoints!.filter((_, i) => i !== pointIndex)
        if (editingTrace && editingTrace.id === pathOfPoint.id) setEditingTrace({ ...editingTrace, shapePoints: points })
        updateTraceCustomization(pathOfPoint.id, { shapePoints: points })
        // The one before it is selected next (the new first, for the first),
        // so points can be taken back one after another.
        setSelectedPointIndex(Math.max(0, pointIndex - 1))
        return
      }
      if (isDeleteKey && !typingHere) {
        if (e.key === 'Backspace') e.preventDefault()
        if (!isDrawingModeRef.current && canEdit && (selectedTraceId || multiSelectedIds.size > 0)) {
          e.preventDefault()
          deleteTraces(multiSelectedIds.size > 0 ? Array.from(multiSelectedIds) : [selectedTraceId!], [...selectedLinksRef.current])
        }
      }

      // Ctrl+Shift+G: out of their groups -- a whole group selected is
      // undone, a few of its traces are taken out of it (ungroupSelection).
      if ((e.key === 'g' || e.key === 'G') && (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && !typingHere && !e.repeat && !isDrawingModeRef.current && canEdit) {
        const ids = multiSelectedIds.size > 0 ? Array.from(multiSelectedIds) : selectedTraceId ? [selectedTraceId] : []
        e.preventDefault()
        void ungroupSelection(ids)
        return
      }
      // Ctrl+G (Cmd+G): group the selection. Also keeps the webview's own
      // Ctrl+G, find-next, from opening over the atrium.
      if ((e.key === 'g' || e.key === 'G') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !typingHere && !e.repeat && !isDrawingModeRef.current && canEdit) {
        const ids = multiSelectedIds.size > 0 ? Array.from(multiSelectedIds) : selectedTraceId ? [selectedTraceId] : []
        if (ids.length > 0) {
          e.preventDefault()
          void groupSelection(ids)
          return
        }
      }

      // G: select the selected trace's whole group -- exactly the right-click
      // menu's Select > Select group, anchored on the same trace. A trace in
      // no group has none to select. No modifier,
      // so Ctrl+G and the like stay the browser's, and a held key does no more
      // than a pressed one.
      if ((e.key === 'g' || e.key === 'G') && !typingHere && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !isDrawingModeRef.current) {
        const anchorId = selectedTraceId ?? (multiSelectedIds.size > 0 ? Array.from(multiSelectedIds)[0] : null)
        const anchor = anchorId ? traces.find(t => t.id === anchorId) : undefined
        const groupId = anchor ? groupIdOf(anchor, layers) : null
        if (anchor && groupId) {
          e.preventDefault()
          setMultiSelectedIds(new Set(traces.filter(t => t.layerId === groupId).map(t => t.id)))
          setSelectedTraceId(anchor.id)
        }
      }
    }

    // Captured (not bubbled) so it's recorded even if some element's mousedown
    // handler elsewhere calls stopPropagation() before it would otherwise reach here.
    const handleMouseDownCapture = (e: MouseEvent) => {
      mouseDownScreenPosRef.current = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('click', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('mousedown', handleMouseDownCapture, true)
    return () => {
      window.removeEventListener('click', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('mousedown', handleMouseDownCapture, true)
    }
  }, [selectedTraceId, multiSelectedIds, pathCreationMode, pathAddAt, worldOffset, zoom, traces, editingTrace, isCropMode, canEdit, groupSelection])

  // Auto-pan while dragging a trace toward the edge of the screen, so a trace
  // can be moved somewhere that isn't currently in view without dropping it,
  // panning, and picking it up again.
  //
  // Only for the move modes. Scaling or rotating against an edge is a
  // deliberate gesture at a fixed spot, and panning under it would fight the
  // user rather than help.
  useEffect(() => {
    if (!onEdgePan) return
    if (transformMode !== 'move' && transformMode !== 'move-path') return

    let raf = 0
    const step = () => {
      raf = requestAnimationFrame(step)
      const pointer = lastPointerRef.current
      if (!pointer) return
      // Not while carried over the Layer panel, which sits against an edge.
      if (inPanelRef.current) return

      // Ramps from 0 at the inner boundary of the zone to 1 at the very edge,
      // so nudging into it drifts and pressing right up to it moves quickly --
      // a fixed speed either creeps or overshoots.
      const zone = EDGE_PAN_ZONE_PX
      let strengthX = 0
      let strengthY = 0
      if (pointer.x < zone) strengthX = -(zone - pointer.x) / zone
      else if (pointer.x > window.innerWidth - zone) strengthX = (pointer.x - (window.innerWidth - zone)) / zone
      if (pointer.y < zone) strengthY = -(zone - pointer.y) / zone
      else if (pointer.y > window.innerHeight - zone) strengthY = (pointer.y - (window.innerHeight - zone)) / zone

      if (strengthX === 0 && strengthY === 0) return

      const screenDx = Math.max(-1, Math.min(1, strengthX)) * EDGE_PAN_MAX_SPEED_PX
      const screenDy = Math.max(-1, Math.min(1, strengthY)) * EDGE_PAN_MAX_SPEED_PX
      const currentZoom = zoomRef.current || 1

      onEdgePan(screenDx / currentZoom, screenDy / currentZoom)

      // Keeps the trace under the cursor. The move math above is a screen
      // delta measured from where the drag started, so moving that origin by
      // the pan is exactly equivalent to the cursor having travelled that far
      // across the world -- no change to the transform code itself.
      startPosRef.current.x -= screenDx
      startPosRef.current.y -= screenDy

      // Re-applies the drag: without this the trace only moves when the mouse
      // does, so holding still at the edge would pan the camera out from under
      // a stationary trace.
      handleMouseMove({
        clientX: pointer.x,
        clientY: pointer.y,
        shiftKey: pointer.shiftKey,
      } as MouseEvent)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [transformMode, onEdgePan])

  useEffect(() => {
    if (transformMode !== 'none') {
      // Touch wrappers that forward to existing mouse handlers
      // One move handled per frame, with the newest position. A fast mouse
      // reports several moves a frame, and each re-rendered every trace, so
      // handling them all only dropped frames -- the hiccups in a drag. A
      // release applies the move still waiting first, so the trace lands
      // exactly where the pointer let go.
      let waiting: MouseEvent | null = null, frame = 0
      const onMove = (e: MouseEvent) => {
        waiting = e
        if (frame) return
        frame = requestAnimationFrame(() => {
          frame = 0
          const move = waiting
          waiting = null
          if (move) handleMouseMove(move)
        })
      }
      const onUp = () => {
        if (frame) { cancelAnimationFrame(frame); frame = 0 }
        const move = waiting
        waiting = null
        if (move) handleMouseMove(move)
        handleMouseUp()
      }
      const handleTouchMoveGlobal = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          e.preventDefault()
          const touch = e.touches[0]
          onMove({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent)
        }
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      window.addEventListener('touchmove', handleTouchMoveGlobal, { passive: false })
      window.addEventListener('touchend', onUp)
      return () => {
        if (frame) cancelAnimationFrame(frame)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        window.removeEventListener('touchmove', handleTouchMoveGlobal)
        window.removeEventListener('touchend', onUp)
      }
    }
  }, [transformMode, selectedTraceId])

  // The Customization panel follows the selection, as Excalidraw's properties
  // do: one trace selected, its own; several, Batch Edit's -- switching as the
  // selection does -- and gone when nothing is. So nothing has to be laid over
  // the screen to close it: a click on the canvas deselects, and that's all.
  // Closed with its X, it stays closed for that selection (dismissedRef) and
  // opens again for the next. Not on trace updates: while it's open,
  // editingTrace is the source of truth for the trace it shows.
  //
  // Opened when the press that selected is let go, not while it's held -- a
  // drag isn't a request for the panel (pressHeldRef, releaseTick). And only
  // with the preference on (User Preferences); off, Customize in the menu
  // opens it (requestedRef: what was asked for stays open).
  const dismissedRef = useRef<string | null>(null)
  const requestedRef = useRef<string | null>(null)
  const autoOpenCustomization = useGameStore(state => state.autoOpenCustomization)
  // A playing trace heard from where it is (User Preferences).
  useSpatialSound(useGameStore(state => state.spatialSound))
  const selectionKey = () => (multiSelectedIdsRef.current.size > 1 ? [...multiSelectedIdsRef.current].sort().join(',') : selectedTraceIdRef.current ?? '')
  useEffect(() => {
    if (!canEdit || pressHeldRef.current) return
    const editing = editingTraceRef.current
    const key = multiSelectedIds.size > 1 ? [...multiSelectedIds].sort().join(',') : selectedTraceId ?? ''
    if (!key) dismissedRef.current = null
    const wanted = autoOpenCustomization || key === requestedRef.current
    // Let go after a drag: the panel left as it was, one trace or several --
    // for as long as that's what's selected, not for good.
    if (key !== draggedKeyRef.current) draggedKeyRef.current = null
    if (key && key === draggedKeyRef.current) return
    if (multiSelectedIds.size > 1) {
      if (editing) setEditingTrace(null)
      setShowBatchEditPanel(wanted && key !== dismissedRef.current)
      return
    }
    setShowBatchEditPanel(false)
    if (!selectedTraceId) {
      if (editing) setEditingTrace(null)
      return
    }
    if (key === dismissedRef.current) return
    if (!wanted) {
      if (editing && editing.id !== selectedTraceId) setEditingTrace(null)
      return
    }
    if (editing?.id !== selectedTraceId) setEditingTrace(tracesRef.current.find(t => t.id === selectedTraceId) ?? null)
  }, [selectedTraceId, multiSelectedIds, canEdit, releaseTick, autoOpenCustomization])

  // Disable path creation mode when selection is cleared
  // Note: We don't check editingTrace here to avoid disabling mode when updating points
  useEffect(() => {
    if (!selectedTraceId) setPathCreationMode(false)
    // A point picked on one path is nothing on the next: left set, Delete
    // took a point off a path selected afresh rather than the path.
    setSelectedPointIndex(null)
  }, [selectedTraceId])
  // Adding points is back to the end each time it stops, as drawing a new
  // path expects; the pointer it followed is forgotten.
  useEffect(() => {
    if (pathCreationMode) return
    setPathAddAt('end')
    setPathPointer(null)
  }, [pathCreationMode])
  // While adding points, the pointer is followed, for the dashed run to it.
  useEffect(() => {
    if (!pathCreationMode) return
    const move = (e: PointerEvent) => setPathPointer({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [pathCreationMode])

  // Its base size (lib/traceGeometry), a picture's or video's from the natural
  // size measured as it loaded.
  const getTraceSize = useCallback((trace: Trace) => baseSizeOf(trace, imageDimensions[trace.id]), [imageDimensions])

  // The axis-aligned box a trace occupies in world units.
  //
  // Rotation is deliberately ignored. Aligning to the corners of a rotated
  // box means aligning to its bounding box, which is not where the trace
  // looks like it ends -- the eye lines things up against the edges it can
  // see. A rotated trace is aligned by its centre, which is the one point
  // rotation does not move.
  const traceBoxFor = useCallback((trace: Trace, at?: { x: number; y: number }, _zoom = 1, stored = false) => {
    // Its box in the world, border included (lib/traceGeometry traceBox) -- a
    // path's from its points, which are what moves when one is edited, while
    // its x/y/width/height stay as they were made. `stored`: as the store
    // holds it, not as it's drawn -- for a drag's own handlers, which see
    // what is drawn as it was when the drag began.
    const box = traceBox(trace, getTraceSize(trace), stored ? storedTransformOf(trace) : getTraceTransform(trace))
    return {
      cx: at?.x ?? box.cx,
      cy: at?.y ?? box.cy,
      halfW: box.halfW,
      halfH: box.halfH,
      rotated: (trace.rotation ?? 0) % 360 !== 0,
    }
  }, [getTraceSize, getTraceTransform])

  // Where a path's point goes, dragged with Shift over another trace: onto
  // that trace's border (lib/pathGeometry) -- its nearest point, or a corner
  // or a side's middle when near one. The trace is the topmost drawn one
  // under the pointer, or within a few pixels of it; paths aren't taken,
  // the one being edited among them.
  const borderSnapAt = (pointer: { x: number; y: number }, zoomNow: number): { box: TurnedBox; at: { x: number; y: number } } | null => {
    const grip = 12 / zoomNow
    let best: { box: TurnedBox; z: number } | null = null
    for (const t of visibleTracesRef.current) {
      if (isPathTrace(t) || hiddenTraceIds?.has(t.id)) continue
      const b = traceBoxFor(t)
      const box: TurnedBox = {
        cx: b.cx, cy: b.cy, halfW: b.halfW, halfH: b.halfH,
        rotation: getTraceTransform(t).rotation ?? 0,
        round: t.type === 'shape' && t.shapeType === 'circle',
      }
      if (!boxHolds(box, pointer, grip)) continue
      const z = zOf(t)
      if (!best || z > best.z) best = { box, z }
    }
    return best ? { box: best.box, at: snapToBorder(best.box, pointer, grip) } : null
  }
  const showBorderSnap = (next: { box: TurnedBox; at: { x: number; y: number } } | null) => {
    const prev = borderSnapRef.current
    if (prev === next || (prev && next && prev.at.x === next.at.x && prev.at.y === next.at.y && prev.box.cx === next.box.cx && prev.box.cy === next.box.cy)) return
    borderSnapRef.current = next
    setBorderSnap(next)
  }

  // ---- Frames (lib/frames) -------------------------------------------------

  // Boxes as the store holds them now (traceBoxFor's `stored`): these run in a
  // drag's own handlers, and after it.
  const storedBox = (trace: Trace): FrameBox => traceBoxFor(trace, undefined, 1, true)
  const framesNow = (all: Trace[]) => all.filter(isFrame).map(f => ({ id: f.id, box: storedBox(f) }))
  const groupIdsNow = () => new Set(useGameStore.getState().layers.map(l => l.id))

  // Changes added to the undo step just recorded, so one Ctrl+Z takes them
  // back with it: the frame a moved trace ends up in, with the move.
  const foldIntoLastUndo = (ops: { traceId: string; before: Partial<Trace>; after: Partial<Trace> }[]) => {
    if (ops.length === 0) return
    const stack = undoStackRef.current
    const last = stack[stack.length - 1]
    if (last?.kind === 'update' && ops.every(op => op.traceId === last.traceId)) {
      for (const op of ops) {
        last.before = { ...op.before, ...last.before }
        last.after = { ...last.after, ...op.after }
      }
      return
    }
    if (last?.kind !== 'update' && last?.kind !== 'batch') {
      pushBatchUpdateOp(ops)
      return
    }
    const all = last.kind === 'batch' ? last.ops : [{ traceId: last.traceId, before: last.before, after: last.after }]
    for (const op of ops) {
      const same = all.find(o => o.traceId === op.traceId)
      if (same) {
        same.before = { ...op.before, ...same.before }
        same.after = { ...same.after, ...op.after }
      } else {
        all.push(op)
      }
    }
    stack[stack.length - 1] = { kind: 'batch', ops: all, ts: Date.now() }
  }

  // Traces' frames written to the store as it is now, and queued to save.
  // Folded into the last undo step, or, for a frame just made -- whose undo
  // takes the frame itself away -- into none.
  const applyFrameChanges = (changes: Map<string, string | null>, undo: 'fold' | 'none') => {
    const ops: { traceId: string; before: Partial<Trace>; after: Partial<Trace> }[] = []
    for (const [id, frameId] of changes) {
      const live = useGameStore.getState().traces.find(t => t.id === id)
      if (!live) continue
      ops.push({ traceId: id, before: { frameId: live.frameId ?? null }, after: { frameId } })
      addTrace({ ...live, frameId })
      markTraceChanged(id)
    }
    if (undo === 'fold') foldIntoLastUndo(ops)
  }

  // Put down after a move: what was moved belongs to the frame its middle is
  // in now -- a group by the middle of all of it -- and what a frame carried
  // stays in the frame that carried it.
  const settleInFrames = (movedIds: string[]) => {
    const all = useGameStore.getState().traces
    const moved = all.filter(t => movedIds.includes(t.id))
    const movedFrames = new Set(moved.filter(isFrame).map(f => f.id))
    const loose = new Set(moved.filter(t => !isFrame(t) && !(t.frameId && movedFrames.has(t.frameId))).map(t => t.id))
    if (loose.size === 0) return
    applyFrameChanges(placeUnits(unitsOf(all, groupIdsNow(), loose), framesNow(all), storedBox), 'fold')
  }

  // A frame resized: what it no longer covers leaves it, and what lies loose
  // in it now -- in no frame -- joins it.
  const settleFrameResize = (frameId: string) => {
    const all = useGameStore.getState().traces
    const frames = framesNow(all)
    const frame = frames.find(f => f.id === frameId)
    if (!frame) return
    const known = new Set(frames.map(f => f.id))
    const units = unitsOf(all, groupIdsNow()).filter(unit => {
      const current = unit[0].frameId && known.has(unit[0].frameId) ? unit[0].frameId : null
      if (current) return current === frameId
      const middle = unitMiddle(unit, storedBox)
      return boxContains(frame.box, middle.x, middle.y)
    })
    applyFrameChanges(placeUnits(units, frames, storedBox), 'fold')
  }

  // A new frame over `box`, named Frame N, drawn under everything (the bottom
  // of the stack) so what it holds is over it. It takes in the
  // traces in `wrap`, whole groups with them, from whatever frame they were
  // in; without `wrap`, what lies loose inside it. Then it's selected.
  const createFrame = async (box: FrameBox, wrap?: string[], customize = false) => {
    if (!lobbyId || !canEdit) return
    if (useGameStore.getState().isLobbyFull()) {
      showToast(lobbyFullMessage())
      return
    }
    const store = useGameStore.getState()
    const groups = new Set(store.layers.map(l => l.id))
    const stack = topLevel(store.traces, store.layers)
    const name = firstFreeName(store.traces.filter(isFrame).map(f => f.content), n => t('atrium.frame.numbered', { n }))
    // Under everything, so what it holds is drawn over it.
    const draft = newFrame(box, name, { userId, username }, currentTracePreset(lobbyId), keyAt(stack, 0) ?? keysOnTop(stack)[0])
    // There at once (lib/traceWrites), written behind.
    const frame = insertTrace(buildTraceInsertRow(draft, userId, username, lobbyId, 0, 0), message => showToast(t('atrium.error.frameFailed', { message })))
    const all = useGameStore.getState().traces
    const units = wrap
      ? unitsOf(all, groups, new Set(wrap))
      : unitsOf(all, groups).filter(unit => {
          if (unit.some(tr => tr.frameId && all.some(f => f.id === tr.frameId))) return false
          const middle = unitMiddle(unit, storedBox)
          return boxContains(box, middle.x, middle.y)
        })
    applyFrameChanges(putInFrame(units, frame.id), 'none')
    setMultiSelectedIds(new Set())
    setSelectedTraceId(frame.id)
    if (customize) setEditingTrace(frame)
  }

  // The selection in a frame of its own, just big enough to hold it.
  const wrapInFrame = (ids: string[]) => {
    const traces = unitsOf(useGameStore.getState().traces, groupIdsNow(), new Set(ids)).flat()
    if (traces.length === 0) return
    void createFrame(frameAround(traces.map(storedBox), FRAME_PADDING), traces.map(tr => tr.id))
  }

  // A frame's title, as typed. Left as it was if emptied.
  const renameFrame = (id: string, name: string) => {
    const live = useGameStore.getState().traces.find(tr => tr.id === id)
    const trimmed = name.trim()
    if (!live || !trimmed || trimmed === live.content) return
    updateTraceCustomization(id, { content: trimmed })
  }

  // A frame asked for from the canvas menu, at the point it was opened on,
  // or dragged out with the quick bar.
  useEffect(() => {
    if (!frameRequest) return
    // A click's frame at its usual size on screen, at any zoom.
    const { x, y, width = FRAME_DEFAULT.width / zoom, height = FRAME_DEFAULT.height / zoom, customize } = frameRequest
    void createFrame({ cx: x, cy: y, halfW: width / 2, halfH: height / 2 }, undefined, customize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRequest])

  // Finds the closest edge or centre alignment against the traces nearby.
  //
  // Six lines per box per axis -- the two edges and the middle -- so nine
  // pairings each way. Every one that lands within the threshold is a
  // candidate; the closest wins, and only one per axis. Allowing several on
  // the same axis would mean snapping to two positions at once, and allowing
  // none across both would rule out lining a corner up with a corner, which
  // is most of what this is for.
  //
  // The threshold arrives in screen pixels and is converted here, so it means
  // the same thing at every zoom.
  const findAlignment = useCallback((
    moving: { cx: number; cy: number; halfW: number; halfH: number; rotated: boolean },
    candidates: Trace[],
    zoom: number,
  ) => {
    const tolerance = ALIGN_SNAP_PX / zoom
    const reach = ALIGN_NEIGHBOURHOOD_PX / zoom

    // A rotated trace is aligned by its centre alone -- see traceBoxFor.
    const movingX: AlignEdge[] = moving.rotated
      ? [{ at: moving.cx, kind: 'middle' }]
      : [
          { at: moving.cx - moving.halfW, kind: 'start' },
          { at: moving.cx, kind: 'middle' },
          { at: moving.cx + moving.halfW, kind: 'end' },
        ]
    const movingY: AlignEdge[] = moving.rotated
      ? [{ at: moving.cy, kind: 'middle' }]
      : [
          { at: moving.cy - moving.halfH, kind: 'start' },
          { at: moving.cy, kind: 'middle' },
          { at: moving.cy + moving.halfH, kind: 'end' },
        ]

    let bestX: { delta: number; at: number; otherTop: number; otherBottom: number } | null = null
    let bestY: { delta: number; at: number; otherLeft: number; otherRight: number } | null = null

    for (const other of candidates) {
      const box = traceBoxFor(other, undefined, zoom)
      if (Math.abs(box.cx - moving.cx) > reach && Math.abs(box.cy - moving.cy) > reach) continue

      const otherX: number[] = box.rotated
        ? [box.cx]
        : [box.cx - box.halfW, box.cx, box.cx + box.halfW]
      const otherY: number[] = box.rotated
        ? [box.cy]
        : [box.cy - box.halfH, box.cy, box.cy + box.halfH]

      for (const mine of movingX) {
        for (const theirs of otherX) {
          const delta = theirs - mine.at
          if (Math.abs(delta) > tolerance) continue
          if (!bestX || Math.abs(delta) < Math.abs(bestX.delta)) {
            bestX = {
              delta,
              at: theirs,
              otherTop: box.cy - box.halfH,
              otherBottom: box.cy + box.halfH,
            }
          }
        }
      }

      for (const mine of movingY) {
        for (const theirs of otherY) {
          const delta = theirs - mine.at
          if (Math.abs(delta) > tolerance) continue
          if (!bestY || Math.abs(delta) < Math.abs(bestY.delta)) {
            bestY = {
              delta,
              at: theirs,
              otherLeft: box.cx - box.halfW,
              otherRight: box.cx + box.halfW,
            }
          }
        }
      }
    }

    return { bestX, bestY }
  }, [traceBoxFor])



  // World-space bounding box across a set of traces, used to place the
  // multi-select group handles and to derive the shared pivot they transform
  // around. Path shapes are measured from their points (their x/y only
  // records where they were last moved as a whole, not where the points
  // actually are); everything else from its rotated size box.
  // The groups selected whole, and the traces in them. A group selected is
  // shown as a group -- its outline -- not as every trace in it lit up; a
  // selection of loose traces still lights each one.
  const wholeGroups = useMemo(() => {
    const byGroup = new Map<string, string[]>()
    for (const trace of traces) {
      const group = groupIdOf(trace, layers)
      if (!group) continue
      const list = byGroup.get(group)
      if (list) list.push(trace.id)
      else byGroup.set(group, [trace.id])
    }
    const groups = new Map<string, string[]>()
    if (multiSelectedIds.size > 1) {
      for (const [group, members] of byGroup) if (members.every(id => multiSelectedIds.has(id))) groups.set(group, members)
    }
    return { groups, members: new Set([...groups.values()].flat()) }
  }, [traces, layers, multiSelectedIds])
  const inWholeGroup = wholeGroups.members

  const getGroupBounds = useCallback((ids: string[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const id of ids) {
      const trace = traces.find(t => t.id === id)
      if (!trace) continue
      const transform = localTraceTransforms[id] || getTraceTransform(trace)

      if (isPathTrace(trace)) {
        // No stroke here, unlike traceBoxFor. These bounds are the anchor a
        // group scale and rotate measure from, and growing the box by half a
        // stroke would move that anchor -- a different question from where a
        // selection outline is drawn.
        const box = pathWorldBounds(localShapePoints[id] || trace.shapePoints)
        if (box) {
          minX = Math.min(minX, box.minX); maxX = Math.max(maxX, box.maxX)
          minY = Math.min(minY, box.minY); maxY = Math.max(maxY, box.maxY)
          continue
        }
      }

      const { width, height } = getTraceSize(trace)
      const box = boundsOf({
        cx: transform.x, cy: transform.y,
        halfW: (width * transform.scaleX) / 2, halfH: (height * transform.scaleY) / 2,
        turn: (transform.rotation * Math.PI) / 180,
      })
      minX = Math.min(minX, box.minX); maxX = Math.max(maxX, box.maxX)
      minY = Math.min(minY, box.minY); maxY = Math.max(maxY, box.maxY)
    }

    if (!isFinite(minX)) return null
    return { minX, minY, maxX, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 }
  }, [traces, localTraceTransforms, localShapePoints, getTraceTransform, getTraceSize])

  const getTraceTypeLabel = useCallback((type: string) => {
    switch (type) {
      case 'text':
        return t('atrium.trace.type.text')
      case 'image':
        return t('atrium.trace.type.image')
      case 'audio':
        return t('atrium.trace.type.audio')
      case 'video':
        return t('atrium.controls.video')
      case 'embed':
        return t('atrium.trace.type.embed')
      case 'shape':
        return t('atrium.trace.type.shape')
      case 'frame':
        return t('atrium.trace.type.frame')
      default:
        return t('atrium.controls.trace')
    }
  }, [t])

  // Extract iframe src from HTML embed code or return URL as-is
  const extractEmbedUrl = useCallback((content: string): string | null => {
    // Only ever http(s) reaches an iframe's src.
    //
    // This is the last gate before user-supplied text becomes a live frame, and
    // it's deliberately here rather than at the point of creation: an embed's
    // content is written by anyone who can edit the atrium and read by everyone
    // who opens it, and traces already in the database have to pass through
    // this too. Validating on the way in would leave those unchecked.
    //
    // javascript: is the one that matters. A javascript: URL in an iframe src
    // runs in the embedder's origin, which here means access to the session in
    // local storage -- so a single embed trace in a shared atrium would be
    // account takeover for every viewer. data: is refused for the same reason
    // (browsers now block it in frames, but that shouldn't be what saves us),
    // and everything else exotic simply has no business being framed.
    const httpOnly = (candidate: string): string | null => {
      try {
        const parsed = new URL(candidate.trim(), window.location.href)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : null
      } catch {
        return null
      }
    }

    // A YouTube player with its API on, for spatial sound (withPlayerApi).
    const framed = (url: string | null) => (url && EMBED_NEEDS_RELAY ? throughRelay(withPlayerApi(url)) : url && withPlayerApi(url))

    // Check if it's HTML embed code (contains <iframe)
    if (content.includes('<iframe')) {
      const srcMatch = content.match(/src=["']([^"']+)["']/)
      if (srcMatch) {
        // Run through the converter too: pasting embed code with a share URL
        // inside it is a common enough mistake to be worth handling.
        return framed(httpOnly(toEmbedUrl(srcMatch[1])))
      }
      return null
    }
    // A plain URL -- YouTube, Google Drive, Docs and the rest are converted to
    // their embeddable form here (see lib/embedUrl). Done at render rather
    // than on save, so the trace keeps the link the user actually pasted and
    // embeds created before this start working without migrating anything.
    return framed(httpOnly(toEmbedUrl(content)))
  }, [])

  // Memoize visible traces to avoid recalculating on every render
  // Only show traces that are within the viewport (with some margin)
  const visibleTraces = React.useMemo(() => {
    const margin = CULL_MARGIN
    const viewportLeft = -worldOffset.x / zoom - margin
    const viewportTop = -worldOffset.y / zoom - margin
    const viewportRight = (window.innerWidth - worldOffset.x) / zoom + margin
    const viewportBottom = (window.innerHeight - worldOffset.y) / zoom + margin
    const buffer = 500 // Account for large traces

    return traces.filter(trace => {
      // Anything actually playing survives the cull, wherever it has got to.
      //
      // Culling here UNMOUNTS the trace, which tears the <video>/<audio>
      // element out of the DOM and stops it -- so scrolling away from a
      // playing video killed it mid-sentence, and a track being listened to
      // went silent as soon as its trace left the screen. The fade cull
      // further down already made this exception; this filter runs before it
      // ever gets the chance, so the exception never applied.
      //
      // Both stay rendered rather than merely audible: the fade still takes
      // the opacity to zero off-screen, so this costs an invisible element
      // that was going to be decoding anyway, and playback carries on where
      // whoever started it expects it to.
      if (playingMedia.has(trace.id)) return true

      // An embed gets the same treatment while interaction is switched on,
      // matching the fade cull. A cross-origin iframe reports nothing about
      // what it is doing -- there is no play or stop to listen for -- so the
      // toggle somebody deliberately turned on to use the thing is the only
      // signal available for "this may be mid-playback". It is opt-in per
      // trace, so this keeps a handful of embeds alive rather than all of
      // them.
      if (trace.type === 'embed' && trace.enableInteraction) return true

      // A path's x/y field is only set at creation and by whole-path moves --
      // dragging an individual point (or adding points while drawing) only
      // ever updates shapePoints, so x/y can drift arbitrarily far from
      // where the path is actually rendered. Checking the stale x/y against
      // the viewport could cull a path whose real on-screen points are still
      // fully visible (or keep one whose points are long gone off-screen),
      // which looked like paths randomly vanishing/reappearing across zoom
      // levels depending on how far that drift happened to be. Using the
      // actual bounding box of shapePoints instead is always accurate.
      if (trace.type === 'shape' && trace.shapeType === 'path' && trace.shapePoints && trace.shapePoints.length > 0) {
        const xs = trace.shapePoints.map(p => p.x)
        const ys = trace.shapePoints.map(p => p.y)
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        return maxX >= viewportLeft - buffer &&
               minX <= viewportRight + buffer &&
               maxY >= viewportTop - buffer &&
               minY <= viewportBottom + buffer
      }

      // The trace's own extent, not a fixed buffer.
      //
      // This compared the centre point against the viewport plus a flat 500px
      // allowance, which is only ever right by luck: a trace wider than that
      // has its centre leave the boundary while its body is still covering
      // the screen, and it blinks out in front of you. The bigger the trace
      // the worse it is, which is exactly backwards -- the traces most worth
      // keeping on screen are the ones most likely to vanish.
      //
      // Measuring from the nearest edge instead means a trace is dropped only
      // once the whole of it has left. The fade further down already worked
      // this way and carried a comment saying why; the filter that decides
      // whether to render at all never did, so a trace could be culled before
      // it had finished fading.
      //
      // Half-extents are in world units here (the viewport bounds above are
      // already divided by zoom), so scale applies but zoom does not. A
      // rotated trace uses its half-diagonal on both axes, which overstates
      // the reach slightly and is the safe direction to be wrong in.
      const { width: baseW, height: baseH } = getTraceSize(trace)
      const boxW = trace.type === 'shape' ? (trace.width || 200) : baseW * (trace.cropWidth ?? 1)
      const boxH = trace.type === 'shape' ? (trace.height || 200) : baseH * (trace.cropHeight ?? 1)
      let halfW = (boxW * (trace.scaleX ?? trace.scale ?? 1)) / 2
      let halfH = (boxH * (trace.scaleY ?? trace.scale ?? 1)) / 2
      if ((trace.rotation ?? 0) % 360 !== 0) {
        const halfDiag = Math.hypot(halfW, halfH)
        halfW = halfDiag
        halfH = halfDiag
      }

      return trace.x + halfW >= viewportLeft - buffer &&
             trace.x - halfW <= viewportRight + buffer &&
             trace.y + halfH >= viewportTop - buffer &&
             trace.y - halfH <= viewportBottom + buffer
    })
  }, [traces, zoom, worldOffset.x, worldOffset.y, getTraceSize, playingMedia])

  // Same reason as alignGuidesRef: the drag handler needs the current list,
  // and only the traces near the view are worth testing for alignment.
  const visibleTracesRef = useRef<Trace[]>([])
  useEffect(() => { visibleTracesRef.current = visibleTraces }, [visibleTraces])

  // Memoize sorted items to avoid re-sorting on every render
  const sortedItems = React.useMemo(() => {
    return [
      ...visibleTraces.map(trace => ({ type: 'trace' as const, trace, zIndex: zOf(trace) })),
      { type: 'player' as const, trace: null, zIndex: Math.max(playerZIndex * 100, OWN_CURSOR_MIN_Z_INDEX) }
    ].sort((a, b) => a.zIndex - b.zIndex)
    // drawRank too: reordering a group changes no trace, only the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTraces, playerZIndex, drawRank])

  // Renders a path/polyline shape's visible SVG. Called inline from within
  // the main sortedItems render (below) at the trace's own sorted position,
  // rather than as a separate trailing pass over all path traces -- a
  // separate pass always paints after every other trace in DOM order
  // regardless of z-index, so paths appeared to sit on top of everything
  // else whenever z-index was tied (e.g. two ungrouped traces both at the
  // default 0), which is a very common case.
  const renderPathSvg = (trace: Trace) => {
    // Use editingTrace if this is the trace being edited (for instant updates)
    const displayTrace = (editingTrace && editingTrace.id === trace.id) ? editingTrace : trace

    // Use local shape points during drag for instant feedback, otherwise use trace points
    const points = localShapePoints[displayTrace.id] || displayTrace.shapePoints || []
    if (points.length < 2) return null // Need at least 2 points to draw

    const curveType = displayTrace.pathCurveType || 'straight'
    const shapeColor = displayTrace.shapeColor || '#3b82f6'
    const shapeOpacity = displayTrace.shapeOpacity ?? 1.0
    // shapeOutlineWidth is the path's thickness in WORLD units (like every
    // other size on a trace) -- the stroke/markers below are drawn in
    // screen-pixel SVG units (via getScreenPosition, which already bakes
    // zoom into the point positions), so the width has to be scaled by zoom
    // too. Previously it wasn't, which kept the line/arrows a constant
    // screen-pixel size while the line's actual length scaled with zoom --
    // making them look disproportionately huge when zoomed out (barely any
    // line length left to dwarf them) and disproportionately thin when
    // zoomed in (line length grew, thickness didn't).
    const outlineWidth = displayTrace.shapeOutlineWidth ?? 2
    const zoomedOutlineWidth = Math.max(outlineWidth * zoom, 0.5)
    // The arrowheads' size on screen (lib/shapeStyle ARROW_SCALE).
    const arrowSize = zoomedOutlineWidth * ARROW_SCALE
    const arrowStart = displayTrace.pathArrowStart || 'none'
    const arrowEnd = displayTrace.pathArrowEnd || 'none'
    // Reuses the illuminate/lightColor/lightIntensity fields (see the
    // Customize panel's path-specific "Glow" section) -- off by default,
    // unlike before where this glow always rendered unconditionally.
    const glowEnabled = displayTrace.illuminate ?? false
    const glowColor = displayTrace.lightColor ?? '#cbcbcb'
    const glowOpacity = 0.22 * (displayTrace.lightIntensity ?? 1.0)

    // Generate unique marker IDs for this trace
    const markerId = `path-marker-${trace.id}`

    // Convert world coordinates to screen coordinates
    const screenPoints = points.map(p => {
      const { screenX, screenY } = getScreenPosition(p.x, p.y)
      const result: any = { x: screenX, y: screenY }
      if (p.cp1x !== undefined && p.cp1y !== undefined) {
        const cp1 = getScreenPosition(p.cp1x, p.cp1y)
        result.cp1x = cp1.screenX
        result.cp1y = cp1.screenY
      }
      if (p.cp2x !== undefined && p.cp2y !== undefined) {
        const cp2 = getScreenPosition(p.cp2x, p.cp2y)
        result.cp2x = cp2.screenX
        result.cp2y = cp2.screenY
      }
      return result
    })

    // The line's outline, whichever way it runs: straight from point to
    // point, curved on its handles (lib/pathGeometry), or as an elbow --
    // straight runs and right-angle turns (lib/elbow).
    const pathData = curveType === 'bezier'
      ? curvePath(screenPoints)
      : curveType === 'elbow'
        ? roundedPath(elbowThrough(screenPoints), ELBOW_RADIUS * zoom)
        : screenPoints.map((p: { x: number; y: number }, i: number) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')

    // Show the selection glow whether this path is the single selected
    // trace or part of a multi-selection (previously only multi-select
    // showed any highlight at all, so a singly-selected path had none).
    const isPathMultiSelected = (selectedTraceId === trace.id || multiSelectedIds.has(trace.id)) && !inWholeGroup.has(trace.id)

    return (
      <svg
        className="absolute select-none"
        style={{
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          zIndex: zOf(trace),
          pointerEvents: 'none'
        }}
      >
        {/* Arrow marker definitions */}
        <defs>
          {/* Triangle markers - size in screen pixels (userSpaceOnUse) */}
          <marker
            id={`${markerId}-triangle-start`}
            markerWidth={arrowSize}
            markerHeight={arrowSize}
            refX={arrowSize}
            refY={arrowSize / 2}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`${arrowSize},0 ${arrowSize},${arrowSize} 0,${arrowSize / 2}`}
              fill={shapeColor}
            />
          </marker>
          <marker
            id={`${markerId}-triangle-end`}
            markerWidth={arrowSize}
            markerHeight={arrowSize}
            refX={0}
            refY={arrowSize / 2}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`0,0 ${arrowSize},${arrowSize / 2} 0,${arrowSize}`}
              fill={shapeColor}
            />
          </marker>
          {/* Diamond (Nier-style) markers - size in screen pixels */}
          <marker
            id={`${markerId}-diamond-start`}
            markerWidth={arrowSize}
            markerHeight={arrowSize}
            refX={arrowSize / 2}
            refY={arrowSize / 2}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`${arrowSize / 2},0 ${arrowSize},${arrowSize / 2} ${arrowSize / 2},${arrowSize} 0,${arrowSize / 2}`}
              fill={shapeColor}
            />
          </marker>
          <marker
            id={`${markerId}-diamond-end`}
            markerWidth={arrowSize}
            markerHeight={arrowSize}
            refX={arrowSize / 2}
            refY={arrowSize / 2}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`${arrowSize / 2},0 ${arrowSize},${arrowSize / 2} ${arrowSize / 2},${arrowSize} 0,${arrowSize / 2}`}
              fill={shapeColor}
            />
          </marker>
        </defs>
        {/* Selected -- alone or with others: a dashed box round it, its
            arrowheads included, as a selected box shows its frame. It was a
            blurred green copy of the line under it, which hid the line. */}
        {isPathMultiSelected && (() => {
          const pad = arrowSize / 2 + 6
          const xs = screenPoints.map((p: { x: number }) => p.x)
          const ys = screenPoints.map((p: { y: number }) => p.y)
          const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad
          return (
            <rect
              x={x}
              y={y}
              width={Math.max(...xs) + pad - x}
              height={Math.max(...ys) + pad - y}
              fill="none"
              strokeWidth={1}
              strokeDasharray="4 4"
              style={{ stroke: 'rgb(var(--c-fg) / 0.55)', pointerEvents: 'none' }}
            />
          )
        })()}
        {/* Invisible wider stroke for easier clicking -- floored so a
            heavily zoomed-out (thus very thin) path stays clickable */}
        <path
          d={pathData}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(zoomedOutlineWidth + 10, 14)}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-trace-element="true"
          style={{ pointerEvents: 'stroke', cursor: 'move' }}
          // Pressed, the line is taken as any trace is (handleMouseDown):
          // selected -- with its group, or added to the selection with
          // Shift -- and dragged, the whole path moves. Its points and
          // handles are the only other places to take hold of it.
          onMouseDown={(e) => {
            if (e.button !== 0) return
            // The line itself, not one of its points: Delete then takes the
            // whole path, not a point picked out earlier.
            setSelectedPointIndex(null)
            on.handleMouseDown(e, trace, 'move')
          }}
          onTouchStart={(e) => {
            setSelectedPointIndex(null)
            on.handleTouchDown(e, trace, 'move')
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation()
            const t = traces.find(tr => tr.id === trace.id)
            if (t) setEditingTrace(t)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSelectedTraceId(trace.id)
            setContextMenu({ x: e.clientX, y: e.clientY, traceId: trace.id })
          }}
        />
        {/* Glow along the line -- off by default, toggled via the
            Customize panel's "Glow" section (see displayTrace.illuminate) */}
        {glowEnabled && (
          <path
            d={pathData}
            fill="none"
            stroke={glowColor}
            strokeWidth={zoomedOutlineWidth + 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={glowOpacity}
            style={{ pointerEvents: 'none', filter: 'blur(2px)' }}
          />
        )}
        {/* Visible path */}
        <path
          d={pathData}
          fill="none"
          stroke={shapeColor}
          strokeWidth={zoomedOutlineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...dashProps(displayTrace.strokeStyle, outlineWidth, zoom)}
          opacity={shapeOpacity}
          markerStart={arrowStart !== 'none' ? `url(#${markerId}-${arrowStart}-start)` : undefined}
          markerEnd={arrowEnd !== 'none' ? `url(#${markerId}-${arrowEnd}-end)` : undefined}
          style={{ pointerEvents: 'none' }}
        />
      </svg>
    )
  }

  // The handlers a trace's drawing calls from its events: of fixed identity, and
  // always the latest version. TraceSlot can keep a trace's drawing -- handlers
  // and all -- for many renders, and a plain handler would act on the state of
  // the render it was made in.
  const on = useLatestHandlers({ handleMouseDown, handleTouchDown, endTextEdit, fitTextLive, isClickThrough, updateTraceCustomization, renameFrame, commitSheetCell, countSlides })

  // Everything renderTrace reads while drawing `trace`, narrowed to this trace
  // wherever it only ever asks about this one: while none of it changes, the
  // drawing can't either, and TraceSlot keeps it. What its handlers read later
  // is here too, where it isn't taken through `on`. tests/traceSlot.test.ts
  // checks that nothing renderTrace reads is missing.
  const traceSignature = (trace: Trace): unknown[] => {
    // A path is drawn by renderPathSvg, which reads the whole selection and
    // every trace: drawn afresh every time rather than traced through. There
    // are few of them.
    if (trace.type === 'shape' && trace.shapeType === 'path') return [{}]
    const id = trace.id
    const selected = selectedTraceId === id
    const editing = inlineEditingTraceId === id
    const page = documentPage[id] ?? 1
    return [
      // The view, and what every trace is drawn with. `t` is one function
      // whatever the language, so the language stands in for it.
      zoom, worldOffset, atriumBackground, canEdit, language, showTraceTypeLabels, traceFloat,
      // This trace.
      zOf(trace), localTraceTransforms[id], imageDimensions[id], imageProxySources[id], imageRetryCount[id],
      failedImages.has(id), failedMedia.has(id), confirmedImageIds.has(id), localMediaUrls[id], localShapePoints[id],
      playingMedia.has(id), movingIds.has(id), glidingIds.has(id),
      // The selected trace's frame, and crop mode, which only it shows.
      selected, multiSelectedIds.has(id), inWholeGroup.has(id), selected ? selectedPointIndex : null, selected && isCropMode, !!hiddenTraceIds?.has(id),
      editingTrace?.id === id ? editingTrace : null, editing, editing ? inlineEditText : null,
      sheetEditAt?.traceId === id ? sheetEditAt : null,
      pressedClickableId === id, pendingLinkTraceId === id,
      documentError[id], page, documentPageCount[id], documentPages[`${id}:${page}`],
    ]
  }

  // One entry of sortedItems: a trace, or the player's own cursor. Named so the
  // two can be drawn in different layers -- see the world layer below.
  const renderSortedItem = (item: (typeof sortedItems)[number]) => {
    if (item.type === 'player') {
      return (
        <OwnCursor
          key="player-cursor"
          hidden={!!hideCursor}
          zIndex={item.zIndex}
          pointerInWindow={pointerInWindow}
          crosshair={placing || selecting || pathCreationMode || !!colorPickerCallback}
          pan={panning}
        />
      )
    }
    const trace = item.trace!
    return <TraceSlot key={trace.id} trace={trace} render={renderTrace} signature={traceSignature(trace)} />
  }

  // One trace, drawn -- inside its TraceSlot, which keeps the drawing while
  // traceSignature(trace) is unchanged.
  const renderTrace = (trace: Trace) => {
    if (hiddenTraceIds?.has(trace.id)) return null
    // Use editingTrace for selected trace to show live updates (check ID match to be safe)
    const displayTrace = (editingTrace && editingTrace.id === trace.id) ? editingTrace : trace
const transform = getTraceTransform(trace)
// A kept drawing is painted from what it keeps instead of shown from its
// picture file (StrokeCanvas) when the file isn't up to it: seen at more than
// twice the density it was painted at, not made yet since the drawing last
// changed, or not there. Twice, not at all: the density needed rounds up to a
// power of two, so on a screen of 1.5 pixels a point every older stroke was
// "too coarse" at any ordinary zoom -- and hundreds of canvases, one a stroke,
// cost the browser far more to move about than the same strokes as pictures
// (measured: 40 ms a frame against 13). Stretched up to twice, a stroke is a
// little soft; closer than that, there are few strokes on screen to paint.
const keptStroke = trace.type === 'image' && trace.width && trace.height ? trace.strokeData : null
const strokePaintDensity = keptStroke
  ? strokeDensity(zoom * Math.max(Math.abs(transform.scaleX ?? 1), Math.abs(transform.scaleY ?? 1)) * (window.devicePixelRatio || 1), trace.width!, trace.height!)
  : 0
const paintStroke = !!keptStroke && (strokePaintDensity > keptStroke.ppw * 2 || keptStroke.rev !== keptStroke.fileRev
  || failedImages.has(trace.id) || !!imageProxySources[trace.id]?.startsWith('local://'))
let { screenX, screenY } = getScreenPosition(transform.x, transform.y)
// Same staleness problem as the viewport-culling filter above: a
// path's x/y only reflects where it was created or last moved as a
// whole, not where its (possibly individually-dragged) points
// currently are. Left uncorrected, the distance-from-viewport-center
// fade below fades/hides the path based on that wrong position
// instead of where it's actually drawn.
if (trace.type === 'shape' && trace.shapeType === 'path') {
  const livePoints = localShapePoints[trace.id] || displayTrace.shapePoints
  if (livePoints && livePoints.length > 0) {
    const centroidX = livePoints.reduce((sum, p) => sum + p.x, 0) / livePoints.length
    const centroidY = livePoints.reduce((sum, p) => sum + p.y, 0) / livePoints.length
    const centroidScreen = getScreenPosition(centroidX, centroidY)
    screenX = centroidScreen.screenX
    screenY = centroidScreen.screenY
  }
}
const { width, height } = getTraceSize(trace)
const borderColor = trace.borderColor || borderColourOf(trace.type)
// Handles stay hidden while a clickable trace is being pressed.
//
// Selection still happens on mousedown -- the move handler reads it to
// know what to drag, so it can't be deferred -- but showing the
// transform frame for the instant a link-click takes would flash a
// selection the user never asked for. If the press turns into a drag
// the suppression lifts and the handles appear as usual; if it turns
// out to be a click, the link opens and nothing is left selected.
// Held down, or released and counting down to the link opening. Both
// keep the trace looking pressed and its handles hidden -- the second
// is what makes the press visible at all, since the button is already
// back up by the time the click resolves.
const isPressed = pressedClickableId === trace.id || pendingLinkTraceId === trace.id
// In a group selected whole, a trace is lit by its group's outline alone.
const isSelected = selectedTraceId === trace.id && !isPressed && !inWholeGroup.has(trace.id)
const isMultiSelected = multiSelectedIds.has(trace.id) && !inWholeGroup.has(trace.id)
// Selected at all, lit or not: held still rather than floating.
const isInSelection = selectedTraceId === trace.id || multiSelectedIds.has(trace.id)
// A drawing is taken by its strokes, not its box: unselected, a click beside
// them goes on to whatever is under it (strokeHits). Selected, all its box
// holds it, to be moved. A drawing from before strokes were kept has only its
// picture, and is taken anywhere in it, as before.
const hitStrokes = trace.type === 'image' && !isInSelection ? strokeHits(trace.strokeData) : null

// Apply customization defaults
const showBorder = trace.showBorder ?? true
const showBackground = trace.showBackground ?? true
const showDescription = trace.showDescription ?? false
const showFilename = trace.showFilename ?? true
const fontSize = trace.fontSize ?? 'medium'
const fontFamily = trace.fontFamily ?? 'sans'

// Apply crop to border size. While it's being cropped, the trace shows its
// whole content instead, where the whole box sits (boxOffset, below) -- what
// the crop cuts away is dimmed by the crop frame drawn over it.
const isCropping = isSelected && isCropMode && canEdit
const { x: cropX, y: cropY, w: cropWidth, h: cropHeight } = isCropping ? WHOLE : cropOf(trace)
const shownCrop = isCropping ? { ...trace, cropX, cropY, cropWidth, cropHeight } : trace

// Border container should match the cropped content size
// For shapes, use their actual width/height properties
const shapeWidth = trace.type === 'shape' ? (trace.width || 200) : width
const shapeHeight = trace.type === 'shape' ? (trace.height || 200) : height
const borderWidth = (trace.type === 'shape' ? shapeWidth : width * cropWidth) * (transform as any).scaleX * zoom
const borderHeight = (trace.type === 'shape' ? shapeHeight : height * cropHeight) * (transform as any).scaleY * zoom
// A trace sits centred on its crop window; its whole box sits back from
// that by the crop. A shape crops in place, in a box that doesn't move.
// Floating (Profile > Animations): a slow drift of a few pixels -- the trace
// and its light together. Held still while selected, pressed, edited in
// place, gliding, or in use as an interactive embed.
const floats = traceFloat > 0 && !isInSelection && !isPressed
  && inlineEditingTraceId !== trace.id && !glidingIds.has(trace.id)
  && !(trace.type === 'embed' && trace.enableInteraction)
const floatAnimation = `trace-float ${floatTiming(trace.id).duration}s ease-in-out ${floatTiming(trace.id).delay}s infinite`
const boxOffset = isCropping && trace.type !== 'shape'
  ? (() => {
      const b = boxFromWindow(cropOf(trace))
      return turn(b.u * width * (transform as any).scaleX * zoom, b.v * height * (transform as any).scaleY * zoom, transform.rotation)
    })()
  : { x: 0, y: 0 }

// Debug logging for image dimensions
// Selected trace rendering

// No fade or cull of its own here. The edge fade is one screen-fixed mask on
// the world layer (.world-vignette in index.css), and what's drawn is
// visibleTraces: everything within CULL_MARGIN of the screen, which the
// camera relies on (lib/worldCamera). Each trace faded by its own distance
// from the edge -- the whole trace at once, not the part near the edge -- and
// was dropped a quarter-screen out, so traces just off-screen popped in
// mid-pan.

// Path shapes render their visible line inline here (via
// renderPathSvg), at this trace's own sorted DOM position, instead
// of in a separate trailing pass over all paths -- see the comment
// on renderPathSvg's definition for why that used to make paths
// appear to always paint on top of everything else.
if (trace.type === 'shape' && trace.shapeType === 'path') {
  // Paths don't use the standard radial point-light (a glow centered
  // on one spot doesn't suit an elongated line) -- illuminate/
  // lightColor/lightIntensity are reused instead to drive the
  // along-the-line glow rendered inside renderPathSvg.
  return (
    <div key={trace.id} className="contents">
      {renderPathSvg(trace)}
    </div>
  )
}

return (
  <div key={trace.id} className="contents">
    {/* The light, just under the trace that casts it.

        Coming first in the DOM is not enough, and was the bug: this is
        positioned but had no z-index, while every trace sets one from
        its place in the order. A positioned element without a z-index paints
        below every positioned sibling that has one -- so a light did
        not sit under its own trace, it sat under ALL of them, and
        lighting something meant washing the floor beneath the whole
        atrium instead.

        One below its own trace puts it above everything the trace is
        above, and below the trace itself: trace z-indexes go up in threes
        (zOf), leaving that level free. */}
    {trace.illuminate && (() => {
      // Where it comes from (lightEmit): a point at the trace's middle, as it
      // always has -- or all of its shape, or its border, each glowing out
      // around it as far as its radius, in the trace's own shape and turn.
      // Drawn without filters (LIGHT_FALLOFF), in its colour, --light-rgb.
      // Screened onto the traces under it, never the ground: the world layer
      // is an isolated group (see its wrapper), at rest and moving alike, so
      // a light looks the same in both. It used to take, while the view
      // moved, the colour it would have screened onto the ground -- nearly
      // white on a light atrium, where it seemed to vanish.
      const emit = trace.lightEmit ?? 'center'
      const reach = (trace.lightRadius ?? 200) * zoom
      const pulse = trace.lightPulse ? `pulse ${trace.lightPulseSpeed ?? 2}s ease-in-out infinite` : ''
      const common: React.CSSProperties = {
        ['--light-rgb' as any]: rgbChannels(trace.lightColor ?? '#ffffff'),
        ['--pulse-opacity' as any]: (trace.lightIntensity ?? 1.0) * 0.8,
        zIndex: zOf(trace) - 1,
        opacity: (trace.lightIntensity ?? 1.0) * 0.8,
        mixBlendMode: 'screen',
        willChange: 'transform, opacity',
        // Floating with its trace, and pulsing if it pulses.
        animation: [pulse, floats ? floatAnimation : ''].filter(Boolean).join(', ') || 'none',
        ...(floats ? { ['--float-amp' as any]: `${(traceFloat / 100) * FLOAT_MAX_PX}px` } : {}),
      }
      if (emit === 'center') {
        const outer = reach * 1.6
        return (
          <div
            data-light-for={trace.id}
            className="absolute pointer-events-none"
            style={{
              ...common,
              left: `${screenX + (trace.lightOffsetX ?? 0) * zoom}px`,
              top: `${screenY + (trace.lightOffsetY ?? 0) * zoom}px`,
              width: `${outer * 2}px`,
              height: `${outer * 2}px`,
              background: `radial-gradient(circle closest-side, ${LIGHT_FALLOFF})`,
              transformOrigin: 'center center',
              marginLeft: `${-outer}px`,
              marginTop: `${-outer}px`,
            }}
          />
        )
      }
      // The shape's own outline: rounded as the trace is, an ellipse for a
      // circle. Its glow a painted shadow: as far out as the old blur reached.
      const round = trace.type === 'shape' && trace.shapeType === 'circle' ? '50%' : `${(displayTrace.borderRadius ?? 0) * zoom}px`
      const glow = `0 0 ${reach * 0.6}px ${reach * 0.25}px rgb(var(--light-rgb))`
      return (
        <div
          data-light-for={trace.id}
          data-light-emit={emit}
          className="absolute pointer-events-none"
          style={{
            ...common,
            left: `${screenX + boxOffset.x}px`,
            top: `${screenY + boxOffset.y}px`,
            width: `${borderWidth}px`,
            height: `${borderHeight}px`,
            // Centred by its margins, as a light from the middle is: a
            // translate(-50%, -50%) here was replaced by the pulse's scale,
            // and the light jumped half its size down and right.
            marginLeft: `${-borderWidth / 2}px`,
            marginTop: `${-borderHeight / 2}px`,
            transform: `rotate(${transform.rotation}deg)`,
            ['--pulse-grow' as any]: 1,
            borderRadius: round,
            ...(emit === 'shape'
              ? { background: 'rgb(var(--light-rgb))', boxShadow: glow }
              // The border: glowing out from it and in from it, nothing filled.
              : { boxShadow: `${glow}, inset ${glow}` }),
          }}
        />
      )
    })()}
    
    {/* The trace itself */}
    {/* position+zIndex here too (not just the inner container), so this
        wrapper compares with other traces on the same terms. Handles stay
        above every trace by using far larger values (see HANDLE_Z_INDEX
        below). */}
    <div style={{ position: 'relative', zIndex: zOf(trace) }}>
    {/* Container for positioning - doesn't scale */}
    <div
      data-trace-element="true"
      data-trace-id={trace.id}
      data-strokes-only={hitStrokes ? '' : undefined}
      className="absolute"
      style={{
        left: `${screenX + boxOffset.x}px`,
        top: `${screenY + boxOffset.y}px`,
        // Explicit z-index so ordinary traces and path shapes
        // compare on equal terms. Without this, a path's explicit
        // z-index always painted above every non-path trace
        // regardless of value, since a positioned element with a
        // set z-index paints above siblings that rely on implicit
        // DOM-order stacking.
        zIndex: zOf(trace),
        // The pressed state adds a slight inset scale on top of the
        // existing transform, so a clickable trace visibly depresses.
        // Folded into the same transform string rather than applied to
        // a wrapper, because a second transformed element would
        // reintroduce the stacking-context problem the comment above
        // describes.
        // No flip here: a flip mirrors only what the trace shows, inside
        // its frame (lib/traceFlip), never the tag, labels or frame on it.
        transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scale(${isPressed ? 0.97 : 1})`,
        // Only transitioned while pressed. A permanent transition here
        // would smear every drag frame, since dragging moves this same
        // element.
        transition: isPressed ? 'transform 90ms ease-out, filter 90ms ease-out' : undefined,
        // Brightens the whole trace -- background, text and border at
        // once -- without needing to know which of the many per-type
        // renderers below is drawing it.
        filter: isPressed ? 'brightness(1.35)' : undefined,
        // Composited only while it moves -- dragged, or gliding after a
        // throw -- so the drag feel's translate and rotate are left to the
        // compositor. Always composited, as it was, the browser drew a trace
        // between pixels at most zooms and without subpixel text, which is
        // why text looked soft; at rest it's drawn flat, and crisp.
        willChange: movingIds.has(trace.id) || glidingIds.has(trace.id) ? 'transform, translate, rotate' : undefined,
        transformOrigin: 'center center',
        // Floating (Profile > Animations): a slow drift of a few
        // pixels. Held still while selected, pressed, edited in place,
        // gliding, or in use as an interactive embed -- the handles,
        // grip and caret around it stay where they are, and something
        // being worked with shouldn't drift out from under the pointer.
        // Not the shape being placed: it would drift while being sized.
        ...(floats ? {
          animation: floatAnimation,
          ['--float-amp' as any]: `${(traceFloat / 100) * FLOAT_MAX_PX}px`,
        } : {}),
        cursor: trace.isClickable && trace.linkUrl ? 'pointer' : undefined,
        // A frame is taken hold of by its edge and title (below); its inside
        // is left to what it holds, and to the canvas under it.
        pointerEvents: isFrame(trace) || hitStrokes ? 'none' : 'auto',
      }}
      onMouseEnter={() => setCursorState('pointer')}
      onMouseLeave={() => setCursorState('default')}
      onMouseDown={(e) => on.handleMouseDown(e, trace, 'move')}
      onTouchStart={(e) => on.handleTouchDown(e, trace, 'move')}
      onClick={(e) => {
        // Adding a path's points: left to go on to handleClickOutside, which
        // puts a point here.
        if (pathCreationModeRef.current && trace.id !== pathIdRef.current) return
        // Don't handle clicks if we're in a transform mode (e.g., dragging a point).
        // From the ref: a mode change isn't in the trace's signature, so this
        // handler can be one from before it (see TraceSlot).
        if (transformModeRef.current !== 'none') {
          e.stopPropagation()
          return
        }
        e.stopPropagation()

        if (on.isClickThrough(trace, e)) {
          // Deselected rather than selected: following a link is not
          // an edit, so leaving the transform frame up afterwards
          // would be handles nobody asked for. Shift-click and the
          // right-click menu still select it for editing.
          setSelectedTraceId(null)

          // Ignore a second click while one is already counting down,
          // rather than queueing another open or restarting the timer.
          if (pendingLinkTimerRef.current) return

          const url = trace.linkUrl
          setPendingLinkTraceId(trace.id)
          pendingLinkTimerRef.current = window.setTimeout(() => {
            pendingLinkTimerRef.current = null
            setPendingLinkTraceId(null)
            openExternalUrl(url)
          }, LINK_OPEN_DELAY_MS)
          return
        }

        setSelectedTraceId(trace.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        // A frame has nothing to preview; its title renames it (above).
        if (isFrame(trace)) return
        // Text traces edit in place on double-click -- the preview
        // modal was a detour nobody used for text (it exists for
        // media, where "see it big" means something). Falls back to
        // the modal when editing isn't possible (view-only atrium or
        // a locked trace), where it still serves reading/copying.
        if (trace.type === 'text' && canEdit && !isLockedTrace(trace)) {
          setSelectedTraceId(trace.id)
          setInlineEditingTraceId(trace.id)
          setInlineEditText(trace.content ?? '')
          return
        }
        // A sheet edits the cell double-clicked (SheetTrace): where, as
        // fractions across and down it, in its own frame -- turned back by
        // its rotation from the middle of the box on screen.
        if (trace.type === 'sheet' && canEdit && !isLockedTrace(trace)) {
          const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const angle = ((transform as any).rotation ?? 0) * Math.PI / 180
          const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2)
          const lx = dx * Math.cos(angle) + dy * Math.sin(angle), ly = -dx * Math.sin(angle) + dy * Math.cos(angle)
          const editCell = () => {
            setSelectedTraceId(trace.id)
            setSheetEditAt({ traceId: trace.id, fx: Math.min(1, Math.max(0, lx / borderWidth + 0.5)), fy: Math.min(1, Math.max(0, ly / borderHeight + 0.5)) })
          }
          // One that follows its file stops first, if it's to be edited here.
          if (followed()[trace.id]) setUnfollowAsk({ traceId: trace.id, then: editCell })
          else editCell()
          return
        }
        setModalTrace(trace)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY, traceId: trace.id })
        setSelectedTraceId(trace.id)
      }}
    >
      {/* Shape rendering - no border container */}
      {trace.type === 'shape' ? (
        <div
          className="relative cursor-pointer trace-shape-frame-nier"
          style={{
            width: `${borderWidth}px`,
            height: `${borderHeight}px`,
            pointerEvents: 'auto',
            // Not clipped, nor its SVG (shapeStyle): the shape is drawn
            // inside its box already, stroke and all (the insets below), and
            // on a turned shape a clip is the edge you see -- one the
            // browser doesn't antialias, so it came out as a staircase.
            overflow: 'visible',
            // While its customize panel is open the shape wears the
            // placement frame instead (drawn in the SVG below), so a
            // selection outline on top of it would be two frames.
            outline: editingTrace?.id === trace.id && trace.shapeType !== 'path'
              ? 'none'
              : isSelected
              ? '2px solid rgba(203, 203, 203, 0.9)'
              : isMultiSelected
              ? '2px solid rgba(134, 239, 172, 0.95)'
              : 'none',
            outlineOffset: '2px',
            boxShadow: editingTrace?.id === trace.id && trace.shapeType !== 'path'
              ? 'none'
              : isSelected
              ? '0 0 0 1px rgba(203, 203, 203, 0.85), 0 0 16px rgba(203, 203, 203, 0.35)'
              : isMultiSelected
              ? '0 0 0 2px rgba(134, 239, 172, 0.9), 0 0 22px rgba(134, 239, 172, 0.65), 0 0 34px rgba(134, 239, 172, 0.35)'
              : 'none',
          }}
        >
          {(isSelected || isMultiSelected || showTraceTypeLabels) && (
            <div className="trace-nier-type-badge">{trace.shapeType === 'path' ? 'Path' : 'Shape'}</div>
          )}
          {(() => {
            const cornerRadius = trace.cornerRadius || 0
            const shapeType = trace.shapeType || 'rectangle'
            // Fill and outline (lib/shapeStyle shapePaint, which the quick
            // bar's preview paints with too). The outline's width in world
            // units, like a path's thickness and a frame's border: drawn
            // non-scaling, so it carries the zoom.
            const { fill, fillOpacity: shapeOpacity, stroke, strokeOpacity: outlineOpacity, strokeWidth, dash } = shapePaint(shapeStyleOf(trace), zoom)
            const hasOutline = strokeWidth > 0
            // How far to pull the shape in so the whole stroke stays in
            // the box, in viewBox units -- per axis, because the viewBox
            // is 0-100 stretched to borderWidth x borderHeight pixels.
            //
            // This used to be strokeWidth / 2 in viewBox units, which is
            // a percentage of the box while the stroke is in pixels: the
            // two only agree on a box exactly 100px across. Smaller (a
            // small shape, or any shape zoomed out) and the stroke
            // overhung the box and was cut off by the container's
            // overflow: hidden; larger, and the fill shrank away from
            // the box edge. Capped at the centre so a stroke wider than
            // the shape collapses it rather than turning it inside out.
            const insetX = hasOutline ? Math.min((strokeWidth / 2 / borderWidth) * 100, 50) : 0
            const insetY = hasOutline ? Math.min((strokeWidth / 2 / borderHeight) * 100, 50) : 0

            // While its customize panel is open -- or it's the panel's shape
            // still being placed -- it wears the breathing frame, in the
            // colour that stands out from the atrium (previewFrameColour).
            // At full strength: it was drawn see-through then, which made a
            // new shape look like something other than what it would be.
            const editing = editingTrace?.id === trace.id
            // 1.5 world units, like the preview frame, kept inside the box.
            const frameWidth = Math.max(1.5 * zoom, 1)
            const frameX = Math.min((frameWidth / 2 / borderWidth) * 100, 50)
            const frameY = Math.min((frameWidth / 2 / borderHeight) * 100, 50)
            const frameColour = '#' + previewFrameColour(atriumBackground).toString(16).padStart(6, '0')
            const frameProps = {
              className: 'shape-editing-frame',
              fill: 'none',
              stroke: frameColour,
              strokeWidth: frameWidth,
              vectorEffect: 'non-scaling-stroke' as const,
            }
            
            // Convert corner radius to viewBox percentage separately for x and y to keep circles circular.
            // Also has to divide out scaleX/scaleY (the resize-handle stretch applied as a CSS transform
            // on top of this SVG's base width/height) -- otherwise a non-uniform resize stretches the
            // already-correct-for-the-base-box radius into an ellipse, since the outer transform scales
            // the whole rendered box (corners included) after this percentage is baked in.
            const shapeScaleX = (transform as any).scaleX || 1
            const shapeScaleY = (transform as any).scaleY || 1
            const radiusPercentX = (cornerRadius / (width * shapeScaleX)) * 100
            const radiusPercentY = (cornerRadius / (height * shapeScaleY)) * 100

            // The shape, flipped within its box, and its crop (lib/traceFlip).
            const shapeStyle = { clipPath: cropClip(shownCrop), transform: flipInBox(trace) || undefined, transformOrigin: 'top left', overflow: 'visible' as const }

            if (shapeType === 'rectangle') {
              return (
                <svg
                  className="w-full h-full pointer-events-none select-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={shapeStyle}
                >
                  <rect
                    x={insetX}
                    y={insetY}
                    width={100 - insetX * 2}
                    height={100 - insetY * 2}
                    rx={radiusPercentX}
                    ry={radiusPercentY}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    {...dash}
                    vectorEffect="non-scaling-stroke"
                    fillOpacity={shapeOpacity}
                    strokeOpacity={outlineOpacity}
                  />
                  {editing && (
                    <rect
                      {...frameProps}
                      x={frameX} y={frameY}
                      width={100 - frameX * 2} height={100 - frameY * 2}
                      rx={radiusPercentX} ry={radiusPercentY}
                    />
                  )}
                </svg>
              )
            } else if (shapeType === 'circle') {
              return (
                <svg
                  className="w-full h-full pointer-events-none select-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={shapeStyle}
                >
                  <ellipse
                    cx="50"
                    cy="50"
                    rx={50 - insetX}
                    ry={50 - insetY}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    {...dash}
                    vectorEffect="non-scaling-stroke"
                    fillOpacity={shapeOpacity}
                    strokeOpacity={outlineOpacity}
                  />
                  {editing && (
                    <ellipse {...frameProps} cx="50" cy="50" rx={50 - frameX} ry={50 - frameY} />
                  )}
                </svg>
              )
            } else if (shapePolygon(shapeType, 100, 100)) {
              // A triangle, diamond or parallelogram (lib/traceGeometry).
              // Their edges aren't axis-aligned, so there's no clean separate
              // X/Y radius the way a rectangle has -- averaging the two keeps
              // it consistent with the rectangle's radius "feel" without a
              // second control.
              const polygonRadiusPercent = (radiusPercentX + radiusPercentY) / 2

              return (
                <svg
                  className="w-full h-full pointer-events-none select-none"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={shapeStyle}
                >
                  <path
                    d={roundedPolygonPath(shapePolygon(shapeType, 100, 100, insetX, insetY)!, polygonRadiusPercent)}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    {...dash}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    fillOpacity={shapeOpacity}
                    strokeOpacity={outlineOpacity}
                  />
                  {editing && (
                    <path
                      {...frameProps}
                      strokeLinejoin="round"
                      d={roundedPolygonPath(shapePolygon(shapeType, 100, 100, frameX, frameY)!, polygonRadiusPercent)}
                    />
                  )}
                </svg>
              )
            } else if (shapeType === 'path') {
              // Path shapes are rendered as absolute overlay - see below
              return null
            }
            return null
          })()}
        </div>
      ) : (
        /* Border container for non-shape traces - fixed size, doesn't scale with content */
        <>
        {(() => {
        // The border's colour, at its opacity unless selected. A dashed or
        // dotted one is drawn over the trace, centred on it, where its own
        // border is kept but unseen: CSS draws dashes its own way, and rounds a
        // border to whole pixels, so they changed as the zoom did. Drawn here,
        // everything in it is in the atrium's units times the zoom.
        const lineWidth = displayTrace.borderWidth ?? 2
        const line = lineWidth * zoom
        const radius = (displayTrace.borderRadius ?? 0) * zoom
        const lineColour = isSelected && isCropMode ? '#8f8f8f' : isSelected ? '#cbcbcb' : isMultiSelected ? '#86efac'
          : (trace.borderOpacity ?? 1) < 1 ? `rgb(${rgbChannels(borderColor)} / ${trace.borderOpacity})` : borderColor
        const dash = showBorder ? dashProps(displayTrace.strokeStyle, lineWidth, zoom) : {}
        const dashed = !!dash.strokeDasharray
        const outerW = borderWidth + 2 * line, outerH = borderHeight + 2 * line
        return (
        <>
        <div
          className="trace-frame-nier relative cursor-pointer transition-shadow"
          style={{
            boxSizing: 'content-box',
            width: `${borderWidth}px`,
            height: `${borderHeight}px`,
            border: showBorder ? `${line}px solid ${dashed ? 'transparent' : lineColour}` : 'none',
            // Dashed: the fill stops inside the border, so between the dashes
            // is what's behind the trace, as in Excalidraw -- dashes the colour
            // of the fill read as dashes, not as nothing.
            backgroundClip: dashed ? 'padding-box' : undefined,
            borderRadius: `${radius}px`,
            backgroundColor: showBackground ? (() => {
              const fc = displayTrace.fillColor || '#191919';
              const fo = displayTrace.fillOpacity ?? 0.95;
              // Convert hex to rgba
              const r = parseInt(fc.slice(1, 3), 16) || 26;
              const g = parseInt(fc.slice(3, 5), 16) || 26;
              const b = parseInt(fc.slice(5, 7), 16) || 24;
              return `rgba(${r}, ${g}, ${b}, ${fo})`;
            })() : 'transparent',
            padding: '0px',
            // A frame is taken hold of by its edge and title (below); its inside
            // is left to what it holds, and to the canvas under it.
            pointerEvents: isFrame(trace) || hitStrokes ? 'none' : 'auto',
            // No backgroundImage scanline texture here -- a fine 2-3px
            // repeating-linear-gradient on a container whose pixel size
            // varies continuously with zoom caused visible moire/
            // shimmer artifacting as traces were panned or zoomed.
            boxShadow: isSelected && isCropMode
              ? '0 0 0 1px rgba(143, 143, 143, 0.9), 0 0 16px rgba(143, 143, 143, 0.45)'
              : isSelected
              ? '0 0 0 1px rgba(203, 203, 203, 0.85), 0 0 16px rgba(203, 203, 203, 0.35)'
              : isMultiSelected
              ? '0 0 0 2px rgba(134, 239, 172, 0.95), 0 0 24px rgba(134, 239, 172, 0.7), 0 0 38px rgba(134, 239, 172, 0.4)'
              // Ambient shadow, toggleable per trace (Customize ->
              // Soft Shadow). Still gated on showBackground, since a
              // background-less trace has no surface to cast from.
              : (showBackground && (trace.showShadow ?? true)
                ? '0 6px 16px rgba(0, 0, 0, 0.68), inset 0 1px 0 rgba(203, 203, 203, 0.06)'
                : 'none'),
            overflow: 'hidden',
          }}
        >
          {(isSelected || showTraceTypeLabels) && inlineEditingTraceId !== trace.id && !isFrame(trace) && (
            <div
              className="trace-nier-type-badge"
              // Its font size, padding and inset all come from CSS in
              // flat pixels, so one transform scales the lot rather
              // than overriding each of them here.
              style={{
                left: `${6 * zoom}px`,
                top: `${6 * zoom}px`,
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            >
              {getTraceTypeLabel(trace.type)}
            </div>
          )}
          {trace.mediaUrl?.startsWith('local://') && <VaultWriteBar url={trace.mediaUrl} />}
          {showBorder && !isFrame(trace) && (
            <>
              <span className="absolute top-0 left-0 w-2 h-2 border-l border-t pointer-events-none" style={{ borderColor: isSelected ? 'rgba(203, 203, 203,0.9)' : 'rgba(143, 143, 143,0.75)' }} />
              <span className="absolute top-0 right-0 w-2 h-2 border-r border-t pointer-events-none" style={{ borderColor: isSelected ? 'rgba(203, 203, 203,0.9)' : 'rgba(143, 143, 143,0.75)' }} />
              <span className="absolute bottom-0 left-0 w-2 h-2 border-l border-b pointer-events-none" style={{ borderColor: isSelected ? 'rgba(203, 203, 203,0.9)' : 'rgba(143, 143, 143,0.75)' }} />
              <span className="absolute bottom-0 right-0 w-2 h-2 border-r border-b pointer-events-none" style={{ borderColor: isSelected ? 'rgba(203, 203, 203,0.9)' : 'rgba(143, 143, 143,0.75)' }} />
            </>
          )}
          {/* Scaled content wrapper - text traces render at final pixel size to avoid distortion */}
          {/* What the trace shows, whole, and flipped here if it is: the
              crop's window (the translate) is then taken from the flipped
              picture, so it cuts what is seen. */}
          <div
            className="w-full h-full"
            style={trace.type === 'text' ? {
              width: '100%',
              height: '100%',
              transform: flipInBox(trace) || undefined,
              transformOrigin: 'top left',
            } : {
              transform: `scale(${(transform as any).scaleX * zoom}, ${(transform as any).scaleY * zoom}) translate(${-cropX * 100}%, ${-cropY * 100}%) ${flipInBox(trace)}`,
              transformOrigin: 'top left',
              width: `${width}px`,
              height: `${height}px`,
            }}
          >
      {/* A drawing stroke seen closer than its picture was drawn: painted
          from what's kept of it instead, sharp (StrokeCanvas). */}
      {paintStroke && keptStroke && (
        (() => {
          // Its file, as the picture below would show it, standing in while
          // the first painting is made -- none from a vault file not read.
          const raw = trace.mediaUrl || trace.imageUrl || ''
          const resolved = imageProxySources[trace.id]
          const standIn = raw && !failedImages.has(trace.id) && (!raw.startsWith('local://') || (resolved && !resolved.startsWith('local://'))) ? resolved || raw : undefined
          return <StrokeCanvas data={keptStroke} width={trace.width!} height={trace.height!} density={strokePaintDensity} standIn={standIn} style={{ clipPath: cropClip(shownCrop) }} />
        })()
      )}

      {/* Where an unselected drawing can be taken: its strokes, unseen, the
          only part of it the pointer finds (hitStrokes) -- at least a few
          pixels wide on screen, however thin they're drawn. */}
      {hitStrokes && (
        <svg className="absolute inset-0 overflow-visible" width={trace.width!} height={trace.height!} viewBox={`0 0 ${trace.width} ${trace.height}`} style={{ pointerEvents: 'none' }}>
          <g fill="none" stroke="transparent" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'stroke' }}>
            {hitStrokes.map((hit, i) => (
              <path key={i} d={hit.d} strokeWidth={Math.max(hit.width, 8 / (Math.abs(transform.scaleX ?? 1) * zoom || 1))} />
            ))}
          </g>
        </svg>
      )}

      {/* Image Content */}
      {!paintStroke && trace.type === 'image' && (trace.mediaUrl || trace.imageUrl) && !failedImages.has(trace.id) && (
        (() => {
          const rawUrl = trace.mediaUrl || trace.imageUrl || ''
          // A stand-in for a trace this atrium couldn't have (Force import,
          // lib/atriumFile): the error, saying what it was.
          if (rawUrl.startsWith(UNSUPPORTED)) return <TraceGlitch reason={t('atrium.error.unsupportedType', { type: rawUrl.slice(UNSUPPORTED.length) })} />
          const isLocal = rawUrl.startsWith('local://')
          const resolvedSrc = imageProxySources[trace.id]
          // For local:// URLs, wait for resolved blob URL before rendering
          if (isLocal && !resolvedSrc) return <div className="flex items-center justify-center h-full"><span className="text-nier-strong/70 text-[10px] tracking-wider uppercase">{t('common.loading')}...</span></div>
          // A successful resolve always hands back a blob: URL, so one
          // that is still local:// means the file couldn't be read --
          // deleted from the vault by hand, or restored from a folder
          // it never travelled with. Said plainly rather than left as a
          // broken image, since the trace keeps its place and the user
          // needs to know why it's empty.
          if (isLocal && resolvedSrc.startsWith('local://')) return <TraceGlitch reason={t('atrium.controls.missingFile')} />
          return (
        <img
          src={resolvedSrc || rawUrl}
          alt=""
          className="w-full h-full object-contain pointer-events-none select-none"
          style={{ 
            clipPath: cropClip(shownCrop),
          }}
          onLoad={(e) => {
            const img = e.currentTarget
            if (img.naturalWidth && img.naturalHeight) {
              setImageDimensions(prev => ({
                ...prev,
                [trace.id]: { width: img.naturalWidth, height: img.naturalHeight }
              }))
            }
            // Clear from failed if it was there
            setFailedImages(prev => {
              const next = new Set(prev)
              next.delete(trace.id)
              return next
            })
          }}
          onError={() => {
            const retries = imageRetryCount[trace.id] || 0
            if (retries < 3) {
              const url = trace.mediaUrl || trace.imageUrl
              if (url) {
                if (retries === 0 && !imageProxySources[trace.id]) {
                  // First retry: switch to proxy
                  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
                  setImageProxySources(prev => ({ ...prev, [trace.id]: proxyUrl }))
                } else {
                  // Subsequent retries: retry proxy with cache bust
                  const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}&t=${Date.now()}`
                  setImageProxySources(prev => ({ ...prev, [trace.id]: proxyUrl }))
                }
              }
              setImageRetryCount(prev => ({ ...prev, [trace.id]: retries + 1 }))
            } else {
              setFailedImages(prev => new Set(prev).add(trace.id))
            }
          }}
        />
          )
        })()
      )}
      
      {/* Image placeholder - shown when no URL or when image failed to load */}
      {!paintStroke && trace.type === 'image' && (!trace.mediaUrl && !trace.imageUrl || failedImages.has(trace.id)) && (
        <TraceGlitch reason={t('atrium.error.imageFailed')} />
      )}

      {/* Video Content */}
      {trace.type === 'video' && trace.mediaUrl && (
        <video
          id={`video-${trace.id}`}
          // Enough for the poster frame and the dimensions, and not a
          // byte more.
          //
          // Chromium defaults a <video> with a source to preload
          // "auto", so every video trace began pulling its ENTIRE file
          // the moment it appeared -- an atrium of videos quietly
          // reading gigabytes, and a freshly imported one racing the
          // vault write for the same file on the same disk. That is
          // the difference between importing a video and importing a
          // PDF of the same size: the PDF has no element that helps
          // itself to the file before anyone asks. Pressing play still
          // loads the rest, at the point somebody has said they want
          // it.
          preload="metadata"
          // No src until there is a real file to point at. A raw
          // local:// URL means nothing to the browser, and handing it
          // one only produces a failed element to recover from later.
          src={trace.mediaUrl?.startsWith('local://')
            ? localMediaUrls[trace.id]
            : (localMediaUrls[trace.id] || trace.mediaUrl)}
          // Asked for where it's answered, so spatial sound can place it (lib/spatialSound).
          crossOrigin={corsReady(trace.mediaUrl?.startsWith('local://') ? localMediaUrls[trace.id] : (localMediaUrls[trace.id] || trace.mediaUrl)) ? 'anonymous' : undefined}
          controls={false}
          className="w-full h-full pointer-events-none select-none"
          style={{ 
            clipPath: cropClip(shownCrop),
          }}
          onLoadedMetadata={(e) => {
            const video = e.currentTarget
            if (video.videoWidth && video.videoHeight) {
              setImageDimensions(prev => ({
                ...prev,
                [trace.id]: { width: video.videoWidth, height: video.videoHeight }
              }))
            }
          }}
          onPlay={() => {
            setPlayingMedia(prev => new Set(prev).add(trace.id))
          }}
          onPause={() => {
            setPlayingMedia(prev => {
              const next = new Set(prev)
              next.delete(trace.id)
              return next
            })
          }}
          onEnded={() => {
            setPlayingMedia(prev => {
              const next = new Set(prev)
              next.delete(trace.id)
              return next
            })
          }}
          onError={(e) => {
            // A <video> that fails its load stays failed: there is no
            // automatic retry, so one bad moment -- an import holding
            // the thread, say -- left the trace unplayable for the
            // rest of the visit. One retry, once, per trace.
            if (videoRetriedRef.current.has(trace.id)) {
              setFailedMedia(prev => new Set(prev).add(trace.id))
              return
            }
            videoRetriedRef.current.add(trace.id)
            const el = e.currentTarget
            window.setTimeout(() => { try { el.load() } catch { /* gone */ } }, 500)
          }}
        />
      )}

      {(trace.type === 'video' || trace.type === 'audio') && failedMedia.has(trace.id) && (
        <TraceGlitch reason={t('atrium.error.mediaFailed')} />
      )}

      {/* Still being copied into the vault. Says so, rather than
          showing an empty black rectangle that looks like a broken
          trace. */}
      {trace.type === 'video' && trace.mediaUrl?.startsWith('local://') && !localMediaUrls[trace.id] && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none bg-black/50">
          <span className="text-[10px] tracking-[0.2em] uppercase text-nier-strong/70">{t('atrium.customize.preparing')}</span>
        </div>
      )}

      {/* Play, for a video sitting on the canvas.

          The video element above cannot take the click itself: it is
          pointer-events-none so that dragging a video trace moves the
          trace rather than poking at the video, and controls={false}
          for the same reason. That left the canvas showing a still
          frame with no way to start it, and the modal as the only
          place a video would actually play.

          So it gets a control of its own, driven exactly like the
          audio trace's: the one interactive thing inside a trace that
          is otherwise inert to the pointer. */}
      {trace.type === 'video' && trace.mediaUrl && (
        <div className="trace-video-control absolute inset-x-0 bottom-0 flex justify-center pb-2 pointer-events-none">
          <button
            // No backdrop-filter, which is what made this go soft.
            //
            // A backdrop blur puts the element on its own composited
            // layer holding a rasterised copy of what is behind it.
            // Scaling the trace resizes the video underneath without
            // invalidating that layer, so the blur kept being stretched
            // from the size it was first drawn at -- and snapped back
            // only when something forced a repaint, which is why
            // clicking it fixed it.
            //
            // The atrium's own buttons are flat, cut-cornered and
            // lettered rather than glassy and pill-shaped, so this now
            // reads as part of the same interface instead of borrowed
            // from another one.
            className="pointer-events-auto cut-corner inline-flex items-center justify-center gap-1.5 h-[18px] px-2 text-[9px] tracking-[0.15em] uppercase leading-none transition-colors"
            style={{
              color: playingMedia.has(trace.id) ? 'rgb(var(--c-strong))' : 'rgb(var(--c-fg) / 0.8)',
              backgroundColor: 'rgb(var(--c-ground) / 0.94)',
              border: `1px solid rgb(var(--c-line) / ${playingMedia.has(trace.id) ? 0.7 : 0.4})`,
            }}
            onClick={(e) => {
              e.stopPropagation()
              const el = document.getElementById(`video-${trace.id}`) as HTMLVideoElement | null
              if (el) { el.paused ? void el.play() : el.pause() }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
              {playingMedia.has(trace.id)
                ? <><rect x="1" y="1" width="3" height="8" rx="0.5"/><rect x="6" y="1" width="3" height="8" rx="0.5"/></>
                : <polygon points="2,0.5 9,5 2,9.5"/>}
            </svg>
            {playingMedia.has(trace.id) ? t('atrium.controls.pause') : t('atrium.controls.play')}
          </button>
        </div>
      )}

      {/* Audio Content */}
      {trace.type === 'audio' && trace.mediaUrl && (
        <div className="flex flex-col items-center justify-center h-full pointer-events-none select-none px-3 pt-5 pb-4 gap-2">
          {/* Decorative waveform bars */}
          <div className="flex items-end justify-center gap-[2px] flex-1 w-full max-h-[60%] min-h-[24px]">
            {(() => {
              // Generate deterministic bar heights from trace id
              const bars = 24
              const heights: number[] = []
              for (let i = 0; i < bars; i++) {
                const hash = trace.id.charCodeAt(i % trace.id.length) + i * 7
                heights.push(0.18 + (((Math.sin(hash) * 43758.5453) % 1 + 1) % 1) * 0.82)
              }
              const isPlaying = playingMedia.has(trace.id)
              return heights.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 max-w-[6px] rounded-full"
                  style={{
                    height: `${h * 100}%`,
                    minHeight: '3px',
                    background: isPlaying
                      ? `linear-gradient(to top, ${trace.borderColor || '#8f8f8f'}, ${trace.borderColor ? trace.borderColor + '88' : '#cbcbcb'})`
                      : 'linear-gradient(to top, rgba(203, 203, 203,0.3), rgba(203, 203, 203,0.1))',
                    transition: 'background 0.3s ease',
                    animation: isPlaying ? `audioBarPulse 1.2s ease-in-out ${i * 0.05}s infinite alternate` : undefined,
                  }}
                />
              ))
            })()}
          </div>
          {/* Hidden audio element + custom play button */}
          <audio
            id={`audio-${trace.id}`}
            // Same reasoning as the video above: duration now, the
            // rest when somebody presses play.
            preload="metadata"
            // No src until there is a real file to point at. A raw
          // local:// URL means nothing to the browser, and handing it
          // one only produces a failed element to recover from later.
          src={trace.mediaUrl?.startsWith('local://')
            ? localMediaUrls[trace.id]
            : (localMediaUrls[trace.id] || trace.mediaUrl)}
            crossOrigin={corsReady(trace.mediaUrl?.startsWith('local://') ? localMediaUrls[trace.id] : (localMediaUrls[trace.id] || trace.mediaUrl)) ? 'anonymous' : undefined}
            className="hidden"
            onError={() => setFailedMedia(prev => new Set(prev).add(trace.id))}
            onPlay={() => setPlayingMedia(prev => new Set(prev).add(trace.id))}
            onPause={() => setPlayingMedia(prev => { const next = new Set(prev); next.delete(trace.id); return next })}
            onEnded={() => setPlayingMedia(prev => { const next = new Set(prev); next.delete(trace.id); return next })}
          />
          <button
            // Matches the video control above, and takes its colours
            // from the theme tokens rather than the fixed greys it had,
            // which stayed the same shade whatever the atrium was set
            // to.
            className="pointer-events-auto cut-corner inline-flex items-center justify-center gap-1.5 h-[18px] px-2 text-[9px] tracking-[0.15em] uppercase leading-none transition-colors"
            style={{
              color: playingMedia.has(trace.id) ? 'rgb(var(--c-strong))' : 'rgb(var(--c-fg) / 0.8)',
              backgroundColor: 'rgb(var(--c-ground) / 0.94)',
              border: `1px solid rgb(var(--c-line) / ${playingMedia.has(trace.id) ? 0.7 : 0.4})`,
            }}
            onClick={(e) => {
              e.stopPropagation()
              const el = document.getElementById(`audio-${trace.id}`) as HTMLAudioElement | null
              if (el) { el.paused ? el.play() : el.pause() }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
              {playingMedia.has(trace.id)
                ? <><rect x="1" y="1" width="3" height="8" rx="0.5"/><rect x="6" y="1" width="3" height="8" rx="0.5"/></>
                : <polygon points="2,0.5 9,5 2,9.5"/>}
            </svg>
            {playingMedia.has(trace.id) ? t('atrium.controls.pause') : t('atrium.controls.play')}
          </button>
          {showDescription && trace.content && (
            <p className="text-[10px] text-nier-strong/50 text-center truncate w-full pointer-events-none select-none tracking-wide">
              {trace.content}
            </p>
          )}
        </div>
      )}


      {/* A spreadsheet's sheet or chart, drawn from its file. */}
      {(trace.type === 'sheet' || trace.type === 'chart') && (
        <SheetTrace
          trace={trace}
          editAt={sheetEditAt?.traceId === trace.id ? sheetEditAt : null}
          onCell={(row, col, text) => { void on.commitSheetCell(trace, row, col, text) }}
          onEditEnd={() => setSheetEditAt(null)}
        />
      )}

      {/* Paged PDF. The page image is rendered on demand and cached
          per trace+page (see documentPages), so only the page being
          looked at is ever rasterized. */}
      {trace.type === 'document' && (
        <div
          className="w-full h-full relative bg-white overflow-hidden"
          // container-type lets the page controls below size
          // themselves in cqh (percentages of this box's height)
          // rather than fixed pixels, so the bar stays a constant
          // fraction of the page however large the trace is drawn.
          style={{ containerType: 'size' }}
        >
          {isDeckFile(trace.mediaUrl) ? (
            <DeckSlide url={trace.mediaUrl!} page={documentPage[trace.id] ?? 1} onCount={count => on.countSlides(trace.id, count)} />
          ) : documentPages[`${trace.id}:${documentPage[trace.id] ?? 1}`] ? (
            <img
              src={documentPages[`${trace.id}:${documentPage[trace.id] ?? 1}`]}
              alt=""
              className="w-full h-full object-contain pointer-events-none select-none"
            />
          ) : (
            documentError[trace.id] ? <TraceGlitch reason={documentError[trace.id]} /> : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-black/40 text-[10px] tracking-wider uppercase">
                {t('atrium.controls.rendering')}
              </span>
            </div>
            )
          )}

          {/* Page controls. Shown for everyone, not only editors --
              turning the page is reading, not editing. stopPropagation
              on mousedown so grabbing an arrow doesn't also start
              dragging the trace underneath it. */}
          {/* Sized in cqh -- percentages of the page's own height --
              so the bar is always about a twentieth of the page rather
              than a fixed pixel size that swamped the trace at normal
              zoom. */}
          {(documentPageCount[trace.id] ?? 0) > 1 && (
            <div
              className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-auto"
              style={{
                bottom: '2cqh',
                gap: '1.5cqh',
                // Squared off and outlined rather than a rounded dark
                // pill, matching the atrium's own chrome and the
                // modal's page controls.
                padding: '1cqh 1.5cqh',
                background: 'rgba(10,10,10,0.85)',
                border: '0.2cqh solid rgba(203,203,203,0.35)',
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="text-white/80 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed leading-none transition-colors"
                style={{
                  fontSize: '2.6cqh',
                  padding: '0.4cqh 1.2cqh',
                  border: '0.2cqh solid rgba(203,203,203,0.3)',
                }}
                disabled={(documentPage[trace.id] ?? 1) <= 1}
                onClick={(e) => {
                  e.stopPropagation()
                  setDocumentPage(prev => ({ ...prev, [trace.id]: Math.max(1, (prev[trace.id] ?? 1) - 1) }))
                }}
              >
                ◀
              </button>
              {/* Light text, as the bar is dark in either theme: the theme's
                  own text went dark on paper, on this dark bar. */}
              <span
                className="text-white/80 uppercase tabular-nums leading-none whitespace-nowrap"
                style={{ fontSize: '2.2cqh', letterSpacing: '0.15em' }}
              >
                {documentPage[trace.id] ?? 1} / {documentPageCount[trace.id]}
              </span>
              <button
                type="button"
                className="text-white/80 hover:text-white disabled:opacity-25 disabled:cursor-not-allowed leading-none transition-colors"
                style={{
                  fontSize: '2.6cqh',
                  padding: '0.4cqh 1.2cqh',
                  border: '0.2cqh solid rgba(203,203,203,0.3)',
                }}
                disabled={(documentPage[trace.id] ?? 1) >= (documentPageCount[trace.id] ?? 1)}
                onClick={(e) => {
                  e.stopPropagation()
                  setDocumentPage(prev => ({
                    ...prev,
                    [trace.id]: Math.min(documentPageCount[trace.id] ?? 1, (prev[trace.id] ?? 1) + 1),
                  }))
                }}
              >
                ▶
              </button>
            </div>
          )}
        </div>
      )}

      {/* Embed Content */}
      {trace.type === 'embed' && trace.mediaUrl && (() => {
        // Check if the embed URL is actually an image (by extension OR confirmed via preflight)
        const hasImageExtension = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(trace.mediaUrl)
        const isConfirmedImage = confirmedImageIds.has(trace.id)
        const isDirectImage = hasImageExtension || isConfirmedImage
        
        if (isDirectImage && !failedImages.has(trace.id)) {
          const isLocal = trace.mediaUrl.startsWith('local://')
          const resolvedSrc = imageProxySources[trace.id]
          if (isLocal && !resolvedSrc) return <div className="flex items-center justify-center h-full"><span className="text-nier-strong/70 text-[10px] tracking-wider uppercase">{t('common.loading')}...</span></div>
          // Still local:// after resolving means the file is gone --
          // see the image branch above.
          if (isLocal && resolvedSrc.startsWith('local://')) return <TraceGlitch reason={t('atrium.controls.missingFile')} />
          // Render as image, not iframe
          return (
            <img
              src={resolvedSrc || trace.mediaUrl}
              alt=""
              className="w-full h-full object-contain pointer-events-none select-none"
              style={{ 
                clipPath: cropClip(shownCrop),
              }}
              onLoad={(e) => {
                const img = e.currentTarget
                if (img.naturalWidth && img.naturalHeight) {
                  setImageDimensions(prev => ({
                    ...prev,
                    [trace.id]: { width: img.naturalWidth, height: img.naturalHeight }
                  }))
                }
                setFailedImages(prev => {
                  const next = new Set(prev)
                  next.delete(trace.id)
                  return next
                })
              }}
              onError={() => {
                const retries = imageRetryCount[trace.id] || 0
                if (retries < 3) {
                  const url = trace.mediaUrl
                  if (url) {
                    if (retries === 0 && !imageProxySources[trace.id]) {
                      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
                      setImageProxySources(prev => ({ ...prev, [trace.id]: proxyUrl }))
                    } else {
                      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}&t=${Date.now()}`
                      setImageProxySources(prev => ({ ...prev, [trace.id]: proxyUrl }))
                    }
                  }
                  setImageRetryCount(prev => ({ ...prev, [trace.id]: retries + 1 }))
                } else {
                  setFailedImages(prev => new Set(prev).add(trace.id))
                }
              }}
            />
          )
        }
        
        // Styled link card if the direct image failed to hotlink --
        // links to the source page (linkUrl, e.g. the original
        // Pinterest pin) rather than the dead image URL itself.
        if (isDirectImage && failedImages.has(trace.id)) {
          const clickThroughUrl = trace.linkUrl || trace.mediaUrl
          let hostname = ''
          try {
            hostname = new URL(clickThroughUrl).hostname.replace(/^www\./, '')
          } catch {
            hostname = ''
          }
          return (
            <TraceGlitch reason={t('atrium.error.imageFailed')}>
              <a
                href={clickThroughUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={clickThroughUrl}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {hostname ? `${t('atrium.error.openSource')} · ${hostname}` : t('atrium.error.openSource')} ↗
              </a>
            </TraceGlitch>
          )
        }
        
        // Otherwise, treat as iframe embed
        const embedUrl = extractEmbedUrl(trace.mediaUrl)
        if (!embedUrl) {
          return (
            <TraceGlitch reason={t('atrium.customize.invalidEmbed')} />
          )
        }
        return (
          <iframe
            src={embedUrl}
            // Sandboxed. Without this an embedded page can navigate the
            // top-level window, so one bad embed in a shared atrium
            // could send everyone who opens it somewhere else -- a
            // convincing place to ask for a password. Scripts,
            // same-origin, popups, forms and presentation are kept
            // because YouTube, Drive and Docs need them; top navigation
            // is exactly what is being withheld.
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
            className="w-full h-full select-none"
            scrolling="no"
            style={{ 
              pointerEvents: trace.enableInteraction ? 'auto' : 'none',
              overflow: 'hidden',
              border: 'none',
              clipPath: cropClip(shownCrop),
            }}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            onClick={(e) => {
              if (trace.enableInteraction) {
                e.stopPropagation() // Prevent trace selection when interacting
              }
            }}
            onDoubleClick={(e) => {
              if (trace.enableInteraction) {
                e.stopPropagation() // Prevent modal from opening
              }
            }}
            onLoad={() => {
              // Set 16:9 dimensions for embeds - use small viewport to avoid internal scrollbars
              if (!imageDimensions[trace.id]) {
                setImageDimensions(prev => ({
                  ...prev,
                  [trace.id]: { width: 480, height: 270 }
                }))
              }
            }}
          />
        )
      })()}

      {/* Text Content - laid out at its own size, then scaled to the box */}
      {trace.type === 'text' && (() => {
        // Calculate the actual pixel font size accounting for zoom and
        // the trace's own scale -- without the latter, resizing a text
        // trace grew its box while the glyphs stayed put.
        //
        // Geometric mean, not min(scaleX, scaleY): font-size is a
        // single scalar, so a non-uniform stretch has to pick one.
        // sqrt(sx*sy) is exact for uniform scaling -- including every
        // group transform, which is corner-only -- while staying
        // balanced when the axes differ.
        //
        // min() was wrong: a trace stretched wide and short (say
        // sx=2.2, sy=0.57) rendered its text at 0.57x, so text that
        // used to be legible shrank to a few pixels and looked like it
        // had vanished when zoomed out. The geometric mean tracks the
        // box's overall area instead, so a one-axis stretch never
        // shrinks text below its unscaled size.
        // Per-trace opt-out: with textScaleWithBox off the font size is
        // fixed and resizing the trace only changes how much room the
        // text has to reflow in.
        const baseFontSize = fontPxOf(fontSize)
        const rawScaleX = (transform as any).scaleX ?? 1
        const rawScaleY = (transform as any).scaleY ?? 1
        const scaleWithBox = trace.textScaleWithBox ?? true
        const traceScale = scaleWithBox
          ? (Math.sqrt(Math.max(0, rawScaleX * rawScaleY)) || 1)
          : 1
        // Laid out once, at the trace's own size -- the base font, 6px of
        // padding, the box divided back by this -- and scaled up to the box
        // as a whole. Laid out at the size on screen instead, as it was, the
        // lines broke differently at every zoom: the font was scaled but the
        // padding had a 4px floor, and a browser rounds glyph widths at small
        // sizes, so a zoomed-out box fitted more words to a line than a
        // zoomed-in one. Now only the picture scales; where the lines break is
        // decided once, the same way textFit measures it.
        //
        // Fitted to its box (textFit, new text traces): laid out in the box's
        // own size in the atrium, at the largest font the text fits at -- the
        // text typed so far, while it's being typed, so it shrinks as it grows.
        const editingText = inlineEditingTraceId === trace.id
        const fitted = trace.textFit === true
        const textScale = fitted ? zoom : traceScale * zoom
        const shownFontSize = fitted
          ? fitFontSize(editingText ? inlineEditText : trace.content ?? '', borderWidth / zoom, borderHeight / zoom, { family: resolveFontFamilyCss(fontFamily), bold: trace.textBold, italic: trace.textItalic })
          : baseFontSize
        // Where it sits up and down: the middle unless chosen.
        const valign = trace.textValign ?? 'middle'
        const textStyles = {
          fontSize: `${shownFontSize}px`,
          fontFamily: resolveFontFamilyCss(fontFamily),
          lineHeight: '1.3',
          fontWeight: (trace.textBold ? 'bold' : 'normal') as React.CSSProperties['fontWeight'],
          fontStyle: (trace.textItalic ? 'italic' : 'normal') as React.CSSProperties['fontStyle'],
          textDecoration: trace.textUnderline ? 'underline' : 'none',
          textAlign: (trace.textAlign ?? 'center') as React.CSSProperties['textAlign'],
          color: trace.textColor ?? '#ffffff',
        }
        return (
        <div
          className={`h-full w-full overflow-hidden ${inlineEditingTraceId === trace.id ? 'pointer-events-auto' : 'pointer-events-none select-none'}`}
          style={{
            clipPath: cropClip(shownCrop),
          }}
        >
        <div
          className={`flex flex-col items-center ${valign === 'top' ? 'justify-start' : valign === 'bottom' ? 'justify-end' : 'justify-center'}`}
          style={{
            width: `${100 / textScale}%`,
            height: `${100 / textScale}%`,
            padding: '6px',
            transform: `scale(${textScale})`,
            transformOrigin: '0 0',
          }}
        >
          {inlineEditingTraceId === trace.id ? (
            /* Inline editing: the very paragraph the text is shown in (below),
               made editable -- the same element, classes and styles, in the
               same place in its box -- so it sits, wraps and sizes exactly as
               it will once applied. It was a textarea filling the box, its
               text at the top, that jumped to the middle when applied. Filled
               once as it mounts, and left to the browser while typed in:
               setting its text again each keystroke would put the caret back
               at the start. */
            <div
              ref={el => {
                if (!el || el.dataset.filled) return
                el.dataset.filled = '1'
                el.innerText = inlineEditText
                el.focus()
                const range = document.createRange()
                range.selectNodeContents(el)
                range.collapse(false)
                const selection = window.getSelection()
                selection?.removeAllRanges()
                selection?.addRange(range)
              }}
              contentEditable="plaintext-only"
              suppressContentEditableWarning
              data-text-editor=""
              onInput={(e) => {
                const text = (e.currentTarget as HTMLElement).innerText
                setInlineEditText(text)
                on.fitTextLive(trace, text, baseFontSize, textStyles.fontFamily)
              }}
              onBlur={() => {
                on.endTextEdit(trace.id)
                setInlineEditingTraceId(null)
                setInlineEditText('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  on.endTextEdit(trace.id, true)
                  setInlineEditingTraceId(null)
                  setInlineEditText('')
                } else if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  on.endTextEdit(trace.id)
                  setInlineEditingTraceId(null)
                  setInlineEditText('')
                }
                e.stopPropagation()
              }}
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              // The frame an outline, drawn outside it, taking no room from
              // the text; a line high even when empty, so the caret shows.
              className="w-full min-w-0 break-words whitespace-pre-wrap overflow-hidden cursor-text outline outline-2 outline-offset-2 outline-white focus:outline-gray-400"
              style={{ ...textStyles, minHeight: '1.3em' }}
            />
          ) : (
            /* Normal display - text wraps and conforms to box.
               min-w-0 matters here: as a flex child (the parent is
               flex flex-col), this would otherwise default to
               min-width: auto and refuse to shrink below its
               content's intrinsic width, silently defeating
               break-words for a long unbroken string (e.g. a URL). */
            <p
              className="w-full min-w-0 break-words whitespace-pre-wrap overflow-hidden"
              style={textStyles}
            >
              {trace.content}
            </p>
          )}
        </div>
        </div>
        )
      })()}

          </div>
        </div>
        {dashed && (
          <svg
            aria-hidden="true"
            className="absolute pointer-events-none overflow-visible"
            width={outerW}
            height={outerH}
            style={{ left: '50%', top: '50%', marginLeft: -outerW / 2, marginTop: -outerH / 2 }}
          >
            <rect x={line / 2} y={line / 2} width={Math.max(0, outerW - line)} height={Math.max(0, outerH - line)} rx={Math.max(0, radius - line / 2)}
              fill="none" stroke={lineColour} strokeWidth={line} {...dash} />
          </svg>
        )}
        </>
        )
        })()}
        </>
      )}

      {/* Username label - outside border container so it doesn't scale.
          The same size at any zoom, and during one: see data-keeps-size in
          index.css. Its anchor, the top middle, is at its own 0 0 once the
          translate has centred it. */}
      {/* A frame: its edge, a few pixels either side of the border, is where
          it's taken hold of -- presses there reach the handlers above -- and
          its title sits over its top-left corner, the same size at any zoom.
          Double-click the title to rename it. */}
      {isFrame(trace) && (() => {
        const band = ((displayTrace.borderWidth ?? 2) * zoom) + FRAME_GRIP_PX * 2
        const edges: React.CSSProperties[] = [
          { left: -FRAME_GRIP_PX, right: -FRAME_GRIP_PX, top: -FRAME_GRIP_PX, height: band },
          { left: -FRAME_GRIP_PX, right: -FRAME_GRIP_PX, bottom: -FRAME_GRIP_PX, height: band },
          { top: -FRAME_GRIP_PX, bottom: -FRAME_GRIP_PX, left: -FRAME_GRIP_PX, width: band },
          { top: -FRAME_GRIP_PX, bottom: -FRAME_GRIP_PX, right: -FRAME_GRIP_PX, width: band },
        ]
        const renaming = inlineEditingTraceId === trace.id
        return (
          <>
            {edges.map((edge, i) => (
              <div key={i} data-frame-edge="" className="absolute pointer-events-auto cursor-move" style={edge} />
            ))}
            <div
              data-keeps-size=""
              data-frame-title=""
              className="absolute pointer-events-auto cursor-move text-xs font-semibold whitespace-nowrap select-none"
              style={{
                left: 0,
                top: 0,
                // Its anchor, the bottom left, at its own 0 0: the corner.
                transform: 'translateY(-100%)',
                paddingBottom: '4px',
                color: isSelected ? '#cbcbcb' : isMultiSelected ? '#86efac' : borderColor,
              }}
              title={canEdit ? t('atrium.frame.renameHint') : undefined}
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (!canEdit || isLockedTrace(trace)) return
                setSelectedTraceId(trace.id)
                setInlineEditingTraceId(trace.id)
                setInlineEditText(trace.content ?? '')
              }}
            >
              {renaming ? (
                <input
                  autoFocus
                  value={inlineEditText}
                  size={Math.max(6, inlineEditText.length + 1)}
                  onChange={(e) => setInlineEditText(e.target.value)}
                  onBlur={() => {
                    on.renameFrame(trace.id, inlineEditText)
                    setInlineEditingTraceId(null)
                    setInlineEditText('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      on.renameFrame(trace.id, inlineEditText)
                      setInlineEditingTraceId(null)
                      setInlineEditText('')
                    } else if (e.key === 'Escape') {
                      setInlineEditingTraceId(null)
                      setInlineEditText('')
                    }
                    e.stopPropagation()
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-0 border-b p-0 outline-none font-semibold text-xs"
                  style={{ color: 'inherit', borderColor: 'currentColor' }}
                />
              ) : (
                trace.content
              )}
            </div>
          </>
        )
      })()}

      {showFilename && trace.type !== 'shape' && !isFrame(trace) && (
        <div
          data-keeps-size=""
          className="absolute text-xs font-semibold text-center pointer-events-none"
          style={{
            bottom: `-${20}px`,
            left: '50%',
            transform: 'translateX(-50%)',
            color: borderColor,
            whiteSpace: 'nowrap',
          }}
        >
          {trace.username}
        </div>
      )}

      {/* Description label - shown to the right of media traces when enabled */}
      {showDescription && trace.content && (trace.type === 'image' || trace.type === 'video' || trace.type === 'embed') && (
        <div
          className="absolute text-xs pointer-events-none select-none"
          style={{
            left: `${borderWidth + 12}px`,
            top: '0px',
            maxWidth: '200px',
            color: 'rgba(255, 255, 255, 0.8)',
            lineHeight: '1.4',
            textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)',
          }}
        >
          {trace.content}
        </div>
      )}
    </div>

    {/* Transform controls (only for selected trace, not in crop mode, and only when this user can actually edit) */}
    {/* Hidden while the trace is on the move -- dragged, settling or
        gliding -- so only the trace itself is seen moving. */}
    {isSelected && !isCropMode && canEdit && inlineEditingTraceId !== trace.id && !movingIds.has(trace.id) && !glidingIds.has(trace.id) && (
      <>
        {/* Crop button for all trace types (not for path).

            Colours only in the transition. It was transition-all, and
            its position is left/top: every move of the trace became a
            150ms glide, so the button trailed behind a dragged trace.
            (Its hover:scale-105 never worked either -- the inline
            transform below overrides it.) */}
        {(trace.type !== 'shape' || trace.shapeType !== 'path') && !isFrame(trace) ? (
        <button
          data-trace-element="true"
          className="absolute text-[10px] font-semibold px-3 py-1.5 border pointer-events-auto z-10 transition-colors tracking-[0.18em] uppercase"
          style={{
            left: `${screenX}px`,
            top: `${screenY + (borderHeight / 2 + 30 * zoom)}px`,
            // Centred first, then scaled, so it stays under the middle
            // of the trace at any zoom.
            transform: `translate(-50%, 0) scale(${zoom})`,
            transformOrigin: 'top center',
            // Tokens, like the type badge. Every colour here was a
            // literal of the dark palette, so in light mode the button
            // came out dark-on-dark. Inline styles take
            // rgb(var(--x) / a) directly -- it is only Tailwind's
            // scanner that cannot see tokens inside arbitrary class
            // values.
            color: isCropMode ? 'rgb(var(--c-strong))' : 'rgb(var(--c-fg) / 0.8)',
            background: isCropMode ? 'rgb(var(--c-surface) / 0.98)' : 'rgb(var(--c-ground) / 0.94)',
            borderColor: isCropMode ? 'rgb(var(--c-fg) / 0.8)' : 'rgb(var(--c-line) / 0.7)',
            boxShadow: isCropMode ? '0 0 10px rgb(var(--c-fg) / 0.3)' : '0 0 8px rgb(var(--c-line) / 0.3)',
          }}
          onClick={(e) => {
            e.stopPropagation()
            setIsCropMode(!isCropMode)
            setTransformMode('none')
          }}
        >
          {isCropMode ? `✓ ${t('atrium.controls.cropDone')}` : `✂ ${t('atrium.controls.crop')}`}
        </button>
        ) : null}
      </>
    )}

    {/* Controls for a trace that is currently interactive.

        An embed with Enable Interaction on hands every click to the
        iframe -- which is the point, and also means the trace can no
        longer be picked up or, without opening Customize, switched
        back. So while it is on, it carries the two things it has just
        given away: a grip to move by, and the switch to turn it off.

        Shown whenever interaction is on, selected or not, because the
        problem they solve exists whether or not the trace happens to
        be selected -- an interactive embed you cannot grab is stuck
        regardless. They disappear the moment it is switched off,
        since the trace answers the pointer normally again.

        Below the trace, on the same line the crop button uses, and
        built from the same tokens so the row reads as one set of
        controls rather than three unrelated widgets. */}
    {trace.enableInteraction && canEdit && !movingIds.has(trace.id) && (
      <div
        className="absolute z-10 flex items-stretch gap-2 pointer-events-none"
        // Scaled with the camera, like the frame around the trace.
        //
        // Everything in here is sized in flat pixels -- the padding,
        // the type, the gap -- so at a distance the controls loomed
        // over a small trace and up close they shrank to nothing
        // beside a large one. The trace grows with the zoom; the
        // things attached to it have to grow with it too, which is the
        // same fix the border needed.
        style={{
          left: `${screenX - (borderWidth / 2)}px`,
          top: `${screenY + (borderHeight / 2 + 12 * zoom)}px`,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
        }}
      >
        {/* The grip. Starts the same drag the trace body would, so it
            behaves like a handle on the trace rather than a control
            of its own -- press and move and the trace comes with it. */}
        <button
          data-trace-element="true"
          title={t('atrium.customize.dragToMove')}
          aria-label={t('atrium.customize.dragToMove')}
          className="pointer-events-auto flex items-center justify-center px-2 border cursor-move transition-colors"
          style={{
            color: 'rgb(var(--c-fg) / 0.8)',
            background: 'rgb(var(--c-ground) / 0.94)',
            borderColor: 'rgb(var(--c-line) / 0.7)',
          }}
          onMouseDown={(e) => on.handleMouseDown(e, trace, 'move')}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          // The grip stands in for the trace while interaction is on,
          // so it has to answer a right-click the way the trace body
          // would -- otherwise Customize, Move to Group and the rest
          // are unreachable for exactly the traces that most need
          // them, since the embed swallows the right-click too.
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setSelectedTraceId(trace.id)
            setContextMenu({ x: e.clientX, y: e.clientY, traceId: trace.id })
          }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M6 1v10M1 6h10M6 1L4.4 2.6M6 1l1.6 1.6M6 11l-1.6-1.6M6 11l1.6-1.6M1 6l1.6-1.6M1 6l1.6 1.6M11 6L9.4 4.4M11 6L9.4 7.6" />
          </svg>
        </button>

        <button
          data-trace-element="true"
          className="pointer-events-auto text-[10px] font-semibold px-3 py-1.5 border transition-colors tracking-[0.18em] uppercase whitespace-nowrap"
          style={{
            color: 'rgb(var(--c-fg) / 0.8)',
            background: 'rgb(var(--c-ground) / 0.94)',
            borderColor: 'rgb(var(--c-line) / 0.7)',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            on.updateTraceCustomization(trace.id, { enableInteraction: false })
            if (editingTraceRef.current?.id === trace.id) {
              setEditingTrace({ ...editingTraceRef.current, enableInteraction: false })
            }
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {t('atrium.menu.disableInteraction')}
        </button>
      </div>
    )}

    {/* Locked and selected: a lock at its top right corner, which unlocks
        it -- as Excalidraw shows one. Only while selected; otherwise a
        locked trace looks like any other. */}
    {isSelected && canEdit && isLockedTrace(trace) && !movingIds.has(trace.id) && (
      <button
        data-trace-element="true"
        data-lock-button=""
        title={t('atrium.menu.unlock')}
        aria-label={t('atrium.menu.unlock')}
        className="absolute z-10 pointer-events-auto flex items-center justify-center w-7 h-7 border transition-colors hover:brightness-125"
        style={{
          left: `${screenX + borderWidth / 2}px`,
          top: `${screenY - borderHeight / 2 - 8 * zoom}px`,
          transform: `translate(-100%, -100%) scale(${zoom})`,
          transformOrigin: 'bottom right',
          color: 'rgb(var(--c-fg) / 0.9)',
          background: 'rgb(var(--c-ground) / 0.94)',
          borderColor: 'rgb(var(--c-line) / 0.7)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          on.updateTraceCustomization(trace.id, UNLOCKED)
          if (editingTraceRef.current?.id === trace.id) setEditingTrace({ ...editingTraceRef.current, ...UNLOCKED })
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <rect x="3" y="7" width="10" height="7" />
          <path d="M5 7V5a3 3 0 0 1 6 0v2" />
        </svg>
      </button>
    )}

  </div>
</div>
)
  }

  return (
    <div style={{ cursor: 'none', pointerEvents: 'none', touchAction: 'none' }}>
      {/* Everything anchored to the world -- traces and their handles -- in
          one layer, with the cursors drawn after it, above. */}
      {/* The edge fade: a mask on this wrapper, which stays put while the
          camera moves the world layer inside it. */}
      {/* Isolated, fade or no fade (the fade's mask isolates it too): the
          levels inside -- traces, their handles, far past everything else's
          -- stay among themselves. Without it, with the fade off and the
          camera at rest, a selected trace's handles came up over the HUD and
          the drawing surface, and went back under them whenever the camera
          moved. */}
      <div className={traceFadeEnabled ? 'world-vignette' : undefined} style={{ position: 'absolute', inset: 0, isolation: 'isolate' }}>
      <div
        ref={worldLayerRef}
        style={{ position: 'absolute', inset: 0, transformOrigin: '0 0' }}
        // A selected trace's handles are its own: a right-click on one opens
        // its menu, as one on the trace does. They're drawn apart from it,
        // so they had none -- and a thin trace, a stroke turned on its side,
        // can be nearly all handles. One place for every kind of handle.
        onContextMenu={(e) => {
          if (!selectedTraceId || !(e.target as HTMLElement).closest?.('.trace-nier-handle, .trace-nier-handle-center, .trace-rotate-handle')) return
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, traceId: selectedTraceId })
        }}
      >
      {/* Render traces AND player in z-index order */}
      {/* Connections, each at the level of the lower of its two traces,
          just under it, and drawn from border to border. Worked out from the
          traces' positions, not from what's on screen, so a thread to a
          trace far off (and not drawn) still runs off toward it. */}
      <TraceLinksLayer
        links={links}
        place={placeTrace}
        offsets={dragOffsetsRef}
        zoom={zoom}
        worldOffset={worldOffset}
        selected={selectedLinks}
        preview={connectFrom && connectPointer ? { from: connectFrom, to: connectPointer } : null}
        canEdit={canEdit}
        onPress={pressLink}
        onMenu={openLinkMenu}
        onElbowAt={dragElbow}
        wakeRef={wakeLinksRef}
      />

      {sortedItems.filter(item => item.type !== 'player').map(renderSortedItem)}

        {/* The selected path's handles, over everything else of the world:
            a square on each point, a fainter round one between each two
            that adds a point there, and on a curve the selected point's two
            handles. In one wrapper marked as the trace's, so a click that
            starts on one handle and ends on another -- a point added under
            the pointer -- lands on the wrapper, not the canvas, and doesn't
            let go of the path. */}
        {selectedTraceId && canEdit && (() => {
          const trace = traces.find(t => t.id === selectedTraceId)
          if (!trace || trace.type !== 'shape' || trace.shapeType !== 'path' || isLockedTrace(trace)) return null

          const displayTrace = (editingTrace && editingTrace.id === trace.id) ? editingTrace : trace
          const points: PathPoint[] = localShapePoints[trace.id] || displayTrace.shapePoints || []
          const curve: PathCurve = displayTrace.pathCurveType ?? 'straight'
          const screenOf = (p: { x: number; y: number }) => {
            const { screenX, screenY } = getScreenPosition(p.x, p.y)
            return { x: screenX, y: screenY }
          }
          const at = (p: { x: number; y: number }) => ({ left: `${p.x}px`, top: `${p.y}px`, transform: 'translate(-50%, -50%)' })
          const selected = selectedPointIndex !== null ? points[selectedPointIndex] : undefined
          const last = points.length - 1
          // The end being added to, while adding.
          const addingEnd = pathCreationMode ? (pathAddAt === 'start' ? 0 : last) : null

          // A point added between points i and i + 1, where the line runs,
          // and taken hold of: a drag places it, a click leaves it there.
          // Put into the drag's working copy (the ref too, which the drag
          // reads before React has rendered), so letting go saves it with
          // the move as one step.
          const addBetween = (i: number, press: () => void) => {
            const added = pointBetween(points, curve, i)
            const next = [...points.slice(0, i + 1), { x: added.x, y: added.y }, ...points.slice(i + 1)]
            localShapePointsRef.current = { ...localShapePointsRef.current, [trace.id]: next }
            setLocalShapePoints(prev => ({ ...prev, [trace.id]: next }))
            setSelectedPointIndex(i + 1)
            press()
          }

          // A curve handle of the selected point, and its dashed line to it.
          const curveHandle = (mode: 'control-in' | 'control-out', handle: { x: number; y: number }) => {
            const h = screenOf(handle)
            return (
              <div
                key={mode}
                data-keeps-size="" className="absolute trace-nier-handle trace-nier-handle-control cursor-move pointer-events-auto z-[1000000]"
                style={at(h)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  handleMouseDown(e, trace, mode, `${selectedPointIndex}`)
                }}
                onTouchStart={(e) => {
                  e.stopPropagation()
                  handleTouchDown(e, trace, mode, `${selectedPointIndex}`)
                }}
              />
            )
          }
          const handles = curve === 'bezier' && selected && selectedPointIndex !== null ? handlesAt(points, selectedPointIndex) : null
          // An end's outer handle shapes nothing, so it isn't shown.
          const showIn = handles && selectedPointIndex! > 0
          const showOut = handles && selectedPointIndex! < last
          const from = selected ? screenOf(selected) : null
          const addFrom = addingEnd !== null && points[addingEnd] ? screenOf(points[addingEnd]) : null

          return (
            <div data-trace-element="true" data-path-of={trace.id} className="contents">
              <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible', zIndex: 999999 }}>
                {from && showIn && (() => { const h = screenOf(handles!.cp1); return <line x1={from.x} y1={from.y} x2={h.x} y2={h.y} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 2" /> })()}
                {from && showOut && (() => { const h = screenOf(handles!.cp2); return <line x1={from.x} y1={from.y} x2={h.x} y2={h.y} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 2" /> })()}
                {/* Adding points: a dashed run from the end to the pointer. */}
                {addFrom && pathPointer && transformMode === 'none' && (
                  <line x1={addFrom.x} y1={addFrom.y} x2={pathPointer.x} y2={pathPointer.y} strokeOpacity={0.6} strokeWidth="1.5" strokeDasharray="6 5" style={{ stroke: 'rgb(var(--c-fg))' }} />
                )}
                {/* Shift over a trace: its border, the marks on it, and where
                    the point went. */}
                {borderSnap && (() => {
                  const marks = borderMarks(borderSnap.box).map(screenOf)
                  const hit = screenOf(borderSnap.at)
                  const c = screenOf({ x: borderSnap.box.cx, y: borderSnap.box.cy })
                  return (
                    <g data-border-snap="">
                      {borderSnap.box.round
                        ? <ellipse cx={c.x} cy={c.y} rx={borderSnap.box.halfW * zoom} ry={borderSnap.box.halfH * zoom} transform={`rotate(${borderSnap.box.rotation} ${c.x} ${c.y})`} fill="none" strokeOpacity={0.55} strokeWidth="1.5" strokeDasharray="5 4" style={{ stroke: 'rgb(var(--c-fg))' }} />
                        : <polygon points={[0, 2, 4, 6].map(i => `${marks[i].x},${marks[i].y}`).join(' ')} fill="none" strokeOpacity={0.55} strokeWidth="1.5" strokeDasharray="5 4" style={{ stroke: 'rgb(var(--c-fg))' }} />}
                      {marks.map((m, i) => {
                        const on = Math.hypot(m.x - hit.x, m.y - hit.y) < 0.5
                        return <rect key={i} x={m.x - (on ? 4 : 2.5)} y={m.y - (on ? 4 : 2.5)} width={on ? 8 : 5} height={on ? 8 : 5} strokeWidth="1" style={{ fill: on ? 'rgb(var(--c-fg))' : 'rgb(var(--c-ground))', stroke: 'rgb(var(--c-fg))' }} />
                      })}
                      <circle cx={hit.x} cy={hit.y} r={5} fill="none" strokeWidth="1.5" style={{ stroke: 'rgb(var(--c-fg))' }} />
                    </g>
                  )
                })()}
              </svg>

              {/* Between each two points, far enough apart on screen to
                  leave room for it. */}
              {points.slice(0, -1).map((point, i) => {
                const a = screenOf(point), b = screenOf(points[i + 1])
                if (Math.hypot(b.x - a.x, b.y - a.y) < 36) return null
                return (
                  <div
                    key={`mid-${i}`}
                    data-path-mid={i}
                    title={t('atrium.controls.pathMidHint')}
                    data-keeps-size="" className="absolute trace-nier-handle trace-nier-handle-mid cursor-copy pointer-events-auto z-[1000000]"
                    style={at(screenOf(pointBetween(points, curve, i)))}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      addBetween(i, () => handleMouseDown(e, trace, 'point', `${i + 1}`))
                    }}
                    onTouchStart={(e) => {
                      e.stopPropagation()
                      addBetween(i, () => handleTouchDown(e, trace, 'point', `${i + 1}`))
                    }}
                  />
                )
              })}

              {points.map((point, index) => {
                const isEnd = points.length > 1 && (index === 0 || index === last)
                return (
                  <div
                    key={`handle-${index}`}
                    data-path-point={index}
                    title={t(isEnd ? 'atrium.controls.pathEndHint' : 'atrium.controls.pathPointHint')}
                    data-keeps-size="" className={`absolute trace-nier-handle trace-nier-handle-point cursor-move pointer-events-auto z-[1000000] ${
                      selectedPointIndex === index || addingEnd === index ? 'trace-nier-handle-active' : ''
                    }`}
                    style={at(screenOf(point))}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setSelectedPointIndex(index)
                      handleMouseDown(e, trace, 'point', `${index}`)
                    }}
                    onTouchStart={(e) => {
                      e.stopPropagation()
                      setSelectedPointIndex(index)
                      handleTouchDown(e, trace, 'point', `${index}`)
                    }}
                  />
                )
              })}

              {showIn && curveHandle('control-in', handles!.cp1)}
              {showOut && curveHandle('control-out', handles!.cp2)}


              {/* Adding points: what a click does now, above the pointer
                  (its name tag is below it), and toward the middle of the
                  screen so it stays on it. */}
              {pathCreationMode && pathPointer && (
                <div
                  className="fixed pointer-events-none font-mono text-[10px] tracking-wider px-2 py-1 border whitespace-nowrap"
                  style={{
                    left: pathPointer.x, top: pathPointer.y - 18, zIndex: 1000001,
                    transform: pathPointer.x > window.innerWidth / 2 ? 'translate(calc(-100% - 14px), -100%)' : 'translate(14px, -100%)',
                    color: 'rgb(var(--c-fg))', background: 'rgb(var(--c-ground) / 0.9)', borderColor: 'rgb(var(--c-fg) / 0.3)',
                  }}
                >
                  {t('atrium.controls.addingPointsHint')}
                </div>
              )}
            </div>
          )
        })()}

        {/* Render regular handles (corner, edge, rotation) as absolute overlay for non-path shapes */}
        {/* Also show for paths when they're part of a multi-selection so they can be moved together */}
        {/* Suppressed once a real multi-selection exists -- the group handles
            below take over, and showing both would put two overlapping,
            differently-pivoted handle sets on the same trace. */}
        {selectedTraceId && !isCropMode && multiSelectedIds.size <= 1 && !movingIds.has(selectedTraceId) && !glidingIds.has(selectedTraceId) && (() => {
          const trace = traces.find(t => t.id === selectedTraceId)
          // Must check membership (has), not just multiSelectedIds.size > 0 --
          // that alone made ANY solo-selected path get the full non-path
          // corner/edge/rotate handle box (sized to its unrelated default
          // width/height, positioned at its stale x/y -- see the path
          // zoom-visibility fix) whenever the user simply had some OTHER,
          // unrelated multi-selection active, which looked like a random
          // "empty box" appearing around freshly-selected paths.
          // A locked trace can't be sized or turned: no handles to suggest it.
          if (trace && isLockedTrace(trace)) return null
          const isPathInMultiSelect = trace?.type === 'shape' && trace?.shapeType === 'path' && multiSelectedIds.has(trace.id)
          // Hide for paths unless they're in a multi-selection
          if (!trace || (trace.type === 'shape' && trace.shapeType === 'path' && !isPathInMultiSelect)) return null
          
          const transform = localTraceTransforms[trace.id] || getTraceTransform(trace)
          const { width, height } = getTraceSize(trace)

          // Get dimensions with scale and crop applied (same as in main trace rendering)
          const cropWidth = trace.cropWidth ?? 1
          const cropHeight = trace.cropHeight ?? 1

          // A path is where its points are. The nine handles below -- four
          // corners, four edges, and the rotation one above them -- are all
          // placed from screenX/screenY and borderWidth/borderHeight, so
          // measuring those from the points moves the whole set at once.
          //
          // Without this they were drawn at the stored x/y, at the stored size,
          // which for a path is the box it was created in and never moves
          // again: a full set of handles floating around nothing, some distance
          // from the line they belong to. Same cause as the selection box in
          // c802cc4 and the marquee hit test in 237e52a, and the fourth place
          // to make it -- which is why the measurement is one shared function.
          const pathBox = isPathTrace(trace)
            ? pathWorldBounds(localShapePoints[trace.id] || trace.shapePoints, trace.shapeOutlineWidth ?? 2)
            : null

          const { screenX, screenY } = getScreenPosition(
            pathBox ? (pathBox.minX + pathBox.maxX) / 2 : transform.x,
            pathBox ? (pathBox.minY + pathBox.maxY) / 2 : transform.y,
          )

          const shapeWidth = trace.type === 'shape' ? (trace.width || 200) : width
          const shapeHeight = trace.type === 'shape' ? (trace.height || 200) : height
          // A path's points already carry whatever scaling it has been given,
          // so its extent is not multiplied by scaleX/scaleY the way a stored
          // width is.
          const borderWidth = pathBox
            ? (pathBox.maxX - pathBox.minX) * zoom
            : (trace.type === 'shape' ? shapeWidth : width * cropWidth) * (transform as any).scaleX * zoom
          const borderHeight = pathBox
            ? (pathBox.maxY - pathBox.minY) * zoom
            : (trace.type === 'shape' ? shapeHeight : height * cropHeight) * (transform as any).scaleY * zoom
          
          return (
            <>
              {/* Corner handles for scaling */}
              {['tl', 'tr', 'bl', 'br'].map((corner) => {
                const offsetX = corner.includes('r') ? (borderWidth / 2) : -(borderWidth / 2)
                const offsetY = corner.includes('b') ? (borderHeight / 2) : -(borderHeight / 2)
                
                // Apply rotation to handle positions
                const rad = (transform.rotation * Math.PI) / 180
                const cos = Math.cos(rad)
                const sin = Math.sin(rad)
                const rotatedX = offsetX * cos - offsetY * sin
                const rotatedY = offsetX * sin + offsetY * cos
                
                return (
                  <div
                    key={corner}
                    data-trace-element="true"
                    data-keeps-size="" className="absolute trace-nier-handle trace-nier-handle-corner cursor-nwse-resize pointer-events-auto z-[1000000]"
                    style={{
                      left: `${screenX + rotatedX}px`,
                      top: `${screenY + rotatedY}px`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    onMouseDown={(e) => handleMouseDown(e, trace, 'scale', corner)}
                    onTouchStart={(e) => handleTouchDown(e, trace, 'scale', corner)}
                  />
                )
              })}

              {/* Edge handles for non-uniform scaling */}
              {['t', 'r', 'b', 'l'].map((edge) => {
                let offsetX = 0
                let offsetY = 0
                
                if (edge === 't') offsetY = -(borderHeight / 2)
                else if (edge === 'b') offsetY = (borderHeight / 2)
                else if (edge === 'l') offsetX = -(borderWidth / 2)
                else if (edge === 'r') offsetX = (borderWidth / 2)
                
                // Apply rotation to handle positions
                const rad = (transform.rotation * Math.PI) / 180
                const cos = Math.cos(rad)
                const sin = Math.sin(rad)
                const rotatedX = offsetX * cos - offsetY * sin
                const rotatedY = offsetX * sin + offsetY * cos
                
                const cursorClass = (edge === 't' || edge === 'b') ? 'cursor-ns-resize' : 'cursor-ew-resize'
                
                return (
                  <div
                    key={edge}
                    data-trace-element="true"
                    data-keeps-size="" className={`absolute trace-nier-handle trace-nier-handle-edge pointer-events-auto z-[1000000] ${cursorClass}`}
                    style={{
                      left: `${screenX + rotatedX}px`,
                      top: `${screenY + rotatedY}px`,
                      transform: 'translate(-50%, -50%)',
                    }}
                    onMouseDown={(e) => handleMouseDown(e, trace, 'scale', edge)}
                    onTouchStart={(e) => handleTouchDown(e, trace, 'scale', edge)}
                  />
                )
              })}

              {/* Rotation, round every corner, turned with the trace. A frame
                  doesn't turn: what it holds would have to turn with it. */}
              {!isFrame(trace) && (
              <RotateHandles
                cx={screenX}
                cy={screenY}
                halfW={borderWidth / 2}
                halfH={borderHeight / 2}
                rotation={transform.rotation}
                zIndex={1000000}
                onMouseDown={(e) => handleMouseDown(e, trace, 'rotate')}
                onTouchStart={(e) => handleTouchDown(e, trace, 'rotate')}
              />
              )}
            </>
          )
        })()}

        {/* Crop mode: over the whole content -- the trace shows all of it
            while it's cropped -- the window being kept, with what's cut
            away dimmed. Above every trace, turned with this one. Each edge
            and corner has a handle, and dragging the window slides it over
            the content (lib/traceCrop). */}
        {selectedTraceId && isCropMode && canEdit && (() => {
          const trace = traces.find(t => t.id === selectedTraceId)
          if (!trace || isPathTrace(trace)) return null
          const tf = localTraceTransforms[trace.id] || getTraceTransform(trace)
          const { width, height } = getTraceSize(trace)
          const boxW = (trace.type === 'shape' ? (trace.width || 200) : width) * tf.scaleX * zoom
          const boxH = (trace.type === 'shape' ? (trace.height || 200) : height) * tf.scaleY * zoom
          const crop = cropOf(trace)
          const { screenX, screenY } = getScreenPosition(tf.x, tf.y)
          const back = trace.type === 'shape' ? { x: 0, y: 0 } : (() => {
            const b = boxFromWindow(crop)
            return turn(b.u * boxW, b.v * boxH, tf.rotation)
          })()
          const grab = (key: string) => ({
            onMouseDown: (e: React.MouseEvent) => { e.stopPropagation(); handleMouseDown(e, trace, 'crop', key) },
            onTouchStart: (e: React.TouchEvent) => { e.stopPropagation(); handleTouchDown(e, trace, 'crop', key) },
          })
          const kept = { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }
          return (
            <div
              data-trace-element="true"
              className="absolute pointer-events-auto z-[1000000]"
              style={{
                left: `${screenX + back.x}px`,
                top: `${screenY + back.y}px`,
                width: `${boxW}px`,
                height: `${boxH}px`,
                transform: `translate(-50%, -50%) rotate(${tf.rotation}deg)`,
                outline: '1px dashed rgba(203, 203, 203, 0.55)',
              }}
              // The cut-away part holds still: pressing it neither moves
              // the trace nor ends the crop.
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              {/* One shadow round the window, clipped to the box. */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute" style={{ ...kept, boxShadow: '0 0 0 100000px rgba(12, 12, 16, 0.62)' }} />
              </div>
              <div
                className="absolute cursor-move"
                style={{ ...kept, border: '1px solid rgba(235, 235, 235, 0.95)', boxShadow: '0 0 0 1px rgba(20, 20, 20, 0.6)' }}
                {...grab('m')}
              />
              {CROP_HANDLES.map(({ key, u, v }) => (
                <div
                  key={key}
                  data-trace-element="true"
                  data-keeps-size=""
                  className={`absolute trace-nier-handle ${key.length === 2 ? 'trace-nier-handle-crop' : 'trace-nier-handle-edge'} pointer-events-auto`}
                  style={{ left: `${(crop.x + u * crop.w) * 100}%`, top: `${(crop.y + v * crop.h) * 100}%`, transform: 'translate(-50%, -50%)' }}
                  {...grab(key)}
                />
              ))}
            </div>
          )
        })()}

        {/* Group transform handles -- one shared box around the whole
            multi-selection. Corners scale and the top handle rotates, both
            pivoting on the box's center so the selection transforms as a
            single rigid unit. Corner-only (no edge handles): a non-uniform
            group scale would shear any child that has its own rotation. */}
        {multiSelectedIds.size > 1 && canEdit && !isCropMode && movingIds.size === 0 && glidingIds.size === 0 && (() => {
          const bounds = getGroupBounds(Array.from(multiSelectedIds))
          if (!bounds) return null

          const topLeft = getScreenPosition(bounds.minX, bounds.minY)
          const bottomRight = getScreenPosition(bounds.maxX, bounds.maxY)
          const boxLeft = topLeft.screenX
          const boxTop = topLeft.screenY
          const boxWidth = bottomRight.screenX - topLeft.screenX
          const boxHeight = bottomRight.screenY - topLeft.screenY

          // The box is the group's outline when a group alone is selected; with
          // more selected, each group selected whole has an outline of its own.
          const several = [...multiSelectedIds].some(id => !inWholeGroup.has(id)) || wholeGroups.groups.size > 1
          return (
            <>
              {several && [...wholeGroups.groups].map(([group, members]) => {
                const b = getGroupBounds(members)
                if (!b) return null
                const tl = getScreenPosition(b.minX, b.minY), br = getScreenPosition(b.maxX, b.maxY)
                return (
                  <div
                    key={`outline-${group}`}
                    data-group-outline={group}
                    className="absolute pointer-events-none z-[999998]"
                    style={{ left: `${tl.screenX}px`, top: `${tl.screenY}px`, width: `${br.screenX - tl.screenX}px`, height: `${br.screenY - tl.screenY}px`, border: '1px solid rgba(134, 239, 172, 0.55)' }}
                  />
                )
              })}
              <div
                data-selection-box=""
                className="absolute pointer-events-none z-[999998]"
                style={{
                  left: `${boxLeft}px`,
                  top: `${boxTop}px`,
                  width: `${boxWidth}px`,
                  height: `${boxHeight}px`,
                  border: '1px dashed rgba(134, 239, 172, 0.7)',
                }}
              />
              {['tl', 'tr', 'bl', 'br'].map((corner) => (
                <div
                  key={`group-${corner}`}
                  data-trace-element="true"
                  data-keeps-size="" className="absolute trace-nier-handle trace-nier-handle-corner cursor-nwse-resize pointer-events-auto z-[1000001]"
                  style={{
                    left: `${corner.includes('r') ? boxLeft + boxWidth : boxLeft}px`,
                    top: `${corner.includes('b') ? boxTop + boxHeight : boxTop}px`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onMouseDown={(e) => handleGroupMouseDown(e, 'group-scale', corner)}
                  onTouchStart={(e) => handleGroupTouchDown(e, 'group-scale', corner)}
                />
              ))}
              <RotateHandles
                cx={boxLeft + boxWidth / 2}
                cy={boxTop + boxHeight / 2}
                halfW={boxWidth / 2}
                halfH={boxHeight / 2}
                rotation={0}
                zIndex={1000001}
                onMouseDown={(e) => handleGroupMouseDown(e, 'group-rotate')}
                onTouchStart={(e) => handleGroupTouchDown(e, 'group-rotate')}
              />
            </>
          )
        })()}

        {/* Other people's cursors, in the world layer: placed in the world,
            they move with it while a pan or zoom scales the layer whole. */}
        {!hideOtherCursors && Object.entries(otherUsers).map(([odUserId, user]) => {
          const userScreenX = user.x * zoom + worldOffset.x
          const userScreenY = user.y * zoom + worldOffset.y
          const userColor = user.playerColor || '#ffffff'

          const rgb = hexToRgb(userColor)
          const otherCursorEdge = cursorEdgeOn(atriumBackground)

          return (
            <div
              key={`other-user-${odUserId}`}
              style={{
                position: 'absolute',
                left: userScreenX,
                top: userScreenY,
                pointerEvents: 'none',
                transition: 'left 0.15s ease-out, top 0.15s ease-out',
                zIndex: OTHER_USER_CURSOR_Z_INDEX,
              }}
            >
              {/* Cursor pointer SVG */}
              <svg
                width={20 * zoom}
                height={20 * zoom}
                viewBox="0 0 24 24"
                style={{ 
                  transform: 'translate(-2px, -2px)',
                }}
              >
                <path
                  d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                  fill={userColor}
                  stroke={otherCursorEdge}
                  strokeWidth="1.5"
                />
              </svg>
              {/* User label -- see the own-player label above for why dark
                  user colors get a different (light-glow) treatment instead
                  of glowing/blending into their own dark background. */}
              {!hideOtherNameTags && (() => {
                const luminance = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
                const isDarkColor = luminance < 90
                return (
                <div
                  style={{
                    position: 'absolute',
                    top: 16 * zoom,
                    left: 10 * zoom,
                    color: userColor,
                    fontSize: `${10 * zoom}px`,
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    textShadow: isDarkColor
                      ? '0 0 5px rgba(255,255,255,0.9), 0 0 2px rgba(255,255,255,0.9)'
                      : `0 0 6px rgba(${rgb.r},${rgb.g},${rgb.b},0.4), 0 2px 4px rgba(0,0,0,0.8)`,
                    WebkitTextStroke: isDarkColor ? '0.5px rgba(255,255,255,0.6)' : undefined,
                    letterSpacing: '0.5px',
                    background: isDarkColor ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.6)',
                    border: isDarkColor ? '1px solid rgba(255,255,255,0.35)' : '1px solid transparent',
                    padding: '2px 5px',
                    borderRadius: '3px',
                  }}
                >
                  {user.username}
                </div>
                )
              })()}
            </div>
          )
        })}
      </div>
      </div>

        {linkMenuAt && (
          <LinkMenu
            at={linkMenuAt}
            links={links.filter(l => selectedLinks.has(l.id))}
            borderOf={link => placeTrace(link.from)?.colour ?? '#8f8f8f'}
            onEdit={editLinks}
            onDelete={() => deleteLinks(selectedLinksRef.current)}
            onClose={() => setLinkMenuAt(null)}
          />
        )}

        {/* While connecting: what to do next, and how not to. */}
        {connectFrom && (
          <div
            className="fixed left-1/2 bottom-10 -translate-x-1/2 z-[10000050] pointer-events-none font-mono border px-5 py-3 text-center"
            style={{ background: 'rgb(var(--c-ground) / 0.94)', borderColor: 'rgb(var(--c-line) / 0.7)' }}
          >
            <div className="text-nier-strong text-xs tracking-[0.22em] uppercase">{t('atrium.links.pickTarget')}</div>
            <div className="text-nier-bg/60 text-[10px] tracking-[0.18em] uppercase mt-1">{t('atrium.links.escToCancel')}</div>
          </div>
        )}

        {/* The player's own cursor, above everything, as it always was. */}
        {sortedItems.filter(item => item.type === 'player').map(renderSortedItem)}



      {/* Live rotation angle, shown only during a rotate drag. Offset from the
          cursor so it never sits under the pointer, and pointer-events-none so
          it can't intercept the drag it's reporting on. */}
      {/* The lines showing what a Shift-drag caught.

          Drawn only while one is held, and only along the span the two traces
          share -- a line running the width of the atrium says "something,
          somewhere, is aligned"; one that reaches from the trace being moved
          to the trace it matched says which. That span is computed as the
          drag happens (see findAlignment's callers) and arrives here in world
          coordinates, converted to the screen here so the guide sits exactly
          on the edge it describes at any zoom.

          pointer-events-none throughout: a guide is a statement about the
          drag, never a thing to catch the cursor mid-drag. */}
      {alignGuides && (
        <div className="fixed inset-0 pointer-events-none z-[60]">
          {alignGuides.x && (
            <div
              className="absolute"
              style={{
                left: `${alignGuides.x.at * zoom + worldOffset.x}px`,
                top: `${alignGuides.x.from * zoom + worldOffset.y}px`,
                height: `${(alignGuides.x.to - alignGuides.x.from) * zoom}px`,
                width: '1px',
                background: 'rgb(var(--c-orange))',
                boxShadow: '0 0 4px rgb(var(--c-orange) / 0.6)',
              }}
            />
          )}
          {alignGuides.y && (
            <div
              className="absolute"
              style={{
                left: `${alignGuides.y.from * zoom + worldOffset.x}px`,
                top: `${alignGuides.y.at * zoom + worldOffset.y}px`,
                width: `${(alignGuides.y.to - alignGuides.y.from) * zoom}px`,
                height: '1px',
                background: 'rgb(var(--c-orange))',
                boxShadow: '0 0 4px rgb(var(--c-orange) / 0.6)',
              }}
            />
          )}
        </div>
      )}

      {rotationReadout && (
        <div
          style={{
            position: 'fixed',
            left: rotationReadout.screenX + 18,
            top: rotationReadout.screenY - 34,
            zIndex: 10000300,
            pointerEvents: 'none',
            background: 'rgba(0,0,0,0.9)',
            border: `1px solid ${rotationReadout.snapped ? '#86efac' : '#cbcbcb'}`,
            color: rotationReadout.snapped ? '#86efac' : '#cbcbcb',
            padding: '3px 8px',
            fontSize: '11px',
            fontFamily: 'monospace',
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
          }}
        >
          {rotationReadout.delta && rotationReadout.angle >= 0 ? '+' : ''}
          {rotationReadout.angle.toFixed(rotationReadout.snapped ? 0 : 1)}°
          {rotationReadout.snapped && (
            <span style={{ opacity: 0.7, marginLeft: 6 }}>{t('atrium.controls.snapDegrees', { value: ROTATION_SNAP_DEGREES })}</span>
          )}
        </div>
      )}

      {/* Context Menu -- hidden entirely (not just the edit items) when
          canEdit is false, since even inspecting via this menu leads only to
          editing actions */}
      {contextMenu && canEdit && (() => {
        // Side flyouts (Move Layer, Transformations) open to the right of
        // the menu by default; flip to the left if there isn't roughly
        // enough room for one (menu width + flyout width) between the
        // click point and the right edge of the viewport.
        // Uses the clamped x, not the raw click point: near the right edge the
        // menu itself has been shifted left, so the flyout decision has to be
        // made against where the menu actually is.
        const contextMenuFlyoutOnLeft = contextMenuPos.x > window.innerWidth - 400
        // Right-clicking inside a multi-selection is a question about the
        // selection, not about the one trace under the pointer. Customize
        // edits that one trace and silently drops the rest, so it is not
        // offered here -- Batch Edit is the answer to what was asked.
        // Right-clicking a trace *outside* the selection still means that
        // trace, and still offers Customize.
        const editingWholeSelection =
          multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
        return (
        <>
          {/* Menu */}
          <div
            ref={contextMenuRef}
            className="fixed bg-nier-black border border-nier-border/60 shadow-2xl py-1 z-[10000100] pointer-events-auto max-h-[80vh] overflow-y-auto"
            style={{ left: `${contextMenuPos.x}px`, top: `${contextMenuPos.y}px` }}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-gray-400 pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-gray-400 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-gray-400 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-gray-400 pointer-events-none" />
            
            {!editingWholeSelection && (
              <button
                className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                onClick={() => {
                  const trace = traces.find(t => t.id === contextMenu.traceId)
                  if (trace) setEditingTrace(trace)
                  setShowBatchEditPanel(false)
                  setContextMenu(null)
                }}
              >
                <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.customize')}
              </button>
            )}
            {/* This trace's look, to give to others; the look copied, given to
                this trace -- or, right-clicked in a selection, to all of it. */}
            <button
              className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                copyTraceStyle(contextMenu.traceId)
                setContextMenu(null)
              }}
            >
              <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.copyStyle')}
            </button>
            {copiedStyle() && (
              <button
                className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                onClick={() => {
                  pasteTraceStyle(editingWholeSelection ? [...multiSelectedIds] : [contextMenu.traceId])
                  setContextMenu(null)
                }}
              >
                <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.pasteStyle')}
              </button>
            )}
            {/* This trace -- or, right-clicked in a selection, all of it -- out
                as a picture or an .atrium file. */}
            {onExport && (
              <button
                className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                onClick={() => {
                  onExport(editingWholeSelection ? [...multiSelectedIds] : [contextMenu.traceId])
                  setContextMenu(null)
                }}
              >
                <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.export.open')}
              </button>
            )}
            {/* Back into drawing mode on this drawing -- all its strokes (lib/brushes
                drawingOf) -- to draw on and erase from, where they are. */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!canEdit || !onEditDrawing || !trace?.mediaUrl || !isDrawingTrace(trace)) return null
              const members = new Set(drawingOf(trace, traces, layers).members.map(t => t.id))
              // In a selection only when the selection is this drawing: its
              // group, which a right-click takes whole.
              if (editingWholeSelection && ![...multiSelectedIds].every(id => members.has(id))) return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={() => {
                    // Their store copies are current; a leftover drag override
                    // would go on showing the old placement over the edited one.
                    setLocalTraceTransforms(prev => {
                      if (!Object.keys(prev).some(id => members.has(id))) return prev
                      const next = { ...prev }
                      for (const id of members) delete next[id]
                      return next
                    })
                    setSelectedTraceId(null)
                    setMultiSelectedIds(new Set())
                    setContextMenu(null)
                    onEditDrawing(trace.id)
                  }}
                >
                  <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.editDrawing')}
                </button>
              )
            })()}
            {/* A drawing apart into its strokes, each a trace, in a group
                where it was (lib/drawingFiles splitDrawing). */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              const kept = trace && asStrokeData(trace.strokeData)
              if (!canEdit || !trace || !kept || kept.kind !== 'drawing' || strokesIn(kept).length < 2) return null
              if (editingWholeSelection && !(multiSelectedIds.size === 1 && multiSelectedIds.has(trace.id))) return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={() => {
                    setContextMenu(null)
                    setSelectedTraceId(null)
                    setMultiSelectedIds(new Set())
                    void splitDrawing(trace.id, n => t('atrium.layers.numberedStroke', { n })).catch(err => {
                      console.error('[drawing] could not split:', err)
                      showToast(t('atrium.draw.strokeSaveFailed', { message: err?.message ?? '' }))
                    })
                  }}
                >
                  <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.splitStrokes')}
                </button>
              )
            })()}
            {/* A drawing -- or the selection's drawings -- one picture, for
                good: no strokes left to edit (rasterize). */}
            {(() => {
              const ids = editingWholeSelection ? [...multiSelectedIds] : [contextMenu.traceId]
              const count = traces.filter(tr => ids.includes(tr.id) && isDrawingTrace(tr)).length
              if (!canEdit || count === 0) return null
              return (
                <button
                  title={t('atrium.menu.rasterizeHint')}
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={() => { setContextMenu(null); rasterize(ids) }}
                >
                  <span className="text-nier-bg/60 text-[10px]">◇</span> {count > 1 ? t('atrium.menu.rasterizeAll', { count }) : t('atrium.menu.rasterize')}
                </button>
              )
            })()}
            {/* A PDF shown a page at a time, apart into one picture a page, in
                a group where it was (lib/pdfTraces extractPages). */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!canEdit || !trace || trace.type !== 'document' || !trace.mediaUrl || isDeckFile(trace.mediaUrl) || !lobbyId || !userId) return null
              if (editingWholeSelection && !(multiSelectedIds.size === 1 && multiSelectedIds.has(trace.id))) return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={() => {
                    setContextMenu(null)
                    setSelectedTraceId(null)
                    setMultiSelectedIds(new Set())
                    showToast(t('atrium.controls.rendering'))
                    void extractPages(trace.id, { lobbyId, userId, username }).catch(err => {
                      console.error('[pdf] could not extract pages:', err)
                      showToast(t('atrium.error.extractFailed', { message: err?.message ?? '' }))
                    })
                  }}
                >
                  <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.extractPages')}
                </button>
              )
            })()}
            {/* Connect this trace -- or the whole selection it's part of -- to
                the next trace clicked. */}
            {canEdit && (
              <button
                className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                onClick={() => {
                  const ids = multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
                    ? Array.from(multiSelectedIds)
                    : [contextMenu.traceId]
                  setContextMenu(null)
                  setConnectFrom(ids)
                }}
              >
                <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.connectTo')}
              </button>
            )}
            {/* The selection -- or this trace -- in a frame of its own. */}
            {canEdit && (() => {
              const ids = multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
                ? Array.from(multiSelectedIds)
                : [contextMenu.traceId]
              if (!ids.some(id => traces.some(tr => tr.id === id && !isFrame(tr)))) return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={() => {
                    setContextMenu(null)
                    wrapInFrame(ids)
                  }}
                >
                  <span className="text-nier-bg/60 text-[10px]">⬚</span> {t('atrium.menu.wrapInFrame')}
                </button>
              )
            })()}
            {editingWholeSelection && (
              <button
                className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                onClick={() => {
                  setEditingTrace(null)
                  setShowBatchEditPanel(true)
                  setContextMenu(null)
                }}
              >
                <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.customize.batchEdit', { count: multiSelectedIds.size })}
              </button>
            )}
            {editingWholeSelection && multiSelectedIds.size <= MAX_REORGANIZE_TRACES && (
              <div
                className="relative"
                onMouseEnter={openReorganizeFlyout}
                onMouseLeave={scheduleCloseReorganizeFlyout}
              >
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase"
                  title={t('atrium.customize.repackHint')}
                >
                  <span className="flex items-center gap-3"><span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.reorganizeSelected', { count: multiSelectedIds.size })}</span>
                  <span className="text-nier-bg/70 text-[9px]">▶</span>
                </button>
                {contextMenuReorganizeOpen && reorganizeFlyoutRect && (
                  <div
                    className="fixed w-max flex flex-col bg-nier-black border border-nier-border/60 shadow-2xl py-1 z-[10000101]"
                    style={
                      contextMenuFlyoutOnLeft
                        ? { top: reorganizeFlyoutRect.top, right: window.innerWidth - reorganizeFlyoutRect.left + 1 }
                        : { top: reorganizeFlyoutRect.top, left: reorganizeFlyoutRect.right + 1 }
                    }
                    onMouseEnter={keepReorganizeFlyoutOpen}
                    onMouseLeave={scheduleCloseReorganizeFlyout}
                  >
                    <button
                      className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                      onClick={() => reorganizeSelectedTraces('square')}
                      title={t('atrium.menu.packRectangle')}
                    >
                      {t('atrium.customize.square')}
                    </button>
                    <button
                      className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                      onClick={() => reorganizeSelectedTraces('circle')}
                      title={t('atrium.menu.packCluster')}
                    >
                      {t('atrium.customize.circle')}
                    </button>
                  </div>
                )}
              </div>
            )}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!trace || trace.type !== 'text') return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(trace.content)
                    } catch {
                      // Ignore clipboard access failures
                    }
                    setContextMenu(null)
                  }}
                >
                  <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.copyText')}
                </button>
              )
            })()}
            {/* The embed equivalent of Copy Text above. An embed trace IS its
                link -- that is the whole of what it stores -- so the one thing
                somebody is most likely to want back out of it had no way out
                short of opening Customize and selecting the field by hand. */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!trace || trace.type !== 'embed') return null
              const link = trace.mediaUrl || trace.content
              if (!link) return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link)
                    } catch {
                      // Ignore clipboard access failures, same as Copy Text.
                    }
                    setContextMenu(null)
                  }}
                >
                  <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.copyEmbedLink')}
                </button>
              )
            })()}
            <button
              className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceCustomization(trace.id, isLockedTrace(trace) ? UNLOCKED : { isLocked: true })
                }
                setContextMenu(null)
              }}
            >
              <span className="text-nier-bg/60 text-[10px]">◇</span> {isLockedTrace(traces.find(t => t.id === contextMenu.traceId) ?? {}) ? t('atrium.menu.unlock') : t('atrium.menu.lock')}
            </button>
            {/* The same switch as the Customize checkbox, one right-click away:
                an embed is where a video or page you can use lives. */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!trace || trace.type !== 'embed') return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={() => {
                    updateTraceCustomization(trace.id, { enableInteraction: !trace.enableInteraction })
                    setContextMenu(null)
                  }}
                >
                  <span className="text-nier-bg/60 text-[10px]">◇</span> {trace.enableInteraction ? t('atrium.menu.disableInteraction') : t('atrium.menu.enableInteraction')}
                </button>
              )
            })()}
            <div className="h-[1px] bg-gradient-to-r from-transparent via-gray-600 to-transparent my-1" />
            {/* Transformations submenu -- opens as a side flyout on hover,
                grouping the crop/rotate/flip resets that used to each take
                their own row in this menu. */}
            {!isFrame(traces.find(tr => tr.id === contextMenu.traceId) ?? { type: '' }) && (
            <div
              className="relative"
              onMouseEnter={openTransformFlyout}
              onMouseLeave={scheduleCloseTransformFlyout}
            >
              <button
                className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase"
              >
                <span className="flex items-center gap-3"><span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.transformations')}</span>
                <span className="text-nier-bg/70 text-[9px]">▶</span>
              </button>
              {contextMenuTransformOpen && transformFlyoutRect && (
                <div
                  className="fixed w-max flex flex-col bg-nier-black border border-nier-border/60 shadow-2xl py-1 z-[10000101]"
                  style={
                    contextMenuFlyoutOnLeft
                      ? { top: transformFlyoutRect.top, right: window.innerWidth - transformFlyoutRect.left + 1 }
                      : { top: transformFlyoutRect.top, left: transformFlyoutRect.right + 1 }
                  }
                  onMouseEnter={keepTransformFlyoutOpen}
                  onMouseLeave={scheduleCloseTransformFlyout}
                >
                  <button
                    className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                    onClick={async () => {
                      const trace = traces.find(t => t.id === contextMenu.traceId)
                      if (trace) {
                        updateTraceCustomization(trace.id, {
                          cropX: 0,
                          cropY: 0,
                          cropWidth: 1,
                          cropHeight: 1,
                        })
                      }
                      setContextMenu(null)
                    }}
                  >
                    {t('atrium.menu.resetCropping')}
                  </button>
                  <button
                    className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                    onClick={async () => {
                      const trace = traces.find(t => t.id === contextMenu.traceId)
                      if (trace) {
                        const transform = getTraceTransform(trace)
                        const avgScale = (transform.scaleX + transform.scaleY) / 2

                        updateTraceTransform(trace.id, {
                          scaleX: avgScale,
                          scaleY: avgScale,
                        })
                      }
                      setContextMenu(null)
                    }}
                  >
                    {t('atrium.menu.resetAspect')}
                  </button>
                  <button
                    className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                    onClick={async () => {
                      const trace = traces.find(t => t.id === contextMenu.traceId)
                      if (trace) {
                        updateTraceTransform(trace.id, { rotation: 0 })
                      }
                      setContextMenu(null)
                    }}
                  >
                    {t('atrium.menu.resetRotation')}
                  </button>
                  {(() => {
                    const trace = traces.find(t => t.id === contextMenu.traceId)
                    if (!trace || trace.type === 'audio' || trace.type === 'video') return null
                    return (
                      <>
                        <button
                          className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                          onClick={() => {
                            updateTraceCustomization(trace.id, { flipHorizontal: !trace.flipHorizontal })
                            setContextMenu(null)
                          }}
                        >
                          {t('atrium.menu.flipHorizontal')}
                        </button>
                        <button
                          className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                          onClick={() => {
                            updateTraceCustomization(trace.id, { flipVertical: !trace.flipVertical })
                            setContextMenu(null)
                          }}
                        >
                          {t('atrium.menu.flipVertical')}
                        </button>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>
            )}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!isDesktop || !trace || trace.type !== 'embed' || !confirmedImageIds.has(trace.id)) return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={async () => {
                    setContextMenu(null)
                    const result = await convertEmbedToInternalImage(trace.id)
                    if (!result.ok) {
                      showToast(result.error || t('atrium.error.embedNotConverted'))
                    }
                  }}
                >
                  <span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.convertToImage')}
                </button>
              )
            })()}
            {/* Move to Group -- reassigns the selected trace(s) to a layer
                group (or Ungrouped) without opening the Layer panel.

                Sits directly below Transformations and above Move Layer,
                because its flyout is the one here that grows without limit:
                every group in the atrium is a row, so in a heavily grouped
                atrium this was the entry most likely to open past the bottom
                of the screen. The higher it opens, the more room it has. */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!trace) return null
              const inMultiSelect = multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
              const targetIds = inMultiSelect ? Array.from(multiSelectedIds) : [contextMenu.traceId]
              const currentLayerId = inMultiSelect ? undefined : groupIdOf(trace, layers)
              return (
                <div
                  className="relative"
                  onMouseEnter={openGroupFlyout}
                  onMouseLeave={scheduleCloseGroupFlyout}
                >
                  <button
                    className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase"
                  >
                    <span className="flex items-center gap-3"><span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.moveToGroup')}</span>
                    <span className="text-nier-bg/70 text-[9px]">▶</span>
                  </button>
                  {contextMenuGroupOpen && groupFlyoutRect && (
                    <div
                      ref={groupFlyoutListRef}
                      // Marks this as UI for the canvas wheel handler, which
                      // reads a scroll anywhere else as "zoom the atrium". It
                      // already matched `button`, so a wheel over a row
                      // scrolled while one over the gap between rows zoomed
                      // the canvas behind the open menu.
                      data-ui-element="true"
                      className="fixed w-max flex flex-col bg-nier-black border border-nier-border/60 shadow-2xl py-1 z-[10000101] max-h-[60vh] overflow-y-auto overflow-x-hidden overscroll-contain"
                      style={{
                        ...(contextMenuFlyoutOnLeft
                          ? { top: groupFlyoutRect.top, right: window.innerWidth - groupFlyoutRect.left + 1 }
                          : { top: groupFlyoutRect.top, left: groupFlyoutRect.right + 1 }),
                        maxHeight: groupFlyoutMaxHeight,
                      }}
                      onMouseEnter={keepGroupFlyoutOpen}
                      onMouseLeave={scheduleCloseGroupFlyout}
                    >
                      {/* New Group leads, where it used to sit at the bottom
                          behind a rule. It is the one row whose place does not
                          depend on how many groups exist, and from the top it
                          stays reachable without scrolling however long the
                          list gets. The rule follows it for the same reason it
                          preceded it: this is the entry that does not move the
                          trace somewhere that already exists. */}
                      <button
                        data-group-row
                        className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap flex items-center gap-2"
                        onClick={() => {
                          setNewGroupDialog({ traceIds: targetIds, name: '' })
                          setContextMenu(null)
                        }}
                      >
                        <span className="text-nier-bg/60 text-[10px]">+</span> {t('atrium.menu.newGroup')}
                      </button>
                      <div className="h-[1px] bg-gradient-to-r from-transparent via-gray-600 to-transparent my-1" />
                      <button
                        data-group-row
                        className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                        disabled={currentLayerId === null}
                        onClick={() => { moveTracesToGroup(targetIds, null); setContextMenu(null) }}
                      >
                        {currentLayerId === null && <span className="text-emerald-400 text-[9px]">✓</span>}
                        {t('atrium.layers.ungrouped')}
                      </button>
                      {groupLayers.length === 0 && (
                        <span className="px-4 py-2 text-nier-bg/70 text-[10px] tracking-wider uppercase whitespace-nowrap">{t('atrium.layers.noGroups')}</span>
                      )}
                      {groupLayers.map(layer => (
                        <button
                          key={layer.id}
                          data-group-row
                          className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                          disabled={currentLayerId === layer.id}
                          onClick={() => { moveTracesToGroup(targetIds, layer.id); setContextMenu(null) }}
                        >
                          {currentLayerId === layer.id && <span className="text-emerald-400 text-[9px]">✓</span>}
                          {layer.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })()}
            {/* Ungroup: the groups of what's right-clicked (the selection,
                when it's in one), each undone -- traces left where they are. */}
            {canEdit && (() => {
              const inMultiSelect = multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
              const targets = inMultiSelect ? Array.from(multiSelectedIds) : [contextMenu.traceId]
              if (groupsOf(targets).length === 0) return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center justify-between gap-6 text-[11px] tracking-wider uppercase"
                  onClick={() => {
                    setContextMenu(null)
                    void ungroupSelection(targets)
                  }}
                >
                  <span className="flex items-center gap-3"><span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.ungroup')}</span>
                  <span className="text-nier-bg/50 text-[10px] tracking-normal">Ctrl+Shift+G</span>
                </button>
              )
            })()}
            {/* Move Layer submenu -- same side-flyout pattern, groups the
                four z-order actions (one-step up/down, jump to top/bottom of
                this trace's group) that used to each take their own row. */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!trace) return null
              if (siblingsOf(trace, traces, layers).length === 0) return null
              return (
                <div
                  className="relative"
                  onMouseEnter={openMoveFlyout}
                  onMouseLeave={scheduleCloseMoveFlyout}
                >
                  <button
                    className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase"
                  >
                    <span className="flex items-center gap-3"><span className="text-nier-bg/60 text-[10px]">◇</span> {t('atrium.menu.moveLayer')}</span>
                    <span className="text-nier-bg/70 text-[9px]">▶</span>
                  </button>
                  {contextMenuMoveOpen && moveFlyoutRect && (
                    <div
                      className="fixed w-max flex flex-col bg-nier-black border border-nier-border/60 shadow-2xl py-1 z-[10000101]"
                      style={
                        contextMenuFlyoutOnLeft
                          ? { top: moveFlyoutRect.top, right: window.innerWidth - moveFlyoutRect.left + 1 }
                          : { top: moveFlyoutRect.top, left: moveFlyoutRect.right + 1 }
                      }
                      onMouseEnter={keepMoveFlyoutOpen}
                      onMouseLeave={scheduleCloseMoveFlyout}
                    >
                      <button
                        className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => moveInOrder([trace.id], 'up')}
                      >
                        {t('atrium.menu.moveUp')}
                      </button>
                      <button
                        className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => moveInOrder([trace.id], 'down')}
                      >
                        {t('atrium.menu.moveDown')}
                      </button>
                      <button
                        className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => moveInOrder([trace.id], 'top')}
                      >
                        {orderLabels(!!groupIdOf(trace, layers)).top}
                      </button>
                      <button
                        className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => moveInOrder([trace.id], 'bottom')}
                      >
                        {orderLabels(!!groupIdOf(trace, layers)).bottom}
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
            {/* Select -- widens the selection from the trace under the
                cursor, which is the thing you already have hold of. Reuses the
                same multi-selection the Layer panel drives, so everything that
                already acts on a multi-selection (Batch Edit, Reorganize,
                delete) works on the result without knowing where it came
                from. */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!trace) return null
              const groupId = groupIdOf(trace, layers)
              const inGroup = groupId ? traces.filter(t => t.layerId === groupId) : []
              return (
                <div
                  ref={selectTriggerRef}
                  className="relative"
                  onMouseEnter={openSelectFlyout}
                  onMouseLeave={scheduleCloseSelectFlyout}
                >
                  <button className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase">
                    <span className="flex items-center gap-3"><span className="text-nier-bg/60 text-[10px]">◇</span> {t('common.select')}</span>
                    <span className="text-nier-bg/70 text-[9px]">▶</span>
                  </button>
                  {contextMenuSelectOpen && selectFlyoutRect && (
                    <div
                      className="fixed w-max flex flex-col bg-nier-black border border-nier-border/60 shadow-2xl py-1 z-[10000101]"
                      style={
                        contextMenuFlyoutOnLeft
                          ? { top: selectFlyoutRect.top, right: window.innerWidth - selectFlyoutRect.left + 1 }
                          : { top: selectFlyoutRect.top, left: selectFlyoutRect.right + 1 }
                      }
                      onMouseEnter={keepSelectFlyoutOpen}
                      onMouseLeave={scheduleCloseSelectFlyout}
                    >
                      <button
                        className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap flex items-center justify-between gap-6 disabled:opacity-30 disabled:cursor-not-allowed"
                        disabled={inGroup.length === 0}
                        onClick={() => {
                          setMultiSelectedIds(new Set(inGroup.map(t => t.id)))
                          setSelectedTraceId(trace.id)
                          setContextMenu(null)
                        }}
                      >
                        <span>{t('atrium.menu.selectGroup', { count: inGroup.length })}</span>
                        {/* The key, shown where the action is -- there is no shortcut
                            list anywhere else to find it in. */}
                        <span className="text-nier-bg/50 text-[10px] tracking-normal">G</span>
                      </button>
                      <button
                        className="px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => {
                          setMultiSelectedIds(new Set(traces.map(t => t.id)))
                          setSelectedTraceId(trace.id)
                          setContextMenu(null)
                        }}
                      >
                        {t('atrium.menu.selectAll', { count: traces.length })}
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
            <div className="h-[1px] bg-gradient-to-r from-transparent via-gray-600 to-transparent my-1" />
            <button
              className="w-full px-4 py-2 text-left text-nier-strong hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                duplicateTrace(contextMenu.traceId)
              }}
            >
              <span className="text-nier-bg/60 text-[10px]">◇</span> {t('common.duplicate')}
            </button>
            <button
              className="w-full px-4 py-2 text-left text-red-400 hover:bg-red-900/30 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const inMultiSelect = multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
                deleteTraces(inMultiSelect ? Array.from(multiSelectedIds) : [contextMenu.traceId], inMultiSelect ? [...selectedLinksRef.current] : [])
              }}
            >
              <span className="text-red-500 text-[10px]">◇</span>
              {multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
                ? t('atrium.menu.deleteSelected', { count: multiSelectedIds.size })
                : t('common.delete')}
            </button>
          </div>

          {/* Backdrop to close menu - renders behind menu but catches outside clicks */}
          <div
            className="fixed inset-0 pointer-events-auto"
            style={{ zIndex: 199 }}
            onClick={() => setContextMenu(null)}
          />
        </>
        )
      })()}

      {/* The Customization panel for one trace (components/Customization):
          its sections in the one order, those it has. Closing it is Done.
          While drawing, drawing's own is the panel there. */}
      {editingTrace && canEdit && !isDrawingMode && (() => {
        const live = traces.find(tr => tr.id === editingTrace.id) ?? editingTrace
        const shapeLike = has(editingTrace, 'shape') || has(editingTrace, 'line')
        const isPathTrace = editingTrace.shapeType === 'path'
        const framed = has(editingTrace, 'frame')
        const follows = following[editingTrace.id]
        const hasContent = editingTrace.type === 'text' || editingTrace.type === 'embed' || has(editingTrace, 'link') || has(editingTrace, 'captions') || !!follows
        // What a trace holds. A text trace's is what it's for, so it comes first
        // there; for the rest it keeps its place in the order.
        const contentSection = hasContent && (
            <Section id="content" title={t('atrium.customize.sectionContent')}>
              {editingTrace.type === 'text' && (
                <div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.textContent')}</label>
                  <textarea
                    value={editingTrace.content ?? ''}
                    onChange={(e) => {
                      const effectiveFontSize = fontPxOf(editingTrace.fontSize)
                      const effectiveFontFamily = resolveFontFamilyCss(editingTrace.fontFamily ?? 'sans')
                      fitTextLive(traces.find(tr => tr.id === editingTrace.id) ?? editingTrace, e.target.value, effectiveFontSize, effectiveFontFamily)
                    }}
                    onBlur={() => endTextEdit(editingTrace.id)}
                    className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                    placeholder={t('atrium.customize.messagePlaceholder')}
                    rows={4}
                  />
                </div>
              )}
              {/* Embed Content Editor */}
              {editingTrace.type === 'embed' && (
                <>
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.embedUrl')}</label>
                    <textarea
                      value={editingTrace.mediaUrl ?? ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, mediaUrl: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { mediaUrl: e.target.value })
                      }}
                      className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                      placeholder={t('atrium.customize.embedUrlPlaceholder')}
                      rows={4}
                    />
                    <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                      {t('atrium.customize.embedHint')}
                    </p>
                  </div>

                </>
              )}
              {/* Following the file it came from: only ever turned off,
                  and asked first (lib/liveFiles). */}
              {follows && (
                <Switch
                  testId="live-file"
                  label={t('atrium.live.switch')}
                  hint={t('atrium.live.hint', { name: fileName(follows.path) })}
                  on
                  onChange={() => setUnfollowAsk({ traceId: editingTrace.id })}
                />
              )}
              {/* Clickable -- text, embed and shape only. Image, audio and
                  video already do something of their own on click (open the
                  viewer, play), and a second competing action there would be
                  ambiguous.

                  Placed above the toggle group below rather than inside it,
                  because that group is hidden for shapes -- which are one of
                  the three types this applies to. */}
              {has(editingTrace, 'link') && (
                <div className="space-y-3">
                  <Check
                    checked={editingTrace.isClickable ?? false}
                    label={t('atrium.customize.clickable')}
                    hint={t('atrium.customize.clickableHint')}
                    onChange={isClickable => {
                      setEditingTrace({ ...editingTrace, isClickable })
                      updateTraceCustomization(editingTrace.id, { isClickable })
                    }}
                  />

                  {/* The destination, shown only once Clickable is on so the
                      field can't sit there filled in and doing nothing. */}
                  {editingTrace.isClickable && (
                    <div>
                      <input
                        type="url"
                        value={editingTrace.linkUrl ?? ''}
                        onChange={(e) => {
                          const updated = { ...editingTrace, linkUrl: e.target.value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { linkUrl: e.target.value })
                        }}
                        placeholder="https://..."
                        className="w-full px-3 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-xs tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                      />
                      {(editingTrace.linkUrl ?? '').trim() !== '' && !/^https?:\/\/\S+$/i.test((editingTrace.linkUrl ?? '').trim()) && (
                        <p className="text-[9px] tracking-wider mt-1.5" style={{ color: '#FF6161' }}>
                          {t('atrium.customize.needsFullUrl')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              {has(editingTrace, 'captions') && (
              <>
              <Check
                checked={editingTrace.showFilename ?? true}
                label={t('atrium.customize.showUsername')}
                onChange={on => {
                  setEditingTrace({ ...editingTrace, showFilename: on })
                  updateTraceCustomization(editingTrace.id, { showFilename: on })
                }}
              />
              <Check
                checked={editingTrace.showDescription ?? false}
                label={t('atrium.customize.showDescription')}
                onChange={on => {
                  setEditingTrace({ ...editingTrace, showDescription: on })
                  updateTraceCustomization(editingTrace.id, { showDescription: on })
                }}
              />
              </>
              )}
              {editingTrace.type === 'embed' && (
              <Check
                checked={editingTrace.enableInteraction ?? false}
                label={t('atrium.menu.enableInteraction')}
                onChange={on => {
                  setEditingTrace({ ...editingTrace, enableInteraction: on })
                  updateTraceCustomization(editingTrace.id, { enableInteraction: on })
                }}
              />
              )}
            </Section>
        )
        const locked = isLockedTrace(live)
        const done = () => {
          // Mark as pending if there were any changes
          markTraceChanged(editingTrace.id)
          dismissedRef.current = selectionKey()
          setEditingTrace(null)
        }
        // The shape's controls, in four parts across the sections.
        const shapeProps = {
          value: shapeStyleOf(editingTrace),
          // The size as drawn. Resize handles change scale, not width, so a
          // typed size is divided back through the scale; the column is an
          // integer, so it is rounded on the way.
          size: (() => {
            const tf = localTraceTransforms[live.id] || getTraceTransform(live)
            return {
              width: (live.width || 200) * ((tf as any).scaleX || 1),
              height: (live.height || 200) * ((tf as any).scaleY || 1),
            }
          })(),
          onSizeChange: (w: number, h: number) => {
            const tf = localTraceTransforms[live.id] || getTraceTransform(live)
            const width = Math.max(1, Math.round(w / ((tf as any).scaleX || 1)))
            const height = Math.max(1, Math.round(h / ((tf as any).scaleY || 1)))
            setEditingTrace({ ...editingTrace, width, height })
            updateTraceCustomization(editingTrace.id, { width, height })
          },
          onChange: (patch: Partial<ShapeStyle>) => {
            setEditingTrace({ ...editingTrace, ...patch })
            updateTraceCustomization(editingTrace.id, patch)
            // The next shape made looks like this one now.
            rememberShapeStyle(shapeStyleOf({ ...editingTrace, ...patch }))
          },
        }
        return (
          <CustomizationPanel
            subtitle={traceKindLabel(editingTrace, t)}
            onClose={done}
            closeLabel={t('atrium.customize.done')}
            zIndex={MENU_PANEL_Z_INDEX}
            actions={
              <>
                <PanelAction icon={ACTION_ICONS.duplicate} label={t('common.duplicate')} onClick={() => duplicateTrace(editingTrace.id)} />
                <PanelAction icon={ACTION_ICONS.copyStyle} label={t('atrium.menu.copyStyle')} onClick={() => copyTraceStyle(editingTrace.id)} />
                <PanelAction icon={ACTION_ICONS.pasteStyle} label={t('atrium.menu.pasteStyle')} onClick={() => pasteTraceStyle([editingTrace.id])} />
                {(() => {
                  const labels = orderLabels(!!groupIdOf(live, layers))
                  return (['up', 'down', 'top', 'bottom'] as const).map(how => (
                    <PanelAction key={how} icon={ACTION_ICONS[how]} label={labels[how]} onClick={() => moveInOrder([editingTrace.id], how)} />
                  ))
                })()}
                <PanelAction
                  icon={ACTION_ICONS.lock}
                  label={locked ? t('atrium.menu.unlock') : t('atrium.menu.lock')}
                  active={locked}
                  onClick={() => updateTraceCustomization(editingTrace.id, locked ? UNLOCKED : { isLocked: true })}
                />
                {isDrawingTrace(editingTrace) && (
                  <PanelAction icon={ACTION_ICONS.rasterize} label={t('atrium.menu.rasterize')} onClick={() => rasterize([editingTrace.id])} />
                )}
                <PanelAction icon={ACTION_ICONS.delete} label={t('common.delete')} danger onClick={() => { setEditingTrace(null); deleteTraces([editingTrace.id], []) }} />
              </>
            }
          >
            {editingTrace.type === 'text' && contentSection}
            <Section id="name" title={t('atrium.customize.sectionName')}>
              {/* The layer's name, first -- the one field that used to be called a
                  label, a caption or a description depending on the trace. */}
              {/* A text trace's name is its own (Text 1, ...): its content is its text. */}
              {editingTrace.type === 'text' ? (
                <TraceNameField
                  label={t('atrium.customize.layerName')}
                  value={editingTrace.layerName ?? ''}
                  placeholder={t('atrium.layers.untitled')}
                  maxLength={60}
                  onChange={(value) => setEditingTrace({ ...editingTrace, layerName: value })}
                  onCommit={(value) => { if (value.trim()) updateTraceCustomization(editingTrace.id, { layerName: value.trim() }) }}
                />
              ) : (
                <TraceNameField
                  label={t('atrium.customize.layerName')}
                  value={editingTrace.content ?? ''}
                  placeholder={t('atrium.layers.untitled')}
                  // A shape's name is drawn on the shape, and was capped at 50 for that.
                  onChange={(value) => setEditingTrace({ ...editingTrace, content: value })}
                  onCommit={(value) => updateTraceCustomization(editingTrace.id, { content: value })}
                />
              )}
            
            </Section>

            {(framed || shapeLike) && (
            <Section id="style" title={t('atrium.customize.sectionStyle')}>
              {/* NieR Presets */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-nier-bg/55 text-[0.7rem] tracking-[0.1em] uppercase">{t('atrium.customize.quickPresets')}</span>
                  <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/20 to-transparent" />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {TRACE_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        // A shape takes it as its fill and outline -- a path,
                        // only a line, as its colour -- and the next shape made
                        // looks like it (shapeProps.onChange).
                        if (shapeLike) {
                          shapeProps.onChange(isPathTrace
                            ? { shapeColor: preset.border, shapeOutlineColor: preset.border }
                            : { shapeColor: preset.fill, shapeOutlineColor: preset.border, shapeOutlineOnly: true, shapeNoFill: false })
                          return
                        }
                        // The font comes with the preset. A trace in the
                        // house style should be set in the house face, and
                        // three presets that each left the type to whatever
                        // it happened to be were three half-presets.
                        const patch = {
                          borderColor: preset.border,
                          fillColor: preset.fill,
                          showBorder: true,
                          showBackground: true,
                          fontFamily: 'mono',
                          ...(preset.text ? { textColor: preset.text } : {}),
                        }
                        setEditingTrace({ ...editingTrace, ...patch })
                        updateTraceCustomization(editingTrace.id, patch)
                        // Chosen once, in force from then on: the next
                        // trace made in this atrium starts here.
                        if (lobbyId) rememberTracePreset(lobbyId, preset.id)
                      }}
                      className="px-2 py-1.5 bg-nier-black border border-nier-border/30 text-nier-bg/80 text-[9px] tracking-[0.12em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                      style={{ borderLeftColor: preset.border, borderLeftWidth: '2px' }}
                    >
                      {t(preset.labelKey as TranslationKey)}
                    </button>
                  ))}
                </div>
              </div>
            </Section>
            )}

            {(framed || shapeLike || has(editingTrace, 'strokes')) && (
            <Section id="fill" title={t('atrium.customize.sectionFill')}>
              {/* A drawing's stroke: its colour, changed after it's drawn. */}
              {lobbyId && has(editingTrace, 'strokes') && (
                <StrokeStyleField traceIds={[editingTrace.id]} lobbyId={lobbyId} userId={userId} />
              )}
              {shapeLike && <ShapeStyleControls {...shapeProps} part="fill" />}
              {framed && (
              <>
              <Check
                checked={editingTrace.showBackground ?? true}
                label={t('atrium.customize.showBackground')}
                onChange={on => {
                  setEditingTrace({ ...editingTrace, showBackground: on })
                  updateTraceCustomization(editingTrace.id, { showBackground: on })
                }}
              />
              {/* Fill Color & Opacity */}
              {(editingTrace.showBackground ?? true) && (
                <div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.fillColour')}</label>
                  <div className="flex gap-2 items-center mb-2">
                    <input
                      type="color"
                      value={editingTrace.fillColor || '#1a1a2e'}
                      onChange={(e) => {
                        const updated = { ...editingTrace, fillColor: e.target.value };
                        setEditingTrace(updated);
                        updateTraceCustomization(editingTrace.id, { fillColor: e.target.value });
                      }}
                      className="w-10 h-10 border border-nier-border/30 cursor-pointer bg-nier-black"
                    />
                    <input
                      type="text"
                      value={editingTrace.fillColor || '#1a1a2e'}
                      onChange={(e) => {
                        const updated = { ...editingTrace, fillColor: e.target.value };
                        setEditingTrace(updated);
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { fillColor: e.target.value });
                      }}
                      className="flex-1 bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                      placeholder="#1a1a2e"
                    />
                    <button
                      onClick={() => {
                        const updated = { ...editingTrace, fillColor: undefined };
                        setEditingTrace(updated);
                        updateTraceCustomization(editingTrace.id, { fillColor: undefined });
                      }}
                      className="px-3 py-2 bg-nier-black text-nier-bg border border-nier-border/30 hover:border-nier-border/60 text-xs"
                      title={t('atrium.customize.resetDefault')}
                    >
                      ↺
                    </button>
                  </div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">
                    {t('atrium.customize.fillOpacity', { value: Math.round((editingTrace.fillOpacity ?? 0.95) * 100) })}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round((editingTrace.fillOpacity ?? 0.95) * 100)}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) / 100;
                      const updated = { ...editingTrace, fillOpacity: value };
                      setEditingTrace(updated);
                      updateTraceCustomization(editingTrace.id, { fillOpacity: value });
                    }}
                    className="w-full accent-nier-bg"
                  />
                </div>
              )}
              </>
              )}
            </Section>
            )}

            {(framed || (shapeLike && !isPathTrace)) && (
            <Section id="outline" title={t('atrium.customize.sectionOutline')}>
              {shapeLike && !isPathTrace && <ShapeStyleControls {...shapeProps} part="outline" />}
              {framed && (
              <>
              <Check
                checked={editingTrace.showBorder ?? true}
                label={t('atrium.customize.showBorder')}
                onChange={on => {
                  setEditingTrace({ ...editingTrace, showBorder: on })
                  updateTraceCustomization(editingTrace.id, { showBorder: on })
                }}
              />
              {/* Border Color & Opacity */}
              {(editingTrace.showBorder ?? true) && (
                <div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.borderColour')}</label>
                  <div className="flex gap-2 items-center mb-2">
                    <input
                      type="color"
                      value={editingTrace.borderColor || borderColourOf(editingTrace.type)}
                      onChange={(e) => {
                        const updated = { ...editingTrace, borderColor: e.target.value };
                        setEditingTrace(updated);
                        updateTraceCustomization(editingTrace.id, { borderColor: e.target.value });
                      }}
                      className="w-10 h-10 border border-nier-border/30 cursor-pointer bg-nier-black"
                    />
                    <input
                      type="text"
                      value={editingTrace.borderColor || borderColourOf(editingTrace.type)}
                      onChange={(e) => {
                        const updated = { ...editingTrace, borderColor: e.target.value };
                        setEditingTrace(updated);
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { borderColor: e.target.value });
                      }}
                      className="flex-1 bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                      placeholder="#ffffff"
                    />
                    <button
                      onClick={() => {
                        const updated = { ...editingTrace, borderColor: undefined };
                        setEditingTrace(updated);
                        updateTraceCustomization(editingTrace.id, { borderColor: undefined });
                      }}
                      className="px-3 py-2 bg-nier-black text-nier-bg border border-nier-border/30 hover:border-nier-border/60 text-xs"
                      title={t('atrium.customize.resetDefault')}
                    >
                      ↺
                    </button>
                  </div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">
                    {t('atrium.customize.borderOpacity', { value: Math.round((editingTrace.borderOpacity ?? 1) * 100) })}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round((editingTrace.borderOpacity ?? 1) * 100)}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) / 100;
                      const updated = { ...editingTrace, borderOpacity: value };
                      setEditingTrace(updated);
                      updateTraceCustomization(editingTrace.id, { borderOpacity: value });
                    }}
                    className="w-full accent-nier-bg"
                  />
                </div>
              )}
              </>
              )}
              {/* Border thickness. Its own block above the colour controls so
                  it also reaches PDF traces, where a frame is what separates a
                  white page from a light background. */}
              {has(editingTrace, 'frame') && (editingTrace.showBorder ?? true) && (
                <div>
                  <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-2">
                    {t('atrium.customize.borderThickness', { value: editingTrace.borderWidth ?? 2 })}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="1"
                    value={editingTrace.borderWidth ?? 2}
                    onChange={(e) => {
                      const borderWidth = parseInt(e.target.value)
                      setEditingTrace({ ...editingTrace, borderWidth })
                      updateTraceCustomization(editingTrace.id, { borderWidth })
                    }}
                    className="w-full accent-nier-bg"
                  />
                </div>
              )}
              {/* The border's own stroke style, with its thickness: a shape
                  has its own, in its outline's settings (ShapeStyleControls). */}
              {has(editingTrace, 'frame') && (editingTrace.showBorder ?? true) && (
                <StrokeStylePicker
                  value={editingTrace.strokeStyle}
                  onChange={strokeStyle => {
                    setEditingTrace({ ...editingTrace, strokeStyle })
                    updateTraceCustomization(editingTrace.id, { strokeStyle })
                  }}
                />
              )}
              {/* Border Radius Customization (for non-shape traces) */}
              {has(editingTrace, 'frame') && (
                <div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                    {t('atrium.customize.borderRadius', { value: editingTrace.borderRadius ?? 0 })}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="1"
                    value={editingTrace.borderRadius ?? 0}
                    onChange={(e) => {
                      const value = parseInt(e.target.value)
                      const updated = { ...editingTrace, borderRadius: value }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { borderRadius: value })
                    }}
                    className="w-full accent-nier-bg"
                  />
                  <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                    {t('atrium.customize.cornerRadiusHint')}
                  </p>
                </div>
              )}
            </Section>
            )}

            {has(editingTrace, 'font') && (
            <Section id="text" title={t('atrium.customize.sectionText')}>
              {/* Font Settings for Text Traces */}
              {has(editingTrace, 'font') && (
                <>

                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.fontFamily')}</label>
                    <select
                      value={editingTrace.fontFamily ?? 'sans'}
                      onChange={e => {
                        const effectiveFontSize = fontPxOf(editingTrace.fontSize)
                        const effectiveFontFamily = resolveFontFamilyCss(e.target.value)
                        const textSize = computeAutoFitTextSize(editingTrace.content ?? '', effectiveFontSize, { fontFamily: effectiveFontFamily })
                        const updated = { ...editingTrace, fontFamily: e.target.value, width: textSize.width, height: textSize.height };
                        setEditingTrace(updated);
                        updateTraceCustomization(editingTrace.id, { fontFamily: e.target.value, width: textSize.width, height: textSize.height })
                      }}
                      className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                    >
                      {FONT_FAMILY_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </div>

                  {!editingTrace.textFit && <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.fontSize')}</label>
                    <FontSizeField
                      min={8}
                      max={200}
                      value={typeof editingTrace.fontSize === 'number' ? editingTrace.fontSize : (editingTrace.fontSize === 'small' ? 12 : editingTrace.fontSize === 'large' ? 24 : 16)}
                      onChange={value => {
                        const effectiveFontFamilyKey = editingTrace.fontFamily ?? 'sans'
                        const effectiveFontFamily = resolveFontFamilyCss(effectiveFontFamilyKey)
                        const textSize = computeAutoFitTextSize(editingTrace.content ?? '', value, { fontFamily: effectiveFontFamily })
                        // Through updateTraceCustomization, as every other
                        // setting: it was written straight into the store, so
                        // a size change was no step of undo at all.
                        updateTraceCustomization(editingTrace.id, { fontSize: value, width: textSize.width, height: textSize.height })
                      }}
                      placeholder={t('atrium.customize.fontSizeHint')}
                    />
                  </div>}

                  {/* Text Sizing -- whether the font follows the trace's own
                      scale, or stays fixed and lets the box only control
                      how much room the text has to reflow in. */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.textSizing')}</label>
                    <div className="flex gap-2">
                      {([
                        { key: 'fill', patch: { textFit: true }, label: t('atrium.controls.fillsBox') },
                        { key: 'scale', patch: { textFit: false, textScaleWithBox: true }, label: t('atrium.controls.scalesWithBox') },
                        { key: 'fixed', patch: { textFit: false, textScaleWithBox: false }, label: t('atrium.controls.fixedSize') },
                      ] as const).map(({ key, patch, label }) => (
                        <button
                          key={key}
                          data-text-sizing={key}
                          onClick={() => {
                            setEditingTrace({ ...editingTrace, ...patch });
                            updateTraceCustomization(editingTrace.id, patch);
                          }}
                          className={`flex-1 px-2 py-2 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
                            (editingTrace.textFit ? 'fill' : (editingTrace.textScaleWithBox ?? true) ? 'scale' : 'fixed') === key
                              ? 'bg-nier-bg text-nier-black border-nier-bg'
                              : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[0.7rem] text-nier-bg/55 leading-relaxed tracking-wide mt-1.5">
                      {t('atrium.customize.textSizingHint')}
                    </p>
                  </div>

                  {/* Text Formatting */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.textStyle')}</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const updated = { ...editingTrace, textBold: !editingTrace.textBold };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textBold: !editingTrace.textBold });
                        }}
                        className={`flex-1 px-3 py-2 font-bold text-sm border transition-colors ${
                          editingTrace.textBold
                            ? 'bg-nier-bg text-nier-black border-nier-bg'
                            : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                        }`}
                      >
                        B
                      </button>
                      <button
                        onClick={() => {
                          const updated = { ...editingTrace, textItalic: !editingTrace.textItalic };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textItalic: !editingTrace.textItalic });
                        }}
                        className={`flex-1 px-3 py-2 italic text-sm border transition-colors ${
                          editingTrace.textItalic
                            ? 'bg-nier-bg text-nier-black border-nier-bg'
                            : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                        }`}
                      >
                        I
                      </button>
                      <button
                        onClick={() => {
                          const updated = { ...editingTrace, textUnderline: !editingTrace.textUnderline };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textUnderline: !editingTrace.textUnderline });
                        }}
                        className={`flex-1 px-3 py-2 underline text-sm border transition-colors ${
                          editingTrace.textUnderline
                            ? 'bg-nier-bg text-nier-black border-nier-bg'
                            : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                        }`}
                      >
                        U
                      </button>
                    </div>
                  </div>

                  {/* Text Alignment */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.textAlignment')}</label>
                    <div className="flex gap-2">
                      {(['left', 'center', 'right', 'justify'] as const).map((align) => (
                        <button
                          key={align}
                          onClick={() => {
                            const updated = { ...editingTrace, textAlign: align };
                            setEditingTrace(updated);
                            updateTraceCustomization(editingTrace.id, { textAlign: align });
                          }}
                          className={`flex-1 px-2 py-2 text-xs border transition-colors ${
                            (editingTrace.textAlign ?? 'center') === align
                              ? 'bg-nier-bg text-nier-black border-nier-bg'
                              : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                          }`}
                        >
                          {align === 'left' && '◀'}
                          {align === 'center' && '◆'}
                          {align === 'right' && '▶'}
                          {align === 'justify' && '▣'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Up and down in the box: the middle unless chosen. */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.verticalAlignment')}</label>
                    <div className="flex gap-2">
                      {(['top', 'middle', 'bottom'] as const).map(valign => (
                        <button
                          key={valign}
                          data-text-valign={valign}
                          title={t(valign === 'top' ? 'atrium.customize.alignTop' : valign === 'bottom' ? 'atrium.customize.alignBottom' : 'atrium.customize.alignCenter')}
                          aria-label={t(valign === 'top' ? 'atrium.customize.alignTop' : valign === 'bottom' ? 'atrium.customize.alignBottom' : 'atrium.customize.alignCenter')}
                          aria-pressed={(editingTrace.textValign ?? 'middle') === valign}
                          onClick={() => {
                            setEditingTrace({ ...editingTrace, textValign: valign })
                            updateTraceCustomization(editingTrace.id, { textValign: valign })
                          }}
                          className={`flex-1 px-2 py-2 text-xs border transition-colors ${
                            (editingTrace.textValign ?? 'middle') === valign
                              ? 'bg-nier-bg text-nier-black border-nier-bg'
                              : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                          }`}
                        >
                          {valign === 'top' ? '▲' : valign === 'bottom' ? '▼' : '◆'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Color */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.textColour')}</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={editingTrace.textColor ?? '#ffffff'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, textColor: e.target.value };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textColor: e.target.value });
                        }}
                        className="w-10 h-10 border border-nier-border/30 cursor-pointer bg-nier-black"
                      />
                      <input
                        type="text"
                        value={editingTrace.textColor ?? '#ffffff'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, textColor: e.target.value };
                          setEditingTrace(updated);
                        }}
                        onBlur={(e) => {
                          updateTraceCustomization(editingTrace.id, { textColor: e.target.value });
                        }}
                        className="flex-1 bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                        placeholder="#ffffff"
                      />
                      <button
                        onClick={() => {
                          const updated = { ...editingTrace, textColor: '#ffffff' };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textColor: '#ffffff' });
                        }}
                        className="px-3 py-2 bg-nier-black text-nier-bg border border-nier-border/30 hover:border-nier-border/60 text-xs"
                        title={t('atrium.customize.resetWhite')}
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                </>
              )}
            </Section>
            )}

            {shapeLike && (
            <Section id="shape" title={isPathTrace ? t('atrium.trace.shape.path') : t('atrium.customize.sectionShape')}>
              <ShapeStyleControls {...shapeProps} part="shape" />
            </Section>
            )}

            {editingTrace.type !== 'text' && contentSection}

            {(framed || has(editingTrace, 'light')) && (
            <Section id="effects" title={t('atrium.customize.sectionEffects')}>
              {framed && (
              <Check
                checked={editingTrace.showShadow ?? true}
                label={t('atrium.customize.softShadow')}
                hint={t('atrium.customize.softShadowHint')}
                onChange={on => {
                  setEditingTrace({ ...editingTrace, showShadow: on })
                  updateTraceCustomization(editingTrace.id, { showShadow: on })
                }}
              />
              )}
              {/* Lighting Controls -- paths get a much simpler "glow along the
                  line" version instead: a radial point-light with a
                  radius/offset doesn't make sense for an elongated line, so
                  those (and pulsing) are hidden for them, reusing the same
                  illuminate/lightColor/lightIntensity fields for the glow
                  rendered in renderPathSvg instead. */}
              {has(editingTrace, 'light') && (() => {
                const isPathTrace = editingTrace.shapeType === 'path'
                return (
              <div>
                <div className="flex items-baseline gap-3 pt-1 mb-4">
                  <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{isPathTrace ? t('atrium.controls.glow') : t('atrium.controls.light')}</span>
                  <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                </div>

                <div className="mb-3">
                  <Check
                    checked={editingTrace.illuminate ?? false}
                    label={isPathTrace ? t('atrium.controls.enableGlow') : t('atrium.controls.enableLight')}
                    onChange={illuminate => {
                      setEditingTrace({ ...editingTrace, illuminate })
                      updateTraceCustomization(editingTrace.id, { illuminate })
                    }}
                  />
                </div>

                {editingTrace.illuminate && (
                  <div className="space-y-3 ml-6">
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{isPathTrace ? t('atrium.controls.glowColour') : t('atrium.controls.lightColour')}</label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="color"
                          value={editingTrace.lightColor ?? '#ffffff'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, lightColor: e.target.value }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { lightColor: e.target.value })
                          }}
                          className="w-12 h-9 cursor-pointer bg-nier-black border border-nier-border/30"
                        />
                        <input
                          type="text"
                          value={editingTrace.lightColor ?? '#ffffff'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, lightColor: e.target.value }
                            setEditingTrace(updated)
                          }}
                          onBlur={(e) => {
                            updateTraceCustomization(editingTrace.id, { lightColor: e.target.value })
                          }}
                          className="flex-1 bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                          placeholder="#ffffff"
                        />
                      </div>
                    </div>

                    {/* Where it comes from: a point at the middle, all of the
                        trace, or its border. A path glows along its line. */}
                    {!isPathTrace && (
                      <div>
                        <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.lightEmit')}</label>
                        <div className="grid grid-cols-3 gap-2">
                          {(['center', 'shape', 'border'] as const).map(emit => (
                            <button
                              key={emit}
                              type="button"
                              data-light-emit-choice={emit}
                              aria-pressed={(editingTrace.lightEmit ?? 'center') === emit}
                              onClick={() => {
                                setEditingTrace({ ...editingTrace, lightEmit: emit })
                                updateTraceCustomization(editingTrace.id, { lightEmit: emit })
                              }}
                              className={`px-2 py-2 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
                                (editingTrace.lightEmit ?? 'center') === emit
                                  ? 'bg-nier-bg text-nier-black border-nier-bg'
                                  : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                              }`}
                            >
                              {t(emit === 'center' ? 'atrium.customize.lightEmitCenter' : emit === 'shape' ? 'atrium.customize.lightEmitShape' : 'atrium.customize.lightEmitBorder')}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                        {t('atrium.customize.intensity', { value: (editingTrace.lightIntensity ?? 1.0).toFixed(1) })}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={editingTrace.lightIntensity ?? 1.0}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value)
                          const updated = { ...editingTrace, lightIntensity: value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { lightIntensity: value })
                        }}
                        className="w-full accent-nier-bg"
                      />
                    </div>

                    {!isPathTrace && (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                        {t('atrium.customize.radius', { value: editingTrace.lightRadius ?? 200 })}
                      </label>
                      <input
                        type="range"
                        min="50"
                        max="3000"
                        step="50"
                        value={editingTrace.lightRadius ?? 200}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value)
                          const updated = { ...editingTrace, lightRadius: value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { lightRadius: value })
                        }}
                        className="w-full accent-nier-bg"
                      />
                    </div>
                    )}

                    {!isPathTrace && (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{t('atrium.customize.lightOffset')}</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mb-1">X: {editingTrace.lightOffsetX ?? 0}px</label>
                          <input
                            type="range"
                            min="-200"
                            max="200"
                            step="5"
                            value={editingTrace.lightOffsetX ?? 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value)
                              const updated = { ...editingTrace, lightOffsetX: value }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { lightOffsetX: value })
                            }}
                            className="w-full accent-nier-bg"
                          />
                        </div>
                        <div>
                          <label className="block text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mb-1">Y: {editingTrace.lightOffsetY ?? 0}px</label>
                          <input
                            type="range"
                            min="-200"
                            max="200"
                            step="5"
                            value={editingTrace.lightOffsetY ?? 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value)
                              const updated = { ...editingTrace, lightOffsetY: value }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { lightOffsetY: value })
                            }}
                            className="w-full accent-nier-bg"
                          />
                        </div>
                      </div>
                      <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                        {t('atrium.customize.lightOffsetHint')}
                      </p>
                    </div>
                    )}

                    {!isPathTrace && (
                    <div>
                      <div className="mb-2">
                        <Check
                          checked={editingTrace.lightPulse ?? false}
                          label={t('atrium.customize.pulsing')}
                          onChange={lightPulse => {
                            setEditingTrace({ ...editingTrace, lightPulse })
                            updateTraceCustomization(editingTrace.id, { lightPulse })
                          }}
                        />
                      </div>

                      {editingTrace.lightPulse && (
                        <div className="ml-6">
                          <label className="block text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mb-1">
                            {t('atrium.customize.pulseSpeed', { value: editingTrace.lightPulseSpeed ?? 2.0 })}
                          </label>
                          <input
                            type="range"
                            min="0.5"
                            max="5.0"
                            step="0.1"
                            value={editingTrace.lightPulseSpeed ?? 2.0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value)
                              const updated = { ...editingTrace, lightPulseSpeed: value }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { lightPulseSpeed: value })
                            }}
                            className="w-full accent-nier-bg"
                          />
                          <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                            {t('atrium.customize.pulseHint')}
                          </p>
                        </div>
                      )}
                    </div>
                    )}
                  </div>
                )}
              </div>
                )
              })()}
            </Section>
            )}

            {shapeLike && !isPathTrace && (
            <Section id="size" title={t('atrium.customize.sectionSize')}>
              <ShapeStyleControls {...shapeProps} part="size" />
            </Section>
            )}
            {/* A picture, a video, an embed, a document... sized by its
                scale, as its handles size it: typed here instead, one step of
                undo. Not a text (its font size is its size) nor a frame (its box). */}
            {!shapeLike && !isFrame(editingTrace) && editingTrace.type !== 'text' && (
            <Section id="size" title={t('atrium.customize.sectionSize')}>
              {(() => {
                const tf = localTraceTransforms[editingTrace.id] || getTraceTransform(editingTrace)
                return (
                  <ScaleControls
                    scaleX={(tf as any).scaleX ?? 1}
                    scaleY={(tf as any).scaleY ?? 1}
                    onChange={(scaleX, scaleY) => updateTraceTransform(editingTrace.id, { scaleX, scaleY })}
                  />
                )
              })()}
            </Section>
            )}
          </CustomizationPanel>
        )
      })()}

      {/* Batch Edit (BatchEditPanel): what the selection's traces have, each
          change to those that have it, as one step of undo. */}
      {showBatchEditPanel && multiSelectedIds.size > 1 && canEdit && !isDrawingMode && (
        <BatchEditPanel
          traces={traces.filter(tr => multiSelectedIds.has(tr.id))}
          lobbyId={lobbyId}
          userId={userId}
          zIndex={MENU_PANEL_Z_INDEX}
          fontOptions={FONT_FAMILY_OPTIONS}
          borderColourOf={borderColourOf}
          onChange={changes => inOneStep(() => {
            for (const { ids, patch } of changes) for (const id of ids) updateTraceCustomization(id, patch)
          })}
          // Each fitted to its own text again: auto-fit depends on the words.
          onFont={(ids, family) => inOneStep(() => {
            for (const trace of traces.filter(tr => ids.includes(tr.id))) {
              // One filling its box keeps the box; its text refits to it.
              const size = trace.textFit ? null : fittedTextBox({ ...trace, fontFamily: family })
              updateTraceCustomization(trace.id, size ? { fontFamily: family, width: size.width, height: size.height } : { fontFamily: family })
            }
          })}
          onDone={() => {
            multiSelectedIds.forEach(id => markTraceChanged(id))
            dismissedRef.current = selectionKey()
            setShowBatchEditPanel(false)
          }}
          // What can be done to all of them; a style is copied from one.
          actions={(() => {
            const ids = [...multiSelectedIds]
            const allLocked = traces.filter(tr => multiSelectedIds.has(tr.id)).every(isLockedTrace)
            const drawings = traces.filter(tr => multiSelectedIds.has(tr.id) && isDrawingTrace(tr)).length
            return (
              <>
                <PanelAction icon={ACTION_ICONS.duplicate} label={t('common.duplicate')} onClick={() => duplicateTrace(ids[0])} />
                <PanelAction icon={ACTION_ICONS.pasteStyle} label={t('atrium.menu.pasteStyle')} onClick={() => pasteTraceStyle(ids)} />
                {(() => {
                  // Of one group: to its top; else, of everything.
                  const chosen = traces.filter(tr => multiSelectedIds.has(tr.id))
                  const group = chosen[0] ? groupIdOf(chosen[0], layers) : null
                  const oneGroup = !!group && chosen.every(tr => tr.layerId === group) && !wholeGroups.groups.has(group)
                  const labels = orderLabels(oneGroup)
                  return (['up', 'down', 'top', 'bottom'] as const).map(how => (
                    <PanelAction key={how} icon={ACTION_ICONS[how]} label={labels[how]} onClick={() => moveInOrder(ids, how)} />
                  ))
                })()}
                <PanelAction
                  icon={ACTION_ICONS.lock}
                  label={allLocked ? t('atrium.menu.unlock') : t('atrium.menu.lock')}
                  active={allLocked}
                  onClick={() => inOneStep(() => { for (const id of ids) updateTraceCustomization(id, allLocked ? UNLOCKED : { isLocked: true }) })}
                />
                {drawings > 0 && (
                  <PanelAction icon={ACTION_ICONS.rasterize} label={drawings > 1 ? t('atrium.menu.rasterizeAll', { count: drawings }) : t('atrium.menu.rasterize')} onClick={() => { setShowBatchEditPanel(false); rasterize(ids) }} />
                )}
                <PanelAction icon={ACTION_ICONS.delete} label={t('common.delete')} danger onClick={() => { setShowBatchEditPanel(false); deleteTraces(ids, []) }} />
              </>
            )
          })()}
        />
      )}

      {/* Full view modal (also the text-trace preview) */}
      {modalTrace && (
        <div
          className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] pointer-events-auto"
          onClick={() => setModalTrace(null)}
        >
          <div
            className={
              (modalTrace.type === 'embed' || modalTrace.type === 'image' || modalTrace.type === 'document')
                // Both have a real aspect ratio to respect -- an embed's is
                // whatever box the user resized it to on canvas (or its
                // detected/default ratio), an image's is its natural pixel
                // dimensions. The modal shrinks to hug that computed size
                // (see below) instead of sitting in a fixed 95vw x 95vh box
                // with the content letterboxed smaller inside it.
                // overflow-hidden (not -auto) so any tiny leftover rounding
                // mismatch just clips a stray pixel instead of popping a
                // visible scrollbar -- a scrollbar showing at all reads as
                // broken, a clipped pixel doesn't.
                ? "bg-nier-blackLight border p-6 flex flex-col relative overflow-hidden"
                : "bg-nier-blackLight border p-6 max-w-3xl max-h-[80vh] overflow-auto relative"
            }
            style={{ borderColor: borderColourOf(modalTrace.type) }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60 pointer-events-none" />
            
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
                <h2 className="text-nier-strong text-sm tracking-[0.15em] uppercase font-mono">
                  {modalTrace.type === 'text' && t('atrium.controls.textTrace')}
                  {modalTrace.type === 'image' && t('atrium.controls.imageTrace')}
                  {modalTrace.type === 'audio' && t('atrium.controls.audioTrace')}
                  {modalTrace.type === 'video' && t('atrium.controls.videoTrace')}
                  {modalTrace.type === 'embed' && t('atrium.controls.embeddedContent')}
                  {modalTrace.type === 'document' && t('atrium.controls.documentTrace')}
                </h2>
              </div>
              <button
                onClick={() => setModalTrace(null)}
                className="text-nier-bg/60 hover:text-nier-strong text-lg transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Full content */}
            <div className="mb-4">
              {/* Paged document. Reuses the same per-trace page state as the
                  canvas, so the modal opens on whatever page was being read
                  and paging in either place keeps them in step -- there's one
                  document, not two independent views of it. */}
              {modalTrace.type === 'document' && (() => {
                const page = documentPage[modalTrace.id] ?? 1
                const total = documentPageCount[modalTrace.id] ?? 1
                const src = documentPages[`${modalTrace.id}:${page}`]
                // Everything above and below the page: the modal's header,
                // its padding, the page controls, and the metadata line the
                // modal appends. Budgeted generously -- undercounting is what
                // pushed the arrows below the fold and forced a scroll to
                // reach them, which for the one control the modal exists to
                // offer is the worst thing it could do.
                const MODAL_CHROME_HEIGHT = 260
                const maxHeight = Math.max(240, modalViewportSize.height * 0.95 - MODAL_CHROME_HEIGHT)

                return (
                  <div className="flex flex-col items-center gap-3">
                    <div
                      className="bg-white flex items-center justify-center"
                      style={{ maxHeight, minHeight: 240, minWidth: 240 }}
                    >
                      {isDeckFile(modalTrace.mediaUrl) ? (() => {
                        // A deck's slide, as large as fits, in its own shape.
                        const aspect = (modalTrace.width || 16) / (modalTrace.height || 9)
                        const height = Math.min(maxHeight, (modalViewportSize.width * 0.9) / aspect)
                        return (
                          <div className="relative" style={{ width: height * aspect, height }}>
                            <DeckSlide url={modalTrace.mediaUrl!} page={page} onCount={count => countSlides(modalTrace.id, count)} />
                          </div>
                        )
                      })() : src ? (
                        <img src={src} alt="" style={{ maxHeight, maxWidth: modalViewportSize.width * 0.9 }} />
                      ) : (
                        <span className="text-black/40 text-xs tracking-wider uppercase px-12 py-24">
                          {documentError[modalTrace.id] ?? t('atrium.controls.rendering')}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        className="text-nier-bg/70 hover:text-nier-strong text-lg px-3 py-1 border border-nier-border/60 hover:border-nier-border transition-colors disabled:text-nier-bg/25 disabled:border-nier-border/20 disabled:cursor-not-allowed"
                        disabled={page <= 1}
                        onClick={() => setDocumentPage(prev => ({ ...prev, [modalTrace.id]: Math.max(1, (prev[modalTrace.id] ?? 1) - 1) }))}
                      >
                        ◀
                      </button>
                      <span className="text-nier-bg/70 text-xs tracking-[0.15em] uppercase tabular-nums">
                        {t('atrium.controls.pageOf', { page, total })}
                      </span>
                      <button
                        type="button"
                        className="text-nier-bg/70 hover:text-nier-strong text-lg px-3 py-1 border border-nier-border/60 hover:border-nier-border transition-colors disabled:text-nier-bg/25 disabled:border-nier-border/20 disabled:cursor-not-allowed"
                        disabled={page >= total}
                        onClick={() => setDocumentPage(prev => ({ ...prev, [modalTrace.id]: Math.min(total, (prev[modalTrace.id] ?? 1) + 1) }))}
                      >
                        ▶
                      </button>
                    </div>
                  </div>
                )
              })()}

              {modalTrace.type === 'image' && modalTrace.mediaUrl && (() => {
                // Size the image itself to the largest it can be within the
                // viewport (minus room for this modal's own header/padding/
                // caption/metadata chrome) while preserving its natural aspect
                // ratio -- the modal's width/height above have no fixed size
                // of their own, so they shrink to hug whatever this computes.
                // Capped at 1x so a small image doesn't get blurrily upscaled.
                const dims = imageDimensions[modalTrace.id]
                const naturalWidth = dims?.width ?? 800
                const naturalHeight = dims?.height ?? 600
                const chromeHeight = 180
                const maxWidth = modalViewportSize.width * 0.95
                const maxHeight = Math.max(200, modalViewportSize.height * 0.95 - chromeHeight)
                const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1)

                return (
                  <img
                    src={imageProxySources[modalTrace.id] || modalTrace.mediaUrl}
                    alt=""
                    style={{ width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale) }}
                    className="object-contain"
                  />
                )
              })()}

              {modalTrace.type === 'video' && modalTrace.mediaUrl && (
                <video
                  src={localMediaUrls[modalTrace.id] || modalTrace.mediaUrl}
                  controls
                  autoPlay
                  className="w-full max-h-96"
                />
              )}

              {modalTrace.type === 'audio' && modalTrace.mediaUrl && (
                <div className="flex flex-col items-center p-8 bg-gradient-to-b from-gray-800/60 to-gray-900/60 rounded-lg">
                  {/* Large decorative waveform */}
                  <div className="flex items-end justify-center gap-[3px] w-full h-24 mb-6 px-4">
                    {(() => {
                      const bars = 40
                      const heights: number[] = []
                      for (let i = 0; i < bars; i++) {
                        const hash = modalTrace.id.charCodeAt(i % modalTrace.id.length) + i * 7
                        heights.push(0.15 + (((Math.sin(hash) * 43758.5453) % 1 + 1) % 1) * 0.85)
                      }
                      return heights.map((h, i) => (
                        <div
                          key={i}
                          className="flex-1 max-w-[8px] rounded-full"
                          style={{
                            height: `${h * 100}%`,
                            minHeight: '4px',
                            background: 'linear-gradient(to top, #a78bfa, #7c3aed44)',
                          }}
                        />
                      ))
                    })()}
                  </div>
                  <audio src={localMediaUrls[modalTrace.id] || modalTrace.mediaUrl} controls autoPlay className="w-full max-w-md" style={{ filter: 'brightness(0.85) contrast(1.1)' }} />
                </div>
              )}

              {modalTrace.type === 'embed' && modalTrace.mediaUrl && (() => {
                // An embed that's actually just a hotlinkable image (very
                // common now that any web-dragged image becomes an embed --
                // see the drag-drop classification fix) renders as a plain
                // <img>, same as the 'image' trace type's own modal, instead
                // of wrapping it in an iframe. Wrapping a raw image URL in
                // an iframe means the browser loads it at its own native
                // resolution inside that iframe's document, and whenever
                // that didn't match the iframe's assigned size, the iframe
                // showed its own internal scrollbars instead of the whole
                // image -- exactly the "zoomed in with scrollbars" report,
                // which persisted after the earlier border/overflow fix
                // because that fix couldn't do anything about scrolling
                // that's internal to the iframe's own embedded document.
                const hasImageExtension = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(modalTrace.mediaUrl)
                const isDirectImage = hasImageExtension || confirmedImageIds.has(modalTrace.id)

                if (isDirectImage) {
                  const dims = imageDimensions[modalTrace.id]
                  const naturalWidth = dims?.width ?? 800
                  const naturalHeight = dims?.height ?? 600
                  const chromeHeight = 180
                  const maxWidth = modalViewportSize.width * 0.95
                  const maxHeight = Math.max(200, modalViewportSize.height * 0.95 - chromeHeight)
                  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1)

                  return (
                    <img
                      src={imageProxySources[modalTrace.id] || modalTrace.mediaUrl}
                      alt=""
                      style={{ width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale) }}
                      className="object-contain"
                    />
                  )
                }

                const embedUrl = extractEmbedUrl(modalTrace.mediaUrl)

                // Fit-to-viewport for a genuine (non-image) embed, using the
                // trace's own box (whatever size the user resized it to on
                // canvas, or its detected/default aspect ratio) -- not
                // capped at 1x, since embedded web content (unlike a raster
                // image) doesn't get blurry when displayed larger, so it
                // should still grow to fill the available space.
                const { width: baseWidth, height: baseHeight } = getTraceSize(modalTrace)
                const scaleX = modalTrace.scaleX ?? modalTrace.scale ?? 1
                const scaleY = modalTrace.scaleY ?? modalTrace.scale ?? 1
                const aspectWidth = baseWidth * scaleX
                const aspectHeight = baseHeight * scaleY
                const chromeHeight = 180
                const maxWidth = modalViewportSize.width * 0.95
                const maxHeight = Math.max(200, modalViewportSize.height * 0.95 - chromeHeight)
                const scale = Math.min(maxWidth / aspectWidth, maxHeight / aspectHeight)
                const displayWidth = Math.round(aspectWidth * scale)
                const displayHeight = Math.round(aspectHeight * scale)

                if (!embedUrl) {
                  return (
                    <div style={{ width: displayWidth, height: displayHeight }} className="flex items-center justify-center bg-nier-black/50">
                      <p className="text-nier-bg/60 text-sm tracking-wider">{t('atrium.customize.invalidEmbed')}</p>
                    </div>
                  )
                }
                return (
                  <iframe
                    src={embedUrl}
                    // Same sandbox as the canvas embed above, for the same
                    // reason -- opening one full-screen shouldn't grant it more
                    // than it had.
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
                    // Chrome/Edge still render a default sunken ~2px iframe
                    // border unless explicitly overridden (Firefox doesn't),
                    // which was pushing the iframe's rendered box just past
                    // the computed size and triggering the container's
                    // overflow scrollbars -- showing a scrolled/cropped
                    // ("zoomed in") view of the embedded content in exactly
                    // the browsers that add that border.
                    frameBorder={0}
                    style={{ width: displayWidth, height: displayHeight, border: 'none', display: 'block' }}
                    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                )
              })()}

              {modalTrace.type === 'text' && (
                <div className="bg-nier-black/50 p-6 selectable-text">
                  <p className="text-nier-strong text-lg whitespace-pre-wrap break-words font-mono">
                    {modalTrace.content}
                  </p>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(modalTrace.content)
                        setCopiedModalText(true)
                        setTimeout(() => setCopiedModalText(false), 1500)
                      } catch {
                        // Ignore clipboard access failures
                      }
                    }}
                    className="mt-4 px-4 py-2 border border-nier-border/60 text-nier-strong text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors"
                  >
                    {copiedModalText ? '✓ Copied' : '◇ Copy Text'}
                  </button>
                </div>
              )}
            </div>

            {/* Caption/Description */}
            {modalTrace.content && modalTrace.type !== 'text' && (
              <div className="mb-4">
                <p className="text-nier-bg/60 text-sm italic">
                  "{modalTrace.content}"
                </p>
              </div>
            )}

            {/* Metadata */}
            <div className="flex justify-between items-center text-[10px] text-nier-bg/60 tracking-wider uppercase font-mono">
              <span>@{modalTrace.username}</span>
              <span>
                ({Math.round(modalTrace.x)}, {Math.round(modalTrace.y)})
              </span>
              <span>{new Date(modalTrace.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Player Customization Menu */}
      {showPlayerMenu && (
        <ProfileCustomization
          onClose={() => setShowPlayerMenu(false)}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {/* Naming a group made from the context menu.

          Same shell as the delete dialog below it -- backdrop, scanlines,
          corner brackets -- in the app's own colours rather than that one's
          red, since this creates something. */}
      {newGroupDialog && (
        <div
          className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] pointer-events-auto"
          onClick={() => { if (!newGroupBusy) setNewGroupDialog(null) }}
        >
          <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203, 203, 203, 0.1) 2px, rgba(203, 203, 203, 0.1) 4px)',
            }}
          />

          <form
            className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-sm w-full mx-4 relative"
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault()
              if (newGroupBusy || !newGroupDialog.name.trim()) return
              setNewGroupBusy(true)
              await createGroupAndMove(newGroupDialog.traceIds, newGroupDialog.name)
              setNewGroupBusy(false)
              setNewGroupDialog(null)
            }}
          >
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

            <div className="flex items-center gap-3 mb-4">
              <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
              <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">{t('atrium.menu.newGroupTitle')}</h2>
            </div>

            <p className="text-nier-bg/70 text-[0.8rem] leading-relaxed tracking-wide mb-4">
              {newGroupDialog.traceIds.length > 1
                ? t('atrium.controls.manyTracesMoved', { count: newGroupDialog.traceIds.length })
                : t('atrium.controls.oneTraceMoved')}
            </p>

            <input
              autoFocus
              type="text"
              value={newGroupDialog.name}
              maxLength={60}
              onChange={(e) => setNewGroupDialog(d => (d ? { ...d, name: e.target.value } : d))}
              placeholder={t('atrium.menu.groupNamePlaceholder')}
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors mb-5"
            />

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={newGroupBusy || !newGroupDialog.name.trim()}
                className="flex-1 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.1em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {newGroupBusy ? t('atrium.controls.creating') : t('atrium.controls.create')}
              </button>
              <button
                type="button"
                disabled={newGroupBusy}
                onClick={() => setNewGroupDialog(null)}
                className="flex-1 py-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors disabled:opacity-30"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteConfirmDialog && (
        <ConfirmBox
          testId="delete"
          title={deleteConfirmDialog.traceIds.length > 1 ? t('atrium.menu.deleteSelected', { count: deleteConfirmDialog.traceIds.length }) : t('atrium.layers.deleteTrace')}
          onCancel={() => setDeleteConfirmDialog(null)}
        >
            <p className="text-nier-strong mb-6 text-sm tracking-wide">
              {deleteConfirmDialog.traceIds.length > 1
                ? t('atrium.customize.deleteConfirmMany', { count: deleteConfirmDialog.traceIds.length })
                : t('atrium.customize.deleteConfirmOne')}
            </p>
            <p className="text-nier-bg/60 text-[10px] tracking-wider uppercase mb-6">
              {t('atrium.customize.deleteTipPre')} <kbd className="px-2 py-1 bg-nier-black border border-nier-border/60 text-nier-bg/70 text-[9px] tracking-wider">{t('atrium.customize.deleteKeyName')}</kbd> {t('atrium.customize.deleteTipPost')}
            </p>
            
            <div className="mb-6">
              <Check
                checked={!confirmDelete}
                label={t('atrium.customize.dontAskAgain')}
                onChange={dontAsk => useGameStore.getState().setConfirmDelete(!dontAsk)}
              />
            </div>

            <ConfirmButtons
              cancel={t('common.cancel')}
              confirm={t('common.delete')}
              onCancel={() => setDeleteConfirmDialog(null)}
              onConfirm={() => executeDelete(deleteConfirmDialog.traceIds, deleteConfirmDialog.linkIds)}
            />
        </ConfirmBox>
      )}

      {unfollowAsk && following[unfollowAsk.traceId] && (
        <ConfirmBox testId="unfollow" title={t('atrium.live.stopTitle')} onCancel={() => setUnfollowAsk(null)}>
          <p className="text-nier-strong mb-6 text-sm tracking-wide">
            {t(unfollowAsk.then ? 'atrium.live.stopToEdit' : 'atrium.live.stopBody', { name: fileName(following[unfollowAsk.traceId].path) })}
          </p>
          <ConfirmButtons
            cancel={t('common.cancel')}
            confirm={t('atrium.live.stop')}
            onCancel={() => setUnfollowAsk(null)}
            onConfirm={() => {
              stopFollowing(unfollowAsk.traceId)
              setUnfollowAsk(null)
              unfollowAsk.then?.()
            }}
          />
        </ConfirmBox>
      )}

    </div>
  )
}
