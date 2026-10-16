import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { reconnectDrive, watchDriveSignIn } from '../lib/driveSync'
import { showToast } from '../lib/toast'

// Inside a Drive atrium whose Google sign-in has run out (it lasts an hour,
// and not past the page): a button, since Google's window needs a click to
// open. Saves wait in the browser meanwhile, and go up after (lib/driveSync).
export default function DriveReconnect() {
  const { t } = useTranslation()
  const [needed, setNeeded] = useState(false)
  useEffect(() => watchDriveSignIn(setNeeded), [])
  if (!needed) return null
  return (
    <button
      onClick={() => void reconnectDrive().catch(error => showToast(error instanceof Error ? error.message : String(error)))}
      className="fixed bottom-8 right-8 z-[500] px-4 py-3 bg-nier-blackLight border border-nier-border/60 text-nier-bg text-xs tracking-[0.12em] uppercase hover:border-nier-bg transition-colors"
    >
      ◇ {t('atrium.drive.reconnect')}
    </button>
  )
}
