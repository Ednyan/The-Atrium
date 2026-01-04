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

function App() {
  const { username, setUsername, setUserId, setPlayerColor, clearLobbyData } = useGameStore()
  const [showLanding, setShowLanding] = useState(() => {
    // Show landing if user hasn't dismissed it before
    const stored = localStorage.getItem(STORAGE_KEYS.SHOW_LANDING)
    return stored === null ? true : stored === 'true'
  })
  const [hasEntered, setHasEntered] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.HAS_ENTERED) === 'true'
  })
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [currentLobbyId, setCurrentLobbyId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_LOBBY)
  })
  const [showLobbyBrowser, setShowLobbyBrowser] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SHOW_BROWSER) === 'true'
  })

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
              if (storedLobbyId && supabase) {
                const { data: lobbyExists } = await (supabase as any)
                  .from('lobbies')
                  .select('id')
                  .eq('id', storedLobbyId)
                  .single()
                
                if (!lobbyExists) {
                  // Lobby was deleted, clear persisted state
                  localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
                  setCurrentLobbyId(null)
                  setShowLobbyBrowser(true)
                  localStorage.setItem(STORAGE_KEYS.SHOW_BROWSER, 'true')
                }
              }
            }
          })
      } else {
        // Not authenticated - clear persisted navigation state
        localStorage.removeItem(STORAGE_KEYS.HAS_ENTERED)
        localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
        localStorage.removeItem(STORAGE_KEYS.SHOW_BROWSER)
        setHasEntered(false)
        setCurrentLobbyId(null)
        setShowLobbyBrowser(false)
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
            }
          })
      } else {
        setIsAuthenticated(false)
        setHasEntered(false)
        setCurrentLobbyId(null)
        setShowLobbyBrowser(false)
        // Clear persisted state on logout
        localStorage.removeItem(STORAGE_KEYS.HAS_ENTERED)
        localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
        localStorage.removeItem(STORAGE_KEYS.SHOW_BROWSER)
      }
    })

    return () => subscription.unsubscribe()
  }, [setUsername, setUserId])

  // Persist navigation state changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.HAS_ENTERED, String(hasEntered))
  }, [hasEntered])

  useEffect(() => {
    if (currentLobbyId) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_LOBBY, currentLobbyId)
    } else {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_LOBBY)
    }
  }, [currentLobbyId])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SHOW_BROWSER, String(showLobbyBrowser))
  }, [showLobbyBrowser])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SHOW_LANDING, String(showLanding))
  }, [showLanding])

  const handleAuthSuccess = (userId: string, username: string) => {
    setUserId(userId)
    setUsername(username)
    setIsAuthenticated(true)
  }

  const handleLandingGetStarted = () => {
    setShowLanding(false)
  }

  const handleEnter = () => {
    setHasEntered(true)
    // If no active lobby, show lobby browser
    if (!currentLobbyId) {
      setShowLobbyBrowser(true)
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
      setShowLobbyBrowser(false)
    } catch (err) {
      console.error('Error joining lobby:', err)
      alert('Failed to join lobby')
    }
  }

  const handleLeaveLobby = () => {
    // Clear all lobby-specific data from store to free memory
    clearLobbyData()
    setCurrentLobbyId(null)
    setShowLobbyBrowser(true)
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    )
  }

  // Show landing page for new visitors
  if (showLanding && !isAuthenticated) {
    return <LandingPage onGetStarted={handleLandingGetStarted} />
  }

  if (!isAuthenticated) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} onBackToLanding={() => setShowLanding(true)} />
  }

  if (!hasEntered || !username) {
    return <WelcomeScreen onEnter={handleEnter} />
  }

  // Show lobby browser if no active lobby
  if (showLobbyBrowser || !currentLobbyId) {
    return (
      <LobbyBrowser
        onJoinLobby={handleJoinLobby}
        onClose={() => {
          // Go back to welcome/login screen
          setHasEntered(false)
          setShowLobbyBrowser(false)
        }}
      />
    )
  }

  return <LobbyScene lobbyId={currentLobbyId} onLeaveLobby={handleLeaveLobby} />
}

export default App
