import { useEffect, useRef, useState } from 'react'
import { useGameStore, LOBBY_SIZE_LIMIT } from '../store/gameStore'
import { supabase, isDesktop } from '../lib/supabase'
import { computeZIndexForNewTraceInLayer, computeZIndexForNewUngroupedTrace } from '../lib/layerZIndex'
import { mapRowToTrace } from '../hooks/useTraces'
import { computeAutoFitTextSize } from '../lib/textFit'
import { scaleToDisplayBox } from '../lib/binPack'
import type { Trace } from '../types/database'

// Matches mapRowToTrace's `row.font_size ?? 16` fallback -- a freshly
// created trace never sets font_size in its insert payload, so once loaded
// back (or echoed by realtime) it renders at 16px. Sizing the auto-fit box
// for anything else here undersizes it until an edit recomputes with the
// trace's real (loaded) font size.
const DEFAULT_TEXT_FONT_SIZE = 16

const DEFAULT_SHAPE_COLOR = '#3b82f6'
const DEFAULT_PATH_COLOR = '#9ca3af'
const DEFAULT_PATH_HALF_LENGTH = 30

// Caps a single batch-embed paste -- each link is a sequential insert (see
// LobbyScene's handleCreateBatchEmbeds), so an unbounded paste could fire
// hundreds of requests in a row and easily blow past the atrium's trace/size
// limits before the user even realizes it.
const MAX_BATCH_EMBED_LINKS = 30

const getDefaultShapeColor = (shapeType: 'rectangle' | 'circle' | 'triangle' | 'path') => (
  shapeType === 'path' ? DEFAULT_PATH_COLOR : DEFAULT_SHAPE_COLOR
)

const getDefaultPathPoints = (position: { x: number; y: number }) => ([
  { x: position.x - DEFAULT_PATH_HALF_LENGTH, y: position.y },
  { x: position.x + DEFAULT_PATH_HALF_LENGTH, y: position.y },
])

interface TracePanelProps {
  onClose: () => void
  tracePosition?: { x: number; y: number } | null
  lobbyId: string
  initialType?: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document'
  initialShapeType?: 'rectangle' | 'circle' | 'triangle' | 'path'
  activeLayerId?: string | null
  // Submitting a Path skips the normal insert-and-done flow -- instead of a
  // static pre-made line, this hands off to LobbyScene/TraceOverlay's
  // point-by-point drawing mode so the user starts placing the path (and
  // lands on its arrow controls) immediately. Optional so TracePanel doesn't
  // hard-depend on this -- falls back to the old static-line insert if unset.
  onCreatePath?: (color: string, opacity: number) => void
  // "Batch Placement" toggle on the Embed type: one URL per line becomes its
  // own embed trace, bin-packed around the placement point by LobbyScene
  // instead of the normal single insert-and-done flow.
  onCreateBatchEmbeds?: (urls: string[]) => void
  // "Pages as traces": each rendered page becomes its own image trace, laid
  // out in a grid by LobbyScene. Handed off for the same reason batch embeds
  // are -- it creates many traces at once, which is placement work this panel
  // has no business doing.
  onCreatePdfPages?: (pages: { blob: Blob; width: number; height: number }[], columns: number) => void
  // A PDF dropped onto the canvas, so the panel opens with it already loaded
  // rather than asking the user to pick the file they just dropped.
  initialPdfFile?: File | null
  // Shape placement is two-way with the canvas: dragging out a rectangle
  // there sets these fields, and typing in them redraws the preview. The
  // panel owns neither -- LobbyScene holds the draft rect, since it also owns
  // the camera and the placement position the rect is centred on.
  shapeDraftSize?: { width: number; height: number } | null
  // The whole draft, not just its size: the preview draws the actual shape,
  // so it needs the type and corner radius too.
  onShapeDraftChange?: (draft: {
    width: number
    height: number
    cornerRadius: number
    shapeType: 'rectangle' | 'circle' | 'triangle'
  }) => void
  // Tells LobbyScene when to arm drag-to-size on the canvas. Paths are
  // excluded: they're sized by the points you place, not by a box.
  onShapeModeChange?: (active: boolean) => void
}

interface ParsedBatchLink {
  line: number
  text: string
  url: string | null
}

// Each non-empty line must be a bare http(s) URL -- batch mode is
// specifically for pasting a list of links, not embed codes/iframes (that's
// what the single-embed textarea already supports).
function parseBatchLinks(text: string): ParsedBatchLink[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => ({ line: i + 1, text: raw.trim() }))
    .filter((entry) => entry.text.length > 0)
    .map((entry) => {
      if (!/^https?:\/\/\S+$/i.test(entry.text)) return { ...entry, url: null }
      try {
        new URL(entry.text)
        return { ...entry, url: entry.text }
      } catch {
        return { ...entry, url: null }
      }
    })
}

export default function TracePanel({ onClose, tracePosition, lobbyId, initialType, initialShapeType, activeLayerId, onCreatePath, onCreateBatchEmbeds, onCreatePdfPages, initialPdfFile, shapeDraftSize, onShapeDraftChange, onShapeModeChange }: TracePanelProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [content, setContent] = useState('')
  const [traceType, setTraceType] = useState<'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document'>(initialType || 'text')
  const [mediaUrl, setMediaUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [batchLinksText, setBatchLinksText] = useState('')
  const batchLinks = parseBatchLinks(batchLinksText)
  const batchValidUrls = batchLinks.filter(l => l.url).map(l => l.url!)
  const batchInvalidEntries = batchLinks.filter(l => !l.url)
  const batchOverCap = batchValidUrls.length > MAX_BATCH_EMBED_LINKS
  
  // Button-specific state. The label reuses `content`, since that's the field
  // every other type already puts its text in.

  // PDF-specific state. Desktop only -- pages are rasterized into the local
  // vault, which the web has no equivalent of (and whole PDFs would go
  // straight into the Storage quota and past the import size ceiling).
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null)
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [pdfMode, setPdfMode] = useState<'pages' | 'single'>('pages')
  const [pdfColumns, setPdfColumns] = useState(3)
  // Rows are set independently rather than derived from the column count.
  // They're only a hint: if columns x rows can't hold every page, the extras
  // continue past the last row rather than being dropped.
  const [pdfRows, setPdfRows] = useState(1)
  const [pdfBusy, setPdfBusy] = useState('')
  // Display box for a paged document trace, at the PDF's own aspect ratio.
  const [pdfPageSize, setPdfPageSize] = useState<{ width: number; height: number } | null>(null)

  const handlePdfSelected = async (selected: File | null) => {
    setFile(selected)
    setPdfBuffer(null)
    setPdfPageCount(0)
    if (!selected) return

    setPdfBusy('Reading document...')
    try {
      const buffer = await selected.arrayBuffer()
      const { getPdfInfo } = await import('../lib/pdf')
      const info = await getPdfInfo(buffer)
      const count = info.pageCount
      setPdfBuffer(buffer)
      setPdfPageCount(count)
      // The document's real proportions, so an A4 trace is A4-shaped. Sized
      // through the same 600-unit cap page-per-trace uses, since a paged
      // document at the old 300x424 was far too small to read.
      setPdfPageSize(scaleToDisplayBox({ width: info.width, height: info.height }, 600))
      // A sensible default arrangement rather than always 3 across: a 4-page
      // document reads better as 2x2 than 3+1.
      const columns = Math.min(count, Math.max(1, Math.round(Math.sqrt(count))))
      setPdfColumns(columns)
      setPdfRows(Math.ceil(count / columns))
    } catch {
      setPdfBusy('')
      alert('That file could not be read as a PDF.')
      setFile(null)
      return
    }
    setPdfBusy('')
  }

  // Enter and Escape also work when focus has left the panel.
  //
  // The panel's own onKeyDown only fires while something inside it is
  // focused, so clicking the canvas to reposition the placement -- which is a
  // normal part of using this panel -- silently stopped both keys working and
  // left the buttons as the only way to finish or back out. Listening on the
  // window covers that.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Already handled by the panel's own handler when focus is inside it;
      // acting again here would submit or close twice.
      if (formRef.current?.contains(document.activeElement)) return

      if (e.key === 'Escape') {
        e.preventDefault()
        // stopPropagation as well as preventDefault: Escape is a busy key on
        // the canvas (cancelling path drawing, clearing a selection), and
        // dismissing this panel shouldn't also trigger whatever else is
        // listening behind it.
        e.stopPropagation()
        onClose()
        return
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        formRef.current?.requestSubmit()
      }
    }
    // Capture phase, so the stopPropagation above actually reaches the
    // canvas's own window-level handlers before they run.
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [onClose])

  // Load a dropped PDF exactly as if it had been chosen through the file
  // input, so the page count and both placement modes are available with no
  // second step.
  useEffect(() => {
    if (!initialPdfFile) return
    handlePdfSelected(initialPdfFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPdfFile])

  // Shape-specific state
  const [shapeType, setShapeType] = useState<'rectangle' | 'circle' | 'triangle' | 'path'>(initialShapeType || 'rectangle')
  const [shapeColor, setShapeColor] = useState(getDefaultShapeColor(initialShapeType || 'rectangle'))
  const [shapeOpacity, setShapeOpacity] = useState(1.0)
  const [cornerRadius, setCornerRadius] = useState(0)
  const [shapeWidth, setShapeWidth] = useState(200)
  const [shapeHeight, setShapeHeight] = useState(200)

  // Canvas -> fields. Adopts whatever was dragged out, so the numbers always
  // describe the rectangle actually on screen instead of the 200x200 default
  // they used to be stuck on until edited by hand.
  useEffect(() => {
    if (!shapeDraftSize) return
    setShapeWidth(Math.round(shapeDraftSize.width))
    setShapeHeight(Math.round(shapeDraftSize.height))
  }, [shapeDraftSize])

  const applyShapeSize = (width: number, height: number) => {
    setShapeWidth(width)
    setShapeHeight(height)
  }

  // Arms (and disarms) drag-to-size on the canvas. Disarmed on unmount too --
  // otherwise closing the panel mid-shape would leave the canvas swallowing
  // drags that should pan the view.
  const shapeDragArmed = traceType === 'shape' && shapeType !== 'path'
  useEffect(() => {
    onShapeModeChange?.(shapeDragArmed)
    return () => onShapeModeChange?.(false)
  }, [shapeDragArmed, onShapeModeChange])

  // Fields -> canvas. One effect covering every field the preview draws, so
  // the size, the shape and the corner radius can't drift apart -- and so the
  // preview is on screen from the moment Shape is picked rather than only
  // after something is dragged.
  //
  // This does echo values that arrived from the canvas straight back at it.
  // That terminates because LobbyScene ignores a draft equal to the one it
  // already holds, keeping the object identity stable so the adopt effect
  // above doesn't re-fire. Without that guard the two would bounce forever.
  useEffect(() => {
    if (!shapeDragArmed) return
    onShapeDraftChange?.({
      width: shapeWidth,
      height: shapeHeight,
      cornerRadius,
      shapeType: shapeType as 'rectangle' | 'circle' | 'triangle',
    })
  }, [shapeDragArmed, shapeWidth, shapeHeight, cornerRadius, shapeType, onShapeDraftChange])
  
  const { username, userId, position, addTrace, isLobbyFull, getLobbySizeBytes, traces } = useGameStore()
  const lobbyFull = isLobbyFull()
  
  // Use trace position if provided, otherwise fall back to character position
  const finalPosition = tracePosition || position

  const handleShapeTypeChange = (nextShapeType: 'rectangle' | 'circle' | 'triangle' | 'path') => {
    if (shapeColor === getDefaultShapeColor(shapeType)) {
      setShapeColor(getDefaultShapeColor(nextShapeType))
    }
    setShapeType(nextShapeType)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    
    // Check lobby size limit
    if (isLobbyFull()) {
      const sizeMB = (getLobbySizeBytes() / (1024 * 1024)).toFixed(1)
      alert(`This atrium has reached its ${(LOBBY_SIZE_LIMIT / (1024 * 1024)).toFixed(0)}MB size limit (currently ${sizeMB}MB). Delete some traces to free up space.`)
      return
    }

    // Hand off to the point-by-point drawing flow instead of inserting a
    // static pre-made line -- see the onCreatePath prop's doc comment.
    if (traceType === 'shape' && shapeType === 'path' && onCreatePath) {
      onCreatePath(shapeColor, shapeOpacity)
      return
    }

    // Batch Placement: skip the normal single-insert flow entirely -- see
    // the onCreateBatchEmbeds prop's doc comment. Guarded on there being no
    // invalid lines too (the submit button is already disabled in that case,
    // but this is the actual gate against a stray Enter-key submit).
    if (traceType === 'embed' && batchMode && onCreateBatchEmbeds) {
      if (batchValidUrls.length === 0 || batchInvalidEntries.length > 0 || batchOverCap) return
      onCreateBatchEmbeds(batchValidUrls)
      return
    }

    // PDF: rendering happens here rather than in the insert below, because
    // "one trace per page" doesn't produce a trace at all -- it hands a set of
    // rendered pages to LobbyScene to place as a batch.
    if (traceType === 'document') {
      if (!pdfBuffer || !file) return

      if (pdfMode === 'pages') {
        if (!onCreatePdfPages) return
        setIsSubmitting(true)
        try {
          const { renderPdfPages } = await import('../lib/pdf')
          const pages = await renderPdfPages(pdfBuffer, (done, total) => {
            setPdfBusy(`Rendering page ${done} of ${total}...`)
          })
          setPdfBusy('')
          onCreatePdfPages(pages, pdfColumns)
        } catch (err) {
          console.error('PDF render failed:', err)
          setPdfBusy('')
          alert('Could not render that PDF.')
        } finally {
          setIsSubmitting(false)
        }
        return
      }
      // 'single' falls through: it's an ordinary one-trace insert, with the
      // PDF itself stored like any other media file.
    }

    // Validate based on trace type
    if (traceType === 'text' && !content.trim()) return
    if ((traceType === 'image' || traceType === 'audio' || traceType === 'video') && !file && !mediaUrl) return
    if (traceType === 'embed' && !mediaUrl) return
    // Both halves are required: a button with no label is unreadable, and one
    // with no destination does nothing when pressed.

    setIsSubmitting(true)

    try {
      let uploadedUrl = mediaUrl
      const initialPathPoints = shapeType === 'path' ? getDefaultPathPoints(finalPosition) : undefined
      const textSize = traceType === 'text' ? computeAutoFitTextSize(content, DEFAULT_TEXT_FONT_SIZE) : null
      
      // Upload file if provided. 'document' rides the same desktop path: the
      // PDF is written into the vault exactly like any other media file, and
      // the trace stores its local:// URL.
      if (file && (traceType === 'image' || traceType === 'audio' || traceType === 'video' || traceType === 'document')) {
        if (isDesktop && supabase) {
          // Desktop: create blob URL instantly, write to disk in background
          const fileExt = file.name.split('.').pop()
          const fileName = `${userId}_${Date.now()}.${fileExt}`
          const storagePath = `${lobbyId}/${fileName}`
          const blobUrl = URL.createObjectURL(file)
          const localUrl = `local://traces/${storagePath}`
          // Awaited, not fire-and-forget. The cache entry has to exist before
          // the trace is inserted: a PDF trace reads its own file straight
          // back to render a page, and if the cache miss lands before the
          // (unawaited) disk write finishes, resolveLocalUrl returns the
          // local:// URL unchanged and the fetch fails -- which is exactly
          // what made "single with arrows" report an unreadable PDF while
          // page-per-trace, which never reads back, worked fine.
          const { preCacheLocalUrl } = await import('../lib/localDb')
          preCacheLocalUrl(localUrl, blobUrl)
          supabase.storage.from('traces').upload(storagePath, file)
          uploadedUrl = localUrl
        } else if (supabase) {
          // Web: Upload to Supabase Storage
          const fileExt = file.name.split('.').pop()
          const fileName = `${userId}_${Date.now()}.${fileExt}`
          const { error } = await supabase.storage
            .from('traces')
            .upload(fileName, file)
          
          if (error) {
            console.error('Supabase upload error:', error)
            // Fall back to local data URL
            uploadedUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(reader.result as string)
              reader.readAsDataURL(file)
            })
          } else {
            const { data: { publicUrl } } = supabase.storage
              .from('traces')
              .getPublicUrl(fileName)
            
            uploadedUrl = publicUrl
          }
        } else {
          // No Supabase - use local data URL
          uploadedUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(file)
          })
        }
      }

      const newTrace: Trace = {
        id: `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        username,
        type: traceType,
        content: content.trim() || `${traceType} content`,
        x: finalPosition.x,
        y: finalPosition.y,
        mediaUrl: uploadedUrl || undefined,
        createdAt: new Date().toISOString(),
        scale: 1.0,
        scaleX: 1.0,
        scaleY: 1.0,
        rotation: 0.0,
        borderRadius: 0,
        // Auto-fit the box to the content so long text isn't clipped
        // and doesn't require a manual resize right after creating it.
        ...(textSize && { width: textSize.width, height: textSize.height }),
        // Roughly A4 portrait, at a size that's readable on the canvas without
        // dominating it.
        ...(traceType === 'document' && pdfPageSize && { width: pdfPageSize.width, height: pdfPageSize.height }),
        // Shape properties
        ...(traceType === 'shape' && {
          shapeType,
          shapeColor,
          shapeOpacity,
          cornerRadius,
          width: shapeWidth,
          height: shapeHeight,
          showBorder: false,
          showBackground: false,
          // Initialize points for path shapes
          ...(shapeType === 'path' && {
            shapePoints: initialPathPoints,
            pathCurveType: 'straight'
          }),
        }),
      }

      // Save to Supabase if available
      if (supabase) {
        const layerFields = activeLayerId
          ? {
              layer_id: activeLayerId,
              z_index: await computeZIndexForNewTraceInLayer(
                activeLayerId,
                traces.filter(t => t.layerId === activeLayerId).length
              ),
            }
          : { z_index: computeZIndexForNewUngroupedTrace(traces) }

        const { data, error} = await supabase.from('traces').insert({
          // Don't specify id - let database generate UUID
          user_id: userId,
          username,
          type: traceType,
          content: content.trim() || `${traceType} content`,
          position_x: finalPosition.x,
          position_y: finalPosition.y,
          media_url: uploadedUrl || null,
          scale: 1.0,
          rotation: 0.0,
          border_radius: 0,
          lobby_id: lobbyId,
          show_description: false,
          show_filename: false,
          ...layerFields,
          // Auto-fit the box to the content -- see the comment on newTrace above.
          ...(textSize && { width: textSize.width, height: textSize.height }),
          // See the comment on newTrace above.
          ...(traceType === 'document' && pdfPageSize && { width: pdfPageSize.width, height: pdfPageSize.height }),
          // Shape properties
          ...(traceType === 'shape' && {
            shape_type: shapeType,
            shape_color: shapeColor,
            shape_opacity: shapeOpacity,
            corner_radius: cornerRadius,
            width: shapeWidth,
            height: shapeHeight,
            show_border: false,
            show_background: false,
            // Initialize points for path shapes
            ...(shapeType === 'path' && {
              shape_points: initialPathPoints,
              path_curve_type: 'straight'
            }),
          }),
        } as any).select() // Get the generated trace back
        
        if (error) {
          console.error('❌ Database insert error:', error)
          alert(`Failed to save trace: ${error.message}`)
          return // Don't add to local store if database fails
        } else {
          // Use the database-generated trace. mapRowToTrace is the same
          // mapper the initial load/realtime paths use -- previously this
          // built a trace object by hand with only ~15 of the ~45 fields
          // (showBorder/showBackground/cropWidth/illuminate/etc. were all
          // missing), so a freshly-created trace could render with wrong
          // defaults until the next full reload re-fetched it correctly.
          if (data && data[0]) {
            const dbTrace = data[0] as any
            const trace: Trace = {
              ...mapRowToTrace(dbTrace),
              shapePoints: dbTrace.shape_points ?? initialPathPoints,
              pathCurveType: dbTrace.path_curve_type ?? (shapeType === 'path' ? 'straight' : undefined),
            }
            // Add to local store with database ID
            addTrace(trace)
          }
        }
      } else {
        console.warn('⚠️ Supabase not available, trace only saved locally')
        // Only add to local store if no Supabase
        addTrace(newTrace)
      }

      setContent('')
      setMediaUrl('')
      setFile(null)
      onClose()
    } catch (error) {
      console.error('Error creating trace:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="customize-menu bg-nier-blackLight border border-nier-border/40 p-6 w-96 pointer-events-auto max-h-[90vh] overflow-y-auto relative"
      style={{
        position: 'fixed',
        right: '20px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 10_000_100,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        } else if (e.key === 'Enter' && !e.shiftKey) {
          // Plain Enter applies the trace everywhere in the panel, including
          // inside a textarea (text content, embed URL/code) -- Shift+Enter
          // is what inserts a newline there instead, same as a chat input.
          e.preventDefault()
          formRef.current?.requestSubmit()
        }
      }}
    >
      {/* Corner brackets */}
      <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
      <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
      <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
      <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />

      <div className="flex items-center gap-3 mb-6">
        <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
        <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">Leave a Trace</h2>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
          {/* Trace Type Selector */}
          <div>
            <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-3">
              Content Type
            </label>
            {/* Fixed three across. Desktop has six types, which lands as a
                tidy 3x2; web has three and fills one row. Letting the column
                count vary made the buttons resize as types were added. */}
            <div className="grid grid-cols-3 gap-2">
              {([
                'text', 'embed', 'shape',
                ...(isDesktop ? ['image', 'audio', 'document'] as const : []),
              ] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTraceType(type)}
                  className={`px-3 py-2 text-[10px] tracking-wider uppercase transition-all ${
                    traceType === type
                      ? 'bg-nier-bg text-nier-black'
                      : 'bg-nier-black border border-nier-border/30 text-nier-border hover:border-nier-border/60 hover:text-nier-bg'
                  }`}
                >
                  {type === 'text' && '◇ Text'}
                  {type === 'embed' && '◇ Embed'}
                  {type === 'shape' && '◇ Shape'}
                  {type === 'image' && '◇ Image'}
                  {type === 'audio' && '◇ Audio'}
                  {type === 'document' && '◇ PDF'}
                </button>
              ))}
            </div>
          </div>

          {/* Text Content */}
          {traceType === 'text' && (
            <div>
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                Your message
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Share a thought, memory, or feeling..."
                maxLength={256}
                rows={4}
                className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors resize-none"
                autoFocus
              />
              <p className="text-nier-border/40 text-[9px] tracking-wider mt-2 uppercase">
                {content.length}/256 characters
              </p>
            </div>
          )}

          {/* PDF */}
          {traceType === 'document' && (
            <div className="space-y-4">
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                  Choose a PDF
                </label>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => handlePdfSelected(e.target.files?.[0] ?? null)}
                  className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-xs file:mr-3 file:py-1 file:px-3 file:border-0 file:bg-nier-bg file:text-nier-black file:text-[10px] file:tracking-wider file:uppercase"
                />
                {pdfBusy && (
                  <p className="text-nier-border/60 text-[9px] tracking-wider mt-2 uppercase">{pdfBusy}</p>
                )}
                {/* The file name is shown here rather than left to the input.
                    A file input's value can't be set programmatically, so a
                    PDF dropped onto the canvas -- already loaded, page count
                    read, ready to place -- still displayed "no file selected"
                    beside it. */}
                {file && !pdfBusy && (
                  <p className="text-nier-bg/80 text-[10px] tracking-wide mt-2 truncate" title={file.name}>
                    ◇ {file.name}
                  </p>
                )}
                {pdfPageCount > 0 && !pdfBusy && (
                  <p className="text-nier-border/50 text-[9px] tracking-wider mt-1 uppercase">
                    {pdfPageCount} page{pdfPageCount === 1 ? '' : 's'}
                  </p>
                )}
              </div>

              {pdfPageCount > 0 && (
                <>
                  <div>
                    <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                      Place as
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: 'pages' as const, label: 'One trace per page' },
                        { value: 'single' as const, label: 'Single, with arrows' },
                      ]).map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setPdfMode(option.value)}
                          className={`px-3 py-2 text-[10px] tracking-wider uppercase transition-all ${
                            pdfMode === option.value
                              ? 'bg-nier-bg text-nier-black'
                              : 'bg-nier-black border border-nier-border/30 text-nier-border hover:border-nier-border/60 hover:text-nier-bg'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-nier-border/40 text-[9px] tracking-wider mt-2">
                      {pdfMode === 'pages'
                        ? 'Every page becomes its own image trace, so pages can be rearranged and annotated separately.'
                        : 'One trace showing a page at a time, with arrows to move through it.'}
                    </p>
                  </div>

                  {pdfMode === 'pages' && (
                    <div>
                      <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                        Grid — {pdfColumns} × {pdfRows}
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-nier-border/60 text-[9px] tracking-wider uppercase mb-1">Columns</label>
                          <input
                            type="number"
                            min={1}
                            max={pdfPageCount}
                            value={pdfColumns}
                            onChange={(e) => setPdfColumns(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full px-3 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm focus:border-nier-border/60 transition-colors"
                          />
                        </div>
                        <div>
                          <label className="block text-nier-border/60 text-[9px] tracking-wider uppercase mb-1">Rows</label>
                          <input
                            type="number"
                            min={1}
                            max={pdfPageCount}
                            value={pdfRows}
                            onChange={(e) => setPdfRows(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full px-3 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm focus:border-nier-border/60 transition-colors"
                          />
                        </div>
                      </div>
                      <p className="text-nier-border/40 text-[9px] tracking-wider mt-2">
                        Pages run left to right, in order.
                        {pdfColumns * pdfRows < pdfPageCount && (
                          <> That fits {pdfColumns * pdfRows} of {pdfPageCount} — the rest continue in further rows.</>
                        )}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* File Upload for Image/Audio/Video */}
          {(traceType === 'image' || traceType === 'audio' || traceType === 'video') && (
            <div className="space-y-3">
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                Upload {traceType}
              </label>
              <input
                type="file"
                accept={
                  traceType === 'image' ? 'image/*' :
                  traceType === 'audio' ? 'audio/*' :
                  'video/*'
                }
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-nier-bg file:text-nier-black file:text-[10px] file:tracking-wider file:uppercase file:cursor-pointer hover:file:bg-nier-bgDark"
              />
              <p className="text-nier-border/50 text-[9px] tracking-wider uppercase">Or paste a URL:</p>
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={`https://example.com/${traceType}.${traceType === 'audio' ? 'mp3' : traceType === 'video' ? 'mp4' : 'jpg'}`}
                className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
              />
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Optional caption..."
                maxLength={100}
                className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
              />
            </div>
          )}

          {/* Embed URL */}
          {traceType === 'embed' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase">
                  {batchMode ? 'Batch Links' : 'Embed URL or HTML Code'}
                </label>
                {onCreateBatchEmbeds && (
                  <button
                    type="button"
                    onClick={() => setBatchMode(!batchMode)}
                    className={`px-2 py-1 text-[9px] tracking-wider uppercase transition-colors ${
                      batchMode
                        ? 'bg-nier-bg text-nier-black'
                        : 'bg-nier-black border border-nier-border/30 text-nier-border hover:border-nier-border/60 hover:text-nier-bg'
                    }`}
                    title="Paste multiple links (one per line) and place them all at once"
                  >
                    ◇ Batch Placement
                  </button>
                )}
              </div>

              {batchMode ? (
                <>
                  <textarea
                    value={batchLinksText}
                    onChange={(e) => setBatchLinksText(e.target.value)}
                    // Plain Enter must insert a newline here (that's the
                    // whole point of a one-link-per-line list) rather than
                    // submitting the form like the panel's own Enter handler
                    // otherwise does everywhere else -- stopping propagation
                    // keeps that handler from ever seeing this keydown.
                    onKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation() }}
                    placeholder={`One link per line:\nhttps://example.com/one\nhttps://example.com/two\nhttps://example.com/three`}
                    className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors font-mono"
                    rows={8}
                    autoFocus
                  />
                  <p className={`text-[9px] tracking-wider mt-2 uppercase ${batchOverCap ? '' : 'text-nier-border/40'}`} style={batchOverCap ? { color: '#FF6161' } : undefined}>
                    {batchValidUrls.length} valid link{batchValidUrls.length === 1 ? '' : 's'}
                    {batchOverCap
                      ? ` -- over the ${MAX_BATCH_EMBED_LINKS}-link limit per batch, remove ${batchValidUrls.length - MAX_BATCH_EMBED_LINKS} to place`
                      : ' -- each becomes its own embed, arranged around the placement point'}
                  </p>
                  {batchInvalidEntries.length > 0 && (
                    <div className="mt-2 border border-nier-red/40 bg-nier-red/10 px-3 py-2 space-y-1">
                      <p className="text-nier-bg text-[10px] tracking-wider">
                        ⚠ {batchInvalidEntries.length} line{batchInvalidEntries.length === 1 ? '' : 's'} not a valid link -- fix or remove before placing:
                      </p>
                      {batchInvalidEntries.slice(0, 5).map((entry) => (
                        <p key={entry.line} className="text-nier-border/70 text-[9px] tracking-wide font-mono truncate">
                          Line {entry.line}: {entry.text || '(empty)'}
                        </p>
                      ))}
                      {batchInvalidEntries.length > 5 && (
                        <p className="text-nier-border/50 text-[9px] tracking-wide">
                          + {batchInvalidEntries.length - 5} more
                        </p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <textarea
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    placeholder={`Direct URL:\nhttps://youtube.com/watch?v=...\n\nOr full embed code:\n<iframe src="https://..."></iframe>`}
                    className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors font-mono"
                    rows={5}
                    autoFocus
                  />
                  <p className="text-nier-border/40 text-[9px] tracking-wider mt-2 uppercase">
                    ◇ Direct URL or ◇ Paste full embed code
                  </p>
                  <input
                    type="text"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Optional description..."
                    maxLength={100}
                    className="w-full px-4 py-2 mt-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                  />
                </>
              )}
            </div>
          )}

          {/* Shape Controls */}
          {traceType === 'shape' && (
            <div className="space-y-4">
              {/* Shape Type */}
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Shape Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['rectangle', 'circle', 'triangle', 'path'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleShapeTypeChange(type)}
                      className={`px-3 py-2 text-[10px] tracking-wider uppercase capitalize transition-all ${
                        shapeType === type
                          ? 'bg-nier-bg text-nier-black'
                          : 'bg-nier-black border border-nier-border/30 text-nier-border hover:border-nier-border/60 hover:text-nier-bg'
                      }`}
                    >
                      {type === 'rectangle' && '◻'}
                      {type === 'circle' && '○'}
                      {type === 'triangle' && '△'}
                      {type === 'path' && '~'}
                      {' '}{type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Picker */}
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Color</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={shapeColor}
                    onChange={(e) => setShapeColor(e.target.value)}
                    className="w-12 h-10 cursor-pointer bg-nier-black border border-nier-border/30"
                  />
                  <input
                    type="text"
                    value={shapeColor}
                    onChange={(e) => setShapeColor(e.target.value)}
                    placeholder="#3b82f6"
                    className="flex-1 px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors font-mono"
                  />
                </div>
              </div>

              {/* Opacity Slider */}
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                  Opacity: {shapeOpacity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={shapeOpacity}
                  onChange={(e) => setShapeOpacity(parseFloat(e.target.value))}
                  className="w-full accent-nier-bg"
                />
              </div>

              {/* Size Controls -- meaningless for a path, which is sized by
                  the points you place, not a fixed box */}
              {shapeType !== 'path' && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Width (px)</label>
                  <input
                    type="number"
                    min="20"
                    max="1000"
                    value={shapeWidth}
                    onChange={(e) => applyShapeSize(parseInt(e.target.value) || 200, shapeHeight)}
                    className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm focus:border-nier-border/60 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Height (px)</label>
                  <input
                    type="number"
                    min="20"
                    max="1000"
                    value={shapeHeight}
                    onChange={(e) => applyShapeSize(shapeWidth, parseInt(e.target.value) || 200)}
                    className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm focus:border-nier-border/60 transition-colors"
                  />
                </div>
              </div>
              )}
              {shapeType === 'path' && (
                <p className="text-nier-border/50 text-[9px] tracking-wider uppercase">
                  ◇ Click "Start Path" below, then click the canvas to place points. Enter or "Done Adding" finishes it; Escape cancels.
                </p>
              )}

              {/* Corner Radius (Rectangle and Triangle only) */}
              {(shapeType === 'rectangle' || shapeType === 'triangle') && (
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                    Corner Radius: {cornerRadius}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={cornerRadius}
                    onChange={(e) => setCornerRadius(parseInt(e.target.value))}
                    className="w-full accent-nier-bg"
                  />
                </div>
              )}

              {/* Optional Label */}
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Label (optional)</label>
                <input
                  type="text"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Shape label..."
                  maxLength={50}
                  className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Location Info */}
          <div className="bg-nier-black border border-nier-border/20 p-4">
            <p className="text-nier-border/60 text-[9px] tracking-[0.15em] uppercase mb-2">
              ◇ Placement Location
            </p>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rotate-45 bg-nier-bg animate-pulse" />
              <p className="text-nier-bg font-mono text-sm">
                X: {Math.round(finalPosition.x)} • Y: {Math.round(finalPosition.y)}
              </p>
            </div>
            <p className="text-nier-border/40 text-[9px] tracking-wider mt-3 uppercase">
              Click on the map to choose placement
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isSubmitting || lobbyFull ||
                (traceType === 'text' && !content.trim()) ||
                ((traceType === 'image' || traceType === 'audio' || traceType === 'video') && !file && !mediaUrl) ||
                (traceType === 'embed' && batchMode && (batchValidUrls.length === 0 || batchInvalidEntries.length > 0 || batchOverCap)) ||
                (traceType === 'embed' && !batchMode && !mediaUrl)
              }
              className="flex-1 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {lobbyFull ? '◇ Atrium Full' : isSubmitting ? '◇ Saving...' : (traceType === 'shape' && shapeType === 'path') ? 'Start Path' : (traceType === 'embed' && batchMode) ? `Place ${batchValidUrls.length} Embed${batchValidUrls.length === 1 ? '' : 's'}` : 'Leave Trace'}
            </button>
          </div>
      </form>
    </div>
  )
}
