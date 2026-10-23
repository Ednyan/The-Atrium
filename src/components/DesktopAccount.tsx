import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import { linkDesktop } from '../lib/emailAccount'
import { ACCOUNT_EVENT, signOutWorkerAccount, workerAccount } from '../lib/signedIn'
import RichText from './RichText'

// The desktop app's account (docs/DECENTRALIZING.md, step 8), in the atrium
// browser: signed in by the site (lib/emailAccount, linkDesktop), for the
// atriums shared with it. The vault's atriums stay the device's either way.
export default function DesktopAccount({ buttonClass }: { buttonClass: string }) {
  const { t } = useTranslation()
  const [account, setAccount] = useState(workerAccount)
  const [code, setCode] = useState<string | null>(null)
  const [note, setNote] = useState<TranslationKey | null>(null)
  const stopped = useRef(false)
  useEffect(() => {
    const changed = () => setAccount(workerAccount())
    window.addEventListener(ACCOUNT_EVENT, changed)
    return () => {
      stopped.current = true
      window.removeEventListener(ACCOUNT_EVENT, changed)
    }
  }, [])

  const signIn = async () => {
    stopped.current = false
    setNote(null)
    try {
      const shown = await linkDesktop(setCode, () => stopped.current)
      if (!shown && !stopped.current) setNote('browser.account.expired')
    } catch (error) {
      setNote((error as Error).message === 'BANNED' ? 'auth.error.banned' : 'browser.account.failed')
    } finally {
      setCode(null)
    }
  }
  const cancel = () => {
    stopped.current = true
    setCode(null)
  }

  return (
    <div className="mt-3 border border-nier-border/20 bg-nier-black/60 px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-1">{t('browser.account.title')}</div>
          <p className="text-nier-bg/70 text-xs tracking-wide">
            {account ? <RichText text={t('browser.account.signedIn', { name: account.name || account.email || '' })} /> : t('browser.account.lead')}
          </p>
          {code && (
            <div className="mt-3">
              <p className="text-nier-bg/70 text-xs tracking-wide mb-2">{t('browser.account.code')}</p>
              <p className="text-nier-strong text-xl tracking-[0.4em] select-all">{code.slice(0, 4)}-{code.slice(4)}</p>
            </div>
          )}
          {note && <p className="text-red-300/90 text-xs tracking-wide mt-2">{t(note)}</p>}
        </div>
        {account
          ? <button onClick={() => void signOutWorkerAccount()} className={buttonClass}>{t('browser.account.signOut')}</button>
          : code
            ? <button onClick={cancel} className={buttonClass}>{t('common.cancel')}</button>
            : <button onClick={() => void signIn()} className={buttonClass}>{t('browser.account.signIn')}</button>}
      </div>
    </div>
  )
}
