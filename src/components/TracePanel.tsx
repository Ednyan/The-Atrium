import PinterestMark from './PinterestMark'
import type { TranslationKey } from '../locales/en'
import { tCount, useTranslation } from '../lib/i18n'
import ShapeStyleControls from './ShapeStyleControls'
import TraceNameField from './TraceNameField'
import { nextShapeStyle, rememberShapeStyle, shapeStyleColumns, type ShapeDraft, type ShapeKind, type ShapeStyle } from '../lib/shapeStyle'
import { useEffect, useRef, useState } from 'react'
import { useGameStore, lobbyFullMessage, useGamePick } from '../store/gameStore'
import { isDesktop } from '../lib/supabase'
import { createPdfTrace } from '../lib/pdfTraces'
import { uploadTraceFile } from '../lib/traceUpload'
import { exrFileToPng, isExr } from '../lib/exr'
import { newTraceOrderFields } from '../lib/order'
import { nextShapeName, nextTextName } from '../lib/traceNames'
import { insertTrace } from '../lib/traceWrites'
import { computeAutoFitTextSize } from '../lib/textFit'
import { currentTracePreset } from '../lib/tracePresets'
import { defaultEmbedBox } from '../lib/embedUrl'
import { hasTransparency } from '../lib/imageAlpha'

// Matches mapRowToTrace's `row.font_size ?? 16` fallback -- a freshly
// created trace never sets font_size in its insert payload, so once loaded
// back (or echoed by realtime) it renders at 16px. Sizing the auto-fit box
// for anything else here undersizes it until an edit recomputes with the
// trace's real (loaded) font size.
const DEFAULT_TEXT_FONT_SIZE = 16

const DEFAULT_PATH_HALF_LENGTH = 30

// Caps a single batch-embed paste -- each link is a sequential insert (see
// LobbyScene's handleCreateBatchEmbeds), so an unbounded paste could fire
// hundreds of requests in a row and easily blow past the atrium's trace/size
// limits before the user even realizes it.
const MAX_BATCH_EMBED_LINKS = 30


const getDefaultPathPoints = (position: { x: number; y: number }) => ([
  { x: position.x - DEFAULT_PATH_HALF_LENGTH, y: position.y },
  { x: position.x + DEFAULT_PATH_HALF_LENGTH, y: position.y },
])

interface TracePanelProps {
  onClose: () => void
  tracePosition?: { x: number; y: number } | null
  lobbyId: string
  initialType?: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document'
  initialShapeType?: ShapeKind
  // Submitting a Path skips the normal insert-and-done flow -- instead of a
  // static pre-made line, this hands off to LobbyScene/TraceOverlay's
  // point-by-point drawing mode so the user starts placing the path (and
  // lands on its arrow controls) immediately. Optional so TracePanel doesn't
  // hard-depend on this -- falls back to the old static-line insert if unset.
  onCreatePath?: (style: ShapeStyle) => void
  // "Batch Placement" toggle on the Embed type: one URL per line becomes its
  // own embed trace, bin-packed around the placement point by LobbyScene
  // instead of the normal single insert-and-done flow.
  onCreateBatchEmbeds?: (urls: string[]) => void
  // Several files picked at once. Handed off for the same reason batch embeds
  // are: it creates many traces, which is placement work this panel has no
  // business doing. LobbyScene runs them through the same path a multi-file
  // drop takes, so both routes lay the batch out identically.
  onCreateFileBatch?: (files: File[]) => void
  // "Pages as traces": each rendered page becomes its own image trace, laid
  // out in a grid by LobbyScene. Handed off for the same reason batch embeds
  // are -- it creates many traces at once, which is placement work this panel
  // has no business doing.
  onCreatePdfPages?: (pages: { blob: Blob; width: number; height: number }[], columns: number) => void
  // Absent unless Pinterest is connected, which is what decides whether the
  // button below the type grid appears at all.
  onOpenPinterestImport?: () => void
  // Shape placement is two-way with the canvas: dragging out a rectangle
  // there sets these fields, and typing in them redraws the preview. The
  // panel owns neither -- LobbyScene holds the draft rect, since it also owns
  // the camera and the placement position the rect is centred on.
  shapeDraftSize?: { width: number; height: number } | null
  // The whole draft, not just its size: the preview draws the actual shape,
  // so it needs the type and corner radius too.
  onShapeDraftChange?: (draft: ShapeDraft) => void
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

export default function TracePanel({ onClose, tracePosition, lobbyId, initialType, initialShapeType, onCreatePath, onCreateBatchEmbeds, onCreateFileBatch, onCreatePdfPages, onOpenPinterestImport, shapeDraftSize, onShapeDraftChange, onShapeModeChange }: TracePanelProps) {
  const { t } = useTranslation()
  const formRef = useRef<HTMLFormElement>(null)
  const [content, setContent] = useState('')
  const [traceType, setTraceType] = useState<'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document'>(initialType || 'text')
  const [mediaUrl, setMediaUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // The full selection when the picker allows more than one. `file` stays the
  // first of them so every existing single-file path keeps working unchanged;
  // this only matters once there are two or more.
  const [pickedFiles, setPickedFiles] = useState<File[]>([])
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
  const pdfInputRef = useRef<HTMLInputElement>(null)

  const handlePdfSelected = async (selected: File | null) => {
    setFile(selected)
    setPdfBuffer(null)
    setPdfPageCount(0)
    if (!selected) return

    setPdfBusy(t('atrium.trace.readingDocument'))
    try {
      const buffer = await selected.arrayBuffer()
      const { getPdfInfo } = await import('../lib/pdf')
      const info = await getPdfInfo(buffer)
      const count = info.pageCount
      setPdfBuffer(buffer)
      setPdfPageCount(count)
      // A sensible default arrangement rather than always 3 across: a 4-page
      // document reads better as 2x2 than 3+1.
      const columns = Math.min(count, Math.max(1, Math.round(Math.sqrt(count))))
      setPdfColumns(columns)
      setPdfRows(Math.ceil(count / columns))
    } catch {
      setPdfBusy('')
      alert(t('atrium.trace.pdfUnreadable'))
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

  // Shape-specific state
  // Every option a shape has, the same set the customize panel edits -- see
  // ShapeStyleControls. It used to be four loose values here, so an outline,
  // no-fill or a path's arrows could only be added after creating the shape.
  // It starts as the last shape made looked (nextShapeStyle).
  const [shapeStyle, setShapeStyle] = useState<ShapeStyle>(() => nextShapeStyle(initialShapeType || 'rectangle'))
  const { shapeType } = shapeStyle
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

  // The fields edited here: sent to the canvas as they change.
  const applyShapeSize = (width: number, height: number) => {
    setShapeWidth(width)
    setShapeHeight(height)
    if (shapeDragArmed) onShapeDraftChange?.({ ...shapeStyle, width, height })
  }

  // Arms (and disarms) drag-to-size on the canvas. Disarmed on unmount too --
  // otherwise closing the panel mid-shape would leave the canvas swallowing
  // drags that should pan the view.
  const shapeDragArmed = traceType === 'shape' && shapeType !== 'path'
  useEffect(() => {
    onShapeModeChange?.(shapeDragArmed)
    return () => onShapeModeChange?.(false)
  }, [shapeDragArmed, onShapeModeChange])

  // Fields -> canvas: the style whenever it changes, with the size as it
  // stands, and everything the moment Shape is picked, so the preview is on
  // screen before anything is dragged. The size itself is sent only when it
  // is edited here (applyShapeSize), never when it was taken from the canvas.
  //
  // It used to be sent from here on every change, echoing the canvas's own
  // size back at it, rounded. A drag that moved on before the echo arrived
  // had it overwrite the newer size; when this and the adopt effect above
  // fired in the same render with different sizes, each copied the other's
  // and the next render copied them back -- the shape flipping between two
  // sizes for good, drag over or not.
  useEffect(() => {
    if (!shapeDragArmed) return
    onShapeDraftChange?.({ ...shapeStyle, width: shapeWidth, height: shapeHeight })
    // Not on the size: see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeDragArmed, shapeStyle, onShapeDraftChange])
  
  const { username, userId, position, isLobbyFull } = useGamePick('username', 'userId', 'position', 'isLobbyFull')
  const lobbyFull = isLobbyFull()
  
  // Use trace position if provided, otherwise fall back to character position
  const finalPosition = tracePosition || position

  const changeShapeStyle = (patch: Partial<ShapeStyle>) => {
    setShapeStyle(current => {
      // Between a line and a filled shape, the look is the last one of that
      // kind's (nextShapeStyle); among the filled ones it carries across.
      if (patch.shapeType && (patch.shapeType === 'path') !== (current.shapeType === 'path')) {
        return { ...nextShapeStyle(patch.shapeType), ...patch }
      }
      return { ...current, ...patch }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    
    // Check lobby size limit
    if (isLobbyFull()) {
      alert(lobbyFullMessage())
      return
    }

    // The next shape starts looking like this one.
    if (traceType === 'shape') rememberShapeStyle(shapeStyle)

    // Hand off to the point-by-point drawing flow instead of inserting a
    // static pre-made line -- see the onCreatePath prop's doc comment.
    if (traceType === 'shape' && shapeType === 'path' && onCreatePath) {
      onCreatePath(shapeStyle)
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

    // Several files picked at once: hand the whole set off to be laid out
    // together, rather than inserting the first and discarding the rest.
    // Type-guarded rather than relying on the selection being cleared: only
    // these pickers allow a multiple selection, so switching type after making
    // one can't strand a stale batch here.
    const isMultiFileType = traceType === 'image' || traceType === 'audio' || traceType === 'video'
    if (isMultiFileType && pickedFiles.length > 1 && onCreateFileBatch) {
      onCreateFileBatch(pickedFiles)
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
            setPdfBusy(t('atrium.trace.renderingPage', { done, total }))
          })
          setPdfBusy('')
          onCreatePdfPages(pages, pdfColumns)
        } catch (err) {
          console.error('PDF render failed:', err)
          setPdfBusy('')
          alert(t('atrium.trace.pdfRenderFailed'))
        } finally {
          setIsSubmitting(false)
        }
        return
      }
      // 'single': one document trace, paged with arrows (lib/pdfTraces) --
      // made the way a PDF dropped on the canvas is.
      if (!userId) return
      setIsSubmitting(true)
      try {
        await createPdfTrace(file, finalPosition, { lobbyId, userId, username }, content)
        setContent('')
        setFile(null)
        onClose()
      } catch (err) {
        console.error('PDF trace failed:', err)
        alert(t('atrium.trace.pdfUnreadable'))
      } finally {
        setIsSubmitting(false)
      }
      return
    }

    // Validate based on trace type
    if (traceType === 'text' && !content.trim()) return
    if ((traceType === 'image' || traceType === 'audio' || traceType === 'video') && !file && !mediaUrl) return
    if (traceType === 'embed' && !mediaUrl) return
    // Both halves are required: a button with no label is unreadable, and one
    // with no destination does nothing when pressed.

    setIsSubmitting(true)

    try {
      // An EXR is placed as the PNG it converts to -- see lib/exr.
      let media = file
      if (media && traceType === 'image' && isExr(media)) {
        try {
          media = await exrFileToPng(media)
        } catch (error) {
          console.error('EXR conversion failed:', media.name, error)
          alert(t('atrium.error.exrUnreadable', { name: media.name }))
          return
        }
      }

      let uploadedUrl = mediaUrl
      const initialPathPoints = shapeType === 'path' ? getDefaultPathPoints(finalPosition) : undefined
      const textSize = traceType === 'text' ? computeAutoFitTextSize(content, DEFAULT_TEXT_FONT_SIZE) : null
      
      // Upload file if provided.
      if (media && (traceType === 'image' || traceType === 'audio' || traceType === 'video')) {
        uploadedUrl = await uploadTraceFile(media, lobbyId, userId)
      }

      // Born in the house style. Whatever preset was last chosen in this
      // atrium, or -- if nobody has chosen yet -- the one that suits the room
      // the interface is in: a bright board in a bright interface, a dark one
      // in a dark one.
      const preset = currentTracePreset(lobbyId)

      // A picture with a see-through background arrives without the
      // background and border that would fill it in. A link already known to
      // be a page (a video, a Doc) isn't asked.
      const seeThrough = (traceType === 'image' && media)
        ? await hasTransparency(media)
        : traceType === 'embed' && mediaUrl && !defaultEmbedBox(mediaUrl)
          ? await hasTransparency(mediaUrl, isDesktop ? undefined : `/api/proxy-image?url=${encodeURIComponent(mediaUrl)}`)
          : false

      // There at once (lib/traceWrites), written behind; the one row, which is
      // also what the store gets -- there were two copies of it here, one for
      // the database and one for the store, and they drifted.
      const all = useGameStore.getState().traces
      const isPath = shapeType === 'path'
      insertTrace({
        user_id: userId,
        username,
        type: traceType,
        ...(traceType === 'text' ? { layer_name: nextTextName(all, n => t('atrium.layers.numberedText', { n })) } : {}),
        border_color: preset.border,
        fill_color: preset.fill,
        show_border: !seeThrough,
        show_background: !seeThrough,
        font_family: 'mono',
        ...(preset.text ? { text_color: preset.text } : {}),
        // A shape unnamed is Shape N (or Path N).
        content: content.trim() || (traceType === 'shape'
          ? nextShapeName(all, isPath, n => t(isPath ? 'atrium.layers.numberedPath' : 'atrium.layers.numberedShape', { n }))
          : `${traceType} content`),
        position_x: finalPosition.x,
        position_y: finalPosition.y,
        media_url: uploadedUrl || null,
        scale: 1.0,
        rotation: 0.0,
        border_radius: 0,
        lobby_id: lobbyId,
        show_description: false,
        show_filename: false,
        ...newTraceOrderFields(all, useGameStore.getState().layers)[0],
        // Auto-fit the box to the content so long text isn't clipped and
        // doesn't need a resize right after creating it.
        ...(textSize && { width: textSize.width, height: textSize.height }),
        // A starting box suited to what's embedded -- a Drive PDF or Doc in the
        // 16:9 embed default is a page letterboxed into a strip.
        ...(traceType === 'embed' && (defaultEmbedBox(mediaUrl) ?? {})),
        ...(traceType === 'shape' && {
          ...shapeStyleColumns(shapeStyle),
          width: shapeWidth,
          height: shapeHeight,
          show_border: false,
          show_background: false,
          // A path starts from its first points.
          ...(isPath && { shape_points: initialPathPoints, path_curve_type: 'straight' }),
        }),
      }, message => alert(t('atrium.error.traceSaveFailed', { message })))

      setContent('')
      setMediaUrl('')
      setFile(null)
      setPickedFiles([])
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
        right: 'var(--right-rail)',
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
        <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">{t('atrium.trace.title')}</h2>
      </div>

      {/* The name first, exactly as the customize panel shows it. It is the one
          field -- content -- that this panel used to ask for in four places:
          a text's message, a file's caption, an embed's description and a
          shape's label, each somewhere different. Hidden when the panel is
          about to make many traces at once, where one name would not apply. */}
      {!(traceType === 'embed' && batchMode) && pickedFiles.length <= 1 && !(traceType === 'document' && pdfMode === 'pages') && (
        <TraceNameField
          label={t('atrium.customize.layerName')}
          value={content}
          placeholder={t('atrium.layers.untitled')}
          readOnly={traceType === 'text'}
          onChange={setContent}
          onCommit={setContent}
        />
      )}

      <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
          {/* Trace Type Selector */}
          <div>
            <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase mb-3">
              {t('atrium.trace.contentType')}
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
                      : 'bg-nier-black border border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
                  }`}
                >
                  {type === 'text' && `◇ ${t('atrium.trace.type.text')}`}
                  {type === 'embed' && `◇ ${t('atrium.trace.type.embed')}`}
                  {type === 'shape' && `◇ ${t('atrium.trace.type.shape')}`}
                  {type === 'image' && `◇ ${t('atrium.trace.type.image')}`}
                  {type === 'audio' && `◇ ${t('atrium.trace.type.audio')}`}
                  {type === 'document' && `◇ ${t('atrium.trace.type.document')}`}
                </button>
              ))}
            </div>

            {/* Across all three, because it is not a content type -- it opens
                a different panel rather than changing what this one builds.
                Sharing a row with Text and Shape would say otherwise. */}
            {onOpenPinterestImport && (
              <button
                type="button"
                onClick={onOpenPinterestImport}
                className="mt-2 w-full px-3 py-2 text-[10px] tracking-wider uppercase bg-nier-black border border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg transition-all inline-flex items-center justify-center gap-2"
              >
                <PinterestMark className="w-3 h-3 opacity-70" />
                {t('atrium.trace.importPinterest')}
              </button>
            )}
          </div>

          {/* Text Content */}
          {traceType === 'text' && (
            <div>
              <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                {t('atrium.trace.yourMessage')}
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t('atrium.trace.messagePlaceholder')}
                rows={4}
                className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors resize-none"
                autoFocus
              />
              <p className="text-nier-bg/55 text-[0.7rem] tracking-[0.1em] uppercase mt-1.5">
                {content.length}/256 characters
              </p>
            </div>
          )}

          {/* PDF */}
          {traceType === 'document' && (
            <div className="space-y-4">
              <div>
                <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                  {t('atrium.trace.choosePdf')}
                </label>
                {/* The native input is hidden and driven by the button below.
                    Its own "No file chosen" label is written by the browser
                    and can't be changed, and a file input's value can't be set
                    programmatically -- so a PDF dropped onto the canvas was
                    loaded, counted and ready to place while the control beside
                    it still insisted nothing had been selected. */}
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => handlePdfSelected(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => pdfInputRef.current?.click()}
                  className="w-full py-3 border border-dashed border-nier-border/40 text-nier-strong text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                >
                  ◇ {file ? t('atrium.trace.chooseAnotherPdf') : t('atrium.trace.choosePdf')}
                </button>
                {pdfBusy && (
                  <p className="text-nier-bg/55 text-[0.7rem] tracking-[0.1em] uppercase mt-1.5">{pdfBusy}</p>
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
                  <p className="text-nier-bg/70 text-[9px] tracking-wider mt-1 uppercase">
                    {pdfPageCount} page{pdfPageCount === 1 ? '' : 's'}
                  </p>
                )}
              </div>

              {pdfPageCount > 0 && (
                <>
                  <div>
                    <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                      {t('atrium.trace.placeAs')}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {([
                        { value: 'pages' as const, label: t('atrium.trace.onePerPage') },
                        { value: 'single' as const, label: t('atrium.trace.singleWithArrows') },
                      ]).map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setPdfMode(option.value)}
                          className={`px-3 py-2 text-[10px] tracking-wider uppercase transition-all ${
                            pdfMode === option.value
                              ? 'bg-nier-bg text-nier-black'
                              : 'bg-nier-black border border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                      {pdfMode === 'pages'
                        ? t('atrium.trace.onePerPageHint')
                        : t('atrium.trace.singleWithArrowsHint')}
                    </p>
                  </div>

                  {pdfMode === 'pages' && (
                    <div>
                      <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                        {t('atrium.trace.gridLayout', { columns: pdfColumns, rows: pdfRows })}
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-nier-bg/55 text-[0.7rem] tracking-[0.1em] uppercase mb-1">{t('atrium.trace.columns')}</label>
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
                          <label className="block text-nier-bg/55 text-[0.7rem] tracking-[0.1em] uppercase mb-1">{t('atrium.trace.rows')}</label>
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
                      <p className="text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide mt-1.5">
                        {t('atrium.trace.pagesOrder')}
                        {pdfColumns * pdfRows < pdfPageCount && (
                          <> {t('atrium.trace.gridFits', { fits: pdfColumns * pdfRows, total: pdfPageCount })}</>
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
              <label className="block text-nier-strong text-xs tracking-[0.1em] uppercase mb-2">
                {t('atrium.trace.uploadType', { type: t(`atrium.trace.type.${traceType}` as TranslationKey) })}
              </label>
              {/* Multiple selection allowed: picking a folder of images one at
                  a time, closing and reopening this panel between each, was
                  the only way to get more than one in -- while dragging the
                  same images onto the canvas had always taken the whole set at
                  once. The two routes now behave the same. */}
              <input
                type="file"
                multiple={!!onCreateFileBatch}
                accept={
                  traceType === 'image' ? 'image/*,.exr' :
                  traceType === 'audio' ? 'audio/*' :
                  'video/*'
                }
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? [])
                  setPickedFiles(picked)
                  setFile(picked[0] ?? null)
                }}
                className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-nier-bg file:text-nier-black file:text-[10px] file:tracking-wider file:uppercase file:cursor-pointer hover:file:bg-nier-bgDark"
              />
              {pickedFiles.length > 1 && (
                <p className="text-nier-strong text-xs tracking-[0.1em] uppercase">
                  {t('atrium.trace.filesGrouped', { count: pickedFiles.length })}
                </p>
              )}
              <p className="text-nier-strong text-xs tracking-[0.1em] uppercase">{t('atrium.trace.orPasteUrl')}</p>
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={`https://example.com/${traceType}.${traceType === 'audio' ? 'mp3' : traceType === 'video' ? 'mp4' : 'jpg'}`}
                className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
              />
            </div>
          )}

          {/* Embed URL */}
          {traceType === 'embed' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-nier-bg/80 text-[9px] tracking-[0.15em] uppercase">
                  {batchMode ? t('atrium.trace.batchLinks') : t('atrium.trace.embedUrl')}
                </label>
                {onCreateBatchEmbeds && (
                  <button
                    type="button"
                    onClick={() => setBatchMode(!batchMode)}
                    className={`px-2 py-1 text-[9px] tracking-wider uppercase transition-colors ${
                      batchMode
                        ? 'bg-nier-bg text-nier-black'
                        : 'bg-nier-black border border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
                    }`}
                    title="{t('atrium.trace.batchHint')}"
                  >
                    {t('atrium.trace.batchPlacement')}
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
                    placeholder={`${t('atrium.trace.batchPlaceholderLead')}\nhttps://example.com/one\nhttps://example.com/two\nhttps://example.com/three`}
                    className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors font-mono"
                    rows={8}
                    autoFocus
                  />
                  <p className={`text-[9px] tracking-wider mt-2 uppercase ${batchOverCap ? '' : 'text-nier-bg/70'}`} style={batchOverCap ? { color: '#FF6161' } : undefined}>
                    {tCount('atrium.trace.validLinks', batchValidUrls.length)}
                    {batchOverCap
                      ? t('atrium.trace.overCap', { cap: MAX_BATCH_EMBED_LINKS, excess: batchValidUrls.length - MAX_BATCH_EMBED_LINKS })
                      : t('atrium.trace.eachOwnEmbed')}
                  </p>
                  {batchInvalidEntries.length > 0 && (
                    <div className="mt-2 border border-nier-red/40 bg-nier-red/10 px-3 py-2 space-y-1">
                      <p className="text-nier-bg text-[10px] tracking-wider">
                        ⚠ {tCount('atrium.trace.invalidLines', batchInvalidEntries.length)}
                      </p>
                      {batchInvalidEntries.slice(0, 5).map((entry) => (
                        <p key={entry.line} className="text-nier-bg/80 text-[9px] tracking-wide font-mono truncate">
                          {t('atrium.trace.lineNumber', { number: entry.line })} {entry.text || t('atrium.trace.emptyLine')}
                        </p>
                      ))}
                      {batchInvalidEntries.length > 5 && (
                        <p className="text-nier-bg/70 text-[9px] tracking-wide">
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
                    placeholder={`${t('atrium.trace.embedPlaceholderLead')}\nhttps://youtube.com/watch?v=...\n\n${t('atrium.trace.embedPlaceholderOr')}\n<iframe src="https://..."></iframe>`}
                    className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors font-mono"
                    rows={5}
                    autoFocus
                  />
                  <p className="text-nier-bg/55 text-[0.7rem] tracking-[0.1em] uppercase mt-1.5">
                    {t('atrium.trace.embedHint')}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Shape Controls */}
          {traceType === 'shape' && (
            <div className="space-y-4">
              <ShapeStyleControls
                value={shapeStyle}
                onChange={changeShapeStyle}
                size={{ width: shapeWidth, height: shapeHeight }}
                onSizeChange={applyShapeSize}
              />

              {shapeType === 'path' && (
                <p className="text-nier-bg/70 text-[9px] tracking-wider uppercase">
                  {t('atrium.trace.pathHint')}
                </p>
              )}
            </div>
          )}

          {/* Location Info */}
          <div className="bg-nier-black border border-nier-border/20 p-4">
            <p className="text-nier-bg/75 text-[9px] tracking-[0.15em] uppercase mb-2">
              {t('atrium.trace.placementLocation')}
            </p>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rotate-45 bg-nier-bg animate-pulse" />
              <p className="text-nier-bg font-mono text-sm">
                X: {Math.round(finalPosition.x)} • Y: {Math.round(finalPosition.y)}
              </p>
            </div>
            <p className="text-nier-bg/70 text-[9px] tracking-wider mt-3 uppercase">
              {t('atrium.trace.clickMap')}
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border border-nier-border/30 text-nier-strong text-xs tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
            >
              {t('common.cancel')}
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
              className="flex-1 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {lobbyFull
                ? `◇ ${t('atrium.trace.atriumFull')}`
                : isSubmitting
                  ? `◇ ${t('atrium.trace.saving')}`
                  : (traceType === 'shape' && shapeType === 'path')
                    ? t('atrium.trace.startPath')
                    : (traceType === 'embed' && batchMode)
                      ? tCount('atrium.trace.placeEmbeds', batchValidUrls.length)
                      : t('atrium.trace.submit')}
            </button>
          </div>
      </form>
    </div>
  )
}
