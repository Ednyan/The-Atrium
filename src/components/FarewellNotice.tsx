import { useEffect, useState } from 'react'
import { takeFarewell } from '../lib/account'
import { useTranslation } from '../lib/i18n'
import NoticeCard from './NoticeCard'

/** After an account's deletion, wherever the page landed: that it's gone,
 *  and thanks (lib/account keeps it across the reload that follows). Said
 *  once. Mounted beside App (main.tsx), which has no one place every page
 *  passes through. Taken in an effect that only ever shows it: StrictMode's
 *  second run finds it already taken, and leaves it shown. */
export default function FarewellNotice() {
  const { t } = useTranslation()
  const [due, setDue] = useState(false)
  useEffect(() => { if (takeFarewell()) setDue(true) }, [])
  if (!due) return null
  return (
    <NoticeCard title={t('farewell.title')} onDismiss={() => setDue(false)}>
      <p className="text-nier-bg/80 text-xs font-mono tracking-wider text-center mb-6 leading-relaxed">{t('farewell.body')}</p>
    </NoticeCard>
  )
}
