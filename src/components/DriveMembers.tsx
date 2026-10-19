import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { addPerson, driveMembers, ensureSignedIn, findDeletions, inviteLink, makePrivate, makePublic, removePerson, resendInvitation, restoreDeletions, setRole, type Deletion } from '../lib/driveSync'
import type { Clock, Role, Roster } from '../lib/driveFormat'

// A Drive atrium's sharing, on its card in the atrium browser: its invite link
// -- which lets in only those added -- and its members. Its owner and admins
// add people by username, set their roles, and remove or block them; only
// the owner makes admins (lib/driveSync). They also bring back what was
// deleted, while the atrium's saves in Drive still hold it. Its owner makes
// it public, for anyone to look at -- asked first -- and private again.
type Assignable = Exclude<Role, 'owner'>
const FIELD = 'bg-nier-blackLight border border-nier-border/30 text-nier-bg px-2 py-1 text-xs'
const LABEL = 'block text-nier-bg/70 text-[11px] tracking-[0.12em] uppercase mb-1'

export default function DriveMembers({ lobbyId, me, buttonClass }: { lobbyId: string; me: string; buttonClass: string }) {
  const { t, language } = useTranslation()
  const [roster, setRoster] = useState<Roster | null>(null)
  // Deletions that can be brought back, once looked for (every save is read).
  const [deletions, setDeletions] = useState<Deletion[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [myRole, setMyRole] = useState<Role | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [newRole, setNewRole] = useState<Assignable>('editor')
  // Making someone admin: their Google address, to share the member list with.
  const [adminFor, setAdminFor] = useState<string | null>(null)
  const [adminEmail, setAdminEmail] = useState('')
  const [askingPublic, setAskingPublic] = useState(false)

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
  const nameOf = (user: string) => roster?.members.find(member => member.user === user)?.name
    ?? roster?.invited.find(invite => invite.user === user)?.name
    ?? t('browser.drive.deleted.someone')
  const lookForDeletions = () => act(async () => {
    setLooking(true)
    try { setDeletions(await findDeletions(lobbyId, me)) } finally { setLooking(false) }
  })
  const restore = (ats: Clock[]) => act(async () => {
    const count = await restoreDeletions(lobbyId, me, ats)
    setDeletions(shown => shown?.filter(deletion => !ats.includes(deletion.at)) ?? null)
    return t('browser.drive.deleted.restored', { count })
  })
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

      {myRole === 'owner' && roster && (
        <div>
          <label className={LABEL}>{t('browser.drive.public.title')}</label>
          <p className="text-nier-bg/70 text-[11px] leading-relaxed mb-1.5">{t(askingPublic ? 'browser.drive.public.confirm' : roster.public ? 'browser.drive.public.on' : 'browser.drive.public.off')}</p>
          <div className="flex gap-2">
            {roster.public ? (
              <button disabled={busy} onClick={() => void act(async () => { await makePrivate(lobbyId, me); return t('browser.drive.public.madePrivate') })} className={buttonClass}>{t('browser.drive.public.makePrivate')}</button>
            ) : askingPublic ? (
              <>
                <button disabled={busy} onClick={() => void act(async () => { setAskingPublic(false); await makePublic(lobbyId, me); return t('browser.drive.public.madePublic') })} className={buttonClass}>{t('browser.drive.public.makePublic')}</button>
                <button disabled={busy} onClick={() => setAskingPublic(false)} className={buttonClass}>{t('common.cancel')}</button>
              </>
            ) : (
              <button disabled={busy} onClick={() => setAskingPublic(true)} className={buttonClass}>{t('browser.drive.public.makePublic')}</button>
            )}
          </div>
        </div>
      )}

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
                      value={adminFor === member.user ? 'admin' : member.role}
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
                    <button disabled={busy} onClick={() => void act(async () => t((await resendInvitation(lobbyId, me, member.user)) === 'in' ? 'browser.drive.added' : 'browser.drive.invited', { name: member.name }))} className={buttonClass}>{t('browser.drive.resend')}</button>
                    <button disabled={busy} onClick={() => void act(() => removePerson(lobbyId, me, member.user, false))} className={buttonClass}>{t('browser.drive.remove')}</button>
                    <button disabled={busy} onClick={() => void act(() => removePerson(lobbyId, me, member.user, true))} className={buttonClass}>{t('browser.drive.block')}</button>
                  </>
                ) : (
                  <span className="text-nier-bg/60 uppercase tracking-wider text-[10px]">{t(`browser.drive.role.${member.role}`)}</span>
                )}
                {/* Admin, a step more: the Google address they use here, which
                    Drive shares the member list with -- the directory never
                    gives anyone's address away. */}
                {adminFor === member.user && (
                  <div className="w-full border border-nier-border/30 p-2 space-y-2">
                    <p className="text-nier-bg/80 text-[11px] leading-relaxed">{t('browser.drive.adminWhy', { name: member.name })}</p>
                    <div className="flex flex-wrap gap-2">
                    <input
                      autoFocus
                      type="email"
                      value={adminEmail}
                      onChange={e => setAdminEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') setAdminFor(null) }}
                      placeholder={t('browser.drive.adminEmail')}
                      className={`flex-1 min-w-[10rem] ${FIELD}`}
                    />
                    <button
                      disabled={busy || !adminEmail.includes('@')}
                      onClick={() => void act(async () => { await setRole(lobbyId, me, member.user, 'admin', adminEmail.trim()); setAdminFor(null) })}
                      className={buttonClass}
                    >
                      {t('browser.drive.makeAdmin')}
                    </button>
                    <button onClick={() => setAdminFor(null)} className={buttonClass}>{t('common.cancel')}</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {roster.invited.map(invite => (
              <li key={invite.user} className="flex flex-wrap items-center gap-2 text-xs text-nier-bg/70">
                <span className="flex-1 min-w-[6rem] truncate">{invite.name}</span>
                {/* The role they'll come in with: theirs to change as a member's (an admin's, once they're in). */}
                {managing && invite.role !== 'admin' ? (
                  <>
                    <span className="uppercase tracking-wider text-[10px]">{t('browser.drive.invitedTag')}</span>
                    <select value={invite.role} disabled={busy} onChange={e => void act(() => setRole(lobbyId, me, invite.user, e.target.value as Assignable))} className={FIELD}>
                      <option value="editor">{t('browser.drive.role.editor')}</option>
                      <option value="viewer">{t('browser.drive.role.viewer')}</option>
                    </select>
                  </>
                ) : (
                  <span className="uppercase tracking-wider text-[10px]">{t('browser.drive.invitedTag')} · {t(`browser.drive.role.${invite.role}`)}</span>
                )}
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

      {managing && (
        <div>
          <label className={LABEL}>{t('browser.drive.deleted.title')}</label>
          {deletions === null ? (
            <button disabled={busy} onClick={() => void lookForDeletions()} className={buttonClass}>
              {t(looking ? 'browser.drive.deleted.looking' : 'browser.drive.deleted.look')}
            </button>
          ) : deletions.length === 0 ? (
            <p className="text-nier-bg/60 text-[11px]">{t('browser.drive.deleted.none')}</p>
          ) : (
            <ul className="space-y-1.5">
              {deletions.map(deletion => (
                <li key={deletion.at} className="flex flex-wrap items-center gap-2 text-xs text-nier-bg/85">
                  <span className="flex-1 min-w-[10rem]">
                    {t('browser.drive.deleted.entry', { name: nameOf(deletion.by), when: new Date(deletion.when).toLocaleString(language), traces: deletion.traces, groups: deletion.groups })}
                  </span>
                  <button disabled={busy} onClick={() => void restore([deletion.at])} className={buttonClass}>{t('browser.drive.deleted.restore')}</button>
                </li>
              ))}
              {deletions.length > 1 && (
                <li><button disabled={busy} onClick={() => void restore(deletions.map(deletion => deletion.at))} className={buttonClass}>{t('browser.drive.deleted.restoreAll')}</button></li>
              )}
            </ul>
          )}
        </div>
      )}

      {note && <p className="text-nier-bg/75 text-[11px] leading-relaxed">{note}</p>}
    </div>
  )
}
