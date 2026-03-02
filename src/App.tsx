import { useState, useEffect } from 'react'
import LobbyScene from './components/LobbyScene'
import WelcomeScreen from './components/WelcomeScreen'
import AuthScreen from './components/AuthScreen'
import LandingPage from './components/LandingPage'
import { LobbyBrowser } from './components/LobbyBrowser'
import { useGameStore } from './store/gameStore'
import { supabase } from './lib/supabase'

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

function App() {
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

  // Verify lobby access when trying to access via URL
  useEffect(() => {
    const verifyLobbyAccess = async () => {
      if (!supabase || !isAuthenticated) return
      if (route.page !== 'atrium' || !route.lobbyId) return
      
      // If already verified for this lobby, skip
      if (verifiedLobbyId === route.lobbyId) return
      
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
        
        // Check if user is whitelisted (can bypass password)
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
        
        // Check if lobby has a password
        const { data: hasPassword } = await (supabase as any).rpc('lobby_has_password', {
          p_lobby_id: route.lobbyId,
        })
        
        if (hasPassword) {
          // Has password and user is not whitelisted - need to go through lobby browser
          setLobbyAccessError('password_required')
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

    supabase.auth.getSession().then(({ data: { session } }) => {
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
          })
      } else {
        // Not authenticated - clear persisted navigation state
        localStorage.removeItem(STORAGE_KEYS.HAS_ENTERED)
        localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
        setCurrentLobbyId(null)
        navigate('/')
      }
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
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
    if (currentPage === 'login') {
      return <AuthScreen onAuthSuccess={handleAuthSuccess} onBackToLanding={handleBackToLanding} />
    }
    // Default to landing page for unauthenticated users
    return <LandingPage onGetStarted={handleLandingGetStarted} />
  }

  // Authenticated user routing
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
        <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4">
          <div className="flex flex-col items-center gap-6">
            {/* Decorative brackets */}
            <div className="relative px-[5vw] sm:px-10 py-[3vw] sm:py-6">
              <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-white/40" />
              <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-white/40" />
              <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-white/40" />
              <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-white/40" />

              <p className="text-white text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase mb-4 text-center">
                Verifying Access
              </p>

              {/* Loading bar */}
              <div className="w-[40vw] sm:w-48 h-[3px] bg-white/10 overflow-hidden mx-auto">
                <div className="h-full bg-white/80 animate-nier-slide" />
              </div>

              <p className="text-gray-500 text-[clamp(7px,1.8vw,10px)] tracking-[0.2em] uppercase mt-3 text-center">
                ◇ Please wait
              </p>
            </div>
          </div>
        </div>
      )
    }
    
    // Show error if access denied
    if (lobbyAccessError) {
      const isPasswordError = lobbyAccessError === 'password_required'
      return (
        <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4 overflow-y-auto">
          <div className="flex flex-col items-center my-auto py-8">
            <div className="relative px-[5vw] sm:px-10 py-[4vw] sm:py-8 w-[90vw] sm:w-auto max-w-md">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-white/40" />
              <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-white/40" />
              <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-white/40" />
              <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-white/40" />

              {isPasswordError ? (
                <div className="flex flex-col items-center gap-[2vw] sm:gap-4">
                  <p className="text-pink-300 text-[clamp(10px,2.8vw,14px)] tracking-[0.2em] uppercase text-center">Tuturu~! ♪</p>
                  <p className="text-white text-[clamp(9px,2.5vw,13px)] tracking-wide text-center leading-relaxed">
                    Mayushii doesn't remember seeing your name on the list~! This atrium is password-protected, you know?
                  </p>
                  <p className="text-gray-400 text-[clamp(8px,2.2vw,12px)] tracking-wide text-center leading-relaxed italic">
                    If you try to sneak in again... Mayushii might have to do something she'd really rather not~ ✦
                  </p>
                  <img
                    src="/assets/images/mayuri_knives.gif"
                    alt="Mayushii says no~"
                    className="w-[55vw] sm:w-64 max-w-xs rounded border border-white/10 mt-2"
                  />
                  <p className="text-gray-500 text-[clamp(7px,1.8vw,10px)] tracking-[0.2em] uppercase mt-1 text-center">◇ Please use the atrium browser to enter properly~</p>
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
                className="w-full mt-5 bg-white/5 hover:bg-white/15 text-white px-[3vw] sm:px-6 py-2 text-[clamp(8px,2.2vw,12px)] tracking-[0.2em] uppercase transition-all border border-white/20 hover:border-white/40"
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
      return <LobbyScene lobbyId={route.lobbyId} onLeaveLobby={handleLeaveLobby} />
    }
    
    // Still waiting for verification
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center font-mono px-4">
        <div className="relative px-[5vw] sm:px-10 py-[3vw] sm:py-6">
          <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-white/40" />
          <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-white/40" />
          <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-white/40" />
          <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-white/40" />
          <p className="text-white text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase mb-4 text-center">Entering Atrium</p>
          <div className="w-[40vw] sm:w-48 h-[3px] bg-white/10 overflow-hidden mx-auto">
            <div className="h-full bg-white/80 animate-nier-slide" />
          </div>
          <p className="text-gray-500 text-[clamp(7px,1.8vw,10px)] tracking-[0.2em] uppercase mt-3 text-center">◇ Please wait</p>
        </div>
      </div>
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

export default App
