import { useEffect, useState } from 'react'
import { DRIVE_CONNECTION_EVENT, disconnectDrive, hasDriveToken } from '../lib/drive'
import { ensureSignedIn } from '../lib/driveSync'
import { useTranslation } from '../lib/i18n'

/** Whether Google Drive is connected for this account, with the way to
 *  connect it (Google's window, on the click) or give it back -- everywhere,
 *  as Google forgets this app's access (lib/drive, disconnectDrive). A Drive
 *  atrium asks for it again when it's opened. */
export default function DriveConnection({ buttonClass }: { buttonClass: string }) {
  const { t } = useTranslation()
  const [connected, setConnected] = useState(hasDriveToken)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  useEffect(() => {
    const look = () => setConnected(hasDriveToken())
    window.addEventListener(DRIVE_CONNECTION_EVENT, look)
    return () => window.removeEventListener(DRIVE_CONNECTION_EVENT, look)
  }, [])
  const act = async (task: () => Promise<unknown>) => {
    setBusy(true)
    setNote('')
    try {
      await task()
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      setConnected(hasDriveToken())
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase">◇ {t(connected ? 'browser.drive.connected' : 'browser.drive.notConnected')}</span>
      <button disabled={busy} onClick={() => void act(connected ? disconnectDrive : ensureSignedIn)} className={buttonClass}>
        {t(connected ? 'browser.drive.disconnect' : 'browser.drive.connect')}
      </button>
      {note && <p role="alert" className="w-full text-nier-bg/70 text-[11px]">{note}</p>}
    </div>
  )
}
