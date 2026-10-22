import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { banAccount, listBans, unbanAccount, type Ban } from '../lib/bans'

const FIELD = 'bg-nier-blackLight border border-nier-border/30 text-nier-bg px-3 py-2 text-xs'
const BUTTON = 'px-3 py-2 border border-nier-border/40 text-nier-bg text-[11px] tracking-[0.15em] uppercase hover:border-nier-border/80 transition-colors disabled:opacity-40'

/** The Developers page's bans (lib/bans): an account banned by its username,
 *  with a reason; the list, and each unbanned. */
export default function BansTool() {
  const { t, language } = useTranslation()
  const [bans, setBans] = useState<Ban[] | null>(null)
  const [username, setUsername] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const load = () => listBans().then(setBans).catch(error => setNote(error instanceof Error ? error.message : String(error)))
  useEffect(() => { void load() }, [])
  const act = async (task: () => Promise<void>, done: string) => {
    setBusy(true)
    setNote('')
    try {
      await task()
      setNote(done)
      await load()
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder={t('developers.banUsername')} className={`min-w-[10rem] ${FIELD}`} />
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder={t('developers.banReason')} className={`flex-1 min-w-[12rem] ${FIELD}`} />
        <button
          disabled={busy || !username.trim()}
          onClick={() => void act(async () => { await banAccount(username.trim(), reason.trim()); setUsername(''); setReason('') }, t('developers.bannedNow', { username: username.trim() }))}
          className={BUTTON}
        >
          {t('developers.ban')}
        </button>
      </div>
      {note && <p role="status" className="text-nier-bg/75 text-xs">{note}</p>}
      {bans && (bans.length === 0 ? (
        <p className="text-nier-bg/60 text-xs">{t('developers.bansNone')}</p>
      ) : (
        <ul className="space-y-2">
          {bans.map(ban => (
            <li key={ban.account} className="flex flex-wrap items-center gap-3 border border-nier-border/20 px-3 py-2 text-xs">
              <span className="text-nier-strong">{ban.username ?? ban.account}</span>
              <span className="text-nier-bg/60">{new Date(ban.at).toLocaleDateString(language)}</span>
              <span className="flex-1 min-w-[8rem] text-nier-bg/75">{ban.reason}</span>
              <button disabled={busy} onClick={() => void act(() => unbanAccount(ban), t('developers.unbannedNow', { username: ban.username ?? ban.account }))} className={BUTTON}>
                {t('developers.unban')}
              </button>
            </li>
          ))}
        </ul>
      ))}
    </section>
  )
}
