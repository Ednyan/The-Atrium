// A picture that changes without a blank between: the one before stays until
// the next has loaded and decoded -- a document paged through quickly shows
// each page whole, never "rendering" or half drawn between them. `fallback`
// until there's been one to show.

import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react'

export default function HeldImage({ src, fallback, ...props }: { src?: string; fallback: ReactNode } & ImgHTMLAttributes<HTMLImageElement>) {
  const [shown, setShown] = useState(src)
  useEffect(() => {
    if (!src || src === shown) return
    let live = true
    const next = new Image()
    next.src = src
    void next.decode().catch(() => {}).then(() => { if (live) setShown(src) })
    return () => { live = false }
  }, [src]) // eslint-disable-line react-hooks/exhaustive-deps
  return shown ? <img src={shown} alt="" {...props} /> : <>{fallback}</>
}
