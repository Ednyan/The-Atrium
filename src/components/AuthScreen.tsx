import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface AuthScreenProps {
  onAuthSuccess: (userId: string, username: string) => void
  onBackToLanding?: () => void
}

export default function AuthScreen({ onAuthSuccess, onBackToLanding }: AuthScreenProps) {
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
      const { data: existingUser } = await (supabase
        .from('profiles') as any)
        .select('username')
        .eq('username', username)
        .maybeSingle()

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
      <div className="fixed inset-0 bg-nier-black flex items-center justify-center z-50">
        {/* Scanline overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
          }}
        />
        
        <div className="bg-nier-blackLight border border-nier-border/40 p-8 max-w-md w-full mx-4 relative">
          {/* Corner brackets */}
          <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
          <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
          
          <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase mb-4">Check Your Email</h2>
          <p className="text-nier-border text-sm leading-relaxed mb-6">
            We've sent you an email with a confirmation link. Please check your inbox and click the link to verify your account.
          </p>
          <button
            onClick={() => {
              setCheckEmail(false)
              setMode('login')
            }}
            className="w-full py-3 border border-nier-border/60 text-nier-bg text-xs tracking-[0.15em] uppercase transition-all hover:bg-nier-bg hover:text-nier-black hover:border-nier-bg"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-nier-black flex items-center justify-center z-50">
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
        }}
      />
      
      {/* Corner decorations */}
      <div className="absolute top-8 left-8 w-12 h-12 border-l border-t border-nier-border/20" />
      <div className="absolute top-8 right-8 w-12 h-12 border-r border-t border-nier-border/20" />
      <div className="absolute bottom-8 left-8 w-12 h-12 border-l border-b border-nier-border/20" />
      <div className="absolute bottom-8 right-8 w-12 h-12 border-r border-b border-nier-border/20" />

      {/* Back to landing button */}
      {onBackToLanding && (
        <button
          onClick={onBackToLanding}
          className="absolute top-8 left-8 flex items-center gap-2 text-nier-border/60 hover:text-nier-bg transition-colors group z-10"
        >
          <span className="text-lg group-hover:-translate-x-1 transition-transform">←</span>
          <span className="text-[10px] tracking-[0.15em] uppercase">Back</span>
        </button>
      )}

      <div className="bg-nier-blackLight border border-nier-border/40 p-8 max-w-md w-full mx-4 relative">
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-8 h-[1px] bg-gradient-to-r from-transparent to-nier-border/40" />
            <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
            <div className="w-8 h-[1px] bg-gradient-to-l from-transparent to-nier-border/40" />
          </div>
          <h1 className="text-xl text-nier-bg tracking-[0.2em] uppercase">
            {mode === 'login' ? 'Welcome' : 'Create Account'}
          </h1>
        </div>

        <form onSubmit={mode === 'login' ? handleLogin : handleSignup} className="space-y-5">
          {mode === 'signup' && (
            <div>
              <label className="block text-nier-border text-[10px] tracking-[0.15em] uppercase mb-2">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-nier-black border border-nier-border/30 px-4 py-3 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                placeholder="Choose a unique username"
                required
                minLength={3}
                maxLength={20}
                pattern="[a-zA-Z0-9_]+"
              />
              <p className="text-nier-border/50 text-[9px] tracking-wider mt-2 uppercase">
                3-20 characters, letters, numbers, underscores
              </p>
            </div>
          )}

          {mode === 'login' ? (
            <div>
              <label className="block text-nier-border text-[10px] tracking-[0.15em] uppercase mb-2">
                Email or Username
              </label>
              <input
                type="text"
                value={emailOrUsername}
                onChange={(e) => setEmailOrUsername(e.target.value)}
                className="w-full bg-nier-black border border-nier-border/30 px-4 py-3 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                placeholder="your@email.com or username"
                required
              />
            </div>
          ) : (
            <div>
              <label className="block text-nier-border text-[10px] tracking-[0.15em] uppercase mb-2">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-nier-black border border-nier-border/30 px-4 py-3 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                placeholder="your@email.com"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-nier-border text-[10px] tracking-[0.15em] uppercase mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-nier-black border border-nier-border/30 px-4 py-3 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
              placeholder="••••••••"
              required
              minLength={6}
            />
            {mode === 'signup' && (
              <p className="text-nier-border/50 text-[9px] tracking-wider mt-2 uppercase">
                Minimum 6 characters
              </p>
            )}
          </div>

          {error && (
            <div className="border border-nier-red/40 bg-nier-red/10 px-4 py-3 text-nier-bg/80 text-xs tracking-wide">
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase transition-all hover:bg-nier-bgDark disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '◇ Processing...' : mode === 'login' ? 'Log In' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-nier-border/20 text-center">
          <button
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setError('')
            }}
            className="text-nier-border text-[11px] tracking-wider hover:text-nier-bg transition-colors"
          >
            {mode === 'login' ? "◇ Don't have an account? Sign up" : '◇ Already have an account? Log in'}
          </button>
        </div>
      </div>
    </div>
  )
}
