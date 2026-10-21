import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { letInAsker, putOffAsker, reconnectDrive, watchDriveStatus, type DriveStatus as Status } from '../lib/driveSync'
import { showToast } from '../lib/toast'

// Inside a Drive atrium, what it's doing that matters to whoever's in it
// (lib/driveSync): bringing saves in from Drive -- an atrium just joined is
// empty until then -- or, its Google sign-in gone (it lasts an hour, and not
// past the page), a button, since Google's window needs a click to open.
// Saves wait in the browser meanwhile, and go up after. And, to its owner
// and admins, whoever asks to be let in.
export default function DriveStatus() {
  const [status, setStatus] = useState<Status>({ catchingUp: false, signInNeeded: false, asking: [] })
  useEffect(() => watchDriveStatus(setStatus), [])
  return (
    <div className="fixed bottom-8 right-8 z-[500] flex flex-col items-end gap-2">
      <Asking status={status} />
      <Doing status={status} />
    </div>
  )
}

const BUTTON = 'px-3 py-1.5 border border-nier-border/50 text-nier-bg text-[10px] tracking-[0.12em] uppercase hover:border-nier-bg transition-colors disabled:opacity-40'

function Asking({ status }: { status: Status }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<string | null>(null)
  const letIn = async (user: string) => {
    setBusy(user)
    try {
      // Signed in first (lib/driveSync), while the click counts: the member list is written.
      await letInAsker(user)
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      {status.asking.map(asker => (
        <div key={asker.user} className="max-w-xs px-4 py-3 bg-nier-blackLight border border-nier-border/60" role="alert">
          <p className="text-nier-bg text-xs leading-relaxed mb-2">◇ {t('atrium.drive.asks', { name: asker.name })}</p>
          <div className="flex gap-2">
            <button disabled={busy === asker.user} onClick={() => void letIn(asker.user)} className={BUTTON}>{t('atrium.drive.letIn')}</button>
            <button disabled={busy === asker.user} onClick={() => putOffAsker(asker.user)} className={BUTTON}>{t('atrium.drive.notNow')}</button>
          </div>
        </div>
      ))}
    </>
  )
}

function Doing({ status }: { status: Status }) {
  const { t } = useTranslation()
  // Over for this member: the atrium leaves, saying why (LobbyScene, App's KickedNotice).
  if (status.ended) return null
  if (status.signInNeeded) {
    return (
      <button
        onClick={() => void reconnectDrive().catch(error => showToast(error instanceof Error ? error.message : String(error)))}
        className="px-4 py-3 bg-nier-blackLight border border-nier-border/60 text-nier-bg text-xs tracking-[0.12em] uppercase hover:border-nier-bg transition-colors"
      >
        ◇ {t('atrium.drive.reconnect')}
      </button>
    )
  }
  if (!status.catchingUp) return null
  return (
    <div className="px-4 py-3 bg-nier-blackLight border border-nier-border/40 pointer-events-none" role="status">
      <p className="text-nier-bg text-xs tracking-[0.12em] uppercase mb-2">◇ {t('atrium.drive.catchingUp')}</p>
      <div className="w-48 h-[3px] bg-nier-bg/15 overflow-hidden">
        <div className="h-full bg-nier-bg/80 animate-nier-slide" />
      </div>
    </div>
  )
}
