import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { approveDesktop } from '../lib/emailAccount'
import { whoIsSignedIn } from '../lib/signedIn'
import { useGamePick } from '../store/gameStore'
import RichText from './RichText'

// The page the desktop app opens to be signed in (docs/DECENTRALIZING.md,
// step 8; lib/emailAccount linkDesktop): whoever's signed in here approves
// the code the app shows, and the app is signed in as them. Signed out, it
// asks for a sign-in first and comes back here after (App, afterSignIn).
const AFTER_SIGN_IN = 'atrium.afterSignIn'

export default function DesktopLink({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useTranslation()
  const { username } = useGamePick('username')
  const code = (new URLSearchParams(location.search).get('code') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [state, setState] = useState<'asking' | 'busy' | 'done' | 'declined' | 'expired' | 'failed'>('asking')
  useEffect(() => { void whoIsSignedIn().then(who => setSignedIn(!!who)) }, [])

  const signIn = () => {
    try { sessionStorage.setItem(AFTER_SIGN_IN, `/link-desktop?code=${code}`) } catch { /* back to the welcome screen instead */ }
    onSignIn()
  }
  const approve = async () => {
    setState('busy')
    try {
      await approveDesktop(code)
      setState('done')
    } catch (error) {
      setState((error as Error).message === 'CODE' ? 'expired' : 'failed')
    }
  }

  const said = (key: Parameters<typeof t>[0]) => <p className="text-nier-bg/80 text-[0.85rem] leading-relaxed tracking-wide">{t(key)}</p>
  const button = 'flex-1 py-2.5 text-xs tracking-[0.15em] uppercase transition-colors disabled:opacity-40'
  return (
    <div className="fixed inset-0 bg-nier-black flex items-center justify-center p-6 font-mono">
      <div className="relative w-full max-w-md bg-nier-blackLight border border-nier-border/40 p-8">
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />
        <div className="flex items-center gap-3 mb-6">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h1 className="text-lg text-white tracking-[0.15em] uppercase">{t('linkDesktop.title')}</h1>
        </div>
        {code.length !== 8 ? said('linkDesktop.noCode')
          : state === 'done' ? said('linkDesktop.done')
            : state === 'declined' ? said('linkDesktop.declined')
              : state === 'expired' ? said('linkDesktop.expired')
                : signedIn === false ? (
                  <>
                    {said('linkDesktop.signInFirst')}
                    <button type="button" onClick={signIn} className={`${button} w-full mt-6 bg-nier-bg text-nier-black hover:bg-nier-strong`}>{t('linkDesktop.signIn')}</button>
                  </>
                ) : signedIn && (
                  <>
                    <p className="text-nier-bg/80 text-[0.85rem] leading-relaxed tracking-wide mb-4">
                      <RichText text={t('linkDesktop.ask', { name: username || '' })} />
                    </p>
                    <div className="border border-nier-border/40 bg-nier-border/10 px-4 py-5 text-center mb-3">
                      <p className="text-nier-strong text-2xl tracking-[0.4em]">{code.slice(0, 4)}-{code.slice(4)}</p>
                    </div>
                    <p className="text-nier-bg/60 text-[0.75rem] leading-relaxed tracking-wide mb-6">{t('linkDesktop.warning')}</p>
                    {state === 'failed' && <p className="text-red-300/90 text-[0.75rem] tracking-wide mb-4">{t('linkDesktop.failed')}</p>}
                    <div className="flex gap-3">
                      <button type="button" disabled={state === 'busy'} onClick={() => void approve()} className={`${button} bg-nier-bg text-nier-black hover:bg-nier-strong`}>{t('linkDesktop.approve')}</button>
                      <button type="button" disabled={state === 'busy'} onClick={() => setState('declined')} className={`${button} border border-nier-border/40 text-nier-bg/80 hover:border-nier-border/70 hover:text-nier-strong`}>{t('linkDesktop.notNow')}</button>
                    </div>
                  </>
                )}
      </div>
    </div>
  )
}

/** Where a sign-in asked for elsewhere (this page) goes back to, once:
 *  taken, so it's followed only the once. Null for the usual place. */
export function afterSignIn(): string | null {
  try {
    const to = sessionStorage.getItem(AFTER_SIGN_IN)
    sessionStorage.removeItem(AFTER_SIGN_IN)
    return to
  } catch {
    return null
  }
}
