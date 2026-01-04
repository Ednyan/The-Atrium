import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'

interface AuthScreenProps {
  onAuthSuccess: (userId: string, username: string) => void
  onBackToLanding?: () => void
}

export default function AuthScreen({ onAuthSuccess, onBackToLanding }: AuthScreenProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkEmail, setCheckEmail] = useState(false)
  const [resetEmailSent, setResetEmailSent] = useState(false)

  // Memoize particle positions (fireflies)
  const particles = useMemo(() => 
    [...Array(12)].map((_, i) => ({
      left: `${(i * 17 + 3) % 96}%`,
      top: `${(i * 23 + 5) % 94}%`,
      duration: 8 + (i * 1.5) % 6,
      delay: i * 0.5,
    })), []
  )

  // Memoize background rectangles (trace-like elements)
  const backgroundRects = useMemo(() => 
    [...Array(8)].map((_, i) => ({
      left: `${(i * 19 + 7) % 90}%`,
      top: `${(i * 31 + 12) % 85}%`,
      width: 30 + (i * 17) % 80,
      height: 15 + (i * 13) % 40,
      rotation: (i * 7) % 15 - 7,
      delay: i * 0.3,
    })), []
  )

  // Background component to avoid repetition
  const BackgroundElements = () => (
    <>
      {/* Animated background grid */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(218, 212, 187, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(218, 212, 187, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Background rectangles */}
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
          />
        ))}
      </div>

      {/* Floating particles */}
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
    </>
  )

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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!supabase) {
      setError('Authentication not available')
      setLoading(false)
      return
    }

    if (!email) {
      setError('Please enter your email address')
      setLoading(false)
      return
    }

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetError) throw resetError

      setResetEmailSent(true)
    } catch (err: any) {
      setError(err.message || 'Failed to send reset email')
    } finally {
      setLoading(false)
    }
  }

  if (resetEmailSent) {
    return (
      <div className="fixed inset-0 bg-nier-black flex items-center justify-center z-50">
        {/* Scanline overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-40"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
          }}
        />
        
        <BackgroundElements />
        
        <div className="bg-nier-blackLight border border-nier-border/40 p-8 max-w-md w-full mx-4 relative z-10">
          {/* Corner brackets */}
          <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
          <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
          
          <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase mb-4">Check Your Email</h2>
          <p className="text-nier-border text-sm leading-relaxed mb-6">
            We've sent you an email with a link to reset your password. Please check your inbox and follow the instructions.
          </p>
          <button
            onClick={() => {
              setResetEmailSent(false)
              setMode('login')
              setEmail('')
            }}
            className="w-full py-3 border border-nier-border/60 text-nier-bg text-xs tracking-[0.15em] uppercase transition-all hover:bg-nier-bg hover:text-nier-black hover:border-nier-bg"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  if (checkEmail) {
    return (
      <div className="fixed inset-0 bg-nier-black flex items-center justify-center z-50">
        {/* Scanline overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-40"
          style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
          }}
        />
        
        <BackgroundElements />
        
        <div className="bg-nier-blackLight border border-nier-border/40 p-8 max-w-md w-full mx-4 relative z-10">
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
      <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-40"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
        }}
      />
      
      <BackgroundElements />
      
      {/* Corner decorations */}
      <div className="absolute top-8 left-8 w-12 h-12 border-l border-t border-nier-border/20" />
      <div className="absolute top-8 right-8 w-12 h-12 border-r border-t border-nier-border/20" />
      <div className="absolute bottom-8 left-8 w-12 h-12 border-l border-b border-nier-border/20" />
      <div className="absolute bottom-8 right-8 w-12 h-12 border-r border-b border-nier-border/20" />

      {/* Back to landing button */}
      {onBackToLanding && (
        <button
          onClick={onBackToLanding}
          className="absolute top-8 left-8 flex items-center gap-2 text-nier-border/60 hover:text-nier-bg transition-colors group z-20"
        >
          <span className="text-lg group-hover:-translate-x-1 transition-transform">←</span>
          <span className="text-[10px] tracking-[0.15em] uppercase">Back</span>
        </button>
      )}

      <div className="bg-nier-blackLight border border-nier-border/40 p-8 max-w-md w-full mx-4 relative z-10">
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
            {mode === 'login' ? 'Welcome' : mode === 'signup' ? 'Create Account' : 'Reset Password'}
          </h1>
        </div>

        <form onSubmit={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleForgotPassword} className="space-y-5">
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
              {mode === 'forgot' && (
                <p className="text-nier-border/50 text-[9px] tracking-wider mt-2 uppercase">
                  Enter the email associated with your account
                </p>
              )}
            </div>
          )}

          {mode !== 'forgot' && (
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
          )}

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
            {loading ? '◇ Processing...' : mode === 'login' ? 'Log In' : mode === 'signup' ? 'Sign Up' : 'Send Reset Link'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-nier-border/20 text-center space-y-3">
          {mode === 'login' && (
            <button
              onClick={() => {
                setMode('forgot')
                setError('')
              }}
              className="text-nier-border/60 text-[10px] tracking-wider hover:text-nier-bg transition-colors block w-full"
            >
              ◇ Forgot your password?
            </button>
          )}
          <button
            onClick={() => {
              if (mode === 'forgot') {
                setMode('login')
              } else {
                setMode(mode === 'login' ? 'signup' : 'login')
              }
              setError('')
            }}
            className="text-nier-border text-[11px] tracking-wider hover:text-nier-bg transition-colors"
          >
            {mode === 'login' ? "◇ Don't have an account? Sign up" : mode === 'signup' ? '◇ Already have an account? Log in' : '◇ Back to Login'}
          </button>
        </div>
      </div>
    </div>
  )
}
