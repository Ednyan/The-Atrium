// Animated show-don't-tell vignettes for the landing page. Pure HTML/CSS --
// no timers, no rAF loops: every scene is CSS keyframes, so an off-screen
// or backgrounded page costs nothing.
//
// Each scene is a tiny diorama built from the app's own visual vocabulary
// (bracket-framed trace cards, diamond cursors with name tags, the grid) so
// the demos read as the product, not as marketing illustrations of it.

import { useTranslation } from '../lib/i18n'

// Mirrors LandingPage's ACCENT set -- duplicated rather than exported since
// these two files are the only consumers and a shared module for three hex
// strings is more plumbing than it saves.
const C = {
  silver: 'rgb(var(--c-accent))',
  emerald: 'rgb(var(--c-emerald))',
  sky: 'rgb(var(--c-sky))',
} as const

const GRID_BG = {
  backgroundImage:
    'linear-gradient(rgb(var(--c-fg) / 0.09) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-fg) / 0.09) 1px, transparent 1px)',
  backgroundSize: '36px 36px',
} as const

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

// The in-app arrow cursor (same path TraceOverlay renders), with a name tag.
function DemoCursor({ name, color, className, style }: {
  name?: string
  color: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={`absolute pointer-events-none ${className ?? ''}`} style={{ zIndex: 30, ...style }}>
      <svg width="18" height="18" viewBox="0 0 24 24" style={{ filter: `drop-shadow(0 0 6px ${color}66) drop-shadow(0 1px 2px rgb(var(--c-shadow) / 0.6))` }}>
        <path
          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
          fill={color}
          stroke="rgb(var(--c-ground) / 0.9)"
          strokeWidth="1.2"
        />
      </svg>
      {name && (
        <span
          className="absolute left-3.5 top-4 font-mono text-[8px] tracking-wider whitespace-nowrap px-1 py-px"
          style={{ color, backgroundColor: 'rgb(var(--c-ground) / 0.75)', border: `1px solid ${color}55` }}
        >
          {name}
        </span>
      )}
    </div>
  )
}

// Corner brackets used on every card; `glow` drives the selection flash.
function Brackets({ color = 'rgb(var(--c-fg) / 0.55)', className }: { color?: string; className?: string }) {
  const seg = { borderColor: color }
  return (
    <span className={`absolute inset-0 pointer-events-none ${className ?? ''}`}>
      <span className="absolute -top-px -left-px w-2 h-2 border-l border-t" style={seg} />
      <span className="absolute -top-px -right-px w-2 h-2 border-r border-t" style={seg} />
      <span className="absolute -bottom-px -left-px w-2 h-2 border-l border-b" style={seg} />
      <span className="absolute -bottom-px -right-px w-2 h-2 border-r border-b" style={seg} />
    </span>
  )
}

// A miniature trace card. `kind` picks the placeholder content.
function DemoTrace({ kind, className, style, children }: {
  kind: 'text' | 'image' | 'shape' | 'embed'
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}) {
  return (
    <div
      className={`absolute border border-nier-border/40 ${className ?? ''}`}
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)', boxShadow: '0 4px 14px rgb(var(--c-shadow) / 0.5)', ...style }}
    >
      <Brackets />
      <div className="w-full h-full p-1.5 flex flex-col justify-center gap-1 overflow-hidden">
        {kind === 'text' && (
          <>
            <div className="h-[3px] w-4/5 bg-nier-border/50" />
            <div className="h-[3px] w-3/5 bg-nier-border/35" />
            <div className="h-[3px] w-2/3 bg-nier-border/35" />
          </>
        )}
        {kind === 'image' && (
          <div className="w-full h-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, rgb(var(--c-fg) / 0.14), rgb(var(--c-fg) / 0.04))' }}>
            <div className="w-2 h-2 rotate-45 border border-nier-border/60" />
          </div>
        )}
        {kind === 'shape' && (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-5 h-5 rotate-45 border-2" style={{ borderColor: C.sky }} />
          </div>
        )}
        {kind === 'embed' && (
          <div className="w-full h-full flex items-center justify-center gap-1.5">
            <div className="w-0 h-0 border-y-[4px] border-y-transparent border-l-[7px]" style={{ borderLeftColor: C.emerald }} />
            <div className="flex-1 h-[3px] bg-nier-border/40 max-w-[60%]" />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 1. Hero: the living atrium
// ---------------------------------------------------------------------------
//
// One 22s master timeline. "You" approaches the image trace, selection
// brackets flash, drags it out and (second leg) back -- so the loop closes
// without a snap. "Wanderer" ambles around the typing trace while it writes
// itself out. The whole world breathes: a slow pan + zoom-out that lets
// edge traces peek in, selling "this keeps going past the frame".

export function LivingAtriumScene() {
  const { t } = useTranslation()
  return (
    <div className="absolute inset-0 overflow-hidden landing-demo" aria-hidden="true">
      {/* world: oversized so the drift never shows an edge */}
      <div className="absolute -inset-[12%]" style={{ ...GRID_BG, animation: 'ldWorldDrift 22s ease-in-out infinite' }}>

        {/* static dressing traces near the edges -- revealed by the zoom-out */}
        <DemoTrace kind="shape" className="w-14 h-12" style={{ left: '6%', top: '12%', opacity: 0.65 }} />
        <DemoTrace kind="text" className="w-20 h-12" style={{ left: '82%', top: '18%', opacity: 0.65 }} />
        <DemoTrace kind="embed" className="w-24 h-10" style={{ left: '78%', top: '76%', opacity: 0.65 }} />
        <DemoTrace kind="image" className="w-16 h-16" style={{ left: '8%', top: '70%', opacity: 0.65 }} />

        {/* the dragged trace -- movement mirrors the cursor's drag windows */}
        <div className="absolute w-20 h-16" style={{ left: '34%', top: '52%', animation: 'ldDragTrace 22s ease-in-out infinite' }}>
          <DemoTrace kind="image" className="w-full h-full" style={{ position: 'relative' }} />
          {/* selection glow, only during the drag windows */}
          <span
            className="absolute -inset-1 border pointer-events-none"
            style={{ borderColor: C.silver, boxShadow: `0 0 14px ${C.silver}55`, opacity: 0, animation: 'ldSelectFlash 22s linear infinite' }}
          />
        </div>

        {/* the typing trace */}
        <div
          className="absolute w-28 border border-nier-border/40 p-2"
          style={{ left: '56%', top: '30%', backgroundColor: 'rgb(var(--c-ground) / 0.92)', boxShadow: '0 4px 14px rgb(var(--c-shadow) / 0.5)' }}
        >
          <Brackets />
          <span
            className="block font-mono text-[9px] text-nier-bg/90 whitespace-nowrap overflow-hidden border-r"
            style={{ borderColor: `${C.silver}AA`, animation: 'ldTyping 9s steps(14) infinite' }}
          >
            {t('demo.sharedCanvas')}
          </span>
        </div>

        {/* cursors */}
        <DemoCursor name="You" color={C.silver} style={{ left: 0, top: 0, animation: 'ldCursorYou 22s ease-in-out infinite' }} />
        <DemoCursor name="Wanderer" color={C.emerald} style={{ left: 0, top: 0, animation: 'ldCursorWanderer 22s ease-in-out infinite' }} />
      </div>

      <style>{`
        @keyframes ldWorldDrift {
          0%, 100% { transform: translate(0, 0) scale(1); }
          38%      { transform: translate(-2.5%, -1.5%) scale(1); }
          58%      { transform: translate(-1%, 0.5%) scale(0.9); }
          80%      { transform: translate(1.5%, 1%) scale(0.96); }
        }
        /* Drag legs: out at 14-36%, back at 60-82%. Identical deltas to the
           cursor's, so the card tracks under the pointer. */
        @keyframes ldDragTrace {
          0%, 14%   { transform: translate(0, 0); }
          36%, 60%  { transform: translate(140%, -90%); }
          82%, 100% { transform: translate(0, 0); }
        }
        @keyframes ldSelectFlash {
          0%, 9%    { opacity: 0; }
          11%, 38%  { opacity: 1; }
          42%, 56%  { opacity: 0; }
          58%, 84%  { opacity: 1; }
          88%, 100% { opacity: 0; }
        }
        /* Percentage-of-world coordinates; the trace sits at ~(34,52)..(42,62). */
        @keyframes ldCursorYou {
          0%        { left: 68%; top: 80%; }
          10%, 14%  { left: 40%; top: 58%; }
          36%, 60%  { left: 68%; top: 40%; }   /* = trace +140%/-90% of its size */
          82%       { left: 40%; top: 58%; }
          90%, 100% { left: 68%; top: 80%; }
        }
        @keyframes ldCursorWanderer {
          0%, 100%  { left: 16%; top: 30%; }
          25%       { left: 50%; top: 22%; }
          45%, 55%  { left: 62%; top: 38%; }   /* pauses to read the typing */
          75%       { left: 30%; top: 66%; }
        }
        @keyframes ldTyping {
          0%        { width: 0; }
          55%, 90%  { width: 14ch; }
          100%      { width: 0; }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 2. What Is This: the atrium as a map
// ---------------------------------------------------------------------------
//
// A zoomed-out field of tiny traces with a bracket viewport gliding between
// clusters -- the "camera" someone is panning around a much larger space.

export function AtriumMapDiagram() {
  const { t } = useTranslation()
  // Deterministic scatter, weighted into three loose clusters so the
  // viewport's stations have something to visit.
  const dots = Array.from({ length: 26 }, (_, i) => {
    const cluster = i % 3
    const cx = [22, 64, 44][cluster]
    const cy = [30, 26, 68][cluster]
    return {
      left: (cx + ((i * 13) % 28) - 14) + '%',
      top: (cy + ((i * 29) % 24) - 12) + '%',
      w: 5 + ((i * 7) % 9),
      h: 4 + ((i * 11) % 7),
      bright: i % 5 === 0,
    }
  })

  return (
    <div
      // Taller from md up, where it stands in the column beside About's two
      // paragraphs rather than under them: 176px left it bottoming out well
      // short of the prose and the block ended on a ragged edge. The dots are
      // placed in percentages, so a taller box just spreads them further.
      className="relative w-full h-44 md:h-52 border border-nier-border/25 overflow-hidden landing-demo"
      style={{ backgroundColor: 'rgb(var(--c-ground) / 0.5)', ...GRID_BG }}
      aria-hidden="true"
    >
      {dots.map((d, i) => (
        <div
          key={i}
          className="absolute border"
          style={{
            left: d.left, top: d.top, width: d.w, height: d.h,
            borderColor: d.bright ? `${C.silver}88` : 'rgb(var(--c-fg) / 0.28)',
            backgroundColor: d.bright ? `${C.silver}22` : 'rgb(var(--c-fg) / 0.07)',
          }}
        />
      ))}

      {/* two other visitors, elsewhere on the map -- warm player colours
          (like the in-app cursor palette users actually pick) rather than
          the section-accent hues, with the same name tags the hero cursors
          carry so they read as people, not markers */}
      {([
        { nameKey: 'demo.visitorA' as const, color: 'rgb(var(--c-amber))', anim: 'ldMapVisitorA 17s ease-in-out infinite' },
        { nameKey: 'demo.visitorB' as const, color: 'rgb(var(--c-coral))', anim: 'ldMapVisitorB 23s ease-in-out infinite' },
      ]).map(({ nameKey, color, anim }) => (
        <div key={nameKey} className="absolute" style={{ animation: anim }}>
          <div className="w-1.5 h-1.5 rotate-45" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
          <span
            className="absolute left-2.5 top-0.5 font-mono text-[8px] tracking-wider whitespace-nowrap px-1 py-px"
            style={{ color, backgroundColor: 'rgb(var(--c-ground) / 0.75)', border: `1px solid ${color}55` }}
          >
            {t(nameKey)}
          </span>
        </div>
      ))}

      {/* your camera: a bracket viewport that pans between clusters */}
      <div className="absolute w-24 h-14" style={{ animation: 'ldMapViewport 18s ease-in-out infinite' }}>
        <Brackets color={C.silver} />
        <span
          className="absolute -bottom-4 left-0 font-mono text-[8px] tracking-[0.18em] uppercase"
          style={{ color: `${C.silver}99` }}
        >
          {t('demo.you')}
        </span>
      </div>

      <style>{`
        @keyframes ldMapViewport {
          0%, 12%   { left: 12%; top: 18%; }
          30%, 45%  { left: 52%; top: 14%; }
          62%, 78%  { left: 34%; top: 55%; }
          95%, 100% { left: 12%; top: 18%; }
        }
        @keyframes ldMapVisitorA {
          0%, 100% { left: 70%; top: 30%; } 40% { left: 60%; top: 40%; } 70% { left: 74%; top: 22%; }
        }
        @keyframes ldMapVisitorB {
          0%, 100% { left: 28%; top: 72%; } 50% { left: 46%; top: 64%; } 80% { left: 34%; top: 78%; }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 3. How It Works / 01: pan + zoom
// ---------------------------------------------------------------------------
//
// The cursor drags and the WORLD moves (opposite direction), then the scroll
// pulse zooms it -- the two navigation gestures, shown not listed.

export function PanZoomDemo() {
  const { t } = useTranslation()
  return (
    <div className="relative w-full h-36 border border-nier-border/25 overflow-hidden mb-5 landing-demo" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.5)' }} aria-hidden="true">
      <div className="absolute -inset-[25%]" style={{ ...GRID_BG, animation: 'ldPanWorld 12s ease-in-out infinite' }}>
        <DemoTrace kind="text" className="w-16 h-10" style={{ left: '30%', top: '30%' }} />
        <DemoTrace kind="image" className="w-12 h-12" style={{ left: '58%', top: '52%' }} />
        <DemoTrace kind="shape" className="w-10 h-10" style={{ left: '44%', top: '64%' }} />
      </div>
      <DemoCursor color={C.silver} style={{ left: 0, top: 0, animation: 'ldPanCursor 12s ease-in-out infinite' }} />
      {/* pressed indicator under the cursor while "dragging" */}
      <div
        className="absolute w-4 h-4 rounded-full border"
        style={{ borderColor: `${C.silver}66`, opacity: 0, animation: 'ldPanPress 12s linear infinite' }}
      />
      <span className="absolute bottom-1.5 right-2 font-mono text-[8px] tracking-[0.18em] uppercase text-nier-bg/70">
        {t('demo.panZoom')}
      </span>

      <style>{`
        @keyframes ldPanWorld {
          0%, 12%   { transform: translate(0,0) scale(1); }
          38%, 46%  { transform: translate(9%, 5%) scale(1); }   /* pan (opposite the cursor) */
          58%, 66%  { transform: translate(9%, 5%) scale(1.28); } /* zoom in */
          80%, 88%  { transform: translate(9%, 5%) scale(0.92); } /* zoom out */
          100%      { transform: translate(0,0) scale(1); }
        }
        @keyframes ldPanCursor {
          0%, 12%   { left: 62%; top: 62%; }
          38%, 46%  { left: 34%; top: 40%; }
          58%       { left: 40%; top: 48%; }
          88%, 100% { left: 62%; top: 62%; }
        }
        @keyframes ldPanPress {
          0%, 10%  { opacity: 0; }
          14%, 40% { opacity: 1; left: calc(62% - 5px); top: calc(62% - 5px); }
          14.1%    { left: calc(62% - 5px); top: calc(62% - 5px); }
          40.1%    { left: calc(34% - 5px); top: calc(40% - 5px); }
          46%, 100%{ opacity: 0; }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. How It Works / 02: one trace, three shapes
// ---------------------------------------------------------------------------
//
// The bracket frame holds still while the content cycles text -> embed ->
// shape, matching the three types the adjacent copy lists.

export function TraceCycleDemo() {
  const { t } = useTranslation()
  const phase = (name: string, delay: string) => ({
    animation: `${name} 9s linear infinite`,
    animationDelay: delay,
  })
  return (
    <div className="relative w-28 h-24 shrink-0 landing-demo" aria-hidden="true">
      <div className="absolute inset-0 border border-nier-border/40" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.92)' }}>
        <Brackets color={`${C.silver}AA`} />
        {/* text */}
        <div className="absolute inset-0 p-3 flex flex-col justify-center gap-1.5" style={{ opacity: 0, ...phase('ldCycle', '0s') }}>
          <div className="h-[3px] w-4/5 bg-nier-border/60" />
          <div className="h-[3px] w-3/5 bg-nier-border/40" />
          <div className="h-[3px] w-2/3 bg-nier-border/40" />
        </div>
        {/* embed */}
        <div className="absolute inset-0 flex items-center justify-center gap-2" style={{ opacity: 0, ...phase('ldCycle', '3s') }}>
          <div className="w-0 h-0 border-y-[6px] border-y-transparent border-l-[10px]" style={{ borderLeftColor: C.emerald }} />
          <div className="w-10 h-[3px] bg-nier-border/50" />
        </div>
        {/* shape */}
        <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: 0, ...phase('ldCycle', '6s') }}>
          <div className="w-8 h-8 rotate-45 border-2" style={{ borderColor: C.sky }} />
        </div>
      </div>
      <span className="absolute -bottom-5 inset-x-0 text-center font-mono text-[8px] tracking-[0.18em] uppercase text-nier-bg/70">
        {t('demo.oneTrace')}
      </span>

      <style>{`
        /* Each layer owns a 3s window of the 9s loop via its delay. */
        @keyframes ldCycle {
          0%, 3%    { opacity: 0; }
          8%, 28%   { opacity: 1; }
          33%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 5-7. The Ecosystem: create / populate / explore
// ---------------------------------------------------------------------------
//
// One compact vignette per step, sharing a frame style so the row reads as a
// triptych. Each animates the verb it sits under: a trace being made, a
// canvas filling up, a camera roaming.

const ECO_FRAME: React.CSSProperties = { backgroundColor: 'rgb(var(--c-ground) / 0.5)', ...GRID_BG }

// Create: the cursor clicks and a trace comes into being under it.
export function CreateTraceDemo() {
  return (
    <div className="relative w-full h-24 border border-nier-border/25 overflow-hidden mt-4 landing-demo" style={ECO_FRAME} aria-hidden="true">
      {/* click ring */}
      <div
        className="absolute w-5 h-5 rounded-full border"
        style={{ left: 'calc(50% - 10px)', top: 'calc(50% - 10px)', borderColor: `${C.silver}88`, opacity: 0, animation: 'ldCreateRing 8s linear infinite' }}
      />
      {/* the trace that gets created */}
      <div className="absolute w-24 h-14" style={{ left: 'calc(50% - 48px)', top: 'calc(50% - 28px)', opacity: 0, animation: 'ldCreateCard 8s ease-out infinite' }}>
        <div className="absolute inset-0 border border-nier-border/50" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}>
          <Brackets color={`${C.silver}88`} />
          <div className="p-2 flex flex-col gap-1.5 justify-center h-full">
            <div className="h-[3px] bg-nier-border/55" style={{ width: 0, animation: 'ldCreateLine1 8s linear infinite' }} />
            <div className="h-[3px] bg-nier-border/35" style={{ width: 0, animation: 'ldCreateLine2 8s linear infinite' }} />
          </div>
        </div>
      </div>
      <DemoCursor color={C.silver} style={{ left: 0, top: 0, animation: 'ldCreateCursor 8s ease-in-out infinite' }} />

      <style>{`
        @keyframes ldCreateCursor {
          0%        { left: 80%; top: 78%; }
          18%, 30%  { left: 50%; top: 48%; }
          55%, 100% { left: 72%; top: 70%; }
        }
        @keyframes ldCreateRing {
          0%, 18%  { opacity: 0; transform: scale(0.4); }
          21%      { opacity: 1; transform: scale(1); }
          27%, 100%{ opacity: 0; transform: scale(1.6); }
        }
        @keyframes ldCreateCard {
          0%, 20%   { opacity: 0; transform: scale(0.7); }
          28%, 88%  { opacity: 1; transform: scale(1); }
          96%, 100% { opacity: 0; transform: scale(0.98); }
        }
        @keyframes ldCreateLine1 { 0%, 30% { width: 0; } 48%, 100% { width: 80%; } }
        @keyframes ldCreateLine2 { 0%, 40% { width: 0; } 58%, 100% { width: 55%; } }
      `}</style>
    </div>
  )
}

// Populate: traces of different kinds pop in one after another until the
// little canvas is full, then it clears and begins again.
export function PopulateDemo() {
  const cards = [
    { kind: 'text' as const, cls: 'w-16 h-10', left: '8%', top: '14%', anim: 'ldPop1' },
    { kind: 'image' as const, cls: 'w-12 h-12', left: '58%', top: '10%', anim: 'ldPop2' },
    { kind: 'embed' as const, cls: 'w-20 h-9', left: '30%', top: '52%', anim: 'ldPop3' },
    { kind: 'shape' as const, cls: 'w-10 h-10', left: '72%', top: '55%', anim: 'ldPop4' },
  ]
  return (
    <div className="relative w-full h-24 border border-nier-border/25 overflow-hidden mt-4 landing-demo" style={ECO_FRAME} aria-hidden="true">
      {cards.map(c => (
        <div key={c.anim} className={`absolute ${c.cls}`} style={{ left: c.left, top: c.top, opacity: 0, animation: `${c.anim} 10s ease-out infinite` }}>
          <DemoTrace kind={c.kind} className="w-full h-full" style={{ position: 'relative' }} />
        </div>
      ))}
      <style>{`
        @keyframes ldPop1 { 0%, 8%  { opacity: 0; transform: scale(0.7); } 14%, 88% { opacity: 1; transform: scale(1); } 96%, 100% { opacity: 0; } }
        @keyframes ldPop2 { 0%, 26% { opacity: 0; transform: scale(0.7); } 32%, 88% { opacity: 1; transform: scale(1); } 96%, 100% { opacity: 0; } }
        @keyframes ldPop3 { 0%, 44% { opacity: 0; transform: scale(0.7); } 50%, 88% { opacity: 1; transform: scale(1); } 96%, 100% { opacity: 0; } }
        @keyframes ldPop4 { 0%, 62% { opacity: 0; transform: scale(0.7); } 68%, 88% { opacity: 1; transform: scale(1); } 96%, 100% { opacity: 0; } }
      `}</style>
    </div>
  )
}

// Explore: the world glides beneath a fixed viewport bracket -- the camera
// roaming an atrium that is bigger than the frame.
export function ExploreDemo() {
  return (
    <div className="relative w-full h-24 border border-nier-border/25 overflow-hidden mt-4 landing-demo" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.5)' }} aria-hidden="true">
      <div className="absolute -inset-[35%]" style={{ ...GRID_BG, animation: 'ldExploreWorld 16s ease-in-out infinite' }}>
        <DemoTrace kind="text" className="w-14 h-9" style={{ left: '16%', top: '24%' }} />
        <DemoTrace kind="image" className="w-11 h-11" style={{ left: '44%', top: '48%' }} />
        <DemoTrace kind="embed" className="w-16 h-8" style={{ left: '66%', top: '20%' }} />
        <DemoTrace kind="shape" className="w-9 h-9" style={{ left: '76%', top: '60%' }} />
        <DemoTrace kind="text" className="w-12 h-8" style={{ left: '28%', top: '68%' }} />
      </div>
      {/* the fixed camera frame the world moves under */}
      <div className="absolute inset-[22%]">
        <Brackets color={`${C.silver}77`} />
      </div>
      <style>{`
        @keyframes ldExploreWorld {
          0%, 100% { transform: translate(0, 0); }
          28%      { transform: translate(-9%, -4%); }
          55%      { transform: translate(-3%, 5%); }
          78%      { transform: translate(6%, -2%); }
        }
      `}</style>
    </div>
  )
}

