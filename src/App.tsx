import { useState, useEffect, useRef } from 'react'
import LobbyScene from './components/LobbyScene'
import WelcomeScreen from './components/WelcomeScreen'
import AuthScreen from './components/AuthScreen'
import LandingPage from './components/LandingPage'
import { LobbyBrowser } from './components/LobbyBrowser'
import { useGameStore } from './store/gameStore'
import { supabase, isDesktop } from './lib/supabase'
import { useTraces } from './hooks/useTraces'
import { saveAllChanges } from './lib/traceSave'

type AtriumTransitionPhase = 'loading' | 'entering' | 'flash' | 'finalizing' | 'ready'

const ANIMATION_FPS = 40

const LOADING_ANIMATION_FRAMES = Object.entries(
  import.meta.glob('/loading_animation/*.jpg', { eager: true, import: 'default' }) as Record<string, string>
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)

const ENTERING_ANIMATION_FRAMES = Object.entries(
  import.meta.glob('/entering_animation/*.jpg', { eager: true, import: 'default' }) as Record<string, string>
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url)

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
  useEffect(() => {
    if (frames.length === 0) return

    let cancelled = false

    frames.forEach((src, idx) => {
      const img = new Image()
      img.decoding = 'async'

      const markDecoded = () => {
        if (cancelled) return
        if (decodedFramesRef.current[idx]) return
        decodedFramesRef.current[idx] = true
        decodedCountRef.current += 1
      }

      img.onload = () => {
        // decode() improves chances of smooth handoff between frames.
        img.decode().catch(() => {}).finally(markDecoded)
      }
      img.onerror = markDecoded
      img.src = src
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
  loop,
  nearCompleteLeadFrames,
  onNearComplete,
  onAnimationComplete,
  progressClassName,
}: {
  title: string
  subtitle: string
  frames: string[]
  loop: boolean
  nearCompleteLeadFrames?: number
  onNearComplete?: () => void
  onAnimationComplete?: () => void
  progressClassName: string
}) {
  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4 overflow-hidden">
      <div className="w-full max-w-[1600px] flex flex-col items-center justify-center">
        <p className="text-white text-[clamp(9px,2vw,15px)] tracking-[0.25em] uppercase mb-3 text-center">{title}</p>

        <ImageSequencePlayer
          frames={frames}
          loop={loop}
          nearCompleteLeadFrames={nearCompleteLeadFrames}
          onNearComplete={onNearComplete}
          onComplete={onAnimationComplete}
          alt={title}
          className="w-[90vw] h-[58vh] sm:h-[62vh] max-h-[760px]"
        />

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
  const [enteringFramesReady, setEnteringFramesReady] = useState(ENTERING_ANIMATION_FRAMES.length === 0)

  // Preload entering frames so they are ready as soon as loading completes.
  useEffect(() => {
    if (ENTERING_ANIMATION_FRAMES.length === 0) {
      setEnteringFramesReady(true)
      return
    }

    let cancelled = false
    let loadedCount = 0

    ENTERING_ANIMATION_FRAMES.forEach((src) => {
      const img = new Image()
      const markLoaded = () => {
        loadedCount += 1
        if (!cancelled && loadedCount >= ENTERING_ANIMATION_FRAMES.length) {
          setEnteringFramesReady(true)
        }
      }

      img.onload = markLoaded
      img.onerror = markLoaded
      img.src = src
    })

    return () => {
      cancelled = true
    }
  }, [])

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

  // Once access is verified, transition from loading loop to entering sequence.
  useEffect(() => {
    if (route.page !== 'atrium' || !route.lobbyId) return
    if (verifiedLobbyId !== route.lobbyId) return
    if (transitionLobbyId !== route.lobbyId) return
    if (atriumTransitionPhase !== 'loading') return
    if (!enteringFramesReady) return

    setAtriumTransitionPhase('entering')
  }, [
    route.page,
    route.lobbyId,
    verifiedLobbyId,
    transitionLobbyId,
    atriumTransitionPhase,
    enteringFramesReady,
  ])

  // Start loading traces (and, on desktop, pre-resolving local media) as soon
  // as access to the atrium is verified, so this overlaps with the
  // entering/flash animation instead of only starting once LobbyScene mounts
  // at the very end of the transition — that's what made traces (especially
  // local images) visibly pop in after the loading screen finished.
  const preloadLobbyId = (route.page === 'atrium' && route.lobbyId && verifiedLobbyId === route.lobbyId)
    ? route.lobbyId
    : null
  const { isLoading: tracesLoading } = useTraces(preloadLobbyId)

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
        
        // Check if lobby has a password. This applies even to whitelisted
        // users -- a lobby can require both whitelist membership AND a
        // password (see can_user_join_lobby), so whitelisting alone must not
        // bypass it. Route through the lobby browser's password prompt,
        // which records a verified session that RLS can check afterwards.
        const { data: hasPassword } = await (supabase as any).rpc('lobby_has_password', {
          p_lobby_id: route.lobbyId,
        })

        if (hasPassword) {
          setLobbyAccessError('password_required')
          setVerifyingAccess(false)
          return
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
          .select('username, display_name, player_color, active_lobby_id')
          .eq('id', session.user.id)
          .single()
          .then(async ({ data }: any) => {
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
        (supabase
          .from('profiles') as any)
          .select('username, display_name, player_color')
          .eq('id', session.user.id)
          .single()
          .then(({ data }: any) => {
            if (data) {
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
          })
      } else {
        setIsAuthenticated(false)
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
      return <AuthScreen onAuthSuccess={handleAuthSuccess} onBackToLanding={handleBackToLanding} />
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
            frames={ENTERING_ANIMATION_FRAMES}
            loop={false}
            onNearComplete={() => setAtriumTransitionPhase('flash')}
            nearCompleteLeadFrames={1}
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
            subtitle={enteringFramesReady ? '◇ Aligning the gate' : '◇ Preparing passage'}
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
    </>
  )
}

export default App
