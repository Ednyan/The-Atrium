// PDF rendering, used only by the desktop document/PDF trace flows.
//
// Everything here loads pdfjs through dynamic import(), so the library lands
// in its own chunk that the web build never fetches. It's around a megabyte,
// and the web app has no PDF features at all -- a static import would put that
// on every visitor's first load to support something they can't reach.

export interface RenderedPage {
  pageNumber: number
  blob: Blob
  width: number
  height: number
}

// Pixel width each page is rasterized at, and why there are two.
//
// A PDF page is roughly 612pt wide, so rendering at native scale gives a
// blurry 612px. Rendering higher costs file size and memory, which matters
// very differently in the two modes: page-per-trace writes every page to the
// vault at once, while the paged viewer holds one page and is the mode people
// actually zoom into to read. So the viewer renders sharper.
const BATCH_RENDER_WIDTH = 2200
const VIEWER_RENDER_WIDTH = 3000

// Renders one page to a PNG blob at the given width, preserving aspect ratio.
async function renderPageToBlob(page: any, renderWidth: number): Promise<RenderedPage> {
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = renderWidth / baseViewport.width
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not get a 2D context to render the PDF')

  await page.render({ canvasContext: context, viewport, canvas }).promise

  // WebP, not PNG. PNG is lossless, which for a rasterized page means storing
  // every antialiasing artefact around every glyph exactly -- a 2200px page
  // ran to megabytes each, and a long document filled the vault and bogged the
  // atrium down once all those images were on the canvas at once. WebP at this
  // quality is visually indistinguishable for text and roughly five to ten
  // times smaller, so a page is both sharper and lighter than the original
  // 1400px PNG was.
  //
  // Falls back to PNG if the webview can't encode WebP, rather than failing.
  const blob =
    (await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.85))) ??
    (await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png')))
  if (!blob) throw new Error('Could not encode the rendered page')

  // Frees the backing store immediately. A long document renders many of
  // these in a row, and leaving them to the garbage collector can hold on to
  // a great deal of memory while the loop is still running.
  canvas.width = 0
  canvas.height = 0

  return {
    pageNumber: page.pageNumber,
    blob,
    width: Math.ceil(viewport.width),
    height: Math.ceil(viewport.height),
  }
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  // The worker has to be pointed at explicitly under Vite. Resolved as a URL
  // so it's emitted as a same-origin asset, which also keeps it inside the
  // desktop app's script-src 'self' CSP -- a CDN worker would be blocked.
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
  return pdfjs
}

// Returns the loading task alongside the document: destroy() lives on the
// task, not on the document proxy, and it's what actually shuts the worker
// down. Releasing only the document would leave a worker per PDF opened.
async function openDocument(data: ArrayBuffer) {
  const pdfjs = await loadPdfjs()
  // A copy, because pdfjs transfers the buffer to its worker and detaches it.
  // Callers reuse the same ArrayBuffer to also save the original file, and a
  // detached buffer would silently write zero bytes.
  const task = pdfjs.getDocument({ data: data.slice(0) })
  const doc = await task.promise
  return { task, doc }
}

export async function getPdfPageCount(data: ArrayBuffer): Promise<number> {
  const { task, doc } = await openDocument(data)
  const count = doc.numPages
  await task.destroy()
  return count
}

// Renders every page, reporting progress -- a long document takes a while and
// silence reads as a hang.
export async function renderPdfPages(
  data: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<RenderedPage[]> {
  const { task, doc } = await openDocument(data)
  const pages: RenderedPage[] = []

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      pages.push(await renderPageToBlob(page, BATCH_RENDER_WIDTH))
      // Released as we go rather than at the end, so peak memory tracks one
      // page instead of the whole document.
      page.cleanup()
      onProgress?.(i, doc.numPages)
    }
  } finally {
    await task.destroy()
  }

  return pages
}

// Renders a single page. Used by the paged document trace, which only ever
// needs the page currently being looked at.
export async function renderPdfPage(data: ArrayBuffer, pageNumber: number): Promise<RenderedPage | null> {
  const { task, doc } = await openDocument(data)
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) return null
    const page = await doc.getPage(pageNumber)
    const rendered = await renderPageToBlob(page, VIEWER_RENDER_WIDTH)
    page.cleanup()
    return rendered
  } finally {
    await task.destroy()
  }
}
