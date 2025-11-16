import { useState, useEffect } from 'react'
import LobbyScene from './components/LobbyScene'
import WelcomeScreen from './components/WelcomeScreen'
import AuthScreen from './components/AuthScreen'
import { LobbyBrowser } from './components/LobbyBrowser'
import { useGameStore } from './store/gameStore'
import { supabase } from './lib/supabase'

function App() {
  const { username, setUsername, setUserId, setPlayerColor } = useGameStore()
  const [hasEntered, setHasEntered] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [currentLobbyId, setCurrentLobbyId] = useState<string | null>(null)
  const [showLobbyBrowser, setShowLobbyBrowser] = useState(false)

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
        // Get user profile and active lobby
        (supabase
          .from('profiles') as any)
          .select('username, display_name, player_color, active_lobby_id')
          .eq('id', session.user.id)
          .single()
          .then(({ data }: any) => {
            if (data) {
              setUserId(session.user.id)
              setUsername(data.display_name || data.username)
              setPlayerColor(data.player_color || '#ffffff')
              setCurrentLobbyId(data.active_lobby_id)
              setIsAuthenticated(true)
            }
          })
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
          .select('username, display_name, player_color, active_lobby_id')
          .eq('id', session.user.id)
          .single()
          .then(({ data }: any) => {
            if (data) {
              setUserId(session.user.id)
              setUsername(data.display_name || data.username)
              setPlayerColor(data.player_color || '#ffffff')
              setCurrentLobbyId(data.active_lobby_id)
              setIsAuthenticated(true)
            }
          })
      } else {
        setIsAuthenticated(false)
        setHasEntered(false)
        setCurrentLobbyId(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [setUsername, setUserId])

  const handleAuthSuccess = (userId: string, username: string) => {
    setUserId(userId)
    setUsername(username)
    setIsAuthenticated(true)
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

  if (!isAuthenticated) {
    return <AuthScreen onAuthSuccess={handleAuthSuccess} />
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
          // Can't close without selecting a lobby
          if (!currentLobbyId) {
            alert('Please select a lobby to continue')
          } else {
            setShowLobbyBrowser(false)
          }
        }}
      />
    )
  }

  return <LobbyScene lobbyId={currentLobbyId} onLeaveLobby={handleLeaveLobby} />
}

export default App
