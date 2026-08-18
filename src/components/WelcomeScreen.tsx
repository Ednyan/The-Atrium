import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { useGameStore } from '../store/gameStore'
import ProfileSettings from './ProfileSettings'
import ContributorsPanel from './ContributorsPanel'
import { getCachedContributions, startContributionsRefresh, type ContributionsData } from '../lib/contributions'
import PortalLoop from './PortalLoop'
import { supabase, isDesktop } from '../lib/supabase'

// Lazy load desktop-only components to avoid importing Tauri deps in web mode
const ExportDatabase = lazy(() => import('./ExportDatabase'))

interface WelcomeScreenProps {
  onEnter: () => void
  onBackToLanding?: () => void
}

export default function WelcomeScreen({ onEnter, onBackToLanding }: WelcomeScreenProps) {
  const [showSettings, setShowSettings] = useState(false)
  const [showContributors, setShowContributors] = useState(false)
  // Read from cache on mount and refreshed behind the screen, so the bar is
  // there on the first frame and offline, rather than appearing a moment later
  // and pushing the menu down.
  const [contributions, setContributions] = useState<ContributionsData>(() => getCachedContributions())
  useEffect(() => startContributionsRefresh(setContributions), [])
  const [showExport, setShowExport] = useState(false)
  const [isHovered, setIsHovered] = useState<string | null>(null)
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
      <div className="w-full h-full bg-nier-black flex items-center justify-center relative overflow-hidden">
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
        <div className="absolute bottom-8 left-8 w-16 h-16 border-l border-b border-nier-border/30" />
        <div className="absolute bottom-8 right-8 w-16 h-16 border-r border-b border-nier-border/30" />

        {/* Web only: on desktop the About button below already goes to the
            landing page, so this was a second control for the same
            destination. */}
        {onBackToLanding && !isDesktop && (
          <button
            onClick={onBackToLanding}
            className="absolute top-12 left-12 group z-20"
          >
            <div className="relative px-4 py-2 border border-nier-border/40 bg-nier-black/80 hover:border-nier-border/80 hover:bg-nier-blackLight transition-all duration-300">
              {/* Corner accents */}
              <div className="absolute -top-0.5 -left-0.5 w-2 h-2 border-l border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 border-r border-t border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -bottom-0.5 -left-0.5 w-2 h-2 border-l border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 border-r border-b border-nier-border/60 group-hover:border-nier-bg transition-colors" />
              
              <div className="flex items-center gap-3">
                <span className="text-nier-bg/75 group-hover:text-nier-bg group-hover:-translate-x-1 transition-all duration-300">◁</span>
                <span className="text-[10px] tracking-[0.2em] uppercase text-nier-bg/75 group-hover:text-nier-bg transition-colors">Back</span>
              </div>
            </div>
          </button>
        )}

        {/* Sized against the viewport rather than in fixed steps.
            Six stacked full-width buttons under a title, a portal loop and a
            hint list needed more height than a laptop screen has, so the title
            was being cut off. Everything here now scales with available height
            (clamp against vh), the whole column scrolls rather than clipping if
            it still doesn't fit, and the actions read as a title-screen menu
            instead of a stack of boxes -- which is most of the height saved. */}
        <div className="text-center px-8 py-6 max-w-lg w-full relative z-10 max-h-full overflow-y-auto">
          {/* Title */}
          <div className="space-y-[clamp(0.5rem,1.5vh,1rem)]">
            <div className="flex items-center justify-center gap-4">
              <div className="w-12 h-[1px] bg-gradient-to-r from-transparent to-nier-border/60" />
              <span className="text-nier-bg/75 text-[10px] tracking-[0.3em] uppercase">Welcome to the</span>
              <div className="w-12 h-[1px] bg-gradient-to-l from-transparent to-nier-border/60" />
            </div>
            <h1
              className="text-white tracking-[0.3em] uppercase font-light leading-tight"
              style={{ fontSize: 'clamp(1.6rem, 5vh, 3rem)' }}
            >
              DIGITAL ATRIUM
            </h1>
            {/* Shrinks first when the window is short -- it's the most
                decorative element here and the least missed. */}
            {/* Height in vh rather than fixed steps, so this shrinks first on
                a short window -- it's the most decorative element here and the
                least missed. PortalLoop takes className only, so the sizing
                goes through an arbitrary-value class. */}
            <PortalLoop className="mx-auto h-[clamp(4rem,18vh,10rem)]" />
            <p className="text-nier-bg/80 text-[11px] tracking-[0.2em] uppercase">
              A quiet space for creative presence
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
              <div className="flex items-center justify-center gap-2 text-sm tracking-wide">
                <span className="text-nier-bg/60">User:</span>
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
                    className="bg-transparent border-b border-nier-border/60 text-nier-bg text-sm tracking-wide text-center focus:outline-none focus:border-nier-bg w-40"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setNameDraft(username); setEditingName(true) }}
                    className="group text-nier-bg border-b border-nier-border/40 hover:border-nier-bg transition-colors"
                    title="Click to rename"
                  >
                    {username}
                    <span className="text-nier-bg/70 group-hover:text-nier-bg text-[10px] ml-2 transition-colors">✎</span>
                  </button>
                )}
              </div>
            ) : (
              <p className="text-nier-bg/80 text-sm tracking-wide">
                User: <span className="text-nier-bg border-b border-nier-border/40 pb-0.5">{username}</span>
              </p>
            )}

            {/* Enter Button */}
            <button
              onClick={onEnter}
              onMouseEnter={() => setIsHovered('enter')}
              onMouseLeave={() => setIsHovered(null)}
              className="relative w-full py-4 border border-nier-border/60 text-nier-bg text-xs tracking-[0.2em] uppercase transition-all duration-300 hover:bg-nier-bg hover:text-nier-black hover:border-nier-bg group"
            >
              <span className="relative z-10">Enter the Atrium</span>
              {/* Animated brackets on hover */}
              <span className={`absolute left-2 top-1/2 -translate-y-1/2 text-nier-bg/80 transition-all duration-300 ${isHovered === 'enter' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'}`}>[</span>
              <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-nier-bg/80 transition-all duration-300 ${isHovered === 'enter' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}`}>]</span>
            </button>

            {/* Settings Button */}
            <button
              onClick={() => setShowSettings(true)}
              onMouseEnter={() => setIsHovered('settings')}
              onMouseLeave={() => setIsHovered(null)}
              className="menu-row"
            >
              <span className="relative z-10">◇ Profile Settings</span>
            </button>

            {/* Contributors, on both platforms -- who paid for this is the same
                question wherever the app is running. */}
            <button
              onClick={() => setShowContributors(true)}
              onMouseEnter={() => setIsHovered('contributors')}
              onMouseLeave={() => setIsHovered(null)}
              className="menu-row"
            >
              <span className="relative z-10">◇ Contributors</span>
            </button>

            {/* About button (desktop only) */}
            {isDesktop && onBackToLanding && (
              <button
                onClick={onBackToLanding}
                onMouseEnter={() => setIsHovered('about')}
                onMouseLeave={() => setIsHovered(null)}
                className="menu-row"
              >
                <span className="relative z-10">◇ About</span>
              </button>
            )}

            {/* Export Atrium button (desktop only) */}
            {isDesktop && (
              <button
                onClick={() => setShowExport(true)}
                onMouseEnter={() => setIsHovered('export')}
                onMouseLeave={() => setIsHovered(null)}
                className="menu-row"
              >
                <span className="relative z-10">◇ Export Atrium</span>
              </button>
            )}

            {/* Fullscreen button */}
            <button
              onClick={toggleFullscreen}
              onMouseEnter={() => setIsHovered('fullscreen')}
              onMouseLeave={() => setIsHovered(null)}
              className="menu-row"
            >
              <span className="relative z-10">◇ {isFullscreen ? 'Windowed' : 'Fullscreen'}</span>
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
                <span className="relative z-10">◇ Log Out</span>
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
                <span className="relative z-10">◇ Exit Application</span>
              </button>
            )}
          </div>

          {/* This month's support, as a line rather than a panel.
              
              Deliberately tiny and only rendered once there is data: this
              screen is height-constrained and was cut off on short laptops
              before, so nothing here may claim vertical space it hasn't
              earned. Clicking it opens the same panel the menu button does --
              a bar that fills is an invitation to look, and it should lead
              somewhere. */}
          {contributions.month && contributions.month.goalCents > 0 && (
            <button
              type="button"
              onClick={() => setShowContributors(true)}
              className="w-full group text-left"
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[9px] text-nier-bg/70 group-hover:text-nier-bg tracking-[0.2em] uppercase transition-colors">
                  This month
                </span>
                <span className="text-[9px] text-nier-bg/70 group-hover:text-nier-bg tracking-wider transition-colors">
                  {Math.round(contributions.month.totalCents / 100)} / {Math.round(contributions.month.goalCents / 100)} €
                </span>
              </div>
              <div className="h-[3px] bg-nier-black border border-nier-border/30 overflow-hidden">
                <div
                  className="h-full bg-nier-bg/80 group-hover:bg-nier-bg transition-all duration-700 ease-out"
                  style={{
                    width: `${Math.min(100, (contributions.month.totalCents / contributions.month.goalCents) * 100)}%`,
                  }}
                />
              </div>
            </button>
          )}

          {/* Info */}
          <div className="text-[10px] text-nier-bg/70 space-y-2 tracking-wider uppercase">
            <p>◦ Drag to navigate the space</p>
            <p>◦ Click to leave traces</p>
            <p>◦ Share presence with others</p>
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

      {showSettings && <ProfileSettings onClose={() => setShowSettings(false)} />}
      {showContributors && <ContributorsPanel onClose={() => setShowContributors(false)} />}
      {showExport && (
        <Suspense fallback={null}>
          <ExportDatabase onClose={() => setShowExport(false)} />
        </Suspense>
      )}
    </>
  )
}
