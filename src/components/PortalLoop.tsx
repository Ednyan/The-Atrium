interface PortalLoopProps {
  // Tailwind height classes, e.g. "h-32 md:h-40". Width follows the aspect.
  className?: string
  // 1 = the clip's natural speed. The giant hero emblem runs slower -- at
  // backdrop scale the natural pace reads as busy rather than ambient.
  playbackRate?: number
}

// The looping portal from the atrium-entry animation, reused as page ornament.
//
// Transparency is done with an SVG filter that derives alpha from luminance:
// the source is white line-art on pure black, so mapping luminance to alpha
// makes the black genuinely transparent and leaves the highlights solid.
//
// This replaced mix-blend-mode: screen, which looked correct in isolation but
// did nothing on either page. A blend mode composites against the backdrop of
// its nearest stacking context, and both pages nest this inside a
// `relative z-10` container -- which creates one. Nothing is painted behind the
// video inside that context, so black was blending against transparency and
// stayed black.
//
// The filter has no such dependency: it produces real alpha, so the video
// composites correctly wherever it sits, and whatever is behind it (grid lines,
// particles, scanlines) shows through instead of being covered by an opaque
// backing plate.
const LUMA_TO_ALPHA_FILTER_ID = 'portal-luma-alpha'

export default function PortalLoop({ className = 'h-32 md:h-40', playbackRate = 1 }: PortalLoopProps) {
  return (
    <div className="mx-auto w-fit leading-none" aria-hidden="true">
      {/* Rec. 709 luma coefficients in the alpha row; RGB passes through
          untouched so the highlights keep their colour and glow. */}
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <defs>
          <filter id={LUMA_TO_ALPHA_FILTER_ID} colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0.2126 0.7152 0.0722 0 0"
            />
          </filter>
        </defs>
      </svg>

      <video
        src="/idle-animation.mp4"
        // Ref callback rather than an effect: it runs on mount and playbackRate
        // survives loop restarts, so this is the whole implementation.
        ref={el => { if (el) el.playbackRate = playbackRate }}
        autoPlay
        loop
        muted
        playsInline
        className={`${className} w-auto pointer-events-none select-none block`}
        style={{ filter: `url(#${LUMA_TO_ALPHA_FILTER_ID})` }}
      />
    </div>
  )
}
