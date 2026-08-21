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

import { useTranslation } from '../lib/i18n'
import RichText from './RichText'
import ConnectTiles from './ConnectTiles'

export default function SupportCreatorCard() {
  const { t } = useTranslation()

  return (
    <div className="donate-card-left support-card bg-nier-blackLight border p-6 w-full lg:max-w-md relative max-h-[85vh] overflow-y-auto flex flex-col">
      <div className="corner absolute top-0 left-0 w-4 h-4 border-l border-t" />
      <div className="corner absolute top-0 right-0 w-4 h-4 border-r border-t" />
      <div className="corner absolute bottom-0 left-0 w-4 h-4 border-l border-b" />
      <div className="corner absolute bottom-0 right-0 w-4 h-4 border-r border-b" />

      <div className="flex items-center gap-3 mb-5">
        <div className="byline-mark w-2 h-2 rotate-45" />
        <h3 className="support-orange tracking-[0.15em] uppercase">{t('support.title')}</h3>
        <div className="support-rule flex-1 h-px" />
      </div>

      {/* Three paragraphs of even grey is a wall, and a wall gets skimmed.
          The first line is a size up because it is the one that has to be
          read, an orange rule runs down the side so the block reads as
          somebody talking rather than as body copy, and the phrases that
          carry the point are in the app's orange -- marked inside the strings
          themselves, so a translator can move the emphasis to whatever their
          own sentence leans on. */}
      <div className="flex-1 flex flex-col justify-center border-l-2 pl-5 py-1 space-y-4"
           style={{ borderColor: 'rgb(var(--c-orange) / 0.45)' }}>
        <p className="text-nier-bg/85 text-base tracking-wide leading-relaxed">
          <RichText text={t('support.who')} />
        </p>
        <p className="text-nier-bg/75 text-sm tracking-wide leading-relaxed">
          <RichText text={t('support.costs')} />
        </p>
        <p className="text-nier-bg/75 text-sm tracking-wide leading-relaxed">
          <RichText text={t('support.ask')} />
        </p>
      </div>

      <div className="flex items-center gap-3 mb-3 mt-8">
        <span className="support-orange text-[11px] tracking-[0.22em] uppercase whitespace-nowrap">
          {t('support.connect')}
        </span>
        <div className="support-rule flex-1 h-px" />
      </div>

      <ConnectTiles />
    </div>
  )
}
