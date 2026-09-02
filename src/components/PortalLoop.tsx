import { useEffect, useRef, useState } from 'react'

interface PortalLoopProps {
  // Tailwind height classes, e.g. "h-32 md:h-40". Width follows the aspect.
  className?: string
  // 1 = the clip's natural speed. The giant hero emblem runs slower -- at
  // backdrop scale the natural pace reads as busy rather than ambient.
  playbackRate?: number
  // Draw it as ink rather than light, for a page with a pale background.
  ink?: boolean
}

// The looping portal from the atrium-entry animation, reused as page ornament.
//
// The source is white line-art on pure black, and the black has to become
// genuinely transparent so grid lines, particles and scanlines show through
// rather than being covered by an opaque plate. Getting there has taken three
// attempts, and the two that failed are worth recording because each looks
// like the obvious answer:
//
//   mix-blend-mode: screen composites against the backdrop of its nearest
//   stacking context. Both pages nest this inside a `relative z-10` container,
//   which creates one, and nothing is painted behind the video inside it -- so
//   black blended against transparency and stayed black.
//
//   An SVG filter deriving alpha from luminance produced real alpha and worked
//   everywhere the app was tested. WebKit will not composite a video through
//   an SVG filter: on macOS the element rendered as a placeholder with a play
//   glyph on it, which is what the desktop app showed while the entering
//   animation -- the same clip, no filter -- played perfectly beside it.
//
// So the conversion happens here instead, a frame at a time, into a canvas.
// No filter, no blend mode, and no dependence on what is painted behind it:
// the pixels arrive already carrying their own alpha, which every browser
// composites the same way.
//
// HEVC-with-alpha was the other candidate and is worse for this. Only Safari
// decodes it, so it would mean two encodes of the same clip, kept in sync,
// with source-switching around them -- to avoid a per-frame loop over a small
// image that a decade-old machine can do without noticing.

// Rec. 709. The same coefficients the SVG filter used, for the same reason:
// green carries most of what the eye reads as brightness, so a luma-weighted
// sum keeps the line-art's own falloff instead of flattening it.
const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

// Not pure black for the ink variant: the page it lands on is warm paper, and
// #000 on it reads as a hole.
const INK = { r: 28, g: 26, b: 23 }

export default function PortalLoop({ className = 'h-32 md:h-40', playbackRate = 1, ink = false }: PortalLoopProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Held in a ref so the draw loop reads the current value without being torn
  // down and rebuilt every time the theme flips.
  const inkRef = useRef(ink)
  inkRef.current = ink

  // Until the first frame is drawn the canvas is empty, and an empty canvas
  // still occupies its box -- so the layout is right from the start and
  // nothing jumps when the video begins.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let frame = 0
    let context: CanvasRenderingContext2D | null = null

    const draw = () => {
      frame = requestAnimationFrame(draw)

      const canvas = canvasRef.current
      if (!canvas || video.readyState < 2 || !video.videoWidth) return

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        context = null
      }
      // willReadFrequently, because getImageData every frame on a canvas the
      // browser has put on the GPU means reading it back across the bus each
      // time. This asks for a CPU-backed surface instead, which is the right
      // trade when every frame is going to be read anyway.
      if (!context) context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return

      context.drawImage(video, 0, 0)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const pixels = image.data
      const asInk = inkRef.current

      for (let i = 0; i < pixels.length; i += 4) {
        const luma = LUMA_R * pixels[i] + LUMA_G * pixels[i + 1] + LUMA_B * pixels[i + 2]
        if (asInk) {
          // The drawing keeps the alpha it derives from its own luminance and
          // comes out as ink instead of light.
          pixels[i] = INK.r
          pixels[i + 1] = INK.g
          pixels[i + 2] = INK.b
        }
        pixels[i + 3] = luma
      }

      context.putImageData(image, 0, 0)
    }

    const onReady = () => {
      video.playbackRate = playbackRate
      if (video.videoWidth) setSize({ width: video.videoWidth, height: video.videoHeight })
      // Autoplay can still be refused -- a muted inline loop is allowed
      // everywhere the app runs, but a refusal should leave a still frame
      // rather than an exception.
      video.play().catch(() => { /* the first frame is drawn regardless */ })
    }

    video.addEventListener('loadeddata', onReady)
    if (video.readyState >= 2) onReady()
    frame = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(frame)
      video.removeEventListener('loadeddata', onReady)
    }
  }, [playbackRate])

  return (
    <div className="mx-auto w-fit leading-none" aria-hidden="true">
      {/* The video itself is never shown. It is the frame source, and hiding
          it with display:none would stop it decoding in some browsers -- so it
          is taken out of layout and made invisible instead. */}
      <video
        ref={videoRef}
        src="/idle-animation.mp4"
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
        className="absolute w-px h-px opacity-0 pointer-events-none -z-10"
      />
      <canvas
        ref={canvasRef}
        width={size?.width ?? 16}
        height={size?.height ?? 16}
        className={`${className} w-auto pointer-events-none select-none block`}
      />
    </div>
  )
}
