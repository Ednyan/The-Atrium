import { useState, useEffect, useMemo, useRef } from 'react'
import { isDesktop } from '../lib/supabase'
import PortalLoop from './PortalLoop'
import ContributePanel from './ContributePanel'
import { useLandingTheme } from '../lib/useLandingTheme'
import DonateButton from './DonateButton'
import { openContributors } from '../lib/contributorsRoute'
import { getCachedContributions, startContributionsRefresh, type ContributionsData } from '../lib/contributions'
import DesktopAppSection from './DesktopAppSection'
import { LivingAtriumScene, AtriumMapDiagram, PanZoomDemo, TraceCycleDemo, CreateTraceDemo, PopulateDemo, ExploreDemo, DemoMotionStyles } from './LandingDemos'

interface LandingPageProps {
  onGetStarted: () => void
  isAuthenticated?: boolean
}

interface Section {
  id: string
  title: string
  subtitle: string
}

// A small accent set, kept deliberately narrow. The app is otherwise
// monochrome, so colour only earns its place where it marks something -- the
// three ideas the product is built on, and the primary action. Silver leads
// (an amber lead was tried and read as too yellow against the palette): it
// stays in the NieR greyscale family while still sitting a step brighter
// than nier-bg, so glows and the filled CTA read as light, not colour. The
// two real hues only ever appear alongside it in the feature rows.
// The same orange the top contribution tier is drawn in, so the button and the
// traces it produces read as one idea across two pages.
const DONATE_ORANGE = '#FF8A3D'

const ACCENT = {
  silver: '#D9D9D9',
  emerald: '#7FD1A6',
  sky: '#7FB6D9',
} as const

// Drop a demo reel at this path in public/ and the In Motion section below
// the hero appears with it, no code change. The hero itself keeps the CSS
// diorama permanently -- the two do different jobs (a living sketch of the
// interactions vs. real footage) and both earned their place.
const SHOWCASE_VIDEO_SRC = '/atrium-showcase.mp4'
const SHOWCASE_POSTER_SRC = '/glass_dome.png'

// The product, framed like a window into an atrium. Deliberately the largest
// element in the hero: the page could describe an atrium at length but never
// showed one, which is the single thing copy is worst at conveying.
function ShowcaseFrame() {
  return (
    <div className="relative mx-auto w-full">
      {/* Corner brackets, matching the atrium's own HUD framing */}
      <div className="absolute -top-2 -left-2 w-6 h-6 border-l border-t border-nier-border/60 z-10 pointer-events-none" />
      <div className="absolute -top-2 -right-2 w-6 h-6 border-r border-t border-nier-border/60 z-10 pointer-events-none" />
      <div className="absolute -bottom-2 -left-2 w-6 h-6 border-l border-b border-nier-border/60 z-10 pointer-events-none" />
      <div className="absolute -bottom-2 -right-2 w-6 h-6 border-r border-b border-nier-border/60 z-10 pointer-events-none" />

      <div
        className="relative border border-nier-border/30 bg-nier-black overflow-hidden aspect-video"
        style={{
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
          // Lifts very slightly against the pointer, so the frame reads as
          // sitting in front of the parallax layers rather than pasted on.
          transform: 'translate3d(calc(var(--px, 0) * 6px), calc(var(--py, 0) * 6px), 0)',
          transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <LivingAtriumScene />

        {/* Scanline wash tying the frame to the app's own look */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.06]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203,203,203,0.5) 2px, rgba(203,203,203,0.5) 4px)',
          }}
        />
        {/* Vignette so the frame's edges sink into the page instead of ending
            on a hard rectangle */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 90px 20px rgba(25,25,25,0.9)' }}
        />
      </div>
    </div>
  )
}

// The demo reel's own band, directly under the hero. Until the file exists
// at public/atrium-showcase.mp4 (the <video> errors on the missing source),
// the frame shows a deliberate "transmission incoming" placeholder -- the
// slot is visible and styled, and swaps to the reel the day the file is
// dropped in, with no code change. Deliberately has no entry in the
// Sits directly below the reel, and says what the app costs to run.
//
// Deliberately not a plea. The pitch of this whole page is that your work lives
// in a folder you own, and a page that then begs undercuts it -- so this states
// what it costs, shows what the month has raised, and offers a door. Anyone who
// reads it and moves on has lost nothing, which is the point.
//
// Kept out of `sections` for the same reason the reel is: it's an interlude,
// not a stop, and adding it would shift every right-rail nav index below it.
function ContributionsSection({ sectionRef }: { sectionRef: (el: HTMLElement | null) => void }) {
  const [showContribute, setShowContribute] = useState(false)
  const [data, setData] = useState<ContributionsData>(() => getCachedContributions())
  useEffect(() => startContributionsRefresh(setData), [])

  const month = data.month
  const percent = month && month.goalCents > 0
    ? Math.min(100, (month.totalCents / month.goalCents) * 100)
    : 0

  return (
    <section ref={sectionRef} className="flex items-center justify-center px-5 sm:px-12 pt-4 pb-24 relative">
      <div className="max-w-4xl w-full mx-auto" data-reveal>
        <div className="flex items-center gap-3 mb-8">
          <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
          <h2 className="text-2xl md:text-3xl font-extralight tracking-[0.15em] uppercase text-nier-strong">
            Support the foundations
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
        </div>

        <div className="grid md:grid-cols-2 gap-10 items-start">
          <div className="space-y-4">
            <p className="text-nier-bg/80 text-sm leading-relaxed tracking-wide">
              An atrium is a building, and buildings need keeping. This one is free to
              enter and always will be — nothing here is behind a paywall, and nothing
              is going to be.
            </p>
            <p className="text-nier-bg/80 text-sm leading-relaxed tracking-wide">
              But it stands on things that are paid for monthly: the database your
              atriums live in, the email that lets new people through the door, the
              domain above it. Left unpaid, none of that quietly degrades — it simply
              stops, and everything inside goes with it.
            </p>
            <p className="text-nier-bg/80 text-sm leading-relaxed tracking-wide">
              It's made and maintained by one person. Donations keep the lights on and
              the work going.
            </p>
            <p className="text-nier-bg/70 text-[13px] leading-relaxed tracking-wide">
              From €1, once or monthly. Choose a name when you donate and it joins the
              others holding the place up.
            </p>
          </div>

          <div className="relative">
            <div className="absolute -top-2 -left-2 w-6 h-6 border-l border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute -bottom-2 -right-2 w-6 h-6 border-r border-b border-nier-border/60 pointer-events-none" />
            <div className="border border-nier-border/30 bg-nier-black/60 p-6">
              {month && month.goalCents > 0 ? (
                <>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-nier-bg/70">This month</span>
                    <span className="font-mono text-[11px] tracking-wider text-nier-strong">
                      {Math.round(month.totalCents / 100)} / {Math.round(month.goalCents / 100)} €
                    </span>
                  </div>
                  <div className="h-[4px] bg-nier-black border border-nier-border/30 overflow-hidden">
                    <div
                      className="h-full transition-all duration-700 ease-out"
                      style={{ width: `${percent}%`, background: ACCENT.silver }}
                    />
                  </div>
                  <p className="font-mono text-[9px] tracking-[0.15em] uppercase text-nier-bg/70 mt-3">
                    {month.contributionCount === 0
                      ? 'Nobody yet this month'
                      : `${month.contributionCount} contribution${month.contributionCount === 1 ? '' : 's'} this month`}
                  </p>
                </>
              ) : (
                <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-nier-bg/70">
                  This place is kept standing by the people who use it
                </p>
              )}

              <div className="flex flex-col sm:flex-row gap-2 mt-6">
                {/* The orange lives here rather than on the contributors
                    page. This section has to earn attention among six others
                    on a page people scroll past; the contributors page has
                    nothing to compete with and shouldn't outshout the names
                    it exists to show. */}
                <button
                  type="button"
                  onClick={() => setShowContribute(true)}
                  className="flex-1 py-3 text-nier-black font-mono text-[10px] tracking-[0.15em] uppercase transition-transform hover:scale-[1.03]"
                  style={{
                    background: DONATE_ORANGE,
                    boxShadow: `0 0 24px ${DONATE_ORANGE}44, 0 0 56px ${DONATE_ORANGE}22`,
                  }}
                >
                  Donate
                </button>
                <button
                  type="button"
                  onClick={() => openContributors('/')}
                  className="flex-1 py-3 border border-nier-border/40 text-nier-bg/80 font-mono text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                >
                  Contributors
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showContribute && <ContributePanel onClose={() => setShowContribute(false)} />}
    </section>
  )
}

// right-rail nav: it's a short interlude, not a stop, and keeping it out of
// `sections` means its presence can't shift every nav index below it.
function VideoShowcaseSection() {
  const [available, setAvailable] = useState(true)

  return (
    <section className="flex items-center justify-center px-5 sm:px-12 pt-24 pb-10 relative">
      <div className="max-w-4xl w-full mx-auto" data-reveal>
        <div className="flex items-center gap-3 mb-8">
          <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
          <h2 className="text-2xl md:text-3xl font-extralight tracking-[0.15em] uppercase text-nier-strong">
            Learn about the Digital Atrium
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
        </div>

        <div className="relative">
          <div className="absolute -top-2 -left-2 w-6 h-6 border-l border-t border-nier-border/60 z-10 pointer-events-none" />
          <div className="absolute -top-2 -right-2 w-6 h-6 border-r border-t border-nier-border/60 z-10 pointer-events-none" />
          <div className="absolute -bottom-2 -left-2 w-6 h-6 border-l border-b border-nier-border/60 z-10 pointer-events-none" />
          <div className="absolute -bottom-2 -right-2 w-6 h-6 border-r border-b border-nier-border/60 z-10 pointer-events-none" />
          <div className="relative border border-nier-border/30 bg-nier-black overflow-hidden aspect-video" style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.55)' }}>
            {available ? (
              <video
                src={SHOWCASE_VIDEO_SRC}
                poster={SHOWCASE_POSTER_SRC}
                autoPlay
                loop
                muted
                playsInline
                controls
                onError={() => setAvailable(false)}
                className="w-full h-full object-cover"
              />
            ) : (
              // The reel isn't recorded yet -- hold the slot with something
              // that reads as intentional rather than broken.
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-4"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(203,203,203,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(203,203,203,0.05) 1px, transparent 1px)',
                  backgroundSize: '36px 36px',
                }}
              >
                <div className="w-3 h-3 rotate-45 border animate-pulse" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 12px ${ACCENT.silver}55` }} />
                <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-nier-bg/80">Transmission incoming</p>
                <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-nier-bg/70">A tour of the atrium is being recorded</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

const sections: Section[] = [
  { id: 'hero', title: 'The Digital Atrium', subtitle: 'A museum of references created by you' },
  { id: 'contributions', title: 'The Foundations', subtitle: 'What holds the atrium up' },
  { id: 'what', title: 'What Is This', subtitle: 'The concept behind the atrium' },
  { id: 'how', title: 'How It Works', subtitle: 'Navigate, create, collaborate' },
  { id: 'desktop', title: 'Desktop App', subtitle: 'Your atriums, stored locally' },
  { id: 'free', title: 'But How', subtitle: 'How this stays free' },
  { id: 'who', title: 'Who Am I', subtitle: 'The creator behind the project' },
]

// The bar across the top.
//
// The page had only the HUD rail down the right edge, which is handsome and is
// not what anybody arriving from the rest of the web looks for. A website says
// what it contains along its top edge; this one does that, and keeps the rail
// on screens wide enough to carry both.
//
function TopNav({ sections, activeSection, onJump, onDonate, theme }: {
  sections: { id: string; title: string }[]
  activeSection: number
  onJump: (index: number) => void
  onDonate: () => void
  theme: ReturnType<typeof useLandingTheme>
}) {
  const label = theme.preference === 'system'
    ? `Auto · ${theme.resolved}`
    : theme.preference === 'dark' ? 'Dark' : 'Light'

  return (
    <div className="sticky top-0 z-50">
      <div
        className="backdrop-blur-md border-b border-nier-border/25"
        style={{ background: 'rgb(var(--c-ground) / 0.82)' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">

          <button
            type="button"
            onClick={() => onJump(0)}
            className="flex items-center gap-2.5 shrink-0 group"
          >
            <span
              className="w-2 h-2 rotate-45 border transition-colors"
              style={{ borderColor: '#FF8A3D' }}
            />
            <span className="text-nier-strong text-[11px] sm:text-xs tracking-[0.22em] uppercase whitespace-nowrap">
              The Digital Atrium
            </span>
          </button>

          {/* The sections. Hidden where they would wrap into two rows and stop
              being a bar at all -- the rail and the scroll still work there. */}
          <nav className="hidden lg:flex items-center gap-1 mx-auto">
            {sections.map((section, index) => {
              const isActive = activeSection === index
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onJump(index)}
                  className={`relative px-3 py-2 text-[10px] tracking-[0.18em] uppercase transition-colors ${
                    isActive ? 'text-nier-strong' : 'text-nier-bg/65 hover:text-nier-bg'
                  }`}
                >
                  {section.title}
                  {isActive && (
                    <span
                      className="absolute left-3 right-3 -bottom-px h-[2px]"
                      style={{ background: '#FF8A3D' }}
                    />
                  )}
                </button>
              )
            })}
          </nav>

          <div className="flex items-center gap-2 ml-auto lg:ml-0 shrink-0">
            <button
              type="button"
              onClick={theme.cycle}
              title={`Theme: ${label}`}
              aria-label={`Theme: ${label}. Click to change.`}
              className="px-3 py-2 border border-nier-border/30 text-nier-bg/75 hover:text-nier-bg hover:border-nier-border/60 text-[10px] tracking-[0.15em] uppercase transition-colors"
            >
              {theme.preference === 'system' ? '◐' : theme.resolved === 'dark' ? '☾' : '☀'}
              <span className="hidden sm:inline ml-2">{label}</span>
            </button>

            <DonateButton onClick={onDonate} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage({ onGetStarted, isAuthenticated }: LandingPageProps) {
  const theme = useLandingTheme()
  const [showDonate, setShowDonate] = useState(false)
  const [activeSection, setActiveSection] = useState(0)
  const [scrollProgress, setScrollProgress] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])

  // Memoize particle positions (fireflies)
  const particles = useMemo(() => 
    [...Array(20)].map((_, i) => ({
      left: `${(i * 17 + 3) % 96}%`,
      top: `${(i * 23 + 5) % 94}%`,
      duration: 8 + (i * 1.5) % 6,
      delay: i * 0.5,
    })), []
  )

  // Memoize background rectangles (trace-like elements)
  const backgroundRects = useMemo(() => 
    [...Array(15)].map((_, i) => ({
      left: `${(i * 19 + 7) % 90}%`,
      top: `${(i * 31 + 12) % 85}%`,
      width: 40 + (i * 17) % 120,
      height: 20 + (i * 13) % 60,
      rotation: (i * 7) % 15 - 7,
      delay: i * 0.3,
    })), []
  )

  // Pointer parallax, published as CSS custom properties instead of React
  // state. This was a setState on every mousemove, which re-rendered the whole
  // page continuously -- so the effect had to be kept almost invisible (0.01x)
  // to stay affordable. Writing two variables on the container lets each layer
  // pick its own depth, at a real magnitude, for no render cost.
  //
  // Coalesced into a single rAF so a burst of pointer events can't write style
  // more than once a frame, and skipped entirely for people who ask for reduced
  // motion.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let frame = 0
    const handleMouseMove = (e: MouseEvent) => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        // -1..1 from centre, so layers can shift either way.
        const nx = (e.clientX / window.innerWidth) * 2 - 1
        const ny = (e.clientY / window.innerHeight) * 2 - 1
        el.style.setProperty('--px', nx.toFixed(4))
        el.style.setProperty('--py', ny.toFixed(4))
      })
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Reveals each section as it scrolls into view. A long page where everything
  // is simply already there is the main reason it reads as static.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('[data-reveal]').forEach(n => n.classList.add('is-revealed'))
      return
    }
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed')
            // One-way: re-hiding on scroll-up is distracting on a page people
            // scroll back and forth through.
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    )
    document.querySelectorAll('[data-reveal]').forEach(n => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleScroll = () => {
      if (!containerRef.current) return
      
      const scrollTop = containerRef.current.scrollTop
      const scrollHeight = containerRef.current.scrollHeight - containerRef.current.clientHeight
      const progress = scrollTop / scrollHeight
      setScrollProgress(progress)

      // Determine active section
      let currentSection = 0
      sectionRefs.current.forEach((ref, index) => {
        if (ref) {
          const rect = ref.getBoundingClientRect()
          if (rect.top <= window.innerHeight / 2) {
            currentSection = index
          }
        }
      })
      setActiveSection(currentSection)
    }

    const container = containerRef.current
    container?.addEventListener('scroll', handleScroll)
    return () => container?.removeEventListener('scroll', handleScroll)
  }, [])

  // Indices stay tied to sectionRefs, so the Desktop entry is filtered out
  // after indexing rather than removed -- dropping it would shift every
  // section below it out of sync with its ref.
  const visibleSections = sections.filter(section => !(isDesktop && section.id === 'desktop'))

  const scrollToSection = (index: number) => {
    sectionRefs.current[index]?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div 
      ref={containerRef}
      data-landing-theme={theme.resolved}
      className="h-screen bg-nier-black text-nier-bg overflow-y-auto overflow-x-hidden scroll-smooth"
    >
      <TopNav
        sections={visibleSections}
        activeSection={activeSection}
        onJump={scrollToSection}
        onDonate={() => setShowDonate(true)}
        theme={theme}
      />

      {showDonate && <ContributePanel onClose={() => setShowDonate(false)} />}

      {/* Fixed overlays */}
      {/* Scanline overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02] z-50"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203, 203, 203, 0.1) 2px, rgba(203, 203, 203, 0.1) 4px)',
        }}
      />

      {/* Animated background grid -- the deepest parallax layer, so it moves
          least. Scaled slightly past the viewport so the shift can't expose an
          edge. */}
      <div
        className="fixed pointer-events-none opacity-[0.14]"
        style={{
          inset: '-40px',
          backgroundImage: `
            linear-gradient(rgb(var(--c-fg) / 0.2) 1px, transparent 1px),
            linear-gradient(90deg, rgb(var(--c-fg) / 0.2) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
          transform: 'translate3d(calc(var(--px, 0) * 12px), calc(var(--py, 0) * 12px), 0)',
          transition: 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />

      {/* Slow radial breath behind everything -- gives the page a pulse without
          any element visibly "animating". */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle at 50% 45%, rgb(var(--c-fg) / 0.07), transparent 62%)',
          animation: 'atriumBreathe 11s ease-in-out infinite',
        }}
      />

      {/* Background rectangles (trace-like elements) -- mid parallax layer,
          moving roughly twice the grid so the two separate in depth. */}
      <div
        className="fixed inset-0 pointer-events-none overflow-hidden"
        style={{
          transform: 'translate3d(calc(var(--px, 0) * -26px), calc(var(--py, 0) * -26px), 0)',
          transition: 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {backgroundRects.map((rect, i) => (
          <div
            key={i}
            className="absolute border border-nier-border/[0.14] bg-nier-border/[0.04]"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              transform: `rotate(${rect.rotation}deg)`,
              animation: `rectFloat ${12 + i % 5}s ease-in-out infinite`,
              animationDelay: `${rect.delay}s`,
            }}
          >
            {/* Corner accents on some rectangles */}
            {i % 3 === 0 && (
              <>
                <div className="absolute -top-px -left-px w-2 h-2 border-l border-t border-nier-border/20" />
                <div className="absolute -bottom-px -right-px w-2 h-2 border-r border-b border-nier-border/20" />
              </>
            )}
          </div>
        ))}
      </div>

      {/* Floating particles (fireflies) */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-nier-border rounded-full opacity-0"
            style={{
              left: particle.left,
              top: particle.top,
              animation: `firefly ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Section indicators (Nier-style, on the right) */}
      <div className="fixed right-8 top-1/2 -translate-y-1/2 z-40 hidden xl:flex flex-col items-end gap-6">
        {/* Indices stay tied to sectionRefs, so the Desktop entry is filtered
            out AFTER indexing rather than removed from the array -- dropping
            it would shift every section below it out of sync with its ref. */}
        {sections
          .map((section, index) => ({ section, index }))
          .filter(({ section }) => !(isDesktop && section.id === 'desktop'))
          .map(({ section, index }) => {
          const isActive = activeSection === index
          const distance = Math.abs(activeSection - index)

          return (
            <button
              key={section.id}
              onClick={() => scrollToSection(index)}
              className="group flex items-center gap-3 transition-all duration-300"
            >
              {/* Section label (shows on hover or when active) */}
              <span 
                className={`text-[10px] tracking-[0.15em] uppercase transition-all duration-300 hidden sm:inline ${
                  isActive 
                    ? 'text-nier-bg opacity-100' 
                    : 'text-nier-bg/75 opacity-0 group-hover:opacity-100'
                }`}
              >
                {section.title}
              </span>
              
              {/* Indicator bracket */}
              <div className={`relative transition-all duration-300 ${isActive ? 'scale-110' : 'scale-100'}`}>
                {/* Outer brackets */}
                <div className={`w-6 h-6 transition-all duration-300 ${
                  isActive ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'
                }`}>
                  <div className="absolute top-0 left-0 w-2 h-2 border-l border-t border-nier-border/80" />
                  <div className="absolute top-0 right-0 w-2 h-2 border-r border-t border-nier-border/80" />
                  <div className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-nier-border/80" />
                  <div className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-nier-border/80" />
                </div>
                
                {/* Center diamond */}
                {/* Accented only while active -- it marks where you are, which
                    is exactly the kind of live state colour is good at. */}
                <div
                  className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rotate-45 transition-all duration-300 ${
                    isActive ? '' : 'bg-transparent border border-nier-border/60 group-hover:border-nier-border'
                  }`}
                  style={isActive ? { backgroundColor: ACCENT.silver, boxShadow: `0 0 10px ${ACCENT.silver}AA` } : undefined}
                />
                
                {/* Distance line (when not active) */}
                {distance > 0 && (
                  <div 
                    className="absolute left-1/2 -translate-x-1/2 w-px bg-nier-border/20"
                    style={{
                      top: index < activeSection ? '-24px' : '100%',
                      height: `${Math.min(distance * 8, 16)}px`,
                    }}
                  />
                )}
              </div>
            </button>
          )
        })}
        
        {/* Progress indicator */}
        <div className="mt-4 flex flex-col items-end gap-1 pr-[11px]">
          <div className="w-px h-16 bg-nier-border/20 relative">
            <div 
              className="absolute top-0 left-0 w-full bg-nier-border/60 transition-all duration-300"
              style={{ height: `${scrollProgress * 100}%` }}
            />
          </div>
          <span className="text-[8px] text-nier-bg/70 tracking-widest -mr-2">
            {Math.round(scrollProgress * 100)}%
          </span>
        </div>
      </div>

      {/* SECTION 1: Hero */}
      <section
        ref={el => sectionRefs.current[0] = el}
        className="min-h-screen flex items-center px-5 sm:px-10 lg:px-16 py-28 relative overflow-hidden"
      >
        {/* Corner brackets */}
        <div className="absolute top-8 left-8 w-16 h-16 border-l-2 border-t-2 border-nier-border/30 pointer-events-none" />
        <div className="absolute top-8 right-8 w-16 h-16 border-r-2 border-t-2 border-nier-border/30 pointer-events-none" />
        <div className="absolute bottom-8 left-8 w-16 h-16 border-l-2 border-b-2 border-nier-border/30 pointer-events-none" />
        <div className="absolute bottom-8 right-8 w-16 h-16 border-r-2 border-b-2 border-nier-border/30 pointer-events-none" />

        {/* The portal as an emblem: scaled far past its natural size and sunk
            to low opacity behind the type. Cropped by the section edge on
            purpose -- a partially out-of-frame mark reads as monumental where
            a neatly contained one reads as an icon. The luminance filter in
            PortalLoop keeps its black genuinely transparent at any scale, and
            its own parallax shift is slower than every foreground layer, which
            is what makes it sit at the very back. */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: '-12%',
            top: '50%',
            opacity: 0.14,
            transform: 'translateY(-50%) translate3d(calc(var(--px, 0) * -8px), calc(var(--py, 0) * -8px), 0)',
            transition: 'transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          <PortalLoop className="h-[60vh] lg:h-[85vh] max-h-[820px]" playbackRate={0.5} />
        </div>

        {/* Warm bloom anchored behind the headline. Gives the type something to
            sit in front of, so the left column reads as lit rather than as text
            floating on a flat panel. */}
        <div
          className="absolute pointer-events-none -z-0"
          style={{
            left: '-10%',
            top: '20%',
            width: '55vw',
            height: '55vw',
            maxWidth: 780,
            maxHeight: 780,
            background: `radial-gradient(circle, ${ACCENT.silver}1F, transparent 68%)`,
            filter: 'blur(30px)',
            transform: 'translate3d(calc(var(--px, 0) * -18px), calc(var(--py, 0) * -18px), 0)',
            transition: 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />

        {/* Asymmetric split. Everything used to be centred and evenly weighted,
            so nothing led -- the eye had no entry point. Type anchors the left,
            the product holds the right, and on narrow screens it stacks with
            the product directly under the headline. */}
        <div className="relative z-10 w-full max-w-[1400px] mx-auto grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-12 lg:gap-16 items-center">

          {/* LEFT: type + actions */}
          <div className="text-left">
            {/* Status strip, styled like the app's own HUD readouts */}
            <div className="inline-flex items-center gap-3 border px-3 py-1.5 mb-8" style={{ borderColor: `${ACCENT.silver}40`, backgroundColor: `${ACCENT.silver}0A` }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rotate-45 opacity-75 animate-ping" style={{ backgroundColor: ACCENT.silver }} />
                <span className="relative inline-flex h-1.5 w-1.5 rotate-45" style={{ backgroundColor: ACCENT.silver }} />
              </span>
              <span className="text-[10px] tracking-[0.28em] uppercase" style={{ color: `${ACCENT.silver}E6` }}>
                A Shared Canvas Experience
              </span>
            </div>

            {/* Oversized and tightly set. The old headline was font-extralight
                with wide tracking -- elegant, but it read as delicate at exactly
                the moment the page needed to assert itself. Weight and leading
                do the work now; the wide tracking stays on the small labels,
                which is where that NieR texture actually belongs. */}
            <h1 className="font-light leading-[0.86] tracking-[-0.02em] mb-7">
              <span className="block text-nier-bg/70 text-[clamp(2rem,5vw,3.5rem)] tracking-[0.12em] font-extralight mb-2">
                THE
              </span>
              <span
                className="block text-[clamp(3.4rem,9vw,7.5rem)] text-nier-strong"
                style={{ textShadow: '0 0 60px rgba(255,255,255,0.14)' }}
              >
                DIGITAL
              </span>
              <span
                className="block text-[clamp(3.4rem,9vw,7.5rem)]"
                style={{
                  backgroundImage: `linear-gradient(100deg, #FFFFFF 8%, ${ACCENT.silver} 58%, #FFFFFF 96%)`,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                  filter: `drop-shadow(0 0 34px ${ACCENT.silver}40)`,
                }}
              >
                ATRIUM
              </span>
            </h1>

            <p className="text-nier-bg/80 text-base md:text-lg font-light leading-relaxed max-w-md mb-9">
              A museum of references created by you.
              <span className="block text-nier-bg/70 text-sm mt-2">
                Create your atrium. Discover others. Leave traces.
              </span>
            </p>

            {/* Filled rather than outlined. Previously the call to action had
                the same visual weight as every other bordered box on the page,
                so the one thing a visitor should do didn't stand out. */}
            <div className="flex flex-wrap items-center gap-4 mb-10">
              <button
                onClick={onGetStarted}
                className="group relative px-8 py-3.5 text-sm tracking-[0.18em] uppercase font-medium transition-all duration-300"
                style={{
                  backgroundColor: ACCENT.silver,
                  color: '#191919',
                  boxShadow: `0 0 0 rgba(0,0,0,0)`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `0 10px 40px ${ACCENT.silver}55`
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 0 rgba(0,0,0,0)'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                <span className="absolute -top-1 -left-1 w-3 h-3 border-l border-t" style={{ borderColor: `${ACCENT.silver}` }} />
                <span className="absolute -bottom-1 -right-1 w-3 h-3 border-r border-b" style={{ borderColor: `${ACCENT.silver}` }} />
                {isAuthenticated ? 'Continue to Atrium' : 'Enter The Atrium'}
              </button>

              {/* Secondary path, inline with the primary one. Scrolls rather
                  than downloading: the desktop section explains what actually
                  differs and which platform to pick, which is worth reading
                  before committing to a 20MB install. Web only -- inside the
                  desktop build it would scroll to a section that isn't there. */}
              {!isDesktop && (
                <>
                  <span className="text-nier-bg/50 text-[11px] tracking-[0.2em] uppercase">or</span>
                  <button
                    onClick={() => scrollToSection(3)}
                    className="group px-6 py-3.5 border text-sm tracking-[0.18em] uppercase transition-all duration-300"
                    style={{ borderColor: `${ACCENT.silver}55`, color: `${ACCENT.silver}DD` }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = ACCENT.silver
                      e.currentTarget.style.backgroundColor = `${ACCENT.silver}0F`
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = `${ACCENT.silver}55`
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    ↓ Download Desktop App
                  </button>
                </>
              )}
            </div>

            {/* Moved below the buttons rather than sitting beside them: with
                two actions inline, a third inline item made the row read as
                three peers. */}
            {!isAuthenticated && (
              <p className="text-nier-bg/70 text-[11px] tracking-wider mb-10 -mt-6">
                Free to use • No credit card
              </p>
            )}

            {/* Three pillars as a rule-separated row rather than floating chips,
                so they read as one grounded line under the actions. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-7 border-t border-nier-border/15 text-[10px] tracking-[0.16em] uppercase text-nier-bg/80">
              {([
                { label: 'Infinite Canvas', color: ACCENT.silver },
                { label: 'Private Atriums', color: ACCENT.emerald },
                { label: 'Live Presence', color: ACCENT.sky },
              ] as const).map(({ label, color }) => (
                <div key={label} className="flex items-center gap-2 group/feat">
                  <div
                    className="w-1.5 h-1.5 rotate-45 transition-transform duration-300 group-hover/feat:scale-150"
                    style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}AA` }}
                  />
                  <span className="transition-colors duration-300 group-hover/feat:text-nier-bg">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: the product */}
          <div className="relative">
            <ShowcaseFrame />
          </div>
        </div>

        {/* Scroll hint, pinned low but out of the content's way */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-pulse pointer-events-none">
          <span className="text-[10px] text-nier-bg/70 tracking-[0.2em] uppercase">Scroll</span>
          <div className="w-px h-8 bg-gradient-to-b from-nier-border/40 to-transparent" />
        </div>
      </section>

      {/* The demo reel, once it exists (renders nothing until then) */}
      <VideoShowcaseSection />
      <ContributionsSection sectionRef={el => sectionRefs.current[1] = el} />

      {/* SECTION 2: What Is This */}
      <section 
        ref={el => sectionRefs.current[2] = el}
        className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
      >
        <div className="max-w-3xl w-full mx-auto" data-reveal>
          {/* Section header */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
            <h2 className="text-2xl md:text-3xl font-extralight tracking-[0.15em] uppercase text-nier-strong">
              What Is This
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <p className="text-nier-bg/80 text-sm md:text-base leading-relaxed">
                <span className="text-nier-bg">The Digital Atrium</span> is a collaborative infinite canvas 
                where people gather to share, explore, and build together.
              </p>
              <p className="text-nier-bg/80 text-sm leading-relaxed">
                Like a grand entrance hall in a museum, the atrium serves as a central space where art, ideas, and content from many sources come together in one place.
              </p>
              <p className="text-nier-bg/80 text-sm leading-relaxed">
               Create your own private atrium for you, your community or team, or explore public spaces to see what others have hanged in the their atrium walls.
               It's a living document of collective expression for sharing and brainstorming. Have you heard of mind maps?
              </p>

              {/* An atrium from above: scattered traces, other visitors, and
                  the bracket viewport is you -- the concept the paragraphs
                  describe, drawn instead of described. */}
              <AtriumMapDiagram />
              <p className="font-mono text-[9px] tracking-[0.18em] uppercase text-nier-bg/70 -mt-2">
                an atrium, from above
              </p>
            </div>

            <div className="space-y-4">
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45" style={{ backgroundColor: ACCENT.silver, boxShadow: `0 0 8px ${ACCENT.silver}88` }} />
                  <span className="text-sm tracking-[0.1em] uppercase text-nier-bg">Traces</span>
                </div>
                <p className="text-nier-bg/75 text-sm leading-relaxed">
                  Leave text, embeds, or shapes anywhere on the infinite canvas. Each trace persists for you to see or others to find.
                </p>
              </div>
              
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45" style={{ backgroundColor: ACCENT.emerald, boxShadow: `0 0 8px ${ACCENT.emerald}88` }} />
                  <span className="text-sm tracking-[0.1em] uppercase text-nier-bg">Atriums</span>
                </div>
                <p className="text-nier-bg/75 text-sm leading-relaxed">
                  Private or public spaces with their own infinite canvas. Invite friends or open 
                  to the world.
                </p>
              </div>
              
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45" style={{ backgroundColor: ACCENT.sky, boxShadow: `0 0 8px ${ACCENT.sky}88` }} />
                  <span className="text-sm tracking-[0.1em] uppercase text-nier-bg">Presence</span>
                </div>
                <p className="text-nier-bg/75 text-sm leading-relaxed">
                  See others exploring the same space in real-time. A shared experience, even when apart.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: How It Works */}
      <section 
        ref={el => sectionRefs.current[3] = el}
        className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
      >
        <div className="max-w-3xl w-full mx-auto" data-reveal>
          {/* Section header */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
            <h2 className="text-2xl md:text-3xl font-extralight tracking-[0.15em] uppercase text-nier-strong">
              How It Works
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
          </div>

          <div className="space-y-10">
            {/* Controls */}
            <div>
              <h3 className="text-base tracking-[0.1em] uppercase text-nier-strong mb-5 flex items-center gap-3">
                <span className="text-nier-bg/70">01</span>
                Navigation
              </h3>
              {/* The two gestures, performed: the cursor drags and the world
                  moves, then the scroll pulse zooms it. */}
              <PanZoomDemo />
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { key: 'Click + Drag', desc: 'Pan around the canvas' },
                  { key: 'Scroll Wheel', desc: 'Zoom in and out' },
                  { key: 'T Key', desc: 'Quick-place a trace' },
                ].map((control, i) => (
                  <div key={i} className="border border-nier-border/20 p-3 sm:p-4 bg-nier-black/30">
                    <div className="text-nier-strong text-sm font-mono mb-2">{control.key}</div>
                    <div className="text-nier-bg/75 text-xs">{control.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Creating traces */}
            <div>
              <h3 className="text-base tracking-[0.1em] uppercase text-nier-strong mb-5 flex items-center gap-3">
                <span className="text-nier-bg/70">02</span>
                Leaving Traces
              </h3>
              <div className="border border-nier-border/30 p-4 sm:p-5 bg-nier-black/30 sm:flex sm:items-center sm:gap-6">
                <div className="flex-1">
                <p className="text-nier-bg/80 text-sm leading-relaxed mb-3">
                  Click the Leave trace button (or T key shortcut) to leave a trace. Choose between:
                </p>
                <div className="flex flex-wrap gap-4 sm:gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-bg/80"><span className="text-nier-bg">Text</span> — Notes, thoughts, poetry</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-bg/80"><span className="text-nier-bg">Embed</span> — Links, videos, content</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-bg/80"><span className="text-nier-bg">Shape</span> — Visual elements</span>
                  </div>
                </div>
                </div>
                {/* the same card cycling through those three forms */}
                <div className="hidden sm:block pb-4">
                  <TraceCycleDemo />
                </div>
              </div>
            </div>

            {/* Storage recommendation */}
            <div>
              <h3 className="text-base tracking-[0.1em] uppercase text-nier-strong mb-5 flex items-center gap-3">
                <span className="text-nier-bg/70">03</span>
                Adding Your Content
              </h3>
              <div className="border border-nier-border/30 p-4 sm:p-5 bg-nier-black/30">
                <p className="text-nier-bg/80 text-sm leading-relaxed mb-3">
                  The atrium connects to your content through embedded links. We recommend using free 
                  third-party platforms for hosting your media:
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  {[
                    { name: 'YouTube', desc: 'Videos' },
                    { name: 'Pinterest', desc: 'Image boards' },
                    { name: 'Imgur', desc: 'Images' },
                    { name: 'Instagram', desc: 'Photos' },
                    { name: 'SoundCloud', desc: 'Audio' },
                  ].map((platform, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                      <span className="text-nier-bg/80"><span className="text-nier-strong">{platform.name}</span> — {platform.desc}</span>
                    </div>
                  ))}
                </div>
                <p className="text-nier-bg/70 text-xs mt-4 italic">
                  Simply copy the embed link or image URL from these platforms and paste it into your trace.
                </p>
              </div>
            </div>

            {/* The ecosystem */}
            <div>
              <h3 className="text-base tracking-[0.1em] uppercase text-nier-strong mb-5 flex items-center gap-3">
                <span className="text-nier-bg/70">04</span>
                The Ecosystem
              </h3>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="text-center p-3 sm:p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-lg">1</span>
                  </div>
                  <h4 className="text-nier-bg text-sm tracking-wider uppercase mb-2">Create</h4>
                  <p className="text-nier-bg/75 text-xs leading-relaxed">
                    Set up your atrium. Define its purpose and who can access it.
                  </p>
                  <CreateTraceDemo />
                </div>
                <div className="text-center p-3 sm:p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-lg">2</span>
                  </div>
                  <h4 className="text-nier-bg text-sm tracking-wider uppercase mb-2">Populate</h4>
                  <p className="text-nier-bg/75 text-xs leading-relaxed">
                    Invite others or leave traces yourself. Build a collection of ideas.
                  </p>
                  <PopulateDemo />
                </div>
                <div className="text-center p-3 sm:p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-lg">3</span>
                  </div>
                  <h4 className="text-nier-bg text-sm tracking-wider uppercase mb-2">Explore</h4>
                  <p className="text-nier-bg/75 text-xs leading-relaxed">
                    Navigate the infinite canvas. Discover traces left by others.
                  </p>
                  <ExploreDemo />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 4: Desktop App -- web only. Inside the desktop build this is
          an advert for the thing you're already running, and its download
          links would be nonsense there. */}
      {!isDesktop && (
        <section
          ref={el => sectionRefs.current[4] = el}
          className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
        >
          <DesktopAppSection />
        </section>
      )}

      {/* SECTION 5: But How Is This Free? */}
      <section
        ref={el => sectionRefs.current[5] = el}
        className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
      >
        <div className="max-w-2xl w-full mx-auto text-center" data-reveal>
          {/* Section header */}
          <div className="flex items-center justify-center gap-3 mb-10">
            <div className="flex-1 h-px bg-gradient-to-l from-nier-border/40 to-transparent max-w-[80px]" />
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
            <h2 className="text-2xl md:text-3xl font-extralight tracking-[0.15em] uppercase text-nier-strong">
              But How?
            </h2>
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent max-w-[80px]" />
          </div>

          <p className="text-nier-bg/80 text-base md:text-lg font-light tracking-wide mb-8 italic">
            "How is this even possible while being free?"
          </p>

          <div className="border border-nier-border/30 p-6 sm:p-8 md:p-10 bg-nier-black/30 mb-8 text-left">
            <p className="text-nier-bg/80 text-sm leading-relaxed mb-6">
              The secret is in the design. The Atrium doesn't actually store your images, videos, or media — traces are mostly just <span className="text-nier-strong">paths</span> (URLs) pointing to content hosted elsewhere. This keeps the storage footprint incredibly small.
            </p>

            <div className="w-16 h-px bg-nier-border/30 mx-auto mb-6" />

            <p className="text-nier-bg/80 text-sm leading-relaxed mb-6">
              The entire platform runs on free-tier services, which means there are a couple of limits for now:
            </p>

            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              <div className="border border-nier-border/20 p-5 bg-nier-black/40">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-sm font-mono">3</span>
                  </div>
                  <span className="text-nier-strong text-sm tracking-wider uppercase">Atriums per user</span>
                </div>
                <p className="text-nier-bg/70 text-xs leading-relaxed">
                  Each account can create up to three atriums — more than enough to get started.
                </p>
              </div>

              <div className="border border-nier-border/20 p-5 bg-nier-black/40">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-xs font-mono">10<span className="text-[8px]">MB</span></span>
                  </div>
                  <span className="text-nier-strong text-sm tracking-wider uppercase">Per atrium</span>
                </div>
                <p className="text-nier-bg/70 text-xs leading-relaxed">
                  Each atrium has a 10MB data limit — but since traces are just references, you'll find it goes a long way.
                </p>
              </div>
            </div>

            <p className="text-nier-bg/75 text-sm leading-relaxed text-center italic">
              As you'll soon realize, it's plenty.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 5: Who Am I */}
      <section 
        ref={el => sectionRefs.current[6] = el}
        className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
      >
        <div className="max-w-2xl w-full mx-auto text-center" data-reveal>
          {/* Section header */}
          <div className="flex items-center justify-center gap-3 mb-10">
            <div className="flex-1 h-px bg-gradient-to-l from-nier-border/40 to-transparent max-w-[80px]" />
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
            <h2 className="text-2xl md:text-3xl font-extralight tracking-[0.15em] uppercase text-nier-strong">
              Who and Why?
            </h2>
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `${ACCENT.silver}AA`, boxShadow: `0 0 10px ${ACCENT.silver}44` }} />
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent max-w-[100px]" />
          </div>

          {/* Placeholder for personal content */}
          <div className="border border-nier-border/30 p-4 sm:p-6 md:p-10 bg-nier-black/30 mb-6">
            <p className="text-nier-bg/75 text-sm leading-relaxed mb-6 italic">
              My name is Eduardo Paranhos (aka Mindeformer or Red Puer).
              I’m a 3D artist who got FED UP with hoarding reference images across scattered folders on my computer, with no good alternative. So I built The Atrium.
            </p>

            <div className="w-16 h-px bg-nier-border/30 mx-auto mb-6" />

            <p className="text-nier-bg/75 text-sm leading-relaxed italic">
              I wanted something simple to use and fast to iterate in — like making a collage on a sheet of paper.
              What came out feels like a mix of Pinterest, PureRef, Canva and Miro, but with no paywalls, nothing filling up your hard drive, and the flexibility most platforms don’t give you.
            </p>
          </div>

          {/* The ask, at the end.
              
              The Foundations section higher up explains why the place costs
              money; by the time somebody has read to the bottom they have the
              argument and no longer need it repeated, only somewhere to act on
              it. So this is a button and one line, not a second case. */}
          <div className="max-w-3xl mx-auto w-full mb-14">
            <div className="h-px bg-gradient-to-r from-transparent via-nier-border/30 to-transparent mb-10" />
            <div className="flex flex-col sm:flex-row items-center justify-center gap-5 text-center sm:text-left">
              <p className="text-nier-bg/75 text-sm leading-relaxed tracking-wide max-w-sm">
                Free to enter, and kept standing by the people who use it.
              </p>
              <DonateButton onClick={() => setShowDonate(true)} className="px-7 py-3 text-[11px]" />
            </div>
          </div>

          {/* Social links placeholder */}
          <div className="flex items-center justify-center gap-6">
            <span className="text-nier-bg/70 text-xs tracking-[0.1em] uppercase">Connect with me:</span>
            {[
              { name: 'Website', url: 'https://mindeformer.wixstudio.com/mindeformer' },
              { name: 'Instagram', url: 'https://www.instagram.com/red.puer/' },
              { name: 'Youtube', url: 'https://www.youtube.com/@mindeformer' },
              { name: 'Email', url: 'mailto:thedigitalatrium@gmail.com' },
            ].map((social, i) => (
              <a
                key={i}
                href={isDesktop ? '#' : social.url}
                target={isDesktop ? undefined : '_blank'}
                rel={isDesktop ? undefined : 'noopener noreferrer'}
                onClick={isDesktop ? (e) => {
                  e.preventDefault()
                  import('@tauri-apps/plugin-shell').then(({ open }) => open(social.url))
                } : undefined}
                className="text-nier-bg/75 hover:text-nier-bg text-xs tracking-wider uppercase transition-colors cursor-pointer"
              >
                ◇ {social.name}
              </a>
            ))}
          </div>

          {!isDesktop && (
            <div className="flex items-center justify-center gap-4 mt-4">
              <a
                href="/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nier-bg/70 hover:text-nier-bg/80 text-[10px] tracking-wider uppercase transition-colors"
              >
                Privacy Policy
              </a>
              <span className="text-nier-bg/50 text-[10px]">◇</span>
              <a
                href="/terms.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nier-bg/70 hover:text-nier-bg/80 text-[10px] tracking-wider uppercase transition-colors"
              >
                Terms of Service
              </a>
            </div>
          )}

          {/* Shown on desktop too -- the copyright applies to the app itself,
              not just the website. */}
          <div className="flex items-center justify-center mt-3">
            <span className="text-nier-bg/50 text-[10px] tracking-wider">
              © 2026 Eduardo Paranhos. All rights reserved.
            </span>
          </div>

          {/* Final CTA */}
          <div className="mt-12">
            <div className="flex items-center justify-center gap-3 mb-8">
              <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
              <div className="w-3 h-3 rotate-45 border border-nier-border/60 bg-nier-blackLight" />
              <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
            </div>
            
            <button
              onClick={onGetStarted}
              className="group relative px-12 py-4 bg-transparent border border-nier-border/50 hover:border-nier-bg hover:bg-nier-bg/5 transition-all duration-300"
            >
              <div className="absolute -top-1 -left-1 w-3 h-3 border-l border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -top-1 -right-1 w-3 h-3 border-r border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -bottom-1 -left-1 w-3 h-3 border-l border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -bottom-1 -right-1 w-3 h-3 border-r border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              
              <span className="text-sm tracking-[0.2em] uppercase text-nier-bg/80 group-hover:text-nier-bg transition-colors">
                {isAuthenticated ? '◇ Continue to Atrium' : '◇ Begin Your Journey'}
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-nier-border/20">
        <div className="max-w-4xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="text-nier-bg/70 text-xs tracking-wider">
            The Digital Atrium • {new Date().getFullYear()}
          </div>
          <div className="flex items-center gap-6 text-nier-bg/70 text-xs tracking-wider">
            <span>Free to use</span>
            <span>•</span>
            <span>Open source</span>
          </div>
        </div>
      </footer>

      {/* CSS for animations */}
      <style>{`
        @keyframes firefly {
          0% { opacity: 0; transform: translateY(0px) translateX(0px); }
          10% { opacity: 0.15; }
          30% { opacity: 0.3; transform: translateY(-20px) translateX(15px); }
          50% { opacity: 0.25; transform: translateY(-50px) translateX(-10px); }
          70% { opacity: 0.35; transform: translateY(-30px) translateX(25px); }
          90% { opacity: 0.1; transform: translateY(-10px) translateX(5px); }
          100% { opacity: 0; transform: translateY(0px) translateX(0px); }
        }
        
        @keyframes rectFloat {
          0%, 100% {
            opacity: 0.6;
            transform: rotate(var(--rotation, 0deg)) translateY(0px);
          }
          50% {
            opacity: 0.9;
            transform: rotate(var(--rotation, 0deg)) translateY(-10px);
          }
        }

        /* Slow ambient pulse behind the whole page. Long and low-contrast on
           purpose -- it should register as atmosphere, not as an animation. */
        @keyframes atriumBreathe {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50%      { opacity: 1;    transform: scale(1.08); }
        }

        /* Scroll reveal. Sections start slightly low and transparent, and the
           observer adds .is-revealed as each enters view. */
        [data-reveal] {
          opacity: 0;
          transform: translateY(28px);
          transition: opacity 0.7s cubic-bezier(0.22, 1, 0.36, 1),
                      transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
          will-change: opacity, transform;
        }
        [data-reveal].is-revealed {
          opacity: 1;
          transform: translateY(0);
        }

        /* Honour the OS setting: no reveal offset, no breathing, no parallax
           transitions. The observer also marks everything revealed up front so
           content can never be left invisible. */
        @media (prefers-reduced-motion: reduce) {
          [data-reveal] {
            opacity: 1;
            transform: none;
            transition: none;
          }
        }
      `}</style>
      <DemoMotionStyles />
    </div>
  )
}
