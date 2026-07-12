// Self-contained check for whether a URL actually points at an image, used
// by the "Convert to Image" trace actions. Mirrors the preflight image-load
// test already used in TraceOverlay.tsx for embed rendering, but doesn't
// depend on that component's local state so it can also run from bulk
// actions (e.g. the atrium-wide "Convert All Embeds" action).
export async function isUrlAnImage(url: string | undefined | null): Promise<boolean> {
  if (!url) return false

  if (url.startsWith('data:')) {
    return url.startsWith('data:image/')
  }

  let testUrl = url
  if (url.startsWith('local://')) {
    const mod = await import('./localDb')
    testUrl = await mod.resolveLocalUrl(url)
  }

  return new Promise((resolve) => {
    const img = new Image()
    const timeout = setTimeout(() => resolve(false), 8000)
    img.onload = () => {
      clearTimeout(timeout)
      resolve(!!(img.naturalWidth && img.naturalHeight))
    }
    img.onerror = () => {
      clearTimeout(timeout)
      resolve(false)
    }
    img.src = testUrl
  })
}
