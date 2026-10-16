import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { reconnectDrive, watchDriveStatus, type DriveStatus as Status } from '../lib/driveSync'
import { showToast } from '../lib/toast'

// Inside a Drive atrium, what it's doing that matters to whoever's in it
// (lib/driveSync): bringing saves in from Drive -- an atrium just joined is
// empty until then -- or, its Google sign-in gone (it lasts an hour, and not
// past the page), a button, since Google's window needs a click to open.
// Saves wait in the browser meanwhile, and go up after.
export default function DriveStatus() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status>({ catchingUp: false, signInNeeded: false })
  useEffect(() => watchDriveStatus(setStatus), [])
  // Over for this member: said, and nothing more is synced (lib/driveSync).
  if (status.ended) {
    return (
      <div className="fixed bottom-8 right-8 z-[500] max-w-xs px-4 py-3 bg-nier-blackLight border border-nier-red/50" role="status">
        <p className="text-nier-bg text-xs leading-relaxed">◇ {t(status.ended === 'removed' ? 'atrium.drive.removed' : 'atrium.drive.deleted')}</p>
      </div>
    )
  }
  if (status.signInNeeded) {
    return (
      <button
        onClick={() => void reconnectDrive().catch(error => showToast(error instanceof Error ? error.message : String(error)))}
        className="fixed bottom-8 right-8 z-[500] px-4 py-3 bg-nier-blackLight border border-nier-border/60 text-nier-bg text-xs tracking-[0.12em] uppercase hover:border-nier-bg transition-colors"
      >
        ◇ {t('atrium.drive.reconnect')}
      </button>
    )
  }
  if (!status.catchingUp) return null
  return (
    <div className="fixed bottom-8 right-8 z-[500] px-4 py-3 bg-nier-blackLight border border-nier-border/40 pointer-events-none" role="status">
      <p className="text-nier-bg text-xs tracking-[0.12em] uppercase mb-2">◇ {t('atrium.drive.catchingUp')}</p>
      <div className="w-48 h-[3px] bg-nier-bg/15 overflow-hidden">
        <div className="h-full bg-nier-bg/80 animate-nier-slide" />
      </div>
    </div>
  )
}
