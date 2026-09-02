import { recordAppealResponse, type AppealResponse } from '../lib/supportAppeal'
import { useTranslation } from '../lib/i18n'

interface SupportAppealProps {
  onDonate: () => void
  onClose: () => void
  onFeedback: () => void
}

// The one time the app asks for money.
//
// Shown at launch, on the welcome screen, and never over an atrium -- being
// interrupted mid-work by a request for money is how goodwill is spent rather
// than earned. It appears only after someone has used the app enough to have
// something invested in it, and every answer buys silence: months after a
// donation, another fortnight and another twenty traces after a no.
//
// Three answers rather than two. "Not now" and "remind me later" are different
// things, and collapsing them forces anyone willing to be asked again into
// declining outright.
export default function SupportAppeal({ onDonate, onClose, onFeedback }: SupportAppealProps) {
  const { t } = useTranslation()

  const answer = (response: AppealResponse) => {
    recordAppealResponse(response)
    if (response === 'donated') onDonate()
    else onClose()
  }

  // Writing in is not declining, so it records the same fortnight of silence as
  // "remind me later" rather than the months a donation buys or the longer
  // quiet of "not now". Somebody who took the trouble to say something should
  // be asked again, just not tomorrow.
  const sendFeedback = () => {
    recordAppealResponse('remind_later')
    onFeedback()
  }

  return (
    <div className="modal-backdrop fixed inset-0 bg-nier-black/85 flex items-center justify-center z-[10000300] pointer-events-auto" data-ui-element>
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
        <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />

        <div className="flex items-center gap-3 mb-5">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h3 className="text-nier-bg tracking-[0.15em] uppercase">{t('appeal.title')}</h3>
        </div>

        {/* Every string here now comes from the catalogue, the title and the
            buttons included. Translating the paragraphs and leaving "Donate"
            and "Not now" in English would have read worse than leaving all of
            it in English. */}
        <div className="space-y-3 text-xs text-nier-bg/80 tracking-wide leading-relaxed mb-6">
          <p>{t('appeal.enjoying')}</p>
          <p>{t('appeal.reminder')}</p>
          <p>{t('appeal.credited')}</p>
          <p className="text-nier-bg/70">{t('appeal.feedback')}</p>
        </div>

        <button
          type="button"
          onClick={() => answer('donated')}
          className="cut-corner w-full inline-flex items-center justify-center h-[2.375rem] text-[11px] tracking-[0.18em] uppercase font-medium transition-transform hover:scale-[1.02] active:scale-[0.99]"
          style={{ background: '#FF8A3D', color: 'rgb(var(--c-ground))', boxShadow: '0 0 22px rgba(255,138,61,0.30)' }}
        >
          ◇ {t('appeal.donate')}
        </button>

        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={() => answer('remind_later')}
            className="cut-corner flex-1 inline-flex items-center justify-center h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 text-[11px] tracking-[0.15em] uppercase leading-none hover:border-nier-border/70 hover:text-nier-strong transition-colors"
          >
            {t('appeal.remindLater')}
          </button>
          <button
            type="button"
            onClick={() => answer('not_now')}
            className="cut-corner flex-1 inline-flex items-center justify-center h-[2.125rem] px-4 border border-nier-border/40 text-nier-bg/80 text-[11px] tracking-[0.15em] uppercase leading-none hover:border-nier-border/70 hover:text-nier-strong transition-colors"
          >
            {t('appeal.notNow')}
          </button>
        </div>

        {/* The fourth, and deliberately the quietest. The panel is built around
            three answers to one question -- give, later, no -- and this is not
            a fourth answer to it, it is the invitation in the last paragraph
            made clickable. Borderless, so the row of three above still reads as
            the choice being offered. */}
        <button
          type="button"
          onClick={sendFeedback}
          className="w-full mt-3 text-[11px] tracking-[0.15em] uppercase text-nier-bg/55 hover:text-nier-strong transition-colors"
        >
          {t('appeal.feedbackButton')} →
        </button>
      </div>
    </div>
  )
}
