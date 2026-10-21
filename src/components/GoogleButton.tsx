import { useEffect, useRef } from 'react'
import { useTranslation } from '../lib/i18n'

/** Google's own "Continue with Google" button (lib/drive), drawn by Google in
 *  the page's language: one click, and its ID token to `onCredential` --
 *  signing in, or confirming it's really them (deleting a Google account:
 *  `hint`, its address, so it's that Google account and no other). Covered
 *  while `busy`. */
export default function GoogleButton({ busy, onCredential, hint }: { busy: boolean; onCredential: (idToken: string) => void; hint?: string }) {
  const { language } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(onCredential)
  latest.current = onCredential
  useEffect(() => {
    const at = box.current
    if (!at) return
    void import('../lib/drive')
      .then(drive => drive.renderGoogleButton(at, language, idToken => latest.current(idToken), hint))
      .catch(error => console.warn('[atrium] the Google button:', error))
  }, [language, hint])
  return (
    <div aria-busy={busy} className={`w-full flex justify-center min-h-[44px] ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
      <div ref={box} className="w-full flex justify-center" />
    </div>
  )
}
