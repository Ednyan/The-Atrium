// The landing page: a hall with one light, telling the Atrium's story. The
// portal hangs at the top -- its orb the light, the bits it sheds settling as
// traces in the grid below (components/PortalScene) -- and opens into the
// film; then what an atrium is, what can be brought in, what can be done
// there, why it exists (with the code growing down the margins to its
// history), the two ways in, and how to keep the light on. Who made it is a
// signature on the first screen, opening a panel. The chapters are in
// components/landing.
//
// NieR's language underneath: bone and ink, thin rules, diamonds and
// brackets, one warm light. Bolder on top: big type, off-centre layouts,
// things that slide and turn into view.

import TraceTitle from './TraceTitle'
import { useState, useEffect, useMemo, useRef } from 'react'
import { isDesktop } from '../lib/supabase'
import PortalScene from './PortalScene'
import ContributePanel from './ContributePanel'
import { useLandingTheme } from '../lib/useLandingTheme'
import DonateButton, { DONATE_CUT } from './DonateButton'
import ThemeToggle from './ThemeToggle'
import LanguageToggle from './LanguageToggle'
import { useTranslation } from '../lib/i18n'
import { contributionCountKey } from '../lib/monthlyGauge'
import type { TranslationKey } from '../locales/en'
import { openContributors } from '../lib/contributorsRoute'
import { getCachedContributions, startContributionsRefresh, type ContributionsData } from '../lib/contributions'
import { DesktopDownloads } from './DesktopAppSection'
import { watchCodeHistory } from '../lib/codeHistory'
import { useLandingMotion, type LandingMotion } from '../lib/landingMotion'
import SplitText from './reactbits/SplitText'
import { Brackets, ChapterLabel, Headline } from './landing/parts'
import CreatorSignature from './landing/CreatorSignature'
import FilmChapter from './landing/FilmChapter'
import InsideChapter from './landing/InsideChapter'
import TraceRibbon from './landing/TraceRibbon'
import ToolChapters from './landing/ToolChapters'
import WhyChapter from './landing/WhyChapter'
import CodeRoots from './landing/CodeRoots'

interface LandingPageProps {
  onGetStarted: () => void
  isAuthenticated?: boolean
  // Which section to open on, from the route. Absent means the top.
  section?: string
}

// Every kind of trace, in outline, running slowly past under the title -- the
// page's pulse. Each fills in under the pointer; the run pauses while it's
// there. Twice over, so it loops without a seam. Still for reduced motion.
const TICKER_KINDS = [
  'atrium.trace.type.text', 'atrium.trace.type.image', 'atrium.trace.type.video', 'atrium.trace.type.sound',
  'atrium.trace.type.document', 'atrium.trace.type.spreadsheet', 'atrium.trace.type.embed', 'atrium.trace.type.shape',
  'atrium.trace.shape.path', 'atrium.trace.type.drawing', 'atrium.trace.type.frame',
] as const
function TraceTicker() {
  const { t } = useTranslation()
  return (
    <div className="trace-ticker" aria-hidden="true">
      <div className="trace-ticker-track">
        {[0, 1].map(copy => (
          <div key={copy} className="trace-ticker-run">
            {TICKER_KINDS.map((key, i) => (
              <span key={key} className="trace-ticker-item" data-lit={i % 4 === 1 ? '' : undefined}>
                {t(key)}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// What the month has raised, and the two doors from it: Donate, and the wall
// of the people who already did. Deliberately not a plea -- it says what it
// costs and leaves it there.
function SupportPanel() {
  const { t } = useTranslation()
  const [showContribute, setShowContribute] = useState(false)
  const [data, setData] = useState<ContributionsData>(() => getCachedContributions())
  useEffect(() => startContributionsRefresh(setData), [])
  const month = data.month
  const percent = month && month.goalCents > 0 ? Math.min(100, (month.totalCents / month.goalCents) * 100) : 0
  return (
    <div className="relative">
      <Brackets />
      <div className="border border-nier-border/30 p-6 sm:p-8" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.6)' }}>
        {month && month.goalCents > 0 ? (
          <>
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-xs tracking-[0.2em] uppercase text-nier-bg/70">{t('landing.support.thisMonth')}</span>
              <span className="text-sm tracking-wider text-nier-strong tabular-nums">{t('goal.funded', { percent: Math.round(percent) })}</span>
            </div>
            {/* The light's level: how much of the month is kept lit. */}
            <div className="h-[3px] overflow-hidden" style={{ backgroundColor: 'rgb(var(--c-fg) / 0.12)' }}>
              <div className="h-full transition-[width] duration-700 ease-out landing-light-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-xs tracking-[0.15em] uppercase text-nier-bg/70 mt-3">
              {t(contributionCountKey(month.contributionCount), { count: month.contributionCount })}
            </p>
          </>
        ) : (
          <p className="text-xs tracking-[0.15em] uppercase text-nier-bg/70">{t('landing.support.keptStanding')}</p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 mt-7">
          <DonateButton onClick={() => setShowContribute(true)} wrapperClassName="flex-1" className="w-full py-3" />
          <button
            type="button"
            onClick={() => openContributors('/')}
            className="flex-1 py-3 border border-nier-border/40 text-nier-bg/80 text-xs tracking-[0.15em] uppercase hover:border-nier-border/70 hover:text-nier-strong active:translate-y-px transition-colors"
          >
            {t('welcome.contributors')}
          </button>
        </div>
      </div>
      {showContribute && <ContributePanel onClose={() => setShowContribute(false)} />}
    </div>
  )
}

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
            <span translate="no" className="hidden sm:inline text-nier-strong text-sm tracking-[0.22em] uppercase whitespace-nowrap">
              The Digital Atrium
            </span>
          </button>

          {/* Three lines, drawn rather than typed: the glyph everybody already
              reads as "the rest of the menu is in here", in the app's own
              weight. It carries the section you are in beside it where there
              is room, so the bar still answers "where am I" without the menu
              being open. */}
          <div ref={menuRef} className="relative xl:hidden shrink-0">
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

              Inline from xl (1280) up, and a menu below that. It used to
              wait for 2xl, because the wordmark holds its place on the left at
              every width and the longest language -- Spanish, a quarter longer
              than English -- did not fit beside it at 1280.

              The titles are set tighter between xl and 2xl to buy that back:
              less padding either side of each and less letter-spacing, which
              is roughly the 200px the wordmark costs. English has room to
              spare; Spanish is the one to look at if this ever crowds.

              Separated by rules, because seven titles in one typeface at one
              size with even spacing read as a sentence of unrelated words
              rather than as seven things you can choose between. */}
          <nav className="hidden xl:flex col-start-2 items-center justify-self-center min-w-0">
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
                    className={`relative whitespace-nowrap px-2 2xl:px-3 py-2 text-[11px] tracking-[0.06em] 2xl:tracking-[0.1em] uppercase transition-colors ${
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

          {/* Placed in the third column rather than left to land there.

              The nav between these two is `hidden` below xl, and hidden means
              display:none -- so it stops being a grid item at all, and
              auto-placement put this group in the middle column instead.
              justify-self-end then pushed it to the end of *that* column,
              which is the middle of the bar: the buttons stopped at the centre
              on exactly the screens where the sections had folded away.
              Naming the column makes the placement independent of how many
              items happen to be rendered. */}
          <div className="col-start-3 flex items-center gap-2 shrink-0 justify-self-end">
            <LanguageToggle />

            <ThemeToggle />

            <DonateButton onClick={onDonate} />
          </div>
        </div>
      </div>
    </div>
  )
}

// The running order, and the order the page is written in. Index is identity
// here: it ties an entry to its ref in sectionRefs, so each section takes its
// ref by name, through sectionIndex(), as does anything jumping to one.
// `desktop` is the one a route names (/desktop): its id stays.
const sections = [
  { id: 'hero', title: 'The Digital Atrium' },
  { id: 'film', title: 'The film' },
  { id: 'inside', title: 'Inside an atrium' },
  { id: 'traces', title: 'Traces' },
  { id: 'tools', title: 'What you can do' },
  { id: 'why', title: 'Why' },
  { id: 'desktop', title: 'Web & Desktop' },
  { id: 'support', title: 'Support' },
]
const sectionIndex = (id: string) => sections.findIndex(section => section.id === id)

export default function LandingPage({ onGetStarted, isAuthenticated, section }: LandingPageProps) {
  const { t } = useTranslation()
  const theme = useLandingTheme()
  const light = theme.resolved === 'light'
  const shot = light ? 'light' : 'dark'
  const [showDonate, setShowDonate] = useState(false)
  const [activeSection, setActiveSection] = useState(0)
  // Scrolled a little way off the first screen: the creator's signature folds to its tab.
  const [offHall, setOffHall] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const motion = useLandingMotion()
  const lenisRef = useRef<InstanceType<LandingMotion['Lenis']> | null>(null)
  // Where the roots start, and the button they gather at (CodeRoots).
  const insideRef = useRef<HTMLElement | null>(null)
  const codeButtonRef = useRef<HTMLAnchorElement>(null)
  const enter = isAuthenticated ? t('landing.continue') : t('landing.enter')
  // A decorative loop stays still for anyone who asked for less motion.
  const still = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])

  // Dust in the light from above: motes drifting down through the middle of
  // the page, never in step.
  const motes = useMemo(() => [...Array(24)].map((_, i) => ({
    left: `${28 + ((i * 37) % 44)}%`,
    size: 1 + (i % 3) * 0.7,
    duration: 18 + ((i * 7) % 13),
    delay: -((i * 2.3) % 30),
    drift: `${((i * 13) % 9) - 4}vw`,
  })), [])

  // Pointer parallax, published as CSS custom properties instead of React
  // state: each layer picks its own depth, for no render cost. Coalesced into
  // one rAF so a burst of pointer events writes style once a frame.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let frame = 0
    const handleMouseMove = (e: MouseEvent) => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        el.style.setProperty('--px', ((e.clientX / window.innerWidth) * 2 - 1).toFixed(4))
        el.style.setProperty('--py', ((e.clientY / window.innerHeight) * 2 - 1).toFixed(4))
      })
    }
    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  // Smooth scrolling (Lenis), on GSAP's clock, so what's tied to the scroll is
  // drawn where the page is. Scrollers inside it -- the bar's menu, the
  // donation panel -- keep their own wheel.
  useEffect(() => {
    const wrapper = containerRef.current, content = mainRef.current
    if (!motion || !wrapper || !content) return
    const { gsap, ScrollTrigger, Lenis } = motion
    const lenis = new Lenis({ wrapper, content, allowNestedScroll: true })
    lenisRef.current = lenis
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    // Pictures and fonts arriving move what's below them: the triggers are
    // measured again once they've settled.
    let settle = 0
    const resized = new ResizeObserver(() => {
      clearTimeout(settle)
      settle = window.setTimeout(() => ScrollTrigger.refresh(), 200)
    })
    resized.observe(content)
    return () => {
      clearTimeout(settle)
      resized.disconnect()
      gsap.ticker.remove(tick)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [motion])

  // The code history slides in over this page and back (the strip below).
  useEffect(() => watchCodeHistory(), [])

  // Each section lit as it comes into view: its diamond fills, its rule
  // draws out, its content rises. One-way -- re-hiding on the way back up
  // distracts.
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-revealed')
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    document.querySelectorAll('[data-reveal]').forEach(n => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  // The section whose top has most recently passed under the bar, and how far
  // down the page is.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleScroll = () => {
      const scrollHeight = container.scrollHeight - container.clientHeight
      setScrollProgress(scrollHeight > 0 ? container.scrollTop / scrollHeight : 0)
      setOffHall(container.scrollTop > container.clientHeight * 0.3)
      let current = 0
      sectionRefs.current.forEach((ref, index) => {
        if (ref && ref.getBoundingClientRect().top <= NAV_HEIGHT + 24) current = index
      })
      setActiveSection(current)
    }
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  // Indices stay tied to sectionRefs, so entries are filtered out after
  // indexing rather than removed. The desktop app has no Web & Desktop.
  const navItems = sections
    .map((entry, index) => ({ ...entry, index }))
    .filter(({ id }) => id !== 'hero' && !(isDesktop && id === 'desktop'))

  // Scrolled by hand, the bar's height taken off: scrollIntoView put every
  // heading under the bar.
  const scrollToSection = (index: number, behavior: ScrollBehavior = 'smooth') => {
    const target = sectionRefs.current[index]
    const container = containerRef.current
    if (!target || !container) return
    const top = Math.max(0, target.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - NAV_HEIGHT)
    // Through Lenis while it runs: a native scroll would be fought by it.
    if (lenisRef.current) lenisRef.current.scrollTo(top, { immediate: behavior !== 'smooth' })
    else container.scrollTo({ top, behavior })
  }

  // Opened at a section when the route named one: instantly, and measured
  // twice, as pictures above it settle.
  useEffect(() => {
    if (!section) return
    const index = sectionIndex(section)
    if (index < 0) return
    const frame = requestAnimationFrame(() => scrollToSection(index, 'auto'))
    const correction = setTimeout(() => scrollToSection(index, 'auto'), 400)
    return () => { cancelAnimationFrame(frame); clearTimeout(correction) }
  }, [section])

  // The bar's Donate opens the panel, and puts the page under it at what the
  // money is for.
  const handleBarDonate = () => {
    scrollToSection(sectionIndex('support'))
    setShowDonate(true)
  }

  // A chapter's number: its place among those shown (the desktop app has no
  // Web & Desktop), the hall not counted.
  const chapter = (id: string) => navItems.findIndex(item => item.id === id) + 1
  const sectionClass = 'relative px-5 sm:px-10 lg:px-16 py-20 md:py-28'

  return (
    <div
      ref={containerRef}
      data-landing-scroller
      data-landing-theme={theme.resolved}
      className="h-screen bg-nier-black text-nier-bg overflow-y-auto overflow-x-hidden scroll-smooth"
    >
      {/* For keyboards: the first stop, past the bar straight to the page. */}
      <a href="#landing-main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:px-4 focus:py-2 focus:bg-nier-bg focus:text-nier-black text-xs tracking-[0.15em] uppercase">
        {t('landing.skip')}
      </a>

      <TopNav items={navItems} activeSection={activeSection} onJump={scrollToSection} onDonate={handleBarDonate} />

      {showDonate && <ContributePanel onClose={() => setShowDonate(false)} />}

      <CreatorSignature full={!offHall} />

      {/* Scanlines, faint, over everything. */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.02] z-50"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgb(var(--c-fg) / 0.1) 2px, rgb(var(--c-fg) / 0.1) 4px)' }}
      />
      {/* The atrium's grid, the floor of the hall -- the deepest layer, so it
          moves least with the pointer. */}
      <div
        className="fixed pointer-events-none opacity-[0.12]"
        style={{
          inset: '-40px',
          backgroundImage: 'linear-gradient(rgb(var(--c-fg) / 0.2) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-fg) / 0.2) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          transform: 'translate3d(calc(var(--px, 0) * 12px), calc(var(--py, 0) * 12px), 0)',
          transition: 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      {/* The light from above, over the whole hall, breathing slowly. */}
      <div aria-hidden="true" className="landing-skylight fixed inset-0 pointer-events-none" />
      {/* Dust in it. */}
      <div aria-hidden="true" className="landing-dust fixed inset-0 pointer-events-none overflow-hidden">
        {motes.map((mote, i) => (
          <span
            key={i}
            className="landing-mote"
            style={{ left: mote.left, width: mote.size, height: mote.size, animationDuration: `${mote.duration}s`, animationDelay: `${mote.delay}s`, '--drift': mote.drift } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Where you are, down the right edge (NieR's own). */}
      <nav aria-label={t('landing.sections')} className="fixed right-8 top-1/2 -translate-y-1/2 z-40 hidden xl:flex flex-col items-end gap-6">
        {sections
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => !(isDesktop && entry.id === 'desktop'))
          .map(({ entry, index }) => {
            const isActive = activeSection === index
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => scrollToSection(index)}
                aria-label={t(`landing.nav.${entry.id}` as TranslationKey)}
                aria-current={isActive ? 'true' : undefined}
                className="group relative flex items-center"
              >
                <span className={`pointer-events-none absolute right-full mr-3 whitespace-nowrap text-xs tracking-[0.15em] uppercase transition-opacity duration-300 opacity-0 group-hover:opacity-100 ${isActive ? 'text-nier-strong' : 'text-nier-bg/75'}`}>
                  {t(`landing.nav.${entry.id}` as TranslationKey)}
                </span>
                <span className={`relative block w-6 h-6 transition-[opacity,transform] duration-300 ${isActive ? 'opacity-100 scale-110' : 'opacity-40 group-hover:opacity-70'}`}>
                  <span className="absolute top-0 left-0 w-2 h-2 border-l border-t border-nier-border/80" />
                  <span className="absolute top-0 right-0 w-2 h-2 border-r border-t border-nier-border/80" />
                  <span className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-nier-border/80" />
                  <span className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-nier-border/80" />
                  <span className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rotate-45 ${isActive ? 'landing-lit' : 'border border-nier-border/60'}`} />
                </span>
              </button>
            )
          })}
        <div className="mt-4 flex flex-col items-end gap-1 pr-[11px]">
          <div className="w-px h-16 bg-nier-border/20 relative">
            <div className="absolute top-0 left-0 w-full bg-nier-border/60" style={{ height: `${scrollProgress * 100}%` }} />
          </div>
          <span className="text-[11px] text-nier-bg/70 tracking-widest -mr-2 tabular-nums">{Math.round(scrollProgress * 100)}%</span>
        </div>
      </nav>

      <main ref={mainRef} id="landing-main" tabIndex={-1} className="relative outline-none">
        {/* The Atrium's own code, growing down the margins (CodeRoots). */}
        <CodeRoots host={mainRef} from={insideRef} to={codeButtonRef} />

        {/* The hall: the portal, lit, hanging over the name. */}
        <section
          ref={el => { sectionRefs.current[sectionIndex('hero')] = el }}
          className="relative flex flex-col items-center px-5 sm:px-10 lg:px-16 pb-10 overflow-hidden"
          style={{ minHeight: 'calc(100dvh - 3.5rem)' }}
        >
          <div className="relative z-10 w-full max-w-[1100px] mx-auto flex flex-col items-center text-center">
            <PortalScene ink={light} className="w-[min(94vw,860px)] h-[clamp(230px,44vh,540px)]" />
            <TraceTitle className="w-[min(92vw,760px)] text-center -mt-[clamp(0.25rem,2.5vh,2rem)]" />
            <p className="mt-7 text-nier-bg/80 text-lg md:text-xl font-light leading-relaxed max-w-[38rem] text-balance">
              {t('landing.hero.sub2')}
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-x-9 gap-y-4">
              <button type="button" onClick={onGetStarted} className="landing-cta px-9 py-4 text-sm md:text-base tracking-[0.2em] uppercase" style={{ clipPath: DONATE_CUT }}>
                {enter}
              </button>
              {!isDesktop && (
                <button type="button" onClick={() => scrollToSection(sectionIndex('desktop'))} className="landing-link text-sm tracking-[0.18em] uppercase">
                  {t('landing.hero.download')} <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          </div>

          {/* The foot of the first screen: the way down. */}
          <div className="relative z-10 w-full max-w-[1400px] mx-auto mt-auto pt-12 flex items-end">
            <button type="button" onClick={() => scrollToSection(sectionIndex('film'))} aria-label={t('landing.film.title')} className="scroll-cue absolute left-1/2 -translate-x-1/2 bottom-0 hidden sm:flex flex-col items-center gap-2 text-[10px] tracking-[0.3em] uppercase text-nier-bg/60 hover:text-nier-strong">
              {t('landing.film.title')}
              <span aria-hidden="true" className="scroll-cue-line" />
            </button>
          </div>
        </section>

        <FilmChapter ref={el => { sectionRefs.current[sectionIndex('film')] = el }} index={chapter('film')} still={still} />

        {/* Every kind of trace, running past: the beat before the room. */}
        <TraceTicker />

        <InsideChapter ref={el => { sectionRefs.current[sectionIndex('inside')] = el; insideRef.current = el }} index={chapter('inside')} shot={shot} />
        <TraceRibbon ref={el => { sectionRefs.current[sectionIndex('traces')] = el }} index={chapter('traces')} shot={shot} still={still} />
        <ToolChapters ref={el => { sectionRefs.current[sectionIndex('tools')] = el }} index={chapter('tools')} shot={shot} still={still} />
        <WhyChapter ref={el => { sectionRefs.current[sectionIndex('why')] = el }} index={chapter('why')} buttonRef={codeButtonRef} />

        {/* Two ways in: the web, and your computer. The desktop app has no
            need to be told about itself. */}
        {!isDesktop && (
          <section ref={el => { sectionRefs.current[sectionIndex('desktop')] = el }} className={sectionClass}>
            <div className="max-w-[1300px] mx-auto">
              <ChapterLabel index={chapter('desktop')} className="mb-12">{t('landing.ways.title')}</ChapterLabel>
              <div className="landing-bento grid md:grid-cols-2 gap-px" data-reveal>
                <div className="landing-cell p-8 md:p-12 flex flex-col">
                  <h3 className="text-2xl md:text-4xl font-extralight tracking-[0.08em] uppercase text-nier-strong">{t('landing.ways.web')}</h3>
                  <p className="mt-5 text-nier-bg/85 leading-relaxed text-pretty">{t('landing.ways.webDesc')}</p>
                  <p className="mt-3 text-sm text-nier-bg/70 leading-relaxed text-pretty">{t('landing.ways.webLimits')}</p>
                  <div className="mt-auto pt-10">
                    <button type="button" onClick={onGetStarted} className="landing-link text-sm tracking-[0.18em] uppercase">
                      {enter} <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </div>
                <div className="landing-cell p-8 md:p-12 flex flex-col">
                  <h3 className="text-2xl md:text-4xl font-extralight tracking-[0.08em] uppercase text-nier-strong">{t('landing.ways.desktop')}</h3>
                  <p className="mt-5 text-nier-bg/85 leading-relaxed text-pretty">{t('landing.ways.desktopDesc')}</p>
                  <p className="mt-3 text-sm text-nier-bg/70 leading-relaxed text-pretty">{t('landing.ways.desktopSolo')}</p>
                  <div className="mt-10"><DesktopDownloads /></div>
                </div>
              </div>
              <p className="mt-6 text-sm text-nier-bg/70 leading-relaxed max-w-[64ch] text-pretty" data-reveal>{t('desktop.moveBetween')}</p>
            </div>
          </section>
        )}

        {/* What keeps it going. */}
        <section ref={el => { sectionRefs.current[sectionIndex('support')] = el }} className={sectionClass}>
          <div className="max-w-[1100px] mx-auto">
            <ChapterLabel index={chapter('support')} className="mb-12">{t('landing.support.title')}</ChapterLabel>
            <div className="grid md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] gap-10 md:gap-16 items-center">
              <div className="space-y-5" data-reveal="left">
                <Headline as="h3" className="text-[clamp(1.6rem,2.6vw,2.4rem)] font-extralight leading-[1.15] text-nier-strong text-balance">{t('landing.support.body1')}</Headline>
                <p className="text-nier-bg/70 leading-relaxed text-pretty">{t('landing.support.body2')}</p>
              </div>
              <div data-reveal="right"><SupportPanel /></div>
            </div>
          </div>
        </section>

        {/* The way in, again, at the end. */}
        <section className="relative px-5 sm:px-12 pt-10 pb-32 text-center">
          <div className="max-w-3xl mx-auto flex flex-col items-center" data-reveal>
            <span aria-hidden="true" className="landing-orb w-5 h-5 rounded-full mb-10" />
            <SplitText tag="h2" text={t('landing.closing.title')} from={{ opacity: 0, y: 28 }} delay={45} className="text-3xl md:text-5xl font-extralight tracking-[0.12em] uppercase text-nier-strong text-balance" />
            <button type="button" onClick={onGetStarted} className="landing-cta mt-10 px-12 py-4 text-sm md:text-base tracking-[0.2em] uppercase" style={{ clipPath: DONATE_CUT }}>
              {enter}
            </button>
          </div>
        </section>
      </main>

      {/* The mark, the name under a rule, and the small print. */}
      <footer className="border-t border-nier-border/20 py-14 relative">
        <div className="max-w-4xl mx-auto px-6 flex flex-col items-center gap-7 text-center">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="w-7 h-7 shrink-0 bg-nier-strong opacity-80"
              style={{
                WebkitMaskImage: 'url(/atrium-mark.png)', maskImage: 'url(/atrium-mark.png)',
                WebkitMaskSize: 'contain', maskSize: 'contain', WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center', maskPosition: 'center',
              }}
            />
            <span translate="no" className="text-nier-strong text-sm tracking-[0.28em] uppercase">The Digital Atrium</span>
          </div>
          {!isDesktop && (
            <div className="flex items-center gap-4">
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-nier-bg/70 hover:text-nier-strong text-xs tracking-[0.15em] uppercase transition-colors">{t('landing.privacy')}</a>
              <span className="text-nier-bg/40 text-xs" aria-hidden="true">◇</span>
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-nier-bg/70 hover:text-nier-strong text-xs tracking-[0.15em] uppercase transition-colors">{t('landing.terms')}</a>
            </div>
          )}
          <div className="text-nier-bg/50 text-[0.7rem] tracking-[0.12em] uppercase">{t('landing.footer.copyright')}</div>
        </div>
      </footer>

      <style>{`
        /* The one light. Warm on the dark hall; on paper, a bloom of white
           with the edges of the page a shade darker. */
        [data-landing-theme] { --landing-light: 255 236 205; }
        .landing-skylight {
          background:
            radial-gradient(ellipse 55% 60% at 50% -12%, rgb(var(--landing-light) / 0.11), transparent 70%),
            radial-gradient(ellipse 30% 40% at 50% -6%, rgb(var(--landing-light) / 0.08), transparent 70%);
          animation: landingBreathe 12s ease-in-out infinite;
        }
        [data-landing-theme='light'] .landing-skylight {
          background:
            radial-gradient(ellipse 60% 65% at 50% -10%, rgb(255 255 255 / 0.85), transparent 72%),
            radial-gradient(ellipse 120% 90% at 50% 50%, transparent 55%, rgb(var(--c-fg) / 0.06));
        }
        @keyframes landingBreathe { 0%, 100% { opacity: 0.7; } 50% { opacity: 1; } }

        .landing-mote {
          position: absolute; top: 0; border-radius: 9999px;
          background: rgb(var(--landing-light) / 0.75);
          box-shadow: 0 0 6px rgb(var(--landing-light) / 0.5);
          opacity: 0;
          animation: landingMote linear infinite;
        }
        [data-landing-theme='light'] .landing-mote { background: rgb(var(--c-fg) / 0.5); box-shadow: none; }
        @keyframes landingMote {
          0% { transform: translate3d(0, -4vh, 0); opacity: 0; }
          12% { opacity: 0.45; }
          70% { opacity: 0.3; }
          100% { transform: translate3d(var(--drift), 96vh, 0); opacity: 0; }
        }

        /* A section lit as it comes into view. */
        .lit-diamond { border: 1px solid rgb(var(--c-fg) / 0.5); transition: background-color 0.9s ease 0.3s, box-shadow 0.9s ease 0.3s, border-color 0.9s ease 0.3s; }
        .lit-rule { background: linear-gradient(90deg, rgb(var(--c-fg) / 0.4), transparent); transform: scaleX(0); transform-origin: left; transition: transform 1.3s cubic-bezier(0.22, 1, 0.36, 1) 0.2s; }
        .lit-rule-left { background: linear-gradient(270deg, rgb(var(--c-fg) / 0.4), transparent); transform-origin: right; }
        .is-revealed .lit-rule { transform: scaleX(1); }
        .is-revealed .lit-diamond, .landing-lit {
          background-color: rgb(var(--landing-light));
          border-color: rgb(var(--landing-light));
          box-shadow: 0 0 14px rgb(var(--landing-light) / 0.7);
        }
        [data-landing-theme='light'] .is-revealed .lit-diamond, [data-landing-theme='light'] .landing-lit {
          background-color: rgb(var(--c-strong)); border-color: rgb(var(--c-strong)); box-shadow: none;
        }
        [data-reveal] { opacity: 0; transform: translateY(28px); transition: opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1), transform 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
        [data-reveal='left'] { transform: translateX(-56px); }
        [data-reveal='right'] { transform: translateX(56px); }
        [data-reveal].is-revealed { opacity: 1; transform: none; }

        /* A headline: each word risen from behind its own mask (landing/parts). */
        .headline-mask { display: inline-block; overflow: hidden; vertical-align: bottom; padding-bottom: 0.1em; margin-bottom: -0.1em; }
        .headline-word { display: inline-block; transform: translateY(108%); transition: transform 1s cubic-bezier(0.22, 1, 0.36, 1); }
        .is-revealed .headline-word { transform: none; }

        /* The way down from the first screen. */
        .scroll-cue-line { display: block; width: 1px; height: 44px; background: linear-gradient(rgb(var(--c-fg) / 0.7), transparent); transform-origin: top; animation: landingCue 2.4s cubic-bezier(0.65, 0, 0.35, 1) infinite; }
        @keyframes landingCue { 0% { transform: scaleY(0); opacity: 1; } 55% { transform: scaleY(1); opacity: 1; } 100% { transform: scaleY(1); opacity: 0; } }

        /* The film: its screen dark in either theme, and the orb's glow it opens from. */
        [data-landing-theme] .film-screen .landing-orb { background: #fff; box-shadow: 0 0 24px 6px rgb(255 236 205 / 0.55), 0 0 80px 20px rgb(255 236 205 / 0.2); }
        .film-glow { z-index: 2; background: radial-gradient(circle, #fff 0%, rgb(var(--landing-light)) 28%, rgb(var(--landing-light) / 0.35) 52%, transparent 72%); box-shadow: 0 0 80px 30px rgb(var(--landing-light) / 0.35); }
        [data-landing-theme='light'] .film-glow { background: radial-gradient(circle, rgb(var(--c-strong)) 0%, rgb(var(--c-strong) / 0.5) 40%, transparent 72%); box-shadow: none; }

        /* The ribbon of traces (landing/TraceRibbon): cards of glass on a ring. */
        .ribbon-stage { --ribbon-card-w: clamp(190px, 20vw, 290px); --ribbon-radius: calc(var(--ribbon-card-w) * 2.1); height: calc(var(--ribbon-card-w) * 1.8); max-width: 1600px; perspective: 1700px; perspective-origin: 50% 35%; cursor: grab; }
        .ribbon-stage:active { cursor: grabbing; }
        .ribbon-ring { transform-style: preserve-3d; transform: translateZ(calc(var(--ribbon-radius) * -1)) rotateX(-5deg); }
        .ribbon-card { position: absolute; left: 50%; top: 50%; width: var(--ribbon-card-w); aspect-ratio: 3 / 4.15; transform-style: preserve-3d; transition: opacity 0.5s ease; }
        .ribbon-card-inner { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform 0.9s cubic-bezier(0.22, 1, 0.36, 1); }
        .ribbon-card.is-open .ribbon-card-inner { transform: rotateY(180deg); }
        .ribbon-face {
          position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden; text-align: left;
          -webkit-backface-visibility: hidden; backface-visibility: hidden;
          border: 1px solid rgb(var(--c-fg) / 0.24);
          background: linear-gradient(150deg, rgb(var(--c-fg) / 0.12), rgb(var(--c-fg) / 0.03) 45%, rgb(var(--c-fg) / 0.06));
          box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14), 0 28px 60px rgb(0 0 0 / 0.38);
        }
        [data-landing-theme='light'] .ribbon-face { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.7), 0 22px 44px rgb(var(--c-fg) / 0.16); }
        .ribbon-front::after { content: ''; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(115deg, transparent 32%, rgb(255 255 255 / 0.12) 46%, transparent 58%); }
        .ribbon-back { transform: rotateY(180deg); padding: 1.4rem 1.3rem; background: rgb(var(--c-ground) / 0.94); }
        .ribbon-visual { position: relative; flex: 1; margin: 10px 10px 0; overflow: hidden; background: rgb(var(--c-fg) / 0.05); filter: grayscale(calc(1 - var(--colour, 0))); transition: filter 0.6s ease; }
        .ribbon-caption { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem; padding: 12px 14px 14px; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; }
        .ribbon-card:focus-visible { outline: none; }
        .ribbon-card:focus-visible .ribbon-face { outline: 1px solid rgb(var(--c-strong)); outline-offset: 3px; }
        .ribbon-arrow { width: 2.6rem; height: 2.6rem; border: 1px solid rgb(var(--c-fg) / 0.3); color: rgb(var(--c-strong)); transition: border-color 0.25s ease, opacity 0.25s ease; }
        .ribbon-arrow:hover:not(:disabled) { border-color: rgb(var(--c-strong)); }
        .ribbon-arrow:disabled { opacity: 0.3; }

        /* What can be done (landing/ToolChapters): a run of chapters. */
        .tool-panel { position: relative; isolation: isolate; padding: 4.5rem 1.25rem; }
        @media (min-width: 640px) { .tool-panel { padding: 5rem 2.5rem; } }
        .tool-chapter { display: grid; gap: 1.75rem; max-width: 760px; margin: 0 auto; }
        .tool-number {
          position: absolute; top: 2.5rem; right: 1.25rem; z-index: -1; pointer-events: none;
          font-size: clamp(6rem, 18vw, 15rem); line-height: 1; font-weight: 200; letter-spacing: -0.04em;
          color: transparent; -webkit-text-stroke: 1px rgb(var(--c-fg) / 0.22);
        }
        .tool-media { width: 100%; }
        @media (min-width: 1024px) {
          .tool-run-flow .tool-panel { flex: none; height: 100vh; display: flex; flex-direction: column; justify-content: center; padding: 0 4vw; margin: 0; }
          .tool-run-flow .tool-intro { width: 50vw; padding-left: max(4rem, calc((100vw - 1400px) / 2)); }
          .tool-run-flow .tool-chapter { width: 68vw; max-width: 1180px; display: grid; grid-template-columns: minmax(0, 4fr) minmax(0, 7fr); align-items: center; gap: 3.5vw; }
          .tool-run-flow .tool-keys { width: 36vw; padding-right: max(4rem, calc((100vw - 1400px) / 2)); }
          .tool-run-flow .tool-number { top: 14vh; right: 4vw; }
        }

        /* The roots (landing/CodeRoots). */
        .code-roots .root-main { fill: none; stroke: rgb(var(--c-fg) / 0.3); stroke-width: 1.2; }
        .code-roots .root-branch { fill: none; stroke: rgb(var(--c-fg)); stroke-width: 0.8; opacity: 0; transition: opacity 0.9s ease; }
        .code-roots .root-node { opacity: 0; transition: opacity 0.7s ease; }
        .code-roots .is-reached { opacity: 1; }
        .code-roots circle { fill: rgb(var(--c-ground)); stroke: rgb(var(--landing-light) / 0.9); stroke-width: 1; }
        [data-landing-theme='light'] .code-roots circle { stroke: rgb(var(--c-fg) / 0.7); }
        .code-roots text { font-size: 10px; letter-spacing: 0.06em; fill: rgb(var(--c-fg) / 0.45); }
        .code-history-button { border: 1px solid rgb(var(--c-fg) / 0.35); background: rgb(var(--c-ground) / 0.92); transition: border-color 0.3s ease, box-shadow 0.4s ease; }
        /* The bloom round it (CodeBloom), in graphify's colours. */
        .code-bloom path { fill: none; }
        .code-bloom .bloom-line { stroke-width: 1; opacity: 0.55; }
        .code-bloom .bloom-line.is-trunk { stroke-width: 1.5; opacity: 0.8; }
        .code-bloom .bloom-across path { stroke: rgb(var(--c-fg) / 0.13); stroke-width: 0.8; }
        .code-bloom .bloom-dot.is-root { filter: drop-shadow(0 0 6px currentColor); }
        .code-bloom .bloom-label { font-size: 10.5px; letter-spacing: 0.08em; paint-order: stroke; stroke: rgb(var(--c-ground)); stroke-width: 4px; stroke-linejoin: round; }
        .code-bloom .bloom-flow { display: none; stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 2 46; }
        .code-bloom.is-grown .bloom-flow { display: inline; animation: bloom-flow 3.2s linear infinite; }
        @keyframes bloom-flow { to { stroke-dashoffset: 96; } }
        .code-history-button:hover, .code-history-button:focus-visible { border-color: rgb(var(--c-strong)); box-shadow: 0 0 44px rgb(var(--landing-light) / 0.28); outline: none; }

        /* The way in: filled with the light, glowing a little under the
           pointer, pressed on click. */
        .landing-cta {
          background: rgb(var(--c-strong)); color: rgb(var(--c-ground)); font-weight: 500;
          transition: box-shadow 0.35s ease, transform 0.2s ease, background-color 0.3s ease;
        }
        .landing-cta:hover { box-shadow: 0 0 46px rgb(var(--landing-light) / 0.38); transform: translateY(-1px); }
        .landing-cta:active { transform: translateY(1px); }
        [data-landing-theme='light'] .landing-cta:hover { box-shadow: 0 10px 30px rgb(var(--c-fg) / 0.22); }
        .landing-cta:focus-visible, .landing-link:focus-visible { outline: 1px solid rgb(var(--c-strong)); outline-offset: 4px; }
        .landing-link { position: relative; color: rgb(var(--c-fg) / 0.85); transition: color 0.25s ease; padding: 0.4rem 0; }
        .landing-link::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: currentColor; transform: scaleX(0.35); transform-origin: left; transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1); opacity: 0.6; }
        .landing-link:hover { color: rgb(var(--c-strong)); }
        .landing-link:hover::after { transform: scaleX(1); }

        /* Cells with hairlines between them: the grid's own lines. */
        .landing-bento { background: rgb(var(--c-fg) / 0.16); border: 1px solid rgb(var(--c-fg) / 0.16); }
        .landing-cell { background: rgb(var(--c-ground)); position: relative; transition: background-color 0.4s ease; }
        .landing-cell::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: linear-gradient(90deg, transparent, rgb(var(--landing-light) / 0.8), transparent); opacity: 0; transition: opacity 0.5s ease; z-index: 1; }
        [data-landing-theme='light'] .landing-cell::before { background: linear-gradient(90deg, transparent, rgb(var(--c-strong) / 0.6), transparent); }
        .landing-cell:hover::before { opacity: 1; }

        .landing-window::after, .landing-portrait::after {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(180deg, rgb(var(--landing-light) / 0.1), transparent 35%);
        }
        [data-landing-theme='light'] .landing-window::after, [data-landing-theme='light'] .landing-portrait::after { background: none; }

        .landing-key {
          display: inline-block; min-width: 2.25rem; padding: 0.3rem 0.6rem; text-align: center;
          border: 1px solid rgb(var(--c-fg) / 0.35); border-bottom-width: 2px;
          font-size: 0.75rem; letter-spacing: 0.08em; color: rgb(var(--c-strong)); white-space: nowrap;
        }
        .landing-light-fill { background: rgb(var(--landing-light)); box-shadow: 0 0 10px rgb(var(--landing-light) / 0.6); }
        [data-landing-theme='light'] .landing-light-fill { background: rgb(var(--c-strong)); box-shadow: none; }
        .landing-orb { background: rgb(255 255 255); box-shadow: 0 0 24px 6px rgb(var(--landing-light) / 0.55), 0 0 80px 20px rgb(var(--landing-light) / 0.2); }
        [data-landing-theme='light'] .landing-orb { background: rgb(var(--c-strong)); box-shadow: 0 0 30px 8px rgb(var(--c-fg) / 0.12); }

        /* The teaser's controls (landing/parts ClipControls): on the film's black
           in either theme, so light; out of the way while it plays, given a pointer. */
        .clip-controls { color: #fff; background: linear-gradient(to top, rgb(0 0 0 / 0.6), transparent); transition: opacity 0.3s ease; }
        @media (hover: hover) { .film-screen:not(:hover):not(:focus-within) .clip-controls[data-playing] { opacity: 0; } }
        .clip-toggle { width: 1.9rem; height: 1.9rem; display: grid; place-items: center; border: 1px solid rgb(255 255 255 / 0.45); transition: border-color 0.2s ease; }
        .clip-toggle:hover, .clip-toggle:focus-visible { border-color: #fff; outline: none; }
        .clip-timeline { --at: 0%; -webkit-appearance: none; appearance: none; height: 16px; background: transparent; cursor: pointer; }
        .clip-timeline::-webkit-slider-runnable-track { height: 2px; background: linear-gradient(to right, #fff var(--at), rgb(255 255 255 / 0.3) var(--at)); }
        .clip-timeline::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; margin-top: -4px; border-radius: 50%; background: #fff; }
        .clip-timeline::-moz-range-track { height: 2px; background: rgb(255 255 255 / 0.3); }
        .clip-timeline::-moz-range-progress { height: 2px; background: #fff; }
        .clip-timeline::-moz-range-thumb { width: 10px; height: 10px; border: 0; border-radius: 50%; background: #fff; }
        .clip-timeline:focus-visible { outline: 1px solid #fff; outline-offset: 4px; }

        /* The creator, in the corner all the way down (CreatorSignature): a
           tab, its name sliding out; in full on the first screen, given room. */
        .creator-signature { gap: 0; padding: 0.35rem; background: rgb(var(--c-ground) / 0.8); border: 1px solid rgb(var(--c-line) / 0.28); backdrop-filter: blur(10px); transition: background-color 0.4s ease, border-color 0.4s ease, gap 0.45s cubic-bezier(0.22, 1, 0.36, 1), padding 0.45s cubic-bezier(0.22, 1, 0.36, 1); }
        .creator-signature-name { max-width: 0; opacity: 0; transition: max-width 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.3s ease; }
        .creator-signature:hover, .creator-signature:focus-visible { gap: 0.75rem; padding-right: 0.9rem; }
        .creator-signature:hover .creator-signature-name, .creator-signature:focus-visible .creator-signature-name { max-width: 18rem; opacity: 1; }
        @media (min-width: 640px) and (min-height: 700px) {
          .creator-signature[data-full] { gap: 0.75rem; background: transparent; border-color: transparent; backdrop-filter: none; }
          .creator-signature[data-full] .creator-signature-name { max-width: 18rem; opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .creator-signature, .creator-signature-name { transition: none; }
          .landing-skylight { animation: none; }
          .landing-dust { display: none; }
          [data-reveal] { opacity: 1; transform: none; transition: none; }
          .lit-rule { transform: scaleX(1); transition: none; }
          .headline-word { transform: none; transition: none; }
          .scroll-cue-line { animation: none; }
          .ribbon-card, .ribbon-card-inner, .ribbon-visual { transition: none; }
        }
      `}</style>
    </div>
  )
}
