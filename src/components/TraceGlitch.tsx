// A trace whose content won't come -- a picture or file that failed, a vault
// file that's gone, a link that can't be framed -- shown as a broken signal
// rather than an empty box: ERROR, torn into red and cyan and shifting, over
// scanlines and a band of interference rolling down, and under it why. Sized
// by the trace (container units), so it reads at any size; still for anyone
// who has asked for less motion (index.css .trace-glitch).

import type { ReactNode } from 'react'
import { useTranslation } from '../lib/i18n'

export default function TraceGlitch({ reason, children }: {
  // What went wrong, in a few words.
  reason: string
  // Something to do about it: a link to the source, say.
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const word = t('atrium.error.word')
  return (
    <div className="trace-glitch" data-trace-error="" role="img" aria-label={`${word}: ${reason}`}>
      <span className="trace-glitch-word" data-text={word} aria-hidden="true">{word}</span>
      <span className="trace-glitch-reason" aria-hidden="true">{reason}</span>
      {children}
    </div>
  )
}
