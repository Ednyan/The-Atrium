import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import type { TranslationKey } from '../locales/en'
import { deleteFeedback, listFeedback, setFeedbackHandled, type FeedbackEntry } from '../lib/feedback'

const BUTTON = 'px-3 py-1.5 border border-nier-border/40 text-nier-bg text-[11px] tracking-[0.15em] uppercase hover:border-nier-border/80 transition-colors disabled:opacity-40'
const MOTIVE: Record<FeedbackEntry['motive'], TranslationKey> = {
  bug: 'report.motiveBug',
  feature: 'report.motiveFeature',
  other: 'report.motiveOther',
}

/** The Developers page's reports and suggestions (lib/feedback), newest first:
 *  read only as it opens, nothing asked meanwhile. Each marked handled or
 *  open, deleted, or answered where the sender's address is known. */
export default function FeedbackTool() {
  const { t, language } = useTranslation()
  const [entries, setEntries] = useState<FeedbackEntry[] | null>(null)
  const [note, setNote] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const failed = (error: unknown) => setNote(error instanceof Error ? error.message : String(error))
  useEffect(() => { listFeedback().then(setEntries).catch(failed) }, [])
  const setHandled = (entry: FeedbackEntry) => {
    const handled = !entry.handled
    setFeedbackHandled(entry.id, handled)
      .then(() => setEntries(all => all && all.map(e => (e.id === entry.id ? { ...e, handled: handled ? 1 : 0 } : e))))
      .catch(failed)
  }
  const remove = (id: string) => {
    deleteFeedback(id)
      .then(() => setEntries(all => all && all.filter(e => e.id !== id)))
      .catch(failed)
    setDeleting(null)
  }
  return (
    <section data-feedback-tool="" className="space-y-3">
      {note && <p role="status" className="text-nier-bg/75 text-xs">{note}</p>}
      {entries?.length === 0 && <p className="text-nier-bg/60 text-xs">{t('feedback.none')}</p>}
      {entries?.map(entry => (
        <article key={entry.id} data-feedback-entry={entry.id} className={`border border-nier-border/20 p-4 text-xs space-y-2 ${entry.handled ? 'opacity-50' : ''}`}>
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-nier-strong tracking-[0.1em] uppercase">{t(MOTIVE[entry.motive])}</span>
            {entry.subject && <span className="text-nier-strong">{entry.subject}</span>}
            <span className="ml-auto text-nier-bg/60">{new Date(entry.at).toLocaleString(language)}</span>
          </header>
          <p className="text-nier-bg/85 leading-relaxed whitespace-pre-wrap break-words">{entry.description}</p>
          <p className="text-nier-bg/55">{[entry.username || t('feedback.unknown'), entry.atrium, entry.platform].filter(Boolean).join(' · ')}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {entry.reply_to && (
              <a href={`mailto:${entry.reply_to}?subject=${encodeURIComponent(`Re: ${entry.subject || t(MOTIVE[entry.motive])}`)}`} className={BUTTON}>{t('feedback.reply')}</a>
            )}
            <button type="button" data-feedback-handled="" onClick={() => setHandled(entry)} className={BUTTON}>
              {t(entry.handled ? 'feedback.markOpen' : 'feedback.markHandled')}
            </button>
            <button type="button" data-feedback-delete="" onClick={() => (deleting === entry.id ? remove(entry.id) : setDeleting(entry.id))} className={BUTTON}>
              {t(deleting === entry.id ? 'common.confirm' : 'common.delete')}
            </button>
          </div>
        </article>
      ))}
    </section>
  )
}
