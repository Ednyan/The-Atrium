import { useState, useEffect, useRef, useCallback } from 'react'
import LobbyScene from './components/LobbyScene'
import WelcomeScreen from './components/WelcomeScreen'
import AuthScreen from './components/AuthScreen'
import ChooseUsernameScreen from './components/ChooseUsernameScreen'
import UpdateChecker from './components/UpdateChecker'
import AppVersionBadge from './components/AppVersionBadge'
import { useTranslation } from './lib/i18n'
import DesktopIntro from './components/DesktopIntro'
import ContributorsAtrium from './components/ContributorsAtrium'
import ContributePanel from './components/ContributePanel'
import { contributorsReturnPath, rememberContributorsReturn } from './lib/contributorsRoute'
import LandingPage from './components/LandingPage'
import { LobbyBrowser } from './components/LobbyBrowser'
import { useGameStore } from './store/gameStore'
import { supabase, isDesktop } from './lib/supabase'
import { useTraces } from './hooks/useTraces'
import { saveAllChanges } from './lib/traceSave'
import { handlePinterestCallback } from './lib/pinterest'
import { isGhostEntry } from './lib/operatorGhost'
import { noteAppStarted, recordAppealResponse } from './lib/supportAppeal'
import { useLandingTheme } from './lib/useLandingTheme'
import {
  hasCompletedContribution,
  takeCompletedContribution,
  watchPendingContribution,
} from './lib/pendingContribution'

noteAppStarted()

type AtriumTransitionPhase = 'loading' | 'entering' | 'flash' | 'ready'

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
  // Which room this crossing happens in.
  const light = useLandingTheme().resolved === 'light'
  const nearCompleteFiredRef = useRef(false)
  // Worked out once when the zoom begins and kept for the rest of it, so the
  // scale cannot jump if the window is resized mid-animation.
  const zoomTargetRef = useRef<number | null>(null)
  useEffect(() => {
    nearCompleteFiredRef.current = false
    zoomTargetRef.current = null
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

  // Growing the end of the entering animation until it covers the screen.
  //
  // The clip is letterboxed inside a 90vw x 62vh box, so its edges sit inside
  // the page. Its own footage ends by filling the frame with white -- but
  // "the frame" is that box, not the window, so the moment it whites out you
  // can see exactly where it stops. Scaling it past the window puts that seam
  // off-screen: the edge you cannot see is the one that is no longer there.
  //
  // Written as "finished this long before the end" rather than "starts at
  // frame N", because when it finishes is the thing that matters and the
  // start is whatever that implies. The first attempt did the opposite --
  // it began at source frame 195, which on a 2.2s clip is 1.85s, leaving
  // 0.35s to grow in. That was too late twice over: the white crossfade
  // already begins 0.6s before the end, so the zoom was running underneath
  // it, and it reached full size only on the final frame if at all.
  //
  // At 2.2s this works out as full size by 1.2s, growing from 0.6s -- source
  // frames 145 to 169, for anyone counting on that timeline.
  const ZOOM_DONE_BEFORE_END_SEC = 1.0
  const ZOOM_RAMP_SEC = 0.6

  const enteringVideoRef = useRef<HTMLVideoElement | null>(null)

  // How much bigger the video has to get before it covers the window.
  //
  // Measured rather than assumed: object-contain means the picture inside the
  // element is only as big as its aspect ratio allows, which is not the
  // element's own box, and the box itself is a vw/vh expression that changes
  // with the window. Both are read at the moment the zoom starts.
  // Driven by requestAnimationFrame rather than the video's timeupdate event.
  //
  // timeupdate is throttled -- as little as four times a second in some
  // browsers -- so a zoom lasting well under a second got one or two ticks and
  // visibly failed to arrive anywhere. rAF runs every frame and still reads
  // video.currentTime, so the growth stays tied to the footage rather than to
  // wall-clock time, and a stutter in playback stalls the zoom with it instead
  // of running ahead.
  const zoomRafRef = useRef<number | null>(null)
  const startZoomLoop = (video: HTMLVideoElement) => {
    if (zoomRafRef.current !== null) return

    const step = () => {
      if (!video.isConnected || !video.duration) {
        zoomRafRef.current = null
        return
      }

      const doneAt = Math.max(0, video.duration - ZOOM_DONE_BEFORE_END_SEC)
      const beginAt = Math.max(0, doneAt - ZOOM_RAMP_SEC)

      if (video.currentTime >= beginAt) {
        if (!zoomTargetRef.current) zoomTargetRef.current = coverScaleFor(video)
        const span = Math.max(0.001, doneAt - beginAt)
        const t = Math.min(1, (video.currentTime - beginAt) / span)
        const eased = t * t * (3 - 2 * t)
        video.style.transform = `scale(${1 + (zoomTargetRef.current - 1) * eased})`
        // Large enough now to reach the title and subtitle above it, so they
        // go under rather than through.
        video.style.zIndex = '2'
      }

      zoomRafRef.current = video.ended ? null : requestAnimationFrame(step)
    }

    zoomRafRef.current = requestAnimationFrame(step)
  }

  useEffect(() => () => {
    if (zoomRafRef.current !== null) cancelAnimationFrame(zoomRafRef.current)
  }, [])

  const coverScaleFor = (video: HTMLVideoElement): number => {
    const rect = video.getBoundingClientRect()
    if (!rect.width || !rect.height || !video.videoWidth || !video.videoHeight) return 1
    const aspect = video.videoWidth / video.videoHeight

    let contentW = rect.width
    let contentH = rect.width / aspect
    if (contentH > rect.height) {
      contentH = rect.height
      contentW = rect.height * aspect
    }

    // A little past covering, so a rounding error cannot leave a hairline of
    // page showing along one edge at the exact moment everything is white.
    return Math.max(window.innerWidth / contentW, window.innerHeight / contentH) * 1.04
  }
  useEffect(() => {
    setFlashActive(false)
  }, [videoSrc])

  return (
    <div
      className="screen-rise fixed inset-0 flex items-center justify-center font-mono px-4 overflow-hidden"
      // Paper, like every other light surface. Inverting the animation gives
      // it a pure white ground, which would sit on that paper as a visible
      // rectangle -- so the frames are multiplied over it instead: white
      // multiplied by paper is paper, and the black line-art stays black.
      style={{ background: light ? 'rgb(var(--c-ground))' : '#000000' }}
    >
      <div className="w-full max-w-[1600px] flex flex-col items-center justify-center">
        <p className="text-nier-strong text-[clamp(11px,2vw,17px)] tracking-[0.25em] uppercase mb-3 text-center">{title}</p>

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
            style={light ? { filter: 'invert(1)', mixBlendMode: 'multiply' } : undefined}
              ref={enteringVideoRef}
              onPlay={(e) => startZoomLoop(e.currentTarget)}
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
            className={`w-[90vw] h-[58vh] sm:h-[62vh] max-h-[760px] ${light ? 'invert mix-blend-multiply' : ''}`}
          />
        )}

        <div className="w-[60vw] sm:w-[420px] h-[3px] bg-nier-bg/15 overflow-hidden mx-auto mt-3">
          <div className={progressClassName} />
        </div>

        <p className="text-nier-bg/70 text-[clamp(11px,1.6vw,13px)] tracking-[0.2em] uppercase mt-3 text-center">{subtitle}</p>
      </div>
    </div>
  )
}

// The white the entering cinematic ends on, held.
//
// It used to fade itself out on a fixed 850ms timer, which meant the white
// cleared on a schedule that had nothing to do with whether the atrium was
// ready behind it -- on a slow machine it revealed the video's last frame, or a
// black loading screen, before the canvas existed. Holding instead means the
// screen is fully white at the moment the atrium page takes over, whatever that
// moment turns out to be.
//
// The white itself never fades. The fade lives on the other side of the
// handover, in AtriumRevealOverlay, so both sides of the seam are solid white
// and the join can't be seen no matter how long the wait was.
//
// Only the indicator moves, and only when the wait is long enough to need one.
// A short hold shows nothing at all -- an indicator that appears and vanishes
// inside half a second is worse than a blank moment. Past the delay, six
// seconds of featureless white reads as a frozen app, so it says otherwise.
const HOLD_INDICATOR_DELAY_MS = 1200
const HOLD_INDICATOR_FADE_MS = 500

function AtriumWhiteHold({ finishing, onFinished }: { finishing: boolean; onFinished: () => void }) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const timeout = setTimeout(() => setShown(true), HOLD_INDICATOR_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [])

  // The hold ends by unmounting, so an indicator still on screen would be cut
  // rather than faded. Readiness therefore doesn't hand over directly: it fades
  // the indicator first and hands over once it's gone. When nothing is showing
  // -- the common case, where loading beat the delay -- there's nothing to fade
  // and the handover is immediate, so this costs nothing in the fast path.
  useEffect(() => {
    if (!finishing) return
    if (!shown) {
      onFinished()
      return
    }
    const timeout = setTimeout(onFinished, HOLD_INDICATOR_FADE_MS)
    return () => clearTimeout(timeout)
  }, [finishing, shown, onFinished])

  return (
    <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
      <div
        className="flex items-center gap-3"
        style={{
          opacity: shown && !finishing ? 1 : 0,
          transition: `opacity ${HOLD_INDICATOR_FADE_MS}ms ease-in-out`,
        }}
      >
        {/* Quiet, but not so quiet it can't be read: the word measures 5.45:1
            against the white, where 4.5 is the readable minimum for text this
            small. The mark carries the pulse and is softer, since it says the
            same thing without having to be read. */}
        <div className="w-1.5 h-1.5 rotate-45 border border-nier-black/55 animate-nier-pulse" />
        <span className="text-nier-black/65 text-[9px] tracking-[0.3em] uppercase">Entering</span>
      </div>
    </div>
  )
}

// The second half: the atrium page starts under solid white and clears to it.
//
// LobbyScene is mounted underneath from the first frame, so the canvas gets set
// up, the traces draw and the camera settles while the white is still covering
// everything -- what's revealed is a finished atrium rather than one assembling
// itself.
const ATRIUM_REVEAL_MS = 800

function AtriumRevealOverlay() {
  const [fading, setFading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Two frames, not one: the first paints the white, the second starts the
    // transition. Beginning the fade in the same frame the element mounts can
    // be collapsed into a single style computation, which skips the animation
    // and flicks the white away instantly -- the exact thing this exists to
    // prevent.
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setFading(true))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [])

  // Unmounted once clear, rather than left at opacity 0 -- a full-screen
  // element over the canvas is worth removing even when it can't be seen.
  if (done) return null

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none"
      style={{
        background: '#ffffff',
        opacity: fading ? 0 : 1,
        transition: `opacity ${ATRIUM_REVEAL_MS}ms ease-out`,
      }}
      onTransitionEnd={() => setDone(true)}
    />
  )
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
    // Where Stripe returns a contributor after checkout. A real route rather
    // than a query flag, so arriving here can't be confused with a normal
    // visit, and so a reload shows the same page instead of a stale banner.
    case '/contributed':
      return { page: 'contributed' }
    // A page rather than a panel: it is a space to move through, and a modal
    // over the welcome screen would have been the wrong shape for that.
    case '/contributors':
      return { page: 'contributors' }
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
  const { t } = useTranslation()
  const { setUsername, setUserId, setPlayerColor, clearLobbyData } = useGameStore()

  // Light or dark, published once at the root so every screen inherits it.
  //
  // The colour tokens are already variables, so this is the whole of it: the
  // attribute selects a set and everything built from nier-bg, nier-black and
  // nier-border follows. The atrium itself opts back out, because its chrome
  // sits over a background each atrium sets for itself.
  const appTheme = useLandingTheme()
  useEffect(() => {
    document.documentElement.dataset.landingTheme = appTheme.resolved
  }, [appTheme.resolved])

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
  // Set when the atrium's data has arrived (or the wait was capped). Separate
  // from the phase because the white hold owns when it actually hands over.
  const [atriumDataReady, setAtriumDataReady] = useState(false)
  // The contribute form, opened from the contributors page's own button.
  const [showContributeFromContributors, setShowContributeFromContributors] = useState(false)

  // A donation that finished somewhere the app could not see.
  //
  // Checkout runs in the system browser -- it must on desktop, and it opens in
  // a second tab on web -- so Stripe's thank-you page lands over there and this
  // window is left none the wiser. The watcher asks Stripe directly instead,
  // and this is where the answer arrives.
  const [contributionConfirmed, setContributionConfirmed] = useState(hasCompletedContribution)
  // The name they chose, held from the moment the donation is claimed until
  // the wall has said thank you with it.
  const [thanksName, setThanksName] = useState('')
  useEffect(() => watchPendingContribution(() => setContributionConfirmed(true)), [])

  // Confirmed is not the same as ready to show. Trace edits are deferred until
  // a save, so navigating out of an open atrium would throw away work someone
  // has queued -- to say thank you, of all things. The confirmation keeps until
  // they are somewhere it costs nothing, which is usually within seconds.
  useEffect(() => {
    if (!contributionConfirmed) return
    if (route.page === 'atrium') return

    setContributionConfirmed(false)
    // Claimed here, and only here: taking it clears the record, so the thanks
    // is shown exactly once no matter how many times this runs.
    const claimed = takeCompletedContribution()
    if (!claimed) return
    setThanksName(claimed.displayName)

    // Confirmed money, so the appeal goes quiet for three months whichever
    // button this started from. It was only recorded for people who donated
    // from the appeal itself before, which meant giving from the browser or
    // the wall left the app still asking.
    recordAppealResponse('donated')

    // Already on it. This is the web tab Stripe redirected itself -- the thanks
    // is on screen, and the only thing left to do is clear the record so that
    // leaving the wall doesn't bounce them straight back onto it.
    if (route.page === 'contributed') return

    // Back from the wall should return where they were when they donated --
    // unless that was the wall. Donating from the contributors page itself is
    // the ordinary case, and recording it as the way back made Back a button
    // that returned you to the page you were already looking at, minus the
    // thanks. Leaving the stored value alone sends them where they came from
    // before they opened the wall at all.
    const origin = window.location.hash.replace(/^#/, '')
    if (origin !== '/contributors' && origin !== '/contributed') {
      rememberContributorsReturn(origin || '/welcome')
    }
    navigate('/contributed')
  }, [contributionConfirmed, route.page])
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

  // The white hold waits here for the trace data (and pre-resolved local media)
  // rather than clearing on a timer -- that's the whole point of holding it.
  // Whatever this wait costs is spent behind solid white, so it reads as the
  // transition taking a moment rather than as the atrium popping in unfinished.
  //
  // A max wait keeps it from hanging forever if the fetch is slow or fails: six
  // seconds of white then hands over regardless, which shows an atrium still
  // filling in but is far better than a screen that never moves.
  //
  // This only marks the atrium ready; the hold decides when to hand over, so
  // that an indicator already on screen gets faded out rather than cut off.
  useEffect(() => {
    if (atriumTransitionPhase !== 'flash') {
      setAtriumDataReady(false)
      return
    }
    if (!tracesLoading) {
      setAtriumDataReady(true)
      return
    }
    const timeout = setTimeout(() => setAtriumDataReady(true), 6000)
    return () => clearTimeout(timeout)
  }, [atriumTransitionPhase, tracesLoading])

  // Stable across renders: the hold runs its fade on a timeout keyed to this,
  // and a new function identity every render would restart that timeout every
  // render and never let it finish.
  const handleHoldFinished = useCallback(() => setAtriumTransitionPhase('ready'), [])

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
        
        // Privileged entry: admitted on operator rights rather than
        // membership. Checked before everything below to mirror
        // can_user_join_lobby, which tests the operator first -- so the client
        // and the server agree on who gets in and under what terms.
        //
        // It matters most on refresh: the operator never enters a password, so
        // it never has a lobby_sessions row, and the password branch below
        // would bounce it out of an atrium the server would readmit it to.
        //
        // Note this is the *ghost* check, not merely "am I the operator". In a
        // plain public atrium the operator is an ordinary member, so it falls
        // through and is counted like anyone else.
        if (await isGhostEntry(route.lobbyId)) {
          setVerifiedLobbyId(route.lobbyId)
          setCurrentLobbyId(route.lobbyId)
          localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, route.lobbyId)
          // Deliberately does NOT write profiles.active_lobby_id. The atrium
          // browser derives its player counts from that column, so setting it
          // would put the operator in a private atrium's headcount -- visible
          // to exactly the people the presence suppression is hiding it from.
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

  // Tracks whether a session was already in hand, so "just signed in" can be
  // told apart from "already signed in". onAuthStateChange fires for plenty of
  // things that aren't a login -- INITIAL_SESSION on every page load, token
  // refreshes, and SIGNED_IN again when a tab regains focus -- and the
  // post-login redirect must only run on a genuine transition.
  const wasSignedInRef = useRef(false)

  // Desktop launches straight to the welcome screen, but only once -- so the
  // About link can still reach the landing page afterwards without being
  // bounced back.
  const hasSeenDesktopLandingRef = useRef(false)


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
          .then(async ({ data, error }: any) => {
            // A read that failed is not a profile that is missing.
            //
            // maybeSingle() answers with null data both when the row genuinely
            // is not there and when the request never got through -- an access
            // token that went stale while the tab sat open, RLS declining, the
            // network dropping. Treating those as the same thing is what put
            // established accounts in front of "choose a username", a screen
            // that tells them the choice is permanent, on nothing worse than a
            // long idle.
            //
            // So: say nothing on an error. onAuthStateChange fires for this
            // same session with its own retries, and gets another go once the
            // token has refreshed; the cost of waiting for it is a moment on
            // the landing page, against a screen that reads like the account
            // was lost.
            if (error) {
              setLoading(false)
              return
            }

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
              // This path and onAuthStateChange race on load; whichever lands
              // first must record that a session already existed, so the other
              // doesn't mistake it for a fresh login and redirect.
              wasSignedInRef.current = true

              // Verify persisted lobby still exists and user has access
              const storedLobbyId = localStorage.getItem(STORAGE_KEYS.CURRENT_LOBBY)
              // Also check URL for lobby ID
              const urlRoute = parseRoute()

              // Routes the user asked for explicitly, which auto-restore must
              // not override. "/" is a deliberate request for the landing page
              // -- a refresh while reading it, or Back to Landing from inside
              // the app -- and restoring over it made the page impossible to
              // stay on: with a stored atrium you were thrown into the atrium,
              // and without one you were sent to /welcome.
              //
              // /browse gets the same treatment. It already had a "stay here"
              // branch below, but that branch was unreachable whenever a
              // stored atrium existed, because the restore above ran first and
              // navigated away. Same bug, just harder to notice.
              // The contributors wall and the page Stripe returns to belong
              // here too. Without them, refreshing the wall threw you to the
              // welcome screen -- and coming back from checkout did the same,
              // which is why the thank-you never appeared: the app navigated
              // away from it before it could be seen.
              const explicitRoute = urlRoute.page === 'landing'
                || urlRoute.page === 'browse'
                || urlRoute.page === 'contributors'
                || urlRoute.page === 'contributed'

              // A lobby id in the URL still wins -- that IS a request to open
              // that atrium. Only the fallback to the *stored* lobby is
              // suppressed, since nothing about "/" implies resuming it.
              const lobbyIdToRestore = urlRoute.page === 'atrium' && urlRoute.lobbyId
                ? urlRoute.lobbyId
                : (explicitRoute ? null : storedLobbyId)

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
                  // Same reasoning as the join path: restoring this column for
                  // a privileged entry would put the operator back into the
                  // atrium's visible player count on every reload.
                  if (!(await isGhostEntry(lobbyIdToRestore))) {
                    await (supabase
                      .from('profiles') as any)
                      .update({ active_lobby_id: lobbyIdToRestore })
                      .eq('id', session.user.id)
                  }
                }
              } else if (explicitRoute) {
                // Already where the user asked to be.
                // The stored atrium is deliberately left in localStorage so
                // Continue to Atrium still resumes it on demand.
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
    } = supabase.auth.onAuthStateChange((event: any, session: any) => {
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
          const { data, error } = await (supabase!
            .from('profiles') as any)
            .select('username, display_name, player_color, username_chosen')
            .eq('id', session.user.id)
            .maybeSingle()

          if (!data) {
            if (attempt >= 3) {
              // Only an answered query that came back empty means the profile
              // is genuinely absent. An error means we could not find out --
              // and guessing wrong in that direction shows somebody who has
              // had an account for months a screen announcing they are about
              // to pick a permanent username. Better to leave them signed out
              // on the landing page, which the next refreshed token fixes by
              // itself, than to say something untrue about their account.
              if (!error) {
                setPendingUsernameUser({ id: session.user.id, email: session.user.email ?? '' })
              }
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

          // Only on a real login. This used to run for any authenticated
          // session, and since INITIAL_SESSION fires on every page load, it
          // bounced the landing page to /welcome the moment you refreshed it
          // while signed in -- which made the page impossible to sit on.
          //
          // Both guards are needed, and neither alone would do:
          //   - INITIAL_SESSION is what fires on a refresh, and it's the FIRST
          //     callback, so it looks exactly like a transition to the ref.
          //   - SIGNED_IN re-fires on a tab regaining focus, which the event
          //     name alone can't tell from a real login.
          const justSignedIn = !wasSignedInRef.current
          wasSignedInRef.current = true
          const currentRoute = parseRoute()
          // The landing page is somewhere people mean to be, so nothing
          // navigates away from it.
          //
          // The guards below still could: SIGNED_IN is not only a login, it
          // also arrives when a stale token refreshes, and if that is the
          // first event this listener sees then justSignedIn is true and the
          // event is not INITIAL_SESSION -- so somebody reading the front page
          // with a session that had been idle got thrown to /welcome
          // mid-scroll. Leaving only the login page as a departure point makes
          // that impossible rather than merely unlikely: signing in still ends
          // up at /welcome, because that is where signing in goes, and every
          // other way of getting to the atrium from the landing page is a
          // button the reader pressed on purpose.
          const isRealLogin = event !== 'INITIAL_SESSION' && justSignedIn
          if (isRealLogin && currentRoute.page === 'login') {
            navigate('/welcome')
          }
        }
        loadProfile()
      } else {
        setIsAuthenticated(false)
        // Reset so the next sign-in counts as a real transition and does
        // redirect to /welcome.
        wasSignedInRef.current = false
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

      // Update user's active lobby -- unless this is a privileged entry, in
      // which case leave it alone: the atrium browser counts players by
      // reading this column, so writing it would announce the operator in the
      // headcount of an atrium it is entering invisibly.
      if (!(await isGhostEntry(lobbyId))) {
        await (supabase!
          .from('profiles') as any)
          .update({ active_lobby_id: lobbyId })
          .eq('id', user.id)
      }

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
  // Both public, and checked before authentication rather than after.
  //
  // Donating deliberately needs no account, so Stripe returns people here who
  // may never have signed in -- and the unauthenticated branch below answers
  // every route with the landing page. That is why no thank-you appeared: you
  // paid, and the app showed you its front door.
  //
  // The contributors page is public for the same reason. It is a wall of names,
  // and asking someone to sign in to read who paid for a free app would be
  // absurd.
  //
  // Returning from checkout lands on that wall rather than on a page of its
  // own: the thanks belongs over the thing being joined, not beside it.
  if (currentPage === 'contributed' || currentPage === 'contributors') {
    return (
      <>
        <ContributorsAtrium
          thanks={currentPage === 'contributed'}
          thanksName={thanksName}
          onClose={() => navigate(contributorsReturnPath())}
          onContribute={() => setShowContributeFromContributors(true)}
        />
        {showContributeFromContributors && (
          <ContributePanel onClose={() => setShowContributeFromContributors(false)} />
        )}
      </>
    )
  }

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

  // On desktop the landing page is a marketing page for a product the user has
  // already installed, so launching into it means a wasted click every time.
  // The welcome screen is the app's actual title screen.
  //
  // Only redirects the initial landing route, not the section links -- the
  // desktop app still shows the page if it's navigated to deliberately (the
  // About entry, which is also how you get back out of an atrium).
  if (currentPage === 'landing' && isDesktop && !hasSeenDesktopLandingRef.current) {
    hasSeenDesktopLandingRef.current = true
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
          title={t('entering.verifying')}
          subtitle={`◇ ${t('entering.calibrating')}`}
          frames={LOADING_ANIMATION_FRAMES}
          loop={true}
          progressClassName="h-full bg-nier-bg/80 animate-nier-slide"
        />
      )
    }
    
    // Show error if access denied
    if (lobbyAccessError) {
      const isPasswordError = lobbyAccessError === 'password_required'
      return (
        // A locked door, said plainly.
        //
        // This used to be an anime character with a GIF, in her voice, telling
        // you off. It was third-party artwork shipped inside the app and it
        // read like a different product had been spliced into this one. What
        // someone standing at a locked door needs is what the lock is and
        // where the key goes.
        <div className="screen-rise fixed inset-0 bg-nier-black flex items-center justify-center font-mono px-4 overflow-y-auto">
          <div className="relative w-full max-w-md border border-nier-border/40 p-8" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.94)' }}>
            <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-nier-border/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-nier-border/60" />

            {isPasswordError ? (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-2 h-2 rotate-45 border border-nier-border/60" />
                  <h2 className="text-nier-strong text-lg tracking-[0.12em] uppercase leading-none">{t('locked.passwordNeeded')}</h2>
                </div>
                <p className="text-nier-bg/80 text-sm leading-relaxed mb-3">
                  {t('locked.passwordWhy')}
                </p>
                <p className="text-nier-bg/70 text-xs leading-relaxed">
                  {t('locked.passwordHow')}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-2 h-2 rotate-45 border" style={{ borderColor: 'rgb(var(--c-danger) / 0.6)' }} />
                  <h2 className="text-lg tracking-[0.12em] uppercase leading-none" style={{ color: 'rgb(var(--c-danger))' }}>
                    {t('locked.cannotOpen')}
                  </h2>
                </div>
                <p className="text-nier-bg/80 text-sm leading-relaxed">{lobbyAccessError}</p>
              </>
            )}

            <button
              onClick={() => {
                setLobbyAccessError(null)
                navigate('/browse')
              }}
              className="cut-corner w-full mt-7 inline-flex items-center justify-center h-[2.375rem] text-[11px] tracking-[0.18em] uppercase font-medium transition-transform hover:scale-[1.02] active:scale-[0.99]"
              style={{ background: 'rgb(var(--c-accent))', color: 'rgb(var(--c-ground))' }}
            >
              {isPasswordError ? `◇ ${t('locked.enterPassword')}` : `◇ ${t('locked.toBrowser')}`}
            </button>
          </div>
        </div>
      )
    }
    
    // Only render lobby scene if access is verified
    if (verifiedLobbyId === route.lobbyId) {
      if (transitionLobbyId === route.lobbyId && atriumTransitionPhase === 'entering') {
        return (
          <AtriumTransitionOverlay
            title={t('entering.title')}
            subtitle={`◇ ${t('entering.crossing')}`}
            videoSrc={ENTERING_ANIMATION_VIDEO_SRC}
            onAnimationComplete={() => setAtriumTransitionPhase('flash')}
            progressClassName="h-full bg-nier-bg/80"
          />
        )
      }

      if (transitionLobbyId === route.lobbyId && atriumTransitionPhase === 'flash') {
        return <AtriumWhiteHold finishing={atriumDataReady} onFinished={handleHoldFinished} />
      }

      if (transitionLobbyId === route.lobbyId && atriumTransitionPhase !== 'ready') {
        return (
          <AtriumTransitionOverlay
            title={t('entering.title')}
            subtitle={enteringVideoReady ? `◇ ${t('entering.aligning')}` : `◇ ${t('entering.preparing')}`}
            frames={LOADING_ANIMATION_FRAMES}
            loop={true}
            progressClassName="h-full bg-nier-bg/80 animate-nier-slide"
          />
        )
      }

      // The atrium page's own half of the transition: the scene mounts under
      // solid white, which then clears. Only after arriving through the
      // cinematic -- opening an atrium any other way has nothing to fade from.
      return (
        <>
          <LobbyScene lobbyId={route.lobbyId} onLeaveLobby={handleLeaveLobby} />
          {transitionLobbyId === route.lobbyId && <AtriumRevealOverlay />}
        </>
      )
    }
    
    // Still waiting for verification
    return (
      <AtriumTransitionOverlay
        title={t('entering.title')}
        subtitle={`◇ ${t('entering.tuning')}`}
        frames={LOADING_ANIMATION_FRAMES}
        loop={true}
        progressClassName="h-full bg-nier-bg/80 animate-nier-slide"
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
  // The launch intro lives out here rather than in AppInner: it belongs to the
  // application starting, not to any screen, and this is the component that
  // survives every route change. Initialised from isDesktop so the web never
  // mounts it -- a "launch" isn't a thing that happens in a browser tab.
  const [showDesktopIntro, setShowDesktopIntro] = useState(isDesktop)

  return (
    <>
      <AppInner />
      <CloseSaveDialog />
      {/* Mounted at the root so the update prompt survives navigation between
          the landing page, browser and an atrium. No-ops on web. */}
      <UpdateChecker />
      {/* Same reasoning: one mount, visible on every desktop screen. */}
      <AppVersionBadge />
      {/* Last child so it paints over everything, including the loading
          splash -- the intro is what the app opens with. */}
      {showDesktopIntro && <DesktopIntro onDone={() => setShowDesktopIntro(false)} />}
    </>
  )
}

export default App
