// What a screen shows while its code arrives (App's lazy screens): the ground,
// and after a moment -- a quick load shows nothing at all (index.css) -- the
// sliding bar the app's other waits use.
import { useTranslation } from '../lib/i18n'

export default function PageLoading() {
  const { t } = useTranslation()
  return (
    <div role="status" aria-label={t('common.pleaseWait')} className="fixed inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgb(var(--c-ground))' }}>
      <div className="page-loading w-48 h-[3px] bg-nier-bg/10 overflow-hidden">
        <div className="h-full bg-nier-bg/80 animate-nier-slide" />
      </div>
    </div>
  )
}
