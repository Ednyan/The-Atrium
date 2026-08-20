// ...existing code...
// ...existing code...
// ...existing code...
// Removed useEffectOnce, use standard useEffect
import React, { useState, useRef, useEffect, Fragment, useCallback } from 'react'
import type { Trace } from '../types/database'
import { supabase, isDesktop } from '../lib/supabase'
import { useGameStore, LOBBY_SIZE_LIMIT } from '../store/gameStore'

// Lazy import for Tauri-only modules (avoids importing Tauri plugins in web mode)
async function resolveLocalUrl(url: string): Promise<string> {
  const mod = await import('../lib/localDb')
  return mod.resolveLocalUrl(url)
}

import ProfileCustomization from './ProfileCustomization'
import { saveAllChanges, TRACE_SAVE_COMPLETED_EVENT, TRACE_DISCARD_COMPLETED_EVENT } from '../lib/traceSave'
import { convertEmbedToInternalImage } from '../lib/traceConvert'
import { computeAutoFitTextSize } from '../lib/textFit'
import { TRACE_PRESETS, rememberTracePreset } from '../lib/tracePresets'
import { readUndoDepth } from '../lib/atriumPreferences'
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition'
import { openExternalUrl } from '../lib/openExternal'
import { toEmbedUrl } from '../lib/embedUrl'
import { getTraceBaseZIndex } from '../lib/layerZIndex'
import { buildTraceInsertRow } from '../lib/traceInsert'
import { packBoxesAroundCenter, probeRemoteImageDimensions, scaleToDisplayBox } from '../lib/binPack'

// Custom fonts: drop a font file -- or a whole Google-Fonts-style family
// folder -- into src/assets/fonts. Each family becomes ONE Font Family
// dropdown entry, named after its folder (or the filename for a bare file),
// using the family's variable font when present (else its Regular weight).
// Bundled at build time via import.meta.glob, so there's no runtime directory
// listing (works on any host).
//
// Two patterns, both only ONE level deep: bare files directly in fonts/, and
// files at the ROOT of a family folder. Deliberately NOT recursive -- a Google
// Fonts download nests every individual weight under a static/ subfolder (54
// files for Roboto alone, 72 for Datatype), and bundling all of those would
// bloat the app for no benefit since the root-level variable font already
// covers every weight.
const CUSTOM_FONT_URL_MAP = import.meta.glob(
  [
    '../assets/fonts/*.{ttf,otf,woff,woff2,TTF,OTF,WOFF,WOFF2}',
    '../assets/fonts/*/*.{ttf,otf,woff,woff2,TTF,OTF,WOFF,WOFF2}',
    // Exclude italic files -- we only surface one (roman) entry per family, so
    // an eager glob would otherwise still emit every family's italic variable
    // font as a bundled asset for nothing. Italic text still works via the
    // textItalic toggle (browser-synthesized slant).
    '!../assets/fonts/**/*[Ii]talic*',
  ],
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

// One entry per family. The name (dropdown label + @font-face family) is the
// family-folder name (or the bare filename), sanitized to alphanumerics/_/-.
const CUSTOM_FONTS: { name: string; url: string }[] = (() => {
  const byFamily: Record<string, { file: string; url: string }[]> = {}
  for (const [path, url] of Object.entries(CUSTOM_FONT_URL_MAP)) {
    const rest = path.split('assets/fonts/')[1] ?? path
    const seg0 = rest.split('/')[0]
    const isBareFile = seg0.includes('.')
    const rawName = isBareFile ? seg0.replace(/\.[^.]+$/, '') : seg0
    const name = rawName.replace(/[^a-zA-Z0-9_-]/g, '_')
    const file = path.split('/').pop() || path
    ;(byFamily[name] ??= []).push({ file, url })
  }
  const isVariable = (f: string) => /variablefont|\[.*\]/i.test(f)
  const isItalic = (f: string) => /italic/i.test(f)
  const isRegular = (f: string) => /-regular\.|(^|[^a-z])regular\b/i.test(f)
  return Object.entries(byFamily)
    .map(([name, files]) => {
      const chosen =
        files.find(f => isVariable(f.file) && !isItalic(f.file)) ||
        files.find(f => isVariable(f.file)) ||
        files.find(f => isRegular(f.file) && !isItalic(f.file)) ||
        files.find(f => !isItalic(f.file)) ||
        files[0]
      return { name, url: chosen.url }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})()

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

// Maps a stored fontFamily value to the actual CSS font-family used to
// render it. Generic keywords (sans/serif/mono) and the new web-safe OS
// fonts get a real fallback stack; everything else (palatino, impact,
// cursive, fantasy, system-ui, and any custom font name) passes through
// unchanged -- those are already valid single-token CSS values on their own.
// One shared function instead of four copies of the same lookup object (one
// per place a font actually gets applied/measured) so adding a font only
// means editing this one map.
const FONT_FAMILY_CSS_MAP: Record<string, string> = {
  sans: 'sans-serif',
  serif: 'serif',
  mono: 'monospace',
  arial: 'Arial, Helvetica, sans-serif',
  times: "'Times New Roman', Times, serif",
  georgia: "Georgia, 'Times New Roman', serif",
  courier: "'Courier New', Courier, monospace",
  verdana: 'Verdana, Geneva, sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  trebuchet: "'Trebuchet MS', 'Lucida Grande', sans-serif",
  segoe: "'Segoe UI', Tahoma, sans-serif",
  calibri: 'Calibri, Candara, sans-serif',
  consolas: "Consolas, 'Courier New', monospace",
  'century-gothic': "'Century Gothic', 'Apple Gothic', sans-serif",
}

function resolveFontFamilyCss(key: string): string {
  return FONT_FAMILY_CSS_MAP[key] || key
}

interface TraceOverlayProps {
  traces: Trace[]
  lobbyWidth: number
  lobbyHeight: number
  zoom: number
  worldOffset: { x: number; y: number }
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
  // One-shot request from LobbyScene: a brand-new path trace (just inserted
  // with a single starting point) that should be selected and immediately
  // put into point-placing mode, instead of leaving the user to find the
  // Customize panel's "Add Points" button themselves. Trace ids are always
  // freshly generated, so a plain useEffect keyed on this value fires
  // correctly for every new path without needing to be reset back to null.
  newPathRequest?: string | null
  // While true, Ctrl+Z/Ctrl+Shift+Z are owned by the drawing-mode stroke
  // undo (see LobbyScene) instead of this file's trace undo/redo history.
  isDrawingMode?: boolean
  // Reports this file's current multi-selection up to LobbyScene so the
  // Layer panel (a sibling, not a child, of this component) can highlight
  // every multi-selected trace/group, not just the single selectedTraceId.
  onMultiSelectionChange?: (ids: string[]) => void
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

const ROTATION_SNAP_DEGREES = 5

// How close to the viewport edge the cursor has to get before dragging a
// trace starts scrolling the canvas, and how far it scrolls per frame at the
// very edge (screen pixels, converted to world units at the current zoom).
const EDGE_PAN_ZONE_PX = 64
const EDGE_PAN_MAX_SPEED_PX = 14

// Wraps any angle into [0, 360) -- plain `% 360` keeps negative values.
const normalizeAngle = (deg: number) => ((deg % 360) + 360) % 360

const TRACE_CLIPBOARD_MIME = 'application/x-digital-atrium-traces'
const TRACE_CLIPBOARD_TEXT_SENTINEL = '__DIGITAL_ATRIUM_TRACE_CLIPBOARD__'

// Trace z-index encodes layer*100 + order-within-layer (see layerZIndex.ts)
// and is intentionally left uncapped so traces compare correctly across
// layers. Selection handles (the `z-[1000000]` Tailwind classes below),
// other users' cursors, and the local player's own cursor all need to stay
// above every trace regardless, so they use fixed values far above any
// realistic trace z-index rather than a small constant the traces have to
// stay under. Ordered handles < other users' cursors < own cursor, matching
// this file's original (pre-uncapped-trace-zIndex) hardcoded values of 50,
// 999, and 10003 respectively.
const OTHER_USER_CURSOR_Z_INDEX = 2_000_000
// Own-cursor z-index floor: playerZIndex*100 is meant to place the local
// cursor above all layers (it's set to (layerCount+1)*100 -- see
// LayerPanel's repairDuplicateZIndexes), but that's frequently far below the
// handle/other-cursor z-index above (e.g. the default playerZIndex of 1000
// is only 100,000) since it was never designed with editing UI in mind.
// Flooring the value used for both sort position and the cursor's actual
// rendered zIndex keeps the player's own cursor on top without touching the
// stored playerZIndex value other code relies on. This also has to clear
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
// ~300. MENU_PANEL_Z_INDEX is for the actual menu/dialog content; menus
// that have a separate click-outside-to-close backdrop element (Customize,
// Batch Edit) use MENU_BACKDROP_Z_INDEX for that, which must stay below the
// panel itself. Single self-contained overlays (context menu, delete
// confirm, full-view modal) just use MENU_PANEL_Z_INDEX for the whole thing.
const MENU_BACKDROP_Z_INDEX = 10_000_000
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

// Builds an SVG path `d` string that traces the given polygon with each
// corner cut and rounded by `radius` (in the same units as the points) --
// SVG polygons have no rx/ry equivalent the way <rect> does, so a shape
// like the triangle needs its own path built by hand to get a Corner
// Radius option. Clamps each corner's radius to half its shorter adjacent
// edge so radius can't be dragged past where opposite roundings would meet
// and overlap/invert.
function roundedPolygonPath(points: { x: number; y: number }[], radius: number): string {
  if (radius <= 0) {
    return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'
  }
  const n = points.length
  const segments: string[] = []
  for (let i = 0; i < n; i++) {
    const curr = points[i]
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]

    const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y }
    const toNext = { x: next.x - curr.x, y: next.y - curr.y }
    const distPrev = Math.hypot(toPrev.x, toPrev.y) || 1
    const distNext = Math.hypot(toNext.x, toNext.y) || 1
    const rPrev = Math.min(radius, distPrev / 2)
    const rNext = Math.min(radius, distNext / 2)

    const startPoint = { x: curr.x + (toPrev.x / distPrev) * rPrev, y: curr.y + (toPrev.y / distPrev) * rPrev }
    const endPoint = { x: curr.x + (toNext.x / distNext) * rNext, y: curr.y + (toNext.y / distNext) * rNext }

    segments.push(i === 0 ? `M${startPoint.x},${startPoint.y}` : `L${startPoint.x},${startPoint.y}`)
    segments.push(`Q${curr.x},${curr.y} ${endPoint.x},${endPoint.y}`)
  }
  segments.push('Z')
  return segments.join(' ')
}

export default function TraceOverlay({ traces, lobbyWidth, lobbyHeight, zoom, worldOffset, onEdgePan, lobbyId, selectedTraceId, setSelectedTraceId, multiSelectRequest, newPathRequest, isDrawingMode, onMultiSelectionChange, canEdit = true }: TraceOverlayProps) {
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
  const { position, username, playerZIndex, playerColor, cursorState, setCursorState, otherUsers, removeTrace, userId, addTrace, markTraceChanged, markTraceDeleted, pendingChanges, deletedTraces, hasPendingChanges, showTraceTypeLabels, hideOwnNameTag, hideOtherNameTags, hideOtherCursors, traceFadeEnabled } = useGameStore()
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
      if (trace.type !== 'document' || !trace.mediaUrl) continue
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
              setDocumentError(prev => ({ ...prev, [trace.id]: 'File not found in the vault' }))
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
          console.error('PDF page render failed:', err)
          // The real message, not a generic one -- "could not read this PDF"
          // told nobody anything when this went wrong.
          setDocumentError(prev => ({
            ...prev,
            [trace.id]: err instanceof Error ? err.message : 'Could not read this PDF',
          }))
        } finally {
          documentRenderingRef.current.delete(key)
        }
      })()
    }
  }, [traces, documentPage, documentPages, documentPageCount, documentRetryTick])

  const [pressedClickableId, setPressedClickableId] = useState<string | null>(null)

  // How long the trace stays visibly pressed after the click before the link
  // actually opens, so the press reads as a press rather than the atrium
  // seeming to jump straight to a browser.
  const LINK_OPEN_DELAY_MS = 1000
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
  // context menu, without opening the Layer panel. Needs its own lightweight
  // list of this atrium's groups since TraceOverlay doesn't otherwise load
  // them (the Layer panel does, but it isn't always mounted).
  const [contextMenuGroupOpen, setContextMenuGroupOpen] = useState(false)
  const [groupFlyoutRect, setGroupFlyoutRect] = useState<{ top: number; left: number; right: number } | null>(null)
  const groupFlyoutCloseTimer = useRef<number | null>(null)
  const openGroupFlyout = (e: React.MouseEvent<HTMLElement>) => {
    if (groupFlyoutCloseTimer.current) window.clearTimeout(groupFlyoutCloseTimer.current)
    const rect = e.currentTarget.getBoundingClientRect()
    setGroupFlyoutRect({ top: rect.top, left: rect.left, right: rect.right })
    setContextMenuGroupOpen(true)
  }
  const keepGroupFlyoutOpen = () => {
    if (groupFlyoutCloseTimer.current) window.clearTimeout(groupFlyoutCloseTimer.current)
  }
  const scheduleCloseGroupFlyout = () => {
    if (groupFlyoutCloseTimer.current) window.clearTimeout(groupFlyoutCloseTimer.current)
    groupFlyoutCloseTimer.current = window.setTimeout(() => setContextMenuGroupOpen(false), 200)
  }
  const [groupLayers, setGroupLayers] = useState<{ id: string; name: string; zIndex: number }[]>([])
  useEffect(() => {
    if (!supabase || !lobbyId) return
    let cancelled = false
    const loadLayers = async () => {
      const { data } = await (supabase!.from('layers') as any)
        .select('id, name, z_index')
        .eq('lobby_id', lobbyId)
      if (cancelled || !data) return
      setGroupLayers(
        data
          .map((l: any) => ({ id: l.id, name: l.name, zIndex: l.z_index ?? 0 }))
          .sort((a: any, b: any) => b.zIndex - a.zIndex)
      )
    }
    loadLayers()
    const channel = supabase
      .channel(`traceoverlay-layers-${lobbyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'layers', filter: `lobby_id=eq.${lobbyId}` }, () => loadLayers())
      .subscribe()
    return () => {
      cancelled = true
      channel.unsubscribe()
    }
  }, [lobbyId])

  // Reassigns the given traces to a layer group (or Ungrouped when
  // targetLayerId is null), placing them at the top of that group. Mirrors
  // the z-index scheme in LayerPanel/layerZIndex (base = layerZIndex*100,
  // then order within the layer).
  const moveTracesToGroup = useCallback(async (traceIds: string[], targetLayerId: string | null) => {
    if (!supabase || !canEdit || traceIds.length === 0) return
    const store = useGameStore.getState()
    const allTraces = store.traces
    const targetLayer = targetLayerId ? groupLayers.find(l => l.id === targetLayerId) : null
    if (targetLayerId && !targetLayer) return
    const baseZ = targetLayer ? getTraceBaseZIndex(targetLayer.zIndex) : 0
    const idSet = new Set(traceIds)
    let order = allTraces.filter(t => (t.layerId ?? null) === targetLayerId && !idSet.has(t.id)).length
    for (const id of traceIds) {
      const trace = allTraces.find(t => t.id === id)
      if (!trace || (trace.layerId ?? null) === targetLayerId) continue
      const newZ = baseZ + order + 1
      order++
      const { error } = await (supabase.from('traces') as any)
        .update({ layer_id: targetLayerId, z_index: newZ })
        .eq('id', id)
      if (!error) {
        store.addTrace({ ...trace, layerId: targetLayerId, zIndex: newZ })
      }
    }
  }, [canEdit, groupLayers])

  const [editingTrace, setEditingTrace] = useState<Trace | null>(null)
  const [imageProxySources, setImageProxySources] = useState<Record<string, string>>({}) // Track which images use proxy
  const [localMediaUrls, setLocalMediaUrls] = useState<Record<string, string>>({}) // Track resolved local:// URLs for audio/video
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{ traceIds: string[] } | null>(null)
  const [playingMedia, setPlayingMedia] = useState<Set<string>>(new Set()) // Track traces with playing media
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set()) // Track traces with failed image loads
  const [imageRetryCount, setImageRetryCount] = useState<Record<string, number>>({}) // Track retry attempts per trace
  const processedImageIds = React.useRef<Set<string>>(new Set()) // Track which images have been preflight-tested
  const [confirmedImageIds, setConfirmedImageIds] = useState<Set<string>>(new Set()) // Track embeds confirmed to be actual images (even without file extension)
  const [pathCreationMode, setPathCreationMode] = useState(false) // Track if we're in path creation mode
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null) // Track selected point for control handle editing
  const [localShapePoints, setLocalShapePoints] = useState<Record<string, any[]>>({}) // Track shape points during drag
  const [colorPickerCallback, setColorPickerCallback] = useState<((color: string) => void) | null>(null) // For fallback color picker
  const [inlineEditingTraceId, setInlineEditingTraceId] = useState<string | null>(null) // Track which text trace is being inline edited
  const copiedTraceClipboardRef = useRef<TraceClipboardPayload | null>(null)
  const hasEyeDropperSupport = typeof window !== 'undefined' && 'EyeDropper' in window
  const [inlineEditText, setInlineEditText] = useState<string>('') // Track the text being edited
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set()) // Track multi-selected traces
  const [showBatchEditPanel, setShowBatchEditPanel] = useState(false) // Batch-edit shared properties across multiSelectedIds

  // Report the current multi-selection up to LobbyScene so the Layer panel
  // (a sibling component) can mirror the highlight.
  useEffect(() => {
    onMultiSelectionChange?.(Array.from(multiSelectedIds))
  }, [multiSelectedIds, onMultiSelectionChange])

  const startPosRef = useRef<{ x: number; y: number; corner: string; initialPoint?: {x: number, y: number}; initialCpx?: number; initialCpy?: number; initialPoints?: any[] }>({ x: 0, y: 0, corner: '' })
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
    traces: Record<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number; shapePoints?: any[] }>
  }>({ center: { x: 0, y: 0 }, traces: {} })

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
    setPathCreationMode(true)
  }, [newPathRequest, setSelectedTraceId])

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
        
        // Data URLs (e.g. from freehand drawing) need no proxy
        if (url.startsWith('data:')) {
          setImageProxySources(prev => ({ ...prev, [trace.id]: '' }))
          return
        }
        
        // Local desktop files — resolve to blob URL
        if (url.startsWith('local://')) {
          resolveLocalUrl(url).then(resolvedUrl => {
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
        resolveLocalUrl(trace.mediaUrl).then(resolved => {
          setLocalMediaUrls(prev => ({ ...prev, [trace.id]: resolved }))
        }).catch(() => {
          setLocalMediaUrls(prev => ({ ...prev, [trace.id]: trace.mediaUrl! }))
        })
      }
    })
  }, [traces])

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
        // Escape while actively placing a new path's points either finishes
        // it (2+ points already placed -- same as clicking "Done Adding")
        // or fully discards it (still 0-1 points, i.e. nothing meaningful
        // was drawn yet), rather than leaving a degenerate stray trace
        // behind. Uses refs (this listener is registered once, not
        // re-bound per render) rather than the render-scoped executeDelete.
        if (pathCreationModeRef.current) {
          setPathCreationMode(false)
          const currentSelectedId = selectedTraceIdRef.current
          if (currentSelectedId) {
            const trace = tracesRef.current.find(t => t.id === currentSelectedId)
            const currentEditingTrace = editingTraceRef.current
            const points = (currentEditingTrace && currentEditingTrace.id === currentSelectedId ? currentEditingTrace.shapePoints : trace?.shapePoints) || []
            if (points.length < 2) {
              removeTrace(currentSelectedId)
              markTraceDeleted(currentSelectedId)
              knownTraceIdsRef.current?.delete(currentSelectedId)
            }
          }
        }
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
        const isEditableTarget = target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT'
        if (isEditableTarget) return
        e.preventDefault()
        setPathCreationMode(false)
        const currentSelectedId = selectedTraceIdRef.current
        if (currentSelectedId) {
          const trace = tracesRef.current.find(t => t.id === currentSelectedId)
          const currentEditingTrace = editingTraceRef.current
          const points = (currentEditingTrace && currentEditingTrace.id === currentSelectedId ? currentEditingTrace.shapePoints : trace?.shapePoints) || []
          if (points.length < 2) {
            removeTrace(currentSelectedId)
            markTraceDeleted(currentSelectedId)
            knownTraceIdsRef.current?.delete(currentSelectedId)
            setSelectedTraceId(null)
            setEditingTrace(null)
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [colorPickerCallback])

  // Global right-click handler for ignoreClicks traces
  // Since pointer-events: none blocks all events, we need to manually detect right-clicks
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      // Allow native browser context menu inside selectable text areas (modal preview)
      const target = e.target as HTMLElement
      if (target.closest('.selectable-text')) {
        return // Let browser show native Copy/Paste menu
      }
      // Only handle if not clicking on an existing trace element
      if (target.closest('[data-trace-element="true"]')) {
        return // Let normal handler take care of it
      }
      
      // Check if click position overlaps with any ignoreClicks trace
      const clickX = e.clientX
      const clickY = e.clientY
      
      // Find ignoreClicks traces that contain this point
      for (const trace of traces) {
        if (!trace.ignoreClicks) continue
        
        // Calculate trace bounds in screen coordinates
        const traceX = trace.x * zoom + worldOffset.x
        const traceY = trace.y * zoom + worldOffset.y
        const scaleX = trace.scaleX ?? trace.scale ?? 1
        const scaleY = trace.scaleY ?? trace.scale ?? 1
        
        // Get trace dimensions
        const traceDims = getTraceSize(trace)
        let width = traceDims.width, height = traceDims.height
        if (trace.type === 'shape') {
          width = trace.width || 200
          height = trace.height || 200
        } else if (trace.type !== 'text' && imageDimensions[trace.id]) {
          width = imageDimensions[trace.id].width
          height = imageDimensions[trace.id].height
        }
        
        const halfWidth = (width * scaleX * zoom) / 2
        const halfHeight = (height * scaleY * zoom) / 2
        
        // Check if click is within trace bounds
        if (clickX >= traceX - halfWidth && clickX <= traceX + halfWidth &&
            clickY >= traceY - halfHeight && clickY <= traceY + halfHeight) {
          e.preventDefault()
          setContextMenu({ x: clickX, y: clickY, traceId: trace.id })
          setSelectedTraceId(trace.id)
          return
        }
      }
    }
    
    window.addEventListener('contextmenu', handleGlobalContextMenu)
    return () => window.removeEventListener('contextmenu', handleGlobalContextMenu)
  }, [traces, zoom, worldOffset, imageDimensions])

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
    
    // Ensure trace has valid transform data
    const transform = {
      x: trace.x ?? 0,
      y: trace.y ?? 0,
      scaleX: trace.scaleX ?? trace.scale ?? 1.0,
      scaleY: trace.scaleY ?? trace.scale ?? 1.0,
      rotation: trace.rotation ?? 0.0,
    }

    return transform
  }, [localTraceTransforms])

  // --- Undo/redo history ---------------------------------------------------
  // Client-side only: this stack is never persisted or sent to Supabase, on
  // either desktop or web. It resets whenever this component (re)mounts, i.e.
  // on every atrium switch and on every page reload. History depth is a
  // profile-wide preference (see ProfileCustomization.tsx), kept intentionally
  // small/bounded to avoid unbounded memory growth in a browser tab.
  const UNDO_COALESCE_WINDOW_MS = 800
  const MAX_UNDO_DEPTH = 100

  // Read from the profile rather than from this atrium. It used to be keyed by
  // lobby, so every new atrium quietly reset it to twenty.
  const getStoredUndoDepth = useCallback(() => readUndoDepth(lobbyId), [lobbyId])

  type UndoOp =
    | { kind: 'add'; traceId: string; trace: Trace }
    | { kind: 'delete'; trace: Trace }
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

  const undoStackRef = useRef<UndoOp[]>([])
  const redoStackRef = useRef<UndoOp[]>([])
  const maxUndoDepthRef = useRef(getStoredUndoDepth())
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
    }
    window.addEventListener('lobby-undo-depth-changed', handleUndoDepthChanged as EventListener)
    return () => window.removeEventListener('lobby-undo-depth-changed', handleUndoDepthChanged as EventListener)
  }, [getStoredUndoDepth])

  // Clear history whenever a save completes - a diff-based undo entry can no
  // longer be safely replayed once the rows it was computed against have
  // been persisted (other collaborators' realtime edits may land in between).
  // This is a deliberate simplification: undo does not cross a save boundary.
  //
  // Also drop the local drag-preview overrides (localTraceTransforms /
  // localShapePoints). These render ON TOP of the store's trace data so a
  // drag feels instant, but they're never cleared after a normal save -- so
  // once you'd resized/moved a trace and saved it, your client kept
  // rendering that stale local copy and silently ignored every later
  // realtime UPDATE another user made to the same trace (e.g. someone else
  // rescaling a shape you'd previously touched), until a full page reload
  // reset this component's state. The store stays authoritative now.
  useEffect(() => {
    const handleSaveCompleted = () => {
      undoStackRef.current = []
      redoStackRef.current = []
      setLocalTraceTransforms({})
      setLocalShapePoints({})
    }
    window.addEventListener(TRACE_SAVE_COMPLETED_EVENT, handleSaveCompleted)
    return () => window.removeEventListener(TRACE_SAVE_COMPLETED_EVENT, handleSaveCompleted)
  }, [])

  // Same reasoning applies to a discard ("Don't Save"): the traces array
  // just got replaced wholesale with the last-saved DB state, so any undo
  // diff is stale, and any panel showing a snapshot of a trace (Customize /
  // Batch Edit) may now be showing values that no longer exist.
  //
  // Also clear localTraceTransforms/localShapePoints entirely -- these are
  // drag-preview overrides that render ON TOP of the store's trace data
  // (see applyUpdateTarget above, and getTraceTransform's use at the actual
  // render site) so dragging feels instant without waiting for a state
  // round-trip. Undo already knew to clear these per-trace; a discard is the
  // same problem but for every trace at once. Without this, any trace moved/
  // resized/rotated (or path point dragged) during the session kept
  // rendering its unsaved position/shape indefinitely after "Don't Save",
  // since the override map still had stale entries the reverted `traces`
  // array couldn't override -- only a full page refresh (which remounts
  // this component and resets this state) made it visually revert.
  useEffect(() => {
    const handleDiscardCompleted = () => {
      undoStackRef.current = []
      redoStackRef.current = []
      setEditingTrace(null)
      setShowBatchEditPanel(false)
      setContextMenu(null)
      setLocalTraceTransforms({})
      setLocalShapePoints({})
    }
    window.addEventListener(TRACE_DISCARD_COMPLETED_EVENT, handleDiscardCompleted)
    return () => window.removeEventListener(TRACE_DISCARD_COMPLETED_EVENT, handleDiscardCompleted)
  }, [])

  const pushUpdateOp = useCallback((traceId: string, before: Partial<Trace>, after: Partial<Trace>) => {
    const stack = undoStackRef.current
    const last = stack[stack.length - 1]
    const now = Date.now()
    // Coalesce rapid-fire updates to the same trace (e.g. dragging a slider or
    // moving/resizing/rotating a trace fires many updates per second) into a
    // single undo step, keeping the original "before" and the latest "after".
    if (last && last.kind === 'update' && last.traceId === traceId && (now - last.ts) < UNDO_COALESCE_WINDOW_MS) {
      last.after = { ...last.after, ...after }
      last.ts = now
      return
    }
    stack.push({ kind: 'update', traceId, before, after: { ...after }, ts: now })
    if (stack.length > maxUndoDepthRef.current) stack.shift()
    redoStackRef.current = []
  }, [])

  // Pushes every trace moved together in a multi-select drag as ONE undo
  // step (see the 'batch' UndoOp comment above). Falls back to a plain
  // 'update' push for the trivial single-trace case.
  const pushBatchUpdateOp = useCallback((ops: { traceId: string; before: Partial<Trace>; after: Partial<Trace> }[]) => {
    if (ops.length === 0) return
    if (ops.length === 1) {
      const stack = undoStackRef.current
      stack.push({ kind: 'update', traceId: ops[0].traceId, before: ops[0].before, after: { ...ops[0].after }, ts: Date.now() })
      if (stack.length > maxUndoDepthRef.current) stack.shift()
      redoStackRef.current = []
      return
    }
    const stack = undoStackRef.current
    stack.push({ kind: 'batch', ops, ts: Date.now() })
    if (stack.length > maxUndoDepthRef.current) stack.shift()
    redoStackRef.current = []
  }, [])

  // Pushes every trace that appeared together (in the same traces-prop
  // update) as ONE undo step. Falls back to a plain 'add' for the trivial
  // single-trace case, matching pushBatchUpdateOp's pattern.
  const pushBatchAddOp = useCallback((newTraces: Trace[]) => {
    if (newTraces.length === 0) return
    if (newTraces.length === 1) {
      undoStackRef.current.push({ kind: 'add', traceId: newTraces[0].id, trace: cloneTraceSnapshot(newTraces[0]) })
      if (undoStackRef.current.length > maxUndoDepthRef.current) undoStackRef.current.shift()
      redoStackRef.current = []
      return
    }
    undoStackRef.current.push({ kind: 'batchAdd', traces: newTraces.map(cloneTraceSnapshot) })
    if (undoStackRef.current.length > maxUndoDepthRef.current) undoStackRef.current.shift()
    redoStackRef.current = []
  }, [])

  const pushDeleteOp = useCallback((trace: Trace) => {
    undoStackRef.current.push({ kind: 'delete', trace: cloneTraceSnapshot(trace) })
    if (undoStackRef.current.length > maxUndoDepthRef.current) undoStackRef.current.shift()
    redoStackRef.current = []
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
        newlyDiscovered.push(trace)
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

  // Deletion is deferred to Save (like edits): removeTrace() gives an
  // instant local UI update, and markTraceDeleted() queues the actual
  // database delete for the next saveAllChanges(), which is what makes an
  // undo cheap (unmarkTraceDeleted() below is enough to fully cancel it,
  // no database round-trip needed) at the cost of the delete only becoming
  // permanent once you save.
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
    } else if (op.kind === 'delete') {
      if (direction === 'undo') {
        store.addTrace(cloneTraceSnapshot(op.trace))
        store.unmarkTraceDeleted(op.trace.id)
        store.markTraceChanged(op.trace.id)
        // See the matching comment in the 'add' redo branch above.
        knownTraceIdsRef.current?.add(op.trace.id)
      } else {
        store.removeTrace(op.trace.id)
        store.markTraceDeleted(op.trace.id)
        knownTraceIdsRef.current?.delete(op.trace.id)
        if (editingTraceRef.current?.id === op.trace.id) setEditingTrace(null)
        if (selectedTraceIdRef.current === op.trace.id) setSelectedTraceId(null)
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

  const undo = useCallback(() => {
    const op = undoStackRef.current.pop()
    if (!op) return
    redoStackRef.current.push(op)
    applyUndoOp(op, 'undo')
  }, [applyUndoOp])

  const redo = useCallback(() => {
    const op = redoStackRef.current.pop()
    if (!op) return
    undoStackRef.current.push(op)
    applyUndoOp(op, 'redo')
  }, [applyUndoOp])

  // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) undo/redo shortcut
  const isDrawingModeRef = useRef(isDrawingMode)
  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode
  }, [isDrawingMode])
  useEffect(() => {
    const isEditableTarget = (eventTarget: EventTarget | null) => {
      const element = eventTarget as HTMLElement | null
      const tag = element?.tagName
      return element?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }
    const handleUndoRedoShortcut = (e: KeyboardEvent) => {
      // Drawing mode owns Ctrl+Z/Ctrl+Shift+Z for stroke undo while active
      // (see LobbyScene) -- don't also rewind trace history underneath it.
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

  // saveAllChanges (src/lib/traceSave.ts) is shared with the HUD save button,
  // autosave, and the desktop close-with-unsaved-changes prompt.

  // Ctrl+S keyboard shortcut to save
  useEffect(() => {
    const handleSaveShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (hasPendingChanges()) {
          saveAllChanges()
        }
      }
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [hasPendingChanges, pendingChanges, deletedTraces, traces])

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

  const duplicateTraces = useCallback(async (sourceTraces: Trace[]) => {
    if (!userId || sourceTraces.length === 0) return

    if (useGameStore.getState().isLobbyFull()) {
      const sizeMB = (useGameStore.getState().getLobbySizeBytes() / (1024 * 1024)).toFixed(1)
      alert(`This atrium has reached its ${(LOBBY_SIZE_LIMIT / (1024 * 1024)).toFixed(0)}MB size limit (currently ${sizeMB}MB). Delete some traces to free up space.`)
      return
    }

    setContextMenu(null)

    const offsetX = 50
    const offsetY = 50

    if (supabase) {
      const insertRows = sourceTraces.map(trace => buildDuplicateInsert(trace, offsetX, offsetY))
      const { data, error } = await (supabase.from('traces') as any).insert(insertRows).select()

      if (error) {
        alert('Failed to duplicate trace: ' + error.message)
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

    const isEditableTarget = (eventTarget: EventTarget | null) => {
      const element = eventTarget as HTMLElement | null
      const tag = element?.tagName
      return element?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
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
        void duplicateTraces(payload.traces.map(trace => cloneTraceSnapshot(trace)))
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

  const deleteTraces = (traceIds: string[]) => {
    if (traceIds.length === 0) return
    const dontAskAgain = localStorage.getItem('dontAskDeleteTrace') === 'true'

    if (!dontAskAgain) {
      // Show custom confirmation dialog
      setDeleteConfirmDialog({ traceIds })
      return
    }

    // Execute deletion
    executeDelete(traceIds)
  }

  const executeDelete = (traceIds: string[]) => {
    setContextMenu(null)
    setDeleteConfirmDialog(null)
    setMultiSelectedIds(new Set())

    for (const traceId of traceIds) {
      const traceBeingDeleted = traces.find(t => t.id === traceId)

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

      if (traceBeingDeleted) pushDeleteOp(traceBeingDeleted)
    }
  }

  const duplicateTrace = async (traceId: string) => {
    const tracesToDuplicate = getSelectedTraceSnapshots(traceId)
    if (tracesToDuplicate.length === 0) return

    await duplicateTraces(tracesToDuplicate)
  }

  // Moves a trace to the top/bottom of its own group's (or the ungrouped
  // pool's) stacking order -- right-click menu equivalent of dragging it to
  // either end of its group in the Layer panel. Reuses the group's existing
  // set of z-index values (just permuted) rather than computing new ones,
  // so it never needs to know the layer's own z-index and can't drift the
  // group outside whatever numeric range it already occupies.
  const moveTraceToGroupEdge = (traceId: string, edge: 'top' | 'bottom') => {
    const trace = traces.find(t => t.id === traceId)
    if (!trace) return
    const groupTraces = traces.filter(t => (t.layerId ?? null) === (trace.layerId ?? null))
    if (groupTraces.length <= 1) {
      setContextMenu(null)
      return
    }

    const sorted = [...groupTraces].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    const zIndexes = sorted.map(t => t.zIndex ?? 0)
    const withoutTrace = sorted.filter(t => t.id !== traceId)
    const reordered = edge === 'top' ? [...withoutTrace, trace] : [trace, ...withoutTrace]

    reordered.forEach((t, i) => {
      const newZIndex = zIndexes[i]
      if ((t.zIndex ?? 0) !== newZIndex) {
        updateTraceCustomization(t.id, { zIndex: newZIndex })
      }
    })

    setContextMenu(null)
  }

  // One-step version of moveTraceToGroupEdge -- swaps with just the next
  // trace up/down in the same group's stacking order, instead of jumping
  // all the way to the front/back.
  const moveTraceOneStep = (traceId: string, direction: 'up' | 'down') => {
    const trace = traces.find(t => t.id === traceId)
    if (!trace) return
    const groupTraces = traces.filter(t => (t.layerId ?? null) === (trace.layerId ?? null))
    if (groupTraces.length <= 1) {
      setContextMenu(null)
      return
    }

    const sorted = [...groupTraces].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    const zIndexes = sorted.map(t => t.zIndex ?? 0)
    const currentIndex = sorted.findIndex(t => t.id === traceId)
    const targetIndex = direction === 'up' ? currentIndex + 1 : currentIndex - 1
    if (currentIndex === -1 || targetIndex < 0 || targetIndex >= sorted.length) {
      setContextMenu(null)
      return
    }

    const reordered = [...sorted]
    ;[reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]]

    reordered.forEach((t, i) => {
      const newZIndex = zIndexes[i]
      if ((t.zIndex ?? 0) !== newZIndex) {
        updateTraceCustomization(t.id, { zIndex: newZIndex })
      }
    })

    setContextMenu(null)
  }

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

    const before: Partial<Trace> = {}
    for (const key of Object.keys(updates) as (keyof Trace)[]) {
      (before as any)[key] = trace[key]
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

  // Applies the same property updates to every trace in a set at once (used
  // by the batch-edit panel). Each trace still gets its own undo entry via
  // updateTraceCustomization -- undoing a batch edit takes one Ctrl+Z per
  // trace rather than a single combined step, which keeps this on the
  // existing per-trace undo model instead of adding a new "batch" op kind.
  const updateTraceCustomizationForMany = (traceIds: Iterable<string>, updates: Partial<Trace>) => {
    for (const traceId of traceIds) {
      updateTraceCustomization(traceId, updates)
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
    if (trace.isLocked && mode !== 'crop') return // Allow crop even on locked traces
    
    // Disable move/rotate/scale for path shapes - they're controlled by point editing
    // EXCEPT when multi-selected, then allow moving
    const isPathWithMultiSelect = trace.type === 'shape' && trace.shapeType === 'path' && mode === 'move'
    if (isPathWithMultiSelect && multiSelectedIds.size === 0) return
    
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
    if (!multiSelectedIds.has(trace.id)) {
      setMultiSelectedIds(new Set())
    }

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

    setTransformMode(mode)
    selectedTraceIdRef.current = trace.id
    transformModeRef.current = mode
    setCursorState('grabbing') // Change cursor to grabbing while dragging
    
    // Prevent text selection during drag
    document.body.classList.add('dragging')
    
    const transform = getTraceTransform(trace)
    startPosRef.current = { x: e.clientX, y: e.clientY, corner: corner || '' }
    // copy transform including scaleX/scaleY
    startTransformRef.current = { ...transform }
    // Store starting crop values
    startCropRef.current = {
      cropX: trace.cropX ?? 0,
      cropY: trace.cropY ?? 0,
      cropWidth: trace.cropWidth ?? 1,
      cropHeight: trace.cropHeight ?? 1,
    }
    
    // Store starting transforms for all multi-selected traces
    if (multiSelectedIds.size > 0 && (mode === 'move' || mode === 'move-path')) {
      const startTransforms: Record<string, { x: number; y: number }> = {}
      const startPathPoints: Record<string, any[]> = {}
      multiSelectedIds.forEach(id => {
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
  }

  // Starts a scale/rotate drag on the multi-selection as a whole. Unlike
  // handleMouseDown this isn't anchored to any one trace -- the pivot is the
  // shared bounding-box center, so every selected trace orbits it together.
  const handleGroupMouseDown = (e: React.MouseEvent, mode: 'group-scale' | 'group-rotate') => {
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

    groupStartRef.current = { center: { x: bounds.centerX, y: bounds.centerY }, traces: startTraces }

    setTransformMode(mode)
    transformModeRef.current = mode
    startPosRef.current = { x: e.clientX, y: e.clientY, corner: 'group' }
    const { screenX, screenY } = getScreenPosition(bounds.centerX, bounds.centerY)
    centerRef.current = { x: screenX, y: screenY }
    isMultiDragActiveRef.current = true
    setCursorState('grabbing')
    document.body.classList.add('dragging')
  }

  const handleGroupTouchDown = (e: React.TouchEvent, mode: 'group-scale' | 'group-rotate') => {
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
    handleGroupMouseDown(synth, mode)
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
      const { center, traces: startTraces } = groupStartRef.current
      const startAngle = Math.atan2(startPosRef.current.y - centerRef.current.y, startPosRef.current.x - centerRef.current.x)
      const currentAngle = Math.atan2(e.clientY - centerRef.current.y, e.clientX - centerRef.current.x)

      let factor = 1
      let angleDeg = 0
      if (activeTransformMode === 'group-scale') {
        const startDist = Math.hypot(startPosRef.current.x - centerRef.current.x, startPosRef.current.y - centerRef.current.y)
        const currentDist = Math.hypot(e.clientX - centerRef.current.x, e.clientY - centerRef.current.y)
        factor = startDist > 0 ? Math.max(0.01, currentDist / startDist) : 1
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
          return { x: center.x + dx * factor, y: center.y + dy * factor }
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

    const deltaX = e.clientX - startPosRef.current.x
    const deltaY = e.clientY - startPosRef.current.y
    
    // If mouse has moved more than 3 pixels, consider it a drag
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      justDraggedRef.current = true
      // It's a drag, not a click: let the handles through and drop the
      // pressed styling, so moving a clickable trace looks like moving any
      // other one.
      if (pressedClickableIdRef.current) {
        pressedClickableIdRef.current = null
        setPressedClickableId(null)
      }
    }

  if (activeTransformMode === 'move') {
      // Convert screen delta to world delta
      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom
      
      // Check if we have multi-selected traces to move together
      const currentMultiSelected = multiSelectedIdsRef.current
      if (currentMultiSelected.size > 0 && Object.keys(multiStartTransformsRef.current).length > 0) {
        // Move all multi-selected traces together
        currentMultiSelected.forEach(id => {
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
        // Also move the main selected trace if not in multi-select
        if (!currentMultiSelected.has(activeSelectedTraceId)) {
          updateTraceTransform(activeSelectedTraceId, {
            x: startTransformRef.current.x + worldDeltaX,
            y: startTransformRef.current.y + worldDeltaY,
          }, { skipUndo: true })
        }
      } else {
        // Single trace move
        updateTraceTransform(activeSelectedTraceId, {
          x: startTransformRef.current.x + worldDeltaX,
          y: startTransformRef.current.y + worldDeltaY,
        })
      }
    } else if (transformMode === 'crop') {
      // Handle crop area adjustment
      const { width, height } = getTraceSize(trace)
      const transform = getTraceTransform(trace)
      const containerWidth = width * (transform as any).scaleX * currentZoom
      const containerHeight = height * (transform as any).scaleY * currentZoom
      
      // Convert pixel delta to crop percentage delta
      const cropDeltaX = deltaX / containerWidth
      const cropDeltaY = deltaY / containerHeight
      
      const corner = startPosRef.current.corner
      const startCrop = startCropRef.current
      let newCropX = startCrop.cropX
      let newCropY = startCrop.cropY
      let newCropWidth = startCrop.cropWidth
      let newCropHeight = startCrop.cropHeight
      
      // Adjust crop based on which corner is being dragged
      if (corner === 'tl') {
        // Top-left: adjust X, Y, width, height
        const maxDeltaX = startCrop.cropWidth - 0.1
        const maxDeltaY = startCrop.cropHeight - 0.1
        const clampedDeltaX = Math.max(-startCrop.cropX, Math.min(maxDeltaX, cropDeltaX))
        const clampedDeltaY = Math.max(-startCrop.cropY, Math.min(maxDeltaY, cropDeltaY))
        
        newCropX = startCrop.cropX + clampedDeltaX
        newCropY = startCrop.cropY + clampedDeltaY
        newCropWidth = startCrop.cropWidth - clampedDeltaX
        newCropHeight = startCrop.cropHeight - clampedDeltaY
      } else if (corner === 'tr') {
        // Top-right: adjust Y, width, height
        const maxDeltaY = startCrop.cropHeight - 0.1
        const maxDeltaX = 1 - startCrop.cropX - startCrop.cropWidth
        const clampedDeltaY = Math.max(-startCrop.cropY, Math.min(maxDeltaY, cropDeltaY))
        const clampedDeltaX = Math.max(-(startCrop.cropWidth - 0.1), Math.min(maxDeltaX, cropDeltaX))
        
        newCropY = startCrop.cropY + clampedDeltaY
        newCropWidth = startCrop.cropWidth + clampedDeltaX
        newCropHeight = startCrop.cropHeight - clampedDeltaY
      } else if (corner === 'bl') {
        // Bottom-left: adjust X, width, height
        const maxDeltaX = startCrop.cropWidth - 0.1
        const maxDeltaY = 1 - startCrop.cropY - startCrop.cropHeight
        const clampedDeltaX = Math.max(-startCrop.cropX, Math.min(maxDeltaX, cropDeltaX))
        const clampedDeltaY = Math.max(-(startCrop.cropHeight - 0.1), Math.min(maxDeltaY, cropDeltaY))
        
        newCropX = startCrop.cropX + clampedDeltaX
        newCropWidth = startCrop.cropWidth - clampedDeltaX
        newCropHeight = startCrop.cropHeight + clampedDeltaY
      } else if (corner === 'br') {
        // Bottom-right: adjust width, height
        const maxDeltaX = 1 - startCrop.cropX - startCrop.cropWidth
        const maxDeltaY = 1 - startCrop.cropY - startCrop.cropHeight
        const clampedDeltaX = Math.max(-(startCrop.cropWidth - 0.1), Math.min(maxDeltaX, cropDeltaX))
        const clampedDeltaY = Math.max(-(startCrop.cropHeight - 0.1), Math.min(maxDeltaY, cropDeltaY))
        
        newCropWidth = startCrop.cropWidth + clampedDeltaX
        newCropHeight = startCrop.cropHeight + clampedDeltaY
      }
      
      updateTraceCustomization(activeSelectedTraceId, {
        cropX: newCropX,
        cropY: newCropY,
        cropWidth: newCropWidth,
        cropHeight: newCropHeight,
      })
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

        const widthDelta = (baseWidth * newScaleX) / 2 - (baseWidth * startScaleX) / 2
        const heightDelta = (baseHeight * newScaleY) / 2 - (baseHeight * startScaleY) / 2
        localDx = corner.includes('r') ? widthDelta : -widthDelta
        localDy = corner.includes('b') ? heightDelta : -heightDelta
      } else if (corner === 'l' || corner === 'r') {
        // Horizontal edge - scale X only
        const sign = corner === 'r' ? 1 : -1
        newScaleX = Math.max(0.01, startScaleX + (sign * worldDeltaX) / baseWidth)
        const widthDelta = (baseWidth * newScaleX) / 2 - (baseWidth * startScaleX) / 2
        localDx = corner === 'r' ? widthDelta : -widthDelta
      } else if (corner === 't' || corner === 'b') {
        // Vertical edge - scale Y only
        const sign = corner === 'b' ? 1 : -1
        newScaleY = Math.max(0.01, startScaleY + (sign * worldDeltaY) / baseHeight)
        const heightDelta = (baseHeight * newScaleY) / 2 - (baseHeight * startScaleY) / 2
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
        
        const initial = startPosRef.current.initialPoint as any
        
        // Move point and control handles together
        newPoints[pointIndex] = {
          ...initial,
          x: initial.x + worldDeltaX,
          y: initial.y + worldDeltaY,
          // Move control points with the anchor point
          cp1x: initial.cp1x !== undefined ? initial.cp1x + worldDeltaX : undefined,
          cp1y: initial.cp1y !== undefined ? initial.cp1y + worldDeltaY : undefined,
          cp2x: initial.cp2x !== undefined ? initial.cp2x + worldDeltaX : undefined,
          cp2y: initial.cp2y !== undefined ? initial.cp2y + worldDeltaY : undefined,
        }
        // Update local state for instant feedback, DB update on mouseup
        setLocalShapePoints(prev => ({ ...prev, [activeSelectedTraceId]: newPoints }))
      }
    } else if (activeTransformMode === 'control-in' || activeTransformMode === 'control-out') {
      // Edit control points for bezier curves using world coordinates
      const pointIndex = parseInt(startPosRef.current.corner)
      if (isNaN(pointIndex)) return
      
      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom
      
      const currentPoints = currentLocalShapePoints[activeSelectedTraceId] || currentTrace.shapePoints || []
      const newPoints = [...currentPoints]
      if (newPoints[pointIndex]) {
        // Store initial control points if not already stored
        if (!startPosRef.current.initialCpx) {
          const point = currentPoints[pointIndex]
          if (activeTransformMode === 'control-in') {
            startPosRef.current.initialCpx = point.cp1x ?? point.x - 20
            startPosRef.current.initialCpy = point.cp1y ?? point.y
          } else {
            startPosRef.current.initialCpx = point.cp2x ?? point.x + 20
            startPosRef.current.initialCpy = point.cp2y ?? point.y
          }
        }
        
        const cpxKey = activeTransformMode === 'control-in' ? 'cp1x' : 'cp2x'
        const cpyKey = activeTransformMode === 'control-in' ? 'cp1y' : 'cp2y'
        
        if (startPosRef.current.initialCpx !== undefined && startPosRef.current.initialCpy !== undefined) {
          newPoints[pointIndex] = {
            ...newPoints[pointIndex],
            [cpxKey]: startPosRef.current.initialCpx + worldDeltaX,
            [cpyKey]: startPosRef.current.initialCpy + worldDeltaY
          }
          // Update local state for instant feedback, DB update on mouseup
          setLocalShapePoints(prev => ({ ...prev, [activeSelectedTraceId]: newPoints }))
        }
      }
    } else if (activeTransformMode === 'move-path') {
      // Move all points of a path shape together
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
    transformModeRef.current = 'none'

    // Cleared unconditionally: this runs before every early return below, so
    // the badge can't outlive its drag.
    setRotationReadout(null)

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
      groupStartRef.current = { center: { x: 0, y: 0 }, traces: {} }
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
  }

  // Click outside to deselect
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // If a trace element was clicked, don't deselect
      const target = e.target as HTMLElement
      if (target.closest('[data-trace-element="true"]')) {
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
        if (target.closest('[data-trace-element]') ||
            target.closest('.layer-panel') ||
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
            const worldX = (e.clientX - worldOffset.x) / zoom
            const worldY = (e.clientY - worldOffset.y) / zoom
            
            // Use editingTrace's points if available (most up-to-date), otherwise use trace's points
            const sourceTrace = (editingTrace && editingTrace.id === selectedTraceId) ? editingTrace : trace
            const currentPoints = sourceTrace.shapePoints || []
            const newPoints = [...currentPoints, { x: worldX, y: worldY }]
            
            const updated = { ...trace, shapePoints: newPoints }
            setEditingTrace(updated)
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
      const isEditableTarget = target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT'
      if (e.key === 'Delete' && canEdit && !isEditableTarget && (selectedTraceId || multiSelectedIds.size > 0)) {
        e.preventDefault()
        deleteTraces(multiSelectedIds.size > 0 ? Array.from(multiSelectedIds) : [selectedTraceId!])
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
  }, [selectedTraceId, multiSelectedIds, pathCreationMode, worldOffset, zoom, traces, editingTrace, isCropMode, canEdit])

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
      const handleTouchMoveGlobal = (e: TouchEvent) => {
        if (e.touches.length === 1) {
          e.preventDefault()
          const touch = e.touches[0]
          handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY } as MouseEvent)
        }
      }
      const handleTouchEndGlobal = () => {
        handleMouseUp()
      }

      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('touchmove', handleTouchMoveGlobal, { passive: false })
      window.addEventListener('touchend', handleTouchEndGlobal)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        window.removeEventListener('touchmove', handleTouchMoveGlobal)
        window.removeEventListener('touchend', handleTouchEndGlobal)
      }
    }
  }, [transformMode, selectedTraceId])

  // Clear editingTrace when trace is deselected
  useEffect(() => {
    if (!selectedTraceId && editingTrace) {
      // Clear editingTrace when nothing is selected
      setEditingTrace(null)
    }
    // Don't sync on traces updates - let editingTrace be the source of truth during editing
  }, [selectedTraceId, editingTrace])

  // Close the batch-edit panel if the multi-selection it applies to drops
  // below 2 traces (e.g. the user clicked away to deselect while it was open)
  useEffect(() => {
    if (showBatchEditPanel && multiSelectedIds.size < 2) {
      setShowBatchEditPanel(false)
    }
  }, [showBatchEditPanel, multiSelectedIds])

  // Disable path creation mode when selection is cleared
  // Note: We don't check editingTrace here to avoid disabling mode when updating points
  useEffect(() => {
    if (!selectedTraceId) {
      setPathCreationMode(false)
      setSelectedPointIndex(null)
    }
  }, [selectedTraceId])

  const getTraceSize = useCallback((trace: Trace) => {
    // For shapes, use their custom dimensions
    if (trace.type === 'shape') {
      return { 
        width: trace.width || 200, 
        height: trace.height || 200 
      }
    }
    
    // For images, use a container that will adapt to content
    // We'll use inline styles on the image container to handle aspect ratio
    switch (trace.type) {
      case 'text':
        // Text traces use width/height as their base size
        // Text content conforms to the box (like Excel's wrap text)
        return { width: trace.width || 150, height: trace.height || 80 }
      case 'image':
        // Use custom dimensions if user resized, then detected dimensions, then default
        if (trace.width && trace.height) {
          return { width: trace.width, height: trace.height }
        }
        if (imageDimensions[trace.id]) {
          const dim = imageDimensions[trace.id]
          // Scale down to reasonable base size using the longest edge
          const maxBase = 300
          const longest = Math.max(dim.width, dim.height)
          const scale = longest > maxBase ? maxBase / longest : 1
          return { width: Math.round(dim.width * scale), height: Math.round(dim.height * scale) }
        }
        return { width: 200, height: 200 }
      case 'audio':
        return { width: trace.width || 120, height: trace.height || 100 }
      case 'video':
        // Use detected dimensions if available
        if (imageDimensions[trace.id]) {
          const dim = imageDimensions[trace.id]
          const maxSize = 200
          const scale = Math.min(maxSize / dim.width, maxSize / dim.height, 1)
          return { width: Math.round(dim.width * scale), height: Math.round(dim.height * scale) }
        }
        return { width: 200, height: 150 }
      case 'embed':
        // Use custom dimensions if user resized, then detected dimensions, then default
        if (trace.width && trace.height) {
          return { width: trace.width, height: trace.height }
        }
        if (imageDimensions[trace.id]) {
          const dim = imageDimensions[trace.id]
          // Scale down to reasonable base size using the longest edge
          const maxBase = 300
          const longest = Math.max(dim.width, dim.height)
          const scale = longest > maxBase ? maxBase / longest : 1
          return { width: Math.round(dim.width * scale), height: Math.round(dim.height * scale) }
        }
        // Default 16:9 aspect ratio
        return { width: 300, height: 169 }
      case 'document':
        // Without this a PDF fell through to the 120x80 default below, which
        // ignored the width/height stored at creation -- so it rendered small
        // and in the wrong shape no matter what the document's real
        // proportions were. The fallback is A4 portrait.
        return { width: trace.width || 424, height: trace.height || 600 }
      default:
        return { width: 120, height: 80 }
    }
  }, [imageDimensions])

  // World-space bounding box across a set of traces, used to place the
  // multi-select group handles and to derive the shared pivot they transform
  // around. Path shapes are measured from their points (their x/y only
  // records where they were last moved as a whole, not where the points
  // actually are); everything else from its rotated size box.
  const getGroupBounds = useCallback((ids: string[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

    for (const id of ids) {
      const trace = traces.find(t => t.id === id)
      if (!trace) continue
      const transform = localTraceTransforms[id] || getTraceTransform(trace)

      if (trace.type === 'shape' && trace.shapeType === 'path') {
        const points = localShapePoints[id] || trace.shapePoints
        if (points && points.length > 0) {
          for (const p of points) {
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
          }
          continue
        }
      }

      const { width, height } = getTraceSize(trace)
      const halfW = (width * transform.scaleX) / 2
      const halfH = (height * transform.scaleY) / 2
      const rad = (transform.rotation * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const extentX = halfW * cos + halfH * sin
      const extentY = halfW * sin + halfH * cos

      minX = Math.min(minX, transform.x - extentX); maxX = Math.max(maxX, transform.x + extentX)
      minY = Math.min(minY, transform.y - extentY); maxY = Math.max(maxY, transform.y + extentY)
    }

    if (!isFinite(minX)) return null
    return { minX, minY, maxX, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 }
  }, [traces, localTraceTransforms, localShapePoints, getTraceTransform, getTraceSize])

  const getBorderColor = useCallback((type: string) => {
    switch (type) {
      case 'text':
        return '#b9b39d'
      case 'image':
        return '#a8a287'
      case 'audio':
        return '#9f987c'
      case 'video':
        return '#958f75'
      case 'embed':
        return '#8e886f'
      default:
        return '#b9b39d'
    }
  }, [])

  const getTraceTypeLabel = useCallback((type: string) => {
    switch (type) {
      case 'text':
        return 'Text'
      case 'image':
        return 'Image'
      case 'audio':
        return 'Audio'
      case 'video':
        return 'Video'
      case 'embed':
        return 'Embed'
      case 'shape':
        return 'Shape'
      default:
        return 'Trace'
    }
  }, [])

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

    // Check if it's HTML embed code (contains <iframe)
    if (content.includes('<iframe')) {
      const srcMatch = content.match(/src=["']([^"']+)["']/)
      if (srcMatch) {
        // Run through the converter too: pasting embed code with a share URL
        // inside it is a common enough mistake to be worth handling.
        return httpOnly(toEmbedUrl(srcMatch[1]))
      }
      return null
    }
    // A plain URL -- YouTube, Google Drive, Docs and the rest are converted to
    // their embeddable form here (see lib/embedUrl). Done at render rather
    // than on save, so the trace keeps the link the user actually pasted and
    // embeds created before this start working without migrating anything.
    return httpOnly(toEmbedUrl(content))
  }, [])

  // Memoize visible traces to avoid recalculating on every render
  // Only show traces that are within the viewport (with some margin)
  const visibleTraces = React.useMemo(() => {
    const margin = 500 // Extra margin around viewport
    const viewportLeft = -worldOffset.x / zoom - margin
    const viewportTop = -worldOffset.y / zoom - margin
    const viewportRight = (window.innerWidth - worldOffset.x) / zoom + margin
    const viewportBottom = (window.innerHeight - worldOffset.y) / zoom + margin
    const buffer = 500 // Account for large traces

    return traces.filter(trace => {
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

      const traceX = trace.x
      const traceY = trace.y
      // Rough bounds check (traces are centered, so add some buffer)
      return traceX >= viewportLeft - buffer &&
             traceX <= viewportRight + buffer &&
             traceY >= viewportTop - buffer &&
             traceY <= viewportBottom + buffer
    })
  }, [traces, zoom, worldOffset.x, worldOffset.y])

  // Memoize sorted items to avoid re-sorting on every render
  const sortedItems = React.useMemo(() => {
    return [
      ...visibleTraces.map(trace => ({ type: 'trace' as const, trace, zIndex: trace.zIndex ?? 0 })),
      { type: 'player' as const, trace: null, zIndex: Math.max(playerZIndex * 100, OWN_CURSOR_MIN_Z_INDEX) }
    ].sort((a, b) => a.zIndex - b.zIndex)
  }, [visibleTraces, playerZIndex])

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

    // Generate SVG path
    let pathData = ''
    if (curveType === 'bezier' && screenPoints.length >= 2) {
      pathData = `M ${screenPoints[0].x} ${screenPoints[0].y}`

      if (screenPoints.length === 2) {
        const p0 = screenPoints[0]
        const p1 = screenPoints[1]

        if (p0.cp2x !== undefined && p0.cp2y !== undefined) {
          const cp1x = p0.cp2x
          const cp1y = p0.cp2y
          const cp2x = p1.cp1x !== undefined ? p1.cp1x : cp1x
          const cp2y = p1.cp1y !== undefined ? p1.cp1y : cp1y
          pathData += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`
        } else {
          const midX = (p0.x + p1.x) / 2
          const midY = (p0.y + p1.y) / 2
          pathData += ` Q ${midX} ${midY}, ${p1.x} ${p1.y}`
        }
      } else {
        for (let i = 0; i < screenPoints.length - 1; i++) {
          const p0 = i > 0 ? screenPoints[i - 1] : screenPoints[i]
          const p1 = screenPoints[i]
          const p2 = screenPoints[i + 1]
          const p3 = i + 2 < screenPoints.length ? screenPoints[i + 2] : p2

          let cp1x, cp1y, cp2x, cp2y

          if (p1.cp2x !== undefined && p1.cp2y !== undefined) {
            cp1x = p1.cp2x
            cp1y = p1.cp2y
          } else {
            const tension = 0.5
            cp1x = p1.x + (p2.x - p0.x) / 6 * tension
            cp1y = p1.y + (p2.y - p0.y) / 6 * tension
          }

          if (p2.cp1x !== undefined && p2.cp1y !== undefined) {
            cp2x = p2.cp1x
            cp2y = p2.cp1y
          } else {
            const tension = 0.5
            cp2x = p2.x - (p3.x - p1.x) / 6 * tension
            cp2y = p2.y - (p3.y - p1.y) / 6 * tension
          }

          pathData += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
        }
      }
    }

    // Show the selection glow whether this path is the single selected
    // trace or part of a multi-selection (previously only multi-select
    // showed any highlight at all, so a singly-selected path had none).
    const isPathMultiSelected = selectedTraceId === trace.id || multiSelectedIds.has(trace.id)

    return (
      <svg
        className="absolute select-none"
        style={{
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
          zIndex: trace.zIndex ?? 0,
          pointerEvents: 'none'
        }}
      >
        {/* Arrow marker definitions */}
        <defs>
          {/* Triangle markers - size in screen pixels (userSpaceOnUse) */}
          <marker
            id={`${markerId}-triangle-start`}
            markerWidth={zoomedOutlineWidth * 3.5}
            markerHeight={zoomedOutlineWidth * 3.5}
            refX={zoomedOutlineWidth * 3.5}
            refY={zoomedOutlineWidth * 1.75}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`${zoomedOutlineWidth * 3.5},0 ${zoomedOutlineWidth * 3.5},${zoomedOutlineWidth * 3.5} 0,${zoomedOutlineWidth * 1.75}`}
              fill={shapeColor}
            />
          </marker>
          <marker
            id={`${markerId}-triangle-end`}
            markerWidth={zoomedOutlineWidth * 3.5}
            markerHeight={zoomedOutlineWidth * 3.5}
            refX={0}
            refY={zoomedOutlineWidth * 1.75}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`0,0 ${zoomedOutlineWidth * 3.5},${zoomedOutlineWidth * 1.75} 0,${zoomedOutlineWidth * 3.5}`}
              fill={shapeColor}
            />
          </marker>
          {/* Diamond (Nier-style) markers - size in screen pixels */}
          <marker
            id={`${markerId}-diamond-start`}
            markerWidth={zoomedOutlineWidth * 3.5}
            markerHeight={zoomedOutlineWidth * 3.5}
            refX={zoomedOutlineWidth * 1.75}
            refY={zoomedOutlineWidth * 1.75}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`${zoomedOutlineWidth * 1.75},0 ${zoomedOutlineWidth * 3.5},${zoomedOutlineWidth * 1.75} ${zoomedOutlineWidth * 1.75},${zoomedOutlineWidth * 3.5} 0,${zoomedOutlineWidth * 1.75}`}
              fill={shapeColor}
            />
          </marker>
          <marker
            id={`${markerId}-diamond-end`}
            markerWidth={zoomedOutlineWidth * 3.5}
            markerHeight={zoomedOutlineWidth * 3.5}
            refX={zoomedOutlineWidth * 1.75}
            refY={zoomedOutlineWidth * 1.75}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <polygon
              points={`${zoomedOutlineWidth * 1.75},0 ${zoomedOutlineWidth * 3.5},${zoomedOutlineWidth * 1.75} ${zoomedOutlineWidth * 1.75},${zoomedOutlineWidth * 3.5} 0,${zoomedOutlineWidth * 1.75}`}
              fill={shapeColor}
            />
          </marker>
        </defs>
        {curveType === 'bezier' ? (
          <>
            {/* Multi-selection glow effect */}
            {isPathMultiSelected && (
              <path
                d={pathData}
                fill="none"
                stroke="#86efac"
                strokeWidth={zoomedOutlineWidth + 8}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.75}
                style={{ pointerEvents: 'none', filter: 'blur(4px)' }}
              />
            )}
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
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                if (e.shiftKey) {
                  // Toggle multi-selection - same logic as handleMouseDown
                  setMultiSelectedIds(prev => {
                    const next = new Set(prev)
                    if (next.has(trace.id)) {
                      next.delete(trace.id)
                    } else {
                      next.add(trace.id)
                    }
                    // Also add the currently selected trace if not already in selection
                    if (selectedTraceId && !next.has(selectedTraceId)) {
                      next.add(selectedTraceId)
                    }
                    return next
                  })
                  setSelectedTraceId(trace.id)
                } else {
                  setMultiSelectedIds(new Set()) // Clear multi-selection on non-shift click
                  setSelectedTraceId(trace.id)
                }
              }}
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
              opacity={shapeOpacity}
              markerStart={arrowStart !== 'none' ? `url(#${markerId}-${arrowStart}-start)` : undefined}
              markerEnd={arrowEnd !== 'none' ? `url(#${markerId}-${arrowEnd}-end)` : undefined}
              style={{ pointerEvents: 'none' }}
            />
          </>
        ) : (
          <>
            {/* Multi-selection glow effect for polyline */}
            {isPathMultiSelected && (
              <polyline
                points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#86efac"
                strokeWidth={zoomedOutlineWidth + 8}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.75}
                style={{ pointerEvents: 'none', filter: 'blur(4px)' }}
              />
            )}
            {/* Invisible wider stroke for easier clicking -- floored so a
                heavily zoomed-out (thus very thin) path stays clickable */}
            <polyline
              points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(zoomedOutlineWidth + 10, 14)}
              strokeLinecap="round"
              strokeLinejoin="round"
              data-trace-element="true"
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation()
                if (e.shiftKey) {
                  // Toggle multi-selection - same logic as handleMouseDown
                  setMultiSelectedIds(prev => {
                    const next = new Set(prev)
                    if (next.has(trace.id)) {
                      next.delete(trace.id)
                    } else {
                      next.add(trace.id)
                    }
                    // Also add the currently selected trace if not already in selection
                    if (selectedTraceId && !next.has(selectedTraceId)) {
                      next.add(selectedTraceId)
                    }
                    return next
                  })
                  setSelectedTraceId(trace.id)
                } else {
                  setMultiSelectedIds(new Set()) // Clear multi-selection on non-shift click
                  setSelectedTraceId(trace.id)
                }
              }}
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
              <polyline
                points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
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
            <polyline
              points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={shapeColor}
              strokeWidth={zoomedOutlineWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={shapeOpacity}
              markerStart={arrowStart !== 'none' ? `url(#${markerId}-${arrowStart}-start)` : undefined}
              markerEnd={arrowEnd !== 'none' ? `url(#${markerId}-${arrowEnd}-end)` : undefined}
              style={{ pointerEvents: 'none' }}
            />
          </>
        )}
      </svg>
    )
  }

  return (
    <div style={{ cursor: 'none', pointerEvents: 'none', touchAction: 'none' }}>
      {/* Render traces AND player in z-index order */}
      {sortedItems
          .map((item) => {
            if (item.type === 'player') {
              // Render player cursor
              const playerScreenX = position.x * zoom + worldOffset.x
              const playerScreenY = position.y * zoom + worldOffset.y

              // Convert hex color to RGB for shadows
              const hexToRgb = (hex: string) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
                return result ? {
                  r: parseInt(result[1], 16),
                  g: parseInt(result[2], 16),
                  b: parseInt(result[3], 16)
                } : { r: 255, g: 255, b: 255 }
              }
              const rgb = hexToRgb(playerColor)

              // Get cursor SVG based on state
              const getCursorSvg = () => {
                const size = 24 // Fixed size regardless of zoom
                const baseProps = {
                  width: size,
                  height: size,
                  viewBox: "0 0 24 24",
                  style: { 
                    transform: 'translate(-2px, -2px)',
                    filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.5))`,
                    transition: 'transform 0.1s ease-out',
                  } as React.CSSProperties
                }

                switch (cursorState) {
                  case 'pointer':
                    // Paint-drop cursor (for clickable items) -- an abstract
                    // blob with trailing streaks, as if a drop of paint were
                    // falling upward against gravity. See
                    // src/assets/cursors/hand-pointer.svg for the editable
                    // source (open in Illustrator to tweak further).
                    return (
                      <svg {...baseProps}>
                        <path
                          d="M7,7.1V5.5C7,4.1,8.1,3,9.5,3S12,4.1,12,5.5v3.2c0.9,0,1.6,0.1,2.3,0.3V7.5c0-1.4,1-2.5,2.3-2.5C18,5,19,6.1,19,7.5v7c0,4.1-3.4,7.5-7.5,7.5S4,18.6,4,14.5v-5C4,8.1,5.1,7,6.5,7c1.4,0,2.3,1,2.3,2.4c0,0.3,0,1.5,0,1.5"
                          fill={playerColor}
                          stroke="white"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )
                  case 'grab':
                    // Open hand (for draggable items)
                    return (
                      <svg {...baseProps} style={{ ...baseProps.style, transform: 'translate(-2px, -2px) scale(1.1)' }}>
                        <path
                          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                          fill={playerColor}
                          stroke="#90EE90"
                          strokeWidth="2"
                        />
                      </svg>
                    )
                  case 'grabbing':
                    // Closed hand (while dragging)
                    return (
                      <svg {...baseProps} style={{ ...baseProps.style, transform: 'translate(-2px, -2px) scale(0.95)' }}>
                        <path
                          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                          fill={playerColor}
                          stroke="#FFD700"
                          strokeWidth="2"
                        />
                      </svg>
                    )
                  case 'not-allowed':
                    // Red X indicator
                    return (
                      <svg {...baseProps}>
                        <path
                          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                          fill={playerColor}
                          stroke="#FF4444"
                          strokeWidth="2"
                        />
                      </svg>
                    )
                  default:
                    // Default arrow cursor
                    return (
                      <svg {...baseProps}>
                        <path
                          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                          fill={playerColor}
                          stroke="white"
                          strokeWidth="1.5"
                        />
                      </svg>
                    )
                }
              }

              // Player cursor
              return (
                <div
                  key="player-cursor"
                  style={{
                    position: 'absolute',
                    left: playerScreenX,
                    top: playerScreenY,
                    pointerEvents: 'none',
                    filter: `drop-shadow(0 0 8px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6))`,
                    zIndex: item.zIndex,
                  }}
                >
                  {getCursorSvg()}
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
              )
            }

            // Render trace
            const trace = item.trace!
            // Use editingTrace for selected trace to show live updates (check ID match to be safe)
            const displayTrace = (editingTrace && editingTrace.id === trace.id) ? editingTrace : trace
        const transform = getTraceTransform(trace)
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
        const borderColor = trace.borderColor || getBorderColor(trace.type)
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
        const isSelected = selectedTraceId === trace.id && !isPressed
        const isMultiSelected = multiSelectedIds.has(trace.id)

        // Apply customization defaults
        const showBorder = trace.showBorder ?? true
        const showBackground = trace.showBackground ?? true
        const showDescription = trace.showDescription ?? false
        const showFilename = trace.showFilename ?? true
        const fontSize = trace.fontSize ?? 'medium'
        const fontFamily = trace.fontFamily ?? 'sans'

        // Apply crop to border size
        const cropX = trace.cropX ?? 0
        const cropY = trace.cropY ?? 0
        const cropWidth = trace.cropWidth ?? 1
        const cropHeight = trace.cropHeight ?? 1
        
        // Border container should match the cropped content size
        // For shapes, use their actual width/height properties
        const shapeWidth = trace.type === 'shape' ? (trace.width || 200) : width
        const shapeHeight = trace.type === 'shape' ? (trace.height || 200) : height
        const borderWidth = (trace.type === 'shape' ? shapeWidth : width * cropWidth) * (transform as any).scaleX * zoom
        const borderHeight = (trace.type === 'shape' ? shapeHeight : height * cropHeight) * (transform as any).scaleY * zoom

        // Debug logging for image dimensions
        // Selected trace rendering

        // Edge fade, measured per axis against the actual screen edges (the
        // same rectangular vignette the ground elements use). This was a
        // CIRCLE sized to the viewport's diagonal half-length, which is why
        // the fade behaved so oddly: on a 16:9 screen the left/right edges
        // sit inside that circle's fade band (visible dimming) while the
        // top/bottom edges never reach it (no fade at all). Normalizing each
        // axis to its own half-extent makes 1.0 mean "at the edge" in every
        // direction, so all four sides behave identically.
        const viewportCenterX = lobbyWidth / 2
        const viewportCenterY = lobbyHeight / 2

        // Measure from the trace's nearest EDGE, not its center. Center-only
        // distance made zoomed-in traces vanish outright: zoom a large trace
        // until it fills the screen and its center can sit well past the cull
        // boundary while its body still covers the viewport -- observable as
        // "the trace disappears once more than half of it leaves the view".
        // Subtracting the on-screen half-extent means a trace only fades/culls
        // once the whole thing has actually left the neighbourhood of the
        // screen. Rotated traces use their half-diagonal on both axes -- a
        // conservative bound, since an axis-aligned extent understates how far
        // a rotated corner can reach.
        const { width: cullBaseW, height: cullBaseH } = getTraceSize(trace)
        const cullW = trace.type === 'shape' ? (trace.width || 200) : cullBaseW * (trace.cropWidth ?? 1)
        const cullH = trace.type === 'shape' ? (trace.height || 200) : cullBaseH * (trace.cropHeight ?? 1)
        let halfW = (cullW * ((transform as any).scaleX ?? 1) * zoom) / 2
        let halfH = (cullH * ((transform as any).scaleY ?? 1) * zoom) / 2
        if ((transform.rotation ?? 0) % 360 !== 0) {
          const halfDiag = Math.hypot(halfW, halfH)
          halfW = halfDiag
          halfH = halfDiag
        }
        const normalizedX = Math.max(0, Math.abs(screenX - viewportCenterX) - halfW) / viewportCenterX
        const normalizedY = Math.max(0, Math.abs(screenY - viewportCenterY) - halfH) / viewportCenterY
        const normalizedDistance = Math.max(normalizedX, normalizedY)

        // Fade begins just inside the edge (a trace sitting exactly on the
        // edge renders at ~2/3 opacity) and finishes a quarter-viewport past
        // it -- present enough to notice, without dimming the working area.
        const fadeStart = 0.88
        const fadeEnd = 1.25

        // With the fade toggled off (Profile -> Trace Edge Fade), traces hold
        // full opacity right up to the cull boundary below, which stays either
        // way -- the fade is a visual preference, the cull is what keeps
        // off-screen DOM cheap.
        let traceOpacity = 1.0
        if (traceFadeEnabled && normalizedDistance > fadeStart) {
          const fadeProgress = (normalizedDistance - fadeStart) / (fadeEnd - fadeStart)
          traceOpacity = Math.max(0, 1 - fadeProgress)
        }

        // Don't render if completely transparent or far outside viewport
        // EXCEPTION: Keep rendering if media is playing (video/audio) OR if it's an interactive embed
        const isPlayingMedia = playingMedia.has(trace.id)
        const isInteractiveEmbed = trace.type === 'embed' && trace.enableInteraction
        if (!isPlayingMedia && !isInteractiveEmbed && (traceOpacity <= 0 || normalizedDistance > fadeEnd)) {
          return null
        }

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
            {/* Light overlay FIRST so it renders below the trace */}
            {trace.illuminate && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${screenX + (trace.lightOffsetX ?? 0) * zoom}px`,
                  top: `${screenY + (trace.lightOffsetY ?? 0) * zoom}px`,
                  width: `${(trace.lightRadius ?? 200) * zoom * 2}px`,
                  height: `${(trace.lightRadius ?? 200) * zoom * 2}px`,
                  borderRadius: '50%',
                  background: trace.lightColor ?? '#ffffff',
                  opacity: (trace.lightIntensity ?? 1.0) * 0.8 * traceOpacity,
                  mixBlendMode: 'screen',
                  filter: `blur(${(trace.lightRadius ?? 200) * zoom * 0.3}px)`,
                  animation: trace.lightPulse ? `pulse ${trace.lightPulseSpeed ?? 2}s ease-in-out infinite` : 'none',
                  transformOrigin: 'center center',
                  marginLeft: `${-(trace.lightRadius ?? 200) * zoom}px`,
                  marginTop: `${-(trace.lightRadius ?? 200) * zoom}px`,
                  willChange: 'transform, opacity',
                  ['--pulse-opacity' as any]: (trace.lightIntensity ?? 1.0) * 0.8 * traceOpacity,
                }}
              />
            )}
            
            {/* The trace itself */}
            {/* position+zIndex here too (not just the inner container):
                CSS opacity < 1 establishes its own stacking context, which
                would otherwise isolate the inner z-index from comparing
                correctly against other traces once this fades with distance.
                Not capped: a trace's z_index encodes layer*100 + order
                (see layerZIndex.ts), so any trace in a non-first layer
                already exceeds a small cap -- capping collapsed all of them
                to the same value, which then had to fall back to DOM order
                (see HANDLE_Z_INDEX below for how handles stay on top instead). */}
            <div style={{ opacity: traceOpacity, willChange: 'transform', position: 'relative', zIndex: trace.zIndex ?? 0 }}>
            {/* Container for positioning - doesn't scale */}
            <div
              data-trace-element="true"
              className="absolute"
              style={{
                left: `${screenX}px`,
                top: `${screenY}px`,
                // Explicit z-index so ordinary traces and path shapes
                // compare on equal terms. Without this, a path's explicit
                // z-index always painted above every non-path trace
                // regardless of value, since a positioned element with a
                // set z-index paints above siblings that rely on implicit
                // DOM-order stacking.
                zIndex: trace.zIndex ?? 0,
                // The pressed state adds a slight inset scale on top of the
                // existing transform, so a clickable trace visibly depresses.
                // Folded into the same transform string rather than applied to
                // a wrapper, because a second transformed element would
                // reintroduce the stacking-context problem the comment above
                // describes.
                transform: `translate(-50%, -50%) rotate(${transform.rotation}deg) scaleX(${(trace.flipHorizontal ? -1 : 1) * (isPressed ? 0.97 : 1)}) scaleY(${(trace.flipVertical ? -1 : 1) * (isPressed ? 0.97 : 1)})`,
                // Only transitioned while pressed. A permanent transition here
                // would smear every drag frame, since dragging moves this same
                // element.
                transition: isPressed ? 'transform 90ms ease-out, filter 90ms ease-out' : undefined,
                // Brightens the whole trace -- background, text and border at
                // once -- without needing to know which of the many per-type
                // renderers below is drawing it.
                filter: isPressed ? 'brightness(1.35)' : undefined,
                willChange: 'transform',
                transformOrigin: 'center center',
                cursor: trace.isClickable && trace.linkUrl ? 'pointer' : undefined,
                pointerEvents: trace.ignoreClicks ? 'none' : 'auto',
              }}
              onMouseEnter={() => setCursorState('pointer')}
              onMouseLeave={() => setCursorState('default')}
              onMouseDown={(e) => handleMouseDown(e, trace, 'move')}
              onTouchStart={(e) => handleTouchDown(e, trace, 'move')}
              onClick={(e) => {
                // Don't handle clicks if we're in a transform mode (e.g., dragging a point)
                if (transformMode !== 'none') {
                  e.stopPropagation()
                  return
                }
                e.stopPropagation()

                if (isClickThrough(trace, e)) {
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
                // Text traces edit in place on double-click -- the preview
                // modal was a detour nobody used for text (it exists for
                // media, where "see it big" means something). Falls back to
                // the modal when editing isn't possible (view-only atrium or
                // a locked trace), where it still serves reading/copying.
                if (trace.type === 'text' && canEdit && !trace.isLocked) {
                  setSelectedTraceId(trace.id)
                  setInlineEditingTraceId(trace.id)
                  setInlineEditText(trace.content ?? '')
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
                    pointerEvents: trace.ignoreClicks ? 'none' : 'auto',
                    overflow: 'hidden',
                    outline: isSelected
                      ? '2px solid rgba(203, 203, 203, 0.9)'
                      : isMultiSelected
                      ? '2px solid rgba(134, 239, 172, 0.95)'
                      : 'none',
                    outlineOffset: '2px',
                    boxShadow: isSelected
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
                    const shapeColor = trace.shapeColor || '#3b82f6'
                    const shapeOpacity = trace.shapeOpacity ?? 1.0
                    const cornerRadius = trace.cornerRadius || 0
                    const shapeType = trace.shapeType || 'rectangle'
                    const hasOutline = trace.shapeOutlineOnly ?? false
                    const noFill = trace.shapeNoFill ?? false
                    const outlineColor = trace.shapeOutlineColor || shapeColor
                    const outlineWidth = trace.shapeOutlineWidth ?? 2
                    const outlineOpacity = trace.shapeOutlineOpacity ?? 1.0
                    
                    // Determine fill and stroke based on options (independent)
                    const fill = noFill ? 'none' : shapeColor
                    const stroke = hasOutline ? outlineColor : 'none'
                    const strokeWidth = hasOutline ? outlineWidth : 0
                    
                    // Convert corner radius to viewBox percentage separately for x and y to keep circles circular.
                    // Also has to divide out scaleX/scaleY (the resize-handle stretch applied as a CSS transform
                    // on top of this SVG's base width/height) -- otherwise a non-uniform resize stretches the
                    // already-correct-for-the-base-box radius into an ellipse, since the outer transform scales
                    // the whole rendered box (corners included) after this percentage is baked in.
                    const shapeScaleX = (transform as any).scaleX || 1
                    const shapeScaleY = (transform as any).scaleY || 1
                    const radiusPercentX = (cornerRadius / (width * shapeScaleX)) * 100
                    const radiusPercentY = (cornerRadius / (height * shapeScaleY)) * 100

                    const clipPathStyle = trace.cropWidth && trace.cropWidth < 1 
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined

                    if (shapeType === 'rectangle') {
                      return (
                        <svg
                          className="w-full h-full pointer-events-none select-none"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          style={{ clipPath: clipPathStyle }}
                        >
                          <rect
                            x={hasOutline ? strokeWidth / 2 : 0}
                            y={hasOutline ? strokeWidth / 2 : 0}
                            width={hasOutline ? 100 - strokeWidth : 100}
                            height={hasOutline ? 100 - strokeWidth : 100}
                            rx={radiusPercentX}
                            ry={radiusPercentY}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                            vectorEffect="non-scaling-stroke"
                            fillOpacity={shapeOpacity}
                            strokeOpacity={outlineOpacity}
                          />
                        </svg>
                      )
                    } else if (shapeType === 'circle') {
                      return (
                        <svg
                          className="w-full h-full pointer-events-none select-none"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          style={{ clipPath: clipPathStyle }}
                        >
                          <ellipse
                            cx="50"
                            cy="50"
                            rx={hasOutline ? 50 - strokeWidth / 2 : 50}
                            ry={hasOutline ? 50 - strokeWidth / 2 : 50}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                            vectorEffect="non-scaling-stroke"
                            fillOpacity={shapeOpacity}
                            strokeOpacity={outlineOpacity}
                          />
                        </svg>
                      )
                    } else if (shapeType === 'triangle') {
                      const inset = hasOutline ? strokeWidth / 2 : 0
                      // Triangle edges aren't axis-aligned, so there's no
                      // clean separate X/Y radius the way a rectangle has --
                      // averaging the two keeps it consistent with the
                      // rectangle's radius "feel" without a second control.
                      const triangleRadiusPercent = (radiusPercentX + radiusPercentY) / 2

                      return (
                        <svg
                          className="w-full h-full pointer-events-none select-none"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          style={{ clipPath: clipPathStyle }}
                        >
                          <path
                            d={roundedPolygonPath(
                              [
                                { x: 50, y: 15 + inset },
                                { x: 85 - inset, y: 85 - inset },
                                { x: 15 + inset, y: 85 - inset },
                              ],
                              triangleRadiusPercent
                            )}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                            fillOpacity={shapeOpacity}
                            strokeOpacity={outlineOpacity}
                          />
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
                <div
                  className="trace-frame-nier relative cursor-pointer transition-shadow"
                  style={{
                    boxSizing: 'content-box',
                    width: `${borderWidth}px`,
                    height: `${borderHeight}px`,
                    border: showBorder ? `${displayTrace.borderWidth ?? 2}px solid ${isSelected && isCropMode ? '#8f8f8f' : isSelected ? '#cbcbcb' : isMultiSelected ? '#86efac' : borderColor}` : 'none',
                    borderRadius: `${displayTrace.borderRadius ?? 0}px`,
                    backgroundColor: showBackground ? (() => {
                      const fc = displayTrace.fillColor || '#191919';
                      const fo = displayTrace.fillOpacity ?? 0.95;
                      // Convert hex to rgba
                      const r = parseInt(fc.slice(1, 3), 16) || 26;
                      const g = parseInt(fc.slice(3, 5), 16) || 26;
                      const b = parseInt(fc.slice(5, 7), 16) || 24;
                      return `rgba(${r}, ${g}, ${b}, ${fo})`;
                    })() : 'transparent',
                    ...(showBorder && trace.borderOpacity !== undefined && trace.borderOpacity < 1 ? {
                      borderColor: isSelected && isCropMode ? '#8f8f8f' : isSelected ? '#cbcbcb' : isMultiSelected ? '#86efac' : (() => {
                        const bc = borderColor;
                        const bo = trace.borderOpacity;
                        const r = parseInt(bc.slice(1, 3), 16) || 255;
                        const g = parseInt(bc.slice(3, 5), 16) || 255;
                        const b = parseInt(bc.slice(5, 7), 16) || 255;
                        return `rgba(${r}, ${g}, ${b}, ${bo})`;
                      })()
                    } : {}),
                    padding: '0px',
                    pointerEvents: trace.ignoreClicks ? 'none' : 'auto',
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
                  {(isSelected || showTraceTypeLabels) && inlineEditingTraceId !== trace.id && <div className="trace-nier-type-badge">{getTraceTypeLabel(trace.type)}</div>}
                  {showBorder && (
                    <>
                      <span className="absolute top-0 left-0 w-2 h-2 border-l border-t pointer-events-none" style={{ borderColor: isSelected ? 'rgba(203, 203, 203,0.9)' : 'rgba(143, 143, 143,0.75)' }} />
                      <span className="absolute top-0 right-0 w-2 h-2 border-r border-t pointer-events-none" style={{ borderColor: isSelected ? 'rgba(203, 203, 203,0.9)' : 'rgba(143, 143, 143,0.75)' }} />
                      <span className="absolute bottom-0 left-0 w-2 h-2 border-l border-b pointer-events-none" style={{ borderColor: isSelected ? 'rgba(203, 203, 203,0.9)' : 'rgba(143, 143, 143,0.75)' }} />
                      <span className="absolute bottom-0 right-0 w-2 h-2 border-r border-b pointer-events-none" style={{ borderColor: isSelected ? 'rgba(203, 203, 203,0.9)' : 'rgba(143, 143, 143,0.75)' }} />
                    </>
                  )}
                  {/* Scaled content wrapper - text traces render at final pixel size to avoid distortion */}
                  <div
                    className="w-full h-full"
                    style={trace.type === 'text' ? {
                      width: '100%',
                      height: '100%',
                    } : {
                      transform: `scale(${(transform as any).scaleX * zoom}, ${(transform as any).scaleY * zoom}) translate(${-cropX * 100}%, ${-cropY * 100}%)`,
                      transformOrigin: 'top left',
                      width: `${width}px`,
                      height: `${height}px`,
                    }}
                  >
              {/* Image Content */}
              {trace.type === 'image' && (trace.mediaUrl || trace.imageUrl) && !failedImages.has(trace.id) && (
                (() => {
                  const rawUrl = trace.mediaUrl || trace.imageUrl || ''
                  const isLocal = rawUrl.startsWith('local://')
                  const resolvedSrc = imageProxySources[trace.id]
                  // For local:// URLs, wait for resolved blob URL before rendering
                  if (isLocal && !resolvedSrc) return <div className="flex items-center justify-center h-full"><span className="text-white/70 text-[10px] tracking-wider uppercase">Loading...</span></div>
                  // A successful resolve always hands back a blob: URL, so one
                  // that is still local:// means the file couldn't be read --
                  // deleted from the vault by hand, or restored from a folder
                  // it never travelled with. Said plainly rather than left as a
                  // broken image, since the trace keeps its place and the user
                  // needs to know why it's empty.
                  if (isLocal && resolvedSrc.startsWith('local://')) return <div className="flex items-center justify-center h-full"><span className="text-white/70 text-[10px] tracking-wider uppercase">Missing file</span></div>
                  return (
                <img
                  src={resolvedSrc || rawUrl}
                  alt=""
                  className="w-full h-full object-contain pointer-events-none select-none"
                  style={{ 
                    clipPath: trace.cropWidth && trace.cropWidth < 1 
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined,
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
              {trace.type === 'image' && (!trace.mediaUrl && !trace.imageUrl || failedImages.has(trace.id)) && (
                <div className="flex flex-col items-center justify-center h-full pointer-events-none select-none">
                  <span className="text-4xl mb-2">🖼️</span>
                  {showDescription && trace.content && (
                    <p className="text-xs text-white/60 text-center">
                      {trace.content}
                    </p>
                  )}
                </div>
              )}

              {/* Video Content */}
              {trace.type === 'video' && trace.mediaUrl && (
                <video
                  src={localMediaUrls[trace.id] || trace.mediaUrl}
                  controls={false}
                  className="w-full h-full pointer-events-none select-none"
                  style={{ 
                    clipPath: trace.cropWidth && trace.cropWidth < 1 
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined,
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
                />
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
                    src={localMediaUrls[trace.id] || trace.mediaUrl}
                    className="hidden"
                    onPlay={() => setPlayingMedia(prev => new Set(prev).add(trace.id))}
                    onPause={() => setPlayingMedia(prev => { const next = new Set(prev); next.delete(trace.id); return next })}
                    onEnded={() => setPlayingMedia(prev => { const next = new Set(prev); next.delete(trace.id); return next })}
                  />
                  <button
                    className="pointer-events-auto flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-medium tracking-wider uppercase transition-all duration-200"
                    style={{
                      background: playingMedia.has(trace.id)
                        ? 'rgba(181, 181, 181, 0.25)'
                        : 'rgba(203, 203, 203,0.08)',
                      color: playingMedia.has(trace.id) ? '#cbcbcb' : 'rgba(203, 203, 203,0.65)',
                      border: `1px solid ${playingMedia.has(trace.id) ? 'rgba(181, 181, 181,0.45)' : 'rgba(203, 203, 203,0.2)'}`,
                      backdropFilter: 'blur(8px)',
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
                    {playingMedia.has(trace.id) ? 'Pause' : 'Play'}
                  </button>
                  {showDescription && trace.content && (
                    <p className="text-[10px] text-white/50 text-center truncate w-full pointer-events-none select-none tracking-wide">
                      {trace.content}
                    </p>
                  )}
                </div>
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
                  {documentPages[`${trace.id}:${documentPage[trace.id] ?? 1}`] ? (
                    <img
                      src={documentPages[`${trace.id}:${documentPage[trace.id] ?? 1}`]}
                      alt=""
                      className="w-full h-full object-contain pointer-events-none select-none"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-black/40 text-[10px] tracking-wider uppercase">
                        {documentError[trace.id] ?? 'Rendering…'}
                      </span>
                    </div>
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
                        className="text-nier-bg/80 hover:text-nier-bg disabled:opacity-25 disabled:cursor-not-allowed leading-none transition-colors"
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
                      <span
                        className="text-nier-bg/80 uppercase tabular-nums leading-none whitespace-nowrap"
                        style={{ fontSize: '2.2cqh', letterSpacing: '0.15em' }}
                      >
                        {documentPage[trace.id] ?? 1} / {documentPageCount[trace.id]}
                      </span>
                      <button
                        type="button"
                        className="text-nier-bg/80 hover:text-nier-bg disabled:opacity-25 disabled:cursor-not-allowed leading-none transition-colors"
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
                  if (isLocal && !resolvedSrc) return <div className="flex items-center justify-center h-full"><span className="text-white/70 text-[10px] tracking-wider uppercase">Loading...</span></div>
                  // Still local:// after resolving means the file is gone --
                  // see the image branch above.
                  if (isLocal && resolvedSrc.startsWith('local://')) return <div className="flex items-center justify-center h-full"><span className="text-white/70 text-[10px] tracking-wider uppercase">Missing file</span></div>
                  // Render as image, not iframe
                  return (
                    <img
                      src={resolvedSrc || trace.mediaUrl}
                      alt=""
                      className="w-full h-full object-contain pointer-events-none select-none"
                      style={{ 
                        clipPath: trace.cropWidth && trace.cropWidth < 1 
                          ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                          : undefined,
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
                    <a
                      href={clickThroughUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-col items-center justify-center h-full w-full gap-2 px-3 select-none pointer-events-auto bg-nier-black/40 hover:bg-nier-black/60 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      title={clickThroughUrl}
                    >
                      {hostname && (
                        <img
                          src={`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`}
                          alt=""
                          className="w-8 h-8 opacity-80"
                          draggable={false}
                        />
                      )}
                      <p className="text-white/80 text-xs text-center line-clamp-2">
                        {trace.content || 'View source'}
                      </p>
                      {hostname && (
                        <p className="text-white/70 text-[9px] tracking-wider uppercase">{hostname}</p>
                      )}
                    </a>
                  )
                }
                
                // Otherwise, treat as iframe embed
                const embedUrl = extractEmbedUrl(trace.mediaUrl)
                if (!embedUrl) {
                  return (
                    <div className="w-full h-full flex items-center justify-center bg-black/50">
                      <p className="text-white/60 text-sm">Invalid embed code</p>
                    </div>
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
                      clipPath: trace.cropWidth && trace.cropWidth < 1 
                        ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                        : undefined,
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

              {/* Text Content - renders at final pixel size, text conforms to box like Excel */}
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
                const baseFontSize = typeof fontSize === 'number' ? fontSize : (fontSize === 'small' ? 10 : fontSize === 'large' ? 14 : 12)
                const rawScaleX = (transform as any).scaleX ?? 1
                const rawScaleY = (transform as any).scaleY ?? 1
                const scaleWithBox = trace.textScaleWithBox ?? true
                const traceScale = scaleWithBox
                  ? (Math.sqrt(Math.max(0, rawScaleX * rawScaleY)) || 1)
                  : 1
                const scaledFontSize = baseFontSize * traceScale * zoom
                const textStyles = {
                  fontSize: `${scaledFontSize}px`,
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
                  className={`flex flex-col items-center justify-center h-full w-full overflow-hidden ${inlineEditingTraceId === trace.id ? 'pointer-events-auto' : 'pointer-events-none select-none'}`}
                  style={{
                    padding: `${Math.max(4, 6 * traceScale * zoom)}px`,
                    clipPath: trace.cropWidth && trace.cropWidth < 1
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined,
                  }}
                >
                  {inlineEditingTraceId === trace.id ? (
                    /* Inline editing textarea */
                    <textarea
                      autoFocus
                      value={inlineEditText}
                      onChange={(e) => setInlineEditText(e.target.value)}
                      onBlur={() => {
                        if (inlineEditText !== trace.content) {
                          const textSize = computeAutoFitTextSize(inlineEditText, baseFontSize, { fontFamily: textStyles.fontFamily })
                          updateTraceCustomization(trace.id, { content: inlineEditText, width: textSize.width, height: textSize.height })
                        }
                        setInlineEditingTraceId(null)
                        setInlineEditText('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setInlineEditingTraceId(null)
                          setInlineEditText('')
                        } else if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (inlineEditText !== trace.content) {
                            const textSize = computeAutoFitTextSize(inlineEditText, baseFontSize, { fontFamily: textStyles.fontFamily })
                            updateTraceCustomization(trace.id, { content: inlineEditText, width: textSize.width, height: textSize.height })
                          }
                          setInlineEditingTraceId(null)
                          setInlineEditText('')
                        }
                        e.stopPropagation()
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="w-full h-full bg-transparent resize-none outline-none border-2 border-white focus:border-gray-400"
                      style={textStyles}
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
                )
              })()}

                  </div>
                </div>
                </>
              )}

              {/* Username label - outside border container so it doesn't scale */}
              {showFilename && trace.type !== 'shape' && (
                <div
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
            {isSelected && !isCropMode && canEdit && inlineEditingTraceId !== trace.id && (
              <>
                {/* Special handles for path shapes */}
                {(trace.type === 'shape' && trace.shapeType === 'path') ? (
                  <>
                    {/* Point handles for path - using world coordinates */}
                    {(() => {
                      const points = localShapePoints[trace.id] || displayTrace.shapePoints || []
                      return points.map((point, index) => {
                      // Convert world coordinates to screen coordinates
                      const { screenX, screenY } = getScreenPosition(point.x, point.y)
                      
                      const isPointSelected = selectedPointIndex === index
                      const isBezier = displayTrace.pathCurveType === 'bezier'
                      
                      return (
                        <Fragment key={`point-${index}`}>
                          {/* Main point handle */}
                          <div
                            data-trace-element="true"
                            className={`absolute w-4 h-4 border-2 border-black cursor-move pointer-events-auto z-10 hover:scale-125 transition-transform ${
                              isPointSelected ? 'bg-white' : 'bg-gray-400'
                            }`}
                            style={{
                              left: `${screenX}px`,
                              top: `${screenY}px`,
                              transform: 'translate(-50%, -50%)',
                            }}
                            onClick={(e) => {
                              e.stopPropagation() // Prevent background deselection
                            }}
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
                          
                          {/* Control point handles (only in bezier mode and when point is selected) */}
                          {isBezier && isPointSelected && (
                            <>
                              {(() => {
                                const cp1x = point.cp1x ?? point.x - 20
                                const cp1y = point.cp1y ?? point.y
                                const { screenX: cp1ScreenX, screenY: cp1ScreenY } = getScreenPosition(cp1x, cp1y)
                                
                                return (
                                  <>
                                    {/* Line from point to control handle */}
                                    <svg
                                      className="absolute pointer-events-none"
                                      style={{
                                        left: 0,
                                        top: 0,
                                        width: '100%',
                                        height: '100%',
                                        overflow: 'visible',
                                        zIndex: 9
                                      }}
                                    >
                                      <line
                                        x1={screenX}
                                        y1={screenY}
                                        x2={cp1ScreenX}
                                        y2={cp1ScreenY}
                                        stroke="#9ca3af"
                                        strokeWidth="1"
                                        strokeDasharray="4 2"
                                      />
                                    </svg>
                                    {/* Control handle */}
                                    <div
                                      data-trace-element="true"
                                      className="absolute w-3 h-3 bg-gray-300 border-2 border-black cursor-move pointer-events-auto z-10 hover:scale-125 transition-transform"
                                      style={{
                                        left: `${cp1ScreenX}px`,
                                        top: `${cp1ScreenY}px`,
                                        transform: 'translate(-50%, -50%)',
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation() // Prevent background deselection
                                      }}
                                      onMouseDown={(e) => {
                                        e.stopPropagation()
                                        e.preventDefault()
                                        setSelectedPointIndex(index) // Preserve point selection
                                        handleMouseDown(e, trace, 'control-in', `${index}`)
                                      }}
                                      onTouchStart={(e) => {
                                        e.stopPropagation()
                                        setSelectedPointIndex(index)
                                        handleTouchDown(e, trace, 'control-in', `${index}`)
                                      }}
                                    />
                                  </>
                                )
                              })()}
                              
                              {/* Out-handle (cp2) */}
                              {(() => {
                                const cp2x = point.cp2x ?? point.x + 20
                                const cp2y = point.cp2y ?? point.y
                                const { screenX: cp2ScreenX, screenY: cp2ScreenY } = getScreenPosition(cp2x, cp2y)
                                
                                return (
                                  <>
                                    {/* Line from point to control handle */}
                                    <svg
                                      className="absolute pointer-events-none"
                                      style={{
                                        left: 0,
                                        top: 0,
                                        width: '100%',
                                        height: '100%',
                                        overflow: 'visible',
                                        zIndex: 9
                                      }}
                                    >
                                      <line
                                        x1={screenX}
                                        y1={screenY}
                                        x2={cp2ScreenX}
                                        y2={cp2ScreenY}
                                        stroke="#9ca3af"
                                        strokeWidth="1"
                                        strokeDasharray="4 2"
                                      />
                                    </svg>
                                    {/* Control handle */}
                                    <div
                                      data-trace-element="true"
                                      className="absolute trace-nier-handle trace-nier-handle-control cursor-move pointer-events-auto z-10"
                                      style={{
                                        left: `${cp2ScreenX}px`,
                                        top: `${cp2ScreenY}px`,
                                        transform: 'translate(-50%, -50%)',
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation() // Prevent background deselection
                                      }}
                                      onMouseDown={(e) => {
                                        e.stopPropagation()
                                        e.preventDefault()
                                        setSelectedPointIndex(index) // Preserve point selection
                                        handleMouseDown(e, trace, 'control-out', `${index}`)
                                      }}
                                      onTouchStart={(e) => {
                                        e.stopPropagation()
                                        setSelectedPointIndex(index)
                                        handleTouchDown(e, trace, 'control-out', `${index}`)
                                      }}
                                    />
                                  </>
                                )
                              })()}
                            </>
                          )}
                        </Fragment>
                      )
                    })
                    })()}
                    
                    {/* Move handle for entire path - centered on all points */}
                    {(() => {
                      const points = localShapePoints[trace.id] || trace.shapePoints || []
                      if (points.length === 0) return null
                      
                      // Calculate centroid
                      const sumX = points.reduce((sum, p) => sum + p.x, 0)
                      const sumY = points.reduce((sum, p) => sum + p.y, 0)
                      const centerX = sumX / points.length
                      const centerY = sumY / points.length
                      
                      const { screenX, screenY } = getScreenPosition(centerX, centerY)
                      
                      return (
                        <div
                          data-trace-element="true"
                          className="absolute trace-nier-handle-center cursor-move pointer-events-auto z-10"
                          style={{
                            left: `${screenX}px`,
                            top: `${screenY}px`,
                            transform: 'translate(-50%, -50%)',
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            setSelectedPointIndex(null)
                            handleMouseDown(e, trace, 'move-path', 'move-all')
                          }}
                          onTouchStart={(e) => {
                            e.stopPropagation()
                            setSelectedPointIndex(null)
                            handleTouchDown(e, trace, 'move-path', 'move-all')
                          }}
                        />
                      )
                    })()}
                  </>
                ) : null}

                {/* Crop button for all trace types (not for path) */}
                {trace.type !== 'shape' || trace.shapeType !== 'path' ? (
                <button
                  data-trace-element="true"
                  className="absolute text-[10px] font-semibold px-3 py-1.5 border pointer-events-auto z-10 transition-all hover:scale-105 tracking-[0.18em] uppercase"
                  style={{
                    left: `${screenX}px`,
                    top: `${screenY + (borderHeight / 2 + 30)}px`,
                    transform: 'translate(-50%, 0)',
                    color: isCropMode ? 'rgba(203, 203, 203, 0.95)' : 'rgba(181, 181, 181, 0.9)',
                    background: isCropMode ? 'rgba(40, 40, 40, 0.95)' : 'rgba(25, 25, 25, 0.94)',
                    borderColor: isCropMode ? 'rgba(203, 203, 203, 0.8)' : 'rgba(143, 143, 143, 0.7)',
                    boxShadow: isCropMode ? '0 0 10px rgba(203, 203, 203,0.22)' : '0 0 8px rgba(0,0,0,0.45)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsCropMode(!isCropMode)
                    setTransformMode('none')
                  }}
                >
                  {isCropMode ? '✓ DONE' : '✂ CROP'}
                </button>
                ) : null}
              </>
            )}

            {/* Crop mode handles (only when crop mode is active) */}
            {isSelected && isCropMode && canEdit && (
              <>
                {/* Crop area overlay - shows the crop boundaries */}
                <div
                  className="absolute pointer-events-auto cursor-pointer"
                  style={{
                    left: `${screenX - (width * (transform as any).scaleX * zoom / 2)}px`,
                    top: `${screenY - (height * (transform as any).scaleY * zoom / 2)}px`,
                    width: `${width * (transform as any).scaleX * zoom}px`,
                    height: `${height * (transform as any).scaleY * zoom}px`,
                    border: '1px dashed rgba(143, 143, 143, 0.95)',
                    boxShadow: 'inset 0 0 0 9999px rgba(25, 25, 25, 0.4), 0 0 0 1px rgba(203, 203, 203, 0.2)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsCropMode(false)
                    setTransformMode('none')
                  }}
                />
                
                {/* Crop handles at corners for adjusting crop area */}
                {['tl', 'tr', 'bl', 'br'].map((corner) => {
                  const cropX = trace.cropX ?? 0
                  const cropY = trace.cropY ?? 0
                  const cropWidth = trace.cropWidth ?? 1
                  const cropHeight = trace.cropHeight ?? 1
                  
                  // Calculate position based on crop values
                  const baseX = screenX - (width * (transform as any).scaleX * zoom / 2)
                  const baseY = screenY - (height * (transform as any).scaleY * zoom / 2)
                  const containerWidth = width * (transform as any).scaleX * zoom
                  const containerHeight = height * (transform as any).scaleY * zoom
                  
                  const cropLeft = baseX + (cropX * containerWidth)
                  const cropTop = baseY + (cropY * containerHeight)
                  const cropRight = baseX + ((cropX + cropWidth) * containerWidth)
                  const cropBottom = baseY + ((cropY + cropHeight) * containerHeight)
                  
                  const handleX = corner.includes('r') ? cropRight : cropLeft
                  const handleY = corner.includes('b') ? cropBottom : cropTop
                  
                  return (
                    <div
                      key={`crop-${corner}`}
                      data-trace-element="true"
                      className="absolute trace-nier-handle trace-nier-handle-crop cursor-nwse-resize pointer-events-auto z-10"
                      style={{
                        left: `${handleX}px`,
                        top: `${handleY}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        handleMouseDown(e, trace, 'crop', corner)
                      }}
                      onTouchStart={(e) => {
                        e.stopPropagation()
                        handleTouchDown(e, trace, 'crop', corner)
                      }}
                    />
                  )
                })}
              </>
            )}
          </div>
        </div>
        )
        })}

        {/* Render path point handles as absolute overlay (only for selected path) */}
        {selectedTraceId && (() => {
          const trace = traces.find(t => t.id === selectedTraceId)
          if (!trace || trace.type !== 'shape' || trace.shapeType !== 'path') return null
          
          const displayTrace = (editingTrace && editingTrace.id === trace.id) ? editingTrace : trace
          const points = localShapePoints[trace.id] || displayTrace.shapePoints || []
          
          return (
            <>
              {/* Point handles */}
              {points.map((point, index) => {
                const { screenX, screenY } = getScreenPosition(point.x, point.y)
                const isPointSelected = selectedPointIndex === index
                const isBezier = displayTrace.pathCurveType === 'bezier'
                
                return (
                  <Fragment key={`handle-${index}`}>
                    {/* Main point handle */}
                    <div
                      data-trace-element="true"
                      className={`absolute trace-nier-handle trace-nier-handle-point cursor-move pointer-events-auto z-[1000000] ${
                        isPointSelected ? 'trace-nier-handle-active' : ''
                      }`}
                      style={{
                        left: `${screenX}px`,
                        top: `${screenY}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
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
                    
                    {/* Bezier control handles (only when point is selected) */}
                    {isBezier && isPointSelected && (
                      <>
                        {/* In-handle (cp1) */}
                        {(() => {
                          const cp1x = point.cp1x ?? point.x - 20
                          const cp1y = point.cp1y ?? point.y
                          const { screenX: cp1ScreenX, screenY: cp1ScreenY } = getScreenPosition(cp1x, cp1y)
                          
                          return (
                            <>
                              <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 499 }}>
                                <line x1={screenX} y1={screenY} x2={cp1ScreenX} y2={cp1ScreenY} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 2" />
                              </svg>
                              <div
                                data-trace-element="true"
                                className="absolute trace-nier-handle trace-nier-handle-control cursor-move pointer-events-auto z-[1000000]"
                                style={{ left: `${cp1ScreenX}px`, top: `${cp1ScreenY}px`, transform: 'translate(-50%, -50%)' }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  setSelectedPointIndex(index)
                                  handleMouseDown(e, trace, 'control-in', `${index}`)
                                }}
                                onTouchStart={(e) => {
                                  e.stopPropagation()
                                  setSelectedPointIndex(index)
                                  handleTouchDown(e, trace, 'control-in', `${index}`)
                                }}
                              />
                            </>
                          )
                        })()}
                        
                        {/* Out-handle (cp2) */}
                        {(() => {
                          const cp2x = point.cp2x ?? point.x + 20
                          const cp2y = point.cp2y ?? point.y
                          const { screenX: cp2ScreenX, screenY: cp2ScreenY } = getScreenPosition(cp2x, cp2y)
                          
                          return (
                            <>
                              <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 499 }}>
                                <line x1={screenX} y1={screenY} x2={cp2ScreenX} y2={cp2ScreenY} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 2" />
                              </svg>
                              <div
                                data-trace-element="true"
                                className="absolute trace-nier-handle trace-nier-handle-control cursor-move pointer-events-auto z-[1000000]"
                                style={{ left: `${cp2ScreenX}px`, top: `${cp2ScreenY}px`, transform: 'translate(-50%, -50%)' }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  setSelectedPointIndex(index)
                                  handleMouseDown(e, trace, 'control-out', `${index}`)
                                }}
                                onTouchStart={(e) => {
                                  e.stopPropagation()
                                  setSelectedPointIndex(index)
                                  handleTouchDown(e, trace, 'control-out', `${index}`)
                                }}
                              />
                            </>
                          )
                        })()}
                      </>
                    )}
                  </Fragment>
                )
              })}
              
              {/* Move handle - centered on all points */}
              {(() => {
                if (points.length === 0) return null
                const sumX = points.reduce((sum, p) => sum + p.x, 0)
                const sumY = points.reduce((sum, p) => sum + p.y, 0)
                const centerX = sumX / points.length
                const centerY = sumY / points.length
                const { screenX, screenY } = getScreenPosition(centerX, centerY)
                
                return (
                  <div
                    data-trace-element="true"
                    className="absolute trace-nier-handle-center cursor-move pointer-events-auto z-[1000000]"
                    style={{ left: `${screenX}px`, top: `${screenY}px`, transform: 'translate(-50%, -50%)' }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setSelectedPointIndex(null)
                      handleMouseDown(e, trace, 'move-path', 'move-all')
                    }}
                    onTouchStart={(e) => {
                      e.stopPropagation()
                      setSelectedPointIndex(null)
                      handleTouchDown(e, trace, 'move-path', 'move-all')
                    }}
                  />
                )
              })()}
            </>
          )
        })()}

        {/* Render regular handles (corner, edge, rotation) as absolute overlay for non-path shapes */}
        {/* Also show for paths when they're part of a multi-selection so they can be moved together */}
        {/* Suppressed once a real multi-selection exists -- the group handles
            below take over, and showing both would put two overlapping,
            differently-pivoted handle sets on the same trace. */}
        {selectedTraceId && !isCropMode && multiSelectedIds.size <= 1 && (() => {
          const trace = traces.find(t => t.id === selectedTraceId)
          // Must check membership (has), not just multiSelectedIds.size > 0 --
          // that alone made ANY solo-selected path get the full non-path
          // corner/edge/rotate handle box (sized to its unrelated default
          // width/height, positioned at its stale x/y -- see the path
          // zoom-visibility fix) whenever the user simply had some OTHER,
          // unrelated multi-selection active, which looked like a random
          // "empty box" appearing around freshly-selected paths.
          const isPathInMultiSelect = trace?.type === 'shape' && trace?.shapeType === 'path' && multiSelectedIds.has(trace.id)
          // Hide for paths unless they're in a multi-selection
          if (!trace || (trace.type === 'shape' && trace.shapeType === 'path' && !isPathInMultiSelect)) return null
          
          const transform = localTraceTransforms[trace.id] || getTraceTransform(trace)
          const { screenX, screenY } = getScreenPosition(transform.x, transform.y)
          const { width, height } = getTraceSize(trace)
          
          // Get dimensions with scale and crop applied (same as in main trace rendering)
          const cropWidth = trace.cropWidth ?? 1
          const cropHeight = trace.cropHeight ?? 1
          
          const shapeWidth = trace.type === 'shape' ? (trace.width || 200) : width
          const shapeHeight = trace.type === 'shape' ? (trace.height || 200) : height
          const borderWidth = (trace.type === 'shape' ? shapeWidth : width * cropWidth) * (transform as any).scaleX * zoom
          const borderHeight = (trace.type === 'shape' ? shapeHeight : height * cropHeight) * (transform as any).scaleY * zoom
          
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
                    className="absolute trace-nier-handle trace-nier-handle-corner cursor-nwse-resize pointer-events-auto z-[1000000]"
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
                    className={`absolute trace-nier-handle trace-nier-handle-edge pointer-events-auto z-[1000000] ${cursorClass}`}
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

              {/* Rotation handle at top */}
              <div
                data-trace-element="true"
                className="absolute trace-nier-handle trace-nier-handle-rotate cursor-grab pointer-events-auto z-[1000000]"
                style={{
                  left: `${screenX}px`,
                  top: `${screenY - (borderHeight / 2 + 20)}px`,
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={(e) => handleMouseDown(e, trace, 'rotate')}
                onTouchStart={(e) => handleTouchDown(e, trace, 'rotate')}
              />
            </>
          )
        })()}

        {/* Group transform handles -- one shared box around the whole
            multi-selection. Corners scale and the top handle rotates, both
            pivoting on the box's center so the selection transforms as a
            single rigid unit. Corner-only (no edge handles): a non-uniform
            group scale would shear any child that has its own rotation. */}
        {multiSelectedIds.size > 1 && canEdit && !isCropMode && (() => {
          const bounds = getGroupBounds(Array.from(multiSelectedIds))
          if (!bounds) return null

          const topLeft = getScreenPosition(bounds.minX, bounds.minY)
          const bottomRight = getScreenPosition(bounds.maxX, bounds.maxY)
          const boxLeft = topLeft.screenX
          const boxTop = topLeft.screenY
          const boxWidth = bottomRight.screenX - topLeft.screenX
          const boxHeight = bottomRight.screenY - topLeft.screenY

          return (
            <>
              <div
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
                  className="absolute trace-nier-handle trace-nier-handle-corner cursor-nwse-resize pointer-events-auto z-[1000001]"
                  style={{
                    left: `${corner.includes('r') ? boxLeft + boxWidth : boxLeft}px`,
                    top: `${corner.includes('b') ? boxTop + boxHeight : boxTop}px`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onMouseDown={(e) => handleGroupMouseDown(e, 'group-scale')}
                  onTouchStart={(e) => handleGroupTouchDown(e, 'group-scale')}
                />
              ))}
              <div
                data-trace-element="true"
                className="absolute trace-nier-handle trace-nier-handle-rotate cursor-grab pointer-events-auto z-[1000001]"
                style={{
                  left: `${boxLeft + boxWidth / 2}px`,
                  top: `${boxTop - 20}px`,
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={(e) => handleGroupMouseDown(e, 'group-rotate')}
                onTouchStart={(e) => handleGroupTouchDown(e, 'group-rotate')}
              />
            </>
          )
        })()}

        {/* Render other users' cursors */}
        {!hideOtherCursors && Object.entries(otherUsers).map(([odUserId, user]) => {
          const userScreenX = user.x * zoom + worldOffset.x
          const userScreenY = user.y * zoom + worldOffset.y
          const userColor = user.playerColor || '#ffffff'

          // Convert hex color to RGB for shadows
          const hexToRgb = (hex: string) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
            return result ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16)
            } : { r: 255, g: 255, b: 255 }
          }
          const rgb = hexToRgb(userColor)

          return (
            <div
              key={`other-user-${odUserId}`}
              style={{
                position: 'absolute',
                left: userScreenX,
                top: userScreenY,
                pointerEvents: 'none',
                transition: 'left 0.15s ease-out, top 0.15s ease-out',
                filter: `drop-shadow(0 0 6px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5))`,
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
                  filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.5))`,
                }}
              >
                <path
                  d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                  fill={userColor}
                  stroke="white"
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

      {/* Live rotation angle, shown only during a rotate drag. Offset from the
          cursor so it never sits under the pointer, and pointer-events-none so
          it can't intercept the drag it's reporting on. */}
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
            <span style={{ opacity: 0.7, marginLeft: 6 }}>SNAP {ROTATION_SNAP_DEGREES}°</span>
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
        return (
        <>
          {/* Menu */}
          <div
            ref={contextMenuRef}
            className="fixed bg-black border border-gray-500 shadow-2xl py-1 z-[10000100] pointer-events-auto max-h-[80vh] overflow-y-auto"
            style={{ left: `${contextMenuPos.x}px`, top: `${contextMenuPos.y}px` }}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-gray-400 pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-gray-400 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-gray-400 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-gray-400 pointer-events-none" />
            
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) setEditingTrace(trace)
                setShowBatchEditPanel(false)
                setContextMenu(null)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> Customize
            </button>
            {multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId) && (
              <button
                className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                onClick={() => {
                  setEditingTrace(null)
                  setShowBatchEditPanel(true)
                  setContextMenu(null)
                }}
              >
                <span className="text-gray-400 text-[10px]">◇</span> Batch Edit ({multiSelectedIds.size})
              </button>
            )}
            {multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId) && multiSelectedIds.size <= MAX_REORGANIZE_TRACES && (
              <div
                className="relative"
                onMouseEnter={openReorganizeFlyout}
                onMouseLeave={scheduleCloseReorganizeFlyout}
              >
                <button
                  className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase"
                  title="Re-pack the selected traces around their current center using the batch placement algorithm"
                >
                  <span className="flex items-center gap-3"><span className="text-gray-400 text-[10px]">◇</span> Reorganize Selected ({multiSelectedIds.size})</span>
                  <span className="text-gray-300 text-[9px]">▶</span>
                </button>
                {contextMenuReorganizeOpen && reorganizeFlyoutRect && (
                  <div
                    className="fixed w-max flex flex-col bg-black border border-gray-500 shadow-2xl py-1 z-[10000101]"
                    style={
                      contextMenuFlyoutOnLeft
                        ? { top: reorganizeFlyoutRect.top, right: window.innerWidth - reorganizeFlyoutRect.left + 1 }
                        : { top: reorganizeFlyoutRect.top, left: reorganizeFlyoutRect.right + 1 }
                    }
                    onMouseEnter={keepReorganizeFlyoutOpen}
                    onMouseLeave={scheduleCloseReorganizeFlyout}
                  >
                    <button
                      className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                      onClick={() => reorganizeSelectedTraces('square')}
                      title="Pack into a rectangular block"
                    >
                      Square
                    </button>
                    <button
                      className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                      onClick={() => reorganizeSelectedTraces('circle')}
                      title="Pack into a rounded cluster"
                    >
                      Circle
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
                  className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(trace.content)
                    } catch {
                      // Ignore clipboard access failures
                    }
                    setContextMenu(null)
                  }}
                >
                  <span className="text-gray-400 text-[10px]">◇</span> Copy Text
                </button>
              )
            })()}
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceCustomization(trace.id, { isLocked: !trace.isLocked })
                }
                setContextMenu(null)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> {traces.find(t => t.id === contextMenu.traceId)?.isLocked ? 'Unlock' : 'Lock'}
            </button>
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceCustomization(trace.id, { ignoreClicks: !trace.ignoreClicks })
                }
                setContextMenu(null)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> {traces.find(t => t.id === contextMenu.traceId)?.ignoreClicks ? 'Enable Clicks' : 'Ignore Clicks'}
            </button>
            <div className="h-[1px] bg-gradient-to-r from-transparent via-gray-600 to-transparent my-1" />
            {/* Transformations submenu -- opens as a side flyout on hover,
                grouping the crop/rotate/flip resets that used to each take
                their own row in this menu. */}
            <div
              className="relative"
              onMouseEnter={openTransformFlyout}
              onMouseLeave={scheduleCloseTransformFlyout}
            >
              <button
                className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase"
              >
                <span className="flex items-center gap-3"><span className="text-gray-400 text-[10px]">◇</span> Transformations</span>
                <span className="text-gray-300 text-[9px]">▶</span>
              </button>
              {contextMenuTransformOpen && transformFlyoutRect && (
                <div
                  className="fixed w-max flex flex-col bg-black border border-gray-500 shadow-2xl py-1 z-[10000101]"
                  style={
                    contextMenuFlyoutOnLeft
                      ? { top: transformFlyoutRect.top, right: window.innerWidth - transformFlyoutRect.left + 1 }
                      : { top: transformFlyoutRect.top, left: transformFlyoutRect.right + 1 }
                  }
                  onMouseEnter={keepTransformFlyoutOpen}
                  onMouseLeave={scheduleCloseTransformFlyout}
                >
                  <button
                    className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
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
                    Reset Cropping
                  </button>
                  <button
                    className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
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
                    Reset Aspect Ratio
                  </button>
                  <button
                    className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                    onClick={async () => {
                      const trace = traces.find(t => t.id === contextMenu.traceId)
                      if (trace) {
                        updateTraceTransform(trace.id, { rotation: 0 })
                      }
                      setContextMenu(null)
                    }}
                  >
                    Reset Rotation
                  </button>
                  {(() => {
                    const trace = traces.find(t => t.id === contextMenu.traceId)
                    if (!trace || trace.type === 'audio' || trace.type === 'video') return null
                    return (
                      <>
                        <button
                          className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                          onClick={() => {
                            updateTraceCustomization(trace.id, { flipHorizontal: !trace.flipHorizontal })
                            setContextMenu(null)
                          }}
                        >
                          Flip Horizontal
                        </button>
                        <button
                          className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                          onClick={() => {
                            updateTraceCustomization(trace.id, { flipVertical: !trace.flipVertical })
                            setContextMenu(null)
                          }}
                        >
                          Flip Vertical
                        </button>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!isDesktop || !trace || trace.type !== 'embed' || !confirmedImageIds.has(trace.id)) return null
              return (
                <button
                  className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
                  onClick={async () => {
                    setContextMenu(null)
                    const result = await convertEmbedToInternalImage(trace.id)
                    if (!result.ok) {
                      alert(result.error || 'Failed to convert this embed to an image')
                    }
                  }}
                >
                  <span className="text-gray-400 text-[10px]">◇</span> Convert to Image
                </button>
              )
            })()}
            {/* Move Layer submenu -- same side-flyout pattern, groups the
                four z-order actions (one-step up/down, jump to top/bottom of
                this trace's group) that used to each take their own row. */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!trace) return null
              const groupSize = traces.filter(t => (t.layerId ?? null) === (trace.layerId ?? null)).length
              if (groupSize <= 1) return null
              return (
                <div
                  className="relative"
                  onMouseEnter={openMoveFlyout}
                  onMouseLeave={scheduleCloseMoveFlyout}
                >
                  <button
                    className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase"
                  >
                    <span className="flex items-center gap-3"><span className="text-gray-400 text-[10px]">◇</span> Move Layer</span>
                    <span className="text-gray-300 text-[9px]">▶</span>
                  </button>
                  {contextMenuMoveOpen && moveFlyoutRect && (
                    <div
                      className="fixed w-max flex flex-col bg-black border border-gray-500 shadow-2xl py-1 z-[10000101]"
                      style={
                        contextMenuFlyoutOnLeft
                          ? { top: moveFlyoutRect.top, right: window.innerWidth - moveFlyoutRect.left + 1 }
                          : { top: moveFlyoutRect.top, left: moveFlyoutRect.right + 1 }
                      }
                      onMouseEnter={keepMoveFlyoutOpen}
                      onMouseLeave={scheduleCloseMoveFlyout}
                    >
                      <button
                        className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => moveTraceOneStep(trace.id, 'up')}
                      >
                        Move Up
                      </button>
                      <button
                        className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => moveTraceOneStep(trace.id, 'down')}
                      >
                        Move Down
                      </button>
                      <button
                        className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => moveTraceToGroupEdge(trace.id, 'top')}
                      >
                        Move to Top of Group
                      </button>
                      <button
                        className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap"
                        onClick={() => moveTraceToGroupEdge(trace.id, 'bottom')}
                      >
                        Move to Bottom of Group
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
            {/* Move to Group -- reassigns the selected trace(s) to a layer
                group (or Ungrouped) without opening the Layer panel. */}
            {(() => {
              const trace = traces.find(t => t.id === contextMenu.traceId)
              if (!trace) return null
              const inMultiSelect = multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
              const targetIds = inMultiSelect ? Array.from(multiSelectedIds) : [contextMenu.traceId]
              const currentLayerId = inMultiSelect ? undefined : (trace.layerId ?? null)
              return (
                <div
                  className="relative"
                  onMouseEnter={openGroupFlyout}
                  onMouseLeave={scheduleCloseGroupFlyout}
                >
                  <button
                    className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center justify-between gap-3 text-[11px] tracking-wider uppercase"
                  >
                    <span className="flex items-center gap-3"><span className="text-gray-400 text-[10px]">◇</span> Move to Group</span>
                    <span className="text-gray-300 text-[9px]">▶</span>
                  </button>
                  {contextMenuGroupOpen && groupFlyoutRect && (
                    <div
                      className="fixed w-max flex flex-col bg-black border border-gray-500 shadow-2xl py-1 z-[10000101] max-h-[60vh] overflow-y-auto"
                      style={
                        contextMenuFlyoutOnLeft
                          ? { top: groupFlyoutRect.top, right: window.innerWidth - groupFlyoutRect.left + 1 }
                          : { top: groupFlyoutRect.top, left: groupFlyoutRect.right + 1 }
                      }
                      onMouseEnter={keepGroupFlyoutOpen}
                      onMouseLeave={scheduleCloseGroupFlyout}
                    >
                      <button
                        className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
                        disabled={currentLayerId === null}
                        onClick={() => { moveTracesToGroup(targetIds, null); setContextMenu(null) }}
                      >
                        {currentLayerId === null && <span className="text-emerald-400 text-[9px]">✓</span>}
                        Ungrouped
                      </button>
                      {groupLayers.length === 0 && (
                        <span className="px-4 py-2 text-gray-300 text-[10px] tracking-wider uppercase whitespace-nowrap">No groups yet</span>
                      )}
                      {groupLayers.map(layer => (
                        <button
                          key={layer.id}
                          className="px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors text-[11px] tracking-wider uppercase whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
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
            <div className="h-[1px] bg-gradient-to-r from-transparent via-gray-600 to-transparent my-1" />
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                duplicateTrace(contextMenu.traceId)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> Duplicate
            </button>
            <button
              className="w-full px-4 py-2 text-left text-red-400 hover:bg-red-900/30 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const inMultiSelect = multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
                deleteTraces(inMultiSelect ? Array.from(multiSelectedIds) : [contextMenu.traceId])
              }}
            >
              <span className="text-red-500 text-[10px]">◇</span>
              {multiSelectedIds.size > 1 && multiSelectedIds.has(contextMenu.traceId)
                ? `Delete Selected (${multiSelectedIds.size})`
                : 'Delete'}
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

      {/* Customization Dialog */}
      {editingTrace && canEdit && (
        <>
          <div
            className="customize-menu bg-nier-blackLight border border-nier-border/40 p-6 w-96 pointer-events-auto max-h-[90vh] overflow-y-auto relative"
            style={{
              position: 'fixed',
              right: '20px',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: MENU_PANEL_Z_INDEX
            }}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60 pointer-events-none" />
            
            <div className="flex items-center gap-3 mb-6">
              <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
              <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">Customize Trace</h2>
            </div>
            
            <div className="space-y-5">
              <div className="flex items-baseline gap-3 pt-1">
                <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">Content</span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              </div>

              {editingTrace.type === 'text' && (
                <div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Text Content</label>
                  <textarea
                    value={editingTrace.content ?? ''}
                    onChange={(e) => {
                      const updated = { ...editingTrace, content: e.target.value }
                      setEditingTrace(updated)
                    }}
                    onBlur={(e) => {
                      const effectiveFontSize = typeof editingTrace.fontSize === 'number'
                        ? editingTrace.fontSize
                        : (editingTrace.fontSize === 'small' ? 10 : editingTrace.fontSize === 'large' ? 14 : 12)
                      const effectiveFontFamilyKey = editingTrace.fontFamily ?? 'sans'
                      const effectiveFontFamily = resolveFontFamilyCss(effectiveFontFamilyKey)
                      const textSize = computeAutoFitTextSize(e.target.value, effectiveFontSize, { fontFamily: effectiveFontFamily })
                      updateTraceCustomization(editingTrace.id, { content: e.target.value, width: textSize.width, height: textSize.height })
                    }}
                    className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                    placeholder="Your message..."
                    rows={4}
                    maxLength={256}
                  />
                </div>
              )}

              {/* Embed Content Editor */}
              {editingTrace.type === 'embed' && (
                <>
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Embed URL or HTML</label>
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
                      placeholder="URL or <iframe src='...'></iframe>"
                      rows={4}
                    />
                    <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                      Direct URL or full embed code
                    </p>
                  </div>

                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Description / Title</label>
                    <textarea
                      value={editingTrace.content ?? ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, content: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { content: e.target.value })
                      }}
                      className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                      placeholder="Optional description..."
                      rows={3}
                      maxLength={256}
                    />
                  </div>

                </>
              )}

              {/* Description/Caption for Media Traces */}
              {(editingTrace.type === 'image' || editingTrace.type === 'audio' || editingTrace.type === 'video') && (
                <div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Description / Caption</label>
                  <textarea
                    value={editingTrace.content ?? ''}
                    onChange={(e) => {
                      const updated = { ...editingTrace, content: e.target.value }
                      setEditingTrace(updated)
                    }}
                    onBlur={(e) => {
                      updateTraceCustomization(editingTrace.id, { content: e.target.value })
                    }}
                    className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                    placeholder="Optional description..."
                    rows={3}
                    maxLength={256}
                  />
                </div>
              )}

              {/* Shape Label */}
              {editingTrace.type === 'shape' && (
                <div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Label (optional)</label>
                  <input
                    type="text"
                    value={editingTrace.content || ''}
                    onChange={(e) => {
                      const updated = { ...editingTrace, content: e.target.value }
                      setEditingTrace(updated)
                    }}
                    onBlur={(e) => {
                      updateTraceCustomization(editingTrace.id, { content: e.target.value })
                    }}
                    placeholder="Shape label..."
                    maxLength={50}
                    className="w-full px-3 py-2 bg-nier-black border border-nier-border/30 text-nier-bg placeholder-nier-bg/50 focus:outline-none focus:border-nier-border/60 transition-colors font-mono text-sm"
                  />
                </div>
              )}

              {/* Clickable -- text, embed and shape only. Image, audio and
                  video already do something of their own on click (open the
                  viewer, play), and a second competing action there would be
                  ambiguous.

                  Placed above the toggle group below rather than inside it,
                  because that group is hidden for shapes -- which are one of
                  the three types this applies to. */}
              {(editingTrace.type === 'text' || editingTrace.type === 'embed' || editingTrace.type === 'shape') && (
                <div className="space-y-3">
                  <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                    <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.isClickable ?? false ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                      {(editingTrace.isClickable ?? false) && <span className="text-nier-bg text-[10px]">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      checked={editingTrace.isClickable ?? false}
                      onChange={(e) => {
                        const updated = { ...editingTrace, isClickable: e.target.checked }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { isClickable: e.target.checked })
                      }}
                      className="hidden"
                    />
                    <span className="tracking-[0.1em] uppercase text-xs text-nier-strong" title="Left-clicking this trace opens the link below">Clickable</span>
                  </label>

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
                          Needs to be a full http:// or https:// address.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Font Settings for Text Traces */}
              {editingTrace.type === 'text' && (
                <>

                  <div className="flex items-baseline gap-3 pt-1">
                    <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">Text</span>
                    <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                  </div>

                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Font Family</label>
                    <select
                      value={editingTrace.fontFamily ?? 'sans'}
                      onChange={e => {
                        const effectiveFontSize = typeof editingTrace.fontSize === 'number'
                          ? editingTrace.fontSize
                          : (editingTrace.fontSize === 'small' ? 10 : editingTrace.fontSize === 'large' ? 14 : 12)
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

                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Font Size (px)</label>
                    <input
                      type="number"
                      min={8}
                      max={200}
                      value={typeof editingTrace.fontSize === 'number' ? editingTrace.fontSize : (editingTrace.fontSize === 'small' ? 12 : editingTrace.fontSize === 'large' ? 24 : 16)}
                      onChange={e => {
                        const value = parseInt(e.target.value) || 16;
                        const effectiveFontFamilyKey = editingTrace.fontFamily ?? 'sans'
                        const effectiveFontFamily = resolveFontFamilyCss(effectiveFontFamilyKey)
                        const textSize = computeAutoFitTextSize(editingTrace.content ?? '', value, { fontFamily: effectiveFontFamily })
                        const updated = { ...editingTrace, fontSize: value, width: textSize.width, height: textSize.height };
                        setEditingTrace(updated);
                        // Update trace in store for live preview and mark as pending
                        const trace = traces.find(t => t.id === editingTrace.id);
                        if (trace) {
                          addTrace({ ...trace, fontSize: value, width: textSize.width, height: textSize.height });
                          markTraceChanged(editingTrace.id);
                        }
                      }}
                      className="w-full bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                      placeholder="Font size in px"
                    />
                  </div>

                  {/* Text Sizing -- whether the font follows the trace's own
                      scale, or stays fixed and lets the box only control
                      how much room the text has to reflow in. */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Text Sizing</label>
                    <div className="flex gap-2">
                      {([
                        { value: true, label: 'Scales With Box' },
                        { value: false, label: 'Fixed Size' },
                      ] as const).map(({ value, label }) => (
                        <button
                          key={String(value)}
                          onClick={() => {
                            const updated = { ...editingTrace, textScaleWithBox: value };
                            setEditingTrace(updated);
                            updateTraceCustomization(editingTrace.id, { textScaleWithBox: value });
                          }}
                          className={`flex-1 px-2 py-2 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
                            (editingTrace.textScaleWithBox ?? true) === value
                              ? 'bg-nier-bg text-nier-black border-nier-bg'
                              : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[0.7rem] text-nier-bg/55 leading-relaxed tracking-wide mt-1.5">
                      Fixed keeps the font size when you resize the trace — the text just reflows.
                    </p>
                  </div>

                  {/* Text Formatting */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Text Style</label>
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
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Text Alignment</label>
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

                  {/* Text Color */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Text Color</label>
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
                        title="Reset to white"
                      >
                        ↺
                      </button>
                    </div>
                  </div>

                </>
              )}
              {/* Shape Customization */}
              {editingTrace.type === 'shape' && (
                <div className="space-y-4">

                  <div className="flex items-baseline gap-3 pt-1">
                    <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">Shape</span>
                    <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                  </div>

                  {/* Shape Type */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Shape Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['rectangle', 'circle', 'triangle', 'path'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, shapeType: type }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeType: type })
                          }}
                          className={`px-3 py-2 text-[10px] tracking-wider uppercase font-mono transition-all border ${
                            (editingTrace.shapeType || 'rectangle') === type
                              ? 'bg-nier-bg text-nier-black border-nier-bg'
                              : 'bg-transparent text-nier-bg/80 border-nier-border/30 hover:border-nier-border/60 hover:text-nier-bg'
                          }`}
                        >
                          {type === 'rectangle' && '⬛ '}
                          {type === 'circle' && '⚫ '}
                          {type === 'triangle' && '▲ '}
                          {type === 'path' && '〰 '}
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Corner Radius (Rectangle and Triangle only -- circles have no corners, paths use point editing) */}
                  {((editingTrace.shapeType || 'rectangle') === 'rectangle' || editingTrace.shapeType === 'triangle') && (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                        Corner Radius: {editingTrace.cornerRadius || 0}px
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={editingTrace.cornerRadius || 0}
                        onChange={(e) => {
                          const value = parseInt(e.target.value)
                          const updated = { ...editingTrace, cornerRadius: value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { cornerRadius: value })
                        }}
                        className="w-full accent-nier-bg"
                      />
                      <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                        Rounds the corners of the shape
                      </p>
                    </div>
                  )}

                  {/* Path Thickness Control */}
                  {editingTrace.shapeType === 'path' && (
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                      Path Thickness: {editingTrace.shapeOutlineWidth ?? 2}px
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="1"
                      value={editingTrace.shapeOutlineWidth ?? 2}
                      onChange={(e) => {
                        const value = parseInt(e.target.value)
                        const updated = { ...editingTrace, shapeOutlineWidth: value }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { shapeOutlineWidth: value })
                      }}
                      className="w-full accent-nier-bg"
                    />
                    <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                      Adjust the thickness of the path
                    </p>
                  </div>
                  )}

                  {/* Path Point Editing */}
                  {editingTrace.shapeType === 'path' && (
                  <>
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Path Style</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['straight', 'bezier'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, pathCurveType: type }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { pathCurveType: type })
                          }}
                          className={`px-3 py-2 text-[10px] tracking-wider uppercase font-mono transition-all border ${
                            (editingTrace.pathCurveType || 'straight') === type
                              ? 'bg-nier-bg text-nier-black border-nier-bg'
                              : 'bg-transparent text-nier-bg/80 border-nier-border/30 hover:border-nier-border/60 hover:text-nier-bg'
                          }`}
                        >
                          {type === 'straight' && '━ Straight'}
                          {type === 'bezier' && '〰 Curved'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Arrow Start */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Arrow Start</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['none', 'triangle', 'diamond'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, pathArrowStart: type }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { pathArrowStart: type })
                          }}
                          className={`px-2 py-2 text-[10px] tracking-wider uppercase font-mono transition-all border ${
                            (editingTrace.pathArrowStart || 'none') === type
                              ? 'bg-nier-bg text-nier-black border-nier-bg'
                              : 'bg-transparent text-nier-bg/80 border-nier-border/30 hover:border-nier-border/60 hover:text-nier-bg'
                          }`}
                        >
                          {type === 'none' && '— None'}
                          {type === 'triangle' && '◄ Arrow'}
                          {type === 'diamond' && '◆ Diamond'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Arrow End */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Arrow End</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['none', 'triangle', 'diamond'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, pathArrowEnd: type }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { pathArrowEnd: type })
                          }}
                          className={`px-2 py-2 text-[10px] tracking-wider uppercase font-mono transition-all border ${
                            (editingTrace.pathArrowEnd || 'none') === type
                              ? 'bg-nier-bg text-nier-black border-nier-bg'
                              : 'bg-transparent text-nier-bg/80 border-nier-border/30 hover:border-nier-border/60 hover:text-nier-bg'
                          }`}
                        >
                          {type === 'none' && '— None'}
                          {type === 'triangle' && '► Arrow'}
                          {type === 'diamond' && '◆ Diamond'}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                      Path Points ({(editingTrace.shapePoints || []).length})
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPathCreationMode(!pathCreationMode)
                        }}
                        className={`flex-1 px-4 py-2 font-mono text-[10px] tracking-wider uppercase transition-all border ${
                          pathCreationMode
                            ? 'bg-nier-bg text-nier-black border-nier-bg'
                            : 'bg-transparent text-white border-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {pathCreationMode ? '✓ Done Adding' : '+ Add Points'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const currentPoints = editingTrace.shapePoints || []
                          if (currentPoints.length > 2) {
                            const newPoints = currentPoints.slice(0, -1)
                            const updated = { ...editingTrace, shapePoints: newPoints }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapePoints: newPoints })
                          }
                        }}
                        className="px-4 py-2 bg-red-600/80 text-white font-mono text-[10px] tracking-wider uppercase hover:bg-red-600 transition-all border border-red-600"
                      >
                        Remove
                      </button>
                    </div>
                    <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                      {pathCreationMode 
                        ? 'Click anywhere on the canvas to add points to your path' 
                        : 'Click "Add Points" to start adding points, or drag existing points to adjust'}
                    </p>
                  </div>
                  </>
                  )}

                  <div className="flex items-baseline gap-3 pt-1">
                    <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">Colour</span>
                    <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                  </div>

                  {/* Color Picker */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Fill Color</label>
                    
                    {/* Color preset palette */}
                    <div className="grid grid-cols-8 gap-1.5 mb-3">
                      {['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
                        '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
                        '#f43f5e', '#ffffff', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#000000'].map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, shapeColor: color }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeColor: color })
                          }}
                          className="w-7 h-7 border border-nier-border/30 hover:border-nier-border/60 transition-all hover:scale-110"
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                    
                    <div className="flex gap-2 items-center">
                      {/* Eyedropper button */}
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          
                          if (!hasEyeDropperSupport) {
                            alert('The color picker tool is not supported in this browser.\n\nPlease use Chrome, Edge, or another Chromium-based browser to use this feature.')
                            return
                          }
                          
                          try {
                            const eyeDropper = new (window as any).EyeDropper()
                            const result = await eyeDropper.open()
                            const color = result.sRGBHex
                            const updated = { ...editingTrace, shapeColor: color }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeColor: color })
                          } catch (err) {
                            // User cancelled or error - silently ignore
                          }
                        }}
                        className="p-2 border transition-all bg-nier-black border-nier-border/30 text-nier-bg hover:border-nier-border/60"
                        title="Pick color from screen"
                      >
                        💧
                      </button>
                      
                      <input
                        type="color"
                        value={editingTrace.shapeColor || '#3b82f6'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeColor: e.target.value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { shapeColor: e.target.value })
                        }}
                        className="w-14 h-9 cursor-pointer bg-nier-black border border-nier-border/30"
                      />
                      <input
                        type="text"
                        value={editingTrace.shapeColor || '#3b82f6'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeColor: e.target.value }
                          setEditingTrace(updated)
                        }}
                        onBlur={(e) => {
                          updateTraceCustomization(editingTrace.id, { shapeColor: e.target.value })
                        }}
                        placeholder="#3b82f6"
                        className="flex-1 px-3 py-2 bg-nier-black border border-nier-border/30 text-nier-bg placeholder-nier-bg/50 focus:outline-none focus:border-nier-border/60 transition-colors font-mono text-sm"
                      />
                    </div>
                  </div>

                  {/* Fill Opacity Slider -- outline has its own opacity, see
                      the Outline Opacity slider further down */}
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                      Fill Opacity: {((editingTrace.shapeOpacity ?? 1.0) * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={editingTrace.shapeOpacity ?? 1.0}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value)
                        const updated = { ...editingTrace, shapeOpacity: value }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { shapeOpacity: value })
                      }}
                      className="w-full accent-nier-bg"
                    />
                  </div>

                  {/* Fill Options -- outline is configured further down, in
                      the "Outline Mode" section that also gates outline
                      width (a "Show Outline" toggle used to be duplicated
                      here too, bound to the same shapeOutlineOnly state) */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.shapeNoFill ?? false ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                        {(editingTrace.shapeNoFill ?? false) && <span className="text-nier-bg text-[10px]">✓</span>}
                      </div>
                      <input
                        type="checkbox"
                        checked={editingTrace.shapeNoFill ?? false}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeNoFill: e.target.checked }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { shapeNoFill: e.target.checked })
                        }}
                        className="hidden"
                      />
                      <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">No Fill</span>
                    </label>
                  </div>

                  {/* Outline Mode (hidden for path as it's always outline) */}
                  {editingTrace.shapeType !== 'path' && (
                  <div>
                    <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer mb-2 group">
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.shapeOutlineOnly ?? false ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                        {(editingTrace.shapeOutlineOnly ?? false) && <span className="text-nier-bg text-[10px]">✓</span>}
                      </div>
                      <input
                        type="checkbox"
                        checked={editingTrace.shapeOutlineOnly ?? false}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeOutlineOnly: e.target.checked }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { shapeOutlineOnly: e.target.checked })
                        }}
                        className="hidden"
                      />
                      <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Outline</span>
                    </label>
                    
                    {editingTrace.shapeOutlineOnly && (
                      <div className="ml-6">
                        <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                          Outline Width: {editingTrace.shapeOutlineWidth ?? 2}px
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="20"
                          step="1"
                          value={editingTrace.shapeOutlineWidth ?? 2}
                          onChange={(e) => {
                            const value = parseInt(e.target.value)
                            const updated = { ...editingTrace, shapeOutlineWidth: value }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeOutlineWidth: value })
                          }}
                          className="w-full"
                        />
                        <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                          Adjust the thickness of the outline
                        </p>

                        <label className="block text-nier-bg/80 text-[10px] tracking-[0.15em] uppercase mb-2 mt-3">
                          Outline Opacity: {((editingTrace.shapeOutlineOpacity ?? 1.0) * 100).toFixed(0)}%
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="1"
                          step="0.01"
                          value={editingTrace.shapeOutlineOpacity ?? 1.0}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value)
                            const updated = { ...editingTrace, shapeOutlineOpacity: value }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeOutlineOpacity: value })
                          }}
                          className="w-full accent-nier-bg"
                        />
                      </div>
                    )}
                  </div>
                  )}

                  {/* Outline Color (only show if outline is enabled) */}
                  {editingTrace.shapeOutlineOnly && (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Outline Color</label>
                      
                      {/* Color preset palette */}
                      <div className="grid grid-cols-8 gap-1.5 mb-3">
                        {['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
                          '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
                          '#f43f5e', '#ffffff', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#000000'].map(color => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => {
                              const updated = { ...editingTrace, shapeOutlineColor: color }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { shapeOutlineColor: color })
                            }}
                            className="w-7 h-7 border border-nier-border/30 hover:border-nier-border/60 transition-all hover:scale-110"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                      
                      <div className="flex gap-2 items-center">
                        {/* Eyedropper button */}
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            
                            if (!hasEyeDropperSupport) {
                              alert('The color picker tool is not supported in this browser.\n\nPlease use Chrome, Edge, or another Chromium-based browser to use this feature.')
                              return
                            }
                            
                            try {
                              const eyeDropper = new (window as any).EyeDropper()
                              const result = await eyeDropper.open()
                              const color = result.sRGBHex
                              const updated = { ...editingTrace, shapeOutlineColor: color }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { shapeOutlineColor: color })
                            } catch (err) {
                              // User cancelled or error - silently ignore
                            }
                          }}
                          className="p-2 border transition-all bg-nier-black border-nier-border/30 text-nier-bg hover:border-nier-border/60"
                          title="Pick color from screen"
                        >
                          💧
                        </button>
                        
                        <input
                          type="color"
                          value={editingTrace.shapeOutlineColor || editingTrace.shapeColor || '#3b82f6'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, shapeOutlineColor: e.target.value }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeOutlineColor: e.target.value })
                          }}
                          className="w-14 h-9 cursor-pointer bg-nier-black border border-nier-border/30"
                        />
                        <input
                          type="text"
                          value={editingTrace.shapeOutlineColor || editingTrace.shapeColor || '#3b82f6'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, shapeOutlineColor: e.target.value }
                            setEditingTrace(updated)
                          }}
                          onBlur={(e) => {
                            updateTraceCustomization(editingTrace.id, { shapeOutlineColor: e.target.value })
                          }}
                          placeholder="#3b82f6"
                          className="flex-1 px-3 py-2 bg-nier-black border border-nier-border/30 text-nier-bg placeholder-nier-bg/50 focus:outline-none focus:border-nier-border/60 transition-colors font-mono text-sm"
                        />
                      </div>
                    </div>
                  )}

                </div>
              )}
              {/* Border & Fill Color Controls (for text and embed traces) */}
              {(editingTrace.type === 'text' || editingTrace.type === 'embed' || editingTrace.type === 'image' || editingTrace.type === 'document') && (
                <>

                  <div className="flex items-baseline gap-3 pt-1">
                    <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">Colour</span>
                    <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                  </div>

                  {/* NieR Presets */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-nier-bg/55 text-[0.7rem] tracking-[0.1em] uppercase">Quick Presets</span>
                      <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/20 to-transparent" />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {TRACE_PRESETS.map(preset => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => {
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
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Border Color & Opacity */}
                  {(editingTrace.showBorder ?? true) && (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Border Color</label>
                      <div className="flex gap-2 items-center mb-2">
                        <input
                          type="color"
                          value={editingTrace.borderColor || getBorderColor(editingTrace.type)}
                          onChange={(e) => {
                            const updated = { ...editingTrace, borderColor: e.target.value };
                            setEditingTrace(updated);
                            updateTraceCustomization(editingTrace.id, { borderColor: e.target.value });
                          }}
                          className="w-10 h-10 border border-nier-border/30 cursor-pointer bg-nier-black"
                        />
                        <input
                          type="text"
                          value={editingTrace.borderColor || getBorderColor(editingTrace.type)}
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
                          title="Reset to default"
                        >
                          ↺
                        </button>
                      </div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">
                        Border Opacity: {Math.round((editingTrace.borderOpacity ?? 1) * 100)}%
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

                  {/* Fill Color & Opacity */}
                  {(editingTrace.showBackground ?? true) && (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Fill Color</label>
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
                          title="Reset to default"
                        >
                          ↺
                        </button>
                      </div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">
                        Fill Opacity: {Math.round((editingTrace.fillOpacity ?? 0.95) * 100)}%
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
              {editingTrace.type !== 'shape' && (
                <div className="flex items-baseline gap-3 pt-1">
                  <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">Frame</span>
                  <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                </div>
              )}

              {/* Toggle Options -- shapes have their own dedicated Show
                  Outline/No Fill controls further down (and are created with
                  these generic wrapper toggles off by default), so showing
                  both here read as duplicated "no fill" controls */}
              {editingTrace.type !== 'shape' && (
              <div className="space-y-3">
                <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showBorder ?? true ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                    {(editingTrace.showBorder ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showBorder ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showBorder: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showBorder: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Border</span>
                </label>

                <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showBackground ?? true ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                    {(editingTrace.showBackground ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showBackground ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showBackground: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showBackground: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Background</span>
                </label>

                <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showFilename ?? true ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                    {(editingTrace.showFilename ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showFilename ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showFilename: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showFilename: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Username</span>
                </label>

                <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showDescription ?? false ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                    {(editingTrace.showDescription ?? false) && <span className="text-nier-bg text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showDescription ?? false}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showDescription: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showDescription: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Description</span>
                </label>

                <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showShadow ?? true ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                    {(editingTrace.showShadow ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showShadow ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showShadow: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showShadow: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-[0.1em] uppercase text-xs text-nier-strong" title="Soft drop shadow under the trace. Needs Show Background on to be visible.">Soft Shadow</span>
                </label>

                {/* Embed-only, but grouped with the other toggles rather than
                    left further down in the embed section. */}
                {editingTrace.type === 'embed' && (
                  <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                    <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.enableInteraction ?? false ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                      {(editingTrace.enableInteraction ?? false) && <span className="text-nier-bg text-[10px]">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      checked={editingTrace.enableInteraction ?? false}
                      onChange={(e) => {
                        const updated = { ...editingTrace, enableInteraction: e.target.checked }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { enableInteraction: e.target.checked })
                      }}
                      className="hidden"
                    />
                    <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Enable Interaction</span>
                  </label>
                )}

              </div>
              )}

              {/* Border thickness. Its own block above the colour controls so
                  it also reaches PDF traces, where a frame is what separates a
                  white page from a light background. */}
              {(editingTrace.type === 'text' || editingTrace.type === 'embed' || editingTrace.type === 'image' || editingTrace.type === 'document') && (editingTrace.showBorder ?? true) && (
                <div>
                  <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-2">
                    Border Thickness: {editingTrace.borderWidth ?? 2}px
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

              {/* Border Radius Customization (for non-shape traces) */}
              {editingTrace.type !== 'shape' && (
                <div>
                  <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                    Border Radius: {editingTrace.borderRadius ?? 0}px
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
                    Adjust the roundness of trace borders (0 = sharp corners)
                  </p>
                </div>
              )}

              {/* Lighting Controls -- paths get a much simpler "glow along the
                  line" version instead: a radial point-light with a
                  radius/offset doesn't make sense for an elongated line, so
                  those (and pulsing) are hidden for them, reusing the same
                  illuminate/lightColor/lightIntensity fields for the glow
                  rendered in renderPathSvg instead. */}
              {(() => {
                const isPathTrace = editingTrace.shapeType === 'path'
                return (
              <div>
                <div className="flex items-baseline gap-3 pt-1 mb-4">
                  <span className="text-nier-strong text-xs tracking-[0.22em] uppercase">{isPathTrace ? 'Glow' : 'Light'}</span>
                  <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                </div>

                <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer mb-3 group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.illuminate ?? false ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                    {(editingTrace.illuminate ?? false) && <span className="text-nier-bg text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.illuminate ?? false}
                    onChange={(e) => {
                      const updated = { ...editingTrace, illuminate: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { illuminate: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">{isPathTrace ? 'Enable Glow' : 'Enable Light Emission'}</span>
                </label>

                {editingTrace.illuminate && (
                  <div className="space-y-3 ml-6">
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">{isPathTrace ? 'Glow Color' : 'Light Color'}</label>
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

                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                        Intensity: {(editingTrace.lightIntensity ?? 1.0).toFixed(1)}x
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
                        Radius: {editingTrace.lightRadius ?? 200}px
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
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Light Position Offset</label>
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
                        Adjust light source position relative to trace center
                      </p>
                    </div>
                    )}

                    {!isPathTrace && (
                    <div>
                      <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer mb-2 group">
                        <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.lightPulse ?? false ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                          {(editingTrace.lightPulse ?? false) && <span className="text-nier-bg text-[10px]">✓</span>}
                        </div>
                        <input
                          type="checkbox"
                          checked={editingTrace.lightPulse ?? false}
                          onChange={(e) => {
                            const updated = { ...editingTrace, lightPulse: e.target.checked }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { lightPulse: e.target.checked })
                          }}
                          className="hidden"
                        />
                        <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Enable Pulsing/Flickering</span>
                      </label>

                      {editingTrace.lightPulse && (
                        <div className="ml-6">
                          <label className="block text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mb-1">
                            Pulse Speed: {editingTrace.lightPulseSpeed ?? 2.0}s per cycle
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
                            Lower = faster pulse, Higher = slower pulse
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

              <button
                onClick={() => {
                  // Mark as pending if there were any changes
                  if (editingTrace) {
                    markTraceChanged(editingTrace.id);
                  }
                  setEditingTrace(null);
                }}
                className="w-full bg-nier-bg text-nier-black font-mono text-[11px] tracking-[0.15em] uppercase py-2.5 px-4 hover:bg-nier-bgDark transition-all border border-nier-bg mt-4"
              >
                Done
              </button>
            </div>
          </div>

          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-transparent pointer-events-auto"
            style={{ zIndex: MENU_BACKDROP_Z_INDEX }}
            onClick={() => setEditingTrace(null)}
          />
        </>
      )}

      {/* Batch Edit panel: shared border/background properties applied to every
          trace in multiSelectedIds at once. Reads its displayed values from
          whichever selected trace happens to be `traces.find`'s first match --
          there's no per-field "mixed values" indicator, changing a control
          just overwrites that field on every selected trace immediately. */}
      {showBatchEditPanel && multiSelectedIds.size > 1 && canEdit && (() => {
        const batchIds = Array.from(multiSelectedIds)
        const seedTrace = traces.find(t => t.id === selectedTraceId && multiSelectedIds.has(t.id))
          || traces.find(t => multiSelectedIds.has(t.id))
        if (!seedTrace) return null

        return (
          <>
            <div
              className="customize-menu bg-nier-blackLight border border-nier-border/40 p-6 w-96 pointer-events-auto max-h-[90vh] overflow-y-auto relative"
              style={{
                position: 'fixed',
                right: '20px',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: MENU_PANEL_Z_INDEX
              }}
            >
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60 pointer-events-none" />
              <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60 pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60 pointer-events-none" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60 pointer-events-none" />

              <div className="flex items-center gap-3 mb-6">
                <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
                <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">Batch Edit ({batchIds.length})</h2>
              </div>

              <div className="space-y-5">
                {/* The presets, at the top, because a preset is the fastest
                    answer to "make these look alike" and that is most of what
                    anybody selects a dozen traces to do. It also sets the
                    atrium's house style, exactly as choosing one on a single
                    trace does -- the point of a preset is that it holds. */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-nier-bg/75 text-[11px] tracking-[0.15em] uppercase">Quick Presets</span>
                    <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/20 to-transparent" />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {TRACE_PRESETS.map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          updateTraceCustomizationForMany(batchIds, {
                            borderColor: preset.border,
                            fillColor: preset.fill,
                            showBorder: true,
                            showBackground: true,
                            fontFamily: 'mono',
                            ...(preset.text ? { textColor: preset.text } : {}),
                          })
                          if (lobbyId) rememberTracePreset(lobbyId, preset.id)
                        }}
                        className="px-2 py-1.5 bg-nier-black border border-nier-border/30 text-nier-bg/80 text-[11px] tracking-[0.12em] uppercase hover:border-nier-border/60 hover:text-nier-strong transition-colors"
                        style={{ borderLeftColor: preset.border, borderLeftWidth: '2px' }}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Toggle Options */}
                <div className="space-y-3">
                  <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                    <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${seedTrace.showBorder ?? true ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                      {(seedTrace.showBorder ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      checked={seedTrace.showBorder ?? true}
                      onChange={(e) => updateTraceCustomizationForMany(batchIds, { showBorder: e.target.checked })}
                      className="hidden"
                    />
                    <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Border</span>
                  </label>

                  <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                    <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${seedTrace.showBackground ?? true ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                      {(seedTrace.showBackground ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      checked={seedTrace.showBackground ?? true}
                      onChange={(e) => updateTraceCustomizationForMany(batchIds, { showBackground: e.target.checked })}
                      className="hidden"
                    />
                    <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Background</span>
                  </label>

                  <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                    <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${seedTrace.showFilename ?? true ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                      {(seedTrace.showFilename ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      checked={seedTrace.showFilename ?? true}
                      onChange={(e) => updateTraceCustomizationForMany(batchIds, { showFilename: e.target.checked })}
                      className="hidden"
                    />
                    <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Username</span>
                  </label>

                  <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                    <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${seedTrace.showDescription ?? false ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                      {(seedTrace.showDescription ?? false) && <span className="text-nier-bg text-[10px]">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      checked={seedTrace.showDescription ?? false}
                      onChange={(e) => updateTraceCustomizationForMany(batchIds, { showDescription: e.target.checked })}
                      className="hidden"
                    />
                    <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Show Description</span>
                  </label>

                  <label className="flex items-center gap-3 text-nier-bg/80 text-xs cursor-pointer group">
                    <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${seedTrace.showShadow ?? true ? 'border-nier-bg bg-nier-bg/20' : 'border-nier-border/30 group-hover:border-nier-border/60'}`}>
                      {(seedTrace.showShadow ?? true) && <span className="text-nier-bg text-[10px]">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      checked={seedTrace.showShadow ?? true}
                      onChange={(e) => updateTraceCustomizationForMany(batchIds, { showShadow: e.target.checked })}
                      className="hidden"
                    />
                    <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Soft Shadow</span>
                  </label>
                </div>

                {/* Text Sizing -- gated like Border Radius below: shown as long
                    as ANY selected trace is text, not just the seed. */}
                {(() => {
                  const textSeed = batchIds
                    .map(id => traces.find(t => t.id === id))
                    .find((t): t is Trace => !!t && t.type === 'text')
                  if (!textSeed) return null
                  return (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Text Sizing</label>
                      <div className="flex gap-2">
                        {([
                          { value: true, label: 'Scales With Box' },
                          { value: false, label: 'Fixed Size' },
                        ] as const).map(({ value, label }) => (
                          <button
                            key={String(value)}
                            onClick={() => updateTraceCustomizationForMany(batchIds, { textScaleWithBox: value })}
                            className={`flex-1 px-2 py-2 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
                              (textSeed.textScaleWithBox ?? true) === value
                                ? 'bg-nier-bg text-nier-black border-nier-bg'
                                : 'bg-nier-black text-nier-bg border-nier-border/30 hover:border-nier-border/60'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* Border Color & Opacity */}
                {(seedTrace.showBorder ?? true) && (
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Border Color</label>
                    <div className="flex gap-2 items-center mb-2">
                      <input
                        type="color"
                        value={seedTrace.borderColor || getBorderColor(seedTrace.type)}
                        onChange={(e) => updateTraceCustomizationForMany(batchIds, { borderColor: e.target.value })}
                        className="w-10 h-10 border border-nier-border/30 cursor-pointer bg-nier-black"
                      />
                      <input
                        type="text"
                        defaultValue={seedTrace.borderColor || getBorderColor(seedTrace.type)}
                        onBlur={(e) => updateTraceCustomizationForMany(batchIds, { borderColor: e.target.value })}
                        className="flex-1 bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                        placeholder="#ffffff"
                      />
                      <button
                        onClick={() => updateTraceCustomizationForMany(batchIds, { borderColor: undefined })}
                        className="px-3 py-2 bg-nier-black text-nier-bg border border-nier-border/30 hover:border-nier-border/60 text-xs"
                        title="Reset to default"
                      >
                        ↺
                      </button>
                    </div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">
                      Border Opacity: {Math.round((seedTrace.borderOpacity ?? 1) * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round((seedTrace.borderOpacity ?? 1) * 100)}
                      onChange={(e) => updateTraceCustomizationForMany(batchIds, { borderOpacity: parseInt(e.target.value) / 100 })}
                      className="w-full accent-nier-bg"
                    />
                  </div>
                )}

                {/* Fill Color & Opacity */}
                {(seedTrace.showBackground ?? true) && (
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">Fill Color</label>
                    <div className="flex gap-2 items-center mb-2">
                      <input
                        type="color"
                        value={seedTrace.fillColor || '#1a1a2e'}
                        onChange={(e) => updateTraceCustomizationForMany(batchIds, { fillColor: e.target.value })}
                        className="w-10 h-10 border border-nier-border/30 cursor-pointer bg-nier-black"
                      />
                      <input
                        type="text"
                        defaultValue={seedTrace.fillColor || '#1a1a2e'}
                        onBlur={(e) => updateTraceCustomizationForMany(batchIds, { fillColor: e.target.value })}
                        className="flex-1 bg-nier-black text-nier-bg border border-nier-border/30 px-3 py-2 font-mono text-sm focus:outline-none focus:border-nier-border/60"
                        placeholder="#1a1a2e"
                      />
                      <button
                        onClick={() => updateTraceCustomizationForMany(batchIds, { fillColor: undefined })}
                        className="px-3 py-2 bg-nier-black text-nier-bg border border-nier-border/30 hover:border-nier-border/60 text-xs"
                        title="Reset to default"
                      >
                        ↺
                      </button>
                    </div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-1">
                      Fill Opacity: {Math.round((seedTrace.fillOpacity ?? 0.95) * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round((seedTrace.fillOpacity ?? 0.95) * 100)}
                      onChange={(e) => updateTraceCustomizationForMany(batchIds, { fillOpacity: parseInt(e.target.value) / 100 })}
                      className="w-full accent-nier-bg"
                    />
                  </div>
                )}

                {/* Border Radius (non-shape traces -- shapes use their own
                    Corner Radius control instead). Shown as long as ANY
                    trace in the selection is non-shape -- gating on just
                    seedTrace's own type hid this for the whole batch
                    whenever the seed happened to be a shape, even with
                    other, eligible traces also selected. */}
                {(() => {
                  const nonShapeSeed = batchIds
                    .map(id => traces.find(t => t.id === id))
                    .find((t): t is Trace => !!t && t.type !== 'shape')
                  if (!nonShapeSeed) return null
                  return (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                        Border Radius: {nonShapeSeed.borderRadius ?? 0}px
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="50"
                        step="1"
                        value={nonShapeSeed.borderRadius ?? 0}
                        onChange={(e) => updateTraceCustomizationForMany(batchIds, { borderRadius: parseInt(e.target.value) })}
                        className="w-full accent-nier-bg"
                      />
                    </div>
                  )
                })()}
              </div>

              <button
                onClick={() => {
                  batchIds.forEach(id => markTraceChanged(id))
                  setShowBatchEditPanel(false)
                }}
                className="w-full bg-nier-bg text-nier-black font-mono text-[11px] tracking-[0.15em] uppercase py-2.5 px-4 hover:bg-nier-bgDark transition-all border border-nier-bg mt-4"
              >
                Done
              </button>
            </div>

            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-transparent pointer-events-auto"
              style={{ zIndex: MENU_BACKDROP_Z_INDEX }}
              onClick={() => setShowBatchEditPanel(false)}
            />
          </>
        )
      })()}

      {/* Full view modal (also the text-trace preview) */}
      {modalTrace && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[10000100] pointer-events-auto"
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
                ? "bg-gray-900 border p-6 flex flex-col relative overflow-hidden"
                : "bg-gray-900 border p-6 max-w-3xl max-h-[80vh] overflow-auto relative"
            }
            style={{ borderColor: getBorderColor(modalTrace.type) }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-gray-500 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-gray-500 pointer-events-none" />
            
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rotate-45 border border-gray-500" />
                <h2 className="text-white text-sm tracking-[0.15em] uppercase font-mono">
                  {modalTrace.type === 'text' && 'Text Trace'}
                  {modalTrace.type === 'image' && 'Image Trace'}
                  {modalTrace.type === 'audio' && 'Audio Trace'}
                  {modalTrace.type === 'video' && 'Video Trace'}
                  {modalTrace.type === 'embed' && 'Embedded Content'}
                  {modalTrace.type === 'document' && 'Document'}
                </h2>
              </div>
              <button
                onClick={() => setModalTrace(null)}
                className="text-gray-400 hover:text-white text-lg transition-colors"
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
                      {src ? (
                        <img src={src} alt="" style={{ maxHeight, maxWidth: modalViewportSize.width * 0.9 }} />
                      ) : (
                        <span className="text-black/40 text-xs tracking-wider uppercase px-12 py-24">
                          {documentError[modalTrace.id] ?? 'Rendering…'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        className="text-gray-300 hover:text-white text-lg px-3 py-1 border border-gray-600 hover:border-gray-400 transition-colors disabled:text-gray-700 disabled:border-gray-800 disabled:cursor-not-allowed"
                        disabled={page <= 1}
                        onClick={() => setDocumentPage(prev => ({ ...prev, [modalTrace.id]: Math.max(1, (prev[modalTrace.id] ?? 1) - 1) }))}
                      >
                        ◀
                      </button>
                      <span className="text-gray-300 text-xs tracking-[0.15em] uppercase tabular-nums">
                        Page {page} / {total}
                      </span>
                      <button
                        type="button"
                        className="text-gray-300 hover:text-white text-lg px-3 py-1 border border-gray-600 hover:border-gray-400 transition-colors disabled:text-gray-700 disabled:border-gray-800 disabled:cursor-not-allowed"
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
                    <div style={{ width: displayWidth, height: displayHeight }} className="flex items-center justify-center bg-gray-800/50">
                      <p className="text-gray-400 text-sm tracking-wider">Invalid embed code</p>
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
                <div className="bg-gray-800/50 p-6 selectable-text">
                  <p className="text-white text-lg whitespace-pre-wrap break-words font-mono">
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
                    className="mt-4 px-4 py-2 border border-gray-500 text-white text-[10px] tracking-[0.15em] uppercase hover:bg-gray-700 transition-colors"
                  >
                    {copiedModalText ? '✓ Copied' : '◇ Copy Text'}
                  </button>
                </div>
              )}
            </div>

            {/* Caption/Description */}
            {modalTrace.content && modalTrace.type !== 'text' && (
              <div className="mb-4">
                <p className="text-gray-400 text-sm italic">
                  "{modalTrace.content}"
                </p>
              </div>
            )}

            {/* Metadata */}
            <div className="flex justify-between items-center text-[10px] text-gray-400 tracking-wider uppercase font-mono">
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
      {deleteConfirmDialog && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[10000100] pointer-events-auto"
          onClick={() => setDeleteConfirmDialog(null)}
        >
          {/* Scanline overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203, 203, 203, 0.1) 2px, rgba(203, 203, 203, 0.1) 4px)',
            }}
          />
          
          <div
            className="bg-gray-900 border border-red-500/40 p-6 max-w-md w-full mx-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-red-500/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-red-500/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-red-500/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-red-500/60" />
            
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1.5 h-1.5 rotate-45 border border-red-500/60" />
              <h2 className="text-lg text-red-400 tracking-[0.15em] uppercase">
                {deleteConfirmDialog.traceIds.length > 1 ? `Delete ${deleteConfirmDialog.traceIds.length} Traces` : 'Delete Trace'}
              </h2>
            </div>
            <p className="text-white mb-6 text-sm tracking-wide">
              {deleteConfirmDialog.traceIds.length > 1
                ? `Are you sure you want to delete these ${deleteConfirmDialog.traceIds.length} traces? This can be undone with Ctrl+Z, but only until you save.`
                : 'Are you sure you want to delete this trace? This can be undone with Ctrl+Z, but only until you save.'}
            </p>
            <p className="text-gray-400 text-[10px] tracking-wider uppercase mb-6">
              ◇ Tip: Press <kbd className="px-2 py-1 bg-gray-800 border border-gray-600 text-gray-300 text-[9px] tracking-wider">Delete</kbd> key for quick deletion
            </p>
            
            <label className="flex items-center gap-3 text-gray-400 text-xs mb-6 cursor-pointer group">
              <div className="w-4 h-4 border border-gray-600 flex items-center justify-center group-hover:border-gray-400">
                <input
                  type="checkbox"
                  className="hidden"
                  onChange={(e) => {
                    localStorage.setItem('dontAskDeleteTrace', e.target.checked ? 'true' : 'false')
                    e.currentTarget.parentElement?.classList.toggle('bg-white')
                  }}
                />
              </div>
              <span className="tracking-[0.1em] uppercase text-xs text-nier-strong">Don't ask again</span>
            </label>

            <div className="flex gap-3">
              <button
                className="flex-1 py-3 border border-gray-600 text-gray-400 text-[10px] tracking-[0.15em] uppercase hover:border-gray-400 hover:text-white transition-colors"
                onClick={() => setDeleteConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-3 border border-red-500/40 bg-red-500/20 text-white text-[10px] tracking-[0.15em] uppercase hover:bg-red-500/30 transition-colors"
                onClick={() => executeDelete(deleteConfirmDialog.traceIds)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
