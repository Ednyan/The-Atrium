// Atrium settings: an atrium's owner's and admins' panel, from its menu and
// from the atrium browser. Two tabs, by what's being decided:
//
//   General  its name, whether everyone can find it, its password.
//   People   who can edit, and everyone with a part in it: the owner and the
//            admins, the editors, those allowed in while it's private, and
//            those kept out -- one list, added to from one search, each
//            person added as what they're to be.
//
// The General tab's settings (and who can edit) are written by Save; people
// are added and removed at once.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Lobby, LobbyAccessList, Profile } from '../types/database'
import { useTranslation } from '../lib/i18n'
import { Switch } from './Customization'

interface LobbyManagementProps {
  lobby: Lobby
  isOwner: boolean
  onClose: () => void
  onUpdate: () => void
}

type Listed = LobbyAccessList & { username?: string }
// What someone is added as. Admins are on the atrium's row
// (lobbies.admin_user_ids); the rest are lobby_access_lists entries.
type Role = 'admin' | 'editor' | 'whitelist' | 'blacklist'

export function LobbyManagement({ lobby, isOwner, onClose, onUpdate }: LobbyManagementProps) {
  const { t } = useTranslation()
  const [lobbyName, setLobbyName] = useState(lobby.name)
  const [password, setPassword] = useState('')
  const [showPasswordField, setShowPasswordField] = useState(false)
  const hasPassword = !!lobby.passwordHash
  const [isPublic, setIsPublic] = useState(lobby.isPublic)
  const [whitelist, setWhitelist] = useState<Listed[]>([])
  const [blacklist, setBlacklist] = useState<Listed[]>([])
  const [editors, setEditors] = useState<Listed[]>([])
  // The owner first, then the admins.
  const [names, setNames] = useState<Record<string, string>>({})
  const [editPermissionMode, setEditPermissionMode] = useState<'all' | 'none' | 'selected'>(lobby.editPermissionMode ?? 'all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [addAs, setAddAs] = useState<Role>('editor')
  const [activeTab, setActiveTab] = useState<'general' | 'people'>('general')
  const [error, setError] = useState<string | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [transferTargetUserId, setTransferTargetUserId] = useState<string | null>(null)
  const [transferTargetUsername, setTransferTargetUsername] = useState<string | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)

  const isDirty = (
    lobbyName !== lobby.name ||
    isPublic !== lobby.isPublic ||
    editPermissionMode !== (lobby.editPermissionMode ?? 'all') ||
    (showPasswordField && password.trim() !== '')
  )

  const requestClose = () => {
    if (isDirty) {
      setShowCloseConfirm(true)
    } else {
      onClose()
    }
  }

  useEffect(() => {
    loadAccessLists()
  }, [])

  // admin_user_ids lives on the lobby row itself (not lobby_access_lists --
  // see fix_lobby_admin_recursion_v2.sql), so it just needs a username
  // lookup, not a separate access-list query. The owner's name with theirs.
  const adminIds = lobby.adminUserIds ?? []
  useEffect(() => {
    loadNames()
  }, [lobby.ownerUserId, adminIds.join(',')])

  const loadNames = async () => {
    const ids = [lobby.ownerUserId, ...adminIds].filter(Boolean)
    if (!supabase || ids.length === 0) return
    try {
      const { data, error } = await (supabase
        .from('profiles')
        .select('id, username')
        .in('id', ids) as any)

      if (error) throw error
      setNames(Object.fromEntries((data || []).map((p: any) => [p.id, p.username || t('atrium.manage.unknownUser')])))
    } catch (err) {
      console.error('Error loading admins:', err)
    }
  }

  const loadAccessLists = async () => {
    if (!supabase) return

    try {
      const listOf = async (listType: string) => {
        const { data, error } = await (supabase!
          .from('lobby_access_lists')
          .select('*')
          .eq('lobby_id', lobby.id)
          .eq('list_type', listType) as any)
        if (error) throw error
        return enrichWithUsernames(data || [])
      }
      const [allowed, blocked, editing] = await Promise.all([listOf('whitelist'), listOf('blacklist'), listOf('editor')])
      setWhitelist(allowed)
      setBlacklist(blocked)
      setEditors(editing)
    } catch (err) {
      console.error('Error loading access lists:', err)
    }
  }

  const enrichWithUsernames = async (list: any[]): Promise<Listed[]> => {
    if (!supabase || list.length === 0) return []

    const enriched = await Promise.all(list.map(async (item) => {
      const { data: profile } = await (supabase!
        .from('profiles')
        .select('username')
        .eq('id', item.user_id)
        .single() as any)

      return {
        id: item.id,
        lobbyId: item.lobby_id,
        userId: item.user_id,
        listType: item.list_type,
        addedAt: item.added_at,
        addedBy: item.added_by,
        username: profile?.username || t('atrium.manage.unknownUser'),
      }
    }))

    return enriched
  }

  const searchUsers = async () => {
    if (!supabase || searchQuery.length < 2) return

    try {
      const { data, error } = await (supabase
        .from('profiles')
        .select('*')
        .ilike('username', `%${searchQuery}%`)
        .limit(10) as any)

      if (error) throw error
      setSearchResults(data || [])
    } catch (err) {
      console.error('Error searching users:', err)
    }
  }

  const updateLobbySettings = async (): Promise<boolean> => {
    if (!supabase) return false

    try {
      const updates: any = {
        name: lobbyName,
        is_public: isPublic,
        edit_permission_mode: editPermissionMode,
      }

      // Only touch password_hash if the user explicitly opened the
      // set/change-password field -- otherwise saving other settings (name,
      // visibility, etc.) would silently wipe out an existing password every
      // time, since the field always rendered empty.
      if (showPasswordField) {
        updates.password_hash = password.trim() || null
      }

      const { error } = await (supabase!
        .from('lobbies') as any)
        .update(updates)
        .eq('id', lobby.id)

      if (error) throw error

      onUpdate()
      setError(null)
      setShowPasswordField(false)
      setPassword('')
      setShowCloseConfirm(false)
      setSettingsSaved(true)
      window.setTimeout(() => setSettingsSaved(false), 3000)
      return true
    } catch (err: any) {
      console.error('Error updating lobby:', err)
      setError(err.message || t('atrium.manage.updateFailed'))
      return false
    }
  }

  const addToList = async (userId: string, listType: 'whitelist' | 'blacklist' | 'editor') => {
    if (!supabase) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error(t('atrium.manage.notAuthenticated'))

      // A user can't be both whitelisted and blacklisted at once -- drop
      // them from the other list first so adding here is a clean move.
      // Editor is independent of whitelist/blacklist, so it's not part of
      // this mutual-exclusion pass.
      if (listType === 'whitelist' || listType === 'blacklist') {
        const oppositeListType = listType === 'whitelist' ? 'blacklist' : 'whitelist'
        await (supabase
          .from('lobby_access_lists')
          .delete()
          .eq('lobby_id', lobby.id)
          .eq('user_id', userId)
          .eq('list_type', oppositeListType) as any)
      }

      const { error } = await (supabase!
        .from('lobby_access_lists') as any)
        .insert({
          lobby_id: lobby.id,
          user_id: userId,
          list_type: listType,
          added_by: user.id,
        })

      if (error) throw error

      loadAccessLists()
      setSearchQuery('')
      setSearchResults([])
    } catch (err: any) {
      console.error('Error adding to list:', err)
      setError(err.message || t('atrium.manage.addFailed'))
    }
  }

  // Admins live in lobbies.admin_user_ids (a plain array column), not
  // lobby_access_lists -- see fix_lobby_admin_recursion_v2.sql for why.
  const promoteToAdmin = async (userId: string) => {
    if (!supabase) return

    try {
      if (adminIds.includes(userId) || userId === lobby.ownerUserId) return

      const { error } = await (supabase
        .from('lobbies') as any)
        .update({ admin_user_ids: [...adminIds, userId] })
        .eq('id', lobby.id)

      if (error) throw error

      setSearchQuery('')
      setSearchResults([])
      onUpdate()
    } catch (err: any) {
      console.error('Error promoting admin:', err)
      setError(err.message || t('atrium.manage.promoteFailed'))
    }
  }

  const demoteAdmin = async (userId: string) => {
    if (!supabase) return

    try {
      const { error } = await (supabase
        .from('lobbies') as any)
        .update({ admin_user_ids: adminIds.filter(id => id !== userId) })
        .eq('id', lobby.id)

      if (error) throw error

      onUpdate()
    } catch (err: any) {
      console.error('Error demoting admin:', err)
      setError(err.message || t('atrium.manage.demoteFailed'))
    }
  }

  const removeFromList = async (entryId: string) => {
    if (!supabase) return

    try {
      const { error } = await (supabase
        .from('lobby_access_lists')
        .delete()
        .eq('id', entryId) as any)

      if (error) throw error

      loadAccessLists()
    } catch (err: any) {
      console.error('Error removing from list:', err)
      setError(err.message || t('atrium.manage.removeFailed'))
    }
  }

  const add = (userId: string) => {
    if (addAs === 'admin') void promoteToAdmin(userId)
    else void addToList(userId, addAs)
  }

  const transferOwnership = async () => {
    if (!supabase || !transferTargetUserId) return

    setIsTransferring(true)
    try {
      const { error } = await supabase.rpc('transfer_lobby_ownership', {
        p_lobby_id: lobby.id,
        p_new_owner_user_id: transferTargetUserId,
      })

      if (error) throw error

      setTransferTargetUserId(null)
      setTransferTargetUsername(null)
      onUpdate()
      onClose()
    } catch (err: any) {
      console.error('Error transferring ownership:', err)
      setError(err.message || t('atrium.manage.transferFailed'))
      setTransferTargetUserId(null)
      setTransferTargetUsername(null)
    } finally {
      setIsTransferring(false)
    }
  }

  const tabClass = (on: boolean) => `flex-1 px-4 py-3 text-xs tracking-[0.15em] uppercase transition-colors ${
    on ? 'text-nier-bg border-b border-nier-bg bg-nier-bg/5' : 'text-nier-bg/75 hover:text-nier-bg hover:bg-nier-bg/5'
  }`
  const smallButton = 'px-3 py-1 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors'
  const removeButton = 'px-3 py-1 border border-nier-red/40 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:bg-nier-red/20 hover:text-nier-bg transition-colors'
  const people = 1 + adminIds.length + editors.length + whitelist.length + blacklist.length
  // What someone can be added as: an admin only by the owner.
  const roles: { value: Role; label: string }[] = [
    { value: 'editor', label: t('atrium.manage.roleEditor') },
    { value: 'whitelist', label: t('atrium.manage.whitelistedUsers') },
    { value: 'blacklist', label: t('atrium.manage.blacklistedUsers') },
    ...(isOwner ? [{ value: 'admin' as const, label: t('atrium.manage.roleAdmin') }] : []),
  ]

  // The editors' note, naming the setting it depends on and its choice --
  // set in italics, so it reads as a setting and not as words.
  const marked = t('atrium.manage.editorsNote', { setting: '\u0000setting\u0000', option: '\u0000option\u0000' })
  const named: Record<string, string> = { setting: t('atrium.manage.editPermissions'), option: t('atrium.manage.permSelected') }
  const editorsNote = marked.split('\u0000').map((piece, i) => (i % 2 ? <em key={i} className="text-nier-bg/90">{named[piece]}</em> : piece))

  // A group of people in the list: what they are, what that means, who.
  const Group = ({ id, title, hint, dim, children }: { id: string; title: string; hint: React.ReactNode; dim?: boolean; children: React.ReactNode }) => (
    <div data-people-group={id} className={dim ? 'opacity-60' : undefined}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase">{title}</span>
        <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
      </div>
      <p className="text-nier-bg/65 text-[0.7rem] leading-relaxed tracking-wide mb-2">{hint}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
  const Person = ({ name, children }: { name: string; children?: React.ReactNode }) => (
    <div className="flex justify-between items-center gap-2 bg-nier-black border border-nier-border/20 px-3 py-2">
      <span className="min-w-0 truncate text-nier-bg text-sm tracking-wide">{name}</span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
  const Nobody = () => <div className="text-nier-bg/55 text-[10px] tracking-wider uppercase py-1">{t('atrium.manage.noUsers')}</div>
  const Entries = ({ list }: { list: Listed[] }) => (
    list.length === 0 ? <Nobody /> : <>
      {list.map(entry => (
        <Person key={entry.id} name={entry.username ?? ''}>
          <button onClick={() => removeFromList(entry.id)} className={removeButton}>{t('atrium.manage.remove')}</button>
        </Person>
      ))}
    </>
  )

  return (
    <div
      data-ui-element="true"
      className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] p-4"
      style={{ touchAction: 'auto', overscrollBehavior: 'contain' }}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onClick={requestClose}
    >
      <div data-atrium-settings="" className="bg-nier-blackLight border border-nier-border/40 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }} onClick={(e) => e.stopPropagation()}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-6 h-6 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-6 h-6 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-r border-b border-nier-border/60" />

        {/* Header */}
        <div className="p-6 border-b border-nier-border/20">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
              <h2 className="text-lg text-nier-strong tracking-[0.15em] uppercase">{t('atrium.manage.title')}</h2>
            </div>
            <button
              onClick={requestClose}
              className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-bg/80 hover:text-nier-bg hover:border-nier-border/60 transition-colors"
            >
              ×
            </button>
          </div>
          {error && (
            <div className="mt-3 text-nier-bg/80 text-xs tracking-wider border border-nier-red/40 bg-nier-red/10 px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-nier-border/20">
          <button data-settings-tab="general" onClick={() => setActiveTab('general')} className={tabClass(activeTab === 'general')}>
            {t('atrium.manage.general')}
          </button>
          <button data-settings-tab="people" onClick={() => setActiveTab('people')} className={tabClass(activeTab === 'people')}>
            {t('atrium.manage.people', { count: people })}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'general' && (
            <div className="space-y-5">
              <div>
                <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('atrium.manage.atriumName')}</label>
                <input
                  type="text"
                  value={lobbyName}
                  onChange={(e) => setLobbyName(e.target.value)}
                  className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                  maxLength={50}
                />
              </div>

              <Switch testId="atrium-public" label={t('atrium.manage.public')} hint={t('atrium.manage.publicHint')} on={isPublic} onChange={setIsPublic} />

              <div>
                <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('atrium.manage.password')}</label>
                {!showPasswordField ? (
                  <button
                    onClick={() => setShowPasswordField(true)}
                    className="w-full py-2 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                  >
                    {hasPassword ? t('atrium.manage.changePassword') : t('atrium.manage.setPassword')}
                  </button>
                ) : (
                  <>
                    <input
                      autoFocus
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={hasPassword ? t('atrium.manage.newPasswordRemove') : t('atrium.manage.newPassword')}
                      className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                    />
                    <button
                      onClick={() => {
                        setShowPasswordField(false)
                        setPassword('')
                      }}
                      className="w-full mt-2 py-1.5 border border-nier-border/20 text-nier-bg/75 text-xs tracking-[0.15em] uppercase hover:text-nier-bg hover:border-nier-border/50 transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                    <p className="text-nier-bg/70 text-xs tracking-wider mt-2">
                      {hasPassword
                        ? t('atrium.manage.passwordRemoveHint')
                        : t('atrium.manage.passwordApplyHint')}
                    </p>
                  </>
                )}
              </div>
            </div>
          )}

          {activeTab === 'people' && (
            <div className="space-y-6">
              {/* Who can edit: decides what the Editors group means, so it
                  comes first. */}
              <div>
                <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">
                  {t('atrium.manage.editPermissions')}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { value: 'all', label: t('atrium.manage.permAll') },
                    { value: 'selected', label: t('atrium.manage.permSelected') },
                    { value: 'none', label: t('atrium.manage.permNone') },
                  ] as const).map(option => (
                    <button
                      key={option.value}
                      type="button"
                      data-edit-mode={option.value}
                      onClick={() => setEditPermissionMode(option.value)}
                      className={`py-2 text-xs tracking-[0.1em] uppercase border transition-colors ${
                        editPermissionMode === option.value
                          ? 'bg-nier-bg text-nier-black border-nier-bg'
                          : 'border-nier-border/30 text-nier-bg/80 hover:border-nier-border/60 hover:text-nier-bg'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="text-nier-bg/70 text-xs tracking-wider mt-1">
                  {editPermissionMode === 'all' && t('atrium.manage.permAllHint')}
                  {editPermissionMode === 'none' && t('atrium.manage.permNoneHint')}
                  {editPermissionMode === 'selected' && t('atrium.manage.permSelectedHint')}
                </p>
              </div>

              {/* Someone added: found by name, added as what they're to be. */}
              <div>
                <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('atrium.manage.addUser')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    data-people-search=""
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                    placeholder={t('atrium.manage.searchUsername')}
                    className="min-w-0 flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                  />
                  <select
                    data-people-role=""
                    value={addAs}
                    onChange={e => setAddAs(e.target.value as Role)}
                    aria-label={t('atrium.manage.addAs')}
                    title={t('atrium.manage.addAs')}
                    className="shrink-0 bg-nier-black border border-nier-border/30 text-nier-bg px-2 py-2 text-xs tracking-wide focus:border-nier-border/60"
                  >
                    {roles.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                  <button
                    onClick={searchUsers}
                    className="shrink-0 px-4 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors"
                  >
                    {t('atrium.manage.search')}
                  </button>
                </div>

                {searchResults.length > 0 && (
                  <div className="mt-2 bg-nier-black border border-nier-border/20 max-h-40 overflow-y-auto">
                    {searchResults.map(user => (
                      <div
                        key={user.id}
                        className="flex justify-between items-center px-3 py-2 hover:bg-nier-bg/5 transition-colors"
                      >
                        <span className="text-nier-bg text-sm tracking-wide">{user.username}</span>
                        <button onClick={() => add(user.id)} className={smallButton}>
                          {t('atrium.manage.addAsRole', { role: roles.find(r => r.value === addAs)?.label ?? '' })}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Group id="admins" title={t('atrium.manage.admins')} hint={t('atrium.manage.adminsNote')}>
                {/* The owner is an admin too, and stays one: no buttons. */}
                <Person name={names[lobby.ownerUserId] ?? t('atrium.manage.unknownUser')}>
                  <span data-owner-badge="" className="px-2 py-0.5 border border-nier-border/40 text-nier-strong text-[10px] tracking-[0.15em] uppercase">{t('atrium.manage.owner')}</span>
                </Person>
                {adminIds.filter(id => id !== lobby.ownerUserId).map(id => (
                  <Person key={id} name={names[id] ?? t('atrium.manage.unknownUser')}>
                    {isOwner && (
                      <>
                        <button
                          onClick={() => {
                            setTransferTargetUserId(id)
                            setTransferTargetUsername(names[id] || t('atrium.manage.thisUser'))
                          }}
                          className={smallButton}
                        >
                          {t('atrium.manage.makeOwner')}
                        </button>
                        <button onClick={() => demoteAdmin(id)} className={removeButton}>{t('atrium.manage.demote')}</button>
                      </>
                    )}
                  </Person>
                ))}
              </Group>

              {/* Only counts while Who can edit is "Chosen people". */}
              <Group id="editors" title={t('atrium.manage.editors')} hint={editorsNote} dim={editPermissionMode !== 'selected'}>
                <Entries list={editors} />
              </Group>
              <Group id="allowed" title={t('atrium.manage.whitelistedUsers')} hint={t('atrium.manage.allowedHint')}>
                <Entries list={whitelist} />
              </Group>
              <Group id="blocked" title={t('atrium.manage.blacklistedUsers')} hint={t('atrium.manage.blockedHint')}>
                <Entries list={blacklist} />
              </Group>
            </div>
          )}
        </div>

        {/* Save Settings -- visible on both tabs: who can edit is on People,
            the rest on General, and switching tabs mustn't strand either. */}
        <div className="p-4 border-t border-nier-border/20">
          <button
            onClick={updateLobbySettings}
            className="w-full py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors"
          >
            {t('atrium.manage.saveSettings')}
          </button>
          {settingsSaved && (
            <div className="mt-2 border border-nier-border/40 bg-nier-border/10 px-3 py-2 text-nier-bg text-xs tracking-wider">
              ✓ {t('atrium.manage.settingsSaved')}
            </div>
          )}
        </div>
      </div>

      {/* Unsaved-changes confirmation */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-[10001] bg-black/70 flex items-center justify-center">
          <div className="bg-nier-blackLight border border-nier-border/40 p-6 relative" style={{ maxWidth: '320px' }}>
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60 pointer-events-none" />

            <h3 className="text-nier-strong text-sm tracking-[0.15em] uppercase mb-3 text-center">
              <span className="text-nier-bg/75 mr-2">◇</span>{t('atrium.manage.unsavedTitle')}
            </h3>
            <p className="text-nier-bg/80 text-xs tracking-wider text-center mb-6">
              {t('atrium.manage.unsavedBody')}
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  const saved = await updateLobbySettings()
                  if (saved) onClose()
                }}
                className="w-full bg-nier-bg hover:bg-nier-strong text-nier-black text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all"
              >
                {t('atrium.manage.saveAndClose')}
              </button>
              <button
                onClick={() => {
                  setShowCloseConfirm(false)
                  onClose()
                }}
                className="w-full bg-nier-red/80 hover:bg-nier-red text-white text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-nier-red/60"
              >
                {t('atrium.manage.discardChanges')}
              </button>
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="w-full border border-nier-border/30 hover:border-nier-border/60 text-nier-bg/80 text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ownership transfer confirmation */}
      {transferTargetUserId && (
        <div className="fixed inset-0 z-[10001] bg-black/70 flex items-center justify-center">
          <div className="bg-nier-blackLight border border-nier-border/40 p-6 relative" style={{ maxWidth: '340px' }}>
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60 pointer-events-none" />

            <h3 className="text-nier-strong text-sm tracking-[0.15em] uppercase mb-3 text-center">
              <span className="text-nier-bg/75 mr-2">◇</span>{t('atrium.manage.transferTitle')}
            </h3>
            <p className="text-nier-bg/80 text-xs tracking-wider text-center mb-6">
              {t('atrium.manage.transferBody', { name: transferTargetUsername ?? '' })}
            </p>

            <div className="flex flex-col gap-2">
              <button
                onClick={transferOwnership}
                disabled={isTransferring}
                className="w-full bg-nier-red/80 hover:bg-nier-red text-white text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all border border-nier-red/60 disabled:opacity-50"
              >
                {isTransferring ? t('atrium.manage.transferring') : t('atrium.manage.transferTitle')}
              </button>
              <button
                onClick={() => {
                  setTransferTargetUserId(null)
                  setTransferTargetUsername(null)
                }}
                disabled={isTransferring}
                className="w-full border border-nier-border/30 hover:border-nier-border/60 text-nier-bg/80 text-xs tracking-[0.15em] uppercase py-2.5 px-4 transition-all disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
