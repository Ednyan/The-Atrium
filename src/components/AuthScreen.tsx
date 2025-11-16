import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface AuthScreenProps {
  onAuthSuccess: (userId: string, username: string) => void
}

export default function AuthScreen({ onAuthSuccess }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Validate username
    if (username.length < 3 || username.length > 20) {
      setError('Username must be 3-20 characters')
      setLoading(false)
      return
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError('Username can only contain letters, numbers, and underscores')
      setLoading(false)
      return
    }

    if (!supabase) {
      setError('Authentication not available')
      setLoading(false)
      return
    }

    try {
      // Check if username is already taken
      const { data: existingUser, error: lookupError } = await (supabase
        .from('profiles') as any)
        .select('username')
        .eq('username', username)
        .maybeSingle()

      console.log('Username check:', { existingUser, lookupError })

      if (existingUser) {
        setError('Username already taken')
        setLoading(false)
        return
      }

      // Sign up user
      const { data, error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username,
          },
          emailRedirectTo: window.location.origin,
        },
      })

      console.log('Signup response:', { data, signupError })

      if (signupError) {
        // Check for specific error messages
        if (signupError.message.includes('already registered')) {
          setError('This email is already registered. Please log in instead.')
        } else {
          throw signupError
        }
      } else if (data.user) {
        // Check if email confirmation is required
        if (data.session) {
          // User is auto-confirmed (disabled email confirmation)
          const { data: profile } = await (supabase
            .from('profiles') as any)
            .select('username, display_name')
            .eq('id', data.user.id)
            .maybeSingle()

          if (profile) {
            onAuthSuccess(data.user.id, profile.display_name || profile.username)
          }
        } else {
          // Email confirmation required
          setCheckEmail(true)
        }
      }
    } catch (err: any) {
      console.error('Signup error:', err)
      setError(err.message || 'Failed to sign up')
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!supabase) {
      setError('Authentication not available')
      setLoading(false)
      return
    }

    try {
      let loginEmail = emailOrUsername

      // Check if input is a username (not an email)
      if (!emailOrUsername.includes('@')) {
        // Look up email by username
        const { data: profile, error: profileError } = await (supabase
          .from('profiles') as any)
          .select('email')
          .eq('username', emailOrUsername)
          .maybeSingle()

        if (profileError) {
          console.error('Profile lookup error:', profileError)
          throw new Error('Failed to look up username')
        }

        if (!profile) {
          throw new Error('Username not found')
        }

        loginEmail = profile.email
      }

      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      })

      if (loginError) throw loginError

      if (data.user) {
        // Get user profile
        const { data: profile } = await (supabase
          .from('profiles') as any)
          .select('username, display_name')
          .eq('id', data.user.id)
          .single()

        if (profile) {
          onAuthSuccess(data.user.id, profile.display_name || profile.username)
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to log in')
    } finally {
      setLoading(false)
    }
  }

  if (checkEmail) {
    return (
      <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
        <div className="bg-lobby-dark border-2 border-lobby-accent rounded-lg p-8 max-w-md w-full mx-4">
          <h2 className="text-2xl font-bold text-white mb-4">Check Your Email</h2>
          <p className="text-white/80 mb-4">
            We've sent you an email with a confirmation link. Please check your inbox and click the link to verify your account.
          </p>
          <button
            onClick={() => {
              setCheckEmail(false)
              setMode('login')
            }}
            className="w-full bg-lobby-accent hover:bg-lobby-accent/80 text-white font-semibold py-2 px-4 rounded"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50">
      <div className="bg-lobby-dark border-2 border-lobby-accent rounded-lg p-8 max-w-md w-full mx-4">
        <h1 className="text-3xl font-bold text-white mb-6 text-center">
          {mode === 'login' ? 'Welcome Back' : 'Create Account'}
        </h1>

        <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-white/80 text-sm font-semibold mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-white focus:outline-none focus:border-lobby-accent"
                placeholder="Choose a unique username"
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]+"
              />
              <p className="text-white/50 text-xs mt-1">
                3-20 characters, letters, numbers, and underscores only
              </p>
            </div>
          )}

          {mode === 'login' ? (
            <div>
              <label className="block text-white/80 text-sm font-semibold mb-2">
                Email or Username
              </label>
              <input
                type="text"
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-white focus:outline-none focus:border-lobby-accent"
                placeholder="your@email.com or username"
                required
              />
            </div>
          ) : (
            <div>
              <label className="block text-white/80 text-sm font-semibold mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-white focus:outline-none focus:border-lobby-accent"
                placeholder="your@email.com"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-white/80 text-sm font-semibold mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-black/50 border border-white/20 rounded px-3 py-2 text-white focus:outline-none focus:border-lobby-accent"
              placeholder="••••••••"
              required
              minLength={6}
            />
            {mode === 'signup' && (
              <p className="text-white/50 text-xs mt-1">
                Minimum 6 characters
              </p>
            )}
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500 rounded px-3 py-2 text-red-200 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-lobby-accent hover:bg-lobby-accent/80 disabled:bg-lobby-accent/50 text-white font-semibold py-2 px-4 rounded transition-colors"
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setError('')
            }}
            className="text-lobby-accent hover:text-lobby-accent/80 text-sm"
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </button>
        </div>
      </div>
    </div>
  )
}
