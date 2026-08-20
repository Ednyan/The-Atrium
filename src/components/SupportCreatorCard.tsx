// The card that stands to the left of Donate.
//
// The Donate panel used to open straight onto an amount and a card field,
// which asks somebody for money before telling them who is asking or what it
// pays for. That answer lived on the front page, three sections down, and
// anybody who reached the panel from the welcome screen or from inside an
// atrium never saw it at all. It travels with the ask now.
//
// Deliberately not a second pitch. It says who, what it costs and where else
// to find him, then gets out of the way of the form beside it. What you get
// for paying -- a name on the wall -- lives on the other card, under the
// button that does the paying.

import { isDesktop } from '../lib/supabase'
import { useTranslation } from '../lib/i18n'
import { DONATE_CUT } from './DonateButton'

const LINKS = [
  { key: 'website', url: 'https://mindeformer.wixstudio.com/mindeformer' },
  { key: 'instagram', url: 'https://www.instagram.com/red.puer/' },
  { key: 'youtube', url: 'https://www.youtube.com/@mindeformer' },
  { key: 'email', url: 'mailto:thedigitalatrium@gmail.com' },
] as const

export default function SupportCreatorCard() {
  const { t } = useTranslation()

  return (
    <div className="donate-card-left support-card bg-nier-blackLight border p-6 w-full lg:max-w-md relative max-h-[85vh] overflow-y-auto">
      <div className="corner absolute top-0 left-0 w-4 h-4 border-l border-t" />
      <div className="corner absolute top-0 right-0 w-4 h-4 border-r border-t" />
      <div className="corner absolute bottom-0 left-0 w-4 h-4 border-l border-b" />
      <div className="corner absolute bottom-0 right-0 w-4 h-4 border-r border-b" />

      <div className="flex items-center gap-3 mb-5">
        <div className="byline-mark w-2 h-2 rotate-45" />
        <h3 className="support-orange tracking-[0.15em] uppercase">{t('support.title')}</h3>
        <div className="support-rule flex-1 h-px" />
      </div>

      <p className="text-nier-bg/80 text-sm tracking-wide leading-relaxed mb-4">
        {t('support.who')}
      </p>
      <p className="text-nier-bg/80 text-sm tracking-wide leading-relaxed mb-4">
        {t('support.costs')}
      </p>
      <p className="text-nier-bg/80 text-sm tracking-wide leading-relaxed mb-5">
        {t('support.ask')}
      </p>

      <div className="flex items-center gap-3 mb-3">
        <span className="support-orange text-[11px] tracking-[0.22em] uppercase whitespace-nowrap">
          {t('support.connect')}
        </span>
        <div className="support-rule flex-1 h-px" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {LINKS.map(link => (
          <a
            key={link.key}
            href={isDesktop ? '#' : link.url}
            target={isDesktop ? undefined : '_blank'}
            rel={isDesktop ? undefined : 'noopener noreferrer'}
            onClick={isDesktop ? (event) => {
              event.preventDefault()
              import('@tauri-apps/plugin-shell').then(({ open }) => open(link.url))
            } : undefined}
            className="support-tile group border border-nier-border/30 bg-nier-black/30 hover:bg-nier-black/50 px-3 py-2.5 text-left transition-colors cursor-pointer"
            style={{ clipPath: DONATE_CUT }}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-nier-strong text-[11px] tracking-[0.15em] uppercase">
                {t(`support.${link.key}` as 'support.website')}
              </span>
              <span className="text-nier-bg/40 text-[11px] transition-all duration-300 group-hover:text-nier-bg/80 group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
                ↗
              </span>
            </span>
            <span className="mt-0.5 block text-nier-bg/55 text-[0.7rem] tracking-wide">
              {t(`support.${link.key}Note` as 'support.websiteNote')}
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
