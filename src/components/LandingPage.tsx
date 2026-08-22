import { useState, useEffect, useMemo, useRef } from 'react'
import { isDesktop } from '../lib/supabase'
import PortalLoop from './PortalLoop'
import ContributePanel from './ContributePanel'
import { useLandingTheme } from '../lib/useLandingTheme'
import DonateButton, { DONATE_CUT } from './DonateButton'
import ThemeToggle from './ThemeToggle'
import LanguageToggle from './LanguageToggle'
import { useTranslation } from '../lib/i18n'
import RichText from './RichText'
import ConnectTiles from './ConnectTiles'
import type { TranslationKey } from '../locales/en'
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
          boxShadow: '0 24px 60px rgb(var(--c-ground) / 0.55)',
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
              'repeating-linear-gradient(0deg, transparent, transparent 2px, rgb(var(--c-fg) / 0.5) 2px, rgb(var(--c-fg) / 0.5) 4px)',
          }}
        />
        {/* Vignette so the frame's edges sink into the page instead of ending
            on a hard rectangle */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ boxShadow: 'inset 0 0 90px 20px rgb(var(--c-ground) / 0.9)' }}
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
  const { t } = useTranslation()
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
          <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-accent) / 0.27)` }} />
          <h2 className="text-3xl md:text-4xl font-normal tracking-[0.05em] uppercase text-nier-strong leading-none">
            {t('landing.nav.support')}
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
        </div>

        <div className="grid md:grid-cols-2 gap-10 items-start">
          <div className="space-y-4">
            <p className="text-nier-bg/80 text-base leading-relaxed tracking-wide">{t('landing.support.body1')}</p>
            <p className="text-nier-bg/70 text-base leading-relaxed tracking-wide">{t('landing.support.body2')}</p>
          </div>

          <div className="relative">
            <div className="absolute -top-2 -left-2 w-6 h-6 border-l border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute -bottom-2 -right-2 w-6 h-6 border-r border-b border-nier-border/60 pointer-events-none" />
            <div className="border border-nier-border/30 bg-nier-black/60 p-6">
              {month && month.goalCents > 0 ? (
                <>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="font-mono text-xs tracking-[0.2em] uppercase text-nier-bg/70">{t('landing.support.thisMonth')}</span>
                    <span className="font-mono text-sm tracking-wider text-nier-strong">
                      {Math.round(month.totalCents / 100)} / {Math.round(month.goalCents / 100)} €
                    </span>
                  </div>
                  <div className="h-[4px] bg-nier-black border border-nier-border/30 overflow-hidden">
                    <div
                      className="h-full transition-all duration-700 ease-out"
                      style={{ width: `${percent}%`, background: 'rgb(var(--c-accent))' }}
                    />
                  </div>
                  <p className="font-mono text-xs tracking-[0.15em] uppercase text-nier-bg/70 mt-3">
                    {month.contributionCount === 0
                      ? 'Nobody yet this month'
                      : `${month.contributionCount} contribution${month.contributionCount === 1 ? '' : 's'} this month`}
                  </p>
                </>
              ) : (
                <p className="font-mono text-xs tracking-[0.15em] uppercase text-nier-bg/70">{t('landing.support.keptStanding')}</p>
              )}

              <div className="flex flex-col sm:flex-row gap-2 mt-6">
                {/* The orange lives here rather than on the contributors
                    page. This section has to earn attention among six others
                    on a page people scroll past; the contributors page has
                    nothing to compete with and shouldn't outshout the names
                    it exists to show. */}
                <DonateButton
                  onClick={() => setShowContribute(true)}
                  wrapperClassName="flex-1"
                  className="w-full py-3"
                />
                <button
                  type="button"
                  onClick={() => openContributors('/')}
                  className="flex-1 py-3 border border-nier-border/40 text-nier-bg/80 font-mono text-xs tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                >
                  {t('welcome.contributors')}
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

// It is the second stop on the page, and the first thing anybody should see:
// a page describing a place is weaker than the place moving.
function VideoShowcaseSection({ sectionRef }: { sectionRef: (el: HTMLElement | null) => void }) {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(true)

  return (
    <section ref={sectionRef} className="flex items-center justify-center px-5 sm:px-12 pt-24 pb-10 relative">
      <div className="max-w-4xl w-full mx-auto" data-reveal>
        <div className="flex items-center gap-3 mb-8">
          <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-accent) / 0.27)` }} />
          <h2 className="text-3xl md:text-4xl font-normal tracking-[0.05em] uppercase text-nier-strong leading-none">
            {t('landing.nav.preview')}
          </h2>
          <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
        </div>

        <div className="relative">
          <div className="absolute -top-2 -left-2 w-6 h-6 border-l border-t border-nier-border/60 z-10 pointer-events-none" />
          <div className="absolute -top-2 -right-2 w-6 h-6 border-r border-t border-nier-border/60 z-10 pointer-events-none" />
          <div className="absolute -bottom-2 -left-2 w-6 h-6 border-l border-b border-nier-border/60 z-10 pointer-events-none" />
          <div className="absolute -bottom-2 -right-2 w-6 h-6 border-r border-b border-nier-border/60 z-10 pointer-events-none" />
          <div className="relative border border-nier-border/30 bg-nier-black overflow-hidden aspect-video" style={{ boxShadow: '0 24px 60px rgb(var(--c-ground) / 0.55)' }}>
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
                    'linear-gradient(rgb(var(--c-fg) / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-fg) / 0.05) 1px, transparent 1px)',
                  backgroundSize: '36px 36px',
                }}
              >
                <div className="w-3 h-3 rotate-45 border animate-pulse" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 12px rgb(var(--c-accent) / 0.33)` }} />
                <p className="font-mono text-sm tracking-[0.3em] uppercase text-nier-bg/80">{t('landing.preview.transmission')}</p>
                <p className="font-mono text-xs tracking-[0.18em] uppercase text-nier-bg/70">{t('landing.preview.recording')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

// The running order, and the order the page is written in. Index is identity
// here: it ties an entry to its ref in sectionRefs, so these two must move
// together. Anything jumping to a section by name should go through
// sectionIndex() rather than counting.
//
// Seeing the place comes before reading about it, which is why the reel is
// second and the explanations are further down. The ask sits third, while
// somebody has just watched what they would be paying for, rather than at the
// bottom where only the already-convinced arrive.
const sections: Section[] = [
  { id: 'hero', title: 'The Digital Atrium', subtitle: 'A museum of references created by you' },
  { id: 'preview', title: 'Preview', subtitle: 'A tour of the place' },
  { id: 'support', title: 'Support Me', subtitle: 'What holds the atrium up' },
  { id: 'creator', title: 'The Creator', subtitle: 'How this came to be' },
  { id: 'about', title: 'About', subtitle: 'What an atrium actually is' },
  { id: 'limitations', title: 'Limitations', subtitle: 'Where the free tier stops' },
  { id: 'desktop', title: 'Desktop App', subtitle: 'Your atriums, stored locally' },
  { id: 'navigation', title: 'Navigation', subtitle: 'Move, create, collaborate' },
]

const sectionIndex = (id: string) => sections.findIndex(section => section.id === id)

// The sticky bar's height (h-14). Both the jump and the scroll-spy measure
// against it, so it is written once.
const NAV_HEIGHT = 56

// The bar across the top.
//
// The page had only the HUD rail down the right edge, which is handsome and is
// not what anybody arriving from the rest of the web looks for. A website says
// what it contains along its top edge; this one does that, and keeps the rail
// on screens wide enough to carry both.
//
function TopNav({ items, activeSection, onJump, onDonate }: {
  // Each item carries the index it has in `sections`, because the bar does not
  // show all of them: the title section is reached by the mark on the left, and
  // Desktop App is dropped inside the desktop build. Counting the rendered
  // items instead would send every entry after a hidden one to the wrong place.
  items: { id: string; title: string; index: number }[]
  activeSection: number
  onJump: (index: number) => void
  onDonate: () => void
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // The two ways out of a menu somebody opened by accident.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const active = items.find(item => item.index === activeSection)

  return (
    <div className="sticky top-0 z-50">
      <div
        className="backdrop-blur-md border-b border-nier-border/25"
        style={{ background: 'rgb(var(--c-ground) / 0.82)' }}
      >
        {/* Three columns rather than a row of three things.

            A flex row with mx-auto on the middle child centres it in whatever
            space the other two leave, so the sections drifted left or right
            depending on how wide the language made the buttons beside them.
            A grid whose outer columns are 1fr puts the middle one in the
            centre of the bar itself, and it stays there in every language. */}
        {/* Edge to edge, not a centred column.

            max-w-7xl held the bar to 1280px and centred it, so on a 1920
            screen there were 320 dead pixels between the window and the name
            -- the bar looked inset from a page that runs the full width. The
            grid stays, because it is what keeps the sections centred in every
            language; only the cap is gone. What is left either side is the
            padding, which is there so nothing touches the glass. */}
        <div className="px-4 sm:px-6 h-14 grid grid-cols-[1fr_auto_1fr] items-center gap-4">

          {/* The mark and the name, which together are the way back to the
              top -- so the title section needs no entry of its own in the bar.

              The mark is the app's own icon, which is white line-work on an
              opaque black square: as an image it would be a black tile on the
              light theme. It is painted as a mask instead, so it takes the
              foreground ink and is the right colour in both. */}
          {/* The name and, when the sections have collapsed, the button that
              holds them -- one group at the left edge. The menu button used to
              sit in the middle column, which put the way into the sections
              nowhere near the thing it belongs to. */}
          <div className="flex items-center gap-3 justify-self-start min-w-0">
          <button
            type="button"
            onClick={() => onJump(0)}
            className="flex items-center gap-2.5 shrink-0 group"
            title={t('landing.backToTop')}
          >
            <span
              aria-hidden="true"
              className="w-6 h-6 shrink-0 bg-nier-strong transition-opacity opacity-90 group-hover:opacity-100"
              style={{
                WebkitMaskImage: 'url(/atrium-mark.png)',
                maskImage: 'url(/atrium-mark.png)',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
              }}
            />
            <span className="hidden sm:inline text-nier-strong text-sm tracking-[0.22em] uppercase whitespace-nowrap">
              The Digital Atrium
            </span>
          </button>

          {/* Three lines, drawn rather than typed: the glyph everybody already
              reads as "the rest of the menu is in here", in the app's own
              weight. It carries the section you are in beside it where there
              is room, so the bar still answers "where am I" without the menu
              being open. */}
          <div ref={menuRef} className="relative 2xl:hidden shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen(open => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label={t('landing.sections')}
              className="cut-corner inline-flex items-center gap-2 h-[2.125rem] px-3 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/70 transition-colors"
              style={{ backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
            >
              <span className="flex flex-col gap-[3px]" aria-hidden="true">
                <span className="block w-4 h-px bg-current" />
                <span className="block w-4 h-px bg-current" />
                <span className="block w-4 h-px bg-current" />
              </span>
              <span className="hidden sm:inline text-[11px] tracking-[0.1em] uppercase whitespace-nowrap max-w-[9rem] truncate">
                {active ? t(`landing.nav.${active.id}` as TranslationKey) : t('landing.sections')}
              </span>
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="panel-in absolute left-0 top-[calc(100%+6px)] z-[10000200] min-w-[12rem] border border-nier-border/40 py-1 max-h-[70vh] overflow-y-auto"
                style={{ backgroundColor: 'rgb(var(--c-surface))' }}
              >
                {items.map(({ id, index }) => {
                  const isActive = activeSection === index
                  return (
                    <button
                      key={id}
                      type="button"
                      role="menuitem"
                      onClick={() => { onJump(index); setMenuOpen(false) }}
                      className={`w-full px-4 py-2.5 text-left text-[11px] tracking-[0.12em] uppercase transition-colors flex items-center justify-between gap-3 ${
                        isActive ? 'text-nier-strong bg-nier-bg/10' : 'text-nier-bg/80 hover:text-nier-strong hover:bg-nier-bg/5'
                      }`}
                    >
                      <span>{t(`landing.nav.${id}` as TranslationKey)}</span>
                      {isActive && <span className="text-[10px]" style={{ color: '#FF8A3D' }}>◇</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          </div>


          {/* The sections, two ways.

              Inline from 2xl up, and a menu below that. The wordmark now
              holds its place on the left at every width, which costs the row
              about 200px -- enough that the longest language (Spanish, a
              quarter longer than English) no longer fits beside it at 1280.
              Rather than drop the name the moment a language gets wordy, the
              inline row waits for a screen with room for both.

              Separated by rules, because seven titles in one typeface at one
              size with even spacing read as a sentence of unrelated words
              rather than as seven things you can choose between. */}
          <nav className="hidden 2xl:flex items-center justify-self-center min-w-0">
            {items.map(({ id, index }, i) => {
              const isActive = activeSection === index
              return (
                <div key={id} className="flex items-center">
                  {i > 0 && (
                    <span aria-hidden="true" className="h-3 w-px bg-nier-border/25 mx-1" />
                  )}
                  <button
                    type="button"
                    onClick={() => onJump(index)}
                    className={`relative whitespace-nowrap px-3 py-2 text-[11px] tracking-[0.1em] uppercase transition-colors ${
                      isActive ? 'text-nier-strong' : 'text-nier-bg/65 hover:text-nier-bg'
                    }`}
                  >
                    {t(`landing.nav.${id}` as TranslationKey)}
                    {isActive && (
                      <span
                        className="absolute left-3 right-3 -bottom-px h-[2px]"
                        style={{ background: '#FF8A3D' }}
                      />
                    )}
                  </button>
                </div>
              )
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0 justify-self-end">
            <LanguageToggle />

            <ThemeToggle />

            <DonateButton onClick={onDonate} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage({ onGetStarted, isAuthenticated }: LandingPageProps) {
  const { t } = useTranslation()
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

      // The section whose top edge has most recently passed under the bar.
      //
      // This used to be "the last section whose top is above the middle of the
      // window", which breaks for any section shorter than half a screen:
      // jumping to Support Me put its top at the bar and The Creator's top at
      // 600px, both above the midpoint, so the bar lit The Creator and the
      // page looked like it had scrolled straight past what you clicked.
      let currentSection = 0
      sectionRefs.current.forEach((ref, index) => {
        if (ref && ref.getBoundingClientRect().top <= NAV_HEIGHT + 24) {
          currentSection = index
        }
      })
      setActiveSection(currentSection)
    }

    const container = containerRef.current
    container?.addEventListener('scroll', handleScroll)
    return () => container?.removeEventListener('scroll', handleScroll)
  }, [])

  // Indices stay tied to sectionRefs, so entries are filtered out AFTER
  // indexing rather than removed -- dropping one would shift every section
  // below it out of sync with its ref. (The old version filtered first and
  // then let the bar count its own rows, which sent everything after Desktop
  // App to the wrong section inside the desktop build.)
  const navItems = sections
    .map((section, index) => ({ ...section, index }))
    .filter(({ id }) => id !== 'hero' && !(isDesktop && id === 'desktop'))

  // scrollIntoView puts the section's top edge at the container's top edge,
  // which is underneath the sticky bar -- so every jump hid its own heading
  // behind the thing you clicked. Scroll the container by hand instead, with
  // the bar's height taken off.
  const scrollToSection = (index: number) => {
    const target = sectionRefs.current[index]
    const container = containerRef.current
    if (!target || !container) return
    const top =
      target.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      NAV_HEIGHT
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }

  // The bar's Donate opens the panel and moves the page under it.
  //
  // Somebody who closes the panel without paying -- or after paying -- is put
  // down in front of the section that explains what the money is for, rather
  // than back wherever they happened to be reading. The scroll happens behind
  // the panel, so it costs them nothing either way.
  //
  // Only this one. The Donate at the foot of the page is already at the end of
  // the argument, and throwing somebody back up the page from there would be
  // taking them somewhere they had already been.
  const handleBarDonate = () => {
    scrollToSection(sectionIndex('support'))
    setShowDonate(true)
  }

  return (
    <div 
      ref={containerRef}
      data-landing-theme={theme.resolved}
      className="h-screen bg-nier-black text-nier-bg overflow-y-auto overflow-x-hidden scroll-smooth"
    >
      <TopNav
        items={navItems}
        activeSection={activeSection}
        onJump={scrollToSection}
        onDonate={handleBarDonate}
      />

      {showDonate && <ContributePanel onClose={() => setShowDonate(false)} />}

      {/* Fixed overlays */}
      {/* Scanline overlay */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.02] z-50"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgb(var(--c-fg) / 0.1) 2px, rgb(var(--c-fg) / 0.1) 4px)',
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
              className="group relative flex items-center transition-all duration-300"
            >
              {/* The name, out of the flow and deaf to the pointer.
                  
                  It used to sit in the row as a sibling of the mark, which
                  meant the button was as wide as the longest section name --
                  so the label appeared when the pointer crossed the empty
                  space where it would be, several centimetres from anything
                  visible. Absolute and pointer-events-none leaves the button
                  exactly the size of the mark, which is the only thing on
                  screen to aim at. */}
              <span 
                className={`pointer-events-none absolute right-full mr-3 whitespace-nowrap text-xs tracking-[0.15em] uppercase transition-all duration-300 hidden sm:inline opacity-0 group-hover:opacity-100 ${
                  isActive ? 'text-nier-strong' : 'text-nier-bg/75'
                }`}
              >
                {t(`landing.nav.${section.id}` as TranslationKey)}
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
                  style={isActive ? { backgroundColor: 'rgb(var(--c-accent))', boxShadow: `0 0 10px rgb(var(--c-accent) / 0.67)` } : undefined}
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
          <span className="text-[11px] text-nier-bg/70 tracking-widest -mr-2">
            {Math.round(scrollProgress * 100)}%
          </span>
        </div>
      </div>

      {/* SECTION 1: The Digital Atrium -- the title */}
      <section
        ref={el => sectionRefs.current[0] = el}
        className="min-h-[calc(100vh-3.5rem)] flex items-center px-5 sm:px-10 lg:px-16 pt-10 pb-24 relative overflow-hidden"
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
          <PortalLoop className="h-[60vh] lg:h-[85vh] max-h-[820px]" playbackRate={0.5} ink={theme.resolved === 'light'} />
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
            background: `radial-gradient(circle, rgb(var(--c-accent) / 0.12), transparent 68%)`,
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
            <div className="inline-flex items-center gap-3 border px-3 py-1.5 mb-8" style={{ borderColor: `rgb(var(--c-accent) / 0.25)`, backgroundColor: `rgb(var(--c-accent) / 0.04)` }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rotate-45 opacity-75 animate-ping" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
                <span className="relative inline-flex h-1.5 w-1.5 rotate-45" style={{ backgroundColor: 'rgb(var(--c-accent))' }} />
              </span>
              <span className="text-xs tracking-[0.28em] uppercase" style={{ color: `rgb(var(--c-accent) / 0.9)` }}>{t('landing.hero.tagline')}</span>
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
                style={{ textShadow: '0 0 60px rgb(var(--c-strong) / 0.14)' }}
              >
                DIGITAL
              </span>
              <span
                className="block text-[clamp(3.4rem,9vw,7.5rem)]"
                style={{
                  backgroundImage: 'var(--metal-title)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                  // On black this is the metal throwing light. On paper a dark
                  // halo behind dark letters is just a smudge, so it goes.
                  filter: 'drop-shadow(0 0 34px rgb(var(--c-shimmer) / 0.22))',
                }}
              >
                ATRIUM
              </span>
            </h1>

            <p className="text-nier-bg/80 text-lg md:text-xl font-light leading-relaxed max-w-md mb-9">{t('landing.hero.sub1')}<span className="block text-nier-bg/70 text-base mt-2">{t('landing.hero.sub2')}</span>
            </p>

            {/* Filled rather than outlined. Previously the call to action had
                the same visual weight as every other bordered box on the page,
                so the one thing a visitor should do didn't stand out. */}
            <div className="flex flex-wrap items-center gap-4 mb-10">
              <button
                onClick={onGetStarted}
                className="group relative px-8 py-4 text-base tracking-[0.18em] uppercase font-medium transition-all duration-300"
                style={{
                  clipPath: DONATE_CUT,
                  backgroundColor: 'rgb(var(--c-accent))',
                  // The ground, not black. The button is filled with the
                  // strong neutral, which is bone on a dark page and ink on a
                  // light one -- a fixed dark label works on the first and
                  // disappears into the second.
                  color: 'rgb(var(--c-ground))',
                  boxShadow: `0 0 0 rgba(0,0,0,0)`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = `0 10px 40px rgb(var(--c-accent) / 0.33)`
                  e.currentTarget.style.transform = 'translateY(-2px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 0 0 rgba(0,0,0,0)'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
              >
                {isAuthenticated ? t('landing.continue') : t('landing.enter')}
              </button>

              {/* Secondary path, inline with the primary one. Scrolls rather
                  than downloading: the desktop section explains what actually
                  differs and which platform to pick, which is worth reading
                  before committing to a 20MB install. Web only -- inside the
                  desktop build it would scroll to a section that isn't there. */}
              {!isDesktop && (
                <>
                  <span className="text-nier-bg/50 text-sm tracking-[0.2em] uppercase">{t('landing.or')}</span>
                  <button
                    onClick={() => scrollToSection(sectionIndex('desktop'))}
                    className="group px-6 py-4 border-2 text-base tracking-[0.18em] uppercase transition-all duration-300"
                    style={{ clipPath: DONATE_CUT, borderColor: 'rgb(var(--c-accent) / 0.33)', color: 'rgb(var(--c-accent) / 0.87)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'rgb(var(--c-accent))'
                      e.currentTarget.style.backgroundColor = `rgb(var(--c-accent) / 0.06)`
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = `rgb(var(--c-accent) / 0.33)`
                      e.currentTarget.style.backgroundColor = 'transparent'
                    }}
                  >
                    ↓ {t('landing.hero.download')}
                  </button>
                </>
              )}
            </div>

            {/* Moved below the buttons rather than sitting beside them: with
                two actions inline, a third inline item made the row read as
                three peers. */}
            {!isAuthenticated && (
              <p className="text-nier-bg/70 text-sm tracking-wider mb-10 -mt-6">{t('landing.hero.free')}</p>
            )}


            {/* Three pillars as a rule-separated row rather than floating chips,
                so they read as one grounded line under the actions. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-7 border-t border-nier-border/15 text-xs tracking-[0.16em] uppercase text-nier-bg/80">
              {([
                { label: 'Infinite Canvas', key: 'landing.feature.canvas', color: 'rgb(var(--c-accent))' },
                { label: 'Private Atriums', key: 'landing.feature.atriums', color: 'rgb(var(--c-emerald))' },
                { label: 'Live Presence', key: 'landing.feature.presence', color: 'rgb(var(--c-sky))' },
              ] as const).map(({ label, key, color }) => (
                <div key={label} className="flex items-center gap-2 group/feat">
                  <div
                    className="w-1.5 h-1.5 rotate-45 transition-transform duration-300 group-hover/feat:scale-150"
                    style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}AA` }}
                  />
                  <span className="transition-colors duration-300 group-hover/feat:text-nier-bg">{t(key)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: the product, and whose it is.

              The credit sits on the frame's top edge rather than under the
              buttons on the left, where it was a line of small print among
              other lines of small print. Here it reads the way a plate beside
              a piece does: the name is the loud part, "made by" is the quiet
              label above it, and the whole block is the door to the rest of
              the story. */}
          <div className="relative">
            <button
              type="button"
              onClick={() => scrollToSection(sectionIndex('creator'))}
              // w-fit rather than the full column: the button was as wide as
              // the row it sat in, so most of its hit area was empty space to
              // the left of the words and the words themselves were only part
              // of what answered. Now the target is exactly the three lines
              // that look like a target, and all three of them respond to the
              // hover together -- a name that stays inert while the arrow
              // under it moves reads as a caption above a link, not as one
              // thing you can press.
              className="group w-fit ml-auto mb-8 lg:mb-12 lg:-mt-10 flex flex-col items-end text-right cursor-pointer"
            >
              <span className="byline flex items-center gap-2.5 text-[11px] sm:text-xs tracking-[0.3em] uppercase">
                <span className="byline-mark w-2 h-2 rotate-45" />
                {t('landing.madeBy')}
              </span>
              <span className="mt-2.5 text-xl sm:text-2xl tracking-[0.12em] uppercase text-nier-strong leading-none transition-opacity duration-300 opacity-90 group-hover:opacity-100">
                Eduardo Paranhos
              </span>
              <span className="byline-link mt-3 flex items-center gap-2 text-xs sm:text-[13px] tracking-[0.18em] uppercase text-nier-bg/70">
                {t('landing.aboutCreator')}
                <span className="transition-transform duration-300 group-hover:translate-y-0.5">↓</span>
              </span>
              {/* The rule draws itself in under the whole thing on hover, the
                  way the name rule on the contributors wall does. */}
              <span className="byline-rule mt-2 block h-px w-full origin-right scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
            </button>
            <ShowcaseFrame />
          </div>
        </div>

        {/* Scroll hint, pinned low but out of the content's way */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-pulse pointer-events-none">
          <span className="text-xs text-nier-bg/70 tracking-[0.2em] uppercase">{t('landing.hero.scroll')}</span>
          <div className="w-px h-8 bg-gradient-to-b from-nier-border/40 to-transparent" />
        </div>
      </section>

      {/* SECTION 2: Preview -- the reel. Early, because a page about a place
          is weaker than seeing the place. */}
      <VideoShowcaseSection sectionRef={el => sectionRefs.current[1] = el} />
      {/* SECTION 3: Support Me */}
      <ContributionsSection sectionRef={el => sectionRefs.current[2] = el} />
      {/* SECTION 4: The Creator */}
      <section 
        ref={el => sectionRefs.current[3] = el}
        className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
      >
        <div className="max-w-2xl w-full mx-auto text-center" data-reveal>
          {/* Section header */}
          <div className="flex items-center justify-center gap-3 mb-10">
            <div className="flex-1 h-px bg-gradient-to-l from-nier-border/40 to-transparent max-w-[80px]" />
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-accent) / 0.27)` }} />
            <h2 className="text-3xl md:text-4xl font-normal tracking-[0.05em] uppercase text-nier-strong leading-none">
              {t('landing.nav.creator')}
            </h2>
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-accent) / 0.27)` }} />
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent max-w-[100px]" />
          </div>

          {/* Placeholder for personal content */}
          <div className="border border-nier-border/30 p-4 sm:p-6 md:p-10 bg-nier-black/30 mb-6">
            <p className="text-nier-bg/75 text-base leading-relaxed mb-6 italic">{t('landing.creator.p1')}</p>

            <div className="w-16 h-px bg-nier-border/30 mx-auto mb-6" />

            <p className="text-nier-bg/75 text-base leading-relaxed italic">{t('landing.creator.p2')}</p>
          </div>

          {/* Where else to find him.
              
              This was four dim words on one line, at the bottom of a long
              page, reading as a footnote to a footnote. It is the end of the
              creator's story and the only place on the site that points
              anywhere else, so it is built like the rest of the page: a header
              with rules, and tiles with the cut corner every other reachable
              thing here wears. */}
          <div className="max-w-3xl mx-auto w-full">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1 h-px bg-gradient-to-l from-nier-border/40 to-transparent" />
              <span className="text-nier-strong text-xs sm:text-sm tracking-[0.3em] uppercase whitespace-nowrap">
                {t('support.connect')}
              </span>
              <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
            </div>

            <ConnectTiles columns={4} />
          </div>

        </div>
      </section>
      {/* SECTION 5: About */}
      <section 
        ref={el => sectionRefs.current[4] = el}
        className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
      >
        <div className="max-w-3xl w-full mx-auto" data-reveal>
          {/* Section header */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-accent) / 0.27)` }} />
            <h2 className="text-3xl md:text-4xl font-normal tracking-[0.05em] uppercase text-nier-strong leading-none">
              {t('landing.nav.about')}
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <p className="text-nier-bg/80 text-base md:text-lg leading-relaxed">
                <RichText text={t('landing.about.lead')} className="text-nier-bg" />
              </p>
              <p className="text-nier-bg/80 text-base leading-relaxed">{t('landing.about.p2')}</p>
              <p className="text-nier-bg/80 text-base leading-relaxed">{t('landing.about.p3')}</p>

              {/* An atrium from above: scattered traces, other visitors, and
                  the bracket viewport is you -- the concept the paragraphs
                  describe, drawn instead of described. */}
              <AtriumMapDiagram />
              <p className="font-mono text-xs tracking-[0.18em] uppercase text-nier-bg/70 -mt-2">{t('landing.about.diagram')}</p>
            </div>

            <div className="space-y-4">
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45" style={{ backgroundColor: 'rgb(var(--c-accent))', boxShadow: `0 0 8px rgb(var(--c-accent) / 0.53)` }} />
                  <span className="text-base tracking-[0.1em] uppercase text-nier-bg">{t('landing.about.traces')}</span>
                </div>
                <p className="text-nier-bg/75 text-base leading-relaxed">{t('landing.about.tracesDesc')}</p>
              </div>
              
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45" style={{ backgroundColor: 'rgb(var(--c-emerald))', boxShadow: `0 0 8px rgb(var(--c-emerald) / 0.53)` }} />
                  <span className="text-base tracking-[0.1em] uppercase text-nier-bg">{t('landing.about.atriums')}</span>
                </div>
                <p className="text-nier-bg/75 text-base leading-relaxed">{t('landing.about.atriumsDesc')}</p>
              </div>
              
              <div className="border border-nier-border/30 p-6 bg-nier-black/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2 h-2 rotate-45" style={{ backgroundColor: 'rgb(var(--c-sky))', boxShadow: `0 0 8px rgb(var(--c-sky) / 0.53)` }} />
                  <span className="text-base tracking-[0.1em] uppercase text-nier-bg">{t('landing.about.presence')}</span>
                </div>
                <p className="text-nier-bg/75 text-base leading-relaxed">{t('landing.about.presenceDesc')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
      {/* SECTION 6: Limitations */}
      <section
        ref={el => sectionRefs.current[5] = el}
        className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
      >
        <div className="max-w-2xl w-full mx-auto text-center" data-reveal>
          {/* Section header */}
          <div className="flex items-center justify-center gap-3 mb-10">
            <div className="flex-1 h-px bg-gradient-to-l from-nier-border/40 to-transparent max-w-[80px]" />
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-accent) / 0.27)` }} />
            <h2 className="text-3xl md:text-4xl font-normal tracking-[0.05em] uppercase text-nier-strong leading-none">
              {t('landing.nav.limitations')}
            </h2>
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-accent) / 0.27)` }} />
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent max-w-[80px]" />
          </div>

          <p className="text-nier-bg/80 text-lg md:text-xl font-light tracking-wide mb-8 italic">{t('landing.limits.question')}</p>

          <div className="border border-nier-border/30 p-6 sm:p-8 md:p-10 bg-nier-black/30 mb-8 text-left">
            <p className="text-nier-bg/80 text-base leading-relaxed mb-6">
              <RichText text={t('landing.limits.secret')} className="text-nier-strong" />
            </p>

            <div className="w-16 h-px bg-nier-border/30 mx-auto mb-6" />

            <p className="text-nier-bg/80 text-base leading-relaxed mb-6">{t('landing.limits.freeTier')}</p>

            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              <div className="border border-nier-border/20 p-5 bg-nier-black/40">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-base font-mono">3</span>
                  </div>
                  <span className="text-nier-strong text-base tracking-wider uppercase">{t('landing.limits.perUser')}</span>
                </div>
                <p className="text-nier-bg/70 text-sm leading-relaxed">{t('landing.limits.perUserDesc')}</p>
              </div>

              <div className="border border-nier-border/20 p-5 bg-nier-black/40">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-sm font-mono">10<span className="text-[11px]">MB</span></span>
                  </div>
                  <span className="text-nier-strong text-base tracking-wider uppercase">{t('landing.limits.perAtrium')}</span>
                </div>
                <p className="text-nier-bg/70 text-sm leading-relaxed">{t('landing.limits.perAtriumDesc')}</p>
              </div>
            </div>

            <p className="text-nier-bg/75 text-base leading-relaxed text-center italic">{t('landing.limits.plenty')}</p>
          </div>
        </div>
      </section>
      {/* SECTION 7: Desktop App -- web only. Inside the desktop build this is
          an advert for the thing you're already running, and its download
          links would be nonsense there. */}
      {!isDesktop && (
        <section
          ref={el => sectionRefs.current[6] = el}
          className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
        >
          <DesktopAppSection />
        </section>
      )}
      {/* SECTION 8: Navigation */}
      <section 
        ref={el => sectionRefs.current[7] = el}
        className="min-h-screen flex items-center justify-center px-5 sm:px-12 py-20 relative"
      >
        <div className="max-w-3xl w-full mx-auto" data-reveal>
          {/* Section header */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-3 h-3 rotate-45 border" style={{ borderColor: `rgb(var(--c-accent) / 0.67)`, boxShadow: `0 0 10px rgb(var(--c-accent) / 0.27)` }} />
            <h2 className="text-3xl md:text-4xl font-normal tracking-[0.05em] uppercase text-nier-strong leading-none">
              {t('landing.nav.navigation')}
            </h2>
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/40 to-transparent" />
          </div>

          <div className="space-y-10">
            {/* Controls */}
            <div>
              <h3 className="text-lg tracking-[0.1em] uppercase text-nier-strong mb-5 flex items-center gap-3">
                <span className="text-nier-bg/70">01</span>
                {t('landing.nav.controls')}
              </h3>
              {/* The two gestures, performed: the cursor drags and the world
                  moves, then the scroll pulse zooms it. */}
              <PanZoomDemo />
              <div className="grid sm:grid-cols-3 gap-4">
                {[
                  { key: t('landing.controls.dragKey'), desc: t('landing.controls.drag') },
                  { key: t('landing.controls.scrollKey'), desc: t('landing.controls.scroll') },
                  { key: t('landing.controls.tKeyKey'), desc: t('landing.controls.tKey') },
                ].map((control, i) => (
                  <div key={i} className="border border-nier-border/20 p-3 sm:p-4 bg-nier-black/30">
                    <div className="text-nier-strong text-base font-mono mb-2">{control.key}</div>
                    <div className="text-nier-bg/75 text-sm">{control.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Creating traces */}
            <div>
              <h3 className="text-lg tracking-[0.1em] uppercase text-nier-strong mb-5 flex items-center gap-3">
                <span className="text-nier-bg/70">02</span>{t('landing.nav.leavingTraces')}</h3>
              <div className="border border-nier-border/30 p-4 sm:p-5 bg-nier-black/30 sm:flex sm:items-center sm:gap-6">
                <div className="flex-1">
                <p className="text-nier-bg/80 text-base leading-relaxed mb-3">{t('landing.nav.chooseBetween')}</p>
                <div className="flex flex-wrap gap-4 sm:gap-6 text-base">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-bg/80"><span className="text-nier-bg">{t('landing.nav.text')}</span>{t('landing.nav.textDesc')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-bg/80"><span className="text-nier-bg">{t('landing.nav.embed')}</span>{t('landing.nav.embedDesc')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                    <span className="text-nier-bg/80"><span className="text-nier-bg">{t('landing.nav.shape')}</span>{t('landing.nav.shapeDesc')}</span>
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
              <h3 className="text-lg tracking-[0.1em] uppercase text-nier-strong mb-5 flex items-center gap-3">
                <span className="text-nier-bg/70">03</span>{t('landing.nav.addingContent')}</h3>
              <div className="border border-nier-border/30 p-4 sm:p-5 bg-nier-black/30">
                <p className="text-nier-bg/80 text-base leading-relaxed mb-3">{t('landing.nav.contentDesc')}</p>
                <div className="flex flex-wrap gap-4 text-base">
                  {[
                    { name: 'YouTube', desc: t('landing.platform.youtube') },
                    { name: 'Pinterest', desc: t('landing.platform.pinterest') },
                    { name: 'Imgur', desc: t('landing.platform.imgur') },
                    { name: 'Instagram', desc: t('landing.platform.instagram') },
                    { name: 'SoundCloud', desc: t('landing.platform.soundcloud') },
                  ].map((platform, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rotate-45 bg-nier-border/60" />
                      <span className="text-nier-bg/80"><span className="text-nier-strong">{platform.name}</span> — {platform.desc}</span>
                    </div>
                  ))}
                </div>
                <p className="text-nier-bg/70 text-sm mt-4 italic">{t('landing.nav.copyEmbed')}</p>
              </div>
            </div>

            {/* The ecosystem */}
            <div>
              <h3 className="text-lg tracking-[0.1em] uppercase text-nier-strong mb-5 flex items-center gap-3">
                <span className="text-nier-bg/70">04</span>{t('landing.nav.ecosystem')}</h3>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="text-center p-3 sm:p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-xl">1</span>
                  </div>
                  <h4 className="text-nier-bg text-base tracking-wider uppercase mb-2">{t('landing.nav.create')}</h4>
                  <p className="text-nier-bg/75 text-sm leading-relaxed">{t('landing.nav.createDesc')}</p>
                  <CreateTraceDemo />
                </div>
                <div className="text-center p-3 sm:p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-xl">2</span>
                  </div>
                  <h4 className="text-nier-bg text-base tracking-wider uppercase mb-2">{t('landing.nav.populate')}</h4>
                  <p className="text-nier-bg/75 text-sm leading-relaxed">{t('landing.nav.populateDesc')}</p>
                  <PopulateDemo />
                </div>
                <div className="text-center p-3 sm:p-6">
                  <div className="w-12 h-12 mx-auto mb-4 border border-nier-border/40 rotate-45 flex items-center justify-center">
                    <span className="text-nier-bg -rotate-45 text-xl">3</span>
                  </div>
                  <h4 className="text-nier-bg text-base tracking-wider uppercase mb-2">{t('landing.nav.explore')}</h4>
                  <p className="text-nier-bg/75 text-sm leading-relaxed">{t('landing.nav.exploreDesc')}</p>
                  <ExploreDemo />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>



      {/* The end of the page, and the two things somebody might want when
          they get there: the door in, and the way to keep it open.

          These used to sit in the middle of The Creator, so a reader who kept
          going scrolled past the closing handshake and carried on through
          three more sections. Whatever is last on a page is what it leaves
          people with, and this is what it should be. */}
      <section className="px-5 sm:px-12 pt-10 pb-24 relative">
        <div className="max-w-3xl mx-auto w-full text-center" data-reveal>
          <div className="h-px bg-gradient-to-r from-transparent via-nier-border/30 to-transparent mb-12" />

          <div className="flex items-center justify-center gap-3 mb-9">
            <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
            <div className="w-3 h-3 rotate-45 border border-nier-border/60 bg-nier-blackLight" />
            <div className="w-2 h-2 rotate-45 border border-nier-border/40" />
          </div>

          {/* Filled rather than outlined. It was a transparent box with dim
              type -- the quietest thing on the page, at the moment the page is
              asking for the only decision it wants. The fill is the foreground
              ink and the label is the page, so it inverts with the theme, the
              way Enter does on every atrium in the browser. */}
          <button
            onClick={onGetStarted}
            className="group relative px-12 py-4 bg-nier-bg text-nier-black hover:bg-nier-strong transition-colors duration-300"
            style={{ clipPath: DONATE_CUT }}
          >
            <span className="text-base tracking-[0.2em] uppercase font-medium">
              {isAuthenticated ? t('landing.continue') : t('landing.hero.beginJourney')}
            </span>
          </button>

          {/* Two different asks, and they should not read as one block of
              buttons. A hairline with a diamond on it separates them the way
              the rest of the page separates anything from anything. */}
          <div className="mt-14 mb-12 flex items-center justify-center gap-4" aria-hidden="true">
            <div className="h-px w-16 sm:w-24 bg-gradient-to-l from-nier-border/35 to-transparent" />
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/50" />
            <div className="h-px w-16 sm:w-24 bg-gradient-to-r from-nier-border/35 to-transparent" />
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-5 text-center sm:text-left">
            <p className="text-nier-bg/75 text-base leading-relaxed tracking-wide max-w-sm">{t('landing.closing.free')}</p>
            <DonateButton onClick={() => setShowDonate(true)} className="px-7 py-3 text-sm" />
          </div>
        </div>
      </section>

      {/* Footer */}
      {/* The footer, in the page's own language rather than a grey line of
          text: the mark, the name under a rule, and the small print beneath
          it. Centred, because there is not enough here to justify a row of
          columns pretending to be a site map. */}
      <footer className="border-t border-nier-border/20 py-14">
        <div className="max-w-4xl mx-auto px-6 flex flex-col items-center gap-7 text-center">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="w-7 h-7 shrink-0 bg-nier-strong opacity-80"
              style={{
                WebkitMaskImage: 'url(/atrium-mark.png)',
                maskImage: 'url(/atrium-mark.png)',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
              }}
            />
            <span className="text-nier-strong text-sm tracking-[0.28em] uppercase">
              The Digital Atrium
            </span>
          </div>

          <div className="flex items-center gap-4 w-full max-w-sm" aria-hidden="true">
            <div className="flex-1 h-px bg-gradient-to-l from-nier-border/30 to-transparent" />
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/50" />
            <div className="flex-1 h-px bg-gradient-to-r from-nier-border/30 to-transparent" />
          </div>

          {!isDesktop && (
            <div className="flex items-center gap-4">
              <a
                href="/privacy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nier-bg/70 hover:text-nier-strong text-xs tracking-[0.15em] uppercase transition-colors"
              >
                {t('landing.privacy')}
              </a>
              <span className="text-nier-bg/40 text-xs">◇</span>
              <a
                href="/terms.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-nier-bg/70 hover:text-nier-strong text-xs tracking-[0.15em] uppercase transition-colors"
              >
                {t('landing.terms')}
              </a>
            </div>
          )}

          {/* Shown on desktop too -- the copyright covers the app itself, not
              just the website. */}
          <div className="text-nier-bg/50 text-[0.7rem] tracking-[0.12em] uppercase">{t('landing.footer.copyright')}</div>
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
