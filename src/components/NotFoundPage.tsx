// What an address that isn't a page shows (App, parseRoute): said plainly,
// with the way back. The server answers every path with the app
// (public/_redirects), so it can't say 404 itself -- the page tells search
// engines not to keep it instead, which is what they ask of a single-page app.

import { useEffect } from 'react'
import Atmosphere from './Atmosphere'
import { DONATE_CUT } from './DonateButton'
import { useTranslation } from '../lib/i18n'
import { useLandingTheme } from '../lib/useLandingTheme'

export default function NotFoundPage({ onHome, onAtriums }: { onHome: () => void; onAtriums: () => void }) {
  const { t } = useTranslation()
  const theme = useLandingTheme()
  useEffect(() => {
    const robots = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex' })
    document.head.appendChild(robots)
    const title = document.title
    document.title = `Digital Atrium — ${t('notFound.title')}`
    return () => { robots.remove(); document.title = title }
  }, [t])
  return (
    <main data-landing-theme={theme.resolved} className="screen-rise fixed inset-0 flex items-center justify-center px-6 text-nier-bg font-mono" style={{ backgroundColor: 'rgb(var(--c-ground))' }}>
      <Atmosphere />
      <div className="relative text-center max-w-md">
        <p className="text-nier-bg/50 text-xs tracking-[0.35em] mb-5">◇ 404</p>
        <h1 className="text-nier-strong text-2xl sm:text-3xl tracking-[0.2em] uppercase mb-5">{t('notFound.title')}</h1>
        <p className="text-nier-bg/75 text-sm leading-relaxed mb-10">{t('notFound.body')}</p>
        <div className="flex flex-wrap items-center justify-center gap-6">
          <button type="button" onClick={onHome} className="landing-cta px-8 py-3 text-xs tracking-[0.2em] uppercase" style={{ clipPath: DONATE_CUT }}>{t('notFound.home')}</button>
          <button type="button" onClick={onAtriums} className="landing-link text-xs tracking-[0.18em] uppercase">{t('browser.title')} <span aria-hidden="true">→</span></button>
        </div>
      </div>
    </main>
  )
}
