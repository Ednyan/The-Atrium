import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { addPerson, driveMembers, ensureSignedIn, inviteLink, removePerson, resendInvitation, setRole } from '../lib/driveSync'
import type { Role, Roster } from '../lib/driveFormat'

// A Drive atrium's sharing, on its card in the atrium browser: its invite link
// -- which lets in only those added -- and its members. Its owner and admins
// add people by username, set their roles, and remove or block them; only
// the owner makes admins (lib/driveSync).
type Assignable = Exclude<Role, 'owner'>
const FIELD = 'bg-nier-blackLight border border-nier-border/30 text-nier-bg px-2 py-1 text-xs'
const LABEL = 'block text-nier-bg/70 text-[11px] tracking-[0.12em] uppercase mb-1'

export default function DriveMembers({ lobbyId, me, buttonClass }: { lobbyId: string; me: string; buttonClass: string }) {
  const { t } = useTranslation()
  const [roster, setRoster] = useState<Roster | null>(null)
  const [myRole, setMyRole] = useState<Role | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [newRole, setNewRole] = useState<Assignable>('editor')
  // Making someone admin: their Google address, to share the member list with.
  const [adminFor, setAdminFor] = useState<string | null>(null)
  const [adminEmail, setAdminEmail] = useState('')

  const load = () => driveMembers(lobbyId, me).then(found => { setRoster(found.roster); setMyRole(found.role) })
  useEffect(() => { load().catch(error => setNote(explain(error))) }, [lobbyId])

  const explain = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    const known: Record<string, string> = {
      NO_SUCH_USER: t('browser.drive.noSuchUser'),
      BLOCKED: t('browser.drive.isBlocked'),
      OWNER_ONLY: t('browser.drive.ownerOnly'),
      DB_UPDATE_NEEDED: t('browser.drive.dbUpdate'),
      PICK_CANCELLED: t('browser.drive.pickCancelled'),
    }
    // Google's robot check, whose page a browser can't read.
    if (/Failed to fetch|NetworkError|Load failed/.test(message)) return t('browser.drive.googleBusy')
    return known[message] ?? message
  }
  // Each change: Google's window first, while the click still counts.
  const act = async (task: () => Promise<string | void>) => {
    setBusy(true)
    setNote('')
    try {
      await ensureSignedIn()
      const said = await task()
      if (said) setNote(said)
      await load()
    } catch (error) {
      setNote(explain(error))
    } finally {
      setBusy(false)
    }
  }

  const managing = myRole === 'owner' || myRole === 'admin'
  // The owner and admins manage others -- an admin, only the owner.
  const canChange = (role: Role, user: string) => managing && role !== 'owner' && user !== me && (role !== 'admin' || myRole === 'owner')
  const link = inviteLink(lobbyId) ?? ''

  return (
    <div className="border-t border-nier-border/20 pt-3 space-y-3">
      <div>
        <label className={LABEL}>{t('browser.drive.inviteLink')}</label>
        <div className="flex gap-2">
          <input readOnly value={link} onFocus={e => e.target.select()} className={`flex-1 min-w-0 ${FIELD} text-[11px]`} />
          <button onClick={() => void navigator.clipboard.writeText(link).then(() => setNote(t('browser.drive.copied')))} className={buttonClass}>{t('browser.drive.copyLink')}</button>
        </div>
      </div>

      {roster && (
        <div>
          <label className={LABEL}>{t('browser.drive.members')}</label>
          <ul className="space-y-1.5">
            {roster.members.map(member => (
              <li key={member.user} className="flex flex-wrap items-center gap-2 text-xs text-nier-bg/85">
                <span className="flex-1 min-w-[6rem] truncate">{member.name}{member.user === me ? ` (${t('browser.drive.you')})` : ''}</span>
                {canChange(member.role, member.user) ? (
                  <>
                    <select
                      value={member.role}
                      disabled={busy}
                      onChange={e => {
                        const role = e.target.value as Assignable
                        if (role === 'admin') { setAdminFor(member.user); setAdminEmail('') }
                        else void act(() => setRole(lobbyId, me, member.user, role))
                      }}
                      className={FIELD}
                    >
                      {myRole === 'owner' && <option value="admin">{t('browser.drive.role.admin')}</option>}
                      <option value="editor">{t('browser.drive.role.editor')}</option>
                      <option value="viewer">{t('browser.drive.role.viewer')}</option>
                    </select>
                    <button disabled={busy} onClick={() => void act(() => removePerson(lobbyId, me, member.user, false))} className={buttonClass}>{t('browser.drive.remove')}</button>
                    <button disabled={busy} onClick={() => void act(() => removePerson(lobbyId, me, member.user, true))} className={buttonClass}>{t('browser.drive.block')}</button>
                  </>
                ) : (
                  <span className="text-nier-bg/60 uppercase tracking-wider text-[10px]">{t(`browser.drive.role.${member.role}`)}</span>
                )}
                {adminFor === member.user && (
                  <div className="w-full flex gap-2">
                    <input value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder={t('browser.drive.adminEmail')} className={`flex-1 min-w-0 ${FIELD}`} />
                    <button
                      disabled={busy || !adminEmail.includes('@')}
                      onClick={() => void act(async () => { await setRole(lobbyId, me, member.user, 'admin', adminEmail.trim()); setAdminFor(null) })}
                      className={buttonClass}
                    >
                      {t('browser.drive.makeAdmin')}
                    </button>
                    <button onClick={() => setAdminFor(null)} className={buttonClass}>{t('common.cancel')}</button>
                  </div>
                )}
              </li>
            ))}
            {roster.invited.map(invite => (
              <li key={invite.user} className="flex flex-wrap items-center gap-2 text-xs text-nier-bg/70">
                <span className="flex-1 min-w-[6rem] truncate">{invite.name}</span>
                <span className="uppercase tracking-wider text-[10px]">{t('browser.drive.invitedTag')} · {t(`browser.drive.role.${invite.role}`)}</span>
                {managing && (
                  <>
                    <button disabled={busy} onClick={() => void act(async () => t((await resendInvitation(lobbyId, me, invite.user)) === 'in' ? 'browser.drive.added' : 'browser.drive.invited', { name: invite.name }))} className={buttonClass}>{t('browser.drive.resend')}</button>
                    <button disabled={busy} onClick={() => void act(() => removePerson(lobbyId, me, invite.user, false))} className={buttonClass}>{t('browser.drive.remove')}</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {managing && (
        <div>
          <label className={LABEL}>{t('browser.drive.addPerson')}</label>
          <div className="flex flex-wrap gap-2">
            <input value={username} onChange={e => setUsername(e.target.value)} placeholder="username" className={`flex-1 min-w-[8rem] ${FIELD}`} />
            <select value={newRole} onChange={e => setNewRole(e.target.value as Assignable)} className={FIELD}>
              <option value="editor">{t('browser.drive.role.editor')}</option>
              <option value="viewer">{t('browser.drive.role.viewer')}</option>
            </select>
            <button
              disabled={busy || !username.trim()}
              onClick={() => void act(async () => {
                const name = username.trim()
                const result = await addPerson(lobbyId, me, name, newRole)
                setUsername('')
                return t(result === 'in' ? 'browser.drive.added' : 'browser.drive.invited', { name })
              })}
              className={buttonClass}
            >
              {t('browser.drive.add')}
            </button>
          </div>
        </div>
      )}

      {note && <p className="text-nier-bg/75 text-[11px] leading-relaxed">{note}</p>}
    </div>
  )
}
