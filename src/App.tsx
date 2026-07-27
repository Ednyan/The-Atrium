import { useState, useEffect, useRef } from 'react'
import LobbyScene from './components/LobbyScene'
import WelcomeScreen from './components/WelcomeScreen'
import AuthScreen from './components/AuthScreen'
import ChooseUsernameScreen from './components/ChooseUsernameScreen'
import UpdateChecker from './components/UpdateChecker'
import AppVersionBadge from './components/AppVersionBadge'
import LandingPage from './components/LandingPage'
import { LobbyBrowser } from './components/LobbyBrowser'
import { useGameStore } from './store/gameStore'
import { supabase, isDesktop } from './lib/supabase'
import { useTraces } from './hooks/useTraces'
import { saveAllChanges } from './lib/traceSave'
import { handlePinterestCallback } from './lib/pinterest'

type AtriumTransitionPhase = 'loading' | 'entering' | 'flash' | 'finalizing' | 'ready'

const ANIMATION_FPS = 40

// Whether this profile's username was picked by the person or derived for them
// by handle_new_user. Read from the profiles.username_chosen flag, with a
// permissive fallback: if the column isn't there yet (migration not applied),
// treat the name as chosen rather than re-prompting everyone.
//
// This used to regex-match the trigger's fallback name (user_<id-prefix>), which
// silently stopped working once the trigger began preferring the provider's real
// name for OAuth -- the generated username no longer looked generated, so Google
// users were never asked to choose one.
const hasChosenUsername = (profile: any) => profile?.username_chosen !== false

const LOADING_ANIMATION_FRAMES = Object.entries(
  import.meta.glob('/loading_animation/*.jpg', { eager: true, import: 'default' }) as Record<string, string>
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)

// The one-shot "entering" cinematic used to be this same per-frame JPEG
// sequence approach (see LOADING_ANIMATION_FRAMES/ImageSequencePlayer
// below, still used for the looping loading spinner) -- decoding ~119
// separate JPEGs one at a time on the main thread, racing a fixed-rate
// requestAnimationFrame clock, was exactly what caused the stutter/flicker
// (and occasional freeze on a slow device that never caught up on decode).
// A real video lets the browser's hardware decoder handle it instead, and
// is a fraction of the size (encoded from the same frames, ~780KB vs ~8MB).
const ENTERING_ANIMATION_VIDEO_SRC = '/entering-animation.mp4'

// Module-level (not component state) so decoded frames stay warm for the
// life of the page -- both sequences get reused across multiple overlay
// phases per atrium entry (the loading loop shows during verifying/
// finalizing/waiting) and across every atrium entered in the session, so
// without this every remount of ImageSequencePlayer would re-decode from
// scratch. Bounded concurrency avoids firing ~119 full-frame decode() calls
// at once, which was contending hard enough for CPU/memory to stutter the
// entering cinematic while its fixed-fps clock was already running.
const decodedFrameUrls = new Set<string>()
const pendingFrameDecodes = new Map<string, Promise<void>>()
const MAX_CONCURRENT_FRAME_DECODES = 6
let activeFrameDecodes = 0
const frameDecodeQueue: (() => void)[] = []

function runNextQueuedDecode() {
  if (activeFrameDecodes >= MAX_CONCURRENT_FRAME_DECODES) return
  const next = frameDecodeQueue.shift()
  if (next) {
    activeFrameDecodes += 1
    next()
  }
}

function decodeFrame(src: string): Promise<void> {
  if (decodedFrameUrls.has(src)) return Promise.resolve()
  const existing = pendingFrameDecodes.get(src)
  if (existing) return existing

  const promise = new Promise<void>((resolve) => {
    frameDecodeQueue.push(() => {
      const img = new Image()
      img.decoding = 'async'
      const finish = () => {
        decodedFrameUrls.add(src)
        activeFrameDecodes -= 1
        runNextQueuedDecode()
        resolve()
      }
      img.onload = () => { img.decode().catch(() => {}).finally(finish) }
      img.onerror = finish
      img.src = src
    })
    runNextQueuedDecode()
  })
  pendingFrameDecodes.set(src, promise)
  return promise
}

function ImageSequencePlayer({
  frames,
  fps = ANIMATION_FPS,
  loop = false,
  bufferLeadFrames = 12,
  nearCompleteLeadFrames = 0,
  onNearComplete,
  onComplete,
  alt,
  className,
}: {
  frames: string[]
  fps?: number
  loop?: boolean
  bufferLeadFrames?: number
  nearCompleteLeadFrames?: number
  onNearComplete?: () => void
  onComplete?: () => void
  alt: string
  className?: string
}) {
  const [frameIndex, setFrameIndex] = useState(0)
  const decodedFramesRef = useRef<boolean[]>([])
  // Mirrors how many frames have decoded so far, without being React state --
  // this is read inside the single persistent playback loop below rather
  // than being an effect dependency, so background frames finishing decode
  // mid-playback can't tear down and restart the loop (which used to reset
  // its clock to zero, causing the animation to visibly jump back/freeze).
  const decodedCountRef = useRef(0)
  const frameIndexRef = useRef(0)
  const completionFiredRef = useRef(false)
  const nearCompletionFiredRef = useRef(false)

  useEffect(() => {
    setFrameIndex(0)
    frameIndexRef.current = 0
    decodedFramesRef.current = Array(frames.length).fill(false)
    decodedCountRef.current = 0
    completionFiredRef.current = false
    nearCompletionFiredRef.current = false
  }, [frames, loop, nearCompleteLeadFrames, bufferLeadFrames])

  // Pre-decode frames so playback doesn't hitch while decoding in real time.
  // Routes through the shared, page-lifetime decode cache: if a frame was
  // already decoded (by an earlier phase, or an earlier atrium entry this
  // session), it's marked synchronously here instead of being decoded again.
  useEffect(() => {
    if (frames.length === 0) return

    let cancelled = false

    frames.forEach((src, idx) => {
      if (decodedFrameUrls.has(src)) {
        decodedFramesRef.current[idx] = true
        decodedCountRef.current += 1
        return
      }

      decodeFrame(src).then(() => {
        if (cancelled) return
        if (decodedFramesRef.current[idx]) return
        decodedFramesRef.current[idx] = true
        decodedCountRef.current += 1
      })
    })

    return () => {
      cancelled = true
    }
  }, [frames])

  useEffect(() => {
    if (frames.length === 0) {
      if (!loop && onComplete && !completionFiredRef.current) {
        completionFiredRef.current = true
        onComplete()
      }
      return
    }

    const minimumBuffered = Math.min(Math.max(1, bufferLeadFrames), frames.length)

    let rafId = 0
    // Not captured until the buffering threshold is actually met (inside
    // tick), so waiting for decode never eats into the animation's clock.
    let startTime: number | null = null

    const tick = (now: number) => {
      if (startTime === null) {
        if (decodedCountRef.current < minimumBuffered) {
          rafId = window.requestAnimationFrame(tick)
          return
        }
        startTime = now
      }

      const elapsedSeconds = (now - startTime) / 1000
      const rawIndex = Math.floor(elapsedSeconds * fps)

      let nextIndex = loop ? rawIndex % frames.length : Math.min(rawIndex, frames.length - 1)

      // If the desired frame isn't decoded yet, hold to the last decoded frame.
      if (!decodedFramesRef.current[nextIndex]) {
        let fallback = nextIndex
        while (fallback > frameIndexRef.current && !decodedFramesRef.current[fallback]) {
          fallback -= 1
        }
        nextIndex = decodedFramesRef.current[fallback] ? fallback : frameIndexRef.current
      }

      if (nextIndex !== frameIndexRef.current) {
        frameIndexRef.current = nextIndex
        setFrameIndex(nextIndex)
      }

      if (!loop && onNearComplete && !nearCompletionFiredRef.current) {
        const nearCompleteAt = Math.max(0, frames.length - 1 - nearCompleteLeadFrames)
        if (nextIndex >= nearCompleteAt) {
          nearCompletionFiredRef.current = true
          onNearComplete()
        }
      }

      if (!loop && rawIndex >= frames.length - 1) {
        if (onComplete && !completionFiredRef.current) {
          completionFiredRef.current = true
          onComplete()
        }
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [
    frames,
    fps,
    loop,
    bufferLeadFrames,
    nearCompleteLeadFrames,
    onNearComplete,
    onComplete,
  ])

  if (frames.length === 0) {
    return <div className={className} aria-label={alt} role="img" />
  }

  return (
    <div
      className={className}
      role="img"
      aria-label={alt}
      style={{
        backgroundImage: `url("${frames[frameIndex]}")`,
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  )
}

function AtriumTransitionOverlay({
  title,
  subtitle,
  frames,
  videoSrc,
  loop,
  nearCompleteLeadFrames,
  onNearComplete,
  onAnimationComplete,
  progressClassName,
}: {
  title: string
  subtitle: string
  frames?: string[]
  // When set, renders a <video> instead of the JPEG-sequence player (see
  // ENTERING_ANIMATION_VIDEO_SRC) -- takes precedence over `frames`.
  videoSrc?: string
  loop?: boolean
  nearCompleteLeadFrames?: number
  onNearComplete?: () => void
  onAnimationComplete?: () => void
  progressClassName: string
}) {
  const nearCompleteFiredRef = useRef(false)
  useEffect(() => {
    nearCompleteFiredRef.current = false
  }, [videoSrc])

  // The video's own footage fades to white in its last ~150ms (a portal
  // expanding to fill the frame) -- letterboxed inside a viewport-sized box
  // that's narrower than the full screen, so once that expanding white fills
  // the box, the box's own edges (and any letterbox bars beyond it) become
  // visible as a hard border against the surrounding black page, right as
  // everything is supposed to read as "the whole screen going white".
  //
  // Rather than cut to the separate AtriumFlashOverlay at a single instant
  // (previously ~1 video frame before the end) and hope the timing lines up
  // with however that footage happens to look, a full-viewport white div is
  // crossfaded in UNDER our control well before the video ends -- covering
  // the letterbox/border artifact regardless of the source footage's own
  // fade, and finishing at (or just before) the real end so the later swap
  // to AtriumFlashOverlay is invisible (both are already solid white).
  const [flashActive, setFlashActive] = useState(false)
  const CROSSFADE_LEAD_SEC = 0.6
  useEffect(() => {
    setFlashActive(false)
  }, [videoSrc])

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4 overflow-hidden">
      <div className="w-full max-w-[1600px] flex flex-col items-center justify-center">
        <p className="text-white text-[clamp(9px,2vw,15px)] tracking-[0.25em] uppercase mb-3 text-center">{title}</p>

        {videoSrc ? (
          <>
            <video
              key={videoSrc}
              src={videoSrc}
              autoPlay
              muted
              playsInline
              aria-label={title}
              className="w-[90vw] h-[58vh] sm:h-[62vh] max-h-[760px] object-contain"
              onTimeUpdate={(e) => {
                const video = e.currentTarget
                if (nearCompleteFiredRef.current || !video.duration) return
                if (video.currentTime >= video.duration - CROSSFADE_LEAD_SEC) {
                  nearCompleteFiredRef.current = true
                  setFlashActive(true)
                  onNearComplete?.()
                }
              }}
              onEnded={() => onAnimationComplete?.()}
            />
            <div
              aria-hidden="true"
              className="fixed inset-0 z-40 bg-white pointer-events-none"
              style={{
                opacity: flashActive ? 1 : 0,
                transition: `opacity ${CROSSFADE_LEAD_SEC}s linear`,
              }}
            />
          </>
        ) : (
          <ImageSequencePlayer
            frames={frames ?? []}
            loop={loop ?? false}
            nearCompleteLeadFrames={nearCompleteLeadFrames}
            onNearComplete={onNearComplete}
            onComplete={onAnimationComplete}
            alt={title}
            className="w-[90vw] h-[58vh] sm:h-[62vh] max-h-[760px]"
          />
        )}

        <div className="w-[60vw] sm:w-[420px] h-[3px] bg-white/10 overflow-hidden mx-auto mt-3">
          <div className={progressClassName} />
        </div>

        <p className="text-gray-500 text-[clamp(7px,1.6vw,11px)] tracking-[0.2em] uppercase mt-3 text-center">{subtitle}</p>
      </div>
    </div>
  )
}

function AtriumFlashOverlay({ onComplete }: { onComplete: () => void }) {
  return <div className="fixed inset-0 z-50 atrium-flash-transition" onAnimationEnd={onComplete} />
}

// Local user ID constant (matches localDb.ts) — avoids importing Tauri dependencies in web mode
const LOCAL_USER_ID = 'local-user'

// Storage keys for persisting navigation state
const STORAGE_KEYS = {
  HAS_ENTERED: 'lobby_hasEntered',
  CURRENT_LOBBY: 'lobby_currentLobbyId',
  SHOW_BROWSER: 'lobby_showBrowser',
  SHOW_LANDING: 'lobby_showLanding',
}

// Route parsing helper
function parseRoute(): { page: string; lobbyId?: string } {
  const hash = window.location.hash.slice(1) || '/'
  
  if (hash.startsWith('/atrium/')) {
    const lobbyId = hash.replace('/atrium/', '')
    return { page: 'atrium', lobbyId }
  }
  
  switch (hash) {
    case '/':
      return { page: 'landing' }
    case '/login':
      return { page: 'login' }
    case '/welcome':
      return { page: 'welcome' }
    case '/browse':
      return { page: 'browse' }
    default:
      return { page: 'landing' }
  }
}

// Navigation helper - updates both URL and route state
let setRouteCallback: ((route: { page: string; lobbyId?: string }) => void) | null = null

function navigate(path: string) {
  window.location.hash = path
  // Also immediately update route state to avoid render-time navigate calls
  if (setRouteCallback) {
    setRouteCallback(parseRoute())
  }
}

function AppInner() {
  const { setUsername, setUserId, setPlayerColor, clearLobbyData } = useGameStore()

  // URL-based routing state
  const [route, setRoute] = useState(parseRoute)
  
  // Store the setRoute callback for the navigate function
  useEffect(() => {
    setRouteCallback = setRoute
    return () => { setRouteCallback = null }
  }, [])
  
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  // Set when a session exists but has no usable username yet -- a first OAuth
  // sign-in, or a profile the trigger failed to create. Holds the username
  // screen open until they pick one.
  const [pendingUsernameUser, setPendingUsernameUser] = useState<{ id: string; email: string } | null>(null)
  // An OAuth failure handed back on the return URL. Supabase reports these as
  // ?error=...&error_description=... rather than throwing, so without this the
  // app just rendered the landing page and the user saw an unexplained bounce
  // back to the homepage -- the actual reason was sitting in the address bar.
  const [oauthError, setOauthError] = useState<string | null>(null)

  useEffect(() => {
    // Supabase puts these in the query string; the app's own routing lives in
    // the hash, so both can be present at once.
    const params = new URLSearchParams(window.location.search)
    const description = params.get('error_description')
    const code = params.get('error')
    if (!description && !code) return

    setOauthError(description || code)
    // Strip them so a refresh doesn't keep re-reporting a stale failure,
    // preserving the hash route.
    const cleaned = window.location.pathname + window.location.hash
    window.history.replaceState({}, '', cleaned)
    navigate('/login')
  }, [])
  const [loading, setLoading] = useState(true)
  const [currentLobbyId, setCurrentLobbyId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_LOBBY)
  })
  
  // Track verified lobby access (for URL-based navigation security)
  const [verifiedLobbyId, setVerifiedLobbyId] = useState<string | null>(null)
  const [lobbyAccessError, setLobbyAccessError] = useState<string | null>(null)
  const [verifyingAccess, setVerifyingAccess] = useState(false)
  const [atriumTransitionPhase, setAtriumTransitionPhase] = useState<AtriumTransitionPhase>('loading')
  const [transitionLobbyId, setTransitionLobbyId] = useState<string | null>(null)
  const [enteringVideoReady, setEnteringVideoReady] = useState(false)

  // Preload the entering cinematic as early as possible -- as soon as the
  // app boots, well before the entering overlay itself mounts -- so it
  // never has to start playback while still fetching. Gating the
  // 'loading' -> 'entering' phase transition on this (see the effect below)
  // means the wait is absorbed by the already-present loading loop instead
  // of showing up as a stall later. canplaythrough (not just canplay/
  // loadeddata) means the browser estimates it can play to the end without
  // having to pause and rebuffer.
  useEffect(() => {
    let cancelled = false
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = ENTERING_ANIMATION_VIDEO_SRC
    const markReady = () => { if (!cancelled) setEnteringVideoReady(true) }
    video.addEventListener('canplaythrough', markReady)
    video.addEventListener('error', markReady) // don't block entry forever if the video fails to load
    video.load()

    return () => {
      cancelled = true
      video.removeEventListener('canplaythrough', markReady)
      video.removeEventListener('error', markReady)
    }
  }, [])

  // Pick up a Pinterest OAuth redirect (?code=...&state=...) once the user's
  // session is confirmed -- the exchange needs their Supabase JWT to know
  // which account to attach the connection to. Web only; handlePinterestCallback
  // itself no-ops if the URL doesn't carry OAuth params, so this is cheap to
  // run on every authenticated mount.
  useEffect(() => {
    if (isDesktop || !isAuthenticated) return
    handlePinterestCallback().then((result) => {
      if (!result.handled) return
      if (result.success) {
        alert(result.username ? `Pinterest connected as @${result.username}!` : 'Pinterest connected!')
      } else if (result.error) {
        alert(`Pinterest: ${result.error}`)
      }
    })
  }, [isAuthenticated])

  // Listen for hash changes (browser back/forward)
  useEffect(() => {
    const handleHashChange = () => {
      setRoute(parseRoute())
      // Reset access verification when route changes
      setLobbyAccessError(null)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  // Reset and track transition state for each atrium entry.
  useEffect(() => {
    if (route.page === 'atrium' && route.lobbyId) {
      setTransitionLobbyId(route.lobbyId)
      setAtriumTransitionPhase('loading')
      return
    }

    setTransitionLobbyId(null)
    setAtriumTransitionPhase('loading')
  }, [route.page, route.lobbyId])

  // Start loading traces (and, on desktop, pre-resolving local media) as soon
  // as access to the atrium is verified, so this overlaps with the loading
  // screen instead of only starting once LobbyScene mounts at the very end
  // of the transition — that's what made traces (especially local images)
  // visibly pop in after the loading screen finished.
  const preloadLobbyId = (route.page === 'atrium' && route.lobbyId && verifiedLobbyId === route.lobbyId)
    ? route.lobbyId
    : null
  const { isLoading: tracesLoading } = useTraces(preloadLobbyId)

  // Once access is verified, the entering cinematic's video is preloaded,
  // AND trace/local-media loading has finished, transition from the loading
  // loop to the entering sequence. Waiting on trace loading here (not just
  // video preload) matters: that loading work runs on the same main thread,
  // so letting it run out during the already variable-length loading loop --
  // instead of overlapping it with the entering animation -- keeps it from
  // contending with (and stuttering) the animation. Capped at 6s so a
  // slow/hung request can't block entry indefinitely.
  useEffect(() => {
    if (route.page !== 'atrium' || !route.lobbyId) return
    if (verifiedLobbyId !== route.lobbyId) return
    if (transitionLobbyId !== route.lobbyId) return
    if (atriumTransitionPhase !== 'loading') return
    if (!enteringVideoReady) return

    if (!tracesLoading) {
      setAtriumTransitionPhase('entering')
      return
    }
    const timeout = setTimeout(() => setAtriumTransitionPhase('entering'), 6000)
    return () => clearTimeout(timeout)
  }, [
    route.page,
    route.lobbyId,
    verifiedLobbyId,
    transitionLobbyId,
    atriumTransitionPhase,
    enteringVideoReady,
    tracesLoading,
  ])

  // Flash always completes quickly on its own, but don't drop straight into
  // the atrium until trace data (and pre-resolved local media) is actually
  // ready — otherwise the flash just hides the same pop-in the user reported.
  // A max wait keeps this from hanging if the fetch is slow or fails.
  useEffect(() => {
    if (atriumTransitionPhase !== 'finalizing') return
    if (!tracesLoading) {
      setAtriumTransitionPhase('ready')
      return
    }
    const timeout = setTimeout(() => setAtriumTransitionPhase('ready'), 6000)
    return () => clearTimeout(timeout)
  }, [atriumTransitionPhase, tracesLoading])

  // Verify lobby access when trying to access via URL
  useEffect(() => {
    const verifyLobbyAccess = async () => {
      if (!supabase || !isAuthenticated) return
      if (route.page !== 'atrium' || !route.lobbyId) return
      
      // If already verified for this lobby, skip
      if (verifiedLobbyId === route.lobbyId) return
      
      // In desktop mode, local user always has access — skip verification
      if (isDesktop) {
        setVerifiedLobbyId(route.lobbyId)
        setCurrentLobbyId(route.lobbyId)
        localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, route.lobbyId)
        return
      }
      
      setVerifyingAccess(true)
      setLobbyAccessError(null)

      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setLobbyAccessError('Not authenticated')
          setVerifyingAccess(false)
          return
        }

        // Check if lobby exists
        const { data: lobby, error: lobbyError } = await (supabase as any)
          .from('lobbies')
          .select('id, owner_user_id, is_public, password_hash')
          .eq('id', route.lobbyId)
          .single()
        
        if (lobbyError || !lobby) {
          setLobbyAccessError('Atrium not found')
          setVerifyingAccess(false)
          return
        }
        
        // Owner always has access
        if (lobby.owner_user_id === user.id) {
          setVerifiedLobbyId(route.lobbyId)
          setCurrentLobbyId(route.lobbyId)
          localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, route.lobbyId)
          // Update active_lobby_id
          await (supabase.from('profiles') as any)
            .update({ active_lobby_id: route.lobbyId })
            .eq('id', user.id)
          setVerifyingAccess(false)
          return
        }
        
        // Check access status using RPC
        const { data: accessStatus } = await (supabase as any).rpc('get_user_lobby_access_status', {
          p_lobby_id: route.lobbyId,
          p_user_id: user.id,
        })
        
        if (accessStatus === 'blacklisted') {
          setLobbyAccessError('You have been blocked from this atrium')
          setVerifyingAccess(false)
          return
        }

        // Admins bypass the password prompt exactly like the owner does (and
        // exactly like can_user_join_lobby lets them in server-side). Without
        // this an admin who isn't the owner fell through to the password gate
        // below with no lobby_sessions row (they never enter a password, so
        // one is never recorded for them) and got re-prompted on every
        // refresh, while the owner -- handled by the explicit owner check
        // above -- did not.
        if (accessStatus === 'admin') {
          setVerifiedLobbyId(route.lobbyId)
          setCurrentLobbyId(route.lobbyId)
          localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, route.lobbyId)
          await (supabase.from('profiles') as any)
            .update({ active_lobby_id: route.lobbyId })
            .eq('id', user.id)
          setVerifyingAccess(false)
          return
        }

        // Check if lobby has a password. This applies even to whitelisted
        // users -- a lobby can require both whitelist membership AND a
        // password (see can_user_join_lobby), so whitelisting alone must not
        // bypass it. Route through the lobby browser's password prompt,
        // which records a verified session that RLS can check afterwards.
        const { data: hasPassword } = await (supabase as any).rpc('lobby_has_password', {
          p_lobby_id: route.lobbyId,
        })

        if (hasPassword) {
          // ...unless the user already entered the password recently. Entering
          // it (via the lobby browser -> can_user_join_lobby) records a
          // lobby_sessions row the user is allowed to read back (see the
          // "Users can view their own lobby sessions" RLS policy). Skip the
          // re-prompt on a plain refresh as long as that verification is
          // still within the 30-minute idle window kept fresh by LobbyScene's
          // heartbeat -- a direct SELECT here rather than the earlier RPC,
          // since the RPC path silently failed for guests in practice and a
          // plain read is easy to reason about and debug.
          const IDLE_LIMIT_MS = 30 * 60 * 1000
          const { data: session, error: sessionError } = await (supabase as any)
            .from('lobby_sessions')
            .select('verified_at')
            .eq('lobby_id', route.lobbyId)
            .eq('user_id', user.id)
            .maybeSingle()
          if (sessionError) {
            console.error('lobby_sessions read error:', sessionError)
          }
          const verifiedAt = session?.verified_at ? new Date(session.verified_at).getTime() : 0
          const sessionIsFresh = verifiedAt > 0 && (Date.now() - verifiedAt) < IDLE_LIMIT_MS

          if (!sessionIsFresh) {
            setLobbyAccessError('password_required')
            setVerifyingAccess(false)
            return
          }
          // Fresh session -- fall through to grant access below.
        }

        if (accessStatus === 'whitelisted') {
          setVerifiedLobbyId(route.lobbyId)
          setCurrentLobbyId(route.lobbyId)
          localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, route.lobbyId)
          await (supabase.from('profiles') as any)
            .update({ active_lobby_id: route.lobbyId })
            .eq('id', user.id)
          setVerifyingAccess(false)
          return
        }

        // Public lobby, no password - allow access
        setVerifiedLobbyId(route.lobbyId)
        setCurrentLobbyId(route.lobbyId)
        localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, route.lobbyId)
        await (supabase.from('profiles') as any)
          .update({ active_lobby_id: route.lobbyId })
          .eq('id', user.id)
        setVerifyingAccess(false)
        
      } catch (err) {
        console.error('Error verifying lobby access:', err)
        setLobbyAccessError('Failed to verify access')
        setVerifyingAccess(false)
      }
    }
    
    verifyLobbyAccess()
  }, [route.page, route.lobbyId, isAuthenticated, verifiedLobbyId])

  // Check if user is already logged in
  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // Clean up old pre-auth user data
    const oldUserId = localStorage.getItem('userId')
    if (oldUserId && !oldUserId.startsWith('00000000-')) {
      // Remove old non-UUID user IDs from before auth was implemented
      localStorage.removeItem('userId')
      localStorage.removeItem('username')
    }

    supabase.auth.getSession().then(({ data: { session } }: any) => {
      if (session?.user && supabase) {
        // Get user profile
        (supabase
          .from('profiles') as any)
          .select('username, display_name, player_color, active_lobby_id, username_chosen')
          .eq('id', session.user.id)
          .maybeSingle()
          .then(async ({ data }: any) => {
            // Same recovery as onAuthStateChange: a session with no profile, or
            // one still on the trigger's auto-generated username, means no
            // username was ever chosen. Without this a reload would strand them
            // on the landing page again.
            if (!data || !hasChosenUsername(data)) {
              setPendingUsernameUser({ id: session.user.id, email: session.user.email ?? '' })
              // Must clear loading before returning: the `if (loading)` splash
              // is rendered ahead of the username screen, so bailing out here
              // without it left the app stuck on "Initializing" forever.
              setLoading(false)
              return
            }
            if (data) {
              setUserId(session.user.id)
              setUsername(data.display_name || data.username)
              setPlayerColor(data.player_color || '#ffffff')
              setIsAuthenticated(true)
              
              // Verify persisted lobby still exists and user has access
              const storedLobbyId = localStorage.getItem(STORAGE_KEYS.CURRENT_LOBBY)
              // Also check URL for lobby ID
              const urlRoute = parseRoute()
              const lobbyIdToRestore = urlRoute.page === 'atrium' && urlRoute.lobbyId ? urlRoute.lobbyId : storedLobbyId
              
              if (lobbyIdToRestore && supabase) {
                const { data: lobbyExists } = await (supabase as any)
                  .from('lobbies')
                  .select('id')
                  .eq('id', lobbyIdToRestore)
                  .single()
                
                if (!lobbyExists) {
                  // Lobby was deleted, clear persisted state and go to browse
                  localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
                  setCurrentLobbyId(null)
                  navigate('/browse')
                } else {
                  // Lobby exists - restore active_lobby_id and set current lobby
                  setCurrentLobbyId(lobbyIdToRestore)
                  setVerifiedLobbyId(lobbyIdToRestore)
                  localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, lobbyIdToRestore)
                  navigate(`/atrium/${lobbyIdToRestore}`)
                  await (supabase
                    .from('profiles') as any)
                    .update({ active_lobby_id: lobbyIdToRestore })
                    .eq('id', session.user.id)
                }
              } else if (urlRoute.page === 'browse') {
                // User is at browse page, stay there
              } else if (!storedLobbyId) {
                // No lobby stored, go to welcome
                navigate('/welcome')
              }
            }
            setLoading(false)
          })
          .catch(() => {
            setLoading(false)
          })
      } else {
        // Not authenticated - clear persisted navigation state
        localStorage.removeItem(STORAGE_KEYS.HAS_ENTERED)
        localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
        setCurrentLobbyId(null)
        navigate('/')
        setLoading(false)
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      if (session?.user && supabase) {
        // Retried rather than read once: profiles are created by the
        // on_auth_user_created trigger, and on a first-ever OAuth sign-in the
        // session can arrive before that row is readable here. maybeSingle() so
        // "not found" is an empty result to retry, not an error to swallow.
        //
        // If it's still missing after the retries, the trigger genuinely failed
        // (it swallows its own errors, so nothing surfaces). Rather than leave
        // the user authenticated-but-stuck on the homepage -- which is exactly
        // what a first Google sign-in did -- hand them the username screen,
        // which creates the profile itself.
        const loadProfile = async (attempt = 0): Promise<void> => {
          const { data } = await (supabase!
            .from('profiles') as any)
            .select('username, display_name, player_color, username_chosen')
            .eq('id', session.user.id)
            .maybeSingle()

          if (!data) {
            if (attempt >= 3) {
              setPendingUsernameUser({ id: session.user.id, email: session.user.email ?? '' })
              // Same reason as the getSession path: the loading splash renders
              // ahead of the username screen, so it has to be cleared here too.
              setLoading(false)
              return
            }
            await new Promise(r => setTimeout(r, 300 * (attempt + 1)))
            return loadProfile(attempt + 1)
          }

          // A derived username means the person never actually chose one --
          // true for any OAuth sign-up, since providers supply a display name
          // but nothing usable as a username. Send them through the same screen.
          if (!hasChosenUsername(data)) {
            setPendingUsernameUser({ id: session.user.id, email: session.user.email ?? '' })
            setLoading(false)
            return
          }

          setUserId(session.user.id)
          setUsername(data.display_name || data.username)
          setPlayerColor(data.player_color || '#ffffff')
          setIsAuthenticated(true)
          // Navigate to welcome after login
          const currentRoute = parseRoute()
          if (currentRoute.page === 'landing' || currentRoute.page === 'login') {
            navigate('/welcome')
          }
        }
        loadProfile()
      } else {
        setIsAuthenticated(false)
        // Cleared too, or signing out mid-way through picking a username would
        // leave that screen up with no session behind it.
        setPendingUsernameUser(null)
        setCurrentLobbyId(null)
        // Clear persisted state on logout
        localStorage.removeItem(STORAGE_KEYS.HAS_ENTERED)
        localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
        navigate('/')
      }
    })

    return () => subscription.unsubscribe()
  }, [setUsername, setUserId])

  // Clear active_lobby_id when browser/tab is closed
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (supabase && currentLobbyId) {
        // In desktop mode, just clear via the local adapter directly
        if (isDesktop) {
          supabase.from('profiles').update({ active_lobby_id: null }).eq('id', LOCAL_USER_ID)
          return
        }
        // Get stored session synchronously from localStorage
        const storageKey = `sb-${import.meta.env.VITE_SUPABASE_URL?.replace('https://', '').split('.')[0]}-auth-token`
        const storedSession = localStorage.getItem(storageKey)
        if (storedSession) {
          try {
            const session = JSON.parse(storedSession)
            const accessToken = session?.access_token
            const userId = session?.user?.id
            
            if (accessToken && userId) {
              // Use fetch with keepalive to ensure request completes after page unload
              fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
                method: 'PATCH',
                headers: {
                  'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
                  'Authorization': `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ active_lobby_id: null }),
                keepalive: true
              })
            }
          } catch (e) {
            // Ignore parsing errors on unload
          }
        }
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [currentLobbyId])

  // Persist current lobby to localStorage
  useEffect(() => {
    if (currentLobbyId) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, currentLobbyId)
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
    }
  }, [currentLobbyId])

  const handleAuthSuccess = (userId: string, username: string) => {
    setUserId(userId)
    setUsername(username)
    setIsAuthenticated(true)
    navigate('/welcome')
  }

  const handleLandingGetStarted = () => {
    navigate('/login')
  }

  const handleEnter = () => {
    // If no active lobby, show lobby browser
    if (currentLobbyId) {
      navigate(`/atrium/${currentLobbyId}`)
    } else {
      navigate('/browse')
    }
  }

  const handleJoinLobby = async (lobbyId: string, password?: string) => {
    if (!supabase) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Verify access (check password, blacklist, whitelist)
      const { data: canJoin } = await (supabase as any).rpc('can_user_join_lobby', {
        p_lobby_id: lobbyId,
        p_user_id: user.id,
        p_password: password || null,
      })

      if (!canJoin) {
        alert('Access denied: Invalid password or you are not allowed to join this lobby')
        return
      }

      // Update user's active lobby
      await (supabase!
        .from('profiles') as any)
        .update({ active_lobby_id: lobbyId })
        .eq('id', user.id)

      setCurrentLobbyId(lobbyId)
      setVerifiedLobbyId(lobbyId) // Mark as verified since we just passed the access check
      navigate(`/atrium/${lobbyId}`)
    } catch (err) {
      console.error('Error joining lobby:', err)
      alert('Failed to join lobby')
    }
  }

  const handleLeaveLobby = async () => {
    // Clear active_lobby_id in database so player count updates correctly
    if (supabase) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await (supabase
          .from('profiles') as any)
          .update({ active_lobby_id: null })
          .eq('id', user.id)
      }
    }
    
    // Clear verified lobby
    setVerifiedLobbyId(null)
    
    // Clear all lobby-specific data from store to free memory
    clearLobbyData()
    setCurrentLobbyId(null)
    navigate('/browse')
  }

  const handleBackToLanding = () => {
    navigate('/')
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4">
        <div className="relative px-[5vw] sm:px-10 py-[3vw] sm:py-6">
          <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-white/40" />
          <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-white/40" />
          <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-white/40" />
          <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-white/40" />
          <p className="text-white text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase mb-4 text-center">Initializing</p>
          <div className="w-[40vw] sm:w-48 h-[3px] bg-white/10 overflow-hidden mx-auto">
            <div className="h-full bg-white/80 animate-nier-slide" />
          </div>
          <p className="text-gray-500 text-[clamp(7px,1.8vw,10px)] tracking-[0.2em] uppercase mt-3 text-center">◇ Please wait</p>
        </div>
      </div>
    )
  }

  // URL-based routing
  const currentPage = route.page
  
  // Checked before the !isAuthenticated branch below: these users DO have a
  // valid session, they just have no username yet, so falling through to the
  // landing page is what stranded them there in the first place.
  if (pendingUsernameUser) {
    return (
      <ChooseUsernameScreen
        userId={pendingUsernameUser.id}
        email={pendingUsernameUser.email}
        onComplete={(chosen) => {
          setUserId(pendingUsernameUser.id)
          setUsername(chosen)
          setIsAuthenticated(true)
          setPendingUsernameUser(null)
          navigate('/welcome')
        }}
      />
    )
  }

  // If not authenticated, only allow landing and login pages
  if (!isAuthenticated) {
    // In desktop mode, never show auth/landing (auto-auth handles it)
    if (isDesktop) {
      return (
        <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4">
          <div className="relative px-[5vw] sm:px-10 py-[3vw] sm:py-6">
            <p className="text-white text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase mb-4 text-center">Initializing</p>
            <div className="w-[40vw] sm:w-48 h-[3px] bg-white/10 overflow-hidden mx-auto">
              <div className="h-full bg-white/80 animate-nier-slide" />
            </div>
          </div>
        </div>
      )
    }
    if (currentPage === 'login') {
      return (
        <AuthScreen
          onAuthSuccess={handleAuthSuccess}
          onBackToLanding={handleBackToLanding}
          initialError={oauthError ?? undefined}
        />
      )
    }
    // Default to landing page for unauthenticated users
    return <LandingPage onGetStarted={handleLandingGetStarted} />
  }

  // Authenticated user routing
  // In desktop mode, skip login page — go straight to welcome/browse
  if (isDesktop && currentPage === 'login') {
    setTimeout(() => navigate('/welcome'), 0)
  }

  // Allow authenticated users to see landing page (for logout/info)
  if (currentPage === 'landing') {
    return <LandingPage onGetStarted={() => navigate('/welcome')} isAuthenticated={true} />
  }
  
  if (currentPage === 'login') {
    // Already authenticated, go to welcome
    setTimeout(() => navigate('/welcome'), 0)
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4">
        <div className="relative px-[5vw] sm:px-10 py-[3vw] sm:py-6">
          <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-white/40" />
          <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-white/40" />
          <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-white/40" />
          <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-white/40" />
          <p className="text-white text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase mb-4 text-center">Redirecting</p>
          <div className="w-[40vw] sm:w-48 h-[3px] bg-white/10 overflow-hidden mx-auto">
            <div className="h-full bg-white/80 animate-nier-slide" />
          </div>
          <p className="text-gray-500 text-[clamp(7px,1.8vw,10px)] tracking-[0.2em] uppercase mt-3 text-center">◇ Please wait</p>
        </div>
      </div>
    )
  }
  
  if (currentPage === 'welcome') {
    return <WelcomeScreen onEnter={handleEnter} onBackToLanding={handleBackToLanding} />
  }
  
  if (currentPage === 'browse') {
    return (
      <LobbyBrowser
        onJoinLobby={handleJoinLobby}
        onClose={() => navigate('/welcome')}
      />
    )
  }
  
  if (currentPage === 'atrium' && route.lobbyId) {
    // Show loading while verifying access
    if (verifyingAccess) {
      return (
        <AtriumTransitionOverlay
          title="Verifying Access"
          subtitle="◇ Calibrating threshold"
          frames={LOADING_ANIMATION_FRAMES}
          loop={true}
          progressClassName="h-full bg-white/80 animate-nier-slide"
        />
      )
    }
    
    // Show error if access denied
    if (lobbyAccessError) {
      const isPasswordError = lobbyAccessError === 'password_required'
      return (
        <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4 overflow-y-auto">
          <div className="flex flex-col items-center my-auto py-8">
            <div className="relative px-[5vw] sm:px-10 lg:px-14 py-[4vw] sm:py-8 lg:py-12 w-[90vw] sm:w-auto sm:min-w-[420px] lg:min-w-[520px] max-w-2xl">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-white/40" />
              <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-white/40" />
              <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-white/40" />
              <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-white/40" />

              {isPasswordError ? (
                <div className="flex flex-col items-center gap-[2vw] sm:gap-4 lg:gap-5">
                  <p className="text-pink-300 text-[clamp(10px,2.8vw,18px)] tracking-[0.2em] uppercase text-center">Tuturu~! ♪</p>
                  <p className="text-white text-[clamp(9px,2.5vw,16px)] tracking-wide text-center leading-relaxed">
                    Mayushii doesn't remember seeing your name on the list~! This atrium is password-protected, you know?
                  </p>
                  <p className="text-gray-400 text-[clamp(8px,2.2vw,14px)] tracking-wide text-center leading-relaxed italic">
                    If you try to sneak in again... Mayushii might have to do something she'd really rather not~ ✦
                  </p>
                  <img
                    src="/assets/images/mayuri_knives.gif"
                    alt="Mayushii says no~"
                    className="w-[55vw] sm:w-72 lg:w-96 max-w-lg rounded border border-white/10 mt-2"
                  />
                  <p className="text-gray-500 text-[clamp(7px,1.8vw,12px)] tracking-[0.2em] uppercase mt-1 text-center">◇ Please use the atrium browser to enter properly~</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <p className="text-red-400 text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase text-center">{lobbyAccessError}</p>
                </div>
              )}

              <button
                onClick={() => {
                  setLobbyAccessError(null)
                  navigate('/browse')
                }}
                className="w-full mt-5 bg-white/5 hover:bg-white/15 text-white px-[3vw] sm:px-6 py-2 lg:py-3 text-[clamp(8px,2.2vw,14px)] tracking-[0.2em] uppercase transition-all border border-white/20 hover:border-white/40"
              >
                Go to Atrium Browser
              </button>
            </div>
          </div>
        </div>
      )
    }
    
    // Only render lobby scene if access is verified
    if (verifiedLobbyId === route.lobbyId) {
      if (transitionLobbyId === route.lobbyId && atriumTransitionPhase === 'entering') {
        return (
          <AtriumTransitionOverlay
            title="Entering Atrium"
            subtitle="◇ Crossing into another realm"
            videoSrc={ENTERING_ANIMATION_VIDEO_SRC}
            onAnimationComplete={() => setAtriumTransitionPhase('flash')}
            progressClassName="h-full bg-white/80"
          />
        )
      }

      if (transitionLobbyId === route.lobbyId && atriumTransitionPhase === 'flash') {
        return <AtriumFlashOverlay onComplete={() => setAtriumTransitionPhase('finalizing')} />
      }

      if (transitionLobbyId === route.lobbyId && atriumTransitionPhase === 'finalizing') {
        return (
          <AtriumTransitionOverlay
            title="Entering Atrium"
            subtitle="◇ Finalizing atrium data"
            frames={LOADING_ANIMATION_FRAMES}
            loop={true}
            progressClassName="h-full bg-white/80 animate-nier-slide"
          />
        )
      }

      if (transitionLobbyId === route.lobbyId && atriumTransitionPhase !== 'ready') {
        return (
          <AtriumTransitionOverlay
            title="Entering Atrium"
            subtitle={enteringVideoReady ? '◇ Aligning the gate' : '◇ Preparing passage'}
            frames={LOADING_ANIMATION_FRAMES}
            loop={true}
            progressClassName="h-full bg-white/80 animate-nier-slide"
          />
        )
      }

      return <LobbyScene lobbyId={route.lobbyId} onLeaveLobby={handleLeaveLobby} />
    }
    
    // Still waiting for verification
    return (
      <AtriumTransitionOverlay
        title="Entering Atrium"
        subtitle="◇ Tuning spatial resonance"
        frames={LOADING_ANIMATION_FRAMES}
        loop={true}
        progressClassName="h-full bg-white/80 animate-nier-slide"
      />
    )
  }
  
  // Default - no valid route, go to welcome
  setTimeout(() => navigate('/welcome'), 0)
  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4">
      <div className="relative px-[5vw] sm:px-10 py-[3vw] sm:py-6">
        <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-white/40" />
        <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-white/40" />
        <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-white/40" />
        <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-white/40" />
        <p className="text-white text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase mb-4 text-center">Loading</p>
        <div className="w-[40vw] sm:w-48 h-[3px] bg-white/10 overflow-hidden mx-auto">
          <div className="h-full bg-white/80 animate-nier-slide" />
        </div>
        <p className="text-gray-500 text-[clamp(7px,1.8vw,10px)] tracking-[0.2em] uppercase mt-3 text-center">◇ Please wait</p>
      </div>
    </div>
  )
}

// Desktop only: intercept the native window close (title bar "X", Alt+F4,
// etc.) and prompt to save if there are unsaved trace changes, similar to
// native apps. Mounted once at the App root (not inside LobbyScene) so it's
// active regardless of which screen is showing -- previously this lived
// inside LobbyScene, so closing from the lobby browser/landing page (i.e.
// after leaving an atrium without saving) skipped the prompt entirely since
// no listener was registered outside an active atrium.
const CLOSE_PROMPT_SHOWN_EVENT = 'digital-atrium-close-prompt-shown'

function CloseSaveDialog() {
  const [showCloseSaveDialog, setShowCloseSaveDialog] = useState(false)
  const closeUnlistenRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!isDesktop) return
    let cancelled = false

    ;(async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const unlisten = await win.onCloseRequested((event) => {
          const pending = useGameStore.getState().hasPendingChanges()
          console.log('[CloseSaveDialog] close-requested received, hasPendingChanges =', pending)
          if (pending) {
            event.preventDefault()
            setShowCloseSaveDialog(true)
          }
        })
        if (cancelled) {
          unlisten()
        } else {
          closeUnlistenRef.current = unlisten
          console.log('[CloseSaveDialog] close-requested listener registered')
        }
      } catch (err) {
        console.error('[CloseSaveDialog] Failed to register close-requested listener:', err)
      }
    })()

    return () => {
      cancelled = true
      closeUnlistenRef.current?.()
      closeUnlistenRef.current = null
    }
  }, [])

  useEffect(() => {
    if (showCloseSaveDialog) {
      window.dispatchEvent(new CustomEvent(CLOSE_PROMPT_SHOWN_EVENT))
    }
  }, [showCloseSaveDialog])

  if (!showCloseSaveDialog) return null

  return (
    <div className="fixed inset-0 z-[10003] bg-black/70 flex items-center justify-center pointer-events-auto">
      <div className="bg-gray-900 border border-gray-500 p-6 relative" style={{ maxWidth: '260px' }}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-gray-500 pointer-events-none" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-gray-500 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-gray-500 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-gray-500 pointer-events-none" />

        <h3 className="text-white font-mono text-sm tracking-[0.15em] uppercase mb-4 text-center">
          <span className="text-gray-400 mr-2">◇</span>Unsaved Changes
        </h3>
        <p className="text-gray-400 text-xs font-mono tracking-wider text-center mb-6">
          You have unsaved changes. Save before closing?
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={async () => {
              try {
                await saveAllChanges()
              } catch {
                // Fall through and close even if save fails, matching the
                // "Save and Leave" button's behavior elsewhere in the app
              }
              closeUnlistenRef.current?.()
              closeUnlistenRef.current = null
              const { getCurrentWindow } = await import('@tauri-apps/api/window')
              getCurrentWindow().close()
            }}
            className="w-full bg-white hover:bg-gray-200 text-black font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all"
          >
            ◇ Save and Close
          </button>
          <button
            onClick={async () => {
              closeUnlistenRef.current?.()
              closeUnlistenRef.current = null
              const { getCurrentWindow } = await import('@tauri-apps/api/window')
              getCurrentWindow().close()
            }}
            className="w-full bg-red-900 hover:bg-red-700 text-white font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-red-600"
          >
            Don't Save
          </button>
          <button
            onClick={() => setShowCloseSaveDialog(false)}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-mono text-[10px] tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  return (
    <>
      <AppInner />
      <CloseSaveDialog />
      {/* Mounted at the root so the update prompt survives navigation between
          the landing page, browser and an atrium. No-ops on web. */}
      <UpdateChecker />
      {/* Same reasoning: one mount, visible on every desktop screen. */}
      <AppVersionBadge />
    </>
  )
}

export default App
