import { useEffect, useState } from 'react'
import { useTranslation } from '../lib/i18n'
import { addPerson, driveMembers, driveProblem, ensureSignedIn, findDeletions, isHostedAtrium, inviteLink, makePrivate, makePublic, removePerson, resendInvitation, restoreDeletions, setRole, type Deletion } from '../lib/driveSync'
import type { Clock, Member, Role, Roster } from '../lib/driveFormat'
import { Switch } from './Customization'
import { FIELD, FIELD_LABEL, Nobody, OwnerBadge, REMOVE_BUTTON, SettingsFrame, SettingsGroup, SettingsPerson, SMALL_BUTTON, type SettingsTab } from './AtriumSettingsParts'

// Atrium settings for an atrium kept in Google Drive: the same window, with
// the same two tabs, as a cloud atrium's (components/LobbyManagement) --
// filled with what its roster decides (lib/driveSync):
//
//   General  whether anyone may look at it (public: its owner's to say,
//            asked first), its invite link -- which lets in only those
//            added -- and what was deleted, brought back while its saves in
//            Drive still hold it.
//   People   who's in, and as what: the owner and the admins, the editors,
//            the viewers, and those invited and not in yet. Added by
//            username; roles changed, people removed or blocked, by the
//            owner and admins -- admins by the owner alone.
//
// Each change is made at once: there's nothing to save.
type Assignable = Exclude<Role, 'owner'>

export default function DriveSettings({ lobbyId, me, name, onRename, onClose }: {
  lobbyId: string
  me: string
  // The atrium's name, and how it's changed (LobbyScene renameAtrium).
  name: string
  onRename: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [nameDraft, setNameDraft] = useState(name)
  const { t, language } = useTranslation()
  const [tab, setTab] = useState<SettingsTab>('general')
  const [roster, setRoster] = useState<Roster | null>(null)
  const [myRole, setMyRole] = useState<Role | null>(null)
  // Deletions that can be brought back, once looked for (every save is read).
  const [deletions, setDeletions] = useState<Deletion[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [newRole, setNewRole] = useState<Assignable>('editor')
  // Making someone admin: their Google address, to share the member list with.
  const [adminFor, setAdminFor] = useState<string | null>(null)
  const [adminEmail, setAdminEmail] = useState('')
  const [askingPublic, setAskingPublic] = useState(false)

  const load = () => driveMembers(lobbyId, me).then(found => { setRoster(found.roster); setMyRole(found.role) })
  useEffect(() => { load().catch(error => setNotice({ text: explain(error), error: true })) }, [lobbyId])

  const explain = driveProblem
  // Each change: Google's window first, while the click still counts -- for
  // a hosted atrium, one's sign-in only.
  // `signIn` false for what's only the atrium's own row (its name): the sync
  // asks for Google when it needs it, not a rename.
  const act = async (task: () => Promise<string | void>, signIn = true) => {
    setBusy(true)
    setNotice(null)
    try {
      if (signIn) await ensureSignedIn(lobbyId)
      const said = await task()
      if (said) setNotice({ text: said })
      await load()
    } catch (error) {
      setNotice({ text: explain(error), error: true })
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
  const resend = (user: string, name: string) => act(async () => t((await resendInvitation(lobbyId, me, user)) === 'in' ? 'browser.drive.added' : 'browser.drive.invited', { name }))
  const shownName = (member: { user: string; name: string }) => (member.user === me ? `${member.name} (${t('browser.drive.you')})` : member.name)
  const ROLE_SELECT = 'bg-nier-black border border-nier-border/30 text-nier-bg px-2 py-1 text-xs'

  // A member, and what can be done about them: their role, their invitation
  // again, out -- or blocked. Admin is a step more in Drive (their Google
  // address); a hosted atrium shares by account, and needs none.
  const memberRow = (member: Member) => (
    <SettingsPerson
      key={member.user}
      name={shownName(member)}
      below={adminFor === member.user && (
        // The directory never gives anyone's address away: Drive shares the
        // member list with the one given here.
        <div className="mt-2 border border-nier-border/30 p-2 space-y-2">
          <p className="text-nier-bg/80 text-[11px] leading-relaxed">{t('browser.drive.adminWhy', { name: member.name })}</p>
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              type="email"
              value={adminEmail}
              onChange={e => setAdminEmail(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setAdminFor(null) }}
              placeholder={t('browser.drive.adminEmail')}
              className={`flex-1 min-w-[10rem] ${FIELD} py-1 text-xs`}
            />
            <button
              disabled={busy || !adminEmail.includes('@')}
              onClick={() => void act(async () => { await setRole(lobbyId, me, member.user, 'admin', adminEmail.trim()); setAdminFor(null) })}
              className={SMALL_BUTTON}
            >
              {t('browser.drive.makeAdmin')}
            </button>
            <button onClick={() => setAdminFor(null)} className={SMALL_BUTTON}>{t('common.cancel')}</button>
          </div>
        </div>
      )}
    >
      {canChange(member.role, member.user) ? (
        <>
          <select
            value={adminFor === member.user ? 'admin' : member.role}
            disabled={busy}
            aria-label={t('atrium.manage.addAs')}
            onChange={e => {
              const role = e.target.value as Assignable
              if (role === 'admin' && !isHostedAtrium(lobbyId)) { setAdminFor(member.user); setAdminEmail('') }
              else { setAdminFor(null); void act(() => setRole(lobbyId, me, member.user, role)) }
            }}
            className={ROLE_SELECT}
          >
            {myRole === 'owner' && <option value="admin">{t('browser.drive.role.admin')}</option>}
            <option value="editor">{t('browser.drive.role.editor')}</option>
            <option value="viewer">{t('browser.drive.role.viewer')}</option>
          </select>
          <button disabled={busy} onClick={() => void resend(member.user, member.name)} className={SMALL_BUTTON}>{t('browser.drive.resend')}</button>
          <button disabled={busy} onClick={() => void act(() => removePerson(lobbyId, me, member.user, false))} className={REMOVE_BUTTON}>{t('browser.drive.remove')}</button>
          <button disabled={busy} onClick={() => void act(() => removePerson(lobbyId, me, member.user, true))} className={REMOVE_BUTTON}>{t('browser.drive.block')}</button>
        </>
      ) : member.role === 'owner' ? <OwnerBadge /> : null}
    </SettingsPerson>
  )
  const members = (role: Role) => roster?.members.filter(member => member.role === role) ?? []
  const people = (roster?.members.length ?? 0) + (roster?.invited.length ?? 0)
  const publicSaid = roster && t(roster.public ? 'browser.drive.public.on' : 'browser.drive.public.off')

  return (
    <SettingsFrame tab={tab} onTab={setTab} people={people} notice={notice} onClose={onClose}>
      {tab === 'general' && (
        <div className="space-y-5">
          {/* Its name: changed as it's left, or on Enter -- the settings are
              the owner's and admins' alone, as is the atrium's own row. */}
          <div>
            <label htmlFor="atrium-name" className={FIELD_LABEL}>{t('atrium.manage.atriumName')}</label>
            <input
              id="atrium-name"
              type="text"
              maxLength={50}
              value={nameDraft}
              onChange={event => setNameDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
              onBlur={() => {
                const next = nameDraft.trim()
                if (!next || next === name) { setNameDraft(name); return }
                void act(async () => { await onRename(next); return t('atrium.manage.settingsSaved') }, false)
              }}
              className={`w-full ${FIELD}`}
            />
          </div>
          {/* Public: the owner's to say -- asked first, as anyone may then
              look at all of it; private again at once. */}
          {roster && (myRole === 'owner' ? (
            <div>
              <Switch
                testId="atrium-public"
                label={t('atrium.manage.public')}
                hint={publicSaid ?? undefined}
                on={!!roster.public || askingPublic}
                onChange={on => (on ? setAskingPublic(true) : askingPublic ? setAskingPublic(false) : void act(async () => { await makePrivate(lobbyId, me); return t('browser.drive.public.madePrivate') }))}
              />
              {askingPublic && (
                <div className="mt-3 border border-nier-border/30 p-3 space-y-2">
                  <p className="text-nier-bg/80 text-[11px] leading-relaxed">{t('browser.drive.public.confirm')}</p>
                  <div className="flex gap-2">
                    <button disabled={busy} onClick={() => void act(async () => { setAskingPublic(false); await makePublic(lobbyId, me); return t('browser.drive.public.madePublic') })} className={SMALL_BUTTON}>{t('browser.drive.public.makePublic')}</button>
                    <button disabled={busy} onClick={() => setAskingPublic(false)} className={SMALL_BUTTON}>{t('common.cancel')}</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <span className="block text-nier-strong text-xs tracking-[0.1em] uppercase">{t('atrium.manage.public')}</span>
              <span className="block mt-1 text-nier-bg/55 text-[0.7rem] leading-relaxed tracking-wide">{publicSaid}</span>
            </div>
          ))}

          <div>
            <label className={FIELD_LABEL}>{t('browser.drive.inviteLink')}</label>
            <div className="flex gap-2">
              <input readOnly value={link} onFocus={e => e.target.select()} className={`flex-1 min-w-0 ${FIELD} text-xs`} />
              <button onClick={() => void navigator.clipboard.writeText(link).then(() => setNotice({ text: t('browser.drive.copied') }))} className={SMALL_BUTTON}>{t('browser.drive.copyLink')}</button>
            </div>
          </div>

          {managing && (
            <div>
              <label className={FIELD_LABEL}>{t('browser.drive.deleted.title')}</label>
              {deletions === null ? (
                <button disabled={busy} onClick={() => void lookForDeletions()} className={SMALL_BUTTON}>
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
                      <button disabled={busy} onClick={() => void restore([deletion.at])} className={SMALL_BUTTON}>{t('browser.drive.deleted.restore')}</button>
                    </li>
                  ))}
                  {deletions.length > 1 && (
                    <li><button disabled={busy} onClick={() => void restore(deletions.map(deletion => deletion.at))} className={SMALL_BUTTON}>{t('browser.drive.deleted.restoreAll')}</button></li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'people' && roster && (
        <div className="space-y-6">
          {/* Someone added: by username, as what they're to be. */}
          {managing && (
            <div>
              <label className={FIELD_LABEL}>{t('atrium.manage.addUser')}</label>
              <div className="flex gap-2">
                <input value={username} onChange={e => setUsername(e.target.value)} placeholder="username" className={`min-w-0 flex-1 ${FIELD}`} />
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as Assignable)}
                  aria-label={t('atrium.manage.addAs')}
                  title={t('atrium.manage.addAs')}
                  className="shrink-0 bg-nier-black border border-nier-border/30 text-nier-bg px-2 py-2 text-xs tracking-wide focus:border-nier-border/60"
                >
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
                  className="shrink-0 px-4 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors disabled:opacity-40"
                >
                  {t('browser.drive.add')}
                </button>
              </div>
            </div>
          )}

          <SettingsGroup id="admins" title={t('atrium.manage.admins')} hint={t('browser.drive.group.adminsHint')}>
            {[...members('owner'), ...members('admin')].map(memberRow)}
          </SettingsGroup>
          <SettingsGroup id="editors" title={t('atrium.manage.editors')} hint={t('browser.drive.group.editorsHint')}>
            {members('editor').length ? members('editor').map(memberRow) : <Nobody />}
          </SettingsGroup>
          <SettingsGroup id="viewers" title={t('browser.drive.group.viewers')} hint={t('browser.drive.group.viewersHint')}>
            {members('viewer').length ? members('viewer').map(memberRow) : <Nobody />}
          </SettingsGroup>
          {roster.invited.length > 0 && (
            <SettingsGroup id="invited" title={t('browser.drive.group.invited')} hint={t('browser.drive.group.invitedHint')}>
              {roster.invited.map(invite => (
                <SettingsPerson key={invite.user} name={invite.name}>
                  {/* The role they'll come in with: theirs to change as a member's (an admin's, once they're in). */}
                  {managing && invite.role !== 'admin' ? (
                    <>
                      <select value={invite.role} disabled={busy} aria-label={t('atrium.manage.addAs')} onChange={e => void act(() => setRole(lobbyId, me, invite.user, e.target.value as Assignable))} className={ROLE_SELECT}>
                        <option value="editor">{t('browser.drive.role.editor')}</option>
                        <option value="viewer">{t('browser.drive.role.viewer')}</option>
                      </select>
                      <button disabled={busy} onClick={() => void resend(invite.user, invite.name)} className={SMALL_BUTTON}>{t('browser.drive.resend')}</button>
                      <button disabled={busy} onClick={() => void act(() => removePerson(lobbyId, me, invite.user, false))} className={REMOVE_BUTTON}>{t('browser.drive.remove')}</button>
                    </>
                  ) : (
                    <span className="text-nier-bg/60 uppercase tracking-wider text-[10px]">{t(`browser.drive.role.${invite.role}`)}</span>
                  )}
                </SettingsPerson>
              ))}
            </SettingsGroup>
          )}
        </div>
      )}
    </SettingsFrame>
  )
}
