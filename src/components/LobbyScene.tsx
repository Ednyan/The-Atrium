import { useCallback, useEffect, useRef, useState } from 'react'
import { Application, Graphics, Text, Container } from 'pixi.js'
import '@pixi/unsafe-eval'
import { useGameStore, LOBBY_SIZE_LIMIT } from '../store/gameStore'
import { usePresence } from '../hooks/usePresence'
import { mapRowToTrace } from '../hooks/useTraces'
import TracePanel from './TracePanel'
import TraceOverlay from './TraceOverlay'
import LayerPanel, { TRACE_DRAG_DATA_KEY } from './LayerPanel'
import LocationsPanel, { LOCATION_DRAG_DATA_KEY } from './LocationsPanel'
import type { LobbyLocation } from '../types/database'
import { LobbyManagement } from './LobbyManagement'
import { ThemeCustomization } from './ThemeCustomization'
import ProfileCustomization from './ProfileCustomization'
import { ThemeManager } from '../lib/themeManager'
import { supabase, isDesktop } from '../lib/supabase'
import { saveAllChanges, discardAllChanges } from '../lib/traceSave'
import { convertEmbedToInternalImage } from '../lib/traceConvert'
import { computeZIndexForNewTraceInLayer, getTraceBaseZIndex } from '../lib/layerZIndex'
import { packBoxesAroundCenter, getDefaultTraceBoxSize, scaleToDisplayBox, probeRemoteImageDimensions } from '../lib/binPack'
import { getPinterestConnectionStatus, initiatePinterestConnect } from '../lib/pinterest'
import PinterestImportPanel from './PinterestImportPanel'
// pathSimplify no longer needed - drawings saved as raster images
import type { Lobby, Trace } from '../types/database'

const AVATAR_SIZE = 20
const TRACE_RENDER_DISTANCE = 2000
const TRACE_FADE_DISTANCE = 1500
const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.15
const DEFAULT_ZOOM_SENSITIVITY = 0.16

const clampZoomSensitivity = (value: number) => Math.max(0.04, Math.min(0.6, value))

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
  const [tracePanelInitialType, setTracePanelInitialType] = useState<'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | undefined>(undefined)
  const [tracePanelInitialShapeType, setTracePanelInitialShapeType] = useState<'rectangle' | 'circle' | 'triangle' | 'path' | undefined>(undefined)
  const [mapContextMenu, setMapContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null)
  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [showLocationsPanel, setShowLocationsPanel] = useState(false)
  const [showLobbyManagement, setShowLobbyManagement] = useState(false)
  const [showThemeCustomization, setShowThemeCustomization] = useState(false)
  const [showProfileCustomization, setShowProfileCustomization] = useState(false)
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null)
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
  const [kickTarget, setKickTarget] = useState<{ userId: string; username: string } | null>(null)
  const [isKicking, setIsKicking] = useState(false)
  const [isConvertingEmbeds, setIsConvertingEmbeds] = useState(false)
  const [convertEmbedsProgress, setConvertEmbedsProgress] = useState('')
  const [pinterestConnected, setPinterestConnected] = useState(false)
  const [showPinterestImport, setShowPinterestImport] = useState(false)
  const [pinterestImportAnchor, setPinterestImportAnchor] = useState<{ x: number; y: number } | null>(null)
  const [showLocalFileBlockedDialog, setShowLocalFileBlockedDialog] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
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

  // Server-side enforcement lives in RLS (user_can_edit_lobby); this mirrors
  // it client-side to gate the UI so a non-editor doesn't see edit controls
  // that would just fail to save.
  const canEdit = isLobbyOwner || isLobbyAdmin ||
    (currentLobby?.editPermissionMode ?? 'all') === 'all' ||
    (currentLobby?.editPermissionMode === 'selected' && isSelectedEditor)
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
      : {}

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
      let layerFields: { layer_id: string; z_index: number }[] | null = null
      if (activeLayerId) {
        const { data: layerData } = await supabase.from('layers').select('z_index').eq('id', activeLayerId).single()
        const layerZIndex = (layerData as any)?.z_index
        const baseZ = layerZIndex !== undefined && layerZIndex !== null ? getTraceBaseZIndex(layerZIndex) : 0
        const existingCount = traces.filter(t => t.layerId === activeLayerId).length
        layerFields = urls.map((_, i) => ({ layer_id: activeLayerId, z_index: baseZ + existingCount + i + 1 }))
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
  const handleKicked = useCallback((blacklisted: boolean) => {
    alert(blacklisted
      ? 'You have been kicked from this atrium and blacklisted -- you can no longer rejoin.'
      : 'You have been kicked from this atrium.')
    onLeaveLobby()
  }, [onLeaveLobby])
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

      // Mouse wheel zoom handler
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
        cameraFlyToRef.current = null // manual zoom cancels any camera fly-to
        const delta = -e.deltaY * 0.001
        const zoomSensitivity = zoomSensitivityRef.current
        const newTargetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoomRef.current + delta * zoomSensitivity))
        targetZoomRef.current = newTargetZoom
      }
      
      eventHandlersRef.current.wheel = handleWheel
      window.addEventListener('wheel', handleWheel, { passive: false })

      // Initialize theme manager
      const themeManager = new ThemeManager(worldContainer, {
        particleCount: 100,
        groundDensity: 0.5,
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
          
          // Only GENERATE ground elements when zoom is stable and not hidden (expensive)
          if (frameCounter % 2 === 0 && zoomIsStable && !themeManager.isGroundHidden()) {
            const margin = 500
            const minX = camX - viewportWidth / zoomRef.current - margin
            const minY = camY - viewportHeight / zoomRef.current - margin
            const maxX = camX + viewportWidth / zoomRef.current + margin
            const maxY = camY + viewportHeight / zoomRef.current + margin
            
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

        // Update pulsing indicator for trace placement
        if (tracePlacementIndicatorRef.current && clickedTracePosition) {
          pulseTime += 0.1
          const pulse = Math.abs(Math.sin(pulseTime))
          const size = 15 + pulse * 10
          
          tracePlacementIndicatorRef.current.clear()
          
          // Outer glow
          tracePlacementIndicatorRef.current.lineStyle(3, 0xffd700, 0.3 + pulse * 0.5)
          tracePlacementIndicatorRef.current.drawCircle(clickedTracePosition.x, clickedTracePosition.y, size + 10)
          
          // Middle ring
          tracePlacementIndicatorRef.current.lineStyle(2, 0xffd700, 0.5 + pulse * 0.5)
          tracePlacementIndicatorRef.current.drawCircle(clickedTracePosition.x, clickedTracePosition.y, size)
          
          // Inner bright circle
          tracePlacementIndicatorRef.current.beginFill(0xffd700, 0.6 + pulse * 0.4)
          tracePlacementIndicatorRef.current.drawCircle(clickedTracePosition.x, clickedTracePosition.y, 8)
          tracePlacementIndicatorRef.current.endFill()
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

  // Drag-and-drop trace creation
  const handleDragOver = (e: React.DragEvent) => {
    // Ignore the Layer panel's internal trace-reorder drag -- its events
    // bubble here through any gap in the panel without its own drop-target
    // handler, which used to flash the "drop file to create trace" overlay
    // while the user was just reordering layers.
    if (e.dataTransfer.types.includes(TRACE_DRAG_DATA_KEY) || e.dataTransfer.types.includes(LOCATION_DRAG_DATA_KEY)) return
    if (!canEdit) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(TRACE_DRAG_DATA_KEY) || e.dataTransfer.types.includes(LOCATION_DRAG_DATA_KEY)) return
    // Only hide overlay when actually leaving the container
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(TRACE_DRAG_DATA_KEY) || e.dataTransfer.types.includes(LOCATION_DRAG_DATA_KEY)) return
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!canEditRef.current) return
    if (!worldContainerRef.current) return

    if (!ensureLobbyHasSpace()) return

    const { x: worldX, y: worldY } = getWorldPositionFromScreen(e.clientX, e.clientY)

    const droppedFiles = Array.from(e.dataTransfer.files)
    const processDroppedFiles = async () => {
      // Phase 1: classify every dropped file and estimate its box size
      // without uploading or inserting anything yet, so the whole batch can
      // be bin-packed into one layout instead of just cascading diagonally
      // from the drop point. Real dimensions are probed for actual image
      // files (fast, local); everything else uses a type-based default.
      type PendingDrop = {
        traceType: string
        content: string
        mediaUrl?: string
        file?: File
        size: { width: number; height: number }
      }
      const pending: PendingDrop[] = []

      for (const file of droppedFiles) {
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
      e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || ''
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
    }
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
          <p className="text-white text-base tracking-[0.2em] uppercase animate-saving-fade">
            ◇ Saving...
          </p>
        </div>
      )}

      {/* HUD */}
      <div ref={hudRef} data-ui-element="true" className="fixed top-4 left-4 bg-black px-3 py-2 border-2 border-white z-[9999] font-mono pointer-events-auto" style={{ backgroundColor: 'rgba(0,0,0,0.9)', maxWidth: '160px' }}>
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
        <button
          onClick={() => {
            // Reset camera to center of map
            cameraPositionRef.current = { x: 0, y: 0 }
            worldOffsetRef.current = { x: 0, y: 0 }
            setWorldOffset({ x: 0, y: 0 })
          }}
          className="w-full mt-1.5 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
        >
          Recenter
        </button>
        <button
          onClick={toggleFullscreen}
          className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
        >
          {isFullscreen ? 'Windowed' : 'Fullscreen'}
        </button>
        <div className="flex gap-1 mt-1">
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
            onClick={() => {
              navigator.clipboard.writeText(currentLobby.id)
              alert('Lobby ID copied! Share this with others to invite them.')
            }}
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
        {(isLobbyOwner || isLobbyAdmin) && (
          <button
            onClick={() => setShowThemeCustomization(true)}
            className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
          >
            Theme
          </button>
        )}
          </>
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
            {!canEdit && (
              <p className="text-[9px] font-mono tracking-[0.12em] uppercase" style={{ color: '#FF6161' }}>
                ◇ View Only — You don't have permission to edit this atrium
              </p>
            )}
            {multiSelectedTraceIds.length > 1 && (
              <p className="text-green-400 text-[9px] font-mono tracking-[0.12em] uppercase">
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
        className="fixed bottom-20 right-4 bg-gray-800 hover:bg-gray-700 text-white px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 border-gray-500 pointer-events-auto"
      >
        <span className="opacity-60 mr-2">◇</span>
        {showLayerPanel ? 'Close' : 'Layers'}
      </button>

      {/* Locations Button -- visible to everyone (viewing/presenting saved
          camera views doesn't require edit permission; the panel hides its
          mutating controls when canEdit is false) */}
      <button
        onClick={() => setShowLocationsPanel(!showLocationsPanel)}
        className="fixed bottom-52 right-4 bg-gray-800 hover:bg-gray-700 text-white px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 border-gray-500 pointer-events-auto"
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
        className={`fixed bottom-36 right-4 ${isDrawingMode ? 'bg-white text-black border-white' : 'bg-gray-800 hover:bg-gray-700 text-white border-gray-500'} px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 pointer-events-auto`}
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
            className="absolute bg-nier-blackLight border border-nier-border/40 py-1 min-w-[160px]"
            style={{
              left: Math.min(mapContextMenu.x, window.innerWidth - 180),
              top: Math.min(mapContextMenu.y, window.innerHeight - (isDesktop ? 220 : 195)),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-nier-border/60" />
            
            <div className="px-3 py-1.5 text-nier-border/50 text-[8px] tracking-[0.2em] uppercase select-none">
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
        <TracePanel onClose={handleCloseTracePanel} onCreatePath={handleCreatePath} onCreateBatchEmbeds={handleCreateBatchEmbeds} tracePosition={clickedTracePosition} lobbyId={lobbyId} initialType={tracePanelInitialType} initialShapeType={tracePanelInitialShapeType} activeLayerId={activeLayerId} />
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
          lobbyId={lobbyId}
          onClose={() => setShowLocationsPanel(false)}
          canEdit={canEdit}
          getCurrentCamera={getCurrentCamera}
          onGoToLocation={flyToLocation}
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
