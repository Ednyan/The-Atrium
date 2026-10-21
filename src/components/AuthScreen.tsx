import { useState, type ReactNode } from 'react'
import { friendlyAuthError } from '../lib/authErrors'
import { markSignInStarted } from '../lib/signInIntent'
import { useTranslation } from '../lib/i18n'
import { supabase, isDesktop } from '../lib/supabase'
import { googleOpen } from '../lib/drive'
import GoogleButton from './GoogleButton'
import Atmosphere from './Atmosphere'
import ThemeToggle from './ThemeToggle'
import { Brackets } from './landing/parts'
import { DONATE_CUT } from './DonateButton'
import { useLandingTheme } from '../lib/useLandingTheme'
import { usernameAvailable } from '../lib/people'
import { adopt, confirmEmail, resetPassword, sendCode, signIn, signUp, type SignIn } from '../lib/emailAccount'

interface AuthScreenProps {
  onAuthSuccess: (userId: string, username: string) => void
  onBackToLanding?: () => void
  /** On without an account: atriums kept in this browser (lib/browserAtriums). */
  onGuest?: () => void
  // A failure handed back on an OAuth return URL, surfaced here so the user
  // sees why they were bounced instead of a silent trip to the homepage.
  initialError?: string
}

export default function AuthScreen({ onAuthSuccess, onBackToLanding, onGuest, initialError }: AuthScreenProps) {
  const { t } = useTranslation()
  // The landing page's own theme: this page is its next room.
  const theme = useLandingTheme()
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [emailOrUsername, setEmailOrUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [loading, setLoading] = useState(false)
  // A code mailed (lib/emailAccount): a new account's address to confirm, or
  // a forgotten password -- the screen that takes it, and what it takes.
  const [codeFor, setCodeFor] = useState<{ email: string; purpose: 'confirm' | 'reset' } | null>(null)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordAgain, setNewPasswordAgain] = useState('')
  const [note, setNote] = useState('')

  // The worker's refusals, by name (lib/emailAccount), said in the page's words.
  const said = (err: any, fallback: string) => ({
    EMAIL_TAKEN: t('auth.errEmailRegistered'),
    EMAIL_GOOGLE: t('auth.errEmailGoogle'),
    USERNAME_TAKEN: t('auth.errUsernameTaken'),
    TOO_MANY: t('auth.error.tooManyTries'),
    TOO_MANY_TRIES: t('auth.error.tooManyTries'),
    WAIT: t('auth.error.tooManyTries'),
    CHECK: t('auth.error.usernameLookup'),
    WRONG_CODE: t('auth.error.wrongCode'),
    WEAK_PASSWORD: t('auth.passwordHint'),
    BANNED: t('auth.error.banned'),
    AUTH_DOWN: t('auth.errUnavailable'),
  } as Record<string, string>)[err?.message] ?? friendlyAuthError(err, fallback)

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    // Validate username
    if (username.length < 3 || username.length > 20) {
      setError(t('auth.errUsernameLength'))
      setLoading(false)
      return
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setError(t('auth.errUsernameChars'))
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'))
      setLoading(false)
      return
    }

    if (!supabase) {
      setError(t('auth.errUnavailable'))
      setLoading(false)
      return
    }

    try {
      // Free across every account, existing and Google ones alike
      // (lib/people) -- or, not answered, said so rather than called taken.
      const available = await usernameAvailable(username)
      if (available !== true) {
        setError(t(available === false ? 'auth.errUsernameTaken' : 'auth.error.usernameLookup'))
        setLoading(false)
        return
      }

      // Noted before the request, not after it. Registering by email can
      // finish in a different tab an hour later, when the click lands on the
      // confirmation link, and nothing in that tab would otherwise know this
      // person had just signed up rather than merely arrived.
      markSignInStarted()

      // An email account, at the worker (docs/DECENTRALIZING.md, phase 10):
      // kept unconfirmed until the code mailed to its address comes back.
      await signUp(email.trim(), username, password)
      setCode('')
      setNote('')
      setCodeFor({ email: email.trim(), purpose: 'confirm' })
    } catch (err: any) {
      console.error('Signup error:', err)
      setError(said(err, t('auth.error.signUpFailed')))
    } finally {
      setLoading(false)
    }
  }

  // Signing in with Google: Google's own button,
  // one click, asking only who one is -- Drive is asked for where it's used, a
  // Drive atrium made or joined. Then a Google account (the app takes it from
  // there: App, ACCOUNT_EVENT), or the existing account this Google is:
  // signed in to it by Supabase with the button's own token where Supabase
  // will (it has this Google, or this verified address -- and links it), on
  // to its own Google sign-in if it was made with Google, else told to sign
  // in with its email and password.
  const handleGoogleCredential = async (idToken: string) => {
    setError('')
    setLoading(true)
    try {
      const { signInWithGoogle } = await import('../lib/drive')
      const result = await signInWithGoogle(idToken)
      if (result.kind === 'google') return
      if (await signInToExisting(idToken, result.account)) return
      if (result.how === 'google') {
        await handleGoogleSignIn()
        return
      }
      setError(t('auth.error.existingPassword'))
    } catch (err: any) {
      setError(friendlyAuthError(err, t('auth.error.googleFailed')))
    }
    setLoading(false)
  }

  // Into the existing account with Google's ID token -- true if that's where
  // Supabase put us. Anywhere else, out again at once: an account is never
  // made, or kept, by guessing.
  const signInToExisting = async (idToken: string, account: string): Promise<boolean> => {
    if (!supabase) return false
    markSignInStarted()
    const { data, error: idError } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
    if (idError) {
      console.warn('[atrium] signing in to the account from before with Google:', idError.message)
      return false
    }
    if (data?.user?.id === account) return true
    await supabase.auth.signOut()
    return false
  }

  // Hands off to Google and returns to the app via redirect, so there's no
  // success path to handle here -- the page navigates away. Only a failure to
  // even start the handoff surfaces as an error.
  const handleGoogleSignIn = async () => {
    if (!supabase) return
    setError('')
    setLoading(true)
    try {
      // Recorded before leaving for Google, because after it the app is
      // reloaded from scratch at "/" and has no memory of having sent them.
      markSignInStarted()
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (oauthError) throw oauthError
    } catch (err: any) {
      console.error('Google sign-in error:', err)
      setError(err?.message || t('auth.error.googleFailed'))
      setLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!supabase) {
      setError(t('auth.errUnavailable'))
      setLoading(false)
      return
    }

    try {
      const login = emailOrUsername.trim()
      markSignInStarted()
      // The worker first: an email account signs in there (App takes it from
      // there, as for a Google account); an existing account it knows is
      // told right, with its address. Out of reach, on to Supabase as ever.
      let known: SignIn = { kind: 'unknown' }
      try {
        known = await signIn(login, password)
      } catch (err: any) {
        // Never confirmed: its code screen, and a new code -- the first may have run out.
        if (err?.message === 'UNCONFIRMED' && err.email) {
          setCode('')
          setNote('')
          setCodeFor({ email: err.email, purpose: 'confirm' })
          void sendCode(err.email, 'confirm').catch(() => {})
          return
        }
        if (err?.message !== 'AUTH_DOWN') throw err
      }
      if (known.kind === 'email') return
      let loginEmail = known.kind === 'existing' ? known.email : login

      // A username: the account's email, given only for its password
      // (email_for_sign_in, hide_emails_1.sql) -- emails are nobody else's to
      // read -- then signed in with it, through Auth as ever.
      if (known.kind !== 'existing' && !login.includes('@')) {
        const { data: email, error: lookupError } = await (supabase as any).rpc('email_for_sign_in', { p_username: login, p_password: password })
        if (lookupError) {
          if (/too_many_attempts/.test(lookupError.message ?? '')) throw new Error(t('auth.error.tooManyTries'))
          console.error('Username sign-in:', lookupError)
          throw new Error(t('auth.error.usernameLookup'))
        }
        if (typeof email !== 'string') throw new Error(t('auth.error.usernameOrPassword'))
        loginEmail = email
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

        // Its credential copied to the worker (lib/emailAccount), for the
        // cutover -- unless the worker just said it has it.
        if (known.kind !== 'existing' && data.session && profile?.username) void adopt(data.session.access_token, loginEmail, profile.username, password)

        if (profile) {
          onAuthSuccess(data.user.id, profile.display_name || profile.username)
        }
      }
    } catch (err: any) {
      setError(said(err, t('auth.error.logInFailed')))
    } finally {
      setLoading(false)
    }
  }

  // The code screen's: a new account's address confirmed, or a new
  // password set -- signed in either way (App takes it from there).
  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!codeFor) return
    setError('')
    setNote('')
    if (codeFor.purpose === 'reset') {
      if (newPassword.length < 6) return setError(t('profile.errPasswordLength'))
      if (newPassword !== newPasswordAgain) return setError(t('auth.passwordsDoNotMatch'))
    }
    setLoading(true)
    try {
      markSignInStarted()
      if (codeFor.purpose === 'confirm') await confirmEmail(codeFor.email, code)
      else await resetPassword(codeFor.email, code, newPassword)
    } catch (err: any) {
      setError(said(err, t('auth.error.wrongCode')))
    } finally {
      setLoading(false)
    }
  }
  const sendAnother = async () => {
    if (!codeFor) return
    setError('')
    try {
      await sendCode(codeFor.email, codeFor.purpose)
      setNote(t('auth.codeResent'))
    } catch (err: any) {
      setError(said(err, t('auth.error.resetEmailFailed')))
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (!supabase) {
      setError(t('auth.errUnavailable'))
      setLoading(false)
      return
    }

    if (!email) {
      setError(t('auth.errNoEmail'))
      setLoading(false)
      return
    }

    try {
      // Both are asked, each answering only for its own: the worker mails an
      // email account a code; Supabase mails an existing account a link (its
      // password is Supabase's until the cutover, components/PasswordRecovery).
      const address = email.trim()
      const supabaseAsked = (async () => (await supabase.auth.resetPasswordForEmail(address, { redirectTo: `${window.location.origin}/reset-password` })).error)()
        .catch((err: unknown) => err)
      await sendCode(address, 'reset')
      // Supabase's refusal (asked too soon, say, or out of reach) said on the
      // code screen -- shown all the same: the worker's code may be on its way.
      const resetError = await supabaseAsked

      setCode('')
      setNewPassword('')
      setNewPasswordAgain('')
      setNote('')
      setCodeFor({ email: address, purpose: 'reset' })
      if (resetError) setError(said(resetError, t('auth.error.resetEmailFailed')))
    } catch (err: any) {
      setError(said(err, t('auth.error.resetEmailFailed')))
    } finally {
      setLoading(false)
    }
  }

  // The landing page's hall, which this page continues -- its closing scene,
  // the orb above the words, and the way in under them: its theme, its
  // light and dust, a way back and the theme's switch along the top.
  const field = 'w-full bg-transparent border border-nier-border/30 text-nier-bg px-4 py-3 text-sm tracking-wide placeholder-nier-bg/45 focus:border-nier-border/70 transition-colors'
  const label = 'block text-nier-bg/70 text-[11px] tracking-[0.2em] uppercase mb-2'
  const hint = 'text-nier-bg/60 text-[10px] tracking-wider mt-2 uppercase leading-relaxed'
  const page = (title: string, children: ReactNode, after?: ReactNode) => (
    <div data-landing-theme={theme.resolved} className="fixed inset-0 z-50 overflow-y-auto font-mono" style={{ backgroundColor: 'rgb(var(--c-ground))' }}>
      <Atmosphere />
      <header className="relative z-10 flex items-center justify-between gap-4 px-5 sm:px-8 h-16">
        {onBackToLanding ? (
          <button type="button" onClick={onBackToLanding} className="landing-link text-xs tracking-[0.2em] uppercase">
            <span aria-hidden="true">◁</span> {t('auth.back')}
          </button>
        ) : <span />}
        <ThemeToggle />
      </header>
      <main className="relative z-10 flex justify-center px-5 pt-4 pb-16 sm:pt-10">
        <div className="w-full max-w-[26rem]">
          <div className="flex flex-col items-center text-center mb-10">
            <span aria-hidden="true" className="landing-orb w-4 h-4 rounded-full mb-8" />
            <p translate="no" className="text-[11px] tracking-[0.35em] uppercase text-nier-bg/60">The Digital Atrium</p>
            <h1 className="mt-4 text-3xl sm:text-4xl font-extralight tracking-[0.1em] uppercase text-nier-strong text-balance">{title}</h1>
          </div>
          <div className="relative">
            <Brackets />
            <div className="border border-nier-border/30 p-6 sm:p-8" style={{ backgroundColor: 'rgb(var(--c-ground) / 0.75)' }}>
              {children}
            </div>
          </div>
          {after}
        </div>
      </main>
    </div>
  )
  const problem = error && (
    <p role="alert" className="border px-4 py-3 text-xs tracking-wide leading-relaxed" style={{ borderColor: 'rgb(var(--c-danger) / 0.45)', color: 'rgb(var(--c-danger))' }}>
      {error}
    </p>
  )
  const commit = (text: string, disabled = false) => (
    <button type="submit" disabled={loading || disabled} className="landing-cta w-full py-3.5 text-xs tracking-[0.2em] uppercase disabled:opacity-50 disabled:cursor-not-allowed" style={{ clipPath: DONATE_CUT }}>
      {loading ? `◇ ${t('auth.processing')}` : text}
    </button>
  )

  // A code mailed: entered here -- a new account's, or a new password's,
  // which takes the new password too. Another can be asked for.
  if (codeFor) {
    const reset = codeFor.purpose === 'reset'
    return page(t(reset ? 'auth.resetPassword' : 'auth.checkEmail'), (
      <form onSubmit={handleCode} className="space-y-5">
        <p className="text-nier-bg/80 text-sm leading-relaxed text-pretty">
          {t(reset ? 'auth.resetCodeSent' : 'auth.confirmCodeSent', { email: codeFor.email })}
        </p>
        <div>
          <label htmlFor="auth-code" className={label}>{t('auth.code')}</label>
          <input
            id="auth-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className={`${field} tracking-[0.4em]`}
            placeholder="000000"
            required
          />
        </div>
        {reset && (
          <>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t('profile.newPassword')} className={field} autoComplete="new-password" required minLength={6} />
            <input type="password" value={newPasswordAgain} onChange={e => setNewPasswordAgain(e.target.value)} placeholder={t('profile.confirmNewPassword')} className={field} autoComplete="new-password" required minLength={6} />
            <p className={hint}>{t('auth.passwordHint')}</p>
          </>
        )}
        {problem}
        {note && <p className="text-nier-bg/70 text-xs tracking-wide">{note}</p>}
        {commit(t(reset ? 'auth.setNewPassword' : 'auth.confirmCode'), code.length < 6)}
      </form>
    ), (
      <div className="mt-8 flex items-center justify-between gap-4">
        <button type="button" onClick={() => void sendAnother()} className="landing-link text-xs tracking-wide">◇ {t('profile.resendCode')}</button>
        <button
          type="button"
          onClick={() => {
            setCodeFor(null)
            setMode('login')
            setError('')
          }}
          className="landing-link text-xs tracking-wide"
        >
          {t('auth.backToLogin')}
        </button>
      </div>
    ))
  }

  return page(mode === 'login' ? t('auth.welcome') : mode === 'signup' ? t('auth.createAccount') : t('auth.resetPassword'), (
    <form onSubmit={mode === 'login' ? handleLogin : mode === 'signup' ? handleSignup : handleForgotPassword} className="space-y-5">
      {mode === 'signup' && (
        <div>
          <label htmlFor="auth-username" className={label}>{t('auth.username')}</label>
          <input
            id="auth-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={field}
            placeholder={t('auth.usernamePlaceholder')}
            autoComplete="username"
            required
            minLength={3}
            maxLength={20}
            pattern="[a-zA-Z0-9_]+"
          />
          <p className={hint}>{t('auth.usernameHint')}</p>
        </div>
      )}

      {mode === 'login' ? (
        <div>
          <label htmlFor="auth-login" className={label}>{t('auth.emailOrUsername')}</label>
          <input
            id="auth-login"
            type="text"
            value={emailOrUsername}
            onChange={(e) => setEmailOrUsername(e.target.value)}
            className={field}
            placeholder={t('auth.emailOrUsernamePlaceholder')}
            autoComplete="username"
            required
          />
        </div>
      ) : (
        <div>
          <label htmlFor="auth-email" className={label}>{t('auth.email')}</label>
          <input
            id="auth-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
            placeholder={t('auth.emailPlaceholder')}
            autoComplete="email"
            required
          />
          {mode === 'forgot' && <p className={hint}>{t('auth.emailForReset')}</p>}
        </div>
      )}

      {mode !== 'forgot' && (
        <div>
          <label htmlFor="auth-password" className={label}>{t('auth.password')}</label>
          <input
            id="auth-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
            placeholder="••••••••"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            required
            minLength={6}
          />
          {mode === 'signup' && <p className={hint}>{t('auth.passwordHint')}</p>}
        </div>
      )}

      {mode === 'signup' && (
        <div>
          <label htmlFor="auth-password-again" className={label}>{t('auth.confirmPassword')}</label>
          <input
            id="auth-password-again"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={field}
            placeholder="••••••••"
            autoComplete="new-password"
            required
            minLength={6}
          />
          {confirmPassword.length > 0 && confirmPassword !== password && (
            <p className={hint} style={{ color: 'rgb(var(--c-danger))' }}>{t('auth.passwordsDoNotMatch')}</p>
          )}
        </div>
      )}

      {problem}

      {commit(mode === 'login' ? t('auth.logIn') : mode === 'signup' ? t('auth.signUp') : t('auth.sendResetLink'))}

      {/* Google, and the way in without an account. Web only: OAuth returns
          via an HTTP redirect, and the desktop shell has no deep-link handler
          to catch it -- the same reason Pinterest's OAuth is web-only (see
          lib/pinterest.ts). Not on the reset screen, where it makes no sense. */}
      {!isDesktop && mode !== 'forgot' && (
        <>
          <div className="flex items-center gap-3 pt-1" aria-hidden="true">
            <div className="flex-1 h-px" style={{ backgroundColor: 'rgb(var(--c-fg) / 0.14)' }} />
            <span className="text-nier-bg/60 text-[10px] tracking-[0.3em] uppercase">{t('auth.or')}</span>
            <div className="flex-1 h-px" style={{ backgroundColor: 'rgb(var(--c-fg) / 0.14)' }} />
          </div>
          {googleOpen ? <GoogleButton busy={loading} light={theme.resolved === 'light'} onCredential={idToken => void handleGoogleCredential(idToken)} /> : <button
            type="button"
            disabled={loading}
            onClick={handleGoogleSignIn}
            className="w-full py-3 border border-nier-border/40 text-nier-bg text-xs tracking-[0.15em] uppercase transition-colors hover:border-nier-border/80 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
          >
            <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            {t('auth.continueWithGoogle')}
          </button>}
          {onGuest && (
            <button
              type="button"
              onClick={onGuest}
              className="w-full py-3 border border-nier-border/40 text-nier-bg/80 text-xs tracking-[0.15em] uppercase transition-colors hover:border-nier-border/80 hover:text-nier-strong"
            >
              {t('auth.withoutAccount')}
              <span className="block mt-1 text-[10px] tracking-wider normal-case text-nier-bg/60">{t('auth.withoutAccountHint')}</span>
            </button>
          )}
        </>
      )}
    </form>
  ), (
    <div className="mt-8 flex flex-col items-center gap-3 text-center">
      {mode === 'login' && (
        <button
          type="button"
          onClick={() => {
            setMode('forgot')
            setError('')
          }}
          className="landing-link text-xs tracking-wide"
        >
          ◇ {t('auth.forgotPassword')}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'forgot' ? 'login' : mode === 'login' ? 'signup' : 'login')
          setError('')
          setConfirmPassword('')
        }}
        className="landing-link text-sm tracking-wide"
      >
        {mode === 'login' ? `◇ ${t('auth.noAccount')}` : mode === 'signup' ? `◇ ${t('auth.haveAccount')}` : `◇ ${t('auth.backToLogin')}`}
      </button>
      <div className="mt-4 flex items-center justify-center gap-3">
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-nier-bg/60 hover:text-nier-strong text-[10px] tracking-[0.15em] uppercase transition-colors">
          {t('landing.privacy')}
        </a>
        <span className="text-nier-bg/40 text-[10px]" aria-hidden="true">◇</span>
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-nier-bg/60 hover:text-nier-strong text-[10px] tracking-[0.15em] uppercase transition-colors">
          {t('landing.terms')}
        </a>
      </div>
    </div>
  ))
}
