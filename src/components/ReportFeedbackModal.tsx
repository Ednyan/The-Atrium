import { useState } from 'react'
import { isDesktop } from '../lib/supabase'
import { sendFeedbackReport, canSendFeedbackDirectly } from '../lib/feedback'
import { useTranslation } from '../lib/i18n'

const SUPPORT_EMAIL = 'thedigitalatrium@gmail.com'

interface ReportFeedbackModalProps {
  onClose: () => void
  username?: string
  atriumName?: string
}

// Report a problem / suggest a feature -- tries to send directly via the
// send-feedback Edge Function (so the user never leaves the page); falls
// back to a mailto: link (opens the user's own mail client, subject/body
// pre-filled) if direct sending isn't available on this platform (desktop)
// or the call fails for any reason (e.g. the Resend API key isn't
// configured yet), so the feature never fully breaks. Shared between the
// in-atrium HUD menu and the Atrium Browser.
export function ReportFeedbackModal({ onClose, username, atriumName }: ReportFeedbackModalProps) {
  const { t } = useTranslation()
  const [reportMotive, setReportMotive] = useState<'bug' | 'feature' | 'other'>('bug')
  const [reportSubject, setReportSubject] = useState('')
  const [reportDescription, setReportDescription] = useState('')
  const [isSendingReport, setIsSendingReport] = useState(false)
  const [reportSentMessage, setReportSentMessage] = useState<string | null>(null)

  return (
    <div
      className="fixed inset-0 bg-nier-black/70 flex items-center justify-center z-[10000200] pointer-events-auto"
      onClick={() => { if (!isSendingReport) onClose() }}
    >
      <div
        className="bg-nier-black border-2 border-nier-bg p-5 w-full max-w-sm relative mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-nier-bg pointer-events-none" />
        <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-nier-bg pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-nier-bg pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-nier-bg pointer-events-none" />

        <h3 className="text-nier-strong font-mono text-sm tracking-[0.15em] uppercase mb-4">
          <span className="text-nier-bg/70 mr-2">◇</span>{t('report.title')}
        </h3>

        {reportSentMessage ? (
          <p className="text-nier-bg/80 text-xs tracking-wider text-center py-4">{reportSentMessage}</p>
        ) : (
          <>
            <label className="block text-nier-bg/70 text-xs tracking-[0.15em] uppercase mb-1.5">{t('report.motive')}</label>
            <select
              value={reportMotive}
              onChange={(e) => setReportMotive(e.target.value as 'bug' | 'feature' | 'other')}
              disabled={isSendingReport}
              className="w-full bg-nier-black border border-nier-border/40 text-nier-strong text-xs px-3 py-2 mb-3 focus:border-nier-bg focus:outline-none tracking-wider disabled:opacity-50"
            >
              <option value="bug">{t('report.motiveBug')}</option>
              <option value="feature">{t('report.motiveFeature')}</option>
              <option value="other">{t('report.motiveOther')}</option>
            </select>

            <label className="block text-nier-bg/70 text-xs tracking-[0.15em] uppercase mb-1.5">{t('report.subject')}</label>
            <input
              type="text"
              value={reportSubject}
              onChange={(e) => setReportSubject(e.target.value)}
              disabled={isSendingReport}
              placeholder={t('report.subjectPlaceholder')}
              maxLength={100}
              className="w-full bg-nier-black border border-nier-border/40 text-nier-strong text-xs px-3 py-2 mb-3 focus:border-nier-bg focus:outline-none tracking-wider disabled:opacity-50"
            />

            <label className="block text-nier-bg/70 text-xs tracking-[0.15em] uppercase mb-1.5">{t('report.description')}</label>
            <textarea
              autoFocus
              value={reportDescription}
              onChange={(e) => setReportDescription(e.target.value)}
              rows={5}
              disabled={isSendingReport}
              placeholder={reportMotive === 'feature' ? t('report.descriptionPlaceholderFeature') : t('report.descriptionPlaceholderBug')}
              className="w-full bg-nier-black border border-nier-border/40 text-nier-strong text-xs px-3 py-2 mb-4 focus:border-nier-bg focus:outline-none tracking-wider resize-none disabled:opacity-50"
            />

            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!reportDescription.trim() || isSendingReport) return

                  const motiveLabel = reportMotive === 'bug' ? 'Bug Report' : reportMotive === 'feature' ? 'Feature Suggestion' : 'Other'
                  const emailSubjectLine = reportSubject.trim() ? `${motiveLabel} - ${reportSubject.trim()}` : motiveLabel

                  if (canSendFeedbackDirectly()) {
                    setIsSendingReport(true)
                    const result = await sendFeedbackReport({
                      motive: reportMotive,
                      subject: reportSubject.trim(),
                      description: reportDescription.trim(),
                      username,
                      atriumName: atriumName ?? 'Atrium Browser',
                    })
                    setIsSendingReport(false)
                    if (result.success) {
                      setReportSentMessage(t('report.sent'))
                      setTimeout(() => {
                        onClose()
                      }, 1500)
                      return
                    }
                    // Fall through to the mailto: fallback below.
                  }

                  const subject = encodeURIComponent(emailSubjectLine)
                  const bodyLines = [
                    reportDescription.trim(),
                    '',
                    '---',
                    `Motive: ${motiveLabel}`,
                    `User: ${username || 'Unknown'}`,
                    `Atrium: ${atriumName ?? 'Atrium Browser'}`,
                    `Platform: ${isDesktop ? 'Desktop' : 'Web'}`,
                  ]
                  const body = encodeURIComponent(bodyLines.join('\n'))
                  window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
                  onClose()
                }}
                disabled={!reportDescription.trim() || isSendingReport}
                className="flex-1 bg-white hover:bg-nier-bg text-black py-1.5 text-xs tracking-wider uppercase transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isSendingReport ? t('report.sending') : canSendFeedbackDirectly() ? t('report.send') : t('report.openEmail')}
              </button>
              <button
                onClick={onClose}
                disabled={isSendingReport}
                className="flex-1 border border-nier-border/40 hover:border-nier-bg text-nier-strong py-1.5 text-xs tracking-wider uppercase transition-colors disabled:opacity-30"
              >
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
