// About, in the desktop app: the app itself rather than the website, which is
// a page selling what's already installed. What it is, its version, where
// the tutorials will be, the controls, and who made it. From the welcome
// screen's About.

import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { isDesktop } from '../lib/supabase'
import { ControlsList } from './AtriumMenu'
import ConnectTiles from './ConnectTiles'
import RichText from './RichText'
import { openContributors } from '../lib/contributorsRoute'

const CONCEPTS = [
  { name: 'landing.about.traces', about: 'landing.about.tracesDesc' },
  { name: 'landing.about.atriums', about: 'landing.about.atriumsDesc' },
  { name: 'landing.about.presence', about: 'landing.about.presenceDesc' },
] as const

function Heading({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
      <h2 className="text-nier-strong text-xs tracking-[0.25em] uppercase">{children}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-nier-border/30 to-transparent" />
    </div>
  )
}

const HelpPanel = lazy(() => import('./HelpPanel'))

export default function AboutPage({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const [version, setVersion] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  useEffect(() => {
    if (!isDesktop) return
    import('@tauri-apps/api/app').then(({ getVersion }) => getVersion()).then(setVersion).catch(() => {})
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onBack() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onBack])

  return (
    <div data-about-page="" className="fixed inset-0 overflow-y-auto bg-nier-black text-nier-bg font-mono">
      <div className="max-w-3xl mx-auto px-5 sm:px-10 py-8">
        <button
          type="button"
          onClick={onBack}
          className="group flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-nier-bg/70 hover:text-nier-strong transition-colors"
        >
          <span className="transition-transform group-hover:-translate-x-1">←</span>
          {t('common.back')}
        </button>

        <header className="mt-10 mb-12">
          <p className="text-nier-bg/60 text-sm tracking-[0.3em] uppercase">{t('welcome.about')}</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-light tracking-[0.06em] uppercase text-nier-strong">The Digital Atrium</h1>
          {version && <p data-about-version="" className="mt-3 text-nier-bg/60 text-xs tracking-[0.2em] uppercase">{t('about.version', { version })}</p>}
        </header>

        <section className="mb-12">
          <p className="text-nier-bg/85 text-base leading-relaxed mb-6">
            <RichText text={t('landing.about.lead')} className="text-nier-strong" />
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            {CONCEPTS.map(({ name, about }) => (
              <div key={name} className="border border-nier-border/30 p-4">
                <h3 className="text-nier-strong text-xs tracking-[0.2em] uppercase mb-2">{t(name)}</h3>
                <p className="text-nier-bg/75 text-xs leading-relaxed">{t(about)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* The help's articles; the tutorials go there as they're made. */}
        <section data-about-tutorials="" className="mb-12">
          <Heading>{t('about.tutorials')}</Heading>
          <button type="button" data-about-help="" onClick={() => setShowHelp(true)} className="w-full border border-nier-border/40 hover:border-nier-bg p-5 text-center text-nier-strong text-xs tracking-[0.2em] uppercase transition-colors">
            ◇ {t('help.title')}
          </button>
        </section>

        <section className="mb-12">
          <Heading>{t('atrium.controls.title')}</Heading>
          <ControlsList />
        </section>

        <section className="mb-12">
          <Heading>{t('landing.connect')}</Heading>
          <ConnectTiles columns={4} />
          <button
            type="button"
            onClick={() => openContributors('/about')}
            className="mt-4 text-[11px] tracking-[0.2em] uppercase text-nier-bg/70 hover:text-nier-strong transition-colors"
          >
            ◇ {t('welcome.contributors')}
          </button>
        </section>
      </div>
      {showHelp && <Suspense fallback={null}><HelpPanel onClose={() => setShowHelp(false)} /></Suspense>}
    </div>
  )
}
