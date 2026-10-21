import { useEffect, useState } from 'react'
import { cloudClient, isDesktop } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import { adopt } from '../lib/emailAccount'

// Supabase's link for a forgotten password -- an existing account's, until
// the cutover (an email account's is a code, components/AuthScreen). The link
// signs the page in for recovery and comes back to /reset-password; nothing
// then asked for the new password, so it only ever signed people in. Asked
// here, wherever the page lands. Mounted beside App (main.tsx).
//
// Where it came back to is noted as this file loads, before anything routes
// the page elsewhere: Supabase's own word for it (PASSWORD_RECOVERY) can be
// said before anyone's listening.
const cameToRecover = !isDesktop && typeof location !== 'undefined'
  && (location.pathname === '/reset-password' || /[#&]type=recovery\b/.test(location.hash))

export default function PasswordRecovery() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // Open once the link's sign-in is in hand.
  useEffect(() => {
    if (!cameToRecover || !cloudClient) return
    const show = (session: unknown) => { if (session) setOpen(true) }
    void cloudClient.auth.getSession().then(({ data }: any) => show(data.session))
    const { data } = cloudClient.auth.onAuthStateChange((event: string, session: unknown) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') show(session)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  if (!open) return null

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    if (password.length < 6) return setError(t('profile.errPasswordLength'))
    if (password !== again) return setError(t('auth.passwordsDoNotMatch'))
    setBusy(true)
    try {
      const { data, error: updateError } = await cloudClient.auth.updateUser({ password })
      if (updateError) throw updateError
      // The worker's copy of it too (lib/emailAccount), with the link's own
      // sign-in, minutes old.
      const { data: { session } } = await cloudClient.auth.getSession()
      const { data: profile } = await cloudClient.from('profiles').select('username').eq('id', data.user.id).maybeSingle()
      if (session && data.user.email && profile?.username) await adopt(session.access_token, data.user.email, profile.username, password)
      setDone(true)
    } catch (err: any) {
      setError(err?.message || t('profile.errUpdatePassword'))
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full bg-nier-black border border-nier-border/30 px-4 py-3 text-nier-bg text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors'
  return (
    <div className="fixed inset-0 z-[10000200] bg-nier-black/85 flex items-center justify-center pointer-events-auto px-4">
      <form onSubmit={save} className="bg-nier-blackLight border border-nier-border/40 p-6 relative w-full max-w-sm space-y-4 font-mono">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60 pointer-events-none" />
        <h3 className="text-nier-strong text-sm tracking-[0.15em] uppercase text-center">
          <span className="mr-2 text-nier-bg/70">◇</span>{t('auth.resetPassword')}
        </h3>
        {done ? (
          <>
            <p className="text-nier-bg/80 text-xs tracking-wide text-center leading-relaxed">{t('auth.passwordSet')}</p>
            <button type="button" autoFocus onClick={() => setOpen(false)} className="w-full py-2.5 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors">
              {t('common.okay')}
            </button>
          </>
        ) : (
          <>
            <input type="password" autoFocus value={password} onChange={e => setPassword(e.target.value)} placeholder={t('profile.newPassword')} className={field} autoComplete="new-password" />
            <input type="password" value={again} onChange={e => setAgain(e.target.value)} placeholder={t('profile.confirmNewPassword')} className={field} autoComplete="new-password" />
            {error && <p className="text-xs tracking-wide" style={{ color: 'rgb(var(--c-danger))' }}>{error}</p>}
            <button type="submit" disabled={busy} className="w-full py-2.5 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-50">
              {busy ? `◇ ${t('auth.processing')}` : t('auth.setNewPassword')}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
