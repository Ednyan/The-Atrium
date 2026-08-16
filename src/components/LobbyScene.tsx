import { useCallback, useEffect, useRef, useState } from 'react'
import { Application, Graphics, Text, Container } from 'pixi.js'
import '@pixi/unsafe-eval'
import { useGameStore, LOBBY_SIZE_LIMIT } from '../store/gameStore'
import { usePresence } from '../hooks/usePresence'
import { mapRowToTrace } from '../hooks/useTraces'
import TracePanel from './TracePanel'
import TraceOverlay from './TraceOverlay'
import LayerPanel, { TRACE_DRAG_DATA_KEY, LAYER_DRAG_DATA_KEY } from './LayerPanel'
import LocationsPanel, { LOCATION_DRAG_DATA_KEY } from './LocationsPanel'
import type { LobbyLocation } from '../types/database'
import { LobbyManagement } from './LobbyManagement'
import { ThemeCustomization } from './ThemeCustomization'
import ProfileCustomization from './ProfileCustomization'
import { ThemeManager } from '../lib/themeManager'
import { supabase, isDesktop } from '../lib/supabase'
import { isGhostEntry as resolveGhostEntry } from '../lib/operatorGhost'
import { copyLobbyId } from '../lib/clipboard'
import { showToast } from '../lib/toast'
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition'
import { saveAllChanges, discardAllChanges } from '../lib/traceSave'
import { convertEmbedToInternalImage } from '../lib/traceConvert'
import { computeZIndexForNewTraceInLayer, computeZIndexForNewUngroupedTrace, getTraceBaseZIndex } from '../lib/layerZIndex'
import { packBoxesAroundCenter, getDefaultTraceBoxSize, scaleToDisplayBox, probeRemoteImageDimensions } from '../lib/binPack'
import { getPinterestConnectionStatus, initiatePinterestConnect } from '../lib/pinterest'
import { ReportFeedbackModal } from './ReportFeedbackModal'
import PinterestImportPanel from './PinterestImportPanel'
// pathSimplify no longer needed - drawings saved as raster images
import type { Lobby, Trace } from '../types/database'

const AVATAR_SIZE = 20
const TRACE_RENDER_DISTANCE = 2000
const TRACE_FADE_DISTANCE = 1500
const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.40
const DEFAULT_ZOOM_SENSITIVITY = 0.16
// One keypress of zoom. Sized so a held key travels the range in a couple of
// seconds rather than either crawling or jumping.
const KEYBOARD_ZOOM_STEP = 0.6

// Dark halo for HUD text that floats directly over the canvas. The atrium's
// background is user-themeable, so these labels can end up on any colour --
// a single drop shadow only works in one direction, whereas offsets on all
// four sides plus a soft blur keep the text legible against a light theme
// without looking heavy against a dark one.
const HUD_TEXT_OUTLINE =
  '0 0 4px rgba(0,0,0,0.95), 1px 0 2px rgba(0,0,0,0.9), -1px 0 2px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,0.9), 0 -1px 2px rgba(0,0,0,0.9)'

const clampZoomSensitivity = (value: number) => Math.max(0.04, Math.min(0.6, value))

function mapLocationRow(row: any): LobbyLocation {
  return {
    id: row.id,
    createdAt: row.created_at,
    lobbyId: row.lobby_id,
    name: row.name,
    positionX: row.position_x,
    positionY: row.position_y,
    zoom: row.zoom ?? 1,
    orderIndex: row.order_index ?? 0,
    userId: row.user_id,
    isLocked: !!row.is_locked,
  }
}

const formatTimeInAtrium = (joinedAt: number | undefined) => {
  if (!joinedAt) return '—'
  const elapsedMs = Math.max(0, Date.now() - joinedAt)
  const totalMinutes = Math.floor(elapsedMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return '<1m'
}

const getStoredZoomSensitivity = () => {
  try {
    const raw = localStorage.getItem('lobby_zoomSensitivity')
    if (!raw) return DEFAULT_ZOOM_SENSITIVITY
    const parsed = parseFloat(raw)
    if (!Number.isFinite(parsed)) return DEFAULT_ZOOM_SENSITIVITY
    return clampZoomSensitivity(parsed)
  } catch {
    return DEFAULT_ZOOM_SENSITIVITY
  }
}

const clampAutosaveInterval = (value: number) => Math.max(10, Math.min(600, value))

const inferFileExtension = (file: File) => {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase()
  if (fromName) return fromName

  const mimeToExtension: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
  }

  return mimeToExtension[file.type] || 'bin'
}

const IMAGE_FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif'])
const AUDIO_FILE_EXTENSIONS = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a'])
const VIDEO_FILE_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v'])
const IMAGE_URL_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(\?.*)?$/i
const VIDEO_URL_PATTERN = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?.*)?$/i
const AUDIO_URL_PATTERN = /\.(mp3|wav|flac|aac|m4a)(\?.*)?$/i

type DroppedUrlPayload = {
  url: string
  forceImage: boolean
}

const classifyDroppedFile = (file: File): 'image' | 'audio' | 'video' | 'text' => {
  const mime = file.type.toLowerCase()
  const extension = inferFileExtension(file)

  if (mime.startsWith('image/') || IMAGE_FILE_EXTENSIONS.has(extension)) return 'image'
  if (mime.startsWith('audio/') || AUDIO_FILE_EXTENSIONS.has(extension)) return 'audio'
  if (mime.startsWith('video/') || VIDEO_FILE_EXTENSIONS.has(extension)) return 'video'
  return 'text'
}

// Reads a dropped/pasted image file's real dimensions from a throwaway blob
// URL (fast, local, no network) so a multi-item batch can be bin-packed
// against actual aspect ratios rather than a flat default box. Falls back to
// null on failure/timeout so the caller can use a default size instead.
const probeImageFileDimensions = (file: File, timeoutMs = 1500): Promise<{ width: number; height: number } | null> => {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    let settled = false
    const finish = (result: { width: number; height: number } | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timeout = setTimeout(() => finish(null), timeoutMs)
    const img = new Image()
    img.onload = () => {
      clearTimeout(timeout)
      finish(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    }
    img.onerror = () => {
      clearTimeout(timeout)
      finish(null)
    }
    img.src = url
  })
}

// probeRemoteImageDimensions now lives in ../lib/binPack (shared with
// TraceOverlay's "Reorganize Selected", which has the same wrong-box-size
// problem for traces not currently rendered on screen).

const classifyRemoteTraceType = (url: string): 'image' | 'video' | 'audio' | 'embed' => {
  const lower = url.toLowerCase()

  if (lower.startsWith('data:image/')) return 'image'
  if (lower.startsWith('data:video/')) return 'video'
  if (lower.startsWith('data:audio/')) return 'audio'
  if (IMAGE_URL_PATTERN.test(lower)) return 'image'
  if (VIDEO_URL_PATTERN.test(lower)) return 'video'
  if (AUDIO_URL_PATTERN.test(lower)) return 'audio'
  return 'embed'
}

const getDroppedUrlPayload = (value: string): DroppedUrlPayload | null => {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

  for (const line of lines) {
    const firstColon = line.indexOf(':')
    const secondColon = firstColon >= 0 ? line.indexOf(':', firstColon + 1) : -1

    if (firstColon > 0 && secondColon > firstColon + 1) {
      const mime = line.slice(0, firstColon).trim().toLowerCase()
      const url = line.slice(secondColon + 1).trim()
      if (/^https?:\/\//i.test(url) && mime.startsWith('image/')) {
        return { url, forceImage: true }
      }
    }

    const match = line.match(/https?:\/\/[^\s"'<>]+/i)
    if (!match) continue

    try {
      const parsed = new URL(match[0])
      const redirectedImageUrl = parsed.searchParams.get('imgurl') || parsed.searchParams.get('mediaurl')
      if (redirectedImageUrl && /^https?:\/\//i.test(redirectedImageUrl)) {
        return { url: redirectedImageUrl, forceImage: true }
      }
    } catch {
      // Ignore malformed URLs and fall back to the original match.
    }

    return { url: match[0], forceImage: false }
  }

  return null
}

// Last resort: read every format the drag offered, standard or not, and look
// for an image URL inside it.
//
// Sites attach their own drag payloads under private MIME types, and some
// browsers hand over *only* those. Dragging a Pinterest image out of Brave
// offers `application/x-pinterest-closeup-image` and `chromium/x-drag-id` and
// nothing else -- no text/html, no text/uri-list, no DownloadURL -- where the
// same drag out of Chrome offers the standard set. There is no registry of
// these private types to implement against, but they are near-universally JSON
// or text with the URL sitting in them somewhere, so scanning for one works
// without knowing any particular site's schema.
//
// Deliberately the final fallback, after every real extractor: this is pattern
// matching on someone else's opaque payload, and it should never get a chance
// to pick a tracking pixel over a URL a proper extractor understood.
const SCAVENGE_SKIP_TYPES = new Set([
  'Files',
  'text/html',
  'text/plain',
  'text/uri-list',
  'text/x-moz-url',
  'DownloadURL',
])

const scavengeUrlFromDataTransfer = (dataTransfer: DataTransfer): DroppedUrlPayload | null => {
  let best: { url: string; score: number } | null = null

  for (const type of Array.from(dataTransfer.types || [])) {
    if (SCAVENGE_SKIP_TYPES.has(type)) continue

    let raw = ''
    try {
      raw = dataTransfer.getData(type) || ''
    } catch {
      continue // some types refuse to be read as text
    }
    if (!raw) continue

    // JSON escapes its slashes and unicode; unescaping first means the regex
    // below sees a real URL rather than `https:\/\/i.pinimg.com\/...`.
    const text = raw.replace(/\\\//g, '/').replace(/\\u002[fF]/g, '/')

    for (const match of text.matchAll(/https?:\/\/[^\s"'<>\\)\]},]+/gi)) {
      const url = match[0]
      // Weighted rather than first-wins: these payloads carry thumbnails,
      // avatars and analytics endpoints alongside the image being dragged.
      let score = 0
      if (classifyRemoteTraceType(url) === 'image') score += 2
      if (/\/originals?\//i.test(url)) score += 1 // full-size, not a thumbnail
      if (score === 0) continue // an arbitrary link is too likely to be junk

      if (!best || score > best.score) best = { url, score }
    }
  }

  return best ? { url: best.url, forceImage: true } : null
}

const extractImageUrlFromHtml = (html: string): DroppedUrlPayload | null => {
  if (!html.trim()) return null

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const imageCandidates = [
      ...Array.from(doc.querySelectorAll('img[src]')).map((img) => img.getAttribute('src')),
      ...Array.from(doc.querySelectorAll('img[srcset]')).map((img) => img.getAttribute('srcset')?.split(',')[0]?.trim().split(/\s+/)[0] || null),
      ...Array.from(doc.querySelectorAll('[data-src]')).map((node) => node.getAttribute('data-src')),
      ...Array.from(doc.querySelectorAll('[data-image-url]')).map((node) => node.getAttribute('data-image-url')),
      ...Array.from(doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')).map((meta) => meta.getAttribute('content')),
    ]

    for (const candidate of imageCandidates) {
      const payload = candidate ? getDroppedUrlPayload(candidate) : null
      if (payload) {
        return { url: payload.url, forceImage: true }
      }
    }

    const linkCandidates = Array.from(doc.querySelectorAll('a[href]')).map((anchor) => anchor.getAttribute('href'))
    for (const candidate of linkCandidates) {
      const payload = candidate ? getDroppedUrlPayload(candidate) : null
      if (!payload) continue
      if (payload.forceImage || classifyRemoteTraceType(payload.url) === 'image') {
        return { url: payload.url, forceImage: true }
      }
    }
  } catch {
    // Invalid HTML payloads should fall through to other drop handlers.
  }

  const redirectMatch = html.match(/(?:imgurl|mediaurl)=([^"'&\s>]+)/i)
  if (!redirectMatch) return null

  try {
    const decoded = decodeURIComponent(redirectMatch[1])
    if (/^https?:\/\//i.test(decoded)) {
      return { url: decoded, forceImage: true }
    }
  } catch {
    // Ignore invalid encodings and fall through.
  }

  return null
}

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  if (!element) return false
  return element.isContentEditable || element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]') !== null
}

interface LobbySceneProps {
  lobbyId: string
  onLeaveLobby: () => void
}

export default function LobbyScene({ lobbyId, onLeaveLobby }: LobbySceneProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldContainerRef = useRef<Container | null>(null)
  const avatarsRef = useRef<Map<string, Graphics>>(new Map())
  const tracesRef = useRef<Map<string, Container>>(new Map())
  const labelRef = useRef<Text | null>(null)
  const playerAvatarRef = useRef<Graphics | null>(null)
  const positionRef = useRef({ x: 0, y: 0 })
  const tracePlacementIndicatorRef = useRef<Graphics | null>(null)
  const traceIndicatorsRef = useRef<Container | null>(null)
  // Object pool for trace indicators to prevent memory leaks
  const indicatorPoolRef = useRef<Array<{ graphics: Graphics, distanceText: Text, unitText: Text }>>([])
  const tracesDataRef = useRef<typeof traces>([])
  const otherUsersRef = useRef<typeof otherUsers>({})
  const zoomRef = useRef(1.0)
  const targetZoomRef = useRef(1.0) // Target zoom for smooth interpolation
  const cameraRestoredRef = useRef(false) // Whether we restored a saved camera position
  // Smooth camera fly-to for Locations panel jumps / presentation mode. The
  // ticker eases cameraPositionRef + zoom toward the target; any manual pan or
  // zoom cancels it (set to null) so the user is never fighting the animation.
  const cameraFlyToRef = useRef<{
    startX: number; startY: number; startZoom: number
    targetX: number; targetY: number; targetZoom: number
    startTime: number; duration: number
  } | null>(null)
  const isPanningRef = useRef(false)
  const lastPanPositionRef = useRef({ x: 0, y: 0 })
  const lastMouseScreenPositionRef = useRef<{ x: number; y: number } | null>(null)
  // Last time the cursor moved inside this atrium -- feeds the password
  // session heartbeat below (touch_lobby_session), which keeps an actively-
  // used password verification from expiring, per check_and_touch_lobby_access's
  // 30-minute idle window on the App.tsx side.
  const lastActivityAtRef = useRef(Date.now())
  const mouseDownScreenPosRef = useRef<{ x: number; y: number } | null>(null)
  // Shift+drag on empty canvas draws a selection rectangle instead of
  // panning; areaSelectRectRef is the visual box, mutated directly on
  // mousemove (like brushCursorRef) to avoid re-rendering on every pixel.
  const isAreaSelectingRef = useRef(false)
  const areaSelectRectRef = useRef<HTMLDivElement>(null)
  const showTracePanelRef = useRef(false)
  const worldOffsetRef = useRef({ x: 0, y: 0 })
  const cameraPositionRef = useRef({ x: 0, y: 0 }) // Independent camera position
  const zoomSensitivityRef = useRef(getStoredZoomSensitivity())
  // Per-atrium: how a multi-item drop/paste batch gets arranged (see the
  // Profile panel's "Batch Placement" setting and binPack.ts).
  const packingShapeRef = useRef<'square' | 'circle'>('square')
  const autosaveSettingsRef = useRef({ enabled: false, intervalSeconds: 60 })
  const lightingLayerRef = useRef<Graphics | null>(null)
  const themeManagerRef = useRef<ThemeManager | null>(null)
  const gridRef = useRef<Graphics | null>(null)
  const updateGridRef = useRef<((cameraX: number, cameraY: number) => void) | null>(null)
  // prevThemeSettingsRef removed - was causing theme update issues
  const eventHandlersRef = useRef<{
    mousedown: ((e: MouseEvent) => void) | null,
    mousemove: ((e: MouseEvent) => void) | null,
    mouseup: ((e: MouseEvent) => void) | null,
    contextmenu: ((e: MouseEvent) => void) | null,
    wheel: ((e: WheelEvent) => void) | null,
    touchstart: ((e: TouchEvent) => void) | null,
    touchmove: ((e: TouchEvent) => void) | null,
    touchend: ((e: TouchEvent) => void) | null,
  }>({ mousedown: null, mousemove: null, mouseup: null, contextmenu: null, wheel: null, touchstart: null, touchmove: null, touchend: null })
  const lastTouchDistRef = useRef<number | null>(null)
  const [clickedTracePosition, setClickedTracePosition] = useState<{ x: number; y: number } | null>(null)

  // The rectangle a shape trace will be created at, in world units. Held here
  // rather than in TracePanel because it's drawn on the canvas and centred on
  // the placement position, both of which this component owns.
  //
  // Size only -- the centre is clickedTracePosition, which the drag also sets,
  // so the existing placement plumbing keeps working unchanged.
  type ShapeDraft = {
    width: number
    height: number
    cornerRadius: number
    shapeType: 'rectangle' | 'circle' | 'triangle'
  }
  const [shapeDraftSize, setShapeDraftSize] = useState<ShapeDraft | null>(null)
  const shapeDraftSizeRef = useRef<ShapeDraft | null>(null)
  useEffect(() => { shapeDraftSizeRef.current = shapeDraftSize }, [shapeDraftSize])

  // The Pixi ticker is registered once, in an effect with no dependencies, so
  // anything it reads has to come through a ref. clickedTracePosition was
  // being read as state there, which means it was pinned to its first-render
  // value of null -- the placement indicator that code draws has never
  // actually appeared. Mirroring it here fixes that as well as the shape
  // preview, which would otherwise have inherited the same fault.
  const clickedTracePositionRef = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => { clickedTracePositionRef.current = clickedTracePosition }, [clickedTracePosition])

  // Placement markers used a fixed gold, which sat somewhere between the
  // background and the foreground on a dark theme and vanished outright on a
  // light one. These follow the atrium's own background instead, so the
  // indicator is always the opposite end of the range from whatever it's
  // drawn on. A ref because the Pixi ticker reads it.
  const indicatorColorRef = useRef({ primary: 0xffffff })

  // The panel publishing its current shape settings. Adopt them, and make sure
  // there's a placement position to centre the preview on.
  //
  // Returns the previous object unchanged when nothing actually differs. The
  // panel republishes on every change, including ones that originated from a
  // canvas drag, so without this the two would keep handing the same values
  // back and forth and never settle.
  const handleShapeDraftChange = useCallback((draft: ShapeDraft) => {
    setShapeDraftSize(prev => (
      prev &&
      prev.width === draft.width &&
      prev.height === draft.height &&
      prev.cornerRadius === draft.cornerRadius &&
      prev.shapeType === draft.shapeType
        ? prev
        : draft
    ))
    setClickedTracePosition(prev => prev ?? { x: positionRef.current.x, y: positionRef.current.y })
  }, [])

  const handleShapeModeChange = useCallback((active: boolean) => {
    shapeDragArmedRef.current = active
    // Leaving shape mode (switching type, or closing the panel) drops the
    // preview -- it describes a shape that is no longer being created.
    if (!active) {
      setShapeDraftSize(null)
      isShapeDraggingRef.current = false
      shapeDragStartWorldRef.current = null
    }
  }, [])

  // Whether the open panel is on a sizeable shape type, i.e. whether a drag on
  // empty canvas should draw a shape instead of panning.
  const shapeDragArmedRef = useRef(false)
  const isShapeDraggingRef = useRef(false)
  const shapeDragStartWorldRef = useRef<{ x: number; y: number } | null>(null)
  // One-shot signal telling TraceOverlay "select this brand-new path and
  // start its point-placing mode immediately" -- see handleCreatePath.
  const [newPathTraceId, setNewPathTraceId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1.0)
  const [worldOffset, setWorldOffset] = useState({ x: 0, y: 0 })
  const [onlinePlayerCount, setOnlinePlayerCount] = useState(1) // Start with 1 (self)
  const [showOnlineUsersList, setShowOnlineUsersList] = useState(false)
  // Forces the online-users list to re-render its "time in atrium" values
  // periodically while open, rather than only on other state changes.
  const [, setOnlineUsersListTick] = useState(0)
  
  const { username, position, otherUsers, traces, userId, pendingChanges, deletedTraces, isSavingChanges, hasPendingChanges } = useGameStore()
  const [showTracePanel, setShowTracePanel] = useState(false)
  useEffect(() => { showTracePanelRef.current = showTracePanel }, [showTracePanel])
  const [tracePanelInitialType, setTracePanelInitialType] = useState<'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document' | undefined>(undefined)
  const [tracePanelInitialShapeType, setTracePanelInitialShapeType] = useState<'rectangle' | 'circle' | 'triangle' | 'path' | undefined>(undefined)
  // A PDF dropped on the canvas, handed to the panel so it opens with the
  // file already chosen instead of asking for it again.
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null)

  const [mapContextMenu, setMapContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null)

  // Whether the clipboard currently holds an image, as far as we can tell:
  // true/false when the clipboard could be inspected, null when it couldn't.
  //
  // Ctrl+V has always pasted images onto the canvas, but plenty of people
  // don't reach for it -- they copy an image, right-click where they want it,
  // and look for "Paste Image". So the menu offers it, and reads the clipboard
  // when it opens to decide whether to.
  const [clipboardHasImage, setClipboardHasImage] = useState<boolean | null>(null)
  // How much zoom one wheel event is worth.
  //
  // The old scaling assumed mouse-wheel deltas, which are around 100 per
  // notch. A trackpad's two-finger scroll reports 3 to 10, so the same formula
  // gave roughly a twenty-fifth of the zoom per event -- technically working,
  // in practice indistinguishable from nothing, which is why zoom looked
  // unavailable without a wheel.
  //
  // deltaMode is normalised first (some browsers report lines or pages rather
  // than pixels), then small deltas are treated as a fine-grained device and
  // scaled up. Trackpads fire many events per second where a wheel fires a
  // few, so the per-event step has to be much smaller than a notch while still
  // adding up to a comparable rate.
  // What a wheel event is asking for.
  //
  // A trackpad and a mouse wheel arrive through the same event, so this has to
  // be inferred. The signals, in order of reliability:
  //
  //   ctrlKey        A pinch. The OS reports pinch-to-zoom as ctrl+wheel, on
  //                  every platform. Unambiguous.
  //   deltaX         Two-finger scrolling moves in both axes; a wheel has no
  //                  horizontal axis to report.
  //   fractional Y   Trackpads report continuous, often fractional deltas.
  //                  Wheel notches are whole numbers.
  //   small Y        A wheel notch is ~100 (or 120, or 53 depending on the
  //                  driver); trackpad deltas are single digits.
  //
  // Anything else is treated as a wheel, so the mouse keeps zooming as it
  // always has -- that's the case where being wrong is most annoying.
  // When a scroll was last recognised as a trackpad one. A two-finger scroll
  // fires a dense stream of events, so the middle of a fast flick -- large,
  // whole-numbered, purely vertical -- looks exactly like a wheel notch on its
  // own. Recognising the gesture from its opening events and holding that
  // reading for as long as events keep arriving avoids a flick that starts by
  // panning and finishes by zooming.
  const lastPanScrollAtRef = useRef(0)
  const PAN_GESTURE_GAP_MS = 250

  const classifyWheel = (e: WheelEvent): 'zoom' | 'pan' => {
    if (e.ctrlKey) return 'zoom'
    if (e.deltaMode !== 0) return 'zoom'

    const trackpadish =
      e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40
    const continuing = e.timeStamp - lastPanScrollAtRef.current < PAN_GESTURE_GAP_MS

    if (trackpadish || continuing) {
      lastPanScrollAtRef.current = e.timeStamp
      return 'pan'
    }
    return 'zoom'
  }

  const wheelZoomDelta = (e: WheelEvent): number => {
    let raw = e.deltaY
    if (e.deltaMode === 1) raw *= 16       // lines -> approximate pixels
    else if (e.deltaMode === 2) raw *= 100 // pages -> approximate pixels

    // A pinch reports small deltas, so it still needs amplifying relative to a
    // wheel notch -- but only a little. A pinch fires a continuous stream of
    // events for as long as the fingers move, so a per-event step sized like a
    // wheel click compounds into an unusable lurch.
    const perEvent = e.ctrlKey ? 0.003 : 0.001

    // Clamped so one enormous event (some mice, some drivers) can't jump the
    // whole zoom range at once.
    return Math.max(-1, Math.min(1, -raw * perEvent))
  }

  const applyZoomDelta = (delta: number) => {
    cameraFlyToRef.current = null
    targetZoomRef.current = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, targetZoomRef.current + delta * zoomSensitivityRef.current),
    )
  }

  // Nudges the camera by a world-space delta. Written straight to the ref the
  // Pixi ticker reads, exactly as the existing drag-to-pan does, so it takes
  // effect on the next frame without a re-render per step.
  const panCameraBy = useCallback((worldDx: number, worldDy: number) => {
    cameraPositionRef.current.x += worldDx
    cameraPositionRef.current.y += worldDy
  }, [])

  const mapContextMenuRef = useRef<HTMLDivElement>(null)
  const mapContextMenuPos = useClampedMenuPosition(mapContextMenuRef, mapContextMenu?.x ?? 0, mapContextMenu?.y ?? 0)
  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [showLocationsPanel, setShowLocationsPanel] = useState(false)

  // Both panels are docked over the right-hand side of the canvas, which is
  // exactly the area you need free while placing a trace or drawing -- they
  // cover the spot you're aiming at and swallow the clicks meant for it. So
  // starting either activity closes them.
  const closeSidePanels = useCallback(() => {
    setShowLayerPanel(false)
    setShowLocationsPanel(false)
  }, [])
  // Saved (persisted) locations from the DB, and the local editable working
  // copy. Edits (add/rename/delete/reorder) only touch the working copy and
  // set locationsDirty; nothing is written -- and so nothing is broadcast
  // over realtime -- until the user hits "Save Changes", which persists the
  // whole diff at once. Both live here (not in LocationsPanel) so presentation
  // mode keeps running after the panel is closed and the on-screen quick
  // toggle can know whether any locations exist.
  const [savedLocations, setSavedLocations] = useState<LobbyLocation[]>([])
  const [workingLocations, setWorkingLocations] = useState<LobbyLocation[]>([])
  const [locationsDirty, setLocationsDirty] = useState(false)
  const [presentationMode, setPresentationMode] = useState(false)
  const [presentationIndex, setPresentationIndex] = useState(0)
  const workingLocationsRef = useRef<LobbyLocation[]>([])
  const presentationModeRef = useRef(false)
  const presentationIndexRef = useRef(0)
  useEffect(() => { workingLocationsRef.current = workingLocations }, [workingLocations])
  useEffect(() => { presentationModeRef.current = presentationMode }, [presentationMode])
  useEffect(() => { presentationIndexRef.current = presentationIndex }, [presentationIndex])
  const [showLobbyManagement, setShowLobbyManagement] = useState(false)
  const [showThemeCustomization, setShowThemeCustomization] = useState(false)
  const [showProfileCustomization, setShowProfileCustomization] = useState(false)
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null)

  // Fills in indicatorColorRef (declared above, since the ticker reads it).
  // Lives here rather than beside the ref because the dependency array is
  // evaluated during render, so it can't reference currentLobby any earlier.
  useEffect(() => {
    const hex = currentLobby?.themeSettings?.backgroundColor ?? '#0a0a0f'
    const value = parseInt(hex.replace('#', ''), 16)
    if (Number.isNaN(value)) return
    const r = (value >> 16) & 255
    const g = (value >> 8) & 255
    const b = value & 255
    // Rec. 709 relative luminance -- green dominates perceived brightness, so
    // a plain average would call a saturated green background "dark".
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    // One colour, not two. A second, brighter accent in the middle is what
    // made the marker read as an alert rather than a hint. Near-black rather
    // than pure black on a light background, so it reads as drawn on the
    // canvas rather than as a hole punched in it.
    indicatorColorRef.current = luminance > 0.5
      ? { primary: 0x1a1a1a }
      : { primary: 0xffffff }
  }, [currentLobby?.themeSettings?.backgroundColor])
  const [isLobbyOwner, setIsLobbyOwner] = useState(false)
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  // The layer group new traces are created into (null = ungrouped). Set by
  // clicking a group/Ungrouped header in the Layer panel.
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null)
  // One-shot request for TraceOverlay to multi-select a set of trace ids,
  // fired when the user clicks a group in the Layer panel. TraceOverlay owns
  // its own selection state internally, so this is passed down rather than
  // lifting that state up wholesale.
  const [multiSelectRequest, setMultiSelectRequest] = useState<string[] | null>(null)
  // Mirrors TraceOverlay's own multi-selection state (reported up via
  // onMultiSelectionChange) so the Layer panel can highlight every
  // multi-selected trace/group, not just the single selectedTraceId.
  const [multiSelectedTraceIds, setMultiSelectedTraceIds] = useState<string[]>([])

  // activeLayerId used to be cleared here too, on the theory that it should
  // track canvas selection (deselecting on the canvas should un-target the
  // group). That assumption broke once focusing a group (clicking its name,
  // just sets the target) and selecting its traces (clicking its diamond
  // icon) became separate actions: focusing a group is now meant to persist
  // independently of canvas selection, specifically so a new trace can still
  // be placed into it -- placing a trace involves clicking the canvas/context
  // menu, which deselects, which was wiping activeLayerId right back to null
  // first and silently dropping every new trace into "ungrouped".
  // Drives the top-right "Saving..." indicator for every save trigger --
  // autosave, the manual HUD Save Changes button, AND Ctrl+S (whose handler
  // lives in TraceOverlay and calls saveAllChanges() directly, with no way
  // to reach a LobbyScene-local trigger function). Tracking the store's
  // shared isSavingChanges flag instead of requiring each caller to opt in
  // via a wrapper means every current and future saveAllChanges() call
  // shows the indicator automatically. The name is legacy from when it was
  // autosave-only.
  const [isAutosaving, setIsAutosaving] = useState(false)
  const savingStartedAtRef = useRef<number | null>(null)
  useEffect(() => {
    // Floor so a save that finishes in a blink doesn't flash the indicator
    // too fast to read.
    const MIN_SAVING_INDICATOR_MS = 4000
    if (isSavingChanges) {
      savingStartedAtRef.current = Date.now()
      setIsAutosaving(true)
      return
    }
    if (savingStartedAtRef.current === null) return
    const elapsed = Date.now() - savingStartedAtRef.current
    savingStartedAtRef.current = null
    const remaining = MIN_SAVING_INDICATOR_MS - elapsed
    if (remaining <= 0) {
      setIsAutosaving(false)
      return
    }
    const timeout = setTimeout(() => setIsAutosaving(false), remaining)
    return () => clearTimeout(timeout)
  }, [isSavingChanges])
  const [hudMinimized, setHudMinimized] = useState(true)
  const [drawControlsMinimized, setDrawControlsMinimized] = useState(false)
  const [controlsMinimized, setControlsMinimized] = useState(true)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [showReportForm, setShowReportForm] = useState(false)
  const [kickTarget, setKickTarget] = useState<{ userId: string; username: string } | null>(null)
  const [isKicking, setIsKicking] = useState(false)
  const [isConvertingEmbeds, setIsConvertingEmbeds] = useState(false)
  const [convertEmbedsProgress, setConvertEmbedsProgress] = useState('')
  const [pinterestConnected, setPinterestConnected] = useState(false)
  const [showPinterestImport, setShowPinterestImport] = useState(false)
  const [pinterestImportAnchor, setPinterestImportAnchor] = useState<{ x: number; y: number } | null>(null)
  const [showLocalFileBlockedDialog, setShowLocalFileBlockedDialog] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  // Last-resort clear for the "drop to create trace" overlay.
  //
  // The overlay is turned off by this component's own drop handler, which is
  // fine for a drop onto the canvas -- but a drag that ends inside a panel
  // (reordering a group, say) is handled there and calls stopPropagation, so
  // the canvas handler never runs and the overlay stayed on screen until the
  // page was reloaded. dragend fires on the drag source however the drag
  // finished, including when it's cancelled with Escape, so it's the one
  // signal that can't be swallowed on the way up.
  useEffect(() => {
    const clear = () => setIsDragOver(false)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const hudRef = useRef<HTMLDivElement>(null)

  // Warn user when leaving/refreshing with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useGameStore.getState().hasPendingChanges()) {
        e.preventDefault()
        e.returnValue = '' // Required for Chrome
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const ensureLobbyHasSpace = () => {
    if (!useGameStore.getState().isLobbyFull()) return true

    const sizeMB = (useGameStore.getState().getLobbySizeBytes() / (1024 * 1024)).toFixed(1)
    alert(`This atrium has reached its ${(LOBBY_SIZE_LIMIT / (1024 * 1024)).toFixed(0)}MB size limit (currently ${sizeMB}MB). Delete some traces to free up space.`)
    return false
  }

  const getWorldPositionFromScreen = (screenX: number, screenY: number) => {
    if (!worldContainerRef.current) {
      return { x: cameraPositionRef.current.x, y: cameraPositionRef.current.y }
    }

    return {
      x: (screenX - worldContainerRef.current.x) / zoomRef.current,
      y: (screenY - worldContainerRef.current.y) / zoomRef.current,
    }
  }

  // Reset PixiJS ticker when returning from Alt-Tab to prevent cursor sluggishness
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && appRef.current) {
        const ticker = appRef.current.ticker
        ;(ticker as any).lastTime = performance.now()
        // Snap zoom to target immediately to avoid laggy interpolation
        if (zoomRef.current !== targetZoomRef.current) {
          zoomRef.current = targetZoomRef.current
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Freehand drawing mode
  const [isDrawingMode, setIsDrawingMode] = useState(false)

  // Watches the two activities rather than patching each of the several places
  // that start them (the HUD buttons, the T key, the canvas context menu), so
  // a new entry point can't quietly miss this. Fires only on the transition
  // into an activity, so reopening a panel mid-draw is still allowed -- it's
  // the user's call at that point.
  useEffect(() => {
    if (showTracePanel || isDrawingMode) closeSidePanels()
  }, [showTracePanel, isDrawingMode, closeSidePanels])

  const [isDrawing, setIsDrawing] = useState(false)
  const [isEraserMode, setIsEraserMode] = useState(false)
  const [completedStrokes, setCompletedStrokes] = useState<Array<{ points: Array<{ x: number; y: number }>; color: string; width: number; isEraser: boolean }>>([])
  const [drawingColor, setDrawingColor] = useState('#ffffff')
  const [drawingWidth, setDrawingWidth] = useState(3)
  const [drawingSmoothing, setDrawingSmoothing] = useState(30)
  const [isSavingDrawing, setIsSavingDrawing] = useState(false)
  const currentStrokeRef = useRef<Array<{ x: number; y: number }>>([])
  const isDrawingModeRef = useRef(false)
  const isEraserModeRef = useRef(false)
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null)
  const completedStrokesRef = useRef<typeof completedStrokes>([])
  const drawingColorRef = useRef('#ffffff')
  const drawingWidthRef = useRef(3)
  const smoothedPointRef = useRef<{ x: number; y: number } | null>(null)
  const drawingSmoothingRef = useRef(30)
  const brushCursorRef = useRef<HTMLDivElement>(null)

  // Keep drawing mode ref in sync
  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode
  }, [isDrawingMode])

  // The exponential-moving-average smoothing factor is only perceptibly
  // different from "off" once it's fairly high -- alpha (1 - smoothing)
  // barely changes the stroke's responsiveness until smoothing climbs past
  // roughly 0.7, so most of the old 0-100% slider (mapped 1:1 to smoothing)
  // did effectively nothing and all the usable range was crammed into
  // 70-100%. Remap the slider so 0% is a true "no smoothing" (raw points,
  // no EMA at all) and (0, 100] linearly covers the old 70-95% (its cap)
  // range where the effect actually varies.
  const computeSmoothingFactor = (sliderValue: number): number => {
    if (sliderValue <= 0) return 0
    return 0.70 + (Math.min(sliderValue, 100) / 100) * 0.25
  }

  // Keep drawing refs in sync
  useEffect(() => { isEraserModeRef.current = isEraserMode }, [isEraserMode])
  useEffect(() => { drawingColorRef.current = drawingColor }, [drawingColor])
  useEffect(() => { drawingWidthRef.current = drawingWidth }, [drawingWidth])
  useEffect(() => { drawingSmoothingRef.current = drawingSmoothing }, [drawingSmoothing])

  // Keep the brush/eraser size-preview circle in sync with the current size and mode.
  // Position is updated directly via the ref in the canvas mouse handlers (not React
  // state) to avoid a re-render on every pixel of mouse movement.
  useEffect(() => {
    const el = brushCursorRef.current
    if (!el) return
    el.style.width = `${drawingWidth}px`
    el.style.height = `${drawingWidth}px`
    el.style.borderColor = isEraserMode ? 'rgba(200,200,200,0.9)' : drawingColor
    el.style.borderStyle = isEraserMode ? 'dashed' : 'solid'
  }, [drawingWidth, isEraserMode, drawingColor])
  useEffect(() => {
    completedStrokesRef.current = completedStrokes
    renderDrawingCanvas()
  }, [completedStrokes])

  // Canvas drawing helpers
  const drawBezierStroke = (ctx: CanvasRenderingContext2D, points: Array<{x: number; y: number}>, color: string, width: number, isEraser: boolean) => {
    if (points.length === 0) return
    ctx.save()
    ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over'

    if (points.length === 1) {
      // A click with no movement -- draw a single dot instead of nothing,
      // matching what most drawing apps do for a stationary tap/click.
      ctx.fillStyle = isEraser ? 'rgba(0,0,0,1)' : color
      ctx.beginPath()
      ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }

    ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y)
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = i > 0 ? points[i - 1] : points[i]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = i + 2 < points.length ? points[i + 2] : p2
        const tension = 0.5
        const cp1x = p1.x + (p2.x - p0.x) / 6 * tension
        const cp1y = p1.y + (p2.y - p0.y) / 6 * tension
        const cp2x = p2.x - (p3.x - p1.x) / 6 * tension
        const cp2y = p2.y - (p3.y - p1.y) / 6 * tension
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
      }
    }
    ctx.stroke()
    ctx.restore()
  }

  const renderDrawingCanvas = () => {
    const canvas = drawingCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Draw completed strokes
    for (const stroke of completedStrokesRef.current) {
      drawBezierStroke(ctx, stroke.points, stroke.color, stroke.width, stroke.isEraser)
    }
    // Draw current active stroke
    if (currentStrokeRef.current.length >= 1) {
      drawBezierStroke(ctx, currentStrokeRef.current, drawingColorRef.current, drawingWidthRef.current, isEraserModeRef.current)
    }
  }

  // Canvas resize effect
  useEffect(() => {
    if (!isDrawingMode) return
    const canvas = drawingCanvasRef.current
    if (!canvas) return
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      renderDrawingCanvas()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [isDrawingMode])

  // Load lobby info
  useEffect(() => {
    if (!supabase || !lobbyId) return

    const loadLobby = async () => {
      const { data, error } = await (supabase!
        .from('lobbies')
        .select('*')
        .eq('id', lobbyId)
        .single() as any)

      if (!error && data) {
        const lobby: Lobby = {
          id: data.id,
          name: data.name,
          ownerUserId: data.owner_user_id,
          passwordHash: data.password_hash,
          maxPlayers: data.max_players,
          isPublic: data.is_public,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          themeSettings: data.theme_settings,
          autosaveEnabled: data.autosave_enabled,
          autosaveIntervalSeconds: data.autosave_interval_seconds,
          adminUserIds: data.admin_user_ids ?? [],
          editPermissionMode: data.edit_permission_mode ?? 'all',
        }
        setCurrentLobby(lobby)
        setIsLobbyOwner(data.owner_user_id === userId)
      }
    }

    loadLobby()
  }, [lobbyId, userId])

  // Derived from currentLobby (already loaded/refreshed above) rather than a
  // separate query -- admin status now lives on the lobby row itself
  // (admin_user_ids), not a lobby_access_lists row, see
  // fix_lobby_admin_recursion_v2.sql.
  const isLobbyAdmin = !!(currentLobby?.adminUserIds?.includes(userId))

  // Unlike admin status, the 'selected' editor list genuinely does live in
  // lobby_access_lists (it's checked from traces/layers policies, a
  // different table, so no recursion risk -- see add_edit_permissions.sql).
  // Only queried when the mode actually needs it.
  const [isSelectedEditor, setIsSelectedEditor] = useState(false)
  useEffect(() => {
    if (!supabase || !lobbyId || !userId || currentLobby?.editPermissionMode !== 'selected') {
      setIsSelectedEditor(false)
      return
    }
    let cancelled = false
    ;(supabase
      .from('lobby_access_lists')
      .select('id')
      .eq('lobby_id', lobbyId)
      .eq('user_id', userId)
      .eq('list_type', 'editor')
      .maybeSingle() as any).then(({ data }: any) => {
        if (!cancelled) setIsSelectedEditor(!!data)
      })
    return () => { cancelled = true }
  }, [lobbyId, userId, currentLobby?.editPermissionMode])

  // Whether this atrium was entered on operator privilege rather than
  // membership. Drives the "Hidden" HUD line, and gates canEdit below --
  // which is why it's declared up here, above its other uses.
  //
  // Starts false, and the updater returns the previous value unchanged when
  // nothing differs, so an ordinary entry performs no state update at all.
  // Having it start "unknown" meant every entry re-rendered LobbyScene once
  // the check settled, which showed up as a flicker on the way in.
  const [isGhostEntry, setIsGhostEntry] = useState(false)

  useEffect(() => {
    if (!supabase || !lobbyId || isDesktop) return
    let cancelled = false

    const resolve = async () => {
      const ghost = await resolveGhostEntry(lobbyId)
      if (!cancelled) setIsGhostEntry(prev => (prev === ghost ? prev : ghost))
    }
    resolve()

    return () => { cancelled = true }
  }, [lobbyId])

  // Server-side enforcement lives in RLS (user_can_edit_lobby); this mirrors
  // it client-side to gate the UI so a non-editor doesn't see edit controls
  // that would just fail to save.
  //
  // The ghost clause is not cosmetic. An atrium entered on operator privilege
  // is read-only server-side (fix_operator_read_only.sql), but this mirror
  // didn't know that -- and most atriums default to edit_permission_mode
  // 'all', so it computed canEdit = true for the operator. The UI then offered
  // every edit control, and RLS dropped the writes silently: an UPDATE that
  // matches no rows is not an error, it just changes nothing. The panel would
  // write, reload, and snap back, which looks precisely like "it said it
  // updated but stayed in the same place".
  const canEdit = !isGhostEntry && (
    isLobbyOwner || isLobbyAdmin ||
    (currentLobby?.editPermissionMode ?? 'all') === 'all' ||
    (currentLobby?.editPermissionMode === 'selected' && isSelectedEditor)
  )
  const canEditRef = useRef(canEdit)
  useEffect(() => { canEditRef.current = canEdit }, [canEdit])

  // Check Pinterest connection once per atrium visit, just to decide whether
  // to show the "Import from Pinterest" button -- web only.
  useEffect(() => {
    if (isDesktop) return
    getPinterestConnectionStatus().then(({ connected }) => setPinterestConnected(connected))
  }, [])

  // Listen for zoom sensitivity changes from profile settings and keep value in sync
  useEffect(() => {
    const handleZoomSensitivityChanged = (event: Event) => {
      const customEvent = event as CustomEvent<number>
      const detailValue = typeof customEvent.detail === 'number' ? customEvent.detail : undefined
      if (detailValue !== undefined) {
        zoomSensitivityRef.current = clampZoomSensitivity(detailValue)
        return
      }
      zoomSensitivityRef.current = getStoredZoomSensitivity()
    }

    window.addEventListener('lobby-zoom-sensitivity-changed', handleZoomSensitivityChanged as EventListener)
    return () => {
      window.removeEventListener('lobby-zoom-sensitivity-changed', handleZoomSensitivityChanged as EventListener)
    }
  }, [])

  // Load the per-atrium batch-placement shape and keep it in sync with the
  // Profile panel's setting.
  useEffect(() => {
    if (!lobbyId) return
    try {
      const raw = localStorage.getItem(`lobby_${lobbyId}_packingShape`)
      if (raw === 'circle' || raw === 'square') packingShapeRef.current = raw
    } catch {
      // Ignore localStorage access failures
    }

    const handlePackingShapeChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ lobbyId: string; shape: 'square' | 'circle' }>
      if (customEvent.detail?.lobbyId !== lobbyId) return
      packingShapeRef.current = customEvent.detail.shape
    }

    window.addEventListener('lobby-packing-shape-changed', handlePackingShapeChanged as EventListener)
    return () => {
      window.removeEventListener('lobby-packing-shape-changed', handlePackingShapeChanged as EventListener)
    }
  }, [lobbyId])

  // Autosave is an atrium-wide policy the owner sets in the Manage panel
  // (currentLobby.autosaveEnabled/autosaveIntervalSeconds), not a per-browser
  // preference -- keep the ref in sync whenever that lobby data changes.
  useEffect(() => {
    autosaveSettingsRef.current = {
      enabled: currentLobby?.autosaveEnabled ?? false,
      intervalSeconds: clampAutosaveInterval(currentLobby?.autosaveIntervalSeconds ?? 60),
    }
  }, [currentLobby])

  // Autosave heartbeat - checks every 5s whether enough time has passed since the
  // last save to trigger another one. A single slow-ticking interval (rather than
  // tearing down/recreating a setInterval whenever the user drags the interval
  // slider) keeps this simple and avoids timer churn.
  useEffect(() => {
    let lastAutosaveAt = Date.now()
    const heartbeat = setInterval(() => {
      const { enabled, intervalSeconds } = autosaveSettingsRef.current
      if (!enabled) return
      if (Date.now() - lastAutosaveAt < intervalSeconds * 1000) return
      lastAutosaveAt = Date.now()
      if (useGameStore.getState().hasPendingChanges() && !useGameStore.getState().isSavingChanges) {
        saveAllChanges()
      }
    }, 5000)
    return () => clearInterval(heartbeat)
  }, [])

  // Password-session heartbeat: keeps this lobby's lobby_sessions row fresh
  // (see check_and_touch_lobby_access in App.tsx) as long as the user shows
  // real activity, so a long continuously-active visit never lets the
  // 30-minute idle window lapse -- only genuinely walking away for 30+
  // minutes and then reloading should re-prompt for the password.
  //
  // Deliberately NOT guarded on currentLobby.passwordHash: a non-owner guest
  // (exactly the person who has to enter a password) can't see password_hash
  // at all -- RLS/column visibility hides it -- so it comes back null client-
  // side, meaning a guard on it would skip the heartbeat for precisely the
  // users who need it, and their session would silently go stale. touch_lobby
  // _session is a harmless no-op server-side when the lobby has no password
  // or this user has no session row, so it's safe to call unconditionally.
  //
  // Touches immediately on mount, not just every 5 minutes -- a browser
  // refresh fully unmounts this component, clearing any pending interval, so
  // a short visit that refreshes again before the first periodic tick would
  // otherwise never have extended a verified_at that was already close to
  // (or past) 30 minutes old.
  useEffect(() => {
    if (!supabase) return
    const IDLE_LIMIT_MS = 30 * 60 * 1000
    ;(supabase as any).rpc('touch_lobby_session', { p_lobby_id: lobbyId })
    const heartbeat = setInterval(() => {
      if (Date.now() - lastActivityAtRef.current > IDLE_LIMIT_MS) return
      ;(supabase as any).rpc('touch_lobby_session', { p_lobby_id: lobbyId })
    }, 5 * 60 * 1000)
    return () => clearInterval(heartbeat)
  }, [lobbyId])

  // The brush/eraser cursor circle is only shown/hidden/moved via direct DOM
  // mutations on mouse move/enter/leave (see brushCursorRef usage below), so
  // it can get stuck visible at a stale position if the mouse leaves the
  // canvas without a DOM mouseleave event -- e.g. clicking the native OS
  // window close button. Force-hide it whenever the (now App-level, see
  // App.tsx's CloseSaveDialog) close-save dialog opens so it can't bleed
  // through the dialog's semi-transparent backdrop.
  useEffect(() => {
    const handleClosePromptShown = () => {
      if (brushCursorRef.current) brushCursorRef.current.style.display = 'none'
    }
    window.addEventListener('digital-atrium-close-prompt-shown', handleClosePromptShown)
    return () => window.removeEventListener('digital-atrium-close-prompt-shown', handleClosePromptShown)
  }, [])

  // Keep traces ref in sync
  useEffect(() => {
    tracesDataRef.current = traces
  }, [traces])
  
  // Keep otherUsers ref in sync
  useEffect(() => {
    otherUsersRef.current = otherUsers
  }, [otherUsers])
  
  // T key shortcut to open trace panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      
      // Keyboard zoom, for anyone without a wheel and as a precise alternative
      // to one. Deliberately +/-/0 rather than the arrow keys: left and right
      // already step through saved locations in presentation mode, and
      // splitting one key group across two unrelated jobs reads as a mistake.
      // These are also what browsers, maps and design tools use.
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        applyZoomDelta(KEYBOARD_ZOOM_STEP)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        applyZoomDelta(-KEYBOARD_ZOOM_STEP)
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        cameraFlyToRef.current = null
        targetZoomRef.current = 1
        return
      }

      if (e.key === 't' || e.key === 'T') {
        if (!canEditRef.current) return
        e.preventDefault()
        e.stopPropagation()
        setClickedTracePosition({ x: positionRef.current.x, y: positionRef.current.y })
        setShowTracePanel(prev => !prev)
      }
      if (e.key === 'd' || e.key === 'D') {
        if (!canEditRef.current) return
        e.preventDefault()
        e.stopPropagation()
        setIsDrawingMode(prev => {
          if (!prev) return true
          // Exiting: clear everything
          setCompletedStrokes([])
          currentStrokeRef.current = []
          setIsEraserMode(false)
          return false
        })
      }
      if (e.key === 'e' || e.key === 'E') {
        if (isDrawingModeRef.current) {
          e.preventDefault()
          e.stopPropagation()
          setIsEraserMode(prev => !prev)
        }
      }
      // Ctrl+Z undoes the last stroke while drawing, same as the Undo
      // button -- TraceOverlay's own Ctrl+Z (trace undo/redo) steps aside
      // while isDrawingMode is active, see its isDrawingModeRef guard.
      if (isDrawingModeRef.current && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        setCompletedStrokes(prev => prev.slice(0, -1))
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  // Refresh online player count every 10 minutes
  useEffect(() => {
    if (!supabase || !lobbyId) return
    
    const fetchPlayerCount = async () => {
      const { count } = await (supabase!
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('active_lobby_id', lobbyId) as any)
      
      const newCount = (count || 0)
      // Only update if count changed
      if (newCount !== onlinePlayerCount) {
        setOnlinePlayerCount(newCount)
      }
    }
    
    // Initial fetch
    fetchPlayerCount()
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchPlayerCount, 30 * 1000)
    
    return () => clearInterval(interval)
  }, [lobbyId, onlinePlayerCount])
  
  // Handle closing trace panel
  const handleCloseTracePanel = () => {
    setShowTracePanel(false)
    setClickedTracePosition(null)
    setTracePanelInitialType(undefined)
    setTracePanelInitialShapeType(undefined)
    // Or the next panel opened would reload the last dropped PDF.
    setPendingPdfFile(null)
  }

  // Creating a path used to insert a static 2-point line and leave the user
  // to hunt down the Customize panel to actually draw it or add arrows --
  // instead, this creates just a single starting point and immediately
  // hands off to TraceOverlay's point-placing mode (see newPathTraceId /
  // the "Special handles for path shapes" section there), landing right on
  // the arrow controls once the user finishes.
  const handleCreatePath = async (color: string, opacity: number) => {
    if (!supabase || !userId) return
    if (!ensureLobbyHasSpace()) return

    const startPosition = clickedTracePosition || positionRef.current

    const layerFields = activeLayerId
      ? {
          layer_id: activeLayerId,
          z_index: await computeZIndexForNewTraceInLayer(
            activeLayerId,
            traces.filter(t => t.layerId === activeLayerId).length
          ),
        }
      : { z_index: computeZIndexForNewUngroupedTrace(traces) }

    const { data, error } = await supabase.from('traces').insert({
      user_id: userId,
      username,
      type: 'shape',
      content: 'shape content',
      position_x: startPosition.x,
      position_y: startPosition.y,
      media_url: null,
      scale: 1.0,
      rotation: 0.0,
      border_radius: 0,
      lobby_id: lobbyId,
      show_description: false,
      show_filename: false,
      shape_type: 'path',
      shape_color: color,
      shape_opacity: opacity,
      show_border: false,
      show_background: false,
      shape_points: [{ x: startPosition.x, y: startPosition.y }],
      path_curve_type: 'straight',
      ...layerFields,
    } as any).select()

    if (error) {
      console.error('Failed to create path:', error)
      alert('Failed to create path: ' + error.message)
      return
    }

    if (data && data[0]) {
      const dbTrace = data[0] as any
      const trace = {
        ...mapRowToTrace(dbTrace),
        shapePoints: dbTrace.shape_points,
        pathCurveType: dbTrace.path_curve_type,
      }
      useGameStore.getState().addTrace(trace)
      handleCloseTracePanel()
      setNewPathTraceId(trace.id)
    }
  }

  // Camera helpers for the Locations panel: read the live camera view, and
  // smoothly fly to a saved one (the ticker eases cameraPositionRef + zoom
  // toward the target; see cameraFlyToRef).
  const getCurrentCamera = () => ({
    x: cameraPositionRef.current.x,
    y: cameraPositionRef.current.y,
    zoom: zoomRef.current,
  })

  const flyToLocation = (location: LobbyLocation) => {
    cameraFlyToRef.current = {
      startX: cameraPositionRef.current.x,
      startY: cameraPositionRef.current.y,
      startZoom: zoomRef.current,
      targetX: location.positionX,
      targetY: location.positionY,
      targetZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, location.zoom)),
      startTime: performance.now(),
      duration: 900,
    }
  }

  // --- Locations state (shared per-atrium; edits deferred to Save) ---------
  const loadLocations = useCallback(async () => {
    if (!supabase || !lobbyId) return
    const { data, error } = await supabase
      .from('lobby_locations')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('order_index', { ascending: true })
    if (error || !data) return
    setSavedLocations(data.map(mapLocationRow))
  }, [lobbyId])

  useEffect(() => {
    loadLocations()
    if (!supabase) return
    const channel = supabase
      .channel(`locations-channel-${lobbyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lobby_locations', filter: `lobby_id=eq.${lobbyId}` }, () => {
        loadLocations()
      })
      .subscribe()
    return () => { channel.unsubscribe() }
  }, [loadLocations, lobbyId])

  // Keep the working copy in sync with the saved list whenever there are no
  // unsaved edits -- so a fresh load, or another user's saved change arriving
  // over realtime, is reflected, but an in-progress local edit is never
  // clobbered.
  useEffect(() => {
    if (!locationsDirty) {
      setWorkingLocations(savedLocations.map(l => ({ ...l })))
    }
  }, [savedLocations, locationsDirty])

  const addLocation = (name: string) => {
    const cam = getCurrentCamera()
    setWorkingLocations(prev => [
      ...prev,
      {
        id: `temp_${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
        lobbyId,
        name: name.trim(),
        positionX: cam.x,
        positionY: cam.y,
        zoom: cam.zoom,
        orderIndex: prev.length,
        userId: username,
      },
    ])
    setLocationsDirty(true)
  }

  const renameLocation = (id: string, name: string) => {
    setWorkingLocations(prev => prev.map(l => (l.id === id ? { ...l, name: name.trim() } : l)))
    setLocationsDirty(true)
  }

  // Re-shoots a saved location: overwrites its stored camera with wherever
  // the user is currently looking. Same working-copy/dirty flow as every
  // other location edit, so nothing persists until Save Changes.
  const updateLocationCamera = (id: string) => {
    const cam = getCurrentCamera()
    // Enforced here as well as disabled in the panel: the button being greyed
    // out is a hint, this is the actual guarantee.
    if (workingLocationsRef.current.find(l => l.id === id)?.isLocked) return
    setWorkingLocations(prev => prev.map(l => (
      l.id === id ? { ...l, positionX: cam.x, positionY: cam.y, zoom: cam.zoom } : l
    )))
    setLocationsDirty(true)
  }

  const toggleLocationLock = (id: string) => {
    setWorkingLocations(prev => prev.map(l => (l.id === id ? { ...l, isLocked: !l.isLocked } : l)))
    setLocationsDirty(true)
  }

  const deleteLocation = (id: string) => {
    setWorkingLocations(prev => prev.filter(l => l.id !== id))
    setLocationsDirty(true)
  }

  const reorderLocations = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    setWorkingLocations(prev => {
      const arr = [...prev]
      const from = arr.findIndex(l => l.id === sourceId)
      const to = arr.findIndex(l => l.id === targetId)
      if (from === -1 || to === -1) return prev
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      return arr
    })
    setLocationsDirty(true)
  }

  const discardLocationChanges = () => {
    setWorkingLocations(savedLocations.map(l => ({ ...l })))
    setLocationsDirty(false)
  }

  // Persists the whole working/saved diff in one pass (deletes, inserts,
  // updates), so all the session's location edits are written -- and
  // broadcast over realtime -- only once, on demand, instead of on every edit.
  const saveLocationChanges = async () => {
    if (!supabase || !canEdit) return
    const saved = savedLocations
    const working = workingLocationsRef.current
    const workingRealIds = new Set(working.filter(l => !l.id.startsWith('temp_')).map(l => l.id))

    for (const s of saved) {
      if (!workingRealIds.has(s.id)) {
        await (supabase.from('lobby_locations') as any).delete().eq('id', s.id)
      }
    }
    for (let i = 0; i < working.length; i++) {
      const w = working[i]
      if (w.id.startsWith('temp_')) {
        await (supabase.from('lobby_locations') as any).insert({
          lobby_id: lobbyId,
          name: w.name,
          position_x: w.positionX,
          position_y: w.positionY,
          zoom: w.zoom,
          order_index: i,
          user_id: username,
          is_locked: !!w.isLocked,
        })
      } else {
        const orig = saved.find(s => s.id === w.id)
        if (!orig || orig.name !== w.name || orig.orderIndex !== i || orig.positionX !== w.positionX || orig.positionY !== w.positionY || orig.zoom !== w.zoom || !!orig.isLocked !== !!w.isLocked) {
          await (supabase.from('lobby_locations') as any).update({
            name: w.name,
            order_index: i,
            position_x: w.positionX,
            position_y: w.positionY,
            zoom: w.zoom,
            is_locked: !!w.isLocked,
          }).eq('id', w.id)
        }
      }
    }
    setLocationsDirty(false)
    await loadLocations()
  }

  // --- Presentation mode (arrow-key navigation through working locations) --
  const goToPresentationIndex = useCallback((index: number) => {
    const list = workingLocationsRef.current
    if (list.length === 0) return
    const clamped = Math.max(0, Math.min(list.length - 1, index))
    setPresentationIndex(clamped)
    presentationIndexRef.current = clamped
    flyToLocation(list[clamped])
  }, [])

  const togglePresentationMode = useCallback(() => {
    if (presentationModeRef.current) {
      setPresentationMode(false)
      presentationModeRef.current = false
    } else {
      if (workingLocationsRef.current.length === 0) return
      setPresentationMode(true)
      presentationModeRef.current = true
      goToPresentationIndex(presentationIndexRef.current)
    }
  }, [goToPresentationIndex])

  // Arrow keys step through locations while presentation mode is on. Stable
  // listener (reads refs), so it keeps working even with the panel closed.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!presentationModeRef.current) return
      if (isEditableTarget(e.target)) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        goToPresentationIndex(presentationIndexRef.current + 1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goToPresentationIndex(presentationIndexRef.current - 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goToPresentationIndex])

  // Batch-embed creation from TracePanel's "Batch Placement" toggle: one URL
  // per line becomes its own embed trace, bin-packed around the placement
  // point exactly like a multi-file drop/paste (see handleDrop/handlePaste
  // above) instead of stacking every trace on the same spot.
  //
  // Inserted as a single bulk statement rather than looping insertDroppedTrace
  // per URL -- N sequential single-row inserts meant N separate network
  // round-trips (slow for a large batch) for no benefit: Supabase Realtime
  // broadcasts one change event per row regardless of how many rows a single
  // INSERT statement affects, so batching the SQL call doesn't reduce
  // realtime traffic, only the number of requests this client has to make.
  // "One trace per page": each rendered page is written into the vault and
  // becomes an image trace, arranged in a reading-order grid.
  //
  // Deliberately not run through packBoxesAroundCenter like a batch embed
  // paste. That packer optimizes for a tight, organic cluster, which is the
  // right answer for unrelated images and the wrong one for pages: their order
  // is the information, so they go left-to-right, top-to-bottom, on a uniform
  // pitch.
  const handleCreatePdfPages = async (
    pages: { blob: Blob; width: number; height: number }[],
    columns: number,
  ) => {
    if (pages.length === 0 || !supabase) return
    if (!ensureLobbyHasSpace()) return

    handleCloseTracePanel()

    const anchor = clickedTracePosition || positionRef.current
    const cols = Math.max(1, Math.min(columns, pages.length))
    // Derived, not taken from the panel: the requested rows are a hint, and if
    // columns x rows can't hold the document the remainder has to go
    // somewhere rather than be dropped.
    const rowCount = Math.ceil(pages.length / cols)

    // One pitch for every page, from the widest and tallest, so pages stay in
    // line even when a document mixes portrait and landscape.
    // Twice the usual image cap. A page is meant to be read, and at the
    // standard 300-unit cap the text was too small to make out without
    // zooming in on every single one.
    const boxes = pages.map(p => scaleToDisplayBox({ width: p.width, height: p.height }, 600))
    const cellWidth = Math.max(...boxes.map(b => b.width)) + 24
    const cellHeight = Math.max(...boxes.map(b => b.height)) + 24

    // Centred on the placement point rather than starting there, matching how
    // every other multi-trace placement behaves.
    const originX = anchor.x - ((cols - 1) * cellWidth) / 2
    const originY = anchor.y - ((rowCount - 1) * cellHeight) / 2

    const baseZ = activeLayerId
      ? 0
      : computeZIndexForNewUngroupedTrace(traces) - 1

    const { preCacheLocalUrl } = await import('../lib/localDb')
    const stamp = Date.now()
    const rows: any[] = []

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      // Extension follows what the encoder actually produced -- it falls back
      // to PNG where WebP isn't available, and resolveLocalUrl picks the MIME
      // type off the extension.
      const ext = page.blob.type === 'image/webp' ? 'webp' : 'png'
      const storagePath = `${lobbyId}/${userId}_${stamp}_p${i + 1}.${ext}`
      const localUrl = `local://traces/${storagePath}`

      // Cached before the write so the page renders immediately, rather than
      // waiting on disk -- same trick the single-file upload path uses.
      preCacheLocalUrl(localUrl, URL.createObjectURL(page.blob))
      await supabase.storage.from('traces').upload(storagePath, page.blob)

      rows.push({
        user_id: userId,
        username,
        type: 'image',
        content: `Page ${i + 1}`,
        position_x: originX + (i % cols) * cellWidth,
        position_y: originY + Math.floor(i / cols) * cellHeight,
        media_url: localUrl,
        scale: 1.0,
        rotation: 0.0,
        border_radius: 0,
        lobby_id: lobbyId,
        show_description: false,
        show_filename: false,
        width: boxes[i].width,
        height: boxes[i].height,
        ...(activeLayerId ? { layer_id: activeLayerId } : {}),
        z_index: baseZ + i + 1,
      })
    }

    // One insert for the whole document rather than one per page.
    const { data, error } = await (supabase.from('traces') as any).insert(rows).select()
    if (error) {
      console.error('PDF page insert error:', error)
      alert('Failed to place the pages: ' + error.message)
      return
    }
    for (const row of data ?? []) {
      useGameStore.getState().addTrace(mapRowToTrace(row))
    }

    // Reported, because a PDF is by far the heaviest thing that can be put in
    // an atrium and the cost is otherwise invisible until it starts feeling
    // slow.
    const totalMB = pages.reduce((sum, p) => sum + p.blob.size, 0) / (1024 * 1024)
    showToast(`${pages.length} pages placed — ${totalMB.toFixed(1)} MB`)
  }

  // Several files chosen at once in the Create Trace panel's picker. Routed
  // through the same placement path a multi-file drop uses, so shift-selecting
  // a folder of images in the picker and dragging those same images in produce
  // an identical arrangement.
  const handleCreateFileBatch = async (files: File[]) => {
    if (files.length === 0) return
    if (!ensureLobbyHasSpace()) return

    const anchor = clickedTracePosition || positionRef.current
    handleCloseTracePanel()
    await placeFilesAsTraces(files, anchor.x, anchor.y)
  }

  // "Paste Image" from the canvas right-click menu. Places at the point that
  // was right-clicked, which is the whole advantage over Ctrl+V -- the user
  // has already said where they want it.
  const handlePasteImageAt = async (worldX: number, worldY: number) => {
    const files = await readClipboardImageFiles()
    if (files === null) {
      showToast("Couldn't read the clipboard — try Ctrl+V instead")
      return
    }
    if (files.length === 0) {
      showToast('No image in the clipboard')
      return
    }
    if (!ensureLobbyHasSpace()) return
    await placeFilesAsTraces(files, worldX, worldY)
  }

  const handleCreateBatchEmbeds = async (urls: string[]) => {
    if (urls.length === 0) return
    if (!ensureLobbyHasSpace()) return

    const anchor = clickedTracePosition || positionRef.current
    // Probe each URL's real image dimensions before packing (like the
    // multi-file drop handler already does for actual files) -- most
    // pasted embeds are hotlinked images, and packing them all as a flat
    // default box regardless of their real aspect ratio produced an
    // overlapping mess once each one rendered at its real (very different)
    // size. Non-image embeds (YouTube links, etc.) simply fail to probe and
    // fall back to the default box.
    const probed = await Promise.all(urls.map(url => probeRemoteImageDimensions(url)))
    const sizes = probed.map(dims => dims ? scaleToDisplayBox(dims) : getDefaultTraceBoxSize('embed'))
    const offsets = packBoxesAroundCenter(sizes, 24, packingShapeRef.current)

    if (supabase) {
      // Resolve the active layer's z-index once up front (a single query)
      // instead of once per item -- z_index for each row is then computed
      // locally, mirroring how LayerPanel's moveTracesToLayer avoids
      // recomputing "next free slot" from the same stale count per item.
      let layerFields: { layer_id?: string; z_index: number }[] | null = null
      if (activeLayerId) {
        const { data: layerData } = await supabase.from('layers').select('z_index').eq('id', activeLayerId).single()
        const layerZIndex = (layerData as any)?.z_index
        const baseZ = layerZIndex !== undefined && layerZIndex !== null ? getTraceBaseZIndex(layerZIndex) : 0
        const existingCount = traces.filter(t => t.layerId === activeLayerId).length
        layerFields = urls.map((_, i) => ({ layer_id: activeLayerId, z_index: baseZ + existingCount + i + 1 }))
      } else {
        // Ungrouped: stack each pasted embed one above the last, all above the
        // current highest ungrouped z (base 0, so still below every group).
        const baseZ = computeZIndexForNewUngroupedTrace(traces) - 1
        layerFields = urls.map((_, i) => ({ z_index: baseZ + i + 1 }))
      }

      const rows = urls.map((url, i) => ({
        user_id: userId,
        username,
        type: 'embed',
        content: url,
        position_x: anchor.x + offsets[i].x,
        position_y: anchor.y + offsets[i].y,
        media_url: url,
        scale: 1.0,
        rotation: 0.0,
        lobby_id: lobbyId,
        show_description: false,
        show_filename: false,
        ...(layerFields ? layerFields[i] : {}),
      }))

      const { data, error } = await supabase.from('traces').insert(rows as any).select()
      if (error) {
        console.error('Batch embed insert error:', error)
        alert('Failed to place batch embeds: ' + error.message)
        return
      }
      if (data) {
        for (const row of data) {
          useGameStore.getState().addTrace(mapRowToTrace(row))
        }
      }
    } else {
      for (let i = 0; i < urls.length; i++) {
        const trace: Trace = {
          id: `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}_${i}`,
          userId,
          username,
          type: 'embed',
          content: urls[i],
          x: anchor.x + offsets[i].x,
          y: anchor.y + offsets[i].y,
          mediaUrl: urls[i],
          createdAt: new Date().toISOString(),
          scale: 1.0,
          scaleX: 1.0,
          scaleY: 1.0,
          rotation: 0.0,
        }
        useGameStore.getState().addTrace(trace)
      }
    }

    handleCloseTracePanel()
  }

  // Bulk-convert every embed trace in this atrium into an internal image
  // (reuses the same per-trace conversion used by the trace context menu).
  // Runs sequentially rather than in parallel to avoid hammering the vault
  // folder / remote host with many concurrent downloads at once.
  const handleConvertAllEmbeds = async () => {
    const embedTraces = useGameStore.getState().traces.filter(t => t.type === 'embed')
    if (embedTraces.length === 0) {
      alert('No embed traces in this atrium.')
      return
    }
    setIsConvertingEmbeds(true)
    let converted = 0
    let skipped = 0
    try {
      for (let i = 0; i < embedTraces.length; i++) {
        setConvertEmbedsProgress(`Converting ${i + 1}/${embedTraces.length}...`)
        const result = await convertEmbedToInternalImage(embedTraces[i].id)
        if (result.ok) converted++
        else skipped++
      }
      if (converted > 0) {
        await saveAllChanges()
      }
      alert(`Converted ${converted} embed(s) to internal images.${skipped > 0 ? ` Skipped ${skipped} (not direct images or failed to download).` : ''}`)
    } finally {
      setIsConvertingEmbeds(false)
      setConvertEmbedsProgress('')
    }
  }
  
  // Restore saved camera position for this lobby on mount -- keyed by both
  // lobby AND user, since a shared device/browser profile with multiple
  // accounts would otherwise have each login clobber the last one's saved
  // position under a single lobby-only key. Falls back to the older
  // lobby-only key (pre-existing saves from before this was per-user) so
  // returning users don't lose their last position outright.
  useEffect(() => {
    if (!userId) return
    try {
      const saved = localStorage.getItem(`lobby_camera_${lobbyId}_${userId}`)
        ?? localStorage.getItem(`lobby_camera_${lobbyId}`)
      if (saved) {
        const { x, y, zoom: savedZoom } = JSON.parse(saved)
        cameraPositionRef.current = { x, y }
        zoomRef.current = savedZoom ?? 1.0
        targetZoomRef.current = savedZoom ?? 1.0
        cameraRestoredRef.current = true
      }
    } catch {}
  }, [lobbyId, userId])

  // Keep position ref in sync
  useEffect(() => {
    positionRef.current = position
    // Initialize camera to center on player at start (only once, if no saved position)
    if (!cameraRestoredRef.current && cameraPositionRef.current.x === 0 && cameraPositionRef.current.y === 0) {
      cameraPositionRef.current = { x: position.x, y: position.y }
    }
  }, [position])
  
  // Initialize presence for this lobby. Traces are now loaded earlier, from
  // App.tsx, so they're already in the store (and local media pre-resolved
  // on desktop) by the time this scene mounts, instead of popping in after
  // the atrium-entry loading screen finishes.
  // Shown as a panel rather than an alert(): leaving is deferred until the
  // user acknowledges it, so the message can't be dismissed by reflex before
  // it's read -- and on desktop alert() renders as a native Windows dialog,
  // which is jarring on the way out of an atrium.
  const [kickedNotice, setKickedNotice] = useState<{ blacklisted: boolean } | null>(null)

  const handleKicked = useCallback((blacklisted: boolean) => {
    setKickedNotice({ blacklisted })
  }, [])
  // Drives the "Hidden" HUD line only -- usePresence resolves this
  // independently for its own purposes (both share one cached round-trip).
  //
  // Starts false, and the updater returns the previous value unchanged when
  // nothing differs, so an ordinary entry performs no state update at all.
  const { updateCursorPosition, getJoinedAt, kickUser } = usePresence(lobbyId, handleKicked)

  const executeKick = async (targetUserId: string, blacklist: boolean) => {
    setIsKicking(true)
    try {
      if (blacklist && supabase) {
        const { data: { user } } = await supabase.auth.getUser()
        // A user can't be both whitelisted and blacklisted at once -- drop
        // them from the whitelist first, same as LobbyManagement's addToList.
        await (supabase
          .from('lobby_access_lists')
          .delete()
          .eq('lobby_id', lobbyId)
          .eq('user_id', targetUserId)
          .eq('list_type', 'whitelist') as any)

        const { error } = await (supabase
          .from('lobby_access_lists') as any)
          .insert({
            lobby_id: lobbyId,
            user_id: targetUserId,
            list_type: 'blacklist',
            added_by: user?.id,
          })

        if (error) throw error
      }

      // Broadcast regardless of whether blacklisting succeeded -- kicking
      // someone out right now shouldn't be blocked by the (separate)
      // persistent-ban bookkeeping failing.
      await kickUser(targetUserId, blacklist)
    } catch (err: any) {
      console.error('Error kicking user:', err)
      alert(err.message || 'Failed to kick user')
    } finally {
      setIsKicking(false)
      setKickTarget(null)
    }
  }

  // Refresh the online-users list's "time in atrium" values every 15s while open
  useEffect(() => {
    if (!showOnlineUsersList) return
    const interval = setInterval(() => setOnlineUsersListTick(t => t + 1), 15000)
    return () => clearInterval(interval)
  }, [showOnlineUsersList])

  // Initialize Pixi.js with endless scrolling world
  useEffect(() => {
    if (!canvasRef.current || appRef.current) return

    let cancelled = false

    // Use full viewport dimensions
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Get theme settings from current lobby
    const gridColor = currentLobby?.themeSettings?.gridColor ? 
      parseInt(currentLobby.themeSettings.gridColor.replace('#', ''), 16) : 0x3b82f6
    const gridOpacity = currentLobby?.themeSettings?.gridOpacity ?? 0.2
    const bgColor = currentLobby?.themeSettings?.backgroundColor ? 
      parseInt(currentLobby.themeSettings.backgroundColor.replace('#', ''), 16) : 0x0a0a0f

    const app = new Application({
      width: viewportWidth,
      height: viewportHeight,
      backgroundColor: bgColor,
      antialias: true,
      // Deliberately left at the default resolution of 1.
      //
      // Rendering at devicePixelRatio was tried, to stop curves looking
      // pixelated on a high-DPI screen, and reverted: on a 2x display it means
      // four times the pixels every frame for the grid, particles, ground
      // elements and indicators, which cost more than the sharpness was worth.
      // Traces are DOM elements and were never affected either way.
      resizeTo: window,
    })
    
    if (canvasRef.current) {
      const canvas = app.view as HTMLCanvasElement
      canvas.draggable = false
      canvas.ondragstart = () => false
      canvasRef.current.appendChild(canvas)
      appRef.current = app

      // Create world container that will move (camera effect)
      const worldContainer = new Container()
      app.stage.addChild(worldContainer)
      worldContainerRef.current = worldContainer

      // Create infinite grid (will be repositioned dynamically)
      const grid = new Graphics()
      worldContainer.addChild(grid)
      gridRef.current = grid
      
      // Create lighting layer (drawn above grid but below entities)
      const lightingLayer = new Graphics()
      worldContainer.addChild(lightingLayer)
      lightingLayerRef.current = lightingLayer
      
      // Function to redraw grid based on camera position
      const updateGrid = (cameraX: number, cameraY: number) => {
        grid.clear()
        if (currentLobby?.themeSettings?.gridEnabled === false) return
        grid.lineStyle(1, gridColor, gridOpacity)

        const gridSize = 50
        // Account for zoom: visible world area = viewport / zoom
        const currentZoom = zoomRef.current
        const visibleW = window.innerWidth / currentZoom
        const visibleH = window.innerHeight / currentZoom
        const margin = gridSize * 2
        const startX = Math.floor((cameraX - visibleW / 2 - margin) / gridSize) * gridSize
        const endX = Math.ceil((cameraX + visibleW / 2 + margin) / gridSize) * gridSize
        const startY = Math.floor((cameraY - visibleH / 2 - margin) / gridSize) * gridSize
        const endY = Math.ceil((cameraY + visibleH / 2 + margin) / gridSize) * gridSize
        
        for (let x = startX; x <= endX; x += gridSize) {
          grid.moveTo(x, startY)
          grid.lineTo(x, endY)
        }
        for (let y = startY; y <= endY; y += gridSize) {
          grid.moveTo(startX, y)
          grid.lineTo(endX, y)
        }
      }
      updateGridRef.current = updateGrid

      // Mouse wheel / trackpad handler: zooms or pans depending on the gesture.
      const handleWheel = (e: WheelEvent) => {
        // Check if mouse is over any UI elements (menus, panels, etc.).
        // [data-ui-element] is the general marker used by full-screen modals
        // (Theme/Profile/Manage Atrium) -- without it, scrolling over one of
        // those zoomed the canvas underneath instead of scrolling the modal,
        // since their root elements didn't match .customize-menu/.layer-panel.
        const target = e.target as HTMLElement
        const isOverUI = target.closest('[data-ui-element], .customize-menu, .layer-panel, select, input, textarea, button') !== null
        
        if (isOverUI) {
          // Let the browser handle normal scrolling for UI elements
          return
        }
        
        e.preventDefault()
        cameraFlyToRef.current = null // a manual gesture cancels any camera fly-to

        if (classifyWheel(e) === 'pan') {
          // Divided by the zoom so the canvas tracks the fingers: two fingers
          // moving an inch should move the view an inch of screen, whatever
          // the zoom level, rather than an inch of world.
          const scale = zoomRef.current || 1
          panCameraBy(e.deltaX / scale, e.deltaY / scale)
          return
        }

        applyZoomDelta(wheelZoomDelta(e))
      }
      
      eventHandlersRef.current.wheel = handleWheel
      window.addEventListener('wheel', handleWheel, { passive: false })

      // Initialize theme manager
      const themeManager = new ThemeManager(worldContainer, {
        particleCount: 100,
        groundDensity: 0.5,
        // Seeded here too, not just in the later updateConfig: particles are
        // created right after loadTheme() below, and their blend mode is
        // chosen from the background at creation time.
        backgroundColor: bgColor,
      })
      themeManagerRef.current = themeManager
      
      // Load theme assets asynchronously
      themeManager.loadTheme().then(() => {
        if (!cancelled) {
          themeManager.createParticles(viewportWidth, viewportHeight, cameraPositionRef.current.x, cameraPositionRef.current.y)
        }
      })

      // Player avatar now rendered in DOM (TraceOverlay) for z-index support
      // Keep reference but make invisible
      const playerAvatar = new Graphics()
      playerAvatar.visible = false
      worldContainer.addChild(playerAvatar)
      playerAvatarRef.current = playerAvatar

      // Player label now rendered in DOM (TraceOverlay) for z-index support
      const label = new Text('', { fontSize: 12, fill: 0xffffff })
      label.visible = false
      worldContainer.addChild(label)
      labelRef.current = label

      // Create pulsing indicator for trace placement (initially hidden)
      const tracePlacementIndicator = new Graphics()
      worldContainer.addChild(tracePlacementIndicator)
      tracePlacementIndicatorRef.current = tracePlacementIndicator

      // Create container for trace direction indicators (on UI layer, not world)
      const traceIndicatorsContainer = new Container()
      app.stage.addChild(traceIndicatorsContainer)
      traceIndicatorsRef.current = traceIndicatorsContainer

      // Handle clicks and panning
      app.stage.eventMode = 'static'
      app.stage.hitArea = app.screen
      
      // Mouse down - start panning or show context menu (using window event for better capture)
      const handleMouseDown = (e: MouseEvent) => {
        lastMouseScreenPositionRef.current = { x: e.clientX, y: e.clientY }

        // Left mouse button (button 0) - start panning or drawing
        if (e.button === 0) {
          mouseDownScreenPosRef.current = { x: e.clientX, y: e.clientY }
          // Close context menu if open
          // Check if we're clicking on a trace element in the overlay
          // If so, don't start panning - let the trace handle the click
          const target = e.target as HTMLElement
          const isClickingTrace = target.closest('[data-trace-element]') !== null
          const isClickingUI = target.closest('[data-ui-element]') !== null || 
                               target.closest('button') !== null ||
                               target.closest('input') !== null ||
                               target.closest('textarea') !== null ||
                               target.closest('select') !== null ||
                               target.closest('label') !== null ||
                               target.closest('[role="dialog"]') !== null ||
                               target.closest('.customize-menu') !== null ||
                               target.closest('.pointer-events-auto') !== null
          
          if (!isClickingTrace && !isClickingUI) {
            // Don't start panning if in drawing mode
            if (isDrawingModeRef.current) return
            // Drag out the shape instead of panning, while the Create Trace
            // panel is open on a sizeable shape type. Same gesture as the
            // shift+drag area select below, which is where the idea comes
            // from -- you draw the region you want rather than accepting a
            // fixed 200x200 box and resizing it afterwards.
            if (shapeDragArmedRef.current && worldContainerRef.current) {
              isShapeDraggingRef.current = true
              cameraFlyToRef.current = null
              shapeDragStartWorldRef.current = {
                x: (e.clientX - worldContainerRef.current.x) / zoomRef.current,
                y: (e.clientY - worldContainerRef.current.y) / zoomRef.current,
              }
              return
            }
            if (e.shiftKey) {
              // Shift+drag on empty canvas draws a selection rectangle instead of panning
              isAreaSelectingRef.current = true
              if (areaSelectRectRef.current) {
                areaSelectRectRef.current.style.display = 'block'
                areaSelectRectRef.current.style.left = `${e.clientX}px`
                areaSelectRectRef.current.style.top = `${e.clientY}px`
                areaSelectRectRef.current.style.width = '0px'
                areaSelectRectRef.current.style.height = '0px'
              }
            } else {
              isPanningRef.current = true
              cameraFlyToRef.current = null // manual pan cancels any camera fly-to
              lastPanPositionRef.current = { x: e.clientX, y: e.clientY }
            }
          }
          return
        }
        
        // Right mouse button (button 2) - no special handling
        if (e.button === 2) {
          return
        }
      }
      
      // Mouse move - handle panning and cursor tracking
      const handleMouseMove = (e: MouseEvent) => {
        lastMouseScreenPositionRef.current = { x: e.clientX, y: e.clientY }
        lastActivityAtRef.current = Date.now()

        // Always track cursor position in world coordinates
        // Convert screen coordinates to world coordinates
        const worldX = (e.clientX - worldContainerRef.current!.x) / zoomRef.current
        const worldY = (e.clientY - worldContainerRef.current!.y) / zoomRef.current
        
        // Update cursor position for presence (will be throttled in the hook)
        updateCursorPosition(worldX, worldY)
        
        if (isPanningRef.current) {
          const deltaX = e.clientX - lastPanPositionRef.current.x
          const deltaY = e.clientY - lastPanPositionRef.current.y
          
          // Convert mouse movement to world space based on current zoom
          // This makes panning feel consistent regardless of zoom level
          // The viewport size divided by zoom gives us the world space visible on screen
          const viewportWorldWidth = window.innerWidth / zoomRef.current
          const viewportWorldHeight = window.innerHeight / zoomRef.current
          
          // Convert pixel delta to percentage of screen, then to world units
          const worldDeltaX = (deltaX / window.innerWidth) * viewportWorldWidth
          const worldDeltaY = (deltaY / window.innerHeight) * viewportWorldHeight
          
          // Move the camera (not the player)
          cameraPositionRef.current.x -= worldDeltaX
          cameraPositionRef.current.y -= worldDeltaY

          lastPanPositionRef.current = { x: e.clientX, y: e.clientY }
        }

        // Live-size the shape being dragged out. Writes both the size and the
        // centre, so the panel's dimension fields and the placement position
        // track the rectangle as it's drawn.
        if (isShapeDraggingRef.current && shapeDragStartWorldRef.current && worldContainerRef.current) {
          const start = shapeDragStartWorldRef.current
          const currentX = (e.clientX - worldContainerRef.current.x) / zoomRef.current
          const currentY = (e.clientY - worldContainerRef.current.y) / zoomRef.current

          // Dragging in any direction works: the rectangle is between the two
          // corners, not anchored to a top-left.
          const width = Math.abs(currentX - start.x)
          const height = Math.abs(currentY - start.y)

          // Merged, not replaced: the drag only decides the size. The shape
          // and corner radius belong to the panel and must survive it.
          setShapeDraftSize(prev => ({
            shapeType: prev?.shapeType ?? 'rectangle',
            cornerRadius: prev?.cornerRadius ?? 0,
            width,
            height,
          }))
          setClickedTracePosition({
            x: (start.x + currentX) / 2,
            y: (start.y + currentY) / 2,
          })
          return
        }

        if (isAreaSelectingRef.current && mouseDownScreenPosRef.current && areaSelectRectRef.current) {
          const startX = mouseDownScreenPosRef.current.x
          const startY = mouseDownScreenPosRef.current.y
          areaSelectRectRef.current.style.left = `${Math.min(startX, e.clientX)}px`
          areaSelectRectRef.current.style.top = `${Math.min(startY, e.clientY)}px`
          areaSelectRectRef.current.style.width = `${Math.abs(e.clientX - startX)}px`
          areaSelectRectRef.current.style.height = `${Math.abs(e.clientY - startY)}px`
        }
      }

      // Mouse up - stop panning
      const handleMouseUp = (e: MouseEvent) => {
        if (e.button === 0) {
          isPanningRef.current = false

          if (isShapeDraggingRef.current) {
            isShapeDraggingRef.current = false
            shapeDragStartWorldRef.current = null
            // A click rather than a drag: the user was repositioning the
            // shape, not resizing it to nothing. Keep whatever size is already
            // set (the panel's default on the first click) instead of
            // collapsing it, and let the click-to-place handling stand.
            const draft = shapeDraftSizeRef.current
            if (draft && (draft.width < 4 || draft.height < 4)) {
              setShapeDraftSize(null)
            }
            return
          }

          if (isAreaSelectingRef.current) {
            isAreaSelectingRef.current = false
            if (areaSelectRectRef.current) areaSelectRectRef.current.style.display = 'none'

            if (mouseDownScreenPosRef.current && worldContainerRef.current) {
              const startX = mouseDownScreenPosRef.current.x
              const startY = mouseDownScreenPosRef.current.y
              const dragDistance = Math.hypot(e.clientX - startX, e.clientY - startY)

              // Ignore a shift+click with no real drag, so an accidental tiny
              // movement doesn't clear the existing selection.
              if (dragDistance >= 5) {
                const zoom = zoomRef.current
                const wx1 = (Math.min(startX, e.clientX) - worldContainerRef.current.x) / zoom
                const wy1 = (Math.min(startY, e.clientY) - worldContainerRef.current.y) / zoom
                const wx2 = (Math.max(startX, e.clientX) - worldContainerRef.current.x) / zoom
                const wy2 = (Math.max(startY, e.clientY) - worldContainerRef.current.y) / zoom

                // Approximate each trace's footprint (real per-type rendered
                // size isn't available here -- that's computed inside
                // TraceOverlay -- but the same default-size table used for
                // bin-packing is a reasonable stand-in for hit-testing).
                const matchedIds = tracesDataRef.current
                  .filter(trace => {
                    const size = (trace.width && trace.height) ? { width: trace.width, height: trace.height } : getDefaultTraceBoxSize(trace.type)
                    const scaleX = trace.scaleX ?? trace.scale ?? 1
                    const scaleY = trace.scaleY ?? trace.scale ?? 1
                    const halfW = (size.width * scaleX) / 2
                    const halfH = (size.height * scaleY) / 2
                    const left = trace.x - halfW
                    const right = trace.x + halfW
                    const top = trace.y - halfH
                    const bottom = trace.y + halfH
                    return left < wx2 && right > wx1 && top < wy2 && bottom > wy1
                  })
                  .map(trace => trace.id)

                setMultiSelectRequest(matchedIds)

                // This mouseup is immediately followed by a native 'click'
                // event (mousedown and mouseup both landed on/near the same
                // empty-canvas element), which TraceOverlay's own "click
                // outside a trace" listener treats as "deselect everything" --
                // wiping out the selection just set above one tick later.
                // Swallow that one click in the capture phase, before it ever
                // reaches TraceOverlay's bubble-phase listener.
                const suppressClick = (ce: MouseEvent) => {
                  ce.stopPropagation()
                  ce.preventDefault()
                }
                window.addEventListener('click', suppressClick, { capture: true, once: true })
              }
            }
            mouseDownScreenPosRef.current = null
            return
          }

          // While the new-trace panel is open, a genuine click (not a pan-drag)
          // on the map updates the pending placement position live.
          if (showTracePanelRef.current && !isDrawingModeRef.current && mouseDownScreenPosRef.current) {
            const dx = e.clientX - mouseDownScreenPosRef.current.x
            const dy = e.clientY - mouseDownScreenPosRef.current.y
            const dragDistance = Math.hypot(dx, dy)
            if (dragDistance < 5) {
              const target = e.target as HTMLElement
              const isUI = target.closest('[data-ui-element], [data-trace-element], button, input, textarea, select, label, [role="dialog"], .customize-menu, .pointer-events-auto') !== null
              if (!isUI && worldContainerRef.current) {
                const worldX = (e.clientX - worldContainerRef.current.x) / zoomRef.current
                const worldY = (e.clientY - worldContainerRef.current.y) / zoomRef.current
                setClickedTracePosition({ x: worldX, y: worldY })
              }
            }
          }
          mouseDownScreenPosRef.current = null
        }
      }
      
      // Prevent context menu on right click - show custom map context menu instead
      const handleContextMenu = (e: MouseEvent) => {
        // Allow native browser context menu inside selectable text areas (modal preview)
        const target = e.target as HTMLElement
        if (target.closest('.selectable-text')) return
        e.preventDefault()
        
        // Only show map context menu if clicking on the canvas (not UI elements or trace overlays)
        const isUI = target.closest('[data-ui-element], [data-trace-element], button, input, textarea, select, label, [role="dialog"], .customize-menu, .pointer-events-auto')
        if (isUI) return
        if (!canEditRef.current) return

        // Convert screen coords to world coords
        if (worldContainerRef.current) {
          const worldX = (e.clientX - worldContainerRef.current.x) / zoomRef.current
          const worldY = (e.clientY - worldContainerRef.current.y) / zoomRef.current
          setMapContextMenu({ x: e.clientX, y: e.clientY, worldX, worldY })

          // Probed asynchronously so the menu opens instantly, and starting
          // from "no" so the Paste Image entry appears a moment later rather
          // than appearing immediately and vanishing under the cursor when the
          // clipboard turns out to be empty.
          setClipboardHasImage(false)
          void readClipboardImageFiles().then(files => {
            setClipboardHasImage(files === null ? null : files.length > 0)
          })
        }
      }

      // --- Touch handlers for mobile ---
      const handleTouchStart = (e: TouchEvent) => {
        const target = e.target as HTMLElement
        const isUI = target.closest('[data-ui-element], [data-trace-element], button, input, textarea, select, label, [role="dialog"], .customize-menu, .pointer-events-auto') !== null
        if (isUI) return

        if (e.touches.length === 1 && !isDrawingModeRef.current) {
          // Single finger - pan
          isPanningRef.current = true
          cameraFlyToRef.current = null // manual pan cancels any camera fly-to
          lastPanPositionRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        } else if (e.touches.length === 2) {
          // Two fingers - pinch zoom (stop panning)
          isPanningRef.current = false
          const dx = e.touches[0].clientX - e.touches[1].clientX
          const dy = e.touches[0].clientY - e.touches[1].clientY
          lastTouchDistRef.current = Math.hypot(dx, dy)
        }
      }

      const handleTouchMove = (e: TouchEvent) => {
        if (isDrawingModeRef.current) return
        e.preventDefault() // Prevent scroll/rubber-band

        if (e.touches.length === 1 && isPanningRef.current) {
          const touch = e.touches[0]
          const deltaX = touch.clientX - lastPanPositionRef.current.x
          const deltaY = touch.clientY - lastPanPositionRef.current.y
          const vwW = window.innerWidth / zoomRef.current
          const vwH = window.innerHeight / zoomRef.current
          cameraPositionRef.current.x -= (deltaX / window.innerWidth) * vwW
          cameraPositionRef.current.y -= (deltaY / window.innerHeight) * vwH
          lastPanPositionRef.current = { x: touch.clientX, y: touch.clientY }

          // Also update cursor position for presence
          if (worldContainerRef.current) {
            const worldX = (touch.clientX - worldContainerRef.current.x) / zoomRef.current
            const worldY = (touch.clientY - worldContainerRef.current.y) / zoomRef.current
            updateCursorPosition(worldX, worldY)
          }
        } else if (e.touches.length === 2 && lastTouchDistRef.current !== null) {
          const dx = e.touches[0].clientX - e.touches[1].clientX
          const dy = e.touches[0].clientY - e.touches[1].clientY
          const dist = Math.hypot(dx, dy)
          const scale = dist / lastTouchDistRef.current
          const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * scale))
          targetZoomRef.current = newZoom
          zoomRef.current = newZoom // Immediate for pinch
          lastTouchDistRef.current = dist
        }
      }

      const handleTouchEnd = (_e: TouchEvent) => {
        isPanningRef.current = false
        lastTouchDistRef.current = null
      }
      
      // Store handlers in ref for cleanup (wheel is already set above)
      eventHandlersRef.current.mousedown = handleMouseDown
      eventHandlersRef.current.mousemove = handleMouseMove
      eventHandlersRef.current.mouseup = handleMouseUp
      eventHandlersRef.current.contextmenu = handleContextMenu
      
      window.addEventListener('mousedown', handleMouseDown)
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('contextmenu', handleContextMenu)
      window.addEventListener('touchstart', handleTouchStart, { passive: false })
      window.addEventListener('touchmove', handleTouchMove, { passive: false })
      window.addEventListener('touchend', handleTouchEnd)
      eventHandlersRef.current.touchstart = handleTouchStart
      eventHandlersRef.current.touchmove = handleTouchMove
      eventHandlersRef.current.touchend = handleTouchEnd

      // Fluid animation loop
      let pulseTime = 0
      let frameCounter = 0
      let lastGridZoom = 1.0 // Track zoom level when grid was last drawn
      
      app.ticker.add(() => {
        frameCounter++

        // Camera fly-to (Locations panel jump / presentation mode): eased
        // interpolation of both position and zoom. Setting targetZoomRef to the
        // eased value keeps the normal zoom-lerp below a no-op while it runs.
        const flyTo = cameraFlyToRef.current
        if (flyTo) {
          const raw = Math.min((performance.now() - flyTo.startTime) / flyTo.duration, 1)
          const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2 // easeInOutQuad
          cameraPositionRef.current.x = flyTo.startX + (flyTo.targetX - flyTo.startX) * eased
          cameraPositionRef.current.y = flyTo.startY + (flyTo.targetY - flyTo.startY) * eased
          const z = flyTo.startZoom + (flyTo.targetZoom - flyTo.startZoom) * eased
          zoomRef.current = z
          targetZoomRef.current = z
          if (raw >= 1) cameraFlyToRef.current = null
        }

        // Smooth zoom interpolation with snap-to-target to prevent jitter
        const zoomLerpSpeed = 0.1 // Slower for smoother animation
        const zoomDiff = targetZoomRef.current - zoomRef.current
        
        // Snap to target if very close (prevents oscillation/jitter)
        if (Math.abs(zoomDiff) < 0.003) {
          zoomRef.current = targetZoomRef.current
        } else {
          zoomRef.current += zoomDiff * zoomLerpSpeed
        }
        
        // Check if zoom is stable (reached target)
        const zoomIsStable = zoomRef.current === targetZoomRef.current
        
        // Update world container scale
        worldContainer.scale.set(zoomRef.current)
        
        // Update camera (world container offset based on camera position)
        // Round to whole pixels to prevent sub-pixel jitter
        const rawX = -cameraPositionRef.current.x * zoomRef.current + viewportWidth / 2
        const rawY = -cameraPositionRef.current.y * zoomRef.current + viewportHeight / 2
        worldContainer.x = Math.round(rawX)
        worldContainer.y = Math.round(rawY)
        
        // Sync world offset for overlay
        const newOffsetX = worldContainer.x
        const newOffsetY = worldContainer.y
        worldOffsetRef.current = { x: newOffsetX, y: newOffsetY }
        
        // Update state for React - traces need this to position correctly during zoom
        // Use requestAnimationFrame-style throttling (every frame is fine, React batches these)
        const offsetChanged = Math.abs(newOffsetX - worldOffset.x) > 0.5 || Math.abs(newOffsetY - worldOffset.y) > 0.5
        if (offsetChanged) {
          setWorldOffset({ x: newOffsetX, y: newOffsetY })
        }
        
        // Update zoom state for React - update during animation for smooth trace scaling
        if (Math.abs(zoomRef.current - zoom) > 0.001) {
          setZoom(zoomRef.current)
        }
        
        // Update grid every frame during zoom changes, otherwise every other frame
        const zoomChanged = Math.abs(zoomRef.current - lastGridZoom) > 0.001
        if (zoomChanged || (zoomIsStable && frameCounter % 2 === 0)) {
          if (updateGridRef.current) {
            updateGridRef.current(cameraPositionRef.current.x, cameraPositionRef.current.y)
          }
          lastGridZoom = zoomRef.current
        }
        
        // Update theme manager
        const themeManager = themeManagerRef.current
        if (themeManager) {
          const camX = cameraPositionRef.current.x
          const camY = cameraPositionRef.current.y
          
          // Always update floating particles (they should animate continuously)
          themeManager.updateParticles(camX, camY, viewportWidth, viewportHeight)
          
          const playerPos = { x: positionRef.current.x, y: positionRef.current.y }
          const tracePositions = tracesDataRef.current.map(t => ({ x: t.x, y: t.y }))
          
          // Only GENERATE ground elements when zoom is stable (expensive)
          if (frameCounter % 2 === 0 && zoomIsStable) {
            // Cover the visible canvas plus a 30% ring for pan pre-loading.
            //
            // Expressed as a multiple of the half-viewport, not an absolute
            // pixel margin: cullGroundElements measures distance normalized
            // per axis, so a fixed margin lands at a different normalized
            // depth horizontally than vertically, and the short axis could
            // generate past the cull threshold and thrash. This extent stays
            // below that threshold (1.6) on both axes.
            //
            // The old bounds spanned a FULL viewport on each side, i.e. 4x
            // the visible area, most of it never seen.
            const GROUND_GEN_EXTENT = 1.3
            const worldHalfW = (viewportWidth / zoomRef.current) / 2
            const worldHalfH = (viewportHeight / zoomRef.current) / 2
            const minX = camX - worldHalfW * GROUND_GEN_EXTENT
            const minY = camY - worldHalfH * GROUND_GEN_EXTENT
            const maxX = camX + worldHalfW * GROUND_GEN_EXTENT
            const maxY = camY + worldHalfH * GROUND_GEN_EXTENT

            themeManager.generateGroundElements(
              minX, minY, maxX, maxY
            )
          }
          
          // Always CULL ground elements (handles fade-out during zoom to prevent flickering)
          if (frameCounter % 2 === 0) {
            themeManager.cullGroundElements(camX, camY, viewportWidth, viewportHeight, playerPos.x, playerPos.y, tracePositions, zoomRef.current)
          }
        }
        
        // NOTE: Lighting is now handled in TraceOverlay.tsx using DOM elements with blur
        // The Pixi.js lighting layer is kept for potential future use but not actively rendering
        if (lightingLayerRef.current) {
          lightingLayerRef.current.clear()
        }
        
        // Player avatar and label now rendered in DOM (no need to update Pixi objects)
        // Keeping refs for compatibility but they're invisible

        // Shape being placed: draw the rectangle it will occupy, so the size
        // in the panel and the size on the canvas are the same thing seen two
        // ways. Drawn in the same graphics object as the placement pulse,
        // which already lives in the world container and so scales and pans
        // with the camera for free.
        const placementPos = clickedTracePositionRef.current
        const draftSize = shapeDraftSizeRef.current
        const indicator = indicatorColorRef.current

        if (tracePlacementIndicatorRef.current && placementPos && draftSize) {
          // Same slow breath as the placement marker, so the two don't feel
          // like different pieces of UI.
          pulseTime += 0.02
          const breath = (Math.sin(pulseTime) + 1) / 2
          const halfW = draftSize.width / 2
          const halfH = draftSize.height / 2

          const g = tracePlacementIndicatorRef.current
          g.clear()
          g.lineStyle(1.5, indicator.primary, 0.35 + breath * 0.2)
          g.beginFill(indicator.primary, 0.05)

          const left = placementPos.x - halfW
          const top = placementPos.y - halfH

          if (draftSize.shapeType === 'circle') {
            g.drawEllipse(placementPos.x, placementPos.y, halfW, halfH)
          } else if (draftSize.shapeType === 'triangle') {
            // Corner radius isn't drawn for a triangle: rounding a polygon's
            // corners needs arc construction this preview doesn't warrant, and
            // a rounded rectangle here would misrepresent the shape entirely.
            g.drawPolygon([
              placementPos.x, top,
              placementPos.x + halfW, placementPos.y + halfH,
              placementPos.x - halfW, placementPos.y + halfH,
            ])
          } else if (draftSize.cornerRadius > 0) {
            // Clamped to half the shorter side: past that Pixi draws nothing
            // at all, so a large radius on a small shape made the preview
            // vanish rather than round off.
            const radius = Math.min(draftSize.cornerRadius, halfW, halfH)
            g.drawRoundedRect(left, top, draftSize.width, draftSize.height, radius)
          } else {
            g.drawRect(left, top, draftSize.width, draftSize.height)
          }

          g.endFill()
          // Centre mark, so a rectangle dragged out very small is still
          // visible as a placement.
          g.lineStyle(0)
          g.beginFill(indicator.primary, 0.55)
          g.drawCircle(placementPos.x, placementPos.y, 3)
          g.endFill()
        } else if (tracePlacementIndicatorRef.current && placementPos) {
          // Placement marker: one colour, thin lines, and a slow breath.
          //
          // Three things made the old one harsh. It advanced 0.1 radians a
          // frame, a full cycle in about a second; it used abs(sin), which
          // has a cusp at zero and so snapped rather than eased; and its
          // centre was a second, brighter colour. This is a fifth of the
          // speed, on a smooth 0..1 curve, in a single colour that already
          // follows the atrium's background.
          pulseTime += 0.02
          const breath = (Math.sin(pulseTime) + 1) / 2
          const radius = 20 + breath * 6

          const g = tracePlacementIndicatorRef.current
          g.clear()

          // Faint outer halo -- gives the marker presence without a hard edge.
          g.lineStyle(1.5, indicator.primary, 0.08 + breath * 0.08)
          g.drawCircle(placementPos.x, placementPos.y, radius + 12)

          // The ring itself, thin enough to read as drawn on the canvas
          // rather than sitting on top of it.
          g.lineStyle(1.5, indicator.primary, 0.30 + breath * 0.18)
          g.drawCircle(placementPos.x, placementPos.y, radius)

          // A small steady centre, same colour, no pulse -- it marks the exact
          // point, so moving or flashing it would work against that.
          g.beginFill(indicator.primary, 0.45)
          g.drawCircle(placementPos.x, placementPos.y, 2.5)
          g.endFill()
        } else if (tracePlacementIndicatorRef.current) {
          // Clear indicator if no trace position
          tracePlacementIndicatorRef.current.clear()
        }

        // Update trace direction indicators on screen borders (Nier:Automata style)
        // Uses object pooling to prevent memory leaks
        if (traceIndicatorsRef.current) {
          // Check if indicators are toggled off
          const showIndicators = useGameStore.getState().showTraceIndicators
          if (!showIndicators) {
            indicatorPoolRef.current.forEach(({ graphics }) => {
              graphics.visible = false
              if (graphics.parent) graphics.parent.removeChild(graphics)
            })
          } else {
          pulseTime += 0.02 // Slower pulse for elegant animation

          // Find traces that are outside the camera viewport
          const cameraX = cameraPositionRef.current.x
          const cameraY = cameraPositionRef.current.y

          const offScreenTraces: Array<{ distance: number; angle: number }> = []

          tracesDataRef.current.forEach((trace) => {
            // A path's x/y field is only set at creation and by whole-path
            // moves -- dragging an individual point only ever updates
            // shapePoints, so x/y can drift far from where the path is
            // actually rendered (see the same fix in TraceOverlay's
            // viewport culling). Point this indicator at the path's live
            // centroid instead so it doesn't silently miss (or misdirect
            // for) a path that's actually off-screen.
            let tx = trace.x
            let ty = trace.y
            if (trace.type === 'shape' && trace.shapeType === 'path' && trace.shapePoints && trace.shapePoints.length > 0) {
              const xs = trace.shapePoints.map(p => p.x)
              const ys = trace.shapePoints.map(p => p.y)
              tx = (Math.min(...xs) + Math.max(...xs)) / 2
              ty = (Math.min(...ys) + Math.max(...ys)) / 2
            }

            const traceScreenX = (tx - cameraX) * zoomRef.current + viewportWidth / 2
            const traceScreenY = (ty - cameraY) * zoomRef.current + viewportHeight / 2

            const margin = 100
            const isOutsideViewport =
              traceScreenX < -margin || traceScreenX > viewportWidth + margin ||
              traceScreenY < -margin || traceScreenY > viewportHeight + margin

            if (isOutsideViewport) {
              const dx = tx - cameraX
              const dy = ty - cameraY
              const distance = Math.sqrt(dx * dx + dy * dy)
              const angle = Math.atan2(dy, dx)
              offScreenTraces.push({ distance, angle })
            }
          })

          // Sort by distance and show up to 10 closest
          offScreenTraces.sort((a, b) => a.distance - b.distance)
          const closestTraces = offScreenTraces.slice(0, 10)
          const neededCount = closestTraces.length
          
          // Ensure pool has enough indicators (create if needed, only once)
          while (indicatorPoolRef.current.length < neededCount) {
            const graphics = new Graphics()
            const distanceText = new Text('', {
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: 9,
              fill: 0xDADADA,
              letterSpacing: 1,
            })
            distanceText.anchor.set(0.5)
            const unitText = new Text('u', {
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: 7,
              fill: 0x888888,
            })
            unitText.anchor.set(0, 0.5)
            graphics.addChild(distanceText)
            graphics.addChild(unitText)
            indicatorPoolRef.current.push({ graphics, distanceText, unitText })
          }
          
          // Hide all indicators first
          indicatorPoolRef.current.forEach(({ graphics }) => {
            graphics.visible = false
            if (graphics.parent) graphics.parent.removeChild(graphics)
          })
          
          // Update and show needed indicators
          closestTraces.forEach(({ distance, angle }, index) => {
            const poolItem = indicatorPoolRef.current[index]
            const { graphics: indicator, distanceText, unitText } = poolItem
            
            // Calculate position on screen border
            const edgeMargin = 50
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)
            const halfW = viewportWidth / 2 - edgeMargin
            const halfH = viewportHeight / 2 - edgeMargin
            const tX = cos !== 0 ? halfW / Math.abs(cos) : Infinity
            const tY = sin !== 0 ? halfH / Math.abs(sin) : Infinity
            const t = Math.min(tX, tY)
            let indicatorX = viewportWidth / 2 + cos * t
            let indicatorY = viewportHeight / 2 + sin * t
            indicatorX = Math.max(edgeMargin, Math.min(viewportWidth - edgeMargin, indicatorX))
            indicatorY = Math.max(edgeMargin, Math.min(viewportHeight - edgeMargin, indicatorY))
            
            // Animation values
            const staggeredPulse = Math.sin(pulseTime * 3 + index * 0.5) * 0.5 + 0.5
            const breathe = Math.sin(pulseTime * 2) * 0.3 + 0.7
            const maxDistance = 3000
            const distanceAlpha = Math.max(0.4, 1 - (distance / maxDistance) * 0.6)
            const bracketSize = 18 + staggeredPulse * 4
            
            // Redraw the graphics (clear and redraw is efficient for Graphics)
            indicator.clear()
            indicator.lineStyle(1.5, 0xDADADA, distanceAlpha * breathe)
            
            // Brackets
            indicator.moveTo(-bracketSize, -bracketSize + 8)
            indicator.lineTo(-bracketSize, -bracketSize)
            indicator.lineTo(-bracketSize + 8, -bracketSize)
            indicator.moveTo(bracketSize - 8, -bracketSize)
            indicator.lineTo(bracketSize, -bracketSize)
            indicator.lineTo(bracketSize, -bracketSize + 8)
            indicator.moveTo(bracketSize, bracketSize - 8)
            indicator.lineTo(bracketSize, bracketSize)
            indicator.lineTo(bracketSize - 8, bracketSize)
            indicator.moveTo(-bracketSize + 8, bracketSize)
            indicator.lineTo(-bracketSize, bracketSize)
            indicator.lineTo(-bracketSize, bracketSize - 8)
            
            // Diamond
            const diamondSize = 6 + staggeredPulse * 2
            indicator.lineStyle(1.5, 0xFFFFFF, distanceAlpha * 0.9)
            indicator.moveTo(0, -diamondSize)
            indicator.lineTo(diamondSize, 0)
            indicator.lineTo(0, diamondSize)
            indicator.lineTo(-diamondSize, 0)
            indicator.lineTo(0, -diamondSize)
            
            // Center dot
            indicator.beginFill(0xFFFFFF, distanceAlpha)
            indicator.drawCircle(0, 0, 2)
            indicator.endFill()
            
            // Direction line
            const lineLength = 25 + staggeredPulse * 5
            indicator.lineStyle(1, 0xDADADA, distanceAlpha * 0.6)
            indicator.moveTo(cos * 12, sin * 12)
            indicator.lineTo(cos * lineLength, sin * lineLength)
            
            indicator.x = indicatorX
            indicator.y = indicatorY
            
            // Update text
            distanceText.text = `${Math.round(distance)}`
            distanceText.alpha = distanceAlpha * 0.8
            distanceText.y = bracketSize + 12
            unitText.alpha = distanceAlpha * 0.6
            unitText.x = distanceText.width / 2 + 2
            unitText.y = bracketSize + 12
            
            indicator.visible = true
            traceIndicatorsRef.current?.addChild(indicator)
          })
          } // end showIndicators else
        }

        // Update other users in world space
        const currentOtherUsers = otherUsersRef.current
        
        // Clean up avatars for users who have left
        avatarsRef.current.forEach((avatar, id) => {
          if (!currentOtherUsers[id]) {
            const label = (avatar as any)?.label
            if (label) {
              label.destroy()
            }
            avatar.destroy()
            avatarsRef.current.delete(id)
          }
        })
        
        Object.entries(currentOtherUsers).forEach(([id, user]) => {
          let avatar = avatarsRef.current.get(id)
          
          if (!avatar) {
            // Creating avatar for user
            const newAvatar = new Graphics()
            
            // Convert hex color to integer (e.g., '#ff0000' -> 0xff0000)
            const hexToInt = (hex: string) => {
              const cleanHex = hex.replace('#', '')
              return parseInt(cleanHex, 16)
            }
            const userColor = hexToInt(user.playerColor || '#ffffff')
            
            // Outer glow
            newAvatar.beginFill(userColor, 0.1)
            newAvatar.drawCircle(0, 0, AVATAR_SIZE + 8)
            newAvatar.endFill()
            
            // Middle glow
            newAvatar.beginFill(userColor, 0.3)
            newAvatar.drawCircle(0, 0, AVATAR_SIZE + 4)
            newAvatar.endFill()
            
            // Main circle
            newAvatar.beginFill(userColor)
            newAvatar.drawCircle(0, 0, AVATAR_SIZE)
            newAvatar.endFill()
            
            newAvatar.x = user.x
            newAvatar.y = user.y
            worldContainer.addChild(newAvatar)
            avatarsRef.current.set(id, newAvatar)

            const otherLabel = new Text(user.username, {
              fontSize: 12,
              fill: userColor,
            })
            otherLabel.x = user.x
            otherLabel.y = user.y - AVATAR_SIZE - 10
            otherLabel.anchor.set(0.5)
            worldContainer.addChild(otherLabel)
            avatar = newAvatar
            ;(avatar as any).label = otherLabel
            ;(avatar as any).playerColor = user.playerColor
          }

          // Update avatar color if it changed
          const currentColor = (avatar as any)?.playerColor
          if (currentColor !== user.playerColor) {
            // Redraw avatar with new color
            const hexToInt = (hex: string) => {
              const cleanHex = hex.replace('#', '')
              return parseInt(cleanHex, 16)
            }
            const userColor = hexToInt(user.playerColor || '#ffffff')
            
            avatar.clear()
            // Outer glow
            avatar.beginFill(userColor, 0.1)
            avatar.drawCircle(0, 0, AVATAR_SIZE + 8)
            avatar.endFill()
            // Middle glow
            avatar.beginFill(userColor, 0.3)
            avatar.drawCircle(0, 0, AVATAR_SIZE + 4)
            avatar.endFill()
            // Main circle
            avatar.beginFill(userColor)
            avatar.drawCircle(0, 0, AVATAR_SIZE)
            avatar.endFill()
            
            ;(avatar as any).playerColor = user.playerColor
            
            // Update label color too
            const otherLabel = (avatar as any)?.label
            if (otherLabel) {
              otherLabel.style.fill = userColor
            }
          }

          // Smooth interpolation
          if (avatar && avatar.transform) {
            avatar.x += (user.x - avatar.x) * 0.1
            avatar.y += (user.y - avatar.y) * 0.1
          }
          
          const otherLabel = (avatar as any)?.label
          if (otherLabel && otherLabel.transform) {
            otherLabel.x = avatar.x
            otherLabel.y = avatar.y - AVATAR_SIZE - 10
          }
          
          // Fade based on distance
          const dx = user.x - positionRef.current.x
          const dy = user.y - positionRef.current.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          
          if (avatar && avatar.transform) {
            if (distance > TRACE_RENDER_DISTANCE) {
              avatar.visible = false
              if (otherLabel && otherLabel.transform) otherLabel.visible = false
            } else {
              avatar.visible = true
              if (otherLabel && otherLabel.transform) otherLabel.visible = true
              
              if (distance > TRACE_FADE_DISTANCE) {
                const fadeAlpha = 1 - ((distance - TRACE_FADE_DISTANCE) / (TRACE_RENDER_DISTANCE - TRACE_FADE_DISTANCE))
                avatar.alpha = Math.max(0, fadeAlpha)
                if (otherLabel && otherLabel.transform) otherLabel.alpha = Math.max(0, fadeAlpha)
              } else {
                avatar.alpha = 1
                if (otherLabel && otherLabel.transform) otherLabel.alpha = 1
              }
            }
          }
        })

        // Other users are now rendered in TraceOverlay DOM, so hide all Pixi avatars
        avatarsRef.current.forEach((avatar) => {
          if (avatar) {
            avatar.visible = false
            const label = (avatar as any)?.label
            if (label) {
              label.visible = false
            }
          }
        })
      })
    }

    return () => {
      cancelled = true
      // Cleanup theme manager
      if (themeManagerRef.current) {
        themeManagerRef.current.destroy()
        themeManagerRef.current = null
      }
      
      // Remove event listeners
      if (eventHandlersRef.current.mousedown) {
        window.removeEventListener('mousedown', eventHandlersRef.current.mousedown)
      }
      if (eventHandlersRef.current.mousemove) {
        window.removeEventListener('mousemove', eventHandlersRef.current.mousemove)
      }
      if (eventHandlersRef.current.mouseup) {
        window.removeEventListener('mouseup', eventHandlersRef.current.mouseup)
      }
      if (eventHandlersRef.current.contextmenu) {
        window.removeEventListener('contextmenu', eventHandlersRef.current.contextmenu)
      }
      if (eventHandlersRef.current.wheel) {
        window.removeEventListener('wheel', eventHandlersRef.current.wheel)
      }
      if (eventHandlersRef.current.touchstart) {
        window.removeEventListener('touchstart', eventHandlersRef.current.touchstart)
      }
      if (eventHandlersRef.current.touchmove) {
        window.removeEventListener('touchmove', eventHandlersRef.current.touchmove)
      }
      if (eventHandlersRef.current.touchend) {
        window.removeEventListener('touchend', eventHandlersRef.current.touchend)
      }
      eventHandlersRef.current = { mousedown: null, mousemove: null, mouseup: null, contextmenu: null, wheel: null, touchstart: null, touchmove: null, touchend: null }
      
      // Save camera position for this lobby+user before cleanup
      try {
        const payload = JSON.stringify({
          x: cameraPositionRef.current.x,
          y: cameraPositionRef.current.y,
          zoom: zoomRef.current,
        })
        if (userId) localStorage.setItem(`lobby_camera_${lobbyId}_${userId}`, payload)
        localStorage.setItem(`lobby_camera_${lobbyId}`, payload)
      } catch {}

      // Clear all refs to help garbage collection
      cameraRestoredRef.current = false
      worldContainerRef.current = null
      avatarsRef.current.clear()
      tracesRef.current.clear()
      labelRef.current = null
      playerAvatarRef.current = null
      tracePlacementIndicatorRef.current = null
      traceIndicatorsRef.current = null
      lightingLayerRef.current = null
      gridRef.current = null
      updateGridRef.current = null
      tracesDataRef.current = []
      otherUsersRef.current = {}
      
      // Destroy indicator pool objects to free GPU memory
      indicatorPoolRef.current.forEach(({ graphics, distanceText, unitText }) => {
        distanceText.destroy(true)
        unitText.destroy(true)
        graphics.destroy({ children: true })
      })
      indicatorPoolRef.current = []
      
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme when lobby theme settings change
  useEffect(() => {
    if (!appRef.current || !gridRef.current || !updateGridRef.current || !currentLobby) return

    // Update background color
    const bgColor = currentLobby.themeSettings?.backgroundColor ? 
      parseInt(currentLobby.themeSettings.backgroundColor.replace('#', ''), 16) : 0x0a0a0f
    appRef.current.renderer.background.color = bgColor

    // Update grid (will use new colors on next redraw)
    const gridColor = currentLobby.themeSettings?.gridColor ? 
      parseInt(currentLobby.themeSettings.gridColor.replace('#', ''), 16) : 0x3b82f6
    const gridOpacity = currentLobby.themeSettings?.gridOpacity ?? 0.2
    
    // Recreate updateGrid function with new colors
    const grid = gridRef.current
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    
    const newUpdateGrid = (cameraX: number, cameraY: number) => {
      grid.clear()
      if (currentLobby.themeSettings?.gridEnabled === false) return
      grid.lineStyle(1, gridColor, gridOpacity)
      const gridSize = 50
      const currentZoom = zoomRef.current
      const visibleW = window.innerWidth / currentZoom
      const visibleH = window.innerHeight / currentZoom
      const margin = gridSize * 2
      const startX = Math.floor((cameraX - visibleW / 2 - margin) / gridSize) * gridSize
      const endX = Math.ceil((cameraX + visibleW / 2 + margin) / gridSize) * gridSize
      const startY = Math.floor((cameraY - visibleH / 2 - margin) / gridSize) * gridSize
      const endY = Math.ceil((cameraY + visibleH / 2 + margin) / gridSize) * gridSize
      
      for (let x = startX; x <= endX; x += gridSize) {
        grid.moveTo(x, startY)
        grid.lineTo(x, endY)
      }
      for (let y = startY; y <= endY; y += gridSize) {
        grid.moveTo(startX, y)
        grid.lineTo(endX, y)
      }
    }
    
    updateGridRef.current = newUpdateGrid
    
    // Trigger immediate grid update
    newUpdateGrid(cameraPositionRef.current.x, cameraPositionRef.current.y)

    // Update ThemeManager settings
    if (themeManagerRef.current) {
      const themeSettings = currentLobby.themeSettings

      themeManagerRef.current.updateConfig({
        gridColor: themeSettings?.gridColor ? parseInt(themeSettings.gridColor.replace('#', ''), 16) : 0x3b82f6,
        particleColor:themeSettings?.particleColor ? parseInt(themeSettings.particleColor.replace('#', ''), 16) : 0xffffff,
        particlesEnabled: themeSettings?.particlesEnabled ?? true,
        groundEnabled: themeSettings?.groundParticlesEnabled ?? true,
        groundDensity: themeSettings?.groundElementDensity ?? 0.5,
        groundElementScale: themeSettings?.groundElementScale ?? 0.0625,
        groundElementScaleRange: themeSettings?.groundElementScaleRange ?? 0.025,
        particleOpacity: themeSettings?.particleOpacity ?? 0.6,
        particleDensity: themeSettings?.particleDensity ?? 1.0,
        groundParticleOpacity: themeSettings?.groundParticleOpacity ?? 1.0,
        groundPatternMode: themeSettings?.groundPatternMode ?? 'grid',
        gridSpacing: themeSettings?.gridSpacing ?? 100,
        groundCoverFullView: themeSettings?.groundCoverFullView ?? true,
        backgroundColor: themeSettings?.backgroundColor ? parseInt(themeSettings.backgroundColor.replace('#', ''), 16) : 0x0a0a0f,
      })

      // Recreate particles with new settings
      themeManagerRef.current.createParticles(viewportWidth, viewportHeight, cameraPositionRef.current.x, cameraPositionRef.current.y)

      // Handle ground elements
      if (themeSettings?.groundParticlesEnabled === false) {
        // Clear ground elements if disabled
        themeManagerRef.current.clearGroundElements()
      } else if (themeSettings?.groundParticleUrls && themeSettings.groundParticleUrls.length > 0) {
        // Use custom ground elements - this completely replaces the default ones
        themeManagerRef.current.clearGroundElements() // Clear existing first
        themeManagerRef.current.loadCustomGroundElements(themeSettings.groundParticleUrls)
      } else {
        // No custom URLs provided - reload default ground elements
        themeManagerRef.current.clearGroundElements()
        themeManagerRef.current.loadTheme() // This will load default ground elements
      }
    }
  }, [currentLobby?.themeSettings])

  // Update traces visualization with fade effect
  useEffect(() => {
    if (!appRef.current || !worldContainerRef.current) return
    
    const worldContainer = worldContainerRef.current
    
    // Create a set of current trace IDs for fast lookup
    const currentTraceIds = new Set(traces.map(t => t.id))
    
    // Clean up containers for traces that no longer exist
    tracesRef.current.forEach((container, id) => {
      if (!currentTraceIds.has(id)) {
        container.destroy({ children: true })
        tracesRef.current.delete(id)
      }
    })

    traces.forEach((trace) => {
      if (!tracesRef.current.has(trace.id)) {
        // Create simple marker for traces (DOM overlay handles actual content)
        const container = new Container()
        
        // Don't add marker dots - traces are displayed via DOM overlay

        container.x = trace.x
        container.y = trace.y
        
        worldContainer.addChild(container)
        tracesRef.current.set(trace.id, container)
      }
      
      // Update trace visibility and fade based on distance
      const traceContainer = tracesRef.current.get(trace.id)
      if (traceContainer) {
        const dx = trace.x - positionRef.current.x
        const dy = trace.y - positionRef.current.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        if (distance > TRACE_RENDER_DISTANCE) {
          traceContainer.visible = false
        } else {
          traceContainer.visible = true
          
          if (distance > TRACE_FADE_DISTANCE) {
            const fadeAlpha = 1 - ((distance - TRACE_FADE_DISTANCE) / (TRACE_RENDER_DISTANCE - TRACE_FADE_DISTANCE))
            traceContainer.alpha = Math.max(0, fadeAlpha)
          } else {
            traceContainer.alpha = 1
          }
        }
      }
    })
  }, [traces, position])

  // Fullscreen toggle
  const toggleFullscreen = async () => {
    if (isDesktop) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const current = await win.isFullscreen()
      await win.setFullscreen(!current)
      setIsFullscreen(!current)
    } else {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    }
  }

  // Listen for fullscreen changes (e.g. user presses Escape)
  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handleFsChange)

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  // Any in-app drag that isn't a file or a link. Listed in one place because
  // the three handlers below have to agree exactly: if dragover exempts a
  // drag but drop doesn't (or vice versa), the overlay either flashes or gets
  // stuck on with no way to clear it short of a reload.
  const isInternalDrag = (e: React.DragEvent) =>
    e.dataTransfer.types.includes(TRACE_DRAG_DATA_KEY) ||
    e.dataTransfer.types.includes(LAYER_DRAG_DATA_KEY) ||
    e.dataTransfer.types.includes(LOCATION_DRAG_DATA_KEY)

  // Reads any images sitting on the clipboard, as real files ready to upload.
  //
  // This is the async Clipboard API rather than a paste event, because there's
  // no paste event to read here -- the user chose a menu item. It can be
  // refused (no permission, no support), which is why the caller distinguishes
  // "no image" from "couldn't look".
  const readClipboardImageFiles = async (): Promise<File[] | null> => {
    if (!navigator.clipboard?.read) return null
    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      for (const item of items) {
        const imageType = item.types.find(type => type.startsWith('image/'))
        if (!imageType) continue
        const blob = await item.getType(imageType)
        const extension = imageType.split('/')[1] || 'png'
        files.push(new File([blob], `pasted-image.${extension}`, { type: imageType }))
      }
      return files
    } catch {
      return null
    }
  }

  // Turns a set of local files into traces, laid out as one arrangement around
  // a point. Shared by the drop handler and the Create Trace panel's file
  // picker, so selecting six images in the picker lands them exactly as
  // dragging the same six in would.
  const placeFilesAsTraces = async (files: File[], worldX: number, worldY: number) => {
    // Phase 1: classify every file and estimate its box size without uploading
    // or inserting anything yet, so the whole batch can be bin-packed into one
    // layout instead of just cascading diagonally from the drop point. Real
    // dimensions are probed for actual image files (fast, local); everything
    // else uses a type-based default.
    type PendingDrop = {
      traceType: string
      content: string
      mediaUrl?: string
      file?: File
      size: { width: number; height: number }
    }
    const pending: PendingDrop[] = []

    for (const file of files) {
      const traceType = classifyDroppedFile(file)

      if (traceType === 'text') {
        const text = await file.text()
        const extension = inferFileExtension(file)

        // A URL found inside a dropped text/html file is still just a
        // remote reference, not real local file content -- always an
        // embed, same as any other web-sourced URL drop (see handleDrop).
        if (file.type === 'text/html' || extension === 'html' || extension === 'htm') {
          const htmlImagePayload = extractImageUrlFromHtml(text)
          if (htmlImagePayload) {
            pending.push({ traceType: 'embed', content: htmlImagePayload.url, mediaUrl: htmlImagePayload.url, size: getDefaultTraceBoxSize('embed') })
            continue
          }
        }

        const urlPayload = getDroppedUrlPayload(text)
        if (urlPayload) {
          pending.push({ traceType: 'embed', content: urlPayload.url, mediaUrl: urlPayload.url, size: getDefaultTraceBoxSize('embed') })
          continue
        }

        pending.push({ traceType: 'text', content: text.slice(0, 5000), size: getDefaultTraceBoxSize('text') })
        continue
      }

      const probed = traceType === 'image' ? await probeImageFileDimensions(file) : null
      const size = probed ? scaleToDisplayBox(probed) : getDefaultTraceBoxSize(traceType)
      pending.push({ traceType, content: `${traceType} drop`, file, size })
    }

    // Phase 2: pack the batch around the drop point, then upload/insert.
    const offsets = packBoxesAroundCenter(pending.map(p => p.size), 24, packingShapeRef.current)

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]
      const dropX = worldX + offsets[i].x
      const dropY = worldY + offsets[i].y

      if (item.file) {
        const uploadedUrl = await uploadFile(item.file)
        if (uploadedUrl) {
          await insertDroppedTrace(item.traceType, item.content, uploadedUrl, dropX, dropY)
        }
      } else {
        await insertDroppedTrace(item.traceType, item.content, item.mediaUrl, dropX, dropY)
      }
    }
  }

  // Drag-and-drop trace creation
  const handleDragOver = (e: React.DragEvent) => {
    // Ignore the Layer panel's internal trace-reorder and group-reorder
    // drags -- their events bubble here through any gap in the panel without
    // its own drop-target handler, which used to flash the "drop file to
    // create trace" overlay while the user was just reordering.
    if (isInternalDrag(e)) return
    if (!canEdit) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (isInternalDrag(e)) return
    // Only hide overlay when actually leaving the container
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    if (isInternalDrag(e)) {
      // Clear it here as well as returning. An internal drop that ends inside
      // a panel calls stopPropagation, so this handler may never fire at all
      // -- but when it does, leaving the overlay up is what stranded it.
      setIsDragOver(false)
      return
    }
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!canEditRef.current) return
    if (!worldContainerRef.current) return

    if (!ensureLobbyHasSpace()) return

    const { x: worldX, y: worldY } = getWorldPositionFromScreen(e.clientX, e.clientY)

    const droppedFiles = Array.from(e.dataTransfer.files)

    // A dropped PDF opens the Create Trace panel on the PDF type with the
    // file already loaded, rather than being uploaded as an opaque
    // attachment. The whole point of the type is choosing how to place it --
    // as pages or as a paged viewer -- and that decision can't be made for
    // the user. Desktop only, matching where the type exists at all.
    const droppedPdfs = isDesktop
      ? droppedFiles.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      : []
    if (droppedPdfs.length > 0) {
      setClickedTracePosition({ x: worldX, y: worldY })
      setTracePanelInitialType('document')
      setTracePanelInitialShapeType(undefined)
      setPendingPdfFile(droppedPdfs[0])
      setShowTracePanel(true)
      // Only the first is opened. Every PDF needs its own answer to "as pages
      // or as a viewer, and in what grid", and there's no sensible way to ask
      // that once for a batch -- but silently dropping the rest looked like
      // they'd failed to register.
      if (droppedPdfs.length > 1) {
        showToast(`Opening ${droppedPdfs[0].name} — PDFs are placed one at a time`)
      }
      return
    }

    const processDroppedFiles = () => placeFilesAsTraces(droppedFiles, worldX, worldY)

    // Anything dragged straight off a webpage (an <img>, a link, a URL) is a
    // reference to content we don't own -- it always becomes an embed, never
    // an internal image/audio/video trace, regardless of platform. Only a
    // real local file (below) gets uploaded and converted.
    const htmlImagePayload = extractImageUrlFromHtml(e.dataTransfer.getData('text/html') || '')
    if (htmlImagePayload) {
      await insertDroppedTrace('embed', htmlImagePayload.url, htmlImagePayload.url, worldX, worldY)
      return
    }

    const downloadUrlPayload = getDroppedUrlPayload(e.dataTransfer.getData('DownloadURL') || '')
    if (downloadUrlPayload) {
      await insertDroppedTrace('embed', downloadUrlPayload.url, downloadUrlPayload.url, worldX, worldY)
      return
    }

    const urlPayload = getDroppedUrlPayload(
      e.dataTransfer.getData('text/uri-list')
      || e.dataTransfer.getData('text/plain')
      // Firefox's own flavour, and some Chromium forks offer it too. Cheap to
      // read, and it carries a clean URL when the standard types are absent.
      || e.dataTransfer.getData('text/x-moz-url')
      || ''
    )
    if (urlPayload) {
      await insertDroppedTrace('embed', urlPayload.url, urlPayload.url, worldX, worldY)
      return
    }

    // Real files from the OS filesystem -- desktop only. The web app can't
    // upload/convert local files into internal image/audio/video traces yet.
    if (droppedFiles.length > 0) {
      if (!isDesktop) {
        setShowLocalFileBlockedDialog(true)
        return
      }
      await processDroppedFiles()
      return
    }

    // Nothing standard arrived, so dig through whatever private formats the
    // page attached to the drag. See scavengeUrlFromDataTransfer -- this is how
    // a Pinterest image dragged out of Brave gets in.
    const scavenged = scavengeUrlFromDataTransfer(e.dataTransfer)
    if (scavenged) {
      await insertDroppedTrace('embed', scavenged.url, scavenged.url, worldX, worldY)
      return
    }

    // Nothing usable arrived. Reaching here means the drop registered but
    // carried no URL, no HTML and no file -- which is what a drag out of some
    // browsers looks like, since what a browser offers to another application
    // is entirely up to it and varies by browser and by page.
    //
    // Reported rather than ignored: silently doing nothing is
    // indistinguishable from the app being broken, and naming the formats that
    // did arrive turns "it doesn't work in this browser" into something
    // diagnosable without a debugger on the affected machine.
    const offered = Array.from(e.dataTransfer.types || [])
    showToast(
      offered.length > 0
        ? `Nothing droppable in that (${offered.join(', ')})`
        : 'That drag carried no data — try dragging the image from its own page, or paste the link instead',
    )
  }

  useEffect(() => {
    if (!isDesktop) return

    const handlePaste = async (e: ClipboardEvent) => {
      if (e.defaultPrevented || isEditableTarget(e.target)) return
      if (!canEditRef.current) return

      const imageFiles = Array.from(e.clipboardData?.items ?? [])
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null)

      if (imageFiles.length === 0) return

      e.preventDefault()

      if (!ensureLobbyHasSpace()) return

      const pasteAnchor = lastMouseScreenPositionRef.current ?? {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }
      const { x: baseX, y: baseY } = getWorldPositionFromScreen(pasteAnchor.x, pasteAnchor.y)

      // Bin-pack the pasted batch around the paste point instead of
      // cascading diagonally -- same approach as the multi-file drop handler.
      const sizes = await Promise.all(imageFiles.map(f => probeImageFileDimensions(f)))
      const offsets = packBoxesAroundCenter(sizes.map(s => s ? scaleToDisplayBox(s) : getDefaultTraceBoxSize('image')), 24, packingShapeRef.current)

      for (let i = 0; i < imageFiles.length; i++) {
        const uploadedUrl = await uploadFile(imageFiles[i])
        if (uploadedUrl) {
          await insertDroppedTrace('image', imageFiles[i].name || 'pasted image', uploadedUrl, baseX + offsets[i].x, baseY + offsets[i].y)
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [lobbyId, userId, username])

  const uploadFile = async (file: File): Promise<string | undefined> => {
    const fileExt = inferFileExtension(file)
    const fileName = `${userId}_${Date.now()}.${fileExt}`
    const storagePath = `${lobbyId}/${fileName}`

    if (isDesktop && supabase) {
      // Desktop: create blob URL instantly, write to disk in background for persistence
      const blobUrl = URL.createObjectURL(file)
      const localUrl = `local://traces/${storagePath}`
      // Pre-seed cache so TraceOverlay resolves instantly
      import('../lib/localDb').then(m => m.preCacheLocalUrl(localUrl, blobUrl))
      // Write to local storage for persistence (fire-and-forget)
      supabase.storage.from('traces').upload(storagePath, file)
      return localUrl
    }

    if (supabase) {
      const { error } = await supabase.storage.from('traces').upload(fileName, file)
      if (!error) {
        const { data: { publicUrl } } = supabase.storage.from('traces').getPublicUrl(fileName)
        return publicUrl
      }
    }
    // Fallback to data URL
    return new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(file)
    })
  }

  const insertDroppedTrace = async (
    traceType: string,
    content: string,
    mediaUrl: string | undefined,
    x: number,
    y: number,
  ) => {
    if (supabase) {
      // Read the live store (not the render-time `traces` closure) so a
      // multi-file/URL drop loop -- which addTrace's each inserted row back
      // synchronously -- keeps computing a fresh, higher ungrouped z-index
      // per item instead of colliding them all at the same value.
      const liveTraces = useGameStore.getState().traces
      const layerFields = activeLayerId
        ? {
            layer_id: activeLayerId,
            z_index: await computeZIndexForNewTraceInLayer(
              activeLayerId,
              liveTraces.filter(t => t.layerId === activeLayerId).length
            ),
          }
        : { z_index: computeZIndexForNewUngroupedTrace(liveTraces) }

      const { data, error } = await supabase.from('traces').insert({
        user_id: userId,
        username,
        type: traceType,
        content,
        position_x: x,
        position_y: y,
        media_url: mediaUrl || null,
        scale: 1.0,
        rotation: 0.0,
        lobby_id: lobbyId,
        show_description: false,
        show_filename: false,
        ...layerFields,
      } as any).select()

      if (error) {
        console.error('Drop trace insert error:', error)
        return
      }
      if (data && data[0]) {
        // Same mapper the initial load/realtime paths use, so a freshly
        // dropped trace gets the full field set (showBorder/showBackground/
        // cropWidth/illuminate/etc.) instead of only ~15 of ~45 fields.
        useGameStore.getState().addTrace(mapRowToTrace(data[0]))
      }
    } else {
      const trace: Trace = {
        id: `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        username,
        type: traceType as any,
        content,
        x,
        y,
        mediaUrl,
        createdAt: new Date().toISOString(),
        scale: 1.0,
        scaleX: 1.0,
        scaleY: 1.0,
        rotation: 0.0,
      }
      useGameStore.getState().addTrace(trace)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-nier-black lobby-scene"
      style={{ touchAction: 'none' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Canvas Container with Overlay - Full Viewport */}
      <div className="w-full h-full relative">
        {/* Pixi Canvas */}
        <div ref={canvasRef} className="absolute inset-0" />
        
        {/* Trace Content Overlay */}
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          <TraceOverlay
            traces={traces}
            lobbyWidth={window.innerWidth}
            lobbyHeight={window.innerHeight}
            zoom={zoom}
            worldOffset={worldOffset}
            onEdgePan={panCameraBy}
            lobbyId={lobbyId}
            selectedTraceId={selectedTraceId}
            setSelectedTraceId={setSelectedTraceId}
            multiSelectRequest={multiSelectRequest}
            newPathRequest={newPathTraceId}
            isDrawingMode={isDrawingMode}
            onMultiSelectionChange={setMultiSelectedTraceIds}
            canEdit={canEdit}
          />
        </div>

        {/* Shift+drag area-selection rectangle -- position/size mutated
            directly on mousemove (see handleMouseMove), not React state.
            Rendered unconditionally (not just while isDrawingMode) since
            area-select is a normal-mode canvas interaction. z-index has to
            clear TraceOverlay's own scale (traces/handles run up into the
            millions -- see TraceOverlay.tsx), since this needs to stay
            visible while dragging directly over traces. */}
        <div
          ref={areaSelectRectRef}
          className="fixed border border-dashed border-white/70 bg-white/10 pointer-events-none"
          style={{ display: 'none', zIndex: 1_500_000 }}
        />

        {/* Drop Zone Indicator */}
        {isDragOver && (
          <div className="absolute inset-0 z-[9998] pointer-events-none flex items-center justify-center"
               style={{ backgroundColor: 'rgba(203, 203, 203, 0.08)', border: '2px dashed rgba(143, 143, 143, 0.5)' }}>
            <div className="bg-black/80 border border-nier-border px-6 py-3">
              <p className="text-nier-bg text-sm tracking-[0.15em] uppercase font-mono">
                {isDesktop ? 'DROP FILE TO CREATE TRACE' : 'DROP LINK TO CREATE TRACE'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Saving indicator -- tracks the shared isSavingChanges store flag, so
          it shows for autosave, Ctrl+S, and the manual Save Changes button alike */}
      {isAutosaving && (
        <div className="fixed top-4 right-4 z-[9999] font-mono pointer-events-none">
          <p
            className="text-white text-base tracking-[0.2em] uppercase animate-saving-fade"
            style={{ textShadow: HUD_TEXT_OUTLINE }}
          >
            ◇ Saving...
          </p>
        </div>
      )}

      {/* HUD + presentation quick-toggle, in one top-left row so the toggle
          always sits just to the right of the HUD regardless of its width. */}
      <div className="fixed top-4 left-4 z-[9999] flex items-start gap-2 pointer-events-none">
      <div ref={hudRef} data-ui-element="true" className="relative bg-black px-3 py-2 border-2 border-white font-mono pointer-events-auto" style={{ backgroundColor: 'rgba(0,0,0,0.9)', maxWidth: '160px' }}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white"></div>
        
        {/* Header with username, online count, and minimize toggle */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-white text-[10px] tracking-[0.1em] uppercase font-bold truncate">
            {username}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowOnlineUsersList(!showOnlineUsersList)}
              className="flex items-center gap-1 hover:bg-white/10 px-1 py-0.5 -mx-1 transition-colors"
              title="Show online users"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-green-400 text-[8px]">{onlinePlayerCount}</span>
            </button>
            <button
              onClick={() => setHudMinimized(!hudMinimized)}
              className="text-gray-500 hover:text-white text-[14px] transition-colors leading-none px-0.5"
              title={hudMinimized ? 'Expand' : 'Minimize'}
            >
              {hudMinimized ? '▸' : '▾'}
            </button>
          </div>
        </div>

        {/* Online users list */}
        {showOnlineUsersList && (
          <div
            data-ui-element="true"
            className="absolute left-0 top-full mt-1 w-64 bg-black border-2 border-white z-[10000] font-mono"
            style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}
          >
            <div className="p-2 space-y-1.5 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between gap-2">
                <span className="text-white text-[10px] tracking-wide truncate">{username} (you)</span>
                <span className="text-gray-500 text-[9px] flex-shrink-0">{formatTimeInAtrium(getJoinedAt())}</span>
              </div>
              {Object.values(otherUsers).map(user => (
                <div key={user.userId} className="flex items-center justify-between gap-2">
                  <span className="text-gray-300 text-[10px] tracking-wide truncate">{user.username}</span>
                  <span className="text-gray-500 text-[9px] flex-shrink-0">{formatTimeInAtrium(user.joinedAt)}</span>
                  {(isLobbyOwner || isLobbyAdmin) && user.userId !== currentLobby?.ownerUserId && (
                    <button
                      onClick={() => setKickTarget({ userId: user.userId, username: user.username })}
                      className="text-red-500 hover:text-red-400 text-[9px] tracking-wider uppercase transition-colors flex-shrink-0"
                    >
                      Kick
                    </button>
                  )}
                </div>
              ))}
              {Object.keys(otherUsers).length === 0 && (
                <p className="text-gray-600 text-[9px] tracking-wide">No one else is here</p>
              )}
            </div>
          </div>
        )}
        {!hudMinimized && (
          <>
        {currentLobby && (
          <p className="text-gray-300 text-[8px] tracking-wider truncate">
            {currentLobby.name} {isLobbyOwner && '(Owner)'}{!isLobbyOwner && isLobbyAdmin && '(Admin)'}
          </p>
        )}
        <p className="text-gray-500 text-[8px] tracking-wider">
          ({Math.round(position.x)}, {Math.round(position.y)}) • {zoomRef.current.toFixed(2)}x
        </p>
        {hasPendingChanges() && (
          <button
            onClick={() => saveAllChanges()}
            disabled={isSavingChanges}
            className={`w-full mt-1.5 border px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all ${
              isSavingChanges
                ? 'bg-gray-800 border-gray-600 text-gray-500 cursor-not-allowed'
                : 'bg-gray-800 border-gray-600 hover:border-white text-white'
            }`}
          >
            {isSavingChanges ? 'Saving…' : `Save Changes (${pendingChanges.size + deletedTraces.size})`}
          </button>
        )}
        {hasPendingChanges() && (
          showDiscardConfirm ? (
            <div className="w-full mt-1 flex gap-1">
              <button
                onClick={async () => {
                  setIsDiscarding(true)
                  await discardAllChanges(lobbyId)
                  setIsDiscarding(false)
                  setShowDiscardConfirm(false)
                }}
                disabled={isDiscarding || isSavingChanges}
                className="flex-1 border px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all bg-red-900/40 border-red-500/60 hover:border-red-400 text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Revert all unsaved changes to the last saved state"
              >
                {isDiscarding ? 'Discarding…' : 'Confirm Discard'}
              </button>
              <button
                onClick={() => setShowDiscardConfirm(false)}
                disabled={isDiscarding}
                className="flex-1 border px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all bg-gray-800 border-gray-600 hover:border-white text-white disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowDiscardConfirm(true)}
              disabled={isSavingChanges}
              className="w-full mt-1 border px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all bg-gray-800 border-gray-600 hover:border-red-400 text-gray-300 hover:text-red-300 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Revert all unsaved changes to the last saved state"
            >
              Don't Save
            </button>
          )
        )}
        <div className="flex gap-1 mt-1.5">
          <button
            onClick={() => {
              if (useGameStore.getState().hasPendingChanges()) {
                setShowLeaveDialog(true)
              } else {
                onLeaveLobby()
              }
            }}
            className="flex-1 bg-red-900 hover:bg-red-700 text-white px-1 py-0.5 text-[8px] tracking-wider uppercase transition-all"
          >
            Leave
          </button>
          {(isLobbyOwner || isLobbyAdmin) && currentLobby && (
            <button
              onClick={() => setShowLobbyManagement(true)}
              className="flex-1 bg-white hover:bg-gray-200 text-black px-1 py-0.5 text-[8px] tracking-wider uppercase transition-all"
            >
              Manage
            </button>
          )}
        </div>
        {currentLobby && (
          <button
            onClick={() => copyLobbyId(currentLobby.id)}
            className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
          >
            Copy ID
          </button>
        )}
        {isDesktop && (
          <button
            onClick={handleConvertAllEmbeds}
            disabled={isConvertingEmbeds}
            className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Convert every embed trace in this atrium into an internal image"
          >
            {isConvertingEmbeds ? convertEmbedsProgress || 'Converting...' : 'Convert Embeds to Images'}
          </button>
        )}
        {!isDesktop && canEdit && pinterestConnected && (
          <button
            onClick={() => { setPinterestImportAnchor(null); setShowPinterestImport(true) }}
            className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
            title="Import a Pinterest board's pins as traces"
          >
            Import from Pinterest
          </button>
        )}
        <button
          onClick={() => setShowProfileCustomization(true)}
          className="w-full mt-1 bg-gray-700 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
        >
          Profile
        </button>
        <button
          onClick={() => {
            // Reset camera to center of map
            cameraPositionRef.current = { x: 0, y: 0 }
            worldOffsetRef.current = { x: 0, y: 0 }
            setWorldOffset({ x: 0, y: 0 })
          }}
          className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
        >
          Recenter
        </button>
        <button
          onClick={toggleFullscreen}
          className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
        >
          {isFullscreen ? 'Windowed' : 'Fullscreen'}
        </button>
        {(isLobbyOwner || isLobbyAdmin) && (
          <button
            onClick={() => setShowThemeCustomization(true)}
            className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
          >
            Theme
          </button>
        )}
        <button
          onClick={() => setShowReportForm(true)}
          className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
        >
          Report a Problem
        </button>
          </>
        )}
      </div>

      {/* Presentation quick-toggle -- only shown when locations exist. A fixed
          square matching the HUD header's height (so it stays that size even
          when the HUD is expanded), collapsed to just the centered play icon;
          reveals the "Present" label on hover (where it may grow past square).
          Green while presentation mode is active. */}
      {workingLocations.length > 0 && (
        <button
          onClick={togglePresentationMode}
          className={`group pointer-events-auto h-9 w-9 hover:w-auto hover:px-3 border-2 font-mono text-[10px] tracking-[0.15em] uppercase transition-colors shadow-lg flex items-center justify-center ${
            presentationMode
              ? 'bg-emerald-500 border-emerald-400 text-black'
              : 'bg-black/90 border-white text-white hover:bg-gray-800'
          }`}
          title={presentationMode ? 'Presentation mode on — ← / → to navigate. Click to exit.' : 'Start presentation mode'}
        >
          <span className="text-[12px] leading-none">▶</span>
          <span className="hidden group-hover:inline ml-1.5 whitespace-nowrap leading-none">Present</span>
        </button>
      )}
      </div>

      {/* Atrium size indicator - bottom center */}
      {(() => {
        const sizeBytes = useGameStore.getState().getLobbySizeBytes()
        const sizeMB = sizeBytes / (1024 * 1024)
        const limitMB = LOBBY_SIZE_LIMIT / (1024 * 1024)
        const pct = isDesktop ? 0 : Math.min((sizeBytes / LOBBY_SIZE_LIMIT) * 100, 100)
        const isFull = !isDesktop && sizeBytes >= LOBBY_SIZE_LIMIT
        return (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none flex flex-col items-center gap-1">
            {/* Only the operator sees this, and only when actually hidden.
                Without it there's no way to tell this atrium is being viewed
                invisibly, which is exactly the state where acting as though
                others can see you would be a mistake. */}
            {isGhostEntry && (
              <p
                className="text-[9px] font-mono tracking-[0.12em] uppercase"
                style={{ color: '#A78BFA', textShadow: HUD_TEXT_OUTLINE }}
              >
                ◇ Hidden — You are not visible to anyone in this atrium
              </p>
            )}
            {!canEdit && (
              <p
                className="text-[9px] font-mono tracking-[0.12em] uppercase"
                style={{ color: '#FF6161', textShadow: HUD_TEXT_OUTLINE }}
              >
                ◇ View Only — You don't have permission to edit this atrium
              </p>
            )}
            {multiSelectedTraceIds.length > 1 && (
              <p
                className="text-green-400 text-[9px] font-mono tracking-[0.12em] uppercase"
                style={{ textShadow: HUD_TEXT_OUTLINE }}
              >
                {multiSelectedTraceIds.length} traces selected
              </p>
            )}
            <div className="pointer-events-auto flex items-center gap-2 bg-black/90 border border-gray-600 px-3 py-2" title={isDesktop ? `${sizeMB.toFixed(2)}MB used` : `${sizeMB.toFixed(2)}MB / ${limitMB}MB used`}>
              <span className={`text-[9px] font-mono tracking-[0.12em] uppercase ${isFull ? 'text-red-400' : 'text-gray-400'}`}>
                Usage
              </span>
              {!isDesktop && (
              <div className="w-20 h-2 bg-gray-800 border border-gray-700 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-white/50'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              )}
              <span className={`text-[9px] font-mono tracking-wider ${isFull ? 'text-red-400' : pct >= 80 ? 'text-yellow-400' : 'text-gray-500'}`}>
                {sizeMB.toFixed(1)}{isDesktop ? 'MB' : `/${limitMB}MB`}
              </span>
            </div>
          </div>
        )
      })()}

      {showReportForm && (
        <ReportFeedbackModal
          onClose={() => setShowReportForm(false)}
          username={username}
          atriumName={currentLobby?.name ?? lobbyId}
        />
      )}

      {/* Trace Button -- hidden entirely when the atrium's edit permission
          mode doesn't allow this user to create traces */}
      {canEdit && (() => {
        const isFull = useGameStore.getState().isLobbyFull()
        return (
      <button
        onClick={() => {
          // Open trace panel at current player position
          setClickedTracePosition({ x: positionRef.current.x, y: positionRef.current.y })
          setShowTracePanel(!showTracePanel)
        }}
        className={`fixed bottom-4 right-4 ${isFull ? 'bg-red-200 hover:bg-red-100 border-red-400' : 'bg-white hover:bg-gray-200 border-gray-400'} text-black px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 pointer-events-auto`}
      >
        <span className="opacity-60 mr-2">◇</span>
        {isFull ? 'Atrium Full' : showTracePanel ? 'Close' : 'Leave Trace'}
      </button>
        )
      })()}

      {/* Layers Button */}
      <button
        onClick={() => setShowLayerPanel(!showLayerPanel)}
        className="fixed bottom-36 right-4 bg-gray-800 hover:bg-gray-700 text-white px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 border-gray-500 pointer-events-auto"
      >
        <span className="opacity-60 mr-2">◇</span>
        {showLayerPanel ? 'Close' : 'Layers'}
      </button>

      {/* Locations Button -- directly below Layers (both open panels);
          visible to everyone (viewing/presenting saved camera views doesn't
          require edit permission; the panel hides its mutating controls when
          canEdit is false) */}
      <button
        onClick={() => setShowLocationsPanel(!showLocationsPanel)}
        className="fixed bottom-20 right-4 bg-gray-800 hover:bg-gray-700 text-white px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 border-gray-500 pointer-events-auto"
      >
        <span className="opacity-60 mr-2">◇</span>
        {showLocationsPanel ? 'Close' : 'Locations'}
      </button>

      {/* Draw Button */}
      {canEdit && (
      <button
        onClick={() => {
          if (isDrawingMode) {
            setCompletedStrokes([])
            currentStrokeRef.current = []
            setIsEraserMode(false)
          }
          setIsDrawingMode(!isDrawingMode)
        }}
        className={`fixed bottom-52 right-4 ${isDrawingMode ? 'bg-white text-black border-white' : 'bg-gray-800 hover:bg-gray-700 text-white border-gray-500'} px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 pointer-events-auto`}
      >
        <span className="opacity-60 mr-2">✎</span>
        {isDrawingMode ? 'Exit Draw' : 'Draw'}
      </button>
      )}

      {/* Drawing Mode Overlay */}
      {isDrawingMode && (
        <>
          {/* Drawing controls panel */}
          <div
            data-ui-element="true"
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] font-mono pointer-events-auto"
            style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}
          >
            <div className="relative border-2 border-white px-6 py-3">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-white" />
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-white" />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white" />

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <p className="text-white text-[10px] tracking-[0.15em] uppercase">Freehand Draw</p>
                  <button
                    onClick={() => setDrawControlsMinimized(!drawControlsMinimized)}
                    className="text-gray-500 hover:text-white text-[14px] transition-colors leading-none px-0.5"
                    title={drawControlsMinimized ? 'Expand controls' : 'Minimize controls'}
                  >
                    {drawControlsMinimized ? '▸' : '▾'}
                  </button>
                </div>

                {!drawControlsMinimized && (<>

                {/* Draw / Eraser toggle */}
                <div className="flex border border-gray-600">
                  <button
                    onClick={() => setIsEraserMode(false)}
                    className={`px-3 py-1 text-[9px] tracking-wider uppercase transition-all ${!isEraserMode ? 'bg-white text-black' : 'bg-transparent text-gray-400 hover:text-white'}`}
                  >
                    ✎ Brush
                  </button>
                  <button
                    onClick={() => setIsEraserMode(true)}
                    className={`px-3 py-1 text-[9px] tracking-wider uppercase transition-all ${isEraserMode ? 'bg-white text-black' : 'bg-transparent text-gray-400 hover:text-white'}`}
                  >
                    ◻ Eraser
                  </button>
                </div>

                {/* Color picker - only shown in brush mode */}
                {!isEraserMode && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 text-[8px] tracking-wider uppercase">Color</span>
                    <input
                      type="color"
                      value={drawingColor}
                      onChange={(e) => setDrawingColor(e.target.value)}
                      className="w-6 h-6 cursor-pointer bg-transparent border border-gray-600"
                    />
                  </div>
                )}

                {/* Stroke width */}
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-[8px] tracking-wider uppercase">{isEraserMode ? 'Size' : 'Width'}</span>
                  <input
                    type="range"
                    min="1"
                    max={isEraserMode ? '60' : '20'}
                    value={drawingWidth}
                    onChange={(e) => setDrawingWidth(Number(e.target.value))}
                    className="w-16 h-1 cursor-pointer accent-white"
                  />
                  <span className="text-gray-300 text-[9px] w-4">{drawingWidth}</span>
                </div>

                {/* Smoothing */}
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-[8px] tracking-wider uppercase">Smooth</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={drawingSmoothing}
                    onChange={(e) => setDrawingSmoothing(Number(e.target.value))}
                    className="w-16 h-1 cursor-pointer accent-white"
                  />
                  <span className="text-gray-300 text-[9px] w-4">{drawingSmoothing}%</span>
                </div>

                {/* Quick colors - only in brush mode */}
                {!isEraserMode && (
                  <div className="flex gap-1">
                    {['#ffffff', '#ff4444', '#44ff44', '#4488ff', '#ffff44', '#ff44ff', '#44ffff'].map(color => (
                      <button
                        key={color}
                        onClick={() => setDrawingColor(color)}
                        className={`w-4 h-4 border ${drawingColor === color ? 'border-white scale-125' : 'border-gray-600'} transition-all`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}

                {/* Undo last stroke */}
                {completedStrokes.length > 0 && (
                  <button
                    onClick={() => setCompletedStrokes(prev => prev.slice(0, -1))}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all border border-gray-500"
                  >
                    Undo
                  </button>
                )}

                {/* Clear all strokes */}
                {completedStrokes.length > 0 && (
                  <button
                    onClick={() => {
                      setCompletedStrokes([])
                      currentStrokeRef.current = []
                    }}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all border border-gray-500"
                  >
                    Clear
                  </button>
                )}

                {/* Print (save as image) button */}
                {completedStrokes.length > 0 && (
                  <button
                    disabled={isSavingDrawing}
                    onClick={async () => {
                      setIsSavingDrawing(true)
                      try {
                        // Render all strokes to find tight bounding box
                        const allPoints = completedStrokes.flatMap(s => s.points)
                        if (allPoints.length === 0) return

                        const padding = 20
                        const minSX = Math.min(...allPoints.map(p => p.x)) - padding
                        const maxSX = Math.max(...allPoints.map(p => p.x)) + padding
                        const minSY = Math.min(...allPoints.map(p => p.y)) - padding
                        const maxSY = Math.max(...allPoints.map(p => p.y)) + padding
                        const cropW = Math.max(1, maxSX - minSX)
                        const cropH = Math.max(1, maxSY - minSY)

                        // Create offscreen canvas sized to the bounding box
                        const offscreen = document.createElement('canvas')
                        offscreen.width = Math.ceil(cropW)
                        offscreen.height = Math.ceil(cropH)
                        const offCtx = offscreen.getContext('2d')!

                        // Draw strokes shifted so bounding box starts at (0,0)
                        for (const stroke of completedStrokes) {
                          const shifted = stroke.points.map(p => ({ x: p.x - minSX, y: p.y - minSY }))
                          drawBezierStroke(offCtx, shifted, stroke.color, stroke.width, stroke.isEraser)
                        }

                        // Export as PNG blob and upload to Supabase Storage
                        const blob = await new Promise<Blob>((resolve) => {
                          offscreen.toBlob((b) => resolve(b!), 'image/png')
                        })
                        const fileName = `drawing_${userId}_${Date.now()}.png`
                        const storagePath = `${lobbyId}/${fileName}`
                        
                        let imageUrl = ''
                        const { error: uploadError } = await supabase!.storage
                          .from('traces')
                          .upload(storagePath, blob, { contentType: 'image/png' })
                        
                        if (uploadError) {
                          console.error('Storage upload failed, falling back to data URL:', uploadError)
                          imageUrl = offscreen.toDataURL('image/png')
                        } else {
                          const { data: { publicUrl } } = supabase!.storage
                            .from('traces')
                            .getPublicUrl(storagePath)
                          imageUrl = publicUrl
                        }

                        // Convert screen-space bounds to world coordinates
                        const panX = worldContainerRef.current?.x ?? 0
                        const panY = worldContainerRef.current?.y ?? 0
                        const zoom = zoomRef.current
                        const worldMinX = (minSX - panX) / zoom
                        const worldMinY = (minSY - panY) / zoom
                        const worldW = cropW / zoom
                        const worldH = cropH / zoom
                        const worldCenterX = worldMinX + worldW / 2
                        const worldCenterY = worldMinY + worldH / 2

                        if (supabase) {
                          // Check lobby size limit before saving drawing
                          if (useGameStore.getState().isLobbyFull()) {
                            const sizeMB = (useGameStore.getState().getLobbySizeBytes() / (1024 * 1024)).toFixed(1)
                            alert(`This atrium has reached its ${(LOBBY_SIZE_LIMIT / (1024 * 1024)).toFixed(0)}MB size limit (currently ${sizeMB}MB). Delete some traces to free up space.`)
                            setIsSavingDrawing(false)
                            return
                          }
                          const layerFields = activeLayerId
                            ? {
                                layer_id: activeLayerId,
                                z_index: await computeZIndexForNewTraceInLayer(
                                  activeLayerId,
                                  traces.filter(t => t.layerId === activeLayerId).length
                                ),
                              }
                            : {}

                          const { data, error } = await supabase.from('traces').insert({
                            user_id: userId,
                            username,
                            type: 'image',
                            content: 'freehand drawing',
                            media_url: imageUrl,
                            position_x: worldCenterX,
                            position_y: worldCenterY,
                            scale: 1.0,
                            rotation: 0.0,
                            lobby_id: lobbyId,
                            width: Math.round(worldW),
                            height: Math.round(worldH),
                            show_border: false,
                            show_background: false,
                            show_description: false,
                            show_filename: false,
                            ...layerFields,
                          } as any).select()

                          if (!error && data && data[0]) {
                            const dbTrace = data[0] as any
                            const trace: Trace = {
                              id: dbTrace.id,
                              userId: dbTrace.user_id,
                              username: dbTrace.username,
                              type: dbTrace.type,
                              content: dbTrace.content,
                              x: dbTrace.position_x,
                              y: dbTrace.position_y,
                              createdAt: dbTrace.created_at,
                              scale: dbTrace.scale ?? 1.0,
                              scaleX: dbTrace.scale ?? 1.0,
                              scaleY: dbTrace.scale ?? 1.0,
                              rotation: dbTrace.rotation ?? 0.0,
                              width: dbTrace.width,
                              height: dbTrace.height,
                              mediaUrl: dbTrace.media_url,
                              showBorder: false,
                              showBackground: false,
                              showDescription: false,
                              lobbyId: dbTrace.lobby_id,
                            }
                            useGameStore.getState().addTrace(trace)
                          } else if (error) {
                            console.error('Failed to save drawing:', error)
                          }
                        }
                      } catch (err) {
                        console.error('Error saving drawing:', err)
                      }
                      setIsSavingDrawing(false)
                      setCompletedStrokes([])
                      currentStrokeRef.current = []
                    }}
                    className="bg-white hover:bg-gray-200 text-black px-4 py-1 text-[9px] tracking-wider uppercase transition-all border border-white font-bold"
                  >
                    {isSavingDrawing ? '...' : `⎙ Print (${completedStrokes.length})`}
                  </button>
                )}

                <button
                  onClick={() => {
                    setIsDrawingMode(false)
                    setCompletedStrokes([])
                    currentStrokeRef.current = []
                    setIsEraserMode(false)
                  }}
                  className="ml-2 bg-red-900 hover:bg-red-700 text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all border border-red-600"
                >
                  Exit
                </button>
                </>)}

                {drawControlsMinimized && (
                  <button
                    onClick={() => {
                      setIsDrawingMode(false)
                      setCompletedStrokes([])
                      currentStrokeRef.current = []
                      setIsEraserMode(false)
                    }}
                    className="ml-2 bg-red-900 hover:bg-red-700 text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all border border-red-600"
                  >
                    Exit
                  </button>
                )}
              </div>
              {!drawControlsMinimized && (
                <p className="text-gray-500 text-[8px] tracking-wider mt-1 text-center">Click and drag to draw • E to toggle eraser • "Print" saves as image</p>
              )}
            </div>
          </div>

          {/* Brush/eraser size-preview circle - follows the cursor, sized to drawingWidth */}
          <div
            ref={brushCursorRef}
            className="fixed rounded-full pointer-events-none z-[9999]"
            style={{
              width: `${drawingWidth}px`,
              height: `${drawingWidth}px`,
              border: `1px solid ${isEraserMode ? 'rgba(200,200,200,0.9)' : drawingColor}`,
              borderStyle: isEraserMode ? 'dashed' : 'solid',
              transform: 'translate(-50%, -50%)',
              display: 'none',
            }}
          />

          {/* Drawing canvas overlay - below UI buttons, above traces */}
          <canvas
            ref={drawingCanvasRef}
            className="fixed inset-0 z-[9998]"
            style={{
              cursor: 'none',
              width: '100vw',
              height: '100vh',
            }}
            onMouseEnter={() => {
              if (brushCursorRef.current) brushCursorRef.current.style.display = 'block'
            }}
            onMouseLeave={() => {
              if (brushCursorRef.current) brushCursorRef.current.style.display = 'none'
            }}
            onMouseDown={(e) => {
              if (e.button === 0) {
                e.preventDefault()
                e.stopPropagation()
                const point = { x: e.clientX, y: e.clientY }
                currentStrokeRef.current = [point]
                smoothedPointRef.current = { ...point }
                setIsDrawing(true)
                renderDrawingCanvas()
              } else if (e.button === 2) {
                e.preventDefault()
                currentStrokeRef.current = []
                smoothedPointRef.current = null
                setIsDrawing(false)
                renderDrawingCanvas()
              }
            }}
            onMouseMove={(e) => {
              if (brushCursorRef.current) {
                brushCursorRef.current.style.left = `${e.clientX}px`
                brushCursorRef.current.style.top = `${e.clientY}px`
              }
              if (isDrawing) {
                const raw = { x: e.clientX, y: e.clientY }
                // Cap below 1.0 -- at exactly 100% alpha becomes 0 and the
                // smoothed point never moves from its starting position,
                // turning the stroke into a pile of coincident points.
                const smoothing = computeSmoothingFactor(drawingSmoothingRef.current)
                if (smoothing > 0 && smoothedPointRef.current) {
                  // Exponential moving average: lerp from smoothed toward raw
                  const alpha = 1 - smoothing
                  const sx = smoothedPointRef.current.x + (raw.x - smoothedPointRef.current.x) * alpha
                  const sy = smoothedPointRef.current.y + (raw.y - smoothedPointRef.current.y) * alpha
                  smoothedPointRef.current = { x: sx, y: sy }
                  currentStrokeRef.current.push({ x: sx, y: sy })
                } else {
                  smoothedPointRef.current = { ...raw }
                  currentStrokeRef.current.push(raw)
                }
                renderDrawingCanvas()
              }
            }}
            onMouseUp={(e) => {
              if (e.button === 0 && isDrawing) {
                setIsDrawing(false)
                const rawPoints = currentStrokeRef.current
                if (rawPoints.length >= 1) {
                  setCompletedStrokes(prev => [...prev, {
                    points: [...rawPoints],
                    color: drawingColorRef.current,
                    width: drawingWidthRef.current,
                    isEraser: isEraserModeRef.current,
                  }])
                }
                currentStrokeRef.current = []
              }
            }}
            onWheel={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            onTouchStart={(e) => {
              if (e.touches.length === 1) {
                e.preventDefault()
                e.stopPropagation()
                const touch = e.touches[0]
                const point = { x: touch.clientX, y: touch.clientY }
                currentStrokeRef.current = [point]
                smoothedPointRef.current = { ...point }
                setIsDrawing(true)
                renderDrawingCanvas()
              }
            }}
            onTouchMove={(e) => {
              if (isDrawing && e.touches.length === 1) {
                e.preventDefault()
                const touch = e.touches[0]
                const raw = { x: touch.clientX, y: touch.clientY }
                const smoothing = computeSmoothingFactor(drawingSmoothingRef.current)
                if (smoothing > 0 && smoothedPointRef.current) {
                  const alpha = 1 - smoothing
                  const sx = smoothedPointRef.current.x + (raw.x - smoothedPointRef.current.x) * alpha
                  const sy = smoothedPointRef.current.y + (raw.y - smoothedPointRef.current.y) * alpha
                  smoothedPointRef.current = { x: sx, y: sy }
                  currentStrokeRef.current.push({ x: sx, y: sy })
                } else {
                  smoothedPointRef.current = { ...raw }
                  currentStrokeRef.current.push(raw)
                }
                renderDrawingCanvas()
              }
            }}
            onTouchEnd={(e) => {
              if (isDrawing) {
                e.preventDefault()
                setIsDrawing(false)
                const rawPoints = currentStrokeRef.current
                if (rawPoints.length >= 1) {
                  setCompletedStrokes(prev => [...prev, {
                    points: [...rawPoints],
                    color: drawingColorRef.current,
                    width: drawingWidthRef.current,
                    isEraser: isEraserModeRef.current,
                  }])
                }
                currentStrokeRef.current = []
              }
            }}
          />
        </>
      )}

      {/* Map Right-Click Context Menu */}
      {mapContextMenu && (
        <div
          className="fixed inset-0 z-[10000100]"
          onClick={() => setMapContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setMapContextMenu(null) }}
        >
          <div
            ref={mapContextMenuRef}
            className="absolute bg-nier-blackLight border border-nier-border/40 py-1 min-w-[160px] max-h-[90vh] overflow-y-auto"
            // Measured rather than estimated -- the old numbers (180 wide, and
            // a height of 220 on desktop or 195 on web) were guesses that had
            // to be kept in step by hand every time an entry was added.
            style={{ left: mapContextMenuPos.x, top: mapContextMenuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-nier-border/60" />
            
            <div className="px-3 py-1.5 text-nier-bg/70 text-[8px] tracking-[0.2em] uppercase select-none">
              Place Trace
            </div>
            {([
              { label: '◇ Text', type: 'text' as const, shape: undefined },
              { label: '◇ Embed', type: 'embed' as const, shape: undefined },
              { label: '◇ Shape', type: 'shape' as const, shape: 'rectangle' as const },
              { label: '~ Path', type: 'shape' as const, shape: 'path' as const },
              ...(isDesktop ? [
                { label: '◇ Image', type: 'image' as const, shape: undefined },
                { label: '◇ Sound', type: 'audio' as const, shape: undefined },
                { label: '◇ PDF', type: 'document' as const, shape: undefined },
              ] : []),
            ]).map((item) => (
              <button
                key={item.label}
                className="w-full px-3 py-1.5 text-left text-nier-bg text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors flex items-center gap-2"
                onClick={() => {
                  setClickedTracePosition({ x: mapContextMenu.worldX, y: mapContextMenu.worldY })
                  setTracePanelInitialType(item.type)
                  setTracePanelInitialShapeType(item.shape)
                  setShowTracePanel(true)
                  setMapContextMenu(null)
                }}
              >
                {item.label}
              </button>
            ))}

            {/* Desktop only, matching Ctrl+V: turning a clipboard image into a
                trace means writing the file into the vault, which the web app
                can't do. */}
            {isDesktop && clipboardHasImage !== false && (
              <div className="border-t border-nier-border/20 mt-1 pt-1">
                <button
                  className="w-full px-3 py-1.5 text-left text-nier-bg text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors flex items-center gap-2"
                  onClick={() => {
                    const anchor = { x: mapContextMenu.worldX, y: mapContextMenu.worldY }
                    setMapContextMenu(null)
                    void handlePasteImageAt(anchor.x, anchor.y)
                  }}
                >
                  ◇ Paste Image
                </button>
              </div>
            )}

            {!isDesktop && (
              <>
                <div className="border-t border-nier-border/20 mt-1 pt-1">
                  <button
                    className="w-full px-3 py-1.5 text-left text-nier-bg text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors flex items-center gap-2"
                    onClick={() => {
                      const anchor = { x: mapContextMenu.worldX, y: mapContextMenu.worldY }
                      setMapContextMenu(null)
                      if (pinterestConnected) {
                        setPinterestImportAnchor(anchor)
                        setShowPinterestImport(true)
                      } else {
                        initiatePinterestConnect()
                      }
                    }}
                  >
                    ◇ Your Pinterest Boards
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Trace Panel */}
      {showTracePanel && (
        <TracePanel
          onClose={handleCloseTracePanel}
          onCreatePath={handleCreatePath}
          onCreateBatchEmbeds={handleCreateBatchEmbeds}
          onCreateFileBatch={handleCreateFileBatch}
          onCreatePdfPages={handleCreatePdfPages}
          initialPdfFile={pendingPdfFile}
          tracePosition={clickedTracePosition}
          lobbyId={lobbyId}
          initialType={tracePanelInitialType}
          initialShapeType={tracePanelInitialShapeType}
          activeLayerId={activeLayerId}
          shapeDraftSize={shapeDraftSize}
          onShapeDraftChange={handleShapeDraftChange}
          onShapeModeChange={handleShapeModeChange}
        />
      )}

      {/* Pinterest Import Panel */}
      {showPinterestImport && (
        <PinterestImportPanel
          onClose={() => { setShowPinterestImport(false); setPinterestImportAnchor(null) }}
          lobbyId={lobbyId}
          worldCenter={pinterestImportAnchor || { x: positionRef.current.x, y: positionRef.current.y }}
          packingShape={packingShapeRef.current}
          activeLayerId={activeLayerId}
        />
      )}

      {/* Locations Panel */}
      {showLocationsPanel && (
        <LocationsPanel
          onClose={() => setShowLocationsPanel(false)}
          canEdit={canEdit}
          locations={workingLocations}
          dirty={locationsDirty}
          onAdd={addLocation}
          onRename={renameLocation}
          onUpdateCamera={updateLocationCamera}
          onToggleLock={toggleLocationLock}
          onDelete={deleteLocation}
          onReorder={reorderLocations}
          onSave={saveLocationChanges}
          onDiscard={discardLocationChanges}
          onGoToLocation={flyToLocation}
          presentationMode={presentationMode}
          onTogglePresentation={togglePresentationMode}
          presentationIndex={presentationIndex}
        />
      )}

      {/* Layer Panel */}
      {showLayerPanel && (
        <LayerPanel
          lobbyId={lobbyId}
          onClose={() => setShowLayerPanel(false)}
          selectedTraceId={selectedTraceId}
          multiSelectedTraceIds={multiSelectedTraceIds}
          canEdit={canEdit}
          onSelectTrace={(traceId) => {
            // onSelectTrace called
            setSelectedTraceId(traceId)
            // setSelectedTraceId called
          }}
          activeLayerId={activeLayerId}
          onSetActiveLayer={setActiveLayerId}
          onSelectGroupTraces={(traceIds) => setMultiSelectRequest(traceIds)}
          onGoToTrace={(traceId) => {
            const trace = traces.find(t => t.id === traceId)
            if (trace) {
              // Set camera to trace position
              cameraPositionRef.current.x = trace.x
              cameraPositionRef.current.y = trace.y
              // Camera position updated
            } else {
              console.warn('Trace not found:', traceId)
            }
          }}
          onGoToTraces={(traceIds) => {
            // Frames a whole group: centers on its bounding box and picks the
            // zoom that fits it on screen, reusing the Locations fly-to easing
            // so it reads as the same kind of movement.
            const ids = new Set(traceIds)
            const targets = traces.filter(t => ids.has(t.id))
            if (targets.length === 0) return

            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            for (const t of targets) {
              // Include each trace's own extent, not just its center point, so
              // a group of large traces isn't cropped at the viewport edges.
              const halfW = ((t.width ?? getDefaultTraceBoxSize(t.type).width) * (t.scaleX ?? t.scale ?? 1)) / 2
              const halfH = ((t.height ?? getDefaultTraceBoxSize(t.type).height) * (t.scaleY ?? t.scale ?? 1)) / 2
              minX = Math.min(minX, t.x - halfW)
              maxX = Math.max(maxX, t.x + halfW)
              minY = Math.min(minY, t.y - halfH)
              maxY = Math.max(maxY, t.y + halfH)
            }

            const PADDING = 1.25 // leave a margin so nothing sits on the edge
            const spanX = Math.max(1, (maxX - minX) * PADDING)
            const spanY = Math.max(1, (maxY - minY) * PADDING)
            const fitZoom = Math.min(window.innerWidth / spanX, window.innerHeight / spanY)

            cameraFlyToRef.current = {
              startX: cameraPositionRef.current.x,
              startY: cameraPositionRef.current.y,
              startZoom: zoomRef.current,
              targetX: (minX + maxX) / 2,
              targetY: (minY + maxY) / 2,
              targetZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom)),
              startTime: performance.now(),
              duration: 900,
            }
          }}
        />
      )}

      {/* Instructions */}
      <div className="fixed bottom-4 left-4 px-4 py-3 border-2 border-white z-[9999] font-mono pointer-events-auto" style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white"></div>
        <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-white"></div>
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-white"></div>
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white"></div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-white text-[10px] tracking-[0.15em] uppercase">Controls</p>
          <button
            onClick={() => setControlsMinimized(!controlsMinimized)}
            className="text-gray-500 hover:text-white text-[14px] transition-colors leading-none px-0.5"
            title={controlsMinimized ? 'Expand' : 'Minimize'}
          >
            {controlsMinimized ? '▸' : '▾'}
          </button>
        </div>
        {!controlsMinimized && (
          <div className="space-y-1 mt-2">
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Leave Trace : "T"
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Freehand Draw : "D"
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Edit Trace : Right Click It
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Multi-select : Shift + Click Traces
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Undo / Redo : Ctrl+Z / Ctrl+Shift+Z
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Copy / Paste : Ctrl+C / Ctrl+V
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Delete Selected : Delete Key
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Save Changes : Ctrl+S
            </p>
          </div>
        )}
      </div>

      {/* Theme Customization Modal */}
      {showThemeCustomization && currentLobby && (
        <ThemeCustomization
          lobby={currentLobby}
          onClose={() => setShowThemeCustomization(false)}
          onUpdate={async () => {
            // Reload lobby info to get updated theme
            if (!supabase) return
            try {
              const { data, error } = await (supabase
                .from('lobbies')
                .select('*')
                .eq('id', lobbyId)
                .single() as any)
              if (!error && data) {
                const lobby: Lobby = {
                  id: data.id,
                  name: data.name,
                  ownerUserId: data.owner_user_id,
                  passwordHash: data.password_hash,
                  maxPlayers: data.max_players,
                  isPublic: data.is_public,
                  createdAt: data.created_at,
                  updatedAt: data.updated_at,
                  themeSettings: data.theme_settings,
                  autosaveEnabled: data.autosave_enabled,
                  autosaveIntervalSeconds: data.autosave_interval_seconds,
                  adminUserIds: data.admin_user_ids ?? [],
                  editPermissionMode: data.edit_permission_mode ?? 'all',
                }
                setCurrentLobby(lobby)
              }
            } catch (err) {
              console.error('Failed to reload lobby after theme save:', err)
            }
          }}
        />
      )}

      {/* Lobby Management Modal */}
      {showLobbyManagement && currentLobby && (
        <LobbyManagement
          lobby={currentLobby}
          isOwner={isLobbyOwner}
          onClose={() => setShowLobbyManagement(false)}
          onUpdate={() => {
            // Reload lobby info
            if (supabase) {
              (supabase!
                .from('lobbies')
                .select('*')
                .eq('id', lobbyId)
                .single() as any).then(({ data }: any) => {
                  if (data) {
                    setCurrentLobby({
                      id: data.id,
                      name: data.name,
                      ownerUserId: data.owner_user_id,
                      passwordHash: data.password_hash,
                      maxPlayers: data.max_players,
                      isPublic: data.is_public,
                      createdAt: data.created_at,
                      updatedAt: data.updated_at,
                      themeSettings: data.theme_settings,
                      autosaveEnabled: data.autosave_enabled,
                      autosaveIntervalSeconds: data.autosave_interval_seconds,
                      adminUserIds: data.admin_user_ids ?? [],
                      editPermissionMode: data.edit_permission_mode ?? 'all',
                    })
                    setIsLobbyOwner(data.owner_user_id === userId)
                  }
                })
            }
          }}
        />
      )}

      {/* Profile Customization Modal */}
      {showProfileCustomization && (
        <ProfileCustomization
          onClose={() => setShowProfileCustomization(false)}
          lobbyId={lobbyId}
        />
      )}

      {/* Unsaved Changes Leave Dialog */}
      {showLeaveDialog && (() => {
        const hudBottom = hudRef.current ? hudRef.current.getBoundingClientRect().bottom : 200
        return (
        <div
          className="fixed inset-0 z-[10000100] pointer-events-auto"
          onClick={() => setShowLeaveDialog(false)}
        >
          <div
            className="bg-gray-900 border border-gray-500 p-6 absolute left-4"
            style={{ top: `${hudBottom + 8}px`, maxWidth: '200px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-gray-500 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-gray-500 pointer-events-none" />

            <h3 className="text-white font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
              <span className="text-gray-400 mr-2">◇</span>Unsaved Changes
            </h3>
            <p className="text-gray-400 text-xs font-mono tracking-wider text-center mb-6">
              You have {useGameStore.getState().pendingChanges.size + useGameStore.getState().deletedTraces.size} unsaved change(s). Are you sure you want to leave?
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  // Save and leave (shared with the HUD save button, autosave,
                  // and the desktop close-with-unsaved-changes prompt)
                  if (useGameStore.getState().hasPendingChanges()) {
                    try {
                      await saveAllChanges()
                    } catch {
                      // Continue leaving even if save fails
                    }
                  }
                  setShowLeaveDialog(false)
                  onLeaveLobby()
                }}
                className="w-full bg-white hover:bg-gray-200 text-black font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all"
              >
                ◇ Save and Leave
              </button>
              <button
                onClick={() => {
                  useGameStore.getState().clearPendingChanges()
                  setShowLeaveDialog(false)
                  onLeaveLobby()
                }}
                className="w-full bg-red-900 hover:bg-red-700 text-white font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-red-600"
              >
                Yes, Leave Without Saving
              </button>
              <button
                onClick={() => setShowLeaveDialog(false)}
                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-gray-600"
              >
                Return to Atrium
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* You were kicked. Deliberately has no backdrop dismiss and no close
          "x": the only way out is Leave Atrium, since staying isn't an
          option -- the panel is telling you what already happened. */}
      {kickedNotice && (
        <div className="fixed inset-0 z-[10000200] bg-black/80 flex items-center justify-center pointer-events-auto">
          <div
            className={`bg-gray-900 border p-6 relative ${kickedNotice.blacklisted ? 'border-red-600' : 'border-gray-500'}`}
            style={{ maxWidth: '360px' }}
          >
            {(() => {
              const corner = kickedNotice.blacklisted ? 'border-red-600' : 'border-gray-500'
              return (
                <>
                  <div className={`absolute top-0 left-0 w-4 h-4 border-l border-t ${corner} pointer-events-none`} />
                  <div className={`absolute top-0 right-0 w-4 h-4 border-r border-t ${corner} pointer-events-none`} />
                  <div className={`absolute bottom-0 left-0 w-4 h-4 border-l border-b ${corner} pointer-events-none`} />
                  <div className={`absolute bottom-0 right-0 w-4 h-4 border-r border-b ${corner} pointer-events-none`} />
                </>
              )
            })()}

            <h3 className="text-white font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
              <span className={`mr-2 ${kickedNotice.blacklisted ? 'text-red-500' : 'text-gray-400'}`}>◇</span>
              {kickedNotice.blacklisted ? 'Removed & Blacklisted' : 'Removed From Atrium'}
            </h3>

            <p className="text-gray-400 text-xs font-mono tracking-wider text-center mb-2 leading-relaxed">
              {kickedNotice.blacklisted
                ? 'An administrator has removed you from this atrium and blocked you from returning.'
                : 'An administrator has removed you from this atrium.'}
            </p>
            {kickedNotice.blacklisted && (
              <p className="text-red-400/70 text-[10px] font-mono tracking-wider text-center mb-6">
                You will not be able to rejoin.
              </p>
            )}
            {!kickedNotice.blacklisted && (
              <p className="text-gray-500 text-[10px] font-mono tracking-wider text-center mb-6">
                You may rejoin if you're allowed back in.
              </p>
            )}

            <button
              onClick={() => { setKickedNotice(null); onLeaveLobby() }}
              autoFocus
              className="w-full bg-white hover:bg-gray-200 text-black font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all"
            >
              Leave Atrium
            </button>
          </div>
        </div>
      )}

      {/* Kick User Confirmation */}
      {kickTarget && (
        <div
          className="fixed inset-0 z-[10000100] bg-black/70 flex items-center justify-center pointer-events-auto"
          onClick={() => !isKicking && setKickTarget(null)}
        >
          <div
            className="bg-gray-900 border border-gray-500 p-6 relative"
            style={{ maxWidth: '320px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-gray-500 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-gray-500 pointer-events-none" />

            <h3 className="text-white font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
              <span className="text-gray-400 mr-2">◇</span>Kick User
            </h3>
            <p className="text-gray-400 text-xs font-mono tracking-wider text-center mb-6">
              Remove <span className="text-white">{kickTarget.username}</span> from this atrium?
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => executeKick(kickTarget.userId, false)}
                disabled={isKicking}
                className="w-full bg-white hover:bg-gray-200 text-black font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all disabled:opacity-50"
              >
                {isKicking ? 'Kicking...' : 'Kick'}
              </button>
              <button
                onClick={() => executeKick(kickTarget.userId, true)}
                disabled={isKicking}
                className="w-full bg-red-900 hover:bg-red-700 text-white font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-red-600 disabled:opacity-50"
              >
                {isKicking ? 'Kicking...' : 'Kick + Blacklist'}
              </button>
              <button
                onClick={() => setKickTarget(null)}
                disabled={isKicking}
                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-gray-600 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local File Drop Blocked (web only) */}
      {showLocalFileBlockedDialog && (
        <div
          className="fixed inset-0 z-[10000100] bg-black/70 flex items-center justify-center pointer-events-auto"
          onClick={() => setShowLocalFileBlockedDialog(false)}
        >
          <div
            className="bg-gray-900 border border-gray-500 p-6 relative"
            style={{ maxWidth: '360px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-gray-500 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-gray-500 pointer-events-none" />

            <h3 className="text-white font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
              <span className="text-gray-400 mr-2">◇</span>Local Files Not Supported
            </h3>
            <p className="text-gray-400 text-xs font-mono tracking-wider text-center mb-6">
              Importing files from your computer isn't available in the web version yet. Get the desktop app to drag in images, audio, and video files directly.
            </p>

            <div className="flex flex-col gap-2">
              <a
                href="https://example.com/download"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-white hover:bg-gray-200 text-black font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all text-center"
              >
                ◇ Get the Desktop App
              </a>
              <button
                onClick={() => setShowLocalFileBlockedDialog(false)}
                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-gray-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
