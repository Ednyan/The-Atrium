import { useState, useEffect } from 'react'
import LobbyScene from './components/LobbyScene'
import WelcomeScreen from './components/WelcomeScreen'
import AuthScreen from './components/AuthScreen'
import { useGameStore } from './store/gameStore'
import { supabase } from './lib/supabase'

function App() {
  const { username, setUsername, setUserId } = useGameStore()
  const [hasEntered, setHasEntered] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

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
          .select('username, display_name')
          .eq('id', session.user.id)
          .single()
          .then(({ data }: any) => {
            if (data) {
              setUserId(session.user.id)
              setUsername(data.display_name || data.username)
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
          .select('username, display_name')
          .eq('id', session.user.id)
          .single()
          .then(({ data }: any) => {
            if (data) {
              setUserId(session.user.id)
              setUsername(data.display_name || data.username)
              setIsAuthenticated(true)
            }
          })
      } else {
        setIsAuthenticated(false)
        setHasEntered(false)
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

  return <LobbyScene />
}

export default App
