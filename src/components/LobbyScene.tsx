import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLandingTheme } from '../lib/useLandingTheme'
import { customThemesNow, lastThemeOf, loadCustomThemes, readView, rememberLast, themeModeOf, themeOf, useCustomThemes, writeView, type ThemeRef } from '../lib/customThemes'
import { flushSync } from 'react-dom'
import { Application, Graphics, Text, Container } from 'pixi.js'
import '@pixi/unsafe-eval'
import { useGameStore, LOBBY_SIZE_LIMIT, lobbyFullMessage, unsavedActions, useGamePick } from '../store/gameStore'
import ThemeToggle from './ThemeToggle'
import { currentTracePreset } from '../lib/tracePresets'
import { readPackingShape } from '../lib/atriumPreferences'
import { usePresence } from '../hooks/usePresence'
import { mapRowToTrace } from '../hooks/useTraces'
import TraceOverlay, { CULL_MARGIN } from './TraceOverlay'
import { contentView, createWorldCamera, edgeInsets } from '../lib/worldCamera'
import { boundsOf, traceBox } from '../lib/traceGeometry'
import { type Box } from '../lib/traceLinks'
import LayerPanel from './LayerPanel'
import LocationsPanel, { LOCATION_DRAG_DATA_KEY } from './LocationsPanel'
import type { LobbyLocation } from '../types/database'
import { LobbyManagement } from './LobbyManagement'
import { ThemeCustomization } from './ThemeCustomization'
import ProfileCustomization from './ProfileCustomization'
import { ThemeManager } from '../lib/themeManager'
import { supabase, isDesktop } from '../lib/supabase'
import { isGhostEntry as resolveGhostEntry } from '../lib/operatorGhost'
import { showToast } from '../lib/toast'
import { tCount, useTranslation } from '../lib/i18n'
import { isCanvasTarget, isEditableTarget } from '../lib/editableTarget'
import { recordAction } from '../lib/actionHistory'
import { adoptTraces } from '../lib/layerUndo'
import { cachedPicture, dropStrokes, holdDrawingFiles, loadDrawingPicture, paintedDrawing, pictureFieldsOf, pictureRow, pieceFields, placementOf, releaseDrawingFiles, restoreStrokes, saveDrawingPicture, writeDrawing, writePicture, type PictureFields } from '../lib/drawingFiles'
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition'
import { discardAllChanges, saveAllChanges } from '../lib/traceSave'
import { changeLocations, mapLocationRow, receiveLocations } from '../lib/locations'
import { convertEmbedToInternalImage } from '../lib/traceConvert'
import { groupIdOf, inOrder, keyAt, keysOnTopOfGroup, newTraceOrderFields, topLevel } from '../lib/order'
import { inferFileExtension, uploadTraceFile } from '../lib/traceUpload'
import { fileTitle, firstFreeName, nextShapeName, nextTextName, nextUntitledName } from '../lib/traceNames'
import { insertTrace } from '../lib/traceWrites'
import { packBoxesAroundCenter, getDefaultTraceBoxSize, scaleToDisplayBox, probeRemoteImageDimensions } from '../lib/binPack'
import { nextShapeStyle, previewFrameColour, rememberShapeStyle, shapePaint, shapeStyleColumns, textColourOn, type ShapeStyle } from '../lib/shapeStyle'
import { defaultEmbedBox, embedSourcesIn } from '../lib/embedUrl'
import { hasTransparency } from '../lib/imageAlpha'
import { isExr, withExrAsPng } from '../lib/exr'
import { asStrokeData, BUILTIN_BRUSHES, customBrushKey, drawingOf, drawPlacedPicture, drawStroke, erasePicture, eraseStrokeData, fitBox, localToWorldDelta, strokeToLocal, isCustomBrush, makeBrushTip, newStrokeSeed, rasterizeStroke, registerCustomBrush, type CustomBrush, type Piece, type Stroke, type StrokeData, type StrokePoint } from '../lib/brushes'
import { createWheelGestures } from '../lib/canvasGestures'
import { PINTEREST_CONNECTED_EVENT, getPinterestConnectionStatus, importAfterPinterestConnect, takeImportAfterPinterestConnect } from '../lib/pinterest'
import PinterestConnectionPanel from './PinterestConnectionPanel'
import { clampZoomSensitivity, getStoredZoomSensitivity } from '../lib/zoomSensitivity'
import { ReportFeedbackModal } from './ReportFeedbackModal'
import PinterestImportPanel from './PinterestImportPanel'
import QuickBar, { HistoryButtons, QUICK_ORDER, ToolHint, type PlaceTool, type QuickAction } from './QuickBar'
import { isBoxShape, type BoxShape } from '../lib/shapeStyle'
import { roundedPolygonPath, shapePolygon } from '../lib/traceGeometry'
import { formatSize } from '../lib/size'
import AtriumMenu, { ControlsPanel, HudIconButton, MENU_ICONS, MenuIcon, SlideLabel, ViewBar } from './AtriumMenu'
import { ACTION_ICONS, CustomizationPanel, PanelAction, Section } from './Customization'
import ShapeStyleControls from './ShapeStyleControls'
import { AtriumName, ViewReadout } from './AtriumInfo'
import EmbedLinkBox from './EmbedLinkBox'
import { LanguageList } from './LanguageToggle'
import LaserLayer from './LaserLayer'
import ExportDialog, { type Format as ExportFormat } from './ExportDialog'
import SharePanel from './SharePanel'
import { ImportTooLargeError, importIntoAtrium } from '../lib/atriumFile'
import { createPdfTrace } from '../lib/pdfTraces'
import { importSpreadsheet } from '../lib/sheetTraces'
import { SPREADSHEET_FILE } from '../lib/spreadsheet'
import { AtriumFileError, parseAtriumFile } from '../lib/atriumFormat'
import { loadLaserSettings, saveLaserSettings, type LaserSettings } from '../lib/laser'
import BrushGlyph, { BRUSH_LABELS } from './BrushGlyph'
import { placementOnScreen, pointToWorld, sameView, strokeOnScreen } from '../lib/drawingView'
import type { View } from '../lib/worldCamera'
// pathSimplify no longer needed - drawings saved as raster images
import type { Lobby, Trace } from '../types/database'

const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.40
// Recenter shows every trace unless that draws them smaller than this, and
// keeps this much room, in pixels, between them and the menus at the
// screen's edges (or the edges themselves).
const RECENTER_MIN_ZOOM = 0.25
const RECENTER_MARGIN = 32
// One keypress of zoom, and the same with Ctrl held.
//
// The coarse step was 0.6, which a repeating key turned into a lurch -- sized
// back when it was the only step there was and had to cover the whole range on
// its own. The fine step is roughly a third of it, for arriving at a particular
// zoom rather than getting near one.
//
// Both are multiplied by the user's zoom sensitivity before they reach the
// camera, so these are proportions of that setting rather than absolute
// amounts.
const KEYBOARD_ZOOM_STEP = 0.35
const KEYBOARD_ZOOM_STEP_FINE = 0.12

// Dark halo for HUD text that floats directly over the canvas. The atrium's
// background is user-themeable, so these labels can end up on any colour --
// a single drop shadow only works in one direction, whereas offsets on all
// four sides plus a soft blur keep the text legible against a light theme
// without looking heavy against a dark one.
// What a stroke can be, without leaving the building.
//
// The five ranks the contributors wall uses, the accent, the two ends of the
// greyscale and the two warm markers -- ten colours that already belong
// together because everything else here is drawn from them.
// One of drawing's settings as a slider: its name, the slider, its value --
// in three columns, so the three settings line up.
function DrawSlider({ label, value, min, max, unit = '', onChange }: {
  label: string
  value: number
  min: number
  max: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <label className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2">
      <span className="text-nier-bg/70 text-[11px] tracking-wider uppercase truncate">{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full h-1 cursor-pointer accent-nier-bg" />
      <span className="text-nier-bg/80 text-xs text-right tabular-nums">{value}{unit}</span>
    </label>
  )
}

// What the quick bar's file buttons pick from.
const TRACE_FILE_ACCEPT = { image: 'image/*,.exr', audio: 'audio/*', sound: 'audio/*', video: 'video/*', document: '.pdf,application/pdf' } as const

// Any colour at all: the palette's hues round a wheel.
const ANY_COLOUR = 'conic-gradient(#e87a6d, #e8c15a, #7fd1a6, #9ad4c4, #a8b6d9, #c77dff, #e87a6d)'

const DRAW_SWATCHES = [
  '#CBCBCB', '#191919', '#8F8F8F', '#FF8A3D', '#E8C15A',
  '#9AD4C4', '#A8B6D9', '#C77DFF', '#E87A6D', '#7FD1A6',
]

const HUD_TEXT_OUTLINE =
  '0 0 4px rgb(var(--c-ground) / 0.95), 1px 0 2px rgb(var(--c-ground) / 0.94), -1px 0 2px rgb(var(--c-ground) / 0.94), 0 1px 2px rgb(var(--c-ground) / 0.94), 0 -1px 2px rgb(var(--c-ground) / 0.94)'

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

// What the clipboard is holding that this canvas can place.
interface ClipboardOffer {
  images: File[]
  url: string | null
}

// Raw pixels into a PNG file, via a canvas.
//
// The native clipboard hands back an image as raw RGBA and its dimensions, not
// as an encoded file -- but everything downstream (uploading, probing the
// dimensions, writing it into the vault) expects a File. The canvas is already
// in the page and does the encoding, so this needs no library.
const rgbaToPngFile = async (rgba: Uint8Array, width: number, height: number): Promise<File | null> => {
  if (!width || !height) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null

  context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  return blob ? new File([blob], 'pasted-image.png', { type: 'image/png' }) : null
}

// A clipboard string that's worth offering to embed.
//
// Deliberately any http(s) link, not only ones that look like image files. An
// embed trace is already how a YouTube video, a Google Doc or a Drive file gets
// onto the canvas -- the overlay runs the URL through toEmbedUrl when it
// renders -- so restricting this to .jpg and .png would refuse exactly the
// links embeds are best at.
//
// Whitespace disqualifies it: a URL sitting inside a sentence is copied prose,
// not a link the user means to place.
const asPasteableUrl = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return null

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return trimmed
  } catch {
    return null
  }
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

interface LobbySceneProps {
  lobbyId: string
  onLeaveLobby: () => void
  // Raised when this user is removed by an admin. The notice belongs to
  // whatever screen comes after the atrium, not to the atrium being left.
  onKicked: (blacklisted: boolean) => void
}

// The drifting particles' part of a theme, for the manager when it's made and
// whenever the theme changes.
function particleConfig(theme: { particleColor?: string; particlesEnabled?: boolean; particleOpacity?: number; particleDensity?: number } | null | undefined, backgroundColor: number) {
  return {
    particleColor: theme?.particleColor ? parseInt(theme.particleColor.replace('#', ''), 16) : 0xffffff,
    particlesEnabled: theme?.particlesEnabled ?? true,
    particleOpacity: theme?.particleOpacity ?? 0.6,
    particleDensity: theme?.particleDensity ?? 1.0,
    backgroundColor,
  }
}

export default function LobbyScene({ lobbyId, onLeaveLobby, onKicked }: LobbySceneProps) {
  const { t, language } = useTranslation()
  const canvasRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldContainerRef = useRef<Container | null>(null)
  const labelRef = useRef<Text | null>(null)
  const playerAvatarRef = useRef<Graphics | null>(null)
  const positionRef = useRef({ x: 0, y: 0 })
  const traceIndicatorsRef = useRef<Container | null>(null)
  // Object pool for trace indicators to prevent memory leaks
  const indicatorPoolRef = useRef<Array<{ graphics: Graphics, distanceText: Text, unitText: Text, labelAt: number }>>([])
  const tracesDataRef = useRef<typeof traces>([])
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
  const cameraPositionRef = useRef({ x: 0, y: 0 }) // Independent camera position
  const zoomSensitivityRef = useRef(getStoredZoomSensitivity())
  // Per-atrium: how a multi-item drop/paste batch gets arranged (see the
  // Profile panel's "Batch Placement" setting and binPack.ts).
  const packingShapeRef = useRef<'square' | 'circle'>('square')
  const lightingLayerRef = useRef<Graphics | null>(null)
  const themeManagerRef = useRef<ThemeManager | null>(null)
  const gridRef = useRef<Graphics | null>(null)
  const updateGridRef = useRef<(() => void) | null>(null)
  // The atrium's theme as it is now, for the grid to read when it draws (set
  // where currentLobby is declared).
  const themeSettingsRef = useRef<Lobby['themeSettings'] | undefined>(undefined)
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
    mouseHeld: ((e: PointerEvent) => void) | null,
  }>({ mousedown: null, mousemove: null, mouseup: null, contextmenu: null, wheel: null, touchstart: null, touchmove: null, touchend: null, mouseHeld: null })
  // TraceOverlay's layer of world content, scaled as a whole while a zoom is
  // under way (see the ticker).
  const traceWorldLayerRef = useRef<HTMLDivElement | null>(null)
  const lastTouchDistRef = useRef<number | null>(null)

  // How far through a batch import we are, or null when nothing is importing.
  // Drives the panel that covers the atrium while files are being written.
  // An .atrium file's import counts its files and traces together, so it's
  // said as a percentage.
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; percent?: boolean } | null>(null)

  // Placement markers used a fixed gold, which sat somewhere between the
  // background and the foreground on a dark theme and vanished outright on a
  // light one. These follow the atrium's own background instead, so the
  // indicator is always the opposite end of the range from whatever it's
  // drawn on. A ref because the Pixi ticker reads it.
  const indicatorColorRef = useRef({ primary: 0xffffff })

  // One-shot signal telling TraceOverlay "select this brand-new path and
  // start its point-placing mode immediately" (a path begun with a click).
  const [newPathTraceId, setNewPathTraceId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1.0)
  const [worldOffset, setWorldOffset] = useState({ x: 0, y: 0 })
  const [onlinePlayerCount, setOnlinePlayerCount] = useState(1) // Start with 1 (self)
  const [showOnlineUsersList, setShowOnlineUsersList] = useState(false)
  // Forces the online-users list to re-render its "time in atrium" values
  // periodically while open, rather than only on other state changes.
  const [, setOnlineUsersListTick] = useState(0)
  
  const { username, otherUsers, traces, userId, isSavingChanges, saveFailed } = useGamePick('username', 'otherUsers', 'traces', 'userId', 'isSavingChanges', 'saveFailed')
  useEffect(() => { if (userId) void loadCustomThemes(userId) }, [userId])
  // The usage figure reads the store as it draws; this is what redraws it
  // when the atrium has been measured again (useTraces).
  useGamePick('serverLobbySize')

  const [mapContextMenu, setMapContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null)

  // Whether the clipboard currently holds an image, as far as we can tell:
  // true/false when the clipboard could be inspected, null when it couldn't.
  //
  // Ctrl+V has always pasted images onto the canvas, but plenty of people
  // don't reach for it -- they copy an image, right-click where they want it,
  // and look for "Paste Image". So the menu offers it, and the one for links
  // beside it.
  //
  // Both are always shown rather than only when the clipboard has something to
  // give. Deciding required reading the clipboard as the menu opened, and
  // reading the clipboard is what makes the browser put its own "Paste" button
  // on screen -- so every right-click on empty canvas raised a native prompt
  // next to the menu, for a question the user hadn't asked yet. Now the read
  // happens when the entry is clicked, which is the moment that prompt is
  // supposed to appear and the moment it makes sense. An entry that turns out
  // to have nothing to paste says so.
  // Wheel reading lives in lib/canvasGestures, shared with the contributors
  // page so the two canvases can't drift apart. Per-surface instance, since the
  // latched device reading is state.
  const wheelGestures = useMemo(() => createWheelGestures(), [])
  const classifyWheel = (e: WheelEvent) => wheelGestures.classify(e)
  const wheelZoomDelta = (e: WheelEvent) => wheelGestures.zoomDelta(e)

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
    setShowThemeCustomization(false)
    setShowProfileCustomization(false)
  }, [])
  // The atrium's locations live in the store and are saved with the rest, each change
  // a step of undo (lib/locations). Presentation mode is here, not in
  // LocationsPanel, so it keeps running after the panel is closed.
  const { locations } = useGamePick('locations')
  const [presentationMode, setPresentationMode] = useState(false)
  const [presentationIndex, setPresentationIndex] = useState(0)
  const presentationModeRef = useRef(false)
  const presentationIndexRef = useRef(0)
  useEffect(() => { presentationModeRef.current = presentationMode }, [presentationMode])
  useEffect(() => { presentationIndexRef.current = presentationIndex }, [presentationIndex])
  const [showLobbyManagement, setShowLobbyManagement] = useState(false)
  const [showThemeCustomization, setShowThemeCustomization] = useState(false)
  const [showProfileCustomization, setShowProfileCustomization] = useState(false)
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null)
  // The atrium's theme as you see it (lib/customThemes): its own, until you
  // pick another in Atrium Themes or press light/dark -- for you alone,
  // remembered for this atrium on this device.
  const { resolved: uiTheme, setTheme: setUiTheme } = useLandingTheme()
  const customThemes = useCustomThemes()
  const [viewRef, setViewRef] = useState<ThemeRef>(() => readView(lobbyId, uiTheme) ?? 'atrium')
  const seeIn = (ref: ThemeRef) => {
    setViewRef(ref)
    writeView(lobbyId, ref)
  }
  // A theme picked: seen in, remembered as the last of its kind, and light or
  // dark set to match it.
  const pickTheme = (ref: ThemeRef) => {
    seeIn(ref)
    const mode = themeModeOf(ref, currentLobby?.themeSettings, customThemesNow())
    rememberLast(mode, ref)
    if (mode !== uiTheme) setUiTheme(mode)
  }
  // Light or dark pressed (after it has changed): the last theme of that kind.
  const followSwitch = () => seeIn(lastThemeOf(uiTheme === 'light' ? 'dark' : 'light'))
  const viewTheme = useMemo(
    () => themeOf(viewRef, currentLobby?.themeSettings, customThemes) ?? currentLobby?.themeSettings,
    [viewRef, currentLobby?.themeSettings, customThemes],
  )
  themeSettingsRef.current = viewTheme

  // Fills in indicatorColorRef (declared above, since the ticker reads it).
  // Lives here rather than beside the ref because the dependency array is
  // evaluated during render, so it can't reference currentLobby any earlier.
  useEffect(() => {
    // One colour, not two. A second, brighter accent in the middle is what
    // made the marker read as an alert rather than a hint. Near-black rather
    // than pure black on a light background, so it reads as drawn on the
    // canvas rather than as a hole punched in it. Shared with the frame a
    // shape wears while its customize panel is open -- see shapeStyle.
    indicatorColorRef.current = { primary: previewFrameColour(viewTheme?.backgroundColor) }
  }, [viewTheme?.backgroundColor])
  const [isLobbyOwner, setIsLobbyOwner] = useState(false)
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  // Export (ExportDialog), open on what was selected when it was asked for --
  // and on a format, when it's an .atrium file to share.
  const [exportOf, setExportOf] = useState<{ ids: string[]; format?: ExportFormat } | null>(null)
  // The HUD's Share panel.
  const [showShare, setShowShare] = useState(false)
  const selectionRef = useRef<string[]>([])
  // One-shot request for TraceOverlay to multi-select a set of trace ids,
  // fired when the user clicks a group in the Layer panel. TraceOverlay owns
  // its own selection state internally, so this is passed down rather than
  // lifting that state up wholesale.
  const [multiSelectRequest, setMultiSelectRequest] = useState<string[] | null>(null)
  // A shift+drag area, in world units, for TraceOverlay to select from.
  const [areaSelectRequest, setAreaSelectRequest] = useState<Box | null>(null)
  // Same one-shot shape as multiSelectRequest: a fresh array every time, so
  // asking to customize the same traces twice fires the effect twice.
  const [customizeRequest, setCustomizeRequest] = useState<string[] | null>(null)
  // One-shot request: a text trace just created from the canvas menu that
  // should be selected and dropped straight into typing. Same shape and same
  // reasoning as newPathTraceId -- ids are always fresh, so a useEffect keyed
  // on the value fires once per request without needing to be reset.
  const [newTextTraceId, setNewTextTraceId] = useState<{ id: string; drawn?: boolean } | null>(null)
  // A frame for TraceOverlay to make, from the canvas menu.
  const [frameRequest, setFrameRequest] = useState<{ x: number; y: number; width?: number; height?: number; customize?: boolean } | null>(null)
  // The quick bar's armed tool (QuickBar): the next press on the canvas
  // places one of these, rather than panning or selecting.
  const [placeTool, setPlaceTool] = useState<PlaceTool | null>(null)
  // A change in the tool's panel: the style is read from where it's kept.
  const [, setToolStyleRev] = useState(0)
  // The laser pointer (LaserLayer), in hand or not, and its look -- this
  // person's own, kept on this device.
  const [laserActive, setLaserActive] = useState(false)
  // Move the view (the readout's four arrows, H): a drag pans and nothing
  // else is pressed -- no trace taken, none selected. Any tool ends it.
  const [panTool, setPanTool] = useState(false)
  const panToolRef = useRef(panTool)
  panToolRef.current = panTool
  const laserActiveRef = useRef(false)
  laserActiveRef.current = laserActive
  const [laserSettings, setLaserSettings] = useState<LaserSettings>(loadLaserSettings)
  const [pointerOnLaser, setPointerOnLaser] = useState(false)
  const changeLaserSettings = (next: LaserSettings) => {
    setLaserSettings(next)
    saveLaserSettings(next)
  }
  // The quick bar's Direct select: a click takes the trace itself, even in a
  // group or a frame, rather than its group whole.
  const [directSelect, setDirectSelect] = useState(false)
  // The quick bar's Text makes plain text -- no box: border, background or
  // shadow -- rather than text in a box.
  const [plainText, setPlainText] = useState(false)
  const placeToolRef = useRef(placeTool)
  placeToolRef.current = placeTool
  // A placement under way: where it was pressed, on screen and in the world.
  const placeStartRef = useRef<{ sx: number; sy: number; wx: number; wy: number; pointerId: number } | null>(null)
  // The preview of what's being dragged out: drawn straight to the element,
  // as the area select's box is, so a drag doesn't re-render the scene.
  const placePreviewRef = useRef<SVGSVGElement>(null)
  // Mirrors TraceOverlay's own multi-selection state (reported up via
  // onMultiSelectionChange) so the Layer panel can highlight every
  // multi-selected trace/group, not just the single selectedTraceId.
  const [multiSelectedTraceIds, setMultiSelectedTraceIds] = useState<string[]>([])
  selectionRef.current = multiSelectedTraceIds.length > 0 ? multiSelectedTraceIds : selectedTraceId ? [selectedTraceId] : []

  // The saving indicator follows the store's isSavingChanges, set by every
  // save (lib/traceSave) -- Save, Ctrl+S, leaving -- so none has to opt
  // in. Exactly, with no floor: the fade below keeps a fast save from
  // flashing past without saying it's still working once it isn't.
  // A save that has just finished, held for a moment so the button can
  // confirm rather than simply vanishing.
  const wasSavingRef = useRef(false)
  useEffect(() => {
    if (wasSavingRef.current && !isSavingChanges) {
      wasSavingRef.current = false
      // A save that failed says so instead (saveFailed).
      if (useGameStore.getState().saveFailed) {
        setJustSaved(false)
        return
      }
      setJustSaved(true)
      const timer = setTimeout(() => setJustSaved(false), 2200)
      return () => clearTimeout(timer)
    }
    if (isSavingChanges) wasSavingRef.current = true
  }, [isSavingChanges])

  // The atrium's menu, and the two panels it opens beside itself.
  const [menuOpen, setMenuOpenState] = useState(false)
  const [showLanguages, setShowLanguages] = useState(false)
  const [showControls, setShowControls] = useState(false)
  // One of them at a time.
  const showMenuPanel = (panel: 'share' | 'languages' | 'controls' | null) => {
    setShowShare(open => panel === 'share' && !open)
    setShowLanguages(open => panel === 'languages' && !open)
    setShowControls(open => panel === 'controls' && !open)
  }
  const setMenuOpen = (open: boolean) => {
    setMenuOpenState(open)
    if (!open) showMenuPanel(null)
  }
  // A choice that opens something elsewhere: the menu goes first.
  const fromMenu = (action: () => void) => () => {
    setMenuOpen(false)
    action()
  }
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)

  // Everything out of the way for a clean look at the atrium. The way out
  // stays, because being unable to leave is not a feature -- it just goes
  // quiet until somebody reaches for it.
  const [uiHidden, setUiHidden] = useState(false)

  // Set while the atrium steps back, just before it hands over. Going in was
  // already a move; coming out was a cut, which made the way back feel like a
  // different kind of action from the way in.
  const [leaving, setLeaving] = useState(false)

  const leaveWithTransition = useCallback(() => {
    setLeaving(true)
    setTimeout(onLeaveLobby, 210)
  }, [onLeaveLobby])

  // handleKicked is defined further down, before this callback exists. A ref
  // keeps the two in the order the file reads best without a forward use.
  const leaveWithTransitionRef = useRef(leaveWithTransition)
  useEffect(() => { leaveWithTransitionRef.current = leaveWithTransition }, [leaveWithTransition])

  // Held for a moment after a save finishes, so the button can confirm rather
  // than simply vanishing. A control that disappears on success leaves you
  // wondering whether it worked.
  const [justSaved, setJustSaved] = useState(false)

  // Save drops down under the atrium's name while there's something to save,
  // and folds back up once saved. "Saved" used to vanish the instant its timer
  // expired, which reads as an interruption rather than a finish -- so it is
  // held mounted for the length of the fold after the last state that wanted
  // it on screen has gone.
  const SAVE_FADE_MS = 300
  // How many actions wait for Save (unsavedActions): re-rendered when the
  // number changes, not on every change marked.
  const unsaved = useGameStore(unsavedActions)
  const saveBarActive = unsaved > 0 || saveFailed || isSavingChanges || justSaved
  const [saveBarMounted, setSaveBarMounted] = useState(false)
  const [saveBarShown, setSaveBarShown] = useState(false)
  useEffect(() => {
    if (saveBarActive) {
      setSaveBarMounted(true)
      // Mounted at zero for one frame before being told to be one. Setting
      // both in the same paint gives the transition nothing to move between.
      const frame = requestAnimationFrame(() => setSaveBarShown(true))
      return () => cancelAnimationFrame(frame)
    }
    setSaveBarShown(false)
    const timer = setTimeout(() => setSaveBarMounted(false), SAVE_FADE_MS)
    return () => clearTimeout(timer)
  }, [saveBarActive])

  // What the button says and looks like while it is fading out.
  //
  // The label is derived from the same state that decides whether to show the
  // button at all, so when justSaved expired the two changed together: the
  // fade began and the text flipped back to "Save changes" on the same frame,
  // leaving it to fade out saying the opposite of what had just happened.
  // Frozen at its last live value so the fade finishes the sentence it
  // started.
  // Its state is in its icon -- a count to save, a pulse while saving, a tick
  // once saved, a warning when it failed -- since its name shows only under
  // the pointer.
  const saveLabel = isSavingChanges
    ? t('atrium.hud.saving')
    : saveFailed
      ? t('atrium.hud.notSaved')
      : unsaved > 0
        ? t('atrium.hud.saveChanges', { count: unsaved })
        : t('atrium.hud.saved')
  const saveIcon = isSavingChanges || unsaved > 0 ? MENU_ICONS.save : saveFailed ? MENU_ICONS.report : MENU_ICONS.check
  // A button, and bright, while there's something to save; quiet otherwise.
  const canSave = (unsaved > 0 || saveFailed) && !isSavingChanges
  const saveDim = !canSave
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  useEffect(() => { if (unsaved === 0) setConfirmDiscard(false) }, [unsaved])
  const lastSaveLookRef = useRef({ label: saveLabel, dim: saveDim, icon: saveIcon })
  if (saveBarActive) lastSaveLookRef.current = { label: saveLabel, dim: saveDim, icon: saveIcon }
  const shownSave = saveBarActive ? { label: saveLabel, dim: saveDim, icon: saveIcon } : lastSaveLookRef.current

  const [showReportForm, setShowReportForm] = useState(false)
  const [kickTarget, setKickTarget] = useState<{ userId: string; username: string } | null>(null)
  const [isKicking, setIsKicking] = useState(false)
  const [isConvertingEmbeds, setIsConvertingEmbeds] = useState(false)
  const [convertEmbedsProgress, setConvertEmbedsProgress] = useState('')
  const [pinterestConnected, setPinterestConnected] = useState(false)
  const [showPinterestImport, setShowPinterestImport] = useState(false)
  // Connecting Pinterest, from inside the atrium, when its boards are asked
  // for before there's a connection (openPinterestImport).
  const [showPinterestConnect, setShowPinterestConnect] = useState(false)
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
  // The top-right bar the Leave button is in, for the leave prompt to open under.
  const sessionBarRef = useRef<HTMLDivElement>(null)

  // Leaving or refreshing the page with changes not saved: the browser asks
  // first. Nothing is saved that Save wasn't pressed for.
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

    showToast(lobbyFullMessage())
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
  useEffect(() => { if (isDrawingMode || placeTool) setLaserActive(false) }, [isDrawingMode, placeTool])
  useEffect(() => { if (isDrawingMode || placeTool || laserActive) setPanTool(false) }, [isDrawingMode, placeTool, laserActive])
  // Drawing's and a shape tool's Customization panels clear the panels around
  // them, as a trace's does (onCustomizeOpen).
  useEffect(() => {
    if (isDrawingMode || (placeTool && (isBoxShape(placeTool) || placeTool === 'path'))) closeSidePanels()
  }, [isDrawingMode, placeTool, closeSidePanels])

  // Watches the two activities rather than patching each of the several places
  // that start them (the HUD buttons, the T key, the canvas context menu), so
  // a new entry point can't quietly miss this. Fires only on the transition
  // into an activity, so reopening a panel mid-draw is still allowed -- it's
  // the user's call at that point.
  useEffect(() => {
    if (isDrawingMode) closeSidePanels()
  }, [isDrawingMode, closeSidePanels])

  const [isDrawing, setIsDrawing] = useState(false)
  const [isEraserMode, setIsEraserMode] = useState(false)
  // A built-in brush's name or customBrushKey(id) -- see lib/brushes.
  const [drawingBrush, setDrawingBrush] = useState<string>('pen')
  const drawingBrushRef = useRef('pen')
  // Brushes imported on desktop, read from the vault the first time drawing
  // opens.
  const [customBrushes, setCustomBrushes] = useState<CustomBrush[]>([])
  const customBrushesLoadedRef = useRef(false)
  const brushFileInputRef = useRef<HTMLInputElement>(null)
  // The seed of the stroke being drawn, so its grain holds still as it grows.
  const currentSeedRef = useRef(0)
  // The drawing's finished strokes, painted once into a layer of their own,
  // so only the stroke in progress is painted per pointer move -- a stamped
  // brush is hundreds of stamps a stroke. Painted at a view, and again when
  // the view moves or what it shows changes (drawingVersionRef): the strokes
  // are in the world (lib/drawingView), so a drawing stays where it was drawn
  // while the view pans and zooms around it.
  const committedLayerRef = useRef<{ canvas: HTMLCanvasElement; version: number; view: View | null } | null>(null)
  const [drawingColor, setDrawingColor] = useState('#ffffff')
  // Size, smoothing and hardness, the brush's and the eraser's apart: going
  // from one to the other keeps each as it was left. The eraser starts larger
  // than the brush. Hardness 100 is a hard edge, 0 as soft as it goes (see
  // drawStroke).
  const [toolSettings, setToolSettings] = useState({
    brush: { width: 3, smoothing: 30, hardness: 100 },
    eraser: { width: 20, smoothing: 30, hardness: 100 },
  })
  const drawingTool = isEraserMode ? 'eraser' : 'brush'
  const { width: drawingWidth, smoothing: drawingSmoothing, hardness: drawingHardness } = toolSettings[drawingTool]
  const setToolSetting = (key: 'width' | 'smoothing' | 'hardness') => (value: number) =>
    setToolSettings(all => ({ ...all, [drawingTool]: { ...all[drawingTool], [key]: value } }))
  const drawingHardnessRef = useRef(100)
  const [pointerOnDrawingCanvas, setPointerOnDrawingCanvas] = useState(false)
  const currentStrokeRef = useRef<StrokePoint[]>([])
  // The stroke in progress's width, in world units: the brush's size on
  // screen at the zoom it was begun at.
  const strokeWidthRef = useRef(3)
  // The zoom it was begun at: its picture keeps the detail it was drawn with.
  const strokeZoomRef = useRef(1)
  const isDrawingModeRef = useRef(false)
  const isEraserModeRef = useRef(false)
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawingColorRef = useRef('#ffffff')
  const drawingWidthRef = useRef(3)
  const smoothedPointRef = useRef<{ x: number; y: number } | null>(null)
  const drawingSmoothingRef = useRef(30)
  const brushCursorRef = useRef<HTMLDivElement>(null)

  // Floating view (Profile > Animations): the grid's layer here and the
  // world's layer in TraceOverlay drift together, always, by the same CSS
  // animation -- run by the compositor, so it stays smooth however busy the
  // page is. Not while drawing: the strokes are on a canvas of their own.

  // ---- The drawing being drawn --------------------------------------------------
  //
  // A drawing is one trace, "Drawing N", made with its first stroke: every
  // stroke and eraser stroke after it goes into what it keeps (lib/brushes
  // StrokeData), in order, and its box grows to hold them. Nothing waits for
  // Save: each is written as it's let go of (lib/drawingFiles writeDrawing),
  // and one step of the atrium's own undo (lib/actionHistory, which
  // TraceOverlay keeps). Its picture file is made when drawing ends -- a copy
  // for what reads files; the canvas paints from what's kept. Split into
  // Strokes takes a drawing apart (TraceOverlay); a group of strokes drawn on
  // gets its new strokes as strokes of their own, in it.
  //
  // The eraser takes out of everything of the drawing it crosses. While
  // drawing, what's drawn on is kept off TraceOverlay (hiddenTraceIds) and
  // painted on the drawing canvas instead, so the eraser is seen working on
  // it, with the strokes and erasures not written yet painted over it, in
  // order, until they are.
  type Unsettled = { kind: 'stroke'; piece: Piece } | { kind: 'erase'; stroke: Stroke }
  interface DrawingSession {
    // The drawing new strokes go into, once there is one.
    targetId: string | null
    // A group of strokes being drawn on: new strokes go into it, a trace each.
    groupId: string | null
    // A drawing from before strokes were kept, being drawn on: the new
    // drawing goes just above it.
    anchorId: string | null
    // What the eraser reaches: the drawing, or the group's strokes.
    members: Set<string>
    unsettled: Unsettled[]
    // The writing, one change at a time, in the order they were made.
    queue: Promise<void>
  }
  const sessionRef = useRef<DrawingSession | null>(null)
  // What's drawn on, which TraceOverlay leaves to the drawing canvas.
  const [drawingMembers, setDrawingMembers] = useState<ReadonlySet<string>>(() => new Set())
  // Whether the drawing canvas is up: while drawing, and after, until the
  // last stroke is written and shows as a trace in its place.
  const [drawingLive, setDrawingLive] = useState(false)
  const drawingLiveRef = useRef(false)
  drawingLiveRef.current = drawingLive
  const [editingDrawing, setEditingDrawing] = useState(false)
  const drawingVersionRef = useRef(0)
  const redrawDrawing = () => {
    drawingVersionRef.current++
    renderDrawingCanvasRef.current()
  }
  const enqueueDrawing = (session: DrawingSession, work: () => Promise<void>) => {
    session.queue = session.queue.then(work).catch(err => console.error('[drawing]', err))
    return session.queue
  }
  const joinDrawing = (session: DrawingSession, id: string) => {
    session.members.add(id)
    holdDrawingFiles([id])
    setDrawingMembers(new Set(session.members))
  }

  // A trace made by drawing, its own step of undo: taken away and put back --
  // as it is when it's taken, not as it was made.
  const madeStep = (made: Trace) => {
    let kept = made
    return {
      label: 'drawing made',
      undo: () => {
        kept = useGameStore.getState().traces.find(tr => tr.id === made.id) ?? kept
        return dropStrokes([kept])
      },
      redo: () => restoreStrokes([kept]),
    }
  }

  // A new trace of drawing -- a drawing, or a stroke of a group -- written
  // now, from a stroke's piece (rasterizeStroke), with its picture.
  const insertDrawn = async (piece: Piece, kind: 'drawing' | 'stroke', fields: { content: string; layer_id: string | null; order_key: string | null }) => {
    const mediaUrl = await saveDrawingPicture(piece.picture, lobbyId, userId)
    const { data, error } = await supabase!.from('traces').insert({
      user_id: userId,
      username,
      type: 'image',
      lobby_id: lobbyId,
      show_border: false,
      show_background: false,
      show_description: false,
      show_filename: false,
      ...pictureRow(pieceFields({ ...piece, data: piece.data && { ...piece.data, kind } }, mediaUrl)),
      ...fields,
    } as any).select()
    if (error || !data?.[0]) throw error ?? new Error('no row came back')
    const trace = mapRowToTrace(data[0])
    // Its own step, recorded below, rather than an addition TraceOverlay would
    // record when it sees it arrive.
    adoptTraces([trace.id])
    useGameStore.getState().addTrace(trace)
    recordAction(madeStep(trace))
    return trace
  }

  // A stroke let go of: shown at once, written behind it.
  const settleStroke = (session: DrawingSession, stroke: Stroke, zoom: number) => {
    // Its file as sharp as this screen shows it: at the zoom alone, a screen
    // of more pixels than points (Windows at 125%, 150%) saw every drawing
    // as too coarse, and painted each from its strokes instead -- one canvas
    // a stroke, which hundreds of made slow to move around.
    const piece = rasterizeStroke(stroke, zoom * (window.devicePixelRatio || 1))
    if (!piece) return
    const op: Unsettled = { kind: 'stroke', piece }
    session.unsettled.push(op)
    redrawDrawing()
    void enqueueDrawing(session, async () => {
      try {
        if (useGameStore.getState().isLobbyFull()) {
          showToast(lobbyFullMessage())
          return
        }
        const { traces: all, layers } = useGameStore.getState()
        const target = session.targetId ? all.find(tr => tr.id === session.targetId) : undefined
        const kept = target && asStrokeData(target.strokeData)
        if (target && kept && target.width && target.height) {
          // Into the drawing, in its own units, its box grown to hold it.
          const placement = placementOf(target)
          const grown = fitBox({ ...kept, kind: 'drawing', ops: [...kept.ops, strokeToLocal(stroke, placement)] }, target.width, target.height, true)
          const moved = localToWorldDelta(grown.dx, grown.dy, placement)
          const before = { strokeData: kept, x: target.x, y: target.y, width: target.width, height: target.height }
          const after = { strokeData: grown.data, x: target.x + moved.x, y: target.y + moved.y, width: grown.width, height: grown.height }
          await writeDrawing(target.id, after)
          recordAction({ label: 'drawing stroke', undo: () => writeDrawing(target.id, before), redo: () => writeDrawing(target.id, after) })
          return
        }
        if (session.groupId) {
          // A stroke of its own, over the group's others.
          const groupId = session.groupId
          const inGroup = inOrder(all.filter(tr => tr.layerId === groupId))
          let top = -1
          inGroup.forEach((tr, i) => { if (session.members.has(tr.id)) top = i })
          const trace = await insertDrawn(piece, 'stroke', {
            content: firstFreeName(inGroup.map(tr => tr.content), n => t('atrium.layers.numberedStroke', { n })),
            layer_id: groupId,
            order_key: keyAt(inGroup, top + 1) ?? keysOnTopOfGroup(inGroup, groupId)[0],
          })
          joinDrawing(session, trace.id)
          return
        }
        // A new drawing, this its first stroke: just above the drawing from
        // before being drawn on, or on top of everything.
        const anchor = session.anchorId ? all.find(tr => tr.id === session.anchorId) : undefined
        const stack = topLevel(all, layers)
        const above = anchor && !groupIdOf(anchor, layers) ? inOrder(stack).findIndex(item => item.id === anchor.id) + 1 : -1
        const trace = await insertDrawn(piece, 'drawing', {
          content: firstFreeName([...all.map(tr => tr.content), ...layers.map(l => l.name)], n => t('atrium.layers.numberedDrawing', { n })),
          layer_id: null,
          order_key: (above > 0 ? keyAt(stack, above) : null) ?? newTraceOrderFields(all, layers)[0].order_key,
        })
        session.targetId = trace.id
        joinDrawing(session, trace.id)
      } catch (err: any) {
        console.error('[drawing] could not save a stroke:', err)
        showToast(t('atrium.draw.strokeSaveFailed', { message: err?.message ?? '' }))
      } finally {
        session.unsettled.splice(session.unsettled.indexOf(op), 1)
        redrawDrawing()
      }
    })
  }

  // An erasure, made or taken back. A kept drawing takes the eraser into what
  // it keeps; a drawing from before, its picture painted again without it;
  // either, erased entirely, is deleted -- and put back.
  type Erased =
    | { trace: Trace; kept: StrokeData; after: StrokeData | null }
    | { trace: Trace; kept: null; after: Partial<PictureFields> | null }
  const applyErase = async (changes: Erased[], direction: 'forward' | 'back') => {
    const whole = changes.filter(c => !c.after).map(c => c.trace)
    await (direction === 'forward' ? dropStrokes(whole) : restoreStrokes(whole))
    await Promise.all(changes.filter(c => c.after).map(c => (c.kept
      ? writeDrawing(c.trace.id, { strokeData: direction === 'forward' ? c.after as StrokeData : c.kept })
      : writePicture(c.trace.id, direction === 'forward' ? c.after as Partial<PictureFields> : pictureFieldsOf(c.trace)))))
  }

  // An eraser stroke let go of: shown at once, taken out of everything of the
  // drawing it reaches behind it.
  const settleErase = (session: DrawingSession, eraser: Stroke) => {
    const op: Unsettled = { kind: 'erase', stroke: eraser }
    session.unsettled.push(op)
    redrawDrawing()
    void enqueueDrawing(session, async () => {
      try {
        const changes: Erased[] = []
        for (const trace of useGameStore.getState().traces) {
          if (!session.members.has(trace.id) || !trace.mediaUrl) continue
          const kept = asStrokeData(trace.strokeData)
          if (kept && trace.width && trace.height) {
            const left = eraseStrokeData(kept, trace.width, trace.height, strokeToLocal(eraser, placementOf(trace)), paintedDrawing(trace) ?? undefined)
            if (left !== 'untouched') changes.push({ trace, kept, after: left && left.data })
            continue
          }
          // A drawing from before: its picture, painted again without it.
          const picture = cachedPicture(trace.mediaUrl)
          if (!picture) continue
          const left = erasePicture(picture, placementOf(trace, picture), eraser)
          if (left === 'untouched') continue
          changes.push({ trace, kept: null, after: left && pieceFields(left, await saveDrawingPicture(left.picture, lobbyId, userId)) })
        }
        if (changes.length === 0) return
        await applyErase(changes, 'forward')
        recordAction({
          label: 'drawing eraser',
          undo: () => applyErase(changes, 'back'),
          redo: () => applyErase(changes, 'forward'),
        })
      } catch (err: any) {
        console.error('[drawing] could not save an erasure:', err)
        showToast(t('atrium.draw.strokeSaveFailed', { message: err?.message ?? '' }))
      } finally {
        session.unsettled.splice(session.unsettled.indexOf(op), 1)
        redrawDrawing()
      }
    })
  }

  // Clear: everything drawn on deleted, as one step.
  const clearDrawing = () => {
    const session = sessionRef.current
    if (!session) return
    void enqueueDrawing(session, async () => {
      const gone = useGameStore.getState().traces.filter(tr => session.members.has(tr.id))
      if (gone.length === 0) return
      await dropStrokes(gone)
      recordAction({ label: 'drawing cleared', undo: () => restoreStrokes(gone), redo: () => dropStrokes(gone) })
    })
  }

  // Undo and redo: TraceOverlay's, once every stroke drawn so far is written
  // -- each is a step from then. For the buttons, and the keys while drawing.
  const stepHistory = async (direction: 'undo' | 'redo') => {
    await sessionRef.current?.queue
    window.dispatchEvent(new Event(direction === 'undo' ? 'atrium:undo' : 'atrium:redo'))
  }

  // Into drawing mode: a new drawing, or -- Edit Drawing -- one drawn before.
  // A kept drawing is drawn into; a group of strokes (drawingOf) gets new
  // strokes of its own; a drawing from before strokes were kept has its
  // picture loaded, so the eraser can reach it, and new strokes make a new
  // drawing just above it. One whose picture can't be read is left out: on
  // the canvas as it is, out of the eraser's reach.
  const startDrawing = async (editTraceId?: string) => {
    if (!canEditRef.current) return
    // A drawing still being written is finished first.
    await sessionRef.current?.queue
    let members: Trace[] = []
    let targetId: string | null = null
    let groupId: string | null = null
    let anchorId: string | null = null
    if (editTraceId) {
      const { traces: all, layers } = useGameStore.getState()
      const trace = all.find(tr => tr.id === editTraceId)
      if (!trace) return
      const drawing = drawingOf(trace, all, layers)
      const loaded = await Promise.all(drawing.members.map(m => (
        asStrokeData(m.strokeData) ? Promise.resolve(true) : m.mediaUrl ? loadDrawingPicture(m.mediaUrl) : Promise.resolve(null)
      )))
      members = drawing.members.filter((_, i) => loaded[i])
      if (!members.some(m => m.id === editTraceId)) {
        showToast(t('atrium.draw.editLoadFailed'))
        return
      }
      if (drawing.groupId) groupId = drawing.groupId
      else if (asStrokeData(trace.strokeData)) targetId = trace.id
      else anchorId = trace.id
    }
    sessionRef.current = { targetId, groupId, anchorId, members: new Set(members.map(m => m.id)), unsettled: [], queue: Promise.resolve() }
    holdDrawingFiles(members.map(m => m.id))
    setDrawingMembers(new Set(members.map(m => m.id)))
    setEditingDrawing(!!editTraceId)
    drawingVersionRef.current++
    setDrawingLive(true)
    setIsEraserMode(false)
    setIsDrawingMode(true)
  }

  // Out of drawing mode, whichever way. Everything drawn is written already,
  // or on its way: the canvas stays up until it is, then the drawing shows in
  // its place, and its picture file is made.
  const leaveDrawing = () => {
    setIsDrawingMode(false)
    setIsEraserMode(false)
    setIsDrawing(false)
    currentStrokeRef.current = []
    const session = sessionRef.current
    if (!session) return
    void session.queue.then(() => {
      releaseDrawingFiles(session.members)
      if (sessionRef.current !== session) return
      sessionRef.current = null
      setDrawingMembers(new Set())
      setDrawingLive(false)
      setEditingDrawing(false)
    })
  }
  const toggleDrawing = () => {
    if (isDrawingModeRef.current) leaveDrawing()
    else void startDrawing()
  }
  // Taking up Move the view puts down whatever tool was in hand.
  const togglePanTool = () => {
    if (!panToolRef.current) {
      setPlaceTool(null)
      setLaserActive(false)
      if (isDrawingModeRef.current) leaveDrawing()
    }
    setPanTool(!panToolRef.current)
  }
  const togglePanToolRef = useRef(togglePanTool)
  togglePanToolRef.current = togglePanTool
  // The readout's Move the view, held: the pointer locked away (hidden, and
  // not stopped by the screen's edge), each movement of the mouse moving the
  // view -- the atrium follows the mouse, as when dragged -- until it's let
  // go. Without a lock (refused), the press is held all the same.
  const [holdPanning, setHoldPanning] = useState(false)
  const holdToPan = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const button = event.currentTarget
    button.setPointerCapture(event.pointerId)
    try { void (button.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}) } catch { /* held without a lock */ }
    cameraFlyToRef.current = null
    setHoldPanning(true)
    const move = (e: PointerEvent) => {
      cameraPositionRef.current.x -= e.movementX / zoomRef.current
      cameraPositionRef.current.y -= e.movementY / zoomRef.current
    }
    const end = () => {
      button.removeEventListener('pointermove', move)
      button.removeEventListener('pointerup', end)
      button.removeEventListener('pointercancel', end)
      button.removeEventListener('lostpointercapture', end)
      if (document.pointerLockElement === button) document.exitPointerLock()
      setHoldPanning(false)
    }
    button.addEventListener('pointermove', move)
    button.addEventListener('pointerup', end)
    button.addEventListener('pointercancel', end)
    button.addEventListener('lostpointercapture', end)
  }
  // The key handler is registered once; these change every render.
  const drawingKeysRef = useRef({ toggleDrawing, leaveDrawing, stepHistory })
  drawingKeysRef.current = { toggleDrawing, leaveDrawing, stepHistory }

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
  //
  // White, taking the difference with what's under it (mix-blend-mode, below):
  // dark over light, light over dark, as the cursor's outline is. Never the
  // brush colour -- one close to what's beneath made the circle vanish -- and
  // no longer black or white by the atrium's background alone, which did the
  // same over a trace of that lightness.
  useEffect(() => {
    const el = brushCursorRef.current
    if (!el) return
    el.style.width = `${drawingWidth}px`
    el.style.height = `${drawingWidth}px`
    el.style.borderStyle = isEraserMode ? 'dashed' : 'solid'
  }, [drawingWidth, isEraserMode, isDrawingMode])
  // The drawing's strokes are traces: painted again when they change.
  useEffect(() => {
    if (drawingLiveRef.current) redrawDrawing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traces])
  useEffect(() => { drawingBrushRef.current = drawingBrush }, [drawingBrush])
  useEffect(() => { drawingHardnessRef.current = drawingHardness }, [drawingHardness])
  // The canvas stops taking the pointer without a pointerleave, so the flag
  // would outlive it.
  useEffect(() => {
    if (!isDrawingMode) setPointerOnDrawingCanvas(false)
  }, [isDrawingMode])

  // Imported brushes live in the vault, so only desktop has any. Read once,
  // the first time drawing opens, and only what makeBrushTip would have made.
  useEffect(() => {
    if (!isDrawingMode || !isDesktop || customBrushesLoadedRef.current) return
    customBrushesLoadedRef.current = true
    void (async () => {
      try {
        const { readVaultBrushes } = await import('../lib/localDb')
        const stored = await readVaultBrushes()
        const brushes = (Array.isArray(stored) ? stored : []).filter(isCustomBrush)
        const usable: CustomBrush[] = []
        for (const brush of brushes) if (await registerCustomBrush(brush)) usable.push(brush)
        setCustomBrushes(usable)
      } catch (err) {
        console.error('[brushes] could not read the vault\'s brushes:', err)
      }
    })()
  }, [isDrawingMode])

  const saveCustomBrushes = async (next: CustomBrush[]) => {
    setCustomBrushes(next)
    try {
      const { writeVaultBrushes } = await import('../lib/localDb')
      await writeVaultBrushes(next)
    } catch (err) {
      console.error('[brushes] could not save to the vault:', err)
      showToast(t('atrium.draw.brushSaveFailed'))
    }
  }

  const importBrush = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Cleared so choosing the same file again still counts as a change.
    e.target.value = ''
    if (!file) return
    const tip = await makeBrushTip(file)
    const brush: CustomBrush | null = tip
      ? { id: crypto.randomUUID(), name: file.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Brush', tip }
      : null
    if (!brush || !(await registerCustomBrush(brush))) {
      showToast(t('atrium.draw.brushImportFailed'))
      return
    }
    setDrawingBrush(customBrushKey(brush.id))
    await saveCustomBrushes([...customBrushes, brush])
  }

  const removeCustomBrush = async (id: string) => {
    if (drawingBrush === customBrushKey(id)) setDrawingBrush('pen')
    await saveCustomBrushes(customBrushes.filter(b => b.id !== id))
  }

  // Pressure only from a pen. A mouse reports 0.5 whenever a button is down
  // and a finger reports 0 or 1, and neither says anything about thickness.
  const strokePoint = (x: number, y: number, pointerType: string, pressure: number): StrokePoint =>
    pointerType === 'pen' ? { x, y, p: pressure } : { x, y }

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary || !isDrawing) return
    setIsDrawing(false)
    const points = currentStrokeRef.current
    currentStrokeRef.current = []
    const session = sessionRef.current
    if (!session || points.length === 0) return
    const stroke: Stroke = {
      points: [...points],
      color: drawingColorRef.current,
      width: strokeWidthRef.current,
      isEraser: isEraserModeRef.current,
      brush: drawingBrushRef.current,
      seed: currentSeedRef.current,
      hardness: drawingHardnessRef.current / 100,
    }
    if (stroke.isEraser) settleErase(session, stroke)
    else settleStroke(session, stroke, strokeZoomRef.current)
  }

  const addStrokeSample = (raw: StrokePoint) => {
    // Cap below 1.0 -- at exactly 100% alpha becomes 0 and the smoothed point
    // never moves from its starting position, turning the stroke into a pile
    // of coincident points.
    const smoothing = computeSmoothingFactor(drawingSmoothingRef.current)
    if (smoothing > 0 && smoothedPointRef.current) {
      // Exponential moving average: lerp from smoothed toward raw
      const alpha = 1 - smoothing
      const sx = smoothedPointRef.current.x + (raw.x - smoothedPointRef.current.x) * alpha
      const sy = smoothedPointRef.current.y + (raw.y - smoothedPointRef.current.y) * alpha
      smoothedPointRef.current = { x: sx, y: sy }
      currentStrokeRef.current.push({ x: sx, y: sy, p: raw.p })
    } else {
      smoothedPointRef.current = { x: raw.x, y: raw.y }
      currentStrokeRef.current.push(raw)
    }
  }

  // The view the drawing is seen through: the world container's, which the
  // camera moves every frame.
  const drawView = (): View => ({ x: worldContainerRef.current?.x ?? 0, y: worldContainerRef.current?.y ?? 0, zoom: zoomRef.current })

  const renderDrawingCanvas = () => {
    const canvas = drawingCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const view = drawView()
    const layer = committedLayerRef.current ??= { canvas: document.createElement('canvas'), version: -1, view: null }
    if (layer.canvas.width !== canvas.width || layer.canvas.height !== canvas.height) {
      layer.canvas.width = canvas.width
      layer.canvas.height = canvas.height
      layer.version = -1
    }
    if (layer.version !== drawingVersionRef.current || !sameView(layer.view, view)) {
      const layerCtx = layer.canvas.getContext('2d')
      if (!layerCtx) return
      layerCtx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
      const session = sessionRef.current
      if (session) {
        // The drawing's strokes as saved, in their order, then what's still
        // being saved, in the order it was done.
        const saved = inOrder(useGameStore.getState().traces.filter(tr => session.members.has(tr.id)))
        for (const trace of saved) {
          const picture = paintedDrawing(trace) ?? (trace.mediaUrl ? cachedPicture(trace.mediaUrl) : undefined)
          if (picture) drawPlacedPicture(layerCtx, picture, placementOnScreen(placementOf(trace, picture), view))
        }
        for (const op of session.unsettled) {
          if (op.kind === 'stroke') drawPlacedPicture(layerCtx, op.piece.picture, placementOnScreen(op.piece.placement, view))
          else drawStroke(layerCtx, strokeOnScreen(op.stroke, view))
        }
      }
      layer.version = drawingVersionRef.current
      layer.view = view
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(layer.canvas, 0, 0)
    // The stroke in progress; an eraser takes out of what's under it.
    if (currentStrokeRef.current.length >= 1) {
      drawStroke(ctx, strokeOnScreen({
        points: currentStrokeRef.current,
        color: drawingColorRef.current,
        width: strokeWidthRef.current,
        isEraser: isEraserModeRef.current,
        brush: drawingBrushRef.current,
        seed: currentSeedRef.current,
        hardness: drawingHardnessRef.current / 100,
      }, view))
    }
  }
  const renderDrawingCanvasRef = useRef(renderDrawingCanvas)
  renderDrawingCanvasRef.current = renderDrawingCanvas

  // Canvas resize effect
  useEffect(() => {
    if (!drawingLive) return
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
  }, [drawingLive])

  // Put the renderer back in step with the window when the two drift apart.
  //
  // For the bug this exists for: on the desktop build the grid sometimes stops
  // short of the edge of the screen, and at the same time clicks in the layer
  // panel land slightly off the thing they are aimed at, until the app is
  // restarted. Those two look unrelated and are the same fact -- the page is
  // laid out for a viewport that is no longer the one on screen. The canvas is
  // then sized to the old viewport and stops early, and the browser hit-tests
  // DOM against a box that has moved.
  //
  // WebView2 gets into that state on a scale change: the window crossing to a
  // monitor with different display scaling, scaling being changed while the app
  // runs, or a display waking up. `resizeTo: window` only listens for resize,
  // and a scale change need not come with one.
  //
  // So the size is compared rather than trusted, on every signal that a window
  // might have changed underneath us -- and, importantly, on focus. Even where
  // this cannot prevent the desync it means alt-tabbing away and back repairs
  // it, instead of the app having to be restarted.
  //
  // Cheap enough to be worth doing on all of them: a comparison of two numbers,
  // and a resize only when they actually differ.
  useEffect(() => {
    let dpiQuery: MediaQueryList | null = null

    function resync() {
      const app = appRef.current
      if (!app) return
      const width = window.innerWidth
      const height = window.innerHeight
      if (app.screen.width !== width || app.screen.height !== height) {
        app.renderer.resize(width, height)
        // Redrawn at once rather than waiting for the render loop's every-other
        // frame, so the gap at the edge closes in the same paint as the resize.
        updateGridRef.current?.()
      }
    }

    // A media query is the only way to hear about devicePixelRatio changing.
    // It matches one exact ratio, so it has to be rebuilt around the new value
    // every time it fires -- otherwise it reports the first change and nothing
    // after it.
    function onScaleChange() {
      resync()
      watchScale()
    }

    function watchScale() {
      dpiQuery?.removeEventListener('change', onScaleChange)
      dpiQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      dpiQuery.addEventListener('change', onScaleChange)
    }

    window.addEventListener('resize', resync)
    window.addEventListener('focus', resync)
    document.addEventListener('visibilitychange', resync)
    watchScale()

    return () => {
      window.removeEventListener('resize', resync)
      window.removeEventListener('focus', resync)
      document.removeEventListener('visibilitychange', resync)
      dpiQuery?.removeEventListener('change', onScaleChange)
    }
  }, [])

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

  // Check the Pinterest connection once per atrium visit, to decide whether to
  // show the import button. Asked on both platforms now: on desktop the answer
  // comes from whether this install is linked to a web account that has one.
  // Connected on the web from in here, the page came back to the atrium and
  // the import it was for opens now -- whether the connection was already
  // made when the atrium loaded, or lands a moment after (App announces it).
  useEffect(() => {
    const openImportIfWanted = () => {
      if (!takeImportAfterPinterestConnect()) return
      setPinterestImportAnchor(null)
      setShowPinterestImport(true)
    }
    getPinterestConnectionStatus().then(({ connected }) => {
      setPinterestConnected(connected)
      if (connected) openImportIfWanted()
    })
    const onConnected = () => {
      setPinterestConnected(true)
      setShowPinterestConnect(false)
      openImportIfWanted()
    }
    window.addEventListener(PINTEREST_CONNECTED_EVENT, onConnected)
    return () => window.removeEventListener(PINTEREST_CONNECTED_EVENT, onConnected)
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
      packingShapeRef.current = readPackingShape(lobbyId)
    } catch {
      // Ignore localStorage access failures
    }

    const handlePackingShapeChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ lobbyId: string | null; shape: 'square' | 'circle' }>
      // A null lobbyId means the setting was changed from outside an atrium
      // (the welcome screen's profile settings), so it applies here too.
      if (customEvent.detail?.lobbyId && customEvent.detail.lobbyId !== lobbyId) return
      packingShapeRef.current = customEvent.detail.shape
    }

    window.addEventListener('lobby-packing-shape-changed', handlePackingShapeChanged as EventListener)
    return () => {
      window.removeEventListener('lobby-packing-shape-changed', handlePackingShapeChanged as EventListener)
    }
  }, [lobbyId])

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
  
  // T key shortcut to open trace panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl with a zoom key is the webview's own page zoom, and it is never
      // wanted here -- scaling the whole interface is not what someone means by
      // zooming a canvas. Swallowed before the typing check, since it applies
      // just as much while a text field has focus.
      if (e.ctrlKey && ['+', '=', '-', '_', '0'].includes(e.key)) {
        e.preventDefault()
      }

      // Don't trigger if user is typing in an input.
      //
      // Through the shared test, which knows a slider is not typing. This was
      // a bare instanceof HTMLInputElement, and it is the handler the drawing
      // keys live in -- so undo, redo, Enter, Delete and Escape all went quiet
      // the moment the brush width or smoothing slider took focus.
      if (isEditableTarget(e.target)) return

      // Move the view: H takes it up and puts it down, Escape puts it down.
      if (e.code === 'KeyH' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && !isDrawingModeRef.current) {
        e.preventDefault()
        togglePanToolRef.current()
        return
      }
      if (e.key === 'Escape' && panToolRef.current) setPanTool(false)
      
      // Keyboard zoom, for anyone without a wheel and as a precise alternative
      // to one. Deliberately +/-/0 rather than the arrow keys: left and right
      // already step through saved locations in presentation mode, and
      // splitting one key group across two unrelated jobs reads as a mistake.
      // These are also what browsers, maps and design tools use.
      //
      // Holding Ctrl makes the step a fine one. A key that repeats while held
      // covers ground fast, so the coarse step is really a "get there" control
      // and there was nothing for arriving precisely -- which is the job the
      // keyboard is better at than any pointing device.
      const zoomStep = e.ctrlKey ? KEYBOARD_ZOOM_STEP_FINE : KEYBOARD_ZOOM_STEP
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        applyZoomDelta(zoomStep)
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        applyZoomDelta(-zoomStep)
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        cameraFlyToRef.current = null
        targetZoomRef.current = 1
        return
      }
      // Shift+1 frames the traces, as Excalidraw's zoom to fit.
      if (e.code === 'Digit1' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        recenter()
        return
      }

      // The quick bar's keys: 1 to 9 pick its first nine tools, in the order
      // shown -- while drawing too, which a tool picked ends; Esc lets go of
      // an armed one.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault()
        setExportOf({ ids: selectionRef.current })
        return
      }
      if ((e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        if (isDrawingModeRef.current) drawingKeysRef.current.leaveDrawing()
        setPlaceTool(null)
        setLaserActive(on => !on)
        return
      }
      if (e.key === 'Escape' && laserActiveRef.current) setLaserActive(false)
      if (e.key === 'Escape' && placeToolRef.current) {
        setPlaceTool(null)
        placeStartRef.current = null
        if (placePreviewRef.current) placePreviewRef.current.style.display = 'none'
      }
      if (/^[1-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && canEditRef.current) {
        // Shapes takes up its shape in use; Other, a choice, has no key.
        const button = QUICK_ORDER[Number(e.key) - 1]
        const action = button === 'shape' ? shapeKindRef.current : button === 'other' ? null : button
        if (action) {
          e.preventDefault()
          quickActionRef.current(action)
        }
        return
      }

      // T: an embed's link asked for where the pointer is.
      if (e.key === 't' || e.key === 'T') {
        if (!canEditRef.current) return
        e.preventDefault()
        e.stopPropagation()
        const at = { x: positionRef.current.x, y: positionRef.current.y }
        setEmbedAsk(open => (open ? null : { world: at, screen: onScreenRef.current(at) }))
      }
      if (e.key === 'd' || e.key === 'D') {
        if (!canEditRef.current) return
        e.preventDefault()
        e.stopPropagation()
        drawingKeysRef.current.toggleDrawing()
      }
      if (e.key === 'e' || e.key === 'E') {
        if (isDrawingModeRef.current) {
          e.preventDefault()
          e.stopPropagation()
          setIsEraserMode(prev => !prev)
        }
      }
      // The drawing's own keys. TraceOverlay's Ctrl+Z (trace undo/redo) and
      // its Delete (remove selected traces) both step aside while
      // isDrawingMode is active -- see the isDrawingModeRef guards there. Undo
      // is TraceOverlay's still, once the strokes drawn are saved (stepHistory).
      if (isDrawingModeRef.current) {
        const mod = e.ctrlKey || e.metaKey
        if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault()
          e.stopPropagation()
          void drawingKeysRef.current.stepHistory('undo')
        }
        // Ctrl+Y as well as Ctrl+Shift+Z: the first is what Windows apps use,
        // the second what design tools do, and people arrive from both.
        if (mod && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) {
          e.preventDefault()
          e.stopPropagation()
          void drawingKeysRef.current.stepHistory('redo')
        }
        // Escape leaves. Every stroke is kept already.
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          drawingKeysRef.current.leaveDrawing()
        }
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
  
  // One of Layers and Locations at a time. They both dock on the right, so two
  // open at once stack over each other and over the canvas.
  useEffect(() => {
    if (!showLayerPanel) return
    setShowLocationsPanel(false)
  }, [showLayerPanel])
  useEffect(() => {
    if (!showLocationsPanel) return
    setShowLayerPanel(false)
  }, [showLocationsPanel])

  // A shape made straight away, with no panel: from the create panel's Path,
  // and from the quick bar's Rectangle, Circle and Path. Centred on `at`, at a
  // size when one is given (a path's is its points'). Named Shape N or Path N.
  // There at once (lib/traceWrites), written behind; its id.
  const insertShapeTrace = async (
    style: ShapeStyle,
    at: { x: number; y: number },
    points?: { x: number; y: number }[],
    size?: { width: number; height: number },
  ) => {
    if (!userId) return null
    if (!ensureLobbyHasSpace()) return null
    const { traces: all, layers } = useGameStore.getState()
    const isPath = style.shapeType === 'path'
    const trace = insertTrace({
      user_id: userId,
      username,
      type: 'shape',
      content: nextShapeName(all, isPath, n => t(isPath ? 'atrium.layers.numberedPath' : 'atrium.layers.numberedShape', { n })),
      position_x: at.x,
      position_y: at.y,
      media_url: null,
      scale: 1.0,
      rotation: 0.0,
      border_radius: 0,
      lobby_id: lobbyId,
      show_description: false,
      show_filename: false,
      ...shapeStyleColumns(style),
      show_border: false,
      show_background: false,
      ...(size ? { width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) } : {}),
      ...(points ? { shape_points: points } : {}),
      ...newTraceOrderFields(all, layers)[0],
    }, message => showToast(isPath
      ? t('atrium.error.pathFailed', { message })
      : t('atrium.error.traceSaveFailed', { message })))
    return trace.id
  }

  // ---- The quick bar (QuickBar) ---------------------------------------------

  // The scale a new trace is made at, so it's its usual size on screen however
  // far the view is zoomed: 2 at half zoom. Two decimals, as the panel shows it.
  const scaleForZoom = () => Math.round(100 / (zoomRef.current || 1)) / 100

  const screenToWorld = (sx: number, sy: number) => {
    const c = worldContainerRef.current
    return c ? { x: (sx - c.x) / zoomRef.current, y: (sy - c.y) / zoomRef.current } : { x: sx, y: sy }
  }

  // Pinterest's board import, placing at `anchor` -- or, not connected yet,
  // connecting it first, right here: the same panel the welcome screen opens
  // (desktop links with a code from the browser; the web goes to Pinterest and
  // comes back to this atrium), and on into the import once it's done. It
  // used to send you out to the welcome screen to do it.
  const openPinterestImport = (anchor: { x: number; y: number } | null) => {
    setPinterestImportAnchor(anchor)
    if (pinterestConnected) setShowPinterestImport(true)
    else setShowPinterestConnect(true)
  }

  // An .atrium file's traces added to this atrium, centred on `at`, as one
  // step of undo (lib/atriumFile importIntoAtrium); said how it went.
  const atriumFileInputRef = useRef<HTMLInputElement>(null)
  const importAnchorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const importAtriumHere = async (file: File, at: { x: number; y: number }) => {
    if (!canEditRef.current || !userId) return
    try {
      const parsed = parseAtriumFile(await file.text())
      setImportProgress({ done: 0, total: 1, percent: true })
      const result = await importIntoAtrium(parsed, at, lobbyId, userId, (done, total) => setImportProgress({ done, total, percent: true }))
      const said = [tCount('atrium.import.added', result.added)]
      if (result.missing > 0) said.push(t('atrium.import.missing', { count: result.missing }))
      if (result.failed > 0) said.push(t('atrium.import.refused', { count: result.failed }))
      showToast(said.join(' · '))
    } catch (e: any) {
      if (e instanceof ImportTooLargeError) {
        showToast(t('atrium.import.tooLarge', { needed: (e.needed / (1024 * 1024)).toFixed(1), free: (e.free / (1024 * 1024)).toFixed(1) }))
      } else if (e instanceof AtriumFileError) {
        showToast(t(e.reason === 'badVersion' ? 'transfer.import.badVersion' : e.reason === 'badFormat' ? 'transfer.import.badFormat' : 'transfer.import.parseFailed'))
      } else {
        showToast(t('atrium.import.failed', { message: e?.message ?? '' }))
      }
    } finally {
      setImportProgress(null)
    }
  }

  // A spreadsheet's sheets and charts, placed centred on `at` (lib/sheetTraces).
  const spreadsheetInputRef = useRef<HTMLInputElement>(null)
  // The quick bar's Image and Other's sound and PDF: picked, then placed.
  const traceFileInputRef = useRef<HTMLInputElement>(null)
  // Where an embed's link is being asked for (EmbedLinkBox): the world point
  // it will be centred on, and where on the screen that is.
  const [embedAsk, setEmbedAsk] = useState<{ world: { x: number; y: number }; screen: { x: number; y: number } } | null>(null)
  // A world point's place on the screen now.
  const onScreen = (p: { x: number; y: number }) => {
    const c = worldContainerRef.current
    return c ? { x: p.x * zoomRef.current + c.x, y: p.y * zoomRef.current + c.y } : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  }
  // The links given: one, an embed there; several, packed round it in the
  // person's arrangement for batches.
  const onScreenRef = useRef(onScreen)
  onScreenRef.current = onScreen
  const placeEmbeds = (urls: string[], at: { x: number; y: number }) => {
    setEmbedAsk(null)
    if (urls.length === 0 || !ensureLobbyHasSpace()) return
    if (urls.length === 1) void insertDroppedTrace('embed', urls[0], urls[0], at.x, at.y)
    else void handleCreateBatchEmbeds(urls, at)
  }
  // The shape the quick bar's Shapes takes up (and 3 does).
  const [shapeKind, setShapeKind] = useState<BoxShape>('rectangle')
  const shapeKindRef = useRef(shapeKind)
  shapeKindRef.current = shapeKind
  const importSpreadsheetHere = async (file: File, at: { x: number; y: number }) => {
    if (!canEditRef.current || !userId) return
    try {
      await importSpreadsheet(file, at, { lobbyId, userId, username })
    } catch (e: any) {
      console.error('Spreadsheet import failed:', file.name, e)
      showToast(t('atrium.sheet.failed', { name: file.name, message: e?.message ?? '' }))
    }
  }

  const quickAction = (action: QuickAction) => {
    if (!canEdit) return
    // Move the view: taken up and put down, as H does.
    if (action === 'pan') {
      setToolSwitch(n => n + 1)
      togglePanTool()
      return
    }
    // The bar always wins: a tool picked here ends whatever tool or mode was
    // under way -- drawing, and, in TraceOverlay, a path's points, crop mode,
    // a connection (toolSwitch).
    // Text being typed ends as the bar takes the focus.
    setToolSwitch(n => n + 1)
    setPanTool(false)
    if (action !== 'draw' && isDrawingModeRef.current) leaveDrawing()
    if (action === 'laser') {
      setPlaceTool(null)
      setLaserActive(on => !on)
      return
    }
    setLaserActive(false)
    if (action === 'select') {
      setPlaceTool(null)
      return
    }
    if (action === 'text' || isBoxShape(action) || action === 'path' || action === 'frame' || action === 'embed') {
      setMapContextMenu(null)
      setPlaceTool(prev => (prev === action ? null : action))
      return
    }
    setPlaceTool(null)
    // What's made from here goes in the middle of the view.
    const centre = screenToWorld(window.innerWidth / 2, window.innerHeight / 2)
    if (action === 'draw') {
      toggleDrawing()
    } else if (action === 'pinterest') {
      openPinterestImport(centre)
    } else if (action === 'image' || action === 'sound' || action === 'video' || action === 'document' || action === 'sheet') {
      // A file: picked, then placed in the middle of the view as a drop would
      // be (placeFilesAsTraces; a spreadsheet as its sheets). The web app
      // can't take files from the computer yet: said, as a dropped file has it.
      if (!isDesktop) {
        setShowLocalFileBlockedDialog(true)
        return
      }
      importAnchorRef.current = centre
      if (action === 'sheet') {
        spreadsheetInputRef.current?.click()
        return
      }
      const input = traceFileInputRef.current
      if (!input) return
      input.accept = TRACE_FILE_ACCEPT[action]
      input.click()
    }
  }
  const quickActionRef = useRef(quickAction)
  quickActionRef.current = quickAction

  // An armed tool let go of on the canvas: pressed at `start`, released at
  // `end`, both on screen. A drag gives a box its size (from corner to
  // corner; `even`, as big each way) and a path its two ends; a click puts a
  // text or a frame there at its usual size, or starts a path to click on
  // from. A rectangle or a circle needs the drag.
  const finishPlacing = async (tool: PlaceTool, start: { sx: number; sy: number; wx: number; wy: number }, end: { sx: number; sy: number }, even: boolean) => {
    // The tool stays in hand, to place another straight away, as Excalidraw
    // does -- all but Text, whose next click ends the typing it starts (and a
    // clicked Path's, below, for the same reason).
    if (tool === 'text') setPlaceTool(null)
    const a = { x: start.wx, y: start.wy }
    const b = screenToWorld(end.sx, end.sy)
    const dragged = Math.hypot(end.sx - start.sx, end.sy - start.sy) >= 6
    const least = tool === 'text' ? 24 : 10
    let width = Math.max(least, Math.abs(b.x - a.x)), height = Math.max(least, Math.abs(b.y - a.y))
    if (even) width = height = Math.max(width, height)
    const centre = { x: a.x + (b.x >= a.x ? width : -width) / 2, y: a.y + (b.y >= a.y ? height : -height) / 2 }
    // What's made is selected, with its Customize panel open.
    const customize = (id: string) => setCustomizeRequest([id])

    // An embed: asked for its link where the click was (EmbedLinkBox).
    if (tool === 'embed') {
      setPlaceTool(null)
      setEmbedAsk({ world: a, screen: { x: start.sx, y: start.sy } })
      return
    }

    if (tool === 'text') {
      // The box first, dragged out like a rectangle (or the usual size, for
      // a click), then straight into typing in it. It keeps that size until
      // the text outgrows it (TraceOverlay's fitTextLive).
      if (!ensureLobbyHasSpace()) return
      // Plain text: just the words, in whichever of black and white stands
      // out from the atrium's background as it is now.
      const look = plainText
        ? { showBorder: false, showBackground: false, showShadow: false, textColor: textColourOn(viewTheme?.backgroundColor) }
        : undefined
      const id = dragged
        ? await insertDroppedTrace('text', '', undefined, centre.x, centre.y, undefined, { width, height }, look)
        : await insertDroppedTrace('text', '', undefined, a.x, a.y, undefined, undefined, look)
      if (id) setNewTextTraceId({ id, drawn: dragged })
      return
    }
    if (tool === 'frame') {
      setFrameRequest(dragged ? { x: centre.x, y: centre.y, width, height, customize: true } : { x: a.x, y: a.y, customize: true })
      return
    }
    if (tool === 'path') {
      const style = nextShapeStyle('path')
      if (dragged) {
        const id = await insertShapeTrace(style, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, [a, b])
        if (id) customize(id)
      } else {
        // One point, and on into adding more, as the panel's Path does (its
        // Customize panel opens with it). The clicks that follow are that
        // path's points, so the tool is let go of, as Text's is.
        setPlaceTool(null)
        const id = await insertShapeTrace(style, a, [a])
        if (id) setNewPathTraceId(id)
      }
      return
    }
    // A click makes nothing: a shape at some default size, wherever a stray
    // click landed, only got in the way.
    if (!dragged) return
    const id = await insertShapeTrace(nextShapeStyle(tool), centre, undefined, { width, height })
    if (id) customize(id)
  }
  const finishPlacingRef = useRef(finishPlacing)
  finishPlacingRef.current = finishPlacing

  // The style what's being dragged out will have (nextShapeStyle), read once
  // as the press begins: a rectangle, circle or path is shown as it will be.
  const placeStyleRef = useRef<ShapeStyle | null>(null)
  // Counts presses, so letting go of one doesn't hide the next one's preview.
  const placePressRef = useRef(0)

  // What an armed tool is dragging out, from press to pointer on screen,
  // straight to the element -- no render, so it keeps up with the pointer. A
  // rectangle or circle painted as it will appear (lib/shapeStyle shapePaint,
  // as TraceOverlay paints shapes): colour, opacity, outline, corners. A path
  // as its line. A frame's or text box's outline, dashed. `even`: Shift, a
  // box as big each way. Hidden with no drag.
  const drawPlacePreview = (tool: PlaceTool | null, drag: { x1: number; y1: number; x2: number; y2: number; even: boolean } | null) => {
    const svg = placePreviewRef.current
    if (!svg) return
    if (!tool || !drag) {
      svg.style.display = 'none'
      return
    }
    let { x2, y2 } = drag
    const { x1, y1 } = drag
    if (drag.even && tool !== 'path') {
      const side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
      x2 = x1 + (x2 >= x1 ? side : -side)
      y2 = y1 + (y2 >= y1 ? side : -side)
    }
    const left = Math.min(x1, x2), top = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1)
    const [line, ellipse, rect, polygon] = Array.from(svg.children) as SVGElement[]
    const style = placeStyleRef.current
    const zoom = zoomRef.current
    const show = (el: SVGElement, shown: boolean, attrs: Record<string, number | string>, look: Partial<CSSStyleDeclaration>) => {
      el.style.display = shown ? '' : 'none'
      if (!shown) return
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
      Object.assign(el.style, look)
    }
    // A frame or text box: where it will go, dashed.
    const guide = { fill: 'rgb(var(--c-fg) / 0.08)', fillOpacity: '1', stroke: 'rgb(var(--c-fg) / 0.8)', strokeOpacity: '1', strokeWidth: '1.5', strokeDasharray: '6 4' }
    const paint = style ? shapePaint(style, zoom) : null
    const shapeLook = paint ? {
      fill: paint.fill, fillOpacity: String(paint.fillOpacity), stroke: paint.stroke,
      strokeOpacity: String(paint.strokeOpacity), strokeWidth: String(paint.strokeWidth), strokeDasharray: 'none',
    } : guide
    // The outline inside the box, as the shape keeps it (TraceOverlay's inset).
    const inset = paint ? Math.min(paint.strokeWidth / 2, w / 2, h / 2) : 0

    show(line, tool === 'path', { x1, y1, x2, y2 }, {
      stroke: style?.shapeColor ?? 'rgb(var(--c-fg) / 0.8)',
      strokeOpacity: String(style?.shapeOpacity ?? 1),
      strokeWidth: String(style ? Math.max(style.shapeOutlineWidth * zoom, 0.5) : 2),
      strokeLinecap: 'round',
    })
    show(ellipse, tool === 'circle', { cx: left + w / 2, cy: top + h / 2, rx: Math.max(0, w / 2 - inset), ry: Math.max(0, h / 2 - inset) }, shapeLook)
    const radius = tool === 'rectangle' && style ? Math.min(style.cornerRadius * zoom, (w - inset * 2) / 2, (h - inset * 2) / 2) : 0
    show(rect, tool === 'rectangle' || tool === 'frame' || tool === 'text', {
      x: left + inset, y: top + inset, width: Math.max(0, w - inset * 2), height: Math.max(0, h - inset * 2), rx: radius, ry: radius,
    }, tool === 'rectangle' ? shapeLook : guide)
    // A triangle, diamond or parallelogram (lib/traceGeometry), as drawn.
    const corners = shapePolygon(tool, w, h, inset, inset)
    show(polygon, !!corners, {
      d: corners ? roundedPolygonPath(corners.map(p => ({ x: left + p.x, y: top + p.y })), style ? style.cornerRadius * zoom : 0) : '',
    }, shapeLook)
    svg.style.display = 'block'
  }
  // Hidden once what was dragged out is on the canvas -- the frame after the
  // store has it -- so it's never gone before its shape is there. Unless a new
  // press has taken the preview over by then.
  const letGoOfPreview = (press: number) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (placePressRef.current === press && !placeStartRef.current) drawPlacePreview(null, null)
    }))
  }

  // The middle button pans the view, a second way to the left drag on empty
  // canvas -- and from anywhere, over traces too, since it does nothing else
  // there. Not over a panel, where it keeps its own use. Caught first, so
  // nothing under it takes the press; its default, the browser's autoscroll,
  // is kept from starting, and a middle click on a link doesn't open it.
  // With Move the view taken up, the left button pans just the same, and the
  // click (or double click) that ends its press reaches nothing.
  useEffect(() => {
    let panning = false
    const pans = (e: MouseEvent) => e.button === 1 || (e.button === 0 && panToolRef.current)
    const swallow = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault() }
    const down = (e: MouseEvent) => {
      if (!pans(e)) return
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-ui-element], [data-hud], .customize-menu, .layer-panel, [role="dialog"], input, textarea, select')) return
      e.preventDefault()
      e.stopPropagation()
      panning = true
      isPanningRef.current = true
      cameraFlyToRef.current = null
      lastPanPositionRef.current = { x: e.clientX, y: e.clientY }
    }
    const up = (e: MouseEvent) => {
      if (!pans(e) || !panning) return
      panning = false
      isPanningRef.current = false
      e.preventDefault()
      e.stopPropagation()
      if (e.button === 0) {
        window.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', swallow, true), 400)
      }
    }
    const dbl = (e: MouseEvent) => { if (panToolRef.current && isCanvasTarget(e.target)) swallow(e) }
    const aux = (e: MouseEvent) => {
      if (e.button === 1 && isPanningRef.current === false && !(e.target as HTMLElement | null)?.closest?.('[data-ui-element], [data-hud], .customize-menu, .layer-panel, [role="dialog"]')) e.preventDefault()
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('mouseup', up, true)
    window.addEventListener('auxclick', aux, true)
    window.addEventListener('dblclick', dbl, true)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('mouseup', up, true)
      window.removeEventListener('auxclick', aux, true)
      window.removeEventListener('dblclick', dbl, true)
    }
  }, [])

  // An armed tool takes the next press on the canvas -- or on a trace, which
  // a frame is often drawn around -- ahead of everything that would
  // otherwise take it (panning, selecting, dragging a trace). Not a press on
  // the interface: the bar itself, the panels, the buttons (isCanvasTarget).
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!placeToolRef.current || !canEditRef.current || isDrawingModeRef.current) return
      if (e.button !== 0 || !e.isPrimary || !isCanvasTarget(e.target)) return
      const c = worldContainerRef.current
      if (!c) return
      e.preventDefault()
      e.stopPropagation()
      cameraFlyToRef.current = null
      // Starting to make something lets go of what was selected, as in
      // Excalidraw -- and its panel with it (TraceOverlay's panels follow the
      // selection). What this makes is selected when it exists; a click
      // that makes nothing leaves nothing selected.
      setMultiSelectRequest([])
      const tool = placeToolRef.current
      placeStyleRef.current = isBoxShape(tool) || tool === 'path' ? nextShapeStyle(tool) : null
      placePressRef.current++
      placeStartRef.current = {
        sx: e.clientX, sy: e.clientY,
        wx: (e.clientX - c.x) / zoomRef.current, wy: (e.clientY - c.y) / zoomRef.current,
        pointerId: e.pointerId,
      }
    }
    const move = (e: PointerEvent) => {
      const start = placeStartRef.current
      if (!start || e.pointerId !== start.pointerId) return
      drawPlacePreview(placeToolRef.current, { x1: start.sx, y1: start.sy, x2: e.clientX, y2: e.clientY, even: e.shiftKey })
    }
    const up = (e: PointerEvent) => {
      const start = placeStartRef.current
      if (!start || e.pointerId !== start.pointerId) return
      placeStartRef.current = null
      // The click that ends this press is the placement's: on the canvas it
      // would let go of what's just been made.
      const swallow = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault() }
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 400)
      const tool = placeToolRef.current
      const press = placePressRef.current
      if (tool && e.type === 'pointerup') {
        void finishPlacingRef.current(tool, start, { sx: e.clientX, sy: e.clientY }, e.shiftKey).finally(() => letGoOfPreview(press))
      } else {
        drawPlacePreview(null, null)
      }
    }
    // The press's own mouse and touch events, which the canvas and the
    // traces listen for, are kept from them while it's a placement's.
    const hold = (e: Event) => {
      if (!placeStartRef.current) return
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('mousedown', hold, true)
    window.addEventListener('touchstart', hold, { capture: true, passive: false })
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('mousedown', hold, true)
      window.removeEventListener('touchstart', hold, true)
    }
  }, [])

  // Drawing, or losing the right to edit, lets go of an armed tool. (Only
  // as drawing starts: a tool picked in the bar ends drawing, and stays.)
  useEffect(() => {
    if (isDrawingMode || !canEdit) setPlaceTool(null)
  }, [isDrawingMode, canEdit])
  // Counted up as a tool is picked in the bar, for TraceOverlay.
  const [toolSwitch, setToolSwitch] = useState(0)

  // Camera helpers for the Locations panel: read the live camera view, and
  // smoothly fly to a saved one (the ticker eases cameraPositionRef + zoom
  // toward the target; see cameraFlyToRef).
  const getCurrentCamera = () => ({
    x: cameraPositionRef.current.x,
    y: cameraPositionRef.current.y,
    zoom: zoomRef.current,
  })

  // The camera flown to `x`, `y` (the world point for the screen's middle) at `zoom`.
  const flyTo = (x: number, y: number, zoom: number) => {
    cameraFlyToRef.current = {
      startX: cameraPositionRef.current.x,
      startY: cameraPositionRef.current.y,
      startZoom: zoomRef.current,
      targetX: x,
      targetY: y,
      targetZoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)),
      startTime: performance.now(),
      duration: 900,
    }
  }
  const flyToLocation = (location: LobbyLocation) => flyTo(location.positionX, location.positionY, location.zoom)

  // Recenter: the atrium's traces framed (lib/worldCamera contentView) -- all
  // of them, or where most of them are when a few lie far off. An empty
  // atrium goes back to its origin.
  // Framed in what the menus at the screen's edges leave of it, measured
  // as they are now (open or closed), with room to spare.
  const recenter = () => {
    const width = window.innerWidth, height = window.innerHeight
    const menus = [...document.querySelectorAll('[data-hud]'), sessionBarRef.current].filter((el): el is Element => !!el)
    const reach = edgeInsets(menus.map(el => el.getBoundingClientRect()), width, height)
    const insets = { left: reach.left + RECENTER_MARGIN, top: reach.top + RECENTER_MARGIN, right: reach.right + RECENTER_MARGIN, bottom: reach.bottom + RECENTER_MARGIN }
    const boxes = useGameStore.getState().traces.map(tr => boundsOf(traceBox(tr)))
    const view = contentView(boxes, width, height, insets, RECENTER_MIN_ZOOM, 1)
    flyTo(view?.cx ?? 0, view?.cy ?? 0, view?.zoom ?? 1)
  }

  // --- Locations (lib/locations: in the store, saved like everything else) ---
  const loadLocations = useCallback(async () => {
    if (!supabase || !lobbyId) return
    const { data, error } = await supabase
      .from('lobby_locations')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('order_index', { ascending: true })
    if (error || !data) return
    receiveLocations(data.map(mapLocationRow))
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

  const addLocation = (name: string) => {
    const cam = getCurrentCamera()
    changeLocations('location added', list => [...list, {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      lobbyId,
      name: name.trim(),
      positionX: cam.x,
      positionY: cam.y,
      zoom: cam.zoom,
      orderIndex: list.length,
      userId: username,
    }])
  }

  const renameLocation = (id: string, name: string) => {
    changeLocations('location renamed', list => list.map(l => (l.id === id ? { ...l, name: name.trim() } : l)))
  }

  // Re-shoots a saved location: overwrites its stored camera with wherever
  // the user is currently looking.
  const updateLocationCamera = (id: string) => {
    const cam = getCurrentCamera()
    // Enforced here as well as disabled in the panel: the button being greyed
    // out is a hint, this is the actual guarantee.
    changeLocations('location moved', list => list.map(l => (
      l.id === id && !l.isLocked ? { ...l, positionX: cam.x, positionY: cam.y, zoom: cam.zoom } : l
    )))
  }

  const toggleLocationLock = (id: string) => {
    changeLocations('location locked', list => list.map(l => (l.id === id ? { ...l, isLocked: !l.isLocked } : l)))
  }

  const deleteLocation = (id: string) => {
    changeLocations('location deleted', list => list.filter(l => l.id !== id))
  }

  const reorderLocations = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    changeLocations('locations reordered', list => {
      const arr = [...list]
      const from = arr.findIndex(l => l.id === sourceId)
      const to = arr.findIndex(l => l.id === targetId)
      if (from === -1 || to === -1) return list
      const [moved] = arr.splice(from, 1)
      arr.splice(to, 0, moved)
      return arr
    })
  }

  // --- Presentation mode (arrow-key navigation through working locations) --
  const goToPresentationIndex = useCallback((index: number) => {
    const list = useGameStore.getState().locations
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
      if (useGameStore.getState().locations.length === 0) return
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

  // "Paste Image" from the canvas right-click menu. Places at the point that
  // was right-clicked, which is the whole advantage over Ctrl+V -- the user
  // has already said where they want it.
  const handlePasteImageAt = async (worldX: number, worldY: number) => {
    const offer = await readClipboardContents()
    if (offer === null) {
      showToast(t('atrium.error.clipboardUnreadable'))
      return
    }
    if (offer.images.length === 0) {
      showToast(t('atrium.error.noImageClipboard'))
      return
    }
    if (!ensureLobbyHasSpace()) return
    await placeFilesAsTraces(offer.images, worldX, worldY)
  }

  // Ctrl+V of something that isn't copied traces (TraceOverlay keeps those):
  // a link becomes an embed where the pointer is, as Excalidraw pastes one --
  // several links, packed around it -- and on desktop a copied picture an
  // image there. Only when every word of the text is a link: a sentence with
  // one in it is copied prose. Whether the paste was used.
  const pasteOnCanvas = (data: DataTransfer): boolean => {
    if (!canEditRef.current) return false
    const at = { x: positionRef.current.x, y: positionRef.current.y }
    const pictures = isDesktop ? [...data.files].filter(file => file.type.startsWith('image/')) : []
    if (pictures.length > 0) {
      if (ensureLobbyHasSpace()) void placeFilesAsTraces(pictures, at.x, at.y)
      return true
    }
    const text = data.getData('text/plain').trim()
    // A site's embed code: where its frames point (lib/embedUrl).
    const framed = /<iframe\b/i.test(text) ? embedSourcesIn(text) : null
    const words = text.split(/\s+/).filter(Boolean)
    const links = framed ?? words.map(asPasteableUrl)
    if (links.length === 0 || links.some(link => !link)) return false
    if (!ensureLobbyHasSpace()) return true
    if (links.length === 1) void insertDroppedTrace('embed', links[0]!, links[0]!, at.x, at.y)
    else void handleCreateBatchEmbeds(links as string[], at)
    return true
  }

  // "Paste as Embed": a copied link becomes an embed trace where the user
  // right-clicked. On both platforms, unlike Paste Image -- an embed stores a
  // URL and writes no file, so there's nothing here the web can't do.
  const handlePasteEmbedAt = async (worldX: number, worldY: number) => {
    const offer = await readClipboardContents()
    if (offer === null) {
      showToast(t('atrium.error.clipboardUnreadable'))
      return
    }
    if (!offer.url) {
      showToast(t('atrium.error.noLinkClipboard'))
      return
    }
    if (!ensureLobbyHasSpace()) return
    // Stored as copied. The overlay runs embed content through toEmbedUrl when
    // it renders, so a Drive or YouTube link becomes embeddable there rather
    // than being rewritten on the way in -- same as a link dropped on the
    // canvas.
    await insertDroppedTrace('embed', offer.url, offer.url, worldX, worldY)
  }

  const handleCreateBatchEmbeds = async (urls: string[], at?: { x: number; y: number }) => {
    if (urls.length === 0) return
    if (!ensureLobbyHasSpace()) return

    const anchor = at ?? positionRef.current
    // Probe each URL's real image dimensions before packing (like the
    // multi-file drop handler already does for actual files) -- most
    // pasted embeds are hotlinked images, and packing them all as a flat
    // default box regardless of their real aspect ratio produced an
    // overlapping mess once each one rendered at its real (very different)
    // size. Non-image embeds (YouTube links, etc.) simply fail to probe and
    // fall back to the default box.
    const probed = await Promise.all(urls.map(url => probeRemoteImageDimensions(url)))
    const boxes = urls.map(url => defaultEmbedBox(url))
    // Only what loaded as a picture can be see-through.
    const seeThrough = await Promise.all(urls.map((url, i) => probed[i]
      ? hasTransparency(url, isDesktop ? undefined : `/api/proxy-image?url=${encodeURIComponent(url)}`)
      : false))
    const sizes = probed.map((dims, i) => dims ? scaleToDisplayBox(dims) : boxes[i] ?? getDefaultTraceBoxSize('embed'))
    const offsets = packBoxesAroundCenter(sizes, 24, packingShapeRef.current)

    if (supabase) {
      // Each one above the last, all on top of the group.
      const layerFields = newTraceOrderFields(useGameStore.getState().traces, useGameStore.getState().layers, urls.length)

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
        // Stored for what isn't an image, so a pasted video opens at the size
        // it was packed at, as the single-link paths already do.
        ...(!probed[i] && boxes[i] ? boxes[i] : {}),
        ...(seeThrough[i] ? { show_border: false, show_background: false } : {}),
        ...layerFields[i],
      }))

      const { data, error } = await supabase.from('traces').insert(rows as any).select()
      if (error) {
        console.error('Batch embed insert error:', error)
        showToast(t('atrium.error.embedsFailed', { message: error.message }))
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
  }

  // Bulk-convert every embed trace in this atrium into an internal image
  // (reuses the same per-trace conversion used by the trace context menu).
  // Runs sequentially rather than in parallel to avoid hammering the vault
  // folder / remote host with many concurrent downloads at once.
  const handleConvertAllEmbeds = async () => {
    const embedTraces = useGameStore.getState().traces.filter(t => t.type === 'embed')
    if (embedTraces.length === 0) {
      showToast(t('atrium.error.noEmbedTraces'))
      return
    }
    setIsConvertingEmbeds(true)
    let converted = 0
    let skipped = 0
    try {
      for (let i = 0; i < embedTraces.length; i++) {
        setConvertEmbedsProgress(t('atrium.hud.converting', { done: i + 1, total: embedTraces.length }))
        const result = await convertEmbedToInternalImage(embedTraces[i].id)
        if (result.ok) converted++
        else skipped++
      }
      const message = tCount('atrium.toast.embedsConverted', converted)
      showToast(skipped > 0 ? t('atrium.toast.embedsSkipped', { message, count: skipped }) : message)
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

  // The cursor's position, kept in a ref by subscribing to the store rather
  // than by rendering for it: it changes with every movement of the mouse
  // (see useGamePick). The camera starts on it when nothing was saved.
  useEffect(() => {
    const { position } = useGameStore.getState()
    positionRef.current = position
    if (!cameraRestoredRef.current && cameraPositionRef.current.x === 0 && cameraPositionRef.current.y === 0) {
      cameraPositionRef.current = { x: position.x, y: position.y }
    }
    return useGameStore.subscribe(state => { positionRef.current = state.position })
  }, [])
  
  // Initialize presence for this lobby. Traces are now loaded earlier, from
  // App.tsx, so they're already in the store (and local media pre-resolved
  // on desktop) by the time this scene mounts, instead of popping in after
  // the atrium-entry loading screen finishes.
  // Removed means removed: leave at once, and explain on the other side.
  //
  // This used to hold the notice over the canvas and defer leaving until it
  // was acknowledged, which left somebody sitting in a room they had been
  // thrown out of -- still in everyone's roster, because presence only goes
  // when the client actually goes. Retracting it early depended on the
  // kicked client cooperating; walking out does not.
  const handleKicked = useCallback((blacklisted: boolean) => {
    onKicked(blacklisted)
    leaveWithTransitionRef.current()
  }, [onKicked])
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
      showToast(err.message || t('atrium.error.kickFailed'))
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

    // Use full viewport dimensions
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Get theme settings from current lobby
    const bgColor = viewTheme?.backgroundColor ? parseInt(viewTheme.backgroundColor.replace('#', ''), 16) : 0x0a0a0f

    const app = new Application({
      width: viewportWidth,
      height: viewportHeight,
      backgroundColor: bgColor,
      antialias: true,
      // Deliberately left at the default resolution of 1.
      //
      // Rendering at devicePixelRatio was tried, to stop curves looking
      // pixelated on a high-DPI screen, and reverted: on a 2x display it means
      // four times the pixels every frame for the grid, particles and
      // indicators, which cost more than the sharpness was worth.
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

      // The grid, under everything in the world. In screen space, not in the
      // world layer: see drawGrid.
      const grid = new Graphics()
      app.stage.addChildAt(grid, 0)
      gridRef.current = grid
      
      // Create lighting layer (drawn above grid but below entities)
      const lightingLayer = new Graphics()
      worldContainer.addChild(lightingLayer)
      lightingLayerRef.current = lightingLayer
      
      // The grid, drawn in screen space: 1px lines on whole pixels, at any
      // zoom. It was drawn in world units inside the zoomed layer, so a line
      // was 0.4px wide at 40% and 1.4px at 140%, on whatever fraction of a
      // pixel each zoom put it -- faint and shimmering one way, soft the
      // other, and different at every step of a zoom. The lines are still
      // where the world's are: a line every spacing * zoom pixels, from the
      // world's offset.
      //
      // Drawn again whenever what it's drawn from has changed -- the view, the
      // canvas's size, the atrium's grid settings -- which the render loop
      // checks every frame (a string compared). It used to be redrawn only
      // when told: when the view moved, on a resize it heard about, on a
      // theme change. A signal that didn't come -- the desktop's webview
      // doesn't always say when a window is restored or its scaling changes
      // -- left it drawn for a canvas that was no longer there, and the grid
      // was gone until the view next moved.
      let drawnFor = ''
      const drawGrid = () => {
        const theme = themeSettingsRef.current
        const width = app.screen.width, height = app.screen.height
        const key = [worldContainer.x, worldContainer.y, zoomRef.current, width, height,
          theme?.gridEnabled, theme?.gridColor, theme?.gridOpacity, theme?.gridLineSpacing].join('|')
        if (key === drawnFor) return
        drawnFor = key
        grid.clear()
        if (theme?.gridEnabled === false) return
        const color = theme?.gridColor ? parseInt(theme.gridColor.replace('#', ''), 16) : 0x3b82f6
        // From the atrium's own settings, so the lines are the ones the user
        // asked for -- and the ones Shift-dragging snaps onto, which reads
        // the same value.
        const step = (theme?.gridLineSpacing ?? 50) * zoomRef.current
        // Fading out as the lines close up with a zoom out: as set from 32px
        // apart, gone at 12px, and from there not drawn at all -- closer
        // than that is a haze, and hundreds of lines to draw every frame.
        const fade = Math.min(1, (step - 12) / 20)
        if (fade <= 0) return
        grid.lineStyle(1, color, (theme?.gridOpacity ?? 0.2) * fade)
        const at = (offset: number) => ((offset % step) + step) % step
        // +0.5: a 1px line centred on a pixel covers it exactly.
        for (let x = at(worldContainer.x); x <= width; x += step) {
          const sx = Math.round(x) + 0.5
          grid.moveTo(sx, 0)
          grid.lineTo(sx, height)
        }
        for (let y = at(worldContainer.y); y <= height; y += step) {
          const sy = Math.round(y) + 0.5
          grid.moveTo(0, sy)
          grid.lineTo(width, sy)
        }
      }
      updateGridRef.current = drawGrid

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
          // Let the browser handle normal scrolling for UI elements -- but
          // never a pinch or ctrl+scroll, which the desktop webview would take
          // as an instruction to zoom the entire application. Scrolling a panel
          // is meant; scaling the whole interface never is.
          if (e.ctrlKey) e.preventDefault()
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
      // The theme's particles from the start, not just in the later
      // updateConfig: the theme can be here before this is, and then that
      // never runs again -- the particles came back white on every visit.
      const themeManager = new ThemeManager(worldContainer, {
        particleCount: 100,
        ...particleConfig(themeSettingsRef.current, bgColor),
      })
      themeManagerRef.current = themeManager
      themeManager.createParticles(viewportWidth, viewportHeight, cameraPositionRef.current.x, cameraPositionRef.current.y)

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

                // The traces and threads it takes are worked out by TraceOverlay,
                // which knows each trace's real size (see areaSelectRequest).
                setAreaSelectRequest({ left: wx1, top: wy1, right: wx2, bottom: wy2 })

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
      // Whether a mouse button is down -- in the capture phase, so a trace
      // that stops its own mousedown from spreading is still seen.
      let mouseHeld = false
      const noteMouseHeld = (e: PointerEvent) => {
        if (e.pointerType === 'mouse') mouseHeld = e.type === 'pointerdown'
      }
      window.addEventListener('pointerdown', noteMouseHeld, true)
      window.addEventListener('pointerup', noteMouseHeld, true)
      eventHandlersRef.current.mouseHeld = noteMouseHeld

      // Fluid animation loop
      let pulseTime = 0
      let frameCounter = 0
      // The traces' layer: laid out from React state, committed with
      // flushSync so it's placed in the same frame as the grid (set plainly,
      // it trailed the grid by a frame and caught up).
      const worldCamera = createWorldCamera({
        margin: CULL_MARGIN,
        commit: (view, previous) => flushSync(() => {
          if (!previous || view.x !== previous.x || view.y !== previous.y) setWorldOffset({ x: view.x, y: view.y })
          if (!previous || view.zoom !== previous.zoom) setZoom(view.zoom)
        }),
      })
      
      // A frame that throws is that frame lost, not every one after it: Pixi
      // asks for the next frame only once this one has run without an error,
      // so one exception here used to stop the canvas for good -- frozen,
      // and blank at the next resize.
      let frameFailed = false
      app.ticker.add(() => {
        try {
          frame()
        } catch (error) {
          if (!frameFailed) console.error('[atrium] a frame failed:', error)
          frameFailed = true
        }
      })
      const frame = () => {
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

        // The zoom eases toward its target: most of the way in about a quarter
        // of a second. Measured in time, not frames -- a tenth of the gap per
        // frame, as it was, took twice as long on a 60Hz screen as on a
        // 120Hz one, and longer again whenever a frame came late.
        const zoomDiff = targetZoomRef.current - zoomRef.current

        // Snap to target if very close (prevents oscillation/jitter)
        if (Math.abs(zoomDiff) < 0.003) {
          zoomRef.current = targetZoomRef.current
        } else {
          zoomRef.current += zoomDiff * (1 - Math.pow(0.82, app.ticker.deltaMS / (1000 / 60)))
        }
        
        // Check if zoom is stable (reached target)
        const zoomIsStable = zoomRef.current === targetZoomRef.current
        
        // Update world container scale
        worldContainer.scale.set(zoomRef.current)
        
        // Update camera (world container offset based on camera position).
        // On whole pixels at rest, for crisp edges -- but not while zooming:
        // rounded afresh each frame, the offset moved by a pixel on some
        // frames and not at all on others, so everything shuffled half a
        // pixel back and forth as it grew or shrank.
        const rawX = -cameraPositionRef.current.x * zoomRef.current + viewportWidth / 2
        const rawY = -cameraPositionRef.current.y * zoomRef.current + viewportHeight / 2
        worldContainer.x = zoomIsStable ? Math.round(rawX) : rawX
        worldContainer.y = zoomIsStable ? Math.round(rawY) : rawY
        
        // Sync world offset for overlay
        const newOffsetX = worldContainer.x
        const newOffsetY = worldContainer.y
        
        // The traces, which are DOM, laid out from React state -- or, while
        // the view moves, their layer moved and scaled whole: see
        // lib/worldCamera. Not while a mouse button is down, unless for the
        // pan itself: a trace being dragged moves by the view it was laid out
        // at.
        const now = performance.now()
        worldCamera.frame({
          layer: traceWorldLayerRef.current,
          view: { x: newOffsetX, y: newOffsetY, zoom: zoomRef.current },
          now,
          width: window.innerWidth,
          height: window.innerHeight,
          canScale: !mouseHeld || isPanningRef.current,
        })

        // The grid is in screen space (drawGrid): drawn again on any frame
        // where what it's drawn from has changed, and not otherwise.
        updateGridRef.current?.()
        // A drawing in progress is in the world, and is painted through the
        // view (renderDrawingCanvas), so it moves with it.
        if (drawingLiveRef.current && !sameView(committedLayerRef.current?.view ?? null, { x: newOffsetX, y: newOffsetY, zoom: zoomRef.current })) {
          renderDrawingCanvasRef.current()
        }
        
        // Floating particles, which drift every frame.
        themeManagerRef.current?.updateParticles(cameraPositionRef.current.x, cameraPositionRef.current.y, viewportWidth, viewportHeight)

        // NOTE: Lighting is now handled in TraceOverlay.tsx using DOM elements with blur
        // The Pixi.js lighting layer is kept for potential future use but not actively rendering
        if (lightingLayerRef.current) {
          lightingLayerRef.current.clear()
        }
        
        // Player avatar and label now rendered in DOM (no need to update Pixi objects)
        // Keeping refs for compatibility but they're invisible


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
            indicatorPoolRef.current.push({ graphics, distanceText, unitText, labelAt: 0 })
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
            const ink = indicatorColorRef.current.primary
            indicator.clear()
            indicator.lineStyle(1.5, ink, distanceAlpha * breathe * 0.85)
            
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
            indicator.lineStyle(1.5, ink, distanceAlpha * 0.9)
            indicator.moveTo(0, -diamondSize)
            indicator.lineTo(diamondSize, 0)
            indicator.lineTo(0, diamondSize)
            indicator.lineTo(-diamondSize, 0)
            indicator.lineTo(0, -diamondSize)
            
            // Center dot
            indicator.beginFill(ink, distanceAlpha)
            indicator.drawCircle(0, 0, 2)
            indicator.endFill()
            
            // Direction line
            const lineLength = 25 + staggeredPulse * 5
            indicator.lineStyle(1, ink, distanceAlpha * 0.6)
            indicator.moveTo(cos * 12, sin * 12)
            indicator.lineTo(cos * lineLength, sin * lineLength)
            
            indicator.x = indicatorX
            indicator.y = indicatorY
            
            // The distance in words, at most ten times a second. Set on every
            // frame, a pan drew each label afresh -- letter by letter, for the
            // letter spacing -- and sent it to the GPU, every frame, for a
            // number changing too fast to read.
            if (now - poolItem.labelAt > 100) {
              distanceText.text = `${Math.round(distance)}`
              distanceText.style.fill = ink
              unitText.style.fill = ink
              unitText.x = distanceText.width / 2 + 2
              poolItem.labelAt = now
            }
            distanceText.alpha = distanceAlpha * 0.8
            distanceText.y = bracketSize + 12
            unitText.alpha = distanceAlpha * 0.6
            unitText.y = bracketSize + 12
            
            indicator.visible = true
            traceIndicatorsRef.current?.addChild(indicator)
          })
          } // end showIndicators else
        }
      }
    }

    return () => {
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
      if (eventHandlersRef.current.mouseHeld) {
        window.removeEventListener('pointerdown', eventHandlersRef.current.mouseHeld, true)
        window.removeEventListener('pointerup', eventHandlersRef.current.mouseHeld, true)
      }
      eventHandlersRef.current = { mousedown: null, mousemove: null, mouseup: null, contextmenu: null, wheel: null, touchstart: null, touchmove: null, touchend: null, mouseHeld: null }
      
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
      labelRef.current = null
      playerAvatarRef.current = null
      traceIndicatorsRef.current = null
      lightingLayerRef.current = null
      gridRef.current = null
      updateGridRef.current = null
      tracesDataRef.current = []
      
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
    if (!appRef.current || !updateGridRef.current || !currentLobby) return

    // Update background color
    const bgColor = viewTheme?.backgroundColor ? parseInt(viewTheme.backgroundColor.replace('#', ''), 16) : 0x0a0a0f
    appRef.current.renderer.background.color = bgColor

    // The grid reads the theme when it draws (themeSettingsRef).
    updateGridRef.current()

    // Update ThemeManager settings
    if (themeManagerRef.current) {
      themeManagerRef.current.updateConfig(particleConfig(viewTheme, bgColor))

      // Recreate particles with new settings
      themeManagerRef.current.createParticles(window.innerWidth, window.innerHeight, cameraPositionRef.current.x, cameraPositionRef.current.y)
    }
  }, [viewTheme])

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
    e.dataTransfer.types.includes(LOCATION_DRAG_DATA_KEY)

  // Everything on the clipboard this canvas can do something with: image files
  // to place, and a link to embed.
  //
  // One read for both, rather than a call per menu entry -- the clipboard is
  // permission-gated and potentially slow, and asking twice for the same
  // contents would double both costs.
  //
  // This is the async Clipboard API rather than a paste event, because there's
  // no paste event to read here: the user chose a menu item. It can be refused
  // outright (no permission, no support), which is why null means "couldn't
  // look" and an empty result means "looked, found nothing" -- the callers
  // treat those differently.
  // Desktop reads the clipboard through the OS rather than the webview.
  //
  // navigator.clipboard.read() is permission-gated, and the webview answers a
  // read by putting its own "Paste" button on screen and waiting for it to be
  // clicked. That's correct for a web page asking for something the user hasn't
  // offered -- but here the user has already clicked "Paste as Embed", so the
  // prompt is asking them to confirm the thing they just asked for. Reading
  // natively skips the webview's permission model entirely, and the entry does
  // what it says on the first click.
  const readClipboardNatively = async (): Promise<ClipboardOffer | null> => {
    try {
      const { readText, readImage } = await import('@tauri-apps/plugin-clipboard-manager')

      const images: File[] = []
      try {
        const image = await readImage()
        const [rgba, size] = await Promise.all([image.rgba(), image.size()])
        const file = await rgbaToPngFile(rgba, size.width, size.height)
        if (file) images.push(file)
      } catch {
        // No image on the clipboard. Text may still be there.
      }

      let url: string | null = null
      try {
        url = asPasteableUrl(await readText())
      } catch {
        // No text either.
      }

      return { images, url }
    } catch {
      return null
    }
  }

  const readClipboardContents = async (): Promise<ClipboardOffer | null> => {
    if (isDesktop) return readClipboardNatively()
    if (!navigator.clipboard?.read) return null
    try {
      const items = await navigator.clipboard.read()
      const images: File[] = []
      let url: string | null = null

      for (const item of items) {
        const imageType = item.types.find(type => type.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          const extension = imageType.split('/')[1] || 'png'
          images.push(new File([blob], `pasted-image.${extension}`, { type: imageType }))
          continue
        }

        if (!url && item.types.includes('text/plain')) {
          url = asPasteableUrl(await (await item.getType('text/plain')).text())
        }
      }

      return { images, url }
    } catch {
      return null
    }
  }

  // Turns a set of local files into traces, laid out as one arrangement around
  // a point. Shared by the drop handler and the Create Trace panel's file
  // picker, so selecting six images in the picker lands them exactly as
  // dragging the same six in would.
  const placeFilesAsTraces = async (files: File[], worldX: number, worldY: number) => {
    // EXRs become PNGs before anything else sees them: no browser can show
    // one, and left as they are they would be classified as text and read as
    // such. The import count is up while they convert -- a large one takes
    // seconds.
    if (files.some(isExr)) {
      setImportProgress({ done: 0, total: files.length })
      files = await withExrAsPng(files, (file, error) => {
        console.error('EXR conversion failed:', file.name, error)
        showToast(t('atrium.error.exrUnreadable', { name: file.name }))
      })
      if (files.length === 0) {
        setImportProgress(null)
        return
      }
    }

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

        pending.push({ traceType: 'text', content: text, size: getDefaultTraceBoxSize('text') })
        continue
      }

      const probed = traceType === 'image' ? await probeImageFileDimensions(file) : null
      const size = probed ? scaleToDisplayBox(probed) : getDefaultTraceBoxSize(traceType)
      // Named after its file, without the extension -- the title shown beside
      // it and its name in the Layer panel. A file with no name to give is
      // Untitled N.
      const title = fileTitle(file.name)
        || nextUntitledName(useGameStore.getState().traces, n => t('atrium.layers.numberedUntitled', { n }), pending.map(p => p.content))
      pending.push({ traceType, content: title, file, size })
    }

    // Phase 2: pack the batch around the drop point, then upload/insert.
    const offsets = packBoxesAroundCenter(pending.map(p => p.size), 24, packingShapeRef.current)

    setImportProgress({ done: 0, total: pending.length })

    for (let i = 0; i < pending.length; i++) {
      const item = pending[i]
      const dropX = worldX + offsets[i].x
      const dropY = worldY + offsets[i].y

      if (item.file) {
        const uploadedUrl = await uploadFile(item.file)
        if (uploadedUrl) {
          await insertDroppedTrace(item.traceType, item.content, uploadedUrl, dropX, dropY, item.file)
        }
      } else {
        await insertDroppedTrace(item.traceType, item.content, item.mediaUrl, dropX, dropY)
      }

      setImportProgress({ done: i + 1, total: pending.length })

      // A frame between files, so the count above actually reaches the screen.
      //
      // Everything in this loop is awaited, but awaits resolve in
      // microtasks -- which run to exhaustion before the browser paints. A
      // whole batch could therefore finish with the panel never having drawn
      // a single number. requestAnimationFrame is the yield that hands the
      // frame back, and it costs one frame per file against work measured in
      // hundreds of them.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    }

    setImportProgress(null)
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

    // An .atrium file's traces, added to this atrium where it's dropped.
    const project = droppedFiles.find(f => /\.atrium$/i.test(f.name))
    if (project) {
      void importAtriumHere(project, { x: worldX, y: worldY })
      return
    }

    // A dropped PDF is placed at once as a document trace, paged with arrows
    // (lib/pdfTraces); Extract Pages on its menu turns it into one picture a
    // page. Several are placed side by side. Desktop only, matching where the
    // type exists at all.
    const droppedPdfs = isDesktop
      ? droppedFiles.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      : []
    if (droppedPdfs.length > 0 && userId) {
      for (const [i, pdf] of droppedPdfs.entries()) {
        try {
          await createPdfTrace(pdf, { x: worldX + i * 640 / zoomRef.current, y: worldY }, { lobbyId, userId, username, scale: scaleForZoom() })
        } catch (err) {
          console.error('PDF trace failed:', pdf.name, err)
          showToast(t('atrium.trace.pdfUnreadable'))
        }
      }
      return
    }

    // A dropped spreadsheet becomes its sheets and charts, grouped
    // (lib/sheetTraces). Desktop only, as PDFs are.
    const droppedSheets = isDesktop ? droppedFiles.filter(f => SPREADSHEET_FILE.test(f.name)) : []
    if (droppedSheets.length > 0) {
      for (const sheet of droppedSheets) await importSpreadsheetHere(sheet, { x: worldX, y: worldY })
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
    if (offered.length > 0) {
      showToast(t('atrium.error.nothingDroppable', { types: offered.join(', ') }))
      return
    }

    // An empty type list is a different failure from an unrecognised one, and
    // it isn't ours. The browser handed this application a drag with no
    // formats attached at all -- not even text/plain -- so there is nothing
    // here to misread. It happens when a browser describes an image only in
    // its own private clipboard formats, which Windows passes between
    // processes but the webview never maps into a drop event.
    //
    // `items` is reported alongside, because the two disagreeing would mean
    // something quite different: data present but unreadable, rather than
    // absent. Worth knowing before anyone tries to fix the wrong thing.
    const itemCount = e.dataTransfer.items?.length ?? 0
    const detail = itemCount > 0 ? t('atrium.error.dragNoDataItems', { count: itemCount }) : ''
    showToast(
      isDesktop
        ? t('atrium.error.dragNoData.desktop', { detail, pasteImage: t('atrium.canvas.pasteImage') })
        : t('atrium.error.dragNoData.web', { detail }),
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
          await insertDroppedTrace('image', imageFiles[i].name || 'pasted image', uploadedUrl, baseX + offsets[i].x, baseY + offsets[i].y, imageFiles[i])
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [lobbyId, userId, username])

  const uploadFile = (file: File) => uploadTraceFile(file, lobbyId, userId)

  const insertDroppedTrace = async (
    traceType: string,
    content: string,
    mediaUrl: string | undefined,
    x: number,
    y: number,
    // The dropped or pasted file itself, when there is one: read locally,
    // which is quicker and surer than reading it back from where it went.
    file?: Blob,
    // A size to make it at, when one was dragged out for it (the quick bar's
    // Text); otherwise its type's own.
    size?: { width: number; height: number },
    // How it looks, where not the atrium's house style: the quick bar's plain
    // text has no border, background or shadow, and a colour of its own.
    look?: { showBorder?: boolean; showBackground?: boolean; showShadow?: boolean; textColor?: string },
  ) => {
    const sized = size ? { width: Math.round(size.width), height: Math.round(size.height) } : {}
    // Not dragged out to a size: its usual size on screen, at any zoom --
    // bigger in the atrium, zoomed out, so it isn't a speck.
    const scale = size ? 1 : scaleForZoom()
    // The live store, not the render-time `traces`, so a multi-file drop --
    // which adds each inserted row back before the next -- stacks each one
    // above the last instead of giving them all the same place.
    const layerFields = newTraceOrderFields(useGameStore.getState().traces, useGameStore.getState().layers)[0]

    // An embed's proportions have to be decided from its link, because they
    // can't be measured: a cross-origin frame cannot report the size of what
    // it's showing, and no amount of asking will get a Google Doc's height
    // out of it. So a document-shaped link gets a document-shaped box and a
    // folder listing gets a wide one, rather than everything arriving as the
    // same default rectangle and needing to be resized by hand.
    //
    // Applied here rather than at each call site so every route in -- a
    // dropped link, Paste as Embed, a scavenged URL -- lands the same way.
    const embedBox = traceType === 'embed'
      ? defaultEmbedBox(mediaUrl || content)
      : null

    // A picture with a see-through background arrives without the
    // background and border that would fill it in. Not asked of a link
    // already known to be a page (embedBox), which would only wait on it.
    const seeThrough = (traceType === 'image' || (traceType === 'embed' && !embedBox))
      && await hasTransparency(
        file ?? mediaUrl ?? '',
        !isDesktop && mediaUrl ? `/api/proxy-image?url=${encodeURIComponent(mediaUrl)}` : undefined,
      )

    // The atrium's house style, applied at birth. This path -- the quick
    // "leave a trace" flow -- writes straight to the database and never went
    // through the panel that knew about presets, which is why traces made
    // this way kept arriving in the old default.
    const preset = currentTracePreset(lobbyId)

    const trace = insertTrace({
      user_id: userId,
      username,
      type: traceType,
      ...(traceType === 'text' ? { layer_name: nextTextName(useGameStore.getState().traces, n => t('atrium.layers.numberedText', { n })) } : {}),
      border_color: preset.border,
      fill_color: preset.fill,
      show_border: look?.showBorder ?? !seeThrough,
      show_background: look?.showBackground ?? !seeThrough,
      ...(look?.showShadow !== undefined ? { show_shadow: look.showShadow } : {}),
      font_family: 'mono',
      ...(look?.textColor ? { text_color: look.textColor } : preset.text ? { text_color: preset.text } : {}),
      content,
      position_x: x,
      position_y: y,
      media_url: mediaUrl || null,
      scale,
      rotation: 0.0,
      // Explicit, not left to the column default.
      //
      // TracePanel sets this; this path never did, so a dropped or
      // imported trace took whatever the table hands out. The web
      // migration moved that default from 8 to 0, but a SQLite column
      // default is fixed when the table is created -- so every desktop
      // vault made before that change still rounds the corners of
      // everything imported into it. Saying 0 here is the same answer
      // on both platforms and on a vault of any age.
      border_radius: 0,
      lobby_id: lobbyId,
      show_description: false,
      show_filename: false,
      ...(embedBox ?? {}),
      ...sized,
      ...layerFields,
    }, message => showToast(t('atrium.error.traceSaveFailed', { message })))
    // Returned so a caller can act on the trace it just made -- "Text" in
    // the canvas menu needs the id to put it straight into editing.
    return trace.id
  }

  // Images sent in by the browser extension.
  //
  // The extension deliberately holds no credentials and uploads nothing. It
  // knows the address of the image you right-clicked and nothing else; this
  // tab is already signed in and already knows which atrium is open, so it is
  // the right place for the work to happen.
  //
  // Through a ref because the listener is bound once, while the function it
  // calls is rebuilt every render and closes over things -- the active layer,
  // the camera -- that would otherwise be frozen at whatever they were when
  // the atrium first painted.
  const insertDroppedTraceRef = useRef(insertDroppedTrace)
  insertDroppedTraceRef.current = insertDroppedTrace

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Only this page, talking to itself. A content script posts into the
      // page it is running on, so anything arriving from another window or
      // another origin did not come from the extension.
      if (event.source !== window) return
      if (event.origin !== window.location.origin) return

      const data = event.data
      if (data?.source !== 'atrium-extension') return
      if (!canEdit) return

      // An address is required for the two kinds that point somewhere, and
      // must be a web one -- the only scheme an <img> or an iframe here is
      // ever allowed to load.
      const wantsUrl = data.kind === 'image' || data.kind === 'embed'
      if (wantsUrl && (typeof data.url !== 'string' || !/^https?:\/\//i.test(data.url))) return
      if (data.kind === 'text' && typeof data.text !== 'string') return
      if (!wantsUrl && data.kind !== 'text') return

      // Dropped where you are looking, since there is no cursor position to
      // speak of -- the click happened on a different page entirely.
      const container = worldContainerRef.current
      if (!container) return
      const worldX = (window.innerWidth / 2 - container.x) / (zoomRef.current || 1)
      const worldY = (window.innerHeight / 2 - container.y) / (zoomRef.current || 1)

      // The same three shapes a drop makes, so an extension trace is not a
      // different kind of thing once it has landed.
      if (data.kind === 'text') {
        void insertDroppedTraceRef.current('text', data.text, undefined, worldX, worldY)
      } else if (data.kind === 'embed') {
        void insertDroppedTraceRef.current('embed', data.url, data.url, worldX, worldY)
      } else {
        void insertDroppedTraceRef.current('image', 'shared image', data.url, worldX, worldY)
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [canEdit])

  return (
    <div
      className={`fixed inset-0 bg-nier-black lobby-scene ${uiHidden ? 'ui-hidden' : ''} ${leaving ? 'screen-recede' : 'screen-rise'}`}
      // The atrium's own colour behind the grid, so the sliver the floating
      // view uncovers at the screen's edge matches it instead of showing black.
      style={{ touchAction: 'none', backgroundColor: viewTheme?.backgroundColor || undefined }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Canvas Container with Overlay - Full Viewport */}
      <div className="w-full h-full relative">
        {/* Pixi Canvas */}
        <div
          ref={canvasRef}
          className="absolute inset-0"
        />
        
        {/* Trace Content Overlay */}
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          <TraceOverlay
            traces={traces}
            atriumBackground={viewTheme?.backgroundColor}
            gridLineSpacing={viewTheme?.gridLineSpacing}
            onPaste={pasteOnCanvas}
            zoom={zoom}
            worldOffset={worldOffset}
            worldLayerRef={traceWorldLayerRef}
            onEdgePan={panCameraBy}
            lobbyId={lobbyId}
            selectedTraceId={selectedTraceId}
            setSelectedTraceId={setSelectedTraceId}
            multiSelectRequest={multiSelectRequest}
            areaSelectRequest={areaSelectRequest}
            customizeRequest={customizeRequest}
            newPathRequest={newPathTraceId}
            newTextRequest={newTextTraceId}
            directSelect={directSelect}
            frameRequest={frameRequest}
            isDrawingMode={isDrawingMode}
            hideCursor={(isDrawingMode && pointerOnDrawingCanvas) || (laserActive && pointerOnLaser) || holdPanning}
            placing={!!placeTool}
            panning={panTool}
            onEditDrawing={traceId => void startDrawing(traceId)}
            hiddenTraceIds={drawingMembers}
            toolSwitch={toolSwitch}
            onMultiSelectionChange={setMultiSelectedTraceIds}
            onExport={ids => setExportOf({ ids })}
            onCustomizeOpen={closeSidePanels}
            canEdit={canEdit}
          />
        </div>

        {/* While a shape is being placed, the pointer is the shape's: over a
            trace as over empty canvas, so a shape can be drawn on top of one
            -- to mark something on it -- instead of the press selecting it.
            Over the traces (their layer is isolated), under the HUD and the
            Create Trace panel. A plain layer: the canvas's own mouse handling
            takes the drag, as it does on empty canvas. */}

        {/* Shift+drag area-selection rectangle -- position/size mutated
            directly on mousemove (see handleMouseMove), not React state.
            Rendered unconditionally (not just while isDrawingMode) since
            area-select is a normal-mode canvas interaction. z-index has to
            clear TraceOverlay's own scale (traces/handles run up into the
            millions -- see TraceOverlay.tsx), since this needs to stay
            visible while dragging directly over traces. */}
        <div
          ref={areaSelectRectRef}
          className="fixed border border-dashed border-nier-bg/70 bg-white/10 pointer-events-none"
          style={{ display: 'none', zIndex: 1_500_000 }}
        />

        {/* What an armed quick-bar tool is dragging out (drawPlacePreview).
            Over the traces, as the area select is. */}
        <svg ref={placePreviewRef} data-place-preview="" className="fixed inset-0 w-full h-full pointer-events-none" style={{ display: 'none', zIndex: 1_500_000 }}>
          {/* Painted by drawPlacePreview, as what's dragged out will look. */}
          <line />
          <ellipse />
          <rect />
          <path />
        </svg>

        {/* Drop Zone Indicator */}
        {/* Importing: cover the atrium and say how far along it is.

            Writing a batch of files is real work -- decoding each image to
            measure it, packing the layout, a database insert apiece -- and it
            all happens on the thread that draws the room, so the room stops
            answering. Before this there was nothing to distinguish that from
            the app having died, and panning a canvas mid-import only made it
            worse.

            pointer-events-auto is the lock: the overlay takes the clicks and
            drags that would otherwise reach the canvas, so movement stops for
            as long as the import runs and resumes by itself when it ends. */}
        {importProgress && !importProgress.percent && (
          <div
            data-import-progress=""
            className="absolute inset-0 z-[9999] pointer-events-auto flex items-center justify-center cursor-wait"
            style={{ backgroundColor: 'rgb(var(--c-ground) / 0.72)' }}
            onWheel={e => e.stopPropagation()}
            onContextMenu={e => e.preventDefault()}
          >
            <div className="relative bg-nier-blackLight border border-nier-border/50 px-8 py-6 min-w-[280px]">
              <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
              <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

              <p className="text-nier-strong text-xs tracking-[0.2em] uppercase font-mono mb-3">
                ◇ {t('atrium.hud.importing')}
              </p>
              <div className="h-[3px] bg-nier-black border border-nier-border/30 overflow-hidden mb-2">
                <div
                  className="h-full transition-all duration-200 ease-out"
                  style={{
                    width: `${importProgress.total ? (importProgress.done / importProgress.total) * 100 : 0}%`,
                    background: 'rgb(var(--c-fg))',
                  }}
                />
              </div>
              <p className="text-nier-bg/70 text-[0.7rem] tracking-[0.15em] uppercase font-mono">
                {importProgress.percent
                  ? new Intl.NumberFormat(language, { style: 'percent' }).format(importProgress.done / Math.max(1, importProgress.total))
                  : t('atrium.hud.importCount', { done: importProgress.done, total: importProgress.total })}
              </p>
            </div>
          </div>
        )}

        {isDragOver && (
          <div className="absolute inset-0 z-[9998] pointer-events-none flex items-center justify-center"
               style={{ backgroundColor: 'rgba(203, 203, 203, 0.08)', border: '2px dashed rgba(143, 143, 143, 0.5)' }}>
            <div className="bg-nier-black/80 border border-nier-border px-6 py-3">
              <p className="text-nier-bg text-sm tracking-[0.15em] uppercase font-mono">
                {isDesktop ? t('atrium.hud.dropFile') : t('atrium.hud.dropLink')}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* The things that are about the session rather than the canvas: who's
          here, the interface's light or dark, and the way out -- in that
          order, so the one you press by accident least often is furthest from
          the corner. Each its icon, its name drawn out below it under the
          pointer (HudIconButton). Viewing the atrium is the right bar's. */}
      <div ref={sessionBarRef} className="fixed top-4 right-4 z-[10000] flex items-center gap-2 font-mono pointer-events-auto">
        {!uiHidden && (
          <>
            {/* Who's here: how many, and pressed, the list -- with Kick, for
                the atrium's owner and admins. */}
            <div className="group relative">
              <button
                type="button"
                data-ui-element="true"
                data-online-toggle=""
                onClick={() => setShowOnlineUsersList(!showOnlineUsersList)}
                data-active={showOnlineUsersList}
                aria-expanded={showOnlineUsersList}
                aria-label={t('atrium.hud.online', { count: onlinePlayerCount })}
                className="peer atrium-btn flex items-center gap-1.5"
              >
                <MenuIcon d={MENU_ICONS.users} size={16} />
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(var(--c-emerald))' }} />
                <span className="tabular-nums" style={{ color: 'rgb(var(--c-emerald))' }}>{onlinePlayerCount}</span>
              </button>
              {!showOnlineUsersList && <SlideLabel side="below" text={t('atrium.hud.online', { count: onlinePlayerCount })} />}
              {/* Online users list */}
              {showOnlineUsersList && (
                <div
                  data-ui-element="true"
                  className="panel-in absolute right-0 top-full mt-2 w-64 border-2 border-nier-border/50 z-[10000] font-mono"
                  style={{ backgroundColor: 'rgb(var(--c-ground) / 0.97)' }}
                >
                  <div className="p-2 space-y-1.5 max-h-64 overflow-y-auto">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-nier-strong text-xs tracking-wide truncate">{username} {t('atrium.hud.you')}</span>
                      <span className="text-nier-bg/80 text-xs flex-shrink-0">{formatTimeInAtrium(getJoinedAt())}</span>
                    </div>
                    {Object.values(otherUsers).map(user => (
                      <div key={user.userId} className="flex items-center justify-between gap-2">
                        <span className="text-nier-bg/80 text-xs tracking-wide truncate">{user.username}</span>
                        <span className="text-nier-bg/80 text-xs flex-shrink-0">{formatTimeInAtrium(user.joinedAt)}</span>
                        {(isLobbyOwner || isLobbyAdmin) && user.userId !== currentLobby?.ownerUserId && (
                          <button
                            onClick={() => setKickTarget({ userId: user.userId, username: user.username })}
                            className="text-red-500 hover:text-red-400 text-xs tracking-wider uppercase transition-colors flex-shrink-0"
                          >
                            {t('atrium.hud.kick')}
                          </button>
                        )}
                      </div>
                    ))}
                    {Object.keys(otherUsers).length === 0 && (
                      <p className="text-nier-bg/70 text-xs tracking-wide">{t('atrium.hud.noOneElse')}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
            <ThemeToggle variant="atrium" onToggle={followSwitch} />
          </>
        )}

        {/* The way out; with the interface hidden, the way back to it, faint
            until reached for. */}
        <HudIconButton
          icon={uiHidden ? MENU_ICONS.show : MENU_ICONS.leave}
          label={uiHidden ? t('atrium.hud.showUi') : t('atrium.hud.leaveAtrium')}
          data-leave=""
          onClick={() => {
            if (uiHidden) { setUiHidden(false); return }
            // Changes not saved: asked whether to save them first.
            if (useGameStore.getState().hasPendingChanges()) setShowLeaveDialog(true)
            else leaveWithTransition()
          }}
          className={uiHidden ? 'opacity-25 hover:opacity-100' : 'hover:brightness-110'}
          // red-300 is 1.65:1 on paper -- a warning nobody can read. The token
          // carries the red each theme can actually show.
          style={uiHidden ? undefined : { borderColor: 'rgb(var(--c-danger) / 0.55)', color: 'rgb(var(--c-danger))' }}
        />
      </div>

      {/* The viewing tools, a row along the top in the middle (AtriumMenu's
          ViewBar); and in the bottom-right corner, the usage. */}
      {!uiHidden && (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none">
        <ViewBar items={[
          { id: 'layers', icon: MENU_ICONS.layers, label: t('atrium.layers.title'), open: showLayerPanel, onSelect: () => { setShowThemeCustomization(false); setShowProfileCustomization(false); setShowLayerPanel(open => !open) } },
          { id: 'locations', icon: MENU_ICONS.locations, label: t('atrium.locations.title'), open: showLocationsPanel, onSelect: () => { setShowThemeCustomization(false); setShowProfileCustomization(false); setShowLocationsPanel(open => !open) } },
          { id: 'recenter', icon: MENU_ICONS.recenter, label: t('atrium.hud.recenter'), hint: 'Shift+1', apart: true, onSelect: recenter },
          { id: 'fullscreen', icon: isFullscreen ? MENU_ICONS.minimize : MENU_ICONS.maximize, label: isFullscreen ? t('atrium.hud.leaveFullscreen') : t('atrium.hud.fullscreen'), hint: 'F11', onSelect: toggleFullscreen },
          { id: 'hide-ui', icon: MENU_ICONS.hide, label: t('atrium.hud.hideUi'), onSelect: () => setUiHidden(true) },
          // Docked where a trace's panel and the Layer panel are: it takes
          // their place, and lets go of the selection.
          { id: 'themes', icon: MENU_ICONS.themes, label: t('atrium.hud.theme'), apart: true, open: showThemeCustomization, onSelect: () => {
            if (showThemeCustomization) { setShowThemeCustomization(false); return }
            setShowProfileCustomization(false)
            closeSidePanels()
            setSelectedTraceId(null)
            setMultiSelectRequest([])
            setShowThemeCustomization(true)
          } },
          { id: 'preferences', icon: MENU_ICONS.preferences, label: t('atrium.hud.profile'), open: showProfileCustomization, onSelect: () => {
            if (showProfileCustomization) { setShowProfileCustomization(false); return }
            closeSidePanels()
            setSelectedTraceId(null)
            setMultiSelectRequest([])
            setShowProfileCustomization(true)
          } },
        ]} />
      </div>
      )}
      {!uiHidden && (
      <div className="fixed bottom-4 right-4 z-[9999] pointer-events-none">
        {/* How much the atrium holds: the size alone, in the unit it has
            reached (lib/size); its limit, on the web, when pointed at -- and
            the thin line along its foot, how near that it is. As tall as a
            button, its words the size of theirs. */}
        {(() => {
          const sizeBytes = useGameStore.getState().getLobbySizeBytes()
          const pct = isDesktop ? 0 : Math.min((sizeBytes / LOBBY_SIZE_LIMIT) * 100, 100)
          const used = formatSize(sizeBytes, language)
          const tone = pct >= 100 ? 'text-red-400' : pct >= 80 ? 'text-yellow-400' : 'text-nier-strong'
          return (
            <div
              data-hud="true"
              data-usage=""
              tabIndex={0}
              title={isDesktop ? t('atrium.hud.usageUsed', { size: used }) : t('atrium.hud.usageOf', { size: used, limit: formatSize(LOBBY_SIZE_LIMIT, language) })}
              className="relative shrink-0 h-[2.125rem] px-3 flex items-center gap-3 border border-nier-border/40 font-mono text-[11px] tracking-[0.15em] uppercase pointer-events-auto"
              style={{ backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
            >
              <span className="text-nier-bg/60">{t('atrium.hud.usage')}</span>
              <span className={`tabular-nums tracking-wider ${tone}`}>{used}</span>
              {!isDesktop && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] bg-nier-border/20">
                  <span
                    className={`block h-full transition-[width] duration-500 ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-nier-bg/50'}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
              )}
            </div>
          )
        })()}
      </div>
      )}

      {/* The left edge, one column: the atrium's menu at the top, the quick
          bar in what's left, Controls at the bottom. Each was placed on the
          screen by itself, so the menu opened over the quick bar, and Controls
          opened under it; in one column, each opening makes room. */}
      <div className="fixed top-4 bottom-4 left-4 z-[9999] flex flex-col items-start gap-2 pointer-events-none">
      {/* HUD + presentation quick-toggle, in one row so the toggle always
          sits just to the right of the HUD regardless of its width. */}
      <div data-hud="true" className="shrink-0 flex items-start gap-2 pointer-events-none">
      {/* The atrium's menu: three lines, and open, a column of icons whose
          names slide out beside them (AtriumMenu). Choosing one that opens
          something elsewhere closes it; Share and Language open beside it. */}
      <AtriumMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        items={[
          ...(currentLobby ? [{
            id: 'save', icon: MENU_ICONS.exportFile, label: t('atrium.hud.saveAtrium'),
            onSelect: fromMenu(() => setExportOf({ ids: selectionRef.current, format: 'atrium' })),
          }] : []),
          ...(currentLobby && canEdit ? [{
            id: 'import', icon: MENU_ICONS.open, label: t('atrium.import.file'),
            // Another atrium's traces in, where the view is.
            onSelect: fromMenu(() => {
              importAnchorRef.current = screenToWorld(window.innerWidth / 2, window.innerHeight / 2)
              atriumFileInputRef.current?.click()
            }),
          }] : []),
          ...(currentLobby ? [{
            id: 'export', icon: MENU_ICONS.image, label: t('atrium.menu.exportImage'), hint: 'Ctrl+Shift+E',
            onSelect: fromMenu(() => setExportOf({ ids: selectionRef.current })),
          }] : []),
          ...(currentLobby ? [{
            id: 'share', icon: MENU_ICONS.share, label: t('atrium.hud.share'),
            open: showShare,
            onSelect: () => showMenuPanel('share'),
            panel: (
              <SharePanel
                atriumId={currentLobby.id}
                onSaveFile={fromMenu(() => setExportOf({ ids: [], format: 'atrium' }))}
                onClose={() => setShowShare(false)}
              />
            ),
          }] : []),
          ...((isLobbyOwner || isLobbyAdmin) && currentLobby ? [{
            id: 'permissions', icon: MENU_ICONS.permissions, label: t('atrium.hud.manage'), apart: true,
            onSelect: fromMenu(() => setShowLobbyManagement(true)),
          }] : []),
          {
            id: 'language', icon: MENU_ICONS.language, label: t('welcome.language'), apart: !((isLobbyOwner || isLobbyAdmin) && currentLobby),
            open: showLanguages,
            onSelect: () => showMenuPanel('languages'),
            panel: (
              <div
                role="listbox"
                data-ui-element="true"
                onWheel={event => event.stopPropagation()}
                className="panel-in absolute left-full top-0 ml-2 z-[10000] min-w-[10rem] border border-nier-border/40 py-1 max-h-[60vh] overflow-y-auto"
                style={{ backgroundColor: 'rgb(var(--c-surface))' }}
              >
                <LanguageList onChosen={() => setShowLanguages(false)} />
              </div>
            ),
          },
          {
            id: 'controls', icon: MENU_ICONS.controls, label: t('atrium.controls.title'),
            open: showControls,
            onSelect: () => showMenuPanel('controls'),
            panel: <ControlsPanel />,
          },
          // Desktop: linked pictures and videos kept in the vault. Stays open,
          // so its name -- on hover -- can show how far it has got.
          ...(isDesktop ? [{
            id: 'storeLocally', icon: MENU_ICONS.storeLocally, disabled: isConvertingEmbeds,
            label: isConvertingEmbeds ? convertEmbedsProgress || t('atrium.hud.convertingPlain') : t('atrium.hud.convertEmbeds'),
            onSelect: () => { void handleConvertAllEmbeds() },
          }] : []),
          {
            id: 'report', icon: MENU_ICONS.report, label: t('atrium.hud.reportProblem'),
            onSelect: fromMenu(() => setShowReportForm(true)),
          },
        ]}
      />
      {/* The atrium's name, beside the menu's button, with Save under it while
          there's something to save; then undo and redo. */}
      <div className="relative">
        {currentLobby && <AtriumName name={currentLobby.name} />}
        {/* Save, dropped down under the atrium's name (lib/traceSave): a
            button while there are changes to save -- with Don't Save beside it
            -- then Saving, then Saved for a moment before it folds back up; Not
            saved, retry, when a save fails. */}
        {!uiHidden && saveBarMounted && (
          <div
            data-hud="true"
            data-save-bar=""
            // Something to save is something to click; otherwise -- Saving,
            // Saved -- it lets clicks through to the canvas under it.
            className={`absolute top-full left-0 mt-2 z-[1] font-mono flex items-stretch gap-2 ${canSave ? 'pointer-events-auto' : 'pointer-events-none'}`}
            style={{
              opacity: saveBarShown ? 1 : 0,
              transform: saveBarShown ? 'translateY(0)' : 'translateY(-8px)',
              clipPath: saveBarShown ? 'inset(0 -100vw -100vh -100vw)' : 'inset(0 -100vw 100% -100vw)',
              transition: `opacity ${SAVE_FADE_MS}ms ease-out, transform ${SAVE_FADE_MS}ms cubic-bezier(0.22, 1, 0.36, 1), clip-path ${SAVE_FADE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
            }}
          >
            <HudIconButton
              icon={shownSave.icon}
              label={shownSave.label}
              hint={canSave ? 'Ctrl+S' : undefined}
              data-save=""
              onClick={() => { void saveAllChanges() }}
              disabled={!canSave}
              active={canSave && !saveFailed}
              iconClassName={isSavingChanges ? 'animate-pulse' : undefined}
              style={saveFailed && !isSavingChanges ? { borderColor: 'rgb(var(--c-danger) / 0.55)', color: 'rgb(var(--c-danger))' } : shownSave.dim ? { opacity: 0.6 } : undefined}
              labelSide="below-start"
              badge={unsaved > 0 && !isSavingChanges && (
                <span className="absolute top-0.5 right-1 text-[9px] leading-none tabular-nums font-bold">{unsaved}</span>
              )}
            />
            {/* Don't Save, beside Save: back to the atrium as last saved, after
                a second press -- its name held out, asking to be sure (lib/traceSave
                discardAllChanges). */}
            {unsaved > 0 && !isSavingChanges && (
              <>
                <HudIconButton
                  icon={MENU_ICONS.discard}
                  labelSide="below-start"
                  label={discarding ? t('atrium.hud.discarding') : confirmDiscard ? t('atrium.hud.confirmDiscard') : t('atrium.hud.dontSave')}
                  data-discard={confirmDiscard ? 'confirm' : ''}
                  disabled={discarding}
                  holdLabel={confirmDiscard}
                  onClick={async () => {
                    if (!confirmDiscard) { setConfirmDiscard(true); return }
                    setDiscarding(true)
                    if (!(await discardAllChanges(lobbyId))) showToast(t('atrium.toast.discardFailed'))
                    setDiscarding(false)
                    setConfirmDiscard(false)
                  }}
                  style={confirmDiscard ? { borderColor: 'rgb(var(--c-danger) / 0.7)', color: 'rgb(var(--c-danger))' } : undefined}
                />
                {confirmDiscard && !discarding && (
                  <HudIconButton icon={MENU_ICONS.close} label={t('common.cancel')} labelSide="below-start" onClick={() => setConfirmDiscard(false)} />
                )}
              </>
            )}
          </div>
        )}
      </div>
      {canEdit && <HistoryButtons onStep={direction => void stepHistory(direction)} />}

      {/* Presentation quick-toggle -- only shown when locations exist. A fixed
          square matching the HUD header's height (so it stays that size even
          when the HUD is expanded), collapsed to just the centered play icon;
          reveals the "Present" label on hover (where it may grow past square).
          Green while presentation mode is active. */}
      {locations.length > 0 && (
        <button
          onClick={togglePresentationMode}
          className="atrium-btn group pointer-events-auto font-mono w-[2.125rem] hover:w-auto px-0 hover:px-4"
          data-active={presentationMode}
          title={presentationMode ? t('atrium.locations.presentationOn') : t('atrium.locations.startPresentation')}
        >
          <span className="text-[12px] leading-none">▶</span>
          <span className="hidden group-hover:inline ml-1.5 whitespace-nowrap leading-none">{t('atrium.locations.present')}</span>
        </button>
      )}
      </div>
      {/* Never less than a row of tools: Controls gives way first. */}
      {/* Dimmed while the menu is open over it: they are two things. */}
      <div className="flex-1 min-h-[2.875rem] flex items-center transition-opacity duration-200" style={{ opacity: menuOpen ? 0.35 : 1 }}>
        {/* The quick bar: a tool for each kind of trace, in the middle of what
            the menu and the readout leave -- in more columns, when that is
            short. None, for an atrium that can only be looked at. */}
        {canEdit && <QuickBar
          panning={panTool}
          armed={placeTool}
          drawing={isDrawingMode}
          laser={laserActive}
          laserSettings={laserSettings}
          kinds={{ select: directSelect, text: plainText }}
          shapeKind={shapeKind}
          onShapeKind={setShapeKind}
          onAction={quickAction}
          onKind={(tool, second) => (tool === 'select' ? setDirectSelect(second) : setPlainText(second))}
          onLaserSettings={changeLaserSettings}
        />}
      </div>
        {/* At the foot of the column: the zoom and the pointer's place. */}
        <ViewReadout
          zoom={zoom}
          // To the next tenth, as Excalidraw's buttons go: 84% → 90%, → 80%.
          onZoom={direction => {
            const tenths = targetZoomRef.current * 10
            const next = (direction > 0 ? Math.floor(tenths + 1e-6) + 1 : Math.ceil(tenths - 1e-6) - 1) / 10
            cameraFlyToRef.current = null
            targetZoomRef.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
          }}
          onZoomReset={() => { cameraFlyToRef.current = null; targetZoomRef.current = 1 }}
          holding={holdPanning}
          onHold={holdToPan}
        />
      </div>

      {/* At the foot of the screen, in the middle: what's true of this visit
          (hidden, view only), how many are selected, and what the tool in
          hand does (QuickBar's ToolHint). */}
      <div data-hud="true" className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none flex flex-col items-center gap-1">
            {/* Only the operator sees this, and only when actually hidden.
                Without it there's no way to tell this atrium is being viewed
                invisibly, which is exactly the state where acting as though
                others can see you would be a mistake. */}
            {isGhostEntry && (
              <p
                className="text-xs font-mono tracking-[0.12em] uppercase"
                style={{ color: '#A78BFA', textShadow: HUD_TEXT_OUTLINE }}
              >
                ◇ {t('atrium.hud.hiddenBadge')}
              </p>
            )}
            {!canEdit && (
              <p
                className="text-xs font-mono tracking-[0.12em] uppercase"
                style={{ color: '#FF6161', textShadow: HUD_TEXT_OUTLINE }}
              >
                ◇ {t('atrium.hud.viewOnlyBadge')}
              </p>
            )}
            {multiSelectedTraceIds.length > 1 && (
              <p
                className="text-green-400 text-xs font-mono tracking-[0.12em] uppercase"
                style={{ textShadow: HUD_TEXT_OUTLINE }}
              >
                {t('atrium.hud.tracesSelected', { count: multiSelectedTraceIds.length })}
              </p>
            )}
        {/* An .atrium file coming in: how far, here at the foot, and the
            atrium left free to use meanwhile (its undo is its own: lib/atriumFile). */}
        {importProgress?.percent && (
          <div
            data-import-progress=""
            role="progressbar"
            aria-label={t('atrium.hud.importing')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((importProgress.done / Math.max(1, importProgress.total)) * 100)}
            className="panel-in relative w-60 px-3 py-2 border font-mono text-[11px] tracking-[0.15em] uppercase pointer-events-auto"
            style={{ color: 'rgb(var(--c-fg))', background: 'rgb(var(--c-ground) / 0.94)', borderColor: 'rgb(var(--c-fg) / 0.3)' }}
          >
            <div className="flex justify-between gap-3">
              <span className="truncate">◇ {t('atrium.hud.importing')}</span>
              <span className="tabular-nums">{new Intl.NumberFormat(language, { style: 'percent' }).format(importProgress.done / Math.max(1, importProgress.total))}</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: 'rgb(var(--c-fg) / 0.12)' }}>
              <div className="h-full transition-[width] duration-200 ease-out" style={{ width: `${(importProgress.done / Math.max(1, importProgress.total)) * 100}%`, background: 'rgb(var(--c-fg))' }} />
            </div>
          </div>
        )}
        <ToolHint armed={placeTool} laser={laserActive} drawing={isDrawingMode} panning={panTool} />
      </div>

      {/* The shape tool in hand's Customization panel: how what it makes
          starts (nextShapeStyle), kept for the next one made. Its X puts the
          tool down. */}
      {placeTool && (isBoxShape(placeTool) || placeTool === 'path') && (() => {
        const style = nextShapeStyle(placeTool)
        const props = {
          typePicker: false,
          value: style,
          onChange: (patch: Partial<ShapeStyle>) => {
            rememberShapeStyle({ ...style, ...patch })
            setToolStyleRev(n => n + 1)
          },
        }
        return (
          <CustomizationPanel
            subtitle={t(`atrium.trace.shape.${placeTool}`)}
            onClose={() => setPlaceTool(null)}
            zIndex={9999}
          >
            <p data-for-new="" className="pt-3 text-nier-bg/55 text-[10px] tracking-[0.15em] uppercase">{t('atrium.customize.forNew')}</p>
            <Section id="fill" title={t('atrium.customize.sectionFill')}>
              <ShapeStyleControls {...props} part="fill" />
            </Section>
            {placeTool === 'path' ? (
              <Section id="shape" title={t('atrium.trace.shape.path')}>
                <ShapeStyleControls {...props} part="shape" />
              </Section>
            ) : (
              <Section id="outline" title={t('atrium.customize.sectionOutline')}>
                <ShapeStyleControls {...props} part="outline" />
              </Section>
            )}
          </CustomizationPanel>
        )
      })()}


      {embedAsk && (
        <EmbedLinkBox
          at={embedAsk.screen}
          onEmbed={urls => placeEmbeds(urls, embedAsk.world)}
          onCancel={() => setEmbedAsk(null)}
        />
      )}

      {showReportForm && (
        <ReportFeedbackModal
          onClose={() => setShowReportForm(false)}
          username={username}
          atriumName={currentLobby?.name ?? lobbyId}
        />
      )}





      {/* Drawing Mode Overlay. The canvas outlasts drawing mode until its last
          strokes are saved (drawingLive), taking no pointer by then. */}
      {drawingLive && (
        <>
          {isDrawingMode && (
          <>
          {/* Drawing's panel: the Customization panel (components/Customization),
              docked where every other is. Its X leaves drawing; what drawing
              does with the canvas is said at the foot of the screen, as every
              tool's is (QuickBar's ToolHint). Clearing the drawing is one
              step: undo and redo are the buttons at the top left. */}
          <CustomizationPanel
            subtitle={editingDrawing ? t('atrium.draw.editingTitle') : t('atrium.draw.title')}
            onClose={leaveDrawing}
            closeLabel={`${t('atrium.draw.exit')} — Esc`}
            zIndex={9999}
            actions={
              <PanelAction icon={ACTION_ICONS.delete} label={t('common.clear')} danger disabled={drawingMembers.size === 0} onClick={clearDrawing} />
            }
          >
            <div className="pt-3 pb-1">
              {/* Draw / Eraser toggle */}
              <div className="flex border border-nier-border/40">
                <button
                  onClick={() => setIsEraserMode(false)}
                  className={`flex-1 px-3 py-1 text-xs tracking-wider uppercase transition-all ${!isEraserMode ? 'bg-white text-black' : 'bg-transparent text-nier-bg/70 hover:text-nier-strong'}`}
                >
                  ✎ {t('atrium.draw.brush')}
                </button>
                <button
                  onClick={() => setIsEraserMode(true)}
                  className={`flex-1 px-3 py-1 text-xs tracking-wider uppercase transition-all ${isEraserMode ? 'bg-white text-black' : 'bg-transparent text-nier-bg/70 hover:text-nier-strong'}`}
                >
                  ◻ {t('atrium.draw.eraser')}
                </button>
              </div>
            </div>
            {!isEraserMode && (
            <Section id="brush" title={t('atrium.draw.brush')}>
              {/* Which brush: each a row, the picture of its mark beside its
                  name. The name was a line of text under a grid of pictures,
                  which read as a caption for nothing in particular. Imported
                  brushes as their tip, and on desktop the way to import one. */}
              <div role="radiogroup" aria-label={t('atrium.draw.brush')} className="flex flex-col gap-0.5">
                {BUILTIN_BRUSHES.map(brush => (
                  <button
                    key={brush}
                    type="button"
                    role="radio"
                    data-brush={brush}
                    aria-checked={drawingBrush === brush}
                    onClick={() => setDrawingBrush(brush)}
                    className={`flex items-center gap-2 h-8 px-1.5 border text-left transition-colors ${
                      drawingBrush === brush
                        ? 'border-nier-bg bg-nier-bg/15 text-nier-strong'
                        : 'border-transparent text-nier-bg/70 hover:border-nier-border/50 hover:text-nier-strong'
                    }`}
                  >
                    <span className="w-9 shrink-0 flex justify-center"><BrushGlyph brush={brush} /></span>
                    <span className="text-[11px] tracking-[0.12em] uppercase truncate">{t(BRUSH_LABELS[brush])}</span>
                  </button>
                ))}
                {customBrushes.map(brush => (
                  <div key={brush.id} className="relative group">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={drawingBrush === customBrushKey(brush.id)}
                      onClick={() => setDrawingBrush(customBrushKey(brush.id))}
                      className={`w-full flex items-center gap-2 h-8 px-1.5 pr-6 border text-left transition-colors ${
                        drawingBrush === customBrushKey(brush.id)
                          ? 'border-nier-bg bg-nier-bg/15 text-nier-strong'
                          : 'border-transparent text-nier-bg/70 hover:border-nier-border/50 hover:text-nier-strong'
                      }`}
                    >
                      {/* The tip itself, in the text colour. */}
                      <span className="w-9 shrink-0 flex justify-center">
                        <span
                          className="block w-5 h-5"
                          style={{
                            backgroundColor: 'currentColor',
                            WebkitMaskImage: `url("${brush.tip}")`,
                            maskImage: `url("${brush.tip}")`,
                            WebkitMaskSize: 'contain',
                            maskSize: 'contain',
                            WebkitMaskRepeat: 'no-repeat',
                            maskRepeat: 'no-repeat',
                            WebkitMaskPosition: 'center',
                            maskPosition: 'center',
                          }}
                        />
                      </span>
                      <span className="text-[11px] tracking-[0.12em] uppercase truncate">{brush.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeCustomBrush(brush.id)}
                      title={t('atrium.draw.removeBrush')}
                      aria-label={t('atrium.draw.removeBrush')}
                      className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex group-focus-within:flex w-5 h-5 items-center justify-center text-[11px] leading-none text-nier-bg/70 hover:text-nier-strong"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {isDesktop && (
                  <>
                    <button
                      type="button"
                      onClick={() => brushFileInputRef.current?.click()}
                      title={t('atrium.draw.importBrushHint')}
                      className="flex items-center gap-2 h-8 px-1.5 border border-dashed border-nier-border/40 text-nier-bg/70 hover:border-nier-border/70 hover:text-nier-strong transition-colors"
                    >
                      <span className="w-9 shrink-0 text-center">+</span>
                      <span className="text-[11px] tracking-[0.12em] uppercase truncate">{t('atrium.draw.importBrush')}</span>
                    </button>
                    <input
                      ref={brushFileInputRef}
                      type="file"
                      accept="image/png,image/webp,image/gif,image/jpeg,image/bmp"
                      className="hidden"
                      onChange={importBrush}
                    />
                  </>
                )}
              </div>
            </Section>
            )}
            {!isEraserMode && (
            <Section id="colour" title={t('atrium.draw.colour')}>
              {/* The colour, in one place: the atrium's own palette, and
                  beside it any colour at all -- which shows the colour in
                  use when that's none of the palette's. They were two
                  groups apart, the picker above the sliders and the palette
                  below them. */}
              {(() => {
                const fromPalette = DRAW_SWATCHES.some(c => c.toLowerCase() === drawingColor.toLowerCase())
                return (
                  <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-6 gap-1.5">
                      {DRAW_SWATCHES.map(color => (
                        <button
                          key={color}
                          type="button"
                          data-swatch={color}
                          onClick={() => setDrawingColor(color)}
                          title={color}
                          aria-label={color}
                          aria-pressed={drawingColor.toLowerCase() === color.toLowerCase()}
                          className={`h-6 border transition-all ${
                            drawingColor.toLowerCase() === color.toLowerCase()
                              ? 'border-nier-bg scale-110'
                              : 'border-nier-border/40 hover:border-nier-border/70'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                      <label
                        title={t('atrium.draw.anyColour')}
                        className={`relative col-span-2 h-6 border cursor-pointer transition-all ${
                          fromPalette ? 'border-nier-border/40 hover:border-nier-border/70' : 'border-nier-bg scale-105'
                        }`}
                        style={{ background: fromPalette ? ANY_COLOUR : drawingColor }}
                      >
                        {/* Filled with the colour in use, still a picker. */}
                        {!fromPalette && (
                          <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border border-black/30" style={{ background: ANY_COLOUR }} />
                        )}
                        <input
                          type="color"
                          data-any-colour=""
                          value={drawingColor}
                          onChange={(e) => setDrawingColor(e.target.value)}
                          aria-label={t('atrium.draw.anyColour')}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>
                )
              })()}
            </Section>
            )}
            <Section id="stroke" title={t('atrium.customize.sectionStroke')}>
              <DrawSlider label={isEraserMode ? t('atrium.draw.size') : t('atrium.draw.width')} value={drawingWidth} min={1} max={60} onChange={setToolSetting('width')} />
              <DrawSlider label={t('atrium.draw.smooth')} value={drawingSmoothing} min={0} max={100} unit="%" onChange={setToolSetting('smoothing')} />
              {/* Hardness: how sharp the edge is. The eraser has one too. */}
              <DrawSlider label={t('atrium.draw.hardness')} value={drawingHardness} min={0} max={100} unit="%" onChange={setToolSetting('hardness')} />
            </Section>
          </CustomizationPanel>

          {/* Brush/eraser size-preview circle - follows the cursor, sized to drawingWidth */}
          <div
            ref={brushCursorRef}
            className="fixed rounded-full pointer-events-none z-[9999]"
            style={{
              width: `${drawingWidth}px`,
              height: `${drawingWidth}px`,
              border: '1px solid #fff',
              mixBlendMode: 'difference',
              borderStyle: isEraserMode ? 'dashed' : 'solid',
              transform: 'translate(-50%, -50%)',
              display: 'none',
            }}
          />
          </>
          )}

          {/* Drawing canvas overlay - below UI buttons, above traces */}
          <canvas
            ref={drawingCanvasRef}
            className="fixed inset-0 z-[9998]"
            style={{
              cursor: 'none',
              width: '100vw',
              height: '100vh',
              // Or the browser claims pen and finger drags for scrolling and
              // gestures, and the canvas never hears them.
              touchAction: 'none',
              pointerEvents: isDrawingMode ? 'auto' : 'none',
            }}
            // Pointer events, not mouse and touch. A tablet pen arrives on
            // Windows as touch, whose handlers drew the stroke but never moved
            // the brush circle -- so the circle stayed behind while the pen drew
            // somewhere else. Pointer events are one path for mouse, pen and
            // touch alike, and the only ones that carry pen pressure.
            onPointerEnter={() => {
              if (brushCursorRef.current) brushCursorRef.current.style.display = 'block'
              setPointerOnDrawingCanvas(true)
            }}
            onPointerLeave={() => {
              if (brushCursorRef.current) brushCursorRef.current.style.display = 'none'
              setPointerOnDrawingCanvas(false)
            }}
            onPointerDown={(e) => {
              // A second finger is not a second brush.
              if (!e.isPrimary) return
              if (e.button === 0) {
                e.preventDefault()
                e.stopPropagation()
                // Keeps the stroke's events coming to the canvas even if the pen
                // strays over a panel mid-line.
                e.currentTarget.setPointerCapture(e.pointerId)
                // In the world, so it stays where it's drawn as the view moves.
                const at = pointToWorld(e.clientX, e.clientY, drawView())
                const point = strokePoint(at.x, at.y, e.pointerType, e.pressure)
                strokeWidthRef.current = drawingWidthRef.current / zoomRef.current
                strokeZoomRef.current = zoomRef.current
                currentStrokeRef.current = [point]
                currentSeedRef.current = newStrokeSeed()
                smoothedPointRef.current = { x: point.x, y: point.y }
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
            onPointerMove={(e) => {
              if (!e.isPrimary) return
              if (brushCursorRef.current) {
                brushCursorRef.current.style.left = `${e.clientX}px`
                brushCursorRef.current.style.top = `${e.clientY}px`
              }
              if (!isDrawing) return
              // Every sample since the last frame, not just the newest: a pen
              // reports far faster than the screen redraws, and dropping the
              // in-between points is what makes a fast pen stroke angular.
              const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? []
              const view = drawView()
              for (const sample of coalesced.length ? coalesced : [e.nativeEvent]) {
                const at = pointToWorld(sample.clientX, sample.clientY, view)
                addStrokeSample(strokePoint(at.x, at.y, sample.pointerType, sample.pressure))
              }
              renderDrawingCanvas()
            }}
            onPointerUp={finishStroke}
            // The system taking the pointer away -- a palm, a gesture -- keeps
            // what was drawn rather than throwing it out.
            onPointerCancel={finishStroke}
            onWheel={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
          />
        </>
      )}

      {/* The laser pointer: this person's while it's in hand, everyone's
          always (lib/laser). After the drawing canvas, so someone pointing
          shows over a drawing in progress. */}
      <LaserLayer active={laserActive} settings={laserSettings} view={drawView} onPointerInside={setPointerOnLaser} />

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
            
            {/* Above "Place Trace", because these act on something the user is
                already holding rather than starting a new thing -- and because
                they're what someone came to the menu for when they came with
                something copied.

                Paste Image is desktop only, matching Ctrl+V: turning a
                clipboard image into a trace writes the file into the vault,
                which the web app has no equivalent of. Paste as Embed only
                stores a URL, so it works everywhere.

                Neither is hidden when the clipboard is empty: finding that
                out costs a clipboard read, and a clipboard read is what summons
                the browser's own paste prompt. Better an entry that reports it
                had nothing to paste than a native prompt on every right-click.
                */}
            {(() => {
              const canPasteImage = isDesktop
              const canPasteEmbed = true

              const anchor = { x: mapContextMenu.worldX, y: mapContextMenu.worldY }
              const entryClass = 'w-full px-3 py-1.5 text-left text-nier-bg text-xs tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors flex items-center gap-2'

              return (
                <div className="border-b border-nier-border/20 mb-1 pb-1">
                  {canPasteImage && (
                    <button
                      className={entryClass}
                      onClick={() => {
                        setMapContextMenu(null)
                        void handlePasteImageAt(anchor.x, anchor.y)
                      }}
                    >
                      ◇ {t('atrium.canvas.pasteImage')}
                    </button>
                  )}
                  {canPasteEmbed && (
                    <button
                      className={entryClass}
                      onClick={() => {
                        setMapContextMenu(null)
                        void handlePasteEmbedAt(anchor.x, anchor.y)
                      }}
                    >
                      ◇ {t('atrium.canvas.pasteEmbed')}
                    </button>
                  )}
                </div>
              )
            })()}

            <div className="px-3 py-1.5 text-nier-bg/70 text-[11px] tracking-[0.2em] uppercase select-none">
              {t('atrium.canvas.placeTrace')}
            </div>
            {([
              { label: `◇ ${t('atrium.trace.type.text')}`, type: 'text' as const, shape: undefined },
              { label: `◇ ${t('atrium.trace.type.embed')}`, type: 'embed' as const, shape: undefined },
              { label: `◇ ${t('atrium.trace.type.shape')}`, type: 'shape' as const, shape: 'rectangle' as const },
              { label: `~ ${t('atrium.trace.shape.path')}`, type: 'shape' as const, shape: 'path' as const },
              { label: `⬚ ${t('atrium.trace.type.frame')}`, type: 'frame' as const, shape: undefined },
              ...(isDesktop ? [
                { label: `◇ ${t('atrium.trace.type.image')}`, type: 'image' as const, shape: undefined },
                { label: `◇ ${t('atrium.trace.type.sound')}`, type: 'audio' as const, shape: undefined },
                { label: `◇ ${t('atrium.trace.type.video')}`, type: 'video' as const, shape: undefined },
                { label: `◇ ${t('atrium.trace.type.document')}`, type: 'document' as const, shape: undefined },
                { label: `◇ ${t('atrium.trace.type.spreadsheet')}`, type: 'sheet' as const, shape: undefined },
              ] : []),
            ]).map((item) => (
              <button
                key={item.label}
                className="w-full px-3 py-1.5 text-left text-nier-bg text-xs tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors flex items-center gap-2"
                onClick={async () => {
                  const anchor = { x: mapContextMenu.worldX, y: mapContextMenu.worldY }
                  const screen = { x: mapContextMenu.x, y: mapContextMenu.y }
                  setMapContextMenu(null)

                  // Text skips the panel entirely.
                  //
                  // Every other type needs something before it can exist -- a
                  // URL, a file, a shape kind -- so a form is the only way to
                  // ask. A text trace needs nothing: the form's one field is
                  // the same text you are about to type into the trace itself,
                  // so filling it in means typing the words somewhere else
                  // first and then watching them appear somewhere else again.
                  // Make it, and put the cursor in it.
                  // A frame needs nothing either: made where the menu was
                  // opened, taking in what lies loose there (TraceOverlay).
                  if (item.type === 'frame') {
                    setFrameRequest({ x: anchor.x, y: anchor.y })
                    return
                  }
                  // A spreadsheet: picked, then placed where the menu was opened.
                  if (item.type === 'sheet') {
                    importAnchorRef.current = anchor
                    spreadsheetInputRef.current?.click()
                    return
                  }

                  if (item.type === 'text') {
                    if (!ensureLobbyHasSpace()) return
                    const id = await insertDroppedTrace('text', '', undefined, anchor.x, anchor.y)
                    if (id) setNewTextTraceId({ id })
                    return
                  }

                  // An embed: its link asked for there.
                  if (item.type === 'embed') {
                    setEmbedAsk({ world: anchor, screen })
                    return
                  }
                  // A path: begun there, its points clicked on from it.
                  if (item.type === 'shape' && item.shape === 'path') {
                    const id = await insertShapeTrace(nextShapeStyle('path'), anchor, [anchor])
                    if (id) setNewPathTraceId(id)
                    return
                  }
                  // A shape: the one Shapes has in hand, at a usual size there.
                  if (item.type === 'shape') {
                    const id = await insertShapeTrace(nextShapeStyle(shapeKindRef.current), anchor, undefined, { width: 200 / zoomRef.current, height: 150 / zoomRef.current })
                    if (id) setCustomizeRequest([id])
                    return
                  }
                  // A file: picked, then placed there as a drop is.
                  importAnchorRef.current = anchor
                  const input = traceFileInputRef.current
                  if (!input) return
                  input.accept = TRACE_FILE_ACCEPT[item.type]
                  input.click()
                }}
              >
                {item.label}
              </button>
            ))}

            {/* Desktop reaches Pinterest through a linked web account rather
                than its own OAuth, but once linked it imports exactly the
                same way -- so the entry belongs on both. */}
            <div className="border-t border-nier-border/20 mt-1 pt-1">
              <button
                className="w-full px-3 py-1.5 text-left text-nier-bg text-xs tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors flex items-center gap-2"
                onClick={() => {
                  const anchor = { x: mapContextMenu.worldX, y: mapContextMenu.worldY }
                  setMapContextMenu(null)
                  openPinterestImport(anchor)
                }}
              >
                ◇ {t('atrium.canvas.pinterestBoards')}
              </button>
            </div>
            {/* What's here, out; another atrium's traces, in, where the menu was opened. */}
            <div className="border-t border-nier-border/20 mt-1 pt-1">
              <button
                className="w-full px-3 py-1.5 text-left text-nier-bg text-xs tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors flex items-center gap-2"
                onClick={() => {
                  setMapContextMenu(null)
                  setExportOf({ ids: selectionRef.current })
                }}
              >
                ◇ {t('atrium.export.open')}
              </button>
              <button
                className="w-full px-3 py-1.5 text-left text-nier-bg text-xs tracking-[0.15em] uppercase hover:bg-nier-bg/10 transition-colors flex items-center gap-2"
                onClick={() => {
                  importAnchorRef.current = { x: mapContextMenu.worldX, y: mapContextMenu.worldY }
                  setMapContextMenu(null)
                  atriumFileInputRef.current?.click()
                }}
              >
                ◇ {t('atrium.import.here')}
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={atriumFileInputRef}
        type="file"
        accept=".atrium"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importAtriumHere(file, importAnchorRef.current)
        }}
      />
      {/* The quick bar's Image and Other: a file, placed as a drop is. */}
      <input
        ref={traceFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length > 0 && ensureLobbyHasSpace()) void placeFilesAsTraces(files, importAnchorRef.current.x, importAnchorRef.current.y)
        }}
      />
      <input
        ref={spreadsheetInputRef}
        type="file"
        accept=".xlsx,.xlsm,.ods,.csv"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void importSpreadsheetHere(file, importAnchorRef.current)
        }}
      />

      {exportOf && (
        <ExportDialog
          lobbyName={currentLobby?.name ?? 'atrium'}
          lobbyMeta={{ themeSettings: currentLobby?.themeSettings ?? null, isPublic: !!currentLobby?.isPublic, maxPlayers: currentLobby?.maxPlayers ?? 50 }}
          background={viewTheme?.backgroundColor || '#0a0a0f'}
          selection={exportOf.ids}
          initialFormat={exportOf.format}
          onClose={() => setExportOf(null)}
        />
      )}

      {/* Trace Panel */}
      {showPinterestConnect && (
        <PinterestConnectionPanel
          onClose={() => setShowPinterestConnect(false)}
          onConnected={() => {
            setPinterestConnected(true)
            setShowPinterestConnect(false)
            setShowPinterestImport(true)
          }}
          onConnectStart={importAfterPinterestConnect}
        />
      )}

      {/* Pinterest Import Panel */}
      {showPinterestImport && (
        <PinterestImportPanel
          onClose={() => { setShowPinterestImport(false); setPinterestImportAnchor(null) }}
          lobbyId={lobbyId}
          worldCenter={pinterestImportAnchor || { x: positionRef.current.x, y: positionRef.current.y }}
          packingShape={packingShapeRef.current}
        />
      )}

      {/* Locations Panel */}
      {showLocationsPanel && (
        <LocationsPanel
          onClose={() => setShowLocationsPanel(false)}
          canEdit={canEdit}
          locations={locations}
          onAdd={addLocation}
          onRename={renameLocation}
          onUpdateCamera={updateLocationCamera}
          onToggleLock={toggleLocationLock}
          onDelete={deleteLocation}
          onReorder={reorderLocations}
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
          onSelectGroupTraces={(traceIds) => setMultiSelectRequest(traceIds)}
          // Same channel a group-header click already uses: the panel says what
          // should be selected, and the canvas is what holds a selection.
          onSetSelection={(traceIds) => setMultiSelectRequest([...traceIds])}
          onCustomize={(traceIds) => {
            if (traceIds.length === 0) return
            setShowLayerPanel(false)
            setCustomizeRequest([...traceIds])
          }}
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



      {/* Theme Customization Modal */}
      {showThemeCustomization && currentLobby && (
        <ThemeCustomization
          lobby={currentLobby}
          viewRef={viewRef}
          onPick={pickTheme}
          canSaveForAtrium={isLobbyOwner || isLobbyAdmin}
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

      {/* Leaving with changes that couldn't be saved (the Leave button tries
          first): try again, or leave without them. */}
      {showLeaveDialog && (() => {
        const barBottom = sessionBarRef.current ? sessionBarRef.current.getBoundingClientRect().bottom : 56
        return (
        <div
          className="fixed inset-0 z-[10000100] pointer-events-auto"
          onClick={() => setShowLeaveDialog(false)}
        >
          <div
            className="bg-nier-black border border-nier-border/50 p-6 absolute right-4"
            style={{ top: `${barBottom + 8}px`, maxWidth: '200px' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/50 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/50 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/50 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/50 pointer-events-none" />

            <h3 className="text-nier-strong font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
              <span className="text-nier-bg/70 mr-2">◇</span>{t('atrium.dialog.unsavedTitle')}
            </h3>
            <p className="text-nier-bg/70 text-xs font-mono tracking-wider text-center mb-6">
              {t('atrium.dialog.unsavedBody', { count: unsavedActions(useGameStore.getState()) })}
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  // Tried again. Still failing, it stays: leaving would lose
                  // the changes without anyone having said to.
                  if (!(await saveAllChanges())) return
                  setShowLeaveDialog(false)
                  leaveWithTransition()
                }}
                className="w-full bg-nier-bg hover:bg-nier-strong text-nier-black font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all"
              >
                ◇ {t('atrium.dialog.saveAndLeave')}
              </button>
              <button
                onClick={() => {
                  useGameStore.getState().clearPendingChanges()
                  setShowLeaveDialog(false)
                  leaveWithTransition()
                }}
                className="w-full bg-red-900 hover:bg-red-700 text-nier-strong font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-red-600"
              >
                {t('atrium.dialog.leaveWithoutSaving')}
              </button>
              <button
                onClick={() => setShowLeaveDialog(false)}
                className="w-full bg-nier-blackLight hover:bg-nier-blackLight text-nier-bg/80 font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-nier-border/40"
              >
                {t('atrium.dialog.returnToAtrium')}
              </button>
            </div>
          </div>
        </div>
        )
      })()}

      {/* Kick User Confirmation */}
      {kickTarget && (
        <div
          className="fixed inset-0 z-[10000100] bg-nier-black/70 flex items-center justify-center pointer-events-auto"
          onClick={() => !isKicking && setKickTarget(null)}
        >
          <div
            className="bg-nier-black border border-nier-border/50 p-6 relative"
            style={{ maxWidth: '320px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/50 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/50 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/50 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/50 pointer-events-none" />

            <h3 className="text-nier-strong font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
              <span className="text-nier-bg/70 mr-2">◇</span>{t('atrium.dialog.kickTitle')}
            </h3>
            <p className="text-nier-bg/70 text-xs font-mono tracking-wider text-center mb-6">
              {t('atrium.dialog.kickPre')} <span className="text-nier-strong">{kickTarget.username}</span> {t('atrium.dialog.kickPost')}
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => executeKick(kickTarget.userId, false)}
                disabled={isKicking}
                className="w-full bg-nier-bg hover:bg-nier-strong text-nier-black font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all disabled:opacity-50"
              >
                {isKicking ? t('atrium.dialog.kicking') : t('atrium.hud.kick')}
              </button>
              <button
                onClick={() => executeKick(kickTarget.userId, true)}
                disabled={isKicking}
                className="w-full bg-red-900 hover:bg-red-700 text-nier-strong font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-red-600 disabled:opacity-50"
              >
                {isKicking ? t('atrium.dialog.kicking') : t('atrium.dialog.kickBlacklist')}
              </button>
              <button
                onClick={() => setKickTarget(null)}
                disabled={isKicking}
                className="w-full bg-nier-blackLight hover:bg-nier-blackLight text-nier-bg/80 font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-nier-border/40 disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Local File Drop Blocked (web only) */}
      {showLocalFileBlockedDialog && (
        <div
          className="fixed inset-0 z-[10000100] bg-nier-black/70 flex items-center justify-center pointer-events-auto"
          onClick={() => setShowLocalFileBlockedDialog(false)}
        >
          <div
            className="bg-nier-black border border-nier-border/50 p-6 relative"
            style={{ maxWidth: '360px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/50 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/50 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/50 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/50 pointer-events-none" />

            <h3 className="text-nier-strong font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
              <span className="text-nier-bg/70 mr-2">◇</span>{t('atrium.dialog.localFilesTitle')}
            </h3>
            <p className="text-nier-bg/70 text-xs font-mono tracking-wider text-center mb-6">
              {t('atrium.dialog.localFilesBody')}
            </p>

            <div className="flex flex-col gap-2">
              <a
                href="/desktop"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-nier-bg hover:bg-nier-strong text-nier-black font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all text-center"
              >
                ◇ {t('atrium.dialog.getDesktopApp')}
              </a>
              <button
                onClick={() => setShowLocalFileBlockedDialog(false)}
                className="w-full bg-nier-blackLight hover:bg-nier-blackLight text-nier-bg/80 font-mono text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-nier-border/40"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
