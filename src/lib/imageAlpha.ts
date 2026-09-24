// Whether a picture has see-through pixels, so it can arrive without the
// background and border that would otherwise fill them in.
//
// Reads a copy at most 256px on its long edge: plenty to find a transparent
// background, and cheap for a large file. False whenever it can't tell -- a
// JPEG, something that isn't an image, a remote picture whose server won't
// let its pixels be read -- and those arrive framed, as everything did.

const EDGE = 256

export function anyTransparent(rgba: ArrayLike<number>): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true
  return false
}

// fallback: a same-origin copy of a remote URL to try when the server does not
// allow reading the original (the web app's image proxy).
export async function hasTransparency(source: Blob | string, fallback?: string): Promise<boolean> {
  if (source instanceof Blob) {
    // The formats that can carry alpha at all.
    if (!/^image\/(png|webp|gif|avif|svg\+xml)$/i.test(source.type)) return false
    const url = URL.createObjectURL(source)
    try {
      return (await readTransparency(url, false)) ?? false
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  if (!/^(https?:|data:image\/)/i.test(source)) return false
  const direct = await readTransparency(source, !source.startsWith('data:'))
  if (direct !== null || !fallback) return direct ?? false
  return (await readTransparency(fallback, false)) ?? false
}

// null: couldn't read it (didn't load, or the pixels are off limits).
function readTransparency(url: string, crossOrigin: boolean, timeoutMs = 3000): Promise<boolean | null> {
  return new Promise(resolve => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = 'anonymous'
    const timer = setTimeout(() => resolve(null), timeoutMs)
    img.onerror = () => { clearTimeout(timer); resolve(null) }
    img.onload = () => {
      clearTimeout(timer)
      try {
        const scale = Math.min(1, EDGE / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, w, h)
        // Throws on a picture from a server that didn't allow it.
        resolve(anyTransparent(ctx.getImageData(0, 0, w, h).data))
      } catch {
        resolve(null)
      }
    }
    img.src = url
  })
}
