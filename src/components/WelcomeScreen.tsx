import { useState, useEffect, useMemo, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import ProfileSettings from './ProfileSettings'
import PinterestConnectionPanel from './PinterestConnectionPanel'
import PinterestMark from './PinterestMark'
import SupportAppeal from './SupportAppeal'
import ContributePanel from './ContributePanel'
import DonateButton, { DONATE_CUT } from './DonateButton'
import ThemeToggle from './ThemeToggle'
import LanguageToggle from './LanguageToggle'
import { useTranslation } from '../lib/i18n'
import MonthlyGoalColumn from './MonthlyGoalColumn'
import CreatorPanel from './CreatorPanel'
import { openExternalUrl } from '../lib/openExternal'
import { ATRIUM_WEBSITE } from '../lib/creatorLinks'
import { useLandingTheme } from '../lib/useLandingTheme'
import { shouldShowAppeal } from '../lib/supportAppeal'
import { openContributors } from '../lib/contributorsRoute'
import { getCachedContributions, startContributionsRefresh, type ContributionsData } from '../lib/contributions'
import PortalLoop from './PortalLoop'
import { supabase, isDesktop } from '../lib/supabase'

// Lazy load desktop-only components to avoid importing Tauri deps in web mode

interface WelcomeScreenProps {
  onEnter: () => void
  onBackToLanding?: () => void
}

export default function WelcomeScreen({ onEnter, onBackToLanding }: WelcomeScreenProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [showPinterest, setShowPinterest] = useState(false)
  const theme = useLandingTheme()

  // Scale the whole menu down rather than let it scroll.
  //
  // Everything here is already sized against the viewport (clamp against vh),
  // which carries it a long way -- but past a point the type cannot shrink any
  // further without becoming unreadable, and the column started scrolling
  // instead. A title screen that scrolls does not read as a title screen; it
  // reads as a web page that did not fit. Games shrink the whole interface and
  // keep its proportions, so this does that: measure what the content wants,
  // measure what the window has, and scale by the ratio when it is short.
  //
  // Only ever down. Blowing the menu up to fill a large monitor would make it
  // enormous, and the clamps already grow it as far as it should go.
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [menuScale, setMenuScale] = useState(1)

  useEffect(() => {
    const el = menuRef.current
    if (!el) return

    const measure = () => {
      // scrollHeight is the height the content wants; the parent is the
      // full-height flex box it is centred in. Measured with the current
      // scale undone, or each pass would compound the last one.
      const available = el.parentElement?.clientHeight ?? window.innerHeight
      const natural = el.scrollHeight
      if (!natural || !available) return
      const next = Math.min(1, available / natural)
      // A hair of tolerance, so a sub-pixel difference does not set off an
      // endless measure-scale-measure loop.
      setMenuScale(prev => (Math.abs(prev - next) > 0.005 ? next : prev))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    if (el.parentElement) observer.observe(el.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // Set while the screen is stepping back, just before the browser is asked
  // for. Two screens on the same ground, one receding as the other rises,
  // reads as going a layer deeper rather than as a page being replaced.
  const [leaving, setLeaving] = useState(false)
  const [showContribute, setShowContribute] = useState(false)
  const [showCreator, setShowCreator] = useState(false)
  // Evaluated once, on mount, and shouldShowAppeal itself only answers true
  // once per launch -- coming back here after leaving an atrium is not a new
  // launch, and this must never appear over the canvas.
  const [showAppeal, setShowAppeal] = useState(() => shouldShowAppeal())
  // Read from cache on mount and refreshed behind the screen, so the bar is
  // there on the first frame and offline, rather than appearing a moment later
  // and pushing the menu down.
  const [contributions, setContributions] = useState<ContributionsData>(() => getCachedContributions())
  useEffect(() => startContributionsRefresh(setContributions), [])
  const [isHovered, setIsHovered] = useState<string | null>(null)
  const { t } = useTranslation()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const { username, setUsername } = useGameStore()

  // Renaming in place, desktop only -- see the field itself for why the web
  // keeps sending people to Profile Settings.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const commitName = async () => {
    const next = nameDraft.trim()
    setEditingName(false)
    // An empty box means "changed my mind", not "call me nothing".
    if (!next || next === username) return

    setUsername(next)
    try {
      // The local profile row is what the atrium reads for presence and for
      // the name shown on traces, so it has to move with the store.
      await (supabase?.from('profiles') as any)
        ?.update({ username: next, display_name: next })
        .eq('id', 'local-user')
    } catch {
      // The name is already applied locally; a failed write here means it
      // reverts on next launch rather than anything breaking now.
    }
  }

  const handleLogout = async () => {
    if (!supabase) return

    // Clear active_lobby_id before signing out
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await (supabase
        .from('profiles') as any)
        .update({ active_lobby_id: null })
        .eq('id', user.id)
    }

    // Clear local storage
    localStorage.removeItem('lobby_hasEntered')
    localStorage.removeItem('lobby_currentLobbyId')
    localStorage.removeItem('lobby_showBrowser')

    await supabase.auth.signOut()

    // Force navigation to landing page
    window.location.hash = '/'
    window.location.reload()
  }

  // The label was driven by state that started at false and was only ever
  // updated by this screen's own button, so it disagreed with reality whenever
  // fullscreen was entered anywhere else -- F11, or an atrium's own toggle
  // before navigating back here. Sync from the window on mount, and keep
  // following it afterwards.
  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    if (isDesktop) {
      import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()
        const actual = await win.isFullscreen()
        if (!cancelled) setIsFullscreen(actual)
        // Tauri has no dedicated fullscreen event; a resize always accompanies
        // the transition, so that's the signal to re-read it.
        unlisten = await win.onResized(async () => {
          const now = await win.isFullscreen()
          if (!cancelled) setIsFullscreen(now)
        })
      }).catch(() => { /* leave the label as-is rather than guessing */ })
    } else {
      const sync = () => setIsFullscreen(!!document.fullscreenElement)
      sync()
      document.addEventListener('fullscreenchange', sync)
      return () => document.removeEventListener('fullscreenchange', sync)
    }

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  const toggleFullscreen = async () => {
    if (isDesktop) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const current = await win.isFullscreen()
      await win.setFullscreen(!current)
      setIsFullscreen(!current)
    } else {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    }
  }

  // Memoize particle positions (fireflies)
  const particles = useMemo(() => 
    [...Array(15)].map((_, i) => ({
      left: `${(i * 17 + 3) % 96}%`,
      top: `${(i * 23 + 5) % 94}%`,
      duration: 8 + (i * 1.5) % 6,
      delay: i * 0.5,
    })), []
  )

  // Memoize background rectangles (trace-like elements)
  const backgroundRects = useMemo(() => 
    [...Array(10)].map((_, i) => ({
      left: `${(i * 19 + 7) % 90}%`,
      top: `${(i * 31 + 12) % 85}%`,
      width: 30 + (i * 17) % 80,
      height: 15 + (i * 13) % 40,
      rotation: (i * 7) % 15 - 7,
      delay: i * 0.3,
    })), []
  )

  return (
    <>
      <div className={`w-full h-full bg-nier-black flex items-center justify-center relative overflow-hidden ${leaving ? 'screen-recede' : 'screen-rise'}`}>
        {/* Scanline effect */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-40"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203, 203, 203, 0.1) 2px, rgba(203, 203, 203, 0.1) 4px)',
          }}
        />

        {/* Animated background grid */}
        <div 
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{
            backgroundImage: `
              linear-gradient(rgba(203, 203, 203, 0.15) 1px, transparent 1px),
              linear-gradient(90deg, rgba(203, 203, 203, 0.15) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />

        {/* Background rectangles (trace-like elements) */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {backgroundRects.map((rect, i) => (
            <div
              key={i}
              className="absolute border border-nier-border/[0.08] bg-nier-border/[0.02]"
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
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
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
        
        {/* Corner brackets decoration */}
        <div className="absolute top-8 left-8 w-16 h-16 border-l border-t border-nier-border/30" />
        <div className="absolute top-8 right-8 w-16 h-16 border-r border-t border-nier-border/30" />

        {/* Top right, where nothing else lives. The appeal only appears when
            somebody has used the place for a while; this is for the rest of
            the time, when they simply want to. */}
        <MonthlyGoalColumn
          month={contributions.month}
          onOpen={() => openContributors('/welcome')}
          scale={menuScale}
        />

        {/* Desktop only: the web app is already on the website, so there it
            would be a button that reloads the page you are looking at. Handed
            to the system browser rather than opened in the webview, which has
            no address bar to come back from.

            Up here rather than in the menu because it is the one row that led
            somewhere outside the app -- and the corner opposite the theme
            switch was empty, at the same height and in the same shape. */}
        {isDesktop && (
          <div className="absolute top-6 left-6 z-30 flex items-center gap-2">
            <button
              type="button"
              onClick={() => openExternalUrl(ATRIUM_WEBSITE)}
              title={t('welcome.websiteTitle')}
              className="cut-corner inline-flex items-center justify-center gap-2 h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/70 text-[11px] tracking-[0.15em] uppercase leading-none transition-colors"
              style={{ backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
            >
              {t('welcome.website')} ↗
            </button>
          </div>
        )}

        <div className="absolute top-6 right-6 z-30 flex items-center gap-2">
          <ThemeToggle />
          <DonateButton onClick={() => setShowContribute(true)} />
        </div>
        {/* Whose place this is, in the margin the goal gauge left empty.
            The same plate the front page wears in its top corner, for the same
            reason: a person's name on the front of a thing is the difference
            between a product and somebody's work. On desktop it is also the
            only place that story is told, since nobody opens an app they have
            installed to go and read its landing page.

            Hidden below lg, where the gauge hides too -- the margins it lives
            in stop existing. */}
        <button
          type="button"
          onClick={() => setShowCreator(true)}
          className="group hidden md:flex fixed right-10 xl:right-16 top-1/2 z-20 flex-col items-end text-right"
          // Same treatment as the gauge opposite: scaled rather than dropped,
          // with its own centring kept inside the transform so the inline
          // style does not replace it.
          style={{
            transform: `translateY(-50%) scale(${menuScale})`,
            transformOrigin: 'right center',
          }}
        >
          <span className="byline flex items-center gap-2 text-[10px] tracking-[0.3em] uppercase">
            <span className="byline-mark w-1.5 h-1.5 rotate-45" />
            {t('landing.madeBy')}
          </span>
          <span className="mt-2 text-sm tracking-[0.12em] uppercase text-nier-strong leading-none">
            Eduardo Paranhos
          </span>
          <span className="byline-link mt-2 flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase text-nier-bg/70">
            {t('landing.aboutCreator')}
            <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
          </span>
          <span className="byline-rule mt-2 block h-px w-full origin-right scale-x-0 group-hover:scale-x-100 transition-transform duration-500" />
        </button>

        <div className="absolute bottom-8 left-8 w-16 h-16 border-l border-b border-nier-border/30" />
        <div className="absolute bottom-8 right-8 w-16 h-16 border-r border-b border-nier-border/30" />

        {/* Web only: on desktop the About button below already goes to the
            landing page, so this was a second control for the same
            destination. */}
        {onBackToLanding && !isDesktop && (
          // Top left at the same height as the pair opposite it. It was twelve
          // from the edge against their six, wrapped in its own bordered box
          // with four corner ticks -- a control from a different era of this
          // screen.
          <button
            onClick={() => {
              setLeaving(true)
              setTimeout(onBackToLanding, 210)
            }}
            className="cut-corner absolute top-6 left-6 z-20 group inline-flex items-center gap-2 h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 hover:text-nier-strong hover:border-nier-border/70 text-[11px] tracking-[0.15em] uppercase leading-none transition-colors"
            style={{ backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}
          >
            <span className="transition-transform duration-300 group-hover:-translate-x-1">◁</span>
            {t('common.back')}
          </button>
        )}

        {/* Sized against the viewport rather than in fixed steps.
            Six stacked full-width buttons under a title, a portal loop and a
            hint list needed more height than a laptop screen has, so the title
            was being cut off. Everything here now scales with available height
            (clamp against vh), the whole column scrolls rather than clipping if
            it still doesn't fit, and the actions read as a title-screen menu
            instead of a stack of boxes -- which is most of the height saved. */}
        <div
          ref={menuRef}
          className="text-center px-8 py-6 max-w-lg w-full relative z-10"
          style={{
            // transform rather than a font-size cascade: it takes the spacing,
            // the portal loop and the rules with it, so the menu keeps its
            // proportions instead of just having smaller words in the same
            // gaps. It also costs no layout -- the browser is only drawing the
            // same box at a different size.
            transform: menuScale < 1 ? `scale(${menuScale})` : undefined,
            transformOrigin: 'center center',
          }}
        >
          {/* Title */}
          <div className="space-y-[clamp(0.5rem,1.5vh,1rem)]">
            <div className="flex items-center justify-center gap-4">
              <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-nier-border/60" />
              <span className="text-nier-bg/75 text-xs tracking-[0.3em] uppercase">{t('welcome.welcomeToThe')}</span>
              <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-nier-border/60" />
            </div>
            {/* The same face the website's title wears -- silver on black,
                gold on paper. Two screens, one name, one surface: it was
                previously flat bone here and metal there, which read as two
                different products wearing the same words.

                Tighter and heavier than it was. Wide tracking on a light
                weight is what makes a title look like a caption of itself. */}
            <h1
              className="tracking-[0.16em] uppercase font-normal leading-[0.95]"
              style={{
                fontSize: 'clamp(1.9rem, 5.6vh, 3.4rem)',
                // Letter-spacing is added after every character including the
                // last, so a centred line carries an invisible space on its
                // right and sits half a space left of centre. Pulling that
                // trailing space back is what actually centres it.
                textIndent: '0.16em',
                backgroundImage: 'var(--welcome-title)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              DIGITAL ATRIUM
            </h1>
            {/* Shrinks first when the window is short -- it's the most
                decorative element here and the least missed. */}
            {/* Height in vh rather than fixed steps, so this shrinks first on
                a short window -- it's the most decorative element here and the
                least missed. PortalLoop takes className only, so the sizing
                goes through an arbitrary-value class. */}
            <PortalLoop className="mx-auto h-[clamp(4rem,18vh,10rem)]" ink={theme.resolved === 'light'} />
            <p className="text-nier-bg/80 text-xs tracking-[0.2em] uppercase">
              {t('welcome.tagline')}
            </p>
          </div>

          {/* Diamond separator */}
          <div className="flex items-center justify-center gap-3 my-[clamp(0.75rem,2.5vh,1.75rem)]">
            <div className="w-20 h-[1px] bg-gradient-to-r from-transparent to-nier-border/40" />
            <div className="w-2 h-2 rotate-45 border border-nier-border/60" />
            <div className="w-20 h-[1px] bg-gradient-to-l from-transparent to-nier-border/40" />
          </div>

          {/* Welcome message */}
          <div className="space-y-[clamp(0.4rem,1.2vh,0.6rem)]">
            {/* Editable in place on desktop. The name is the one thing here
                someone actually wants to change, and sending them into Profile
                Settings for a single field was the long way round. Web keeps
                the read-only line: a display name there is tied to an account
                and has its own rules (cooldown, validation) that belong with
                the rest of the account settings. */}
            {isDesktop ? (
              // The name somebody chose for themselves, presented as such. It
              // read "User: name" in the same small type as the position
              // readout -- a field label and its value, which is how you write
              // a record, not how you greet somebody.
              <div className="flex flex-col items-center gap-2">
                {editingName ? (
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitName() }
                      if (e.key === 'Escape') { e.preventDefault(); setEditingName(false) }
                    }}
                    maxLength={32}
                    className="bg-transparent border-b border-nier-border/60 text-nier-strong text-lg tracking-[0.08em] text-center focus:outline-none focus:border-nier-bg w-48"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setNameDraft(username); setEditingName(true) }}
                    className="group flex items-center gap-3"
                    title={t('welcome.clickToRename')}
                  >
                    <span className="text-nier-bg/40 group-hover:text-nier-bg/70 text-[0.7em] transition-colors">◇</span>
                    <span className="name-sheen text-[clamp(1.3rem,3.4vh,2rem)] tracking-[0.14em] uppercase leading-none">
                      {username}
                    </span>
                    <span className="text-nier-bg/40 group-hover:text-nier-bg/70 text-[0.7em] transition-colors">✎</span>
                  </button>
                )}
                <div
                  className="name-rule h-[1px] w-32"
                  style={{ background: 'linear-gradient(90deg, transparent, rgb(var(--c-line) / 0.7), transparent)' }}
                />
              </div>
            ) : (
              // The name, not a field called User with a value after it.
              //
              // A colon is what you put between a label and its data; nobody
              // writes their own name that way. It is the largest thing in
              // this block after the title, a light passes across it once as
              // the screen arrives, and a rule draws itself out from the
              // middle underneath. A name that is simply there is a record --
              // a name that is written is a greeting.
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-nier-bg/40 text-[0.7em]">◇</span>
                  <span className="name-sheen text-[clamp(1.3rem,3.4vh,2rem)] tracking-[0.14em] uppercase leading-none">
                    {username}
                  </span>
                  <span className="text-nier-bg/40 text-[0.7em]">◇</span>
                </div>
                <div
                  className="name-rule h-[1px] w-32"
                  style={{ background: 'linear-gradient(90deg, transparent, rgb(var(--c-line) / 0.7), transparent)' }}
                />
              </div>
            )}

            {/* Enter Button */}
            {/* Filled, not outlined. This is the reason the screen exists,
                and it used to have exactly the weight of the four rows under
                it -- an outlined box among outlined boxes. Filled with the
                strong neutral it is unmistakably the way in, and it leaves the
                orange to mean one thing only.

                The cut corner is the shape Donate wears, and now the shape
                every committing action wears. */}
            <button
              onClick={() => {
                setLeaving(true)
                // Long enough for the recede to be seen, short enough that
                // nobody waits for it. The browser's own rise covers the rest.
                setTimeout(onEnter, 210)
              }}
              onMouseEnter={() => setIsHovered('enter')}
              onMouseLeave={() => setIsHovered(null)}
              className="relative w-full py-4 text-sm tracking-[0.22em] uppercase font-medium transition-transform duration-300 hover:scale-[1.015] active:scale-[0.995] group"
              style={{
                background: 'rgb(var(--c-accent))',
                color: 'rgb(var(--c-ground))',
                clipPath: DONATE_CUT,
              }}
            >
              <span className="relative z-10">{t('welcome.enter')}</span>
              {/* Animated brackets on hover */}
              <span className={`absolute left-3 top-1/2 -translate-y-1/2 transition-all duration-300 ${isHovered === 'enter' ? 'opacity-70 translate-x-0' : 'opacity-0 -translate-x-2'}`}>[</span>
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 transition-all duration-300 ${isHovered === 'enter' ? 'opacity-70 translate-x-0' : 'opacity-0 translate-x-2'}`}>]</span>
            </button>

            {/* The order is the order somebody needs them in: the thing
                they came to change, the thing they came to read, the two that
                are settings-shaped, then the two that end the session. */}

            {/* Settings Button */}
            <button
              onClick={() => setShowSettings(true)}
              onMouseEnter={() => setIsHovered('settings')}
              onMouseLeave={() => setIsHovered(null)}
              className="menu-row"
            >
              <span className="relative z-10">◇ {t('welcome.settings')}</span>
            </button>

            {/* Pinterest, between the settings and the reading.
                It sat inside Profile Settings, several scrolls down among the
                username and the cursor colour -- a reasonable place for a
                setting and a poor one for a feature nobody knows is there. */}
            <button
              onClick={() => setShowPinterest(true)}
              onMouseEnter={() => setIsHovered('pinterest')}
              onMouseLeave={() => setIsHovered(null)}
              className="menu-row"
            >
              {/* The diamond is plain text here, exactly as in every other
                  row. Giving it its own smaller, greyer span made it a
                  different mark from the ones above and below it -- the column
                  only reads as a column while they match. */}
              <span className="relative z-10">
                ◇ {t('welcome.pinterest')}{' '}
                <PinterestMark className="inline-block w-3 h-3 align-[-0.15em] opacity-70" />
              </span>
            </button>

            {/* About button (desktop only) */}
            {isDesktop && onBackToLanding && (
              <button
                onClick={onBackToLanding}
                onMouseEnter={() => setIsHovered('about')}
                onMouseLeave={() => setIsHovered(null)}
                className="menu-row"
              >
                <span className="relative z-10">◇ {t('welcome.about')}</span>
              </button>
            )}

            {/* The language picker. Renders nothing until there is more than
                one language to pick, so it can sit here from the day the
                plumbing lands. */}
            <LanguageToggle variant="menu" />

            {/* Contributors, on both platforms -- who paid for this is the same
                question wherever the app is running. */}
            <button
              onClick={() => openContributors('/welcome')}
              onMouseEnter={() => setIsHovered('contributors')}
              onMouseLeave={() => setIsHovered(null)}
              className="menu-row"
            >
              <span className="relative z-10">◇ {t('welcome.contributors')}</span>
            </button>

            {/* Fullscreen button */}
            <button
              onClick={toggleFullscreen}
              onMouseEnter={() => setIsHovered('fullscreen')}
              onMouseLeave={() => setIsHovered(null)}
              className="menu-row"
            >
              <span className="relative z-10">◇ {isFullscreen ? t('welcome.windowed') : t('welcome.fullscreen')}</span>
            </button>

            {/* Web only: desktop signs in automatically against the local
                vault, so there's no account to log out of -- and logging out
                there just bounced the user through a sign-in they never
                performed. */}
            {!isDesktop && (
              <button
                onClick={handleLogout}
                onMouseEnter={() => setIsHovered('logout')}
                onMouseLeave={() => setIsHovered(null)}
                className="menu-row menu-row-danger"
              >
                <span className="relative z-10">◇ {t('welcome.logOut')}</span>
              </button>
            )}

            {/* Exit button (desktop only) */}
            {isDesktop && (
              <button
                onClick={async () => {
                  const { getCurrentWindow } = await import('@tauri-apps/api/window')
                  getCurrentWindow().close()
                }}
                onMouseEnter={() => setIsHovered('exit')}
                onMouseLeave={() => setIsHovered(null)}
                className="menu-row menu-row-danger"
              >
                <span className="relative z-10">◇ {t('welcome.exit')}</span>
              </button>
            )}
          </div>

          {/* The hardcoded "v.1.0.0" that used to sit here would have gone
              stale the moment the app updated itself. Desktop now shows its
              real running version top-right (AppVersionBadge); web has no
              version worth showing, since a refresh is always current. */}
        </div>

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
            0%, 100% { opacity: 0.6; transform: rotate(var(--rotation, 0deg)) translateY(0px); }
            50% { opacity: 0.9; transform: rotate(var(--rotation, 0deg)) translateY(-10px); }
          }
        `}</style>
      </div>

      {showPinterest && <PinterestConnectionPanel onClose={() => setShowPinterest(false)} />}
      {showSettings && <ProfileSettings onClose={() => setShowSettings(false)} />}
      {showContribute && <ContributePanel onClose={() => setShowContribute(false)} />}

      {showCreator && <CreatorPanel onClose={() => setShowCreator(false)} />}
      {showAppeal && (
        <SupportAppeal
          onClose={() => setShowAppeal(false)}
          onDonate={() => {
            setShowAppeal(false)
            setShowContribute(true)
          }}
        />
      )}
    </>
  )
}
