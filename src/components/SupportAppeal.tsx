import { recordAppealResponse, type AppealResponse } from '../lib/supportAppeal'
import { useTranslation } from '../lib/i18n'

interface SupportAppealProps {
  onDonate: () => void
  onClose: () => void
  onFeedback: () => void
}

// The one time the app asks for money: a small card in the corner of the welcome
// screen, never over an atrium. Nothing behind it is dimmed or blocked, so it
// can be ignored and the screen used as if it weren't there. It appears only
// after someone has used the app enough to have something invested in it, and
// every answer buys silence (lib/supportAppeal).
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

  // Writing in is not declining: asked again later, as "remind me later" is.
  const sendFeedback = () => {
    recordAppealResponse('remind_later')
    onFeedback()
  }

  const QUIET = 'text-nier-bg/70 hover:text-nier-strong transition-colors'
  return (
    <aside
      data-support-appeal=""
      data-ui-element="true"
      aria-label={t('appeal.title')}
      className="ctx-menu fixed right-4 bottom-4 sm:right-6 sm:bottom-6 z-[10000] w-[calc(100vw-2rem)] sm:w-80 pointer-events-auto font-mono"
    >
      <div className="px-4 py-3">
        <h3 className="mb-2 text-nier-strong text-[11px] tracking-[0.15em] uppercase">{t('appeal.title')}</h3>
        <p className="text-xs text-nier-bg/80 leading-relaxed">{t('appeal.reminder')}</p>
        <div className="mt-3 flex items-center gap-4 text-[11px]">
          <button type="button" data-appeal="donate" onClick={() => answer('donated')} className="px-3 py-1.5 border border-nier-border/50 text-nier-strong hover:border-nier-bg transition-colors" style={{ color: 'rgb(var(--c-orange))' }}>
            {t('appeal.donate')}
          </button>
          <button type="button" data-appeal="later" onClick={() => answer('remind_later')} className={QUIET}>{t('appeal.remindLater')}</button>
          <button type="button" data-appeal="no" onClick={() => answer('not_now')} className={QUIET}>{t('appeal.notNow')}</button>
        </div>
        <button type="button" data-appeal="feedback" onClick={sendFeedback} className={`mt-2.5 text-[11px] ${QUIET}`}>
          {t('appeal.feedbackButton')} →
        </button>
      </div>
    </aside>
  )
}
