// The four links to the person who made this, as tiles.
//
// Third use of the same grid (the landing page's Connect band, the Support
// card, and now the welcome screen's creator panel), so it stops being copied
// and becomes a component. The labels come from the catalogue rather than the
// list, so this carries no English of its own.

import { isDesktop } from '../lib/supabase'
import { CREATOR_LINKS } from '../lib/creatorLinks'
import { useTranslation } from '../lib/i18n'
import { DONATE_CUT } from './DonateButton'

export default function ConnectTiles({ columns = 2 }: {
  // Two across in a card, four across where there is room for one row.
  columns?: 2 | 4
}) {
  const { t } = useTranslation()

  return (
    <div className={`grid gap-2 ${columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`}>
      {CREATOR_LINKS.map(link => (
        <a
          key={link.key}
          // On desktop a plain anchor would navigate the webview itself and
          // leave no way back, so the shell plugin hands it to the system
          // browser. mailto: goes the same way -- open() gives it to the mail
          // client, where a webview would simply fail.
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
  )
}
