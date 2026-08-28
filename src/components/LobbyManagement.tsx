import { useState, useEffect } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import type { Lobby, LobbyAccessList, Profile } from '../types/database'
import { useTranslation } from '../lib/i18n'

// Web autosaves hit the shared Supabase project, so keep a floor high enough
// to not be abusable; desktop autosaves only touch the local SQLite file, so
// it can be as frequent as the user likes.
const AUTOSAVE_MIN_SECONDS = isDesktop ? 10 : 600
const AUTOSAVE_MAX_SECONDS = isDesktop ? 600 : 1800
const clampAutosaveInterval = (value: number) => Math.max(AUTOSAVE_MIN_SECONDS, Math.min(AUTOSAVE_MAX_SECONDS, value))

interface LobbyManagementProps {
  lobby: Lobby
  isOwner: boolean
  onClose: () => void
  onUpdate: () => void
}

export function LobbyManagement({ lobby, isOwner, onClose, onUpdate }: LobbyManagementProps) {
  const { t } = useTranslation()
  const [lobbyName, setLobbyName] = useState(lobby.name)
  const [password, setPassword] = useState('')
  const [showPasswordField, setShowPasswordField] = useState(false)
  const hasPassword = !!lobby.passwordHash
  const [isPublic, setIsPublic] = useState(lobby.isPublic)
  const [autosaveEnabled, setAutosaveEnabled] = useState(lobby.autosaveEnabled ?? false)
  const [autosaveIntervalSeconds, setAutosaveIntervalSeconds] = useState(
    clampAutosaveInterval(lobby.autosaveIntervalSeconds ?? AUTOSAVE_MIN_SECONDS)
  )
  const [whitelist, setWhitelist] = useState<(LobbyAccessList & { username?: string })[]>([])
  const [blacklist, setBlacklist] = useState<(LobbyAccessList & { username?: string })[]>([])
  const [editors, setEditors] = useState<(LobbyAccessList & { username?: string })[]>([])
  const [admins, setAdmins] = useState<{ userId: string; username: string }[]>([])
  const [editPermissionMode, setEditPermissionMode] = useState<'all' | 'none' | 'selected'>(lobby.editPermissionMode ?? 'all')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [activeTab, setActiveTab] = useState<'settings' | 'whitelist' | 'blacklist' | 'editors' | 'admins'>('settings')
  const [error, setError] = useState<string | null>(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [transferTargetUserId, setTransferTargetUserId] = useState<string | null>(null)
  const [transferTargetUsername, setTransferTargetUsername] = useState<string | null>(null)
  const [isTransferring, setIsTransferring] = useState(false)

  const isDirty = (
    lobbyName !== lobby.name ||
    isPublic !== lobby.isPublic ||
    autosaveEnabled !== (lobby.autosaveEnabled ?? false) ||
    autosaveIntervalSeconds !== clampAutosaveInterval(lobby.autosaveIntervalSeconds ?? AUTOSAVE_MIN_SECONDS) ||
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
  // lookup, not a separate access-list query.
  useEffect(() => {
    loadAdmins()
  }, [lobby.adminUserIds?.join(',')])

  const loadAdmins = async () => {
    if (!supabase || !lobby.adminUserIds || lobby.adminUserIds.length === 0) {
      setAdmins([])
      return
    }
    try {
      const { data, error } = await (supabase
        .from('profiles')
        .select('id, username')
        .in('id', lobby.adminUserIds) as any)

      if (error) throw error
      setAdmins((data || []).map((p: any) => ({ userId: p.id, username: p.username || t('atrium.manage.unknownUser') })))
    } catch (err) {
      console.error('Error loading admins:', err)
    }
  }

  const loadAccessLists = async () => {
    if (!supabase) return

    try {
      // Load whitelist
      const { data: whitelistData, error: whitelistError } = await (supabase
        .from('lobby_access_lists')
        .select('*')
        .eq('lobby_id', lobby.id)
        .eq('list_type', 'whitelist') as any)

      if (whitelistError) throw whitelistError

      // Load blacklist
      const { data: blacklistData, error: blacklistError } = await (supabase
        .from('lobby_access_lists')
        .select('*')
        .eq('lobby_id', lobby.id)
        .eq('list_type', 'blacklist') as any)

      if (blacklistError) throw blacklistError

      // Load editors
      const { data: editorData, error: editorError } = await (supabase
        .from('lobby_access_lists')
        .select('*')
        .eq('lobby_id', lobby.id)
        .eq('list_type', 'editor') as any)

      if (editorError) throw editorError

      // Enrich with usernames
      const enrichWhitelist = await enrichWithUsernames(whitelistData || [])
      const enrichBlacklist = await enrichWithUsernames(blacklistData || [])
      const enrichEditors = await enrichWithUsernames(editorData || [])

      setWhitelist(enrichWhitelist)
      setBlacklist(enrichBlacklist)
      setEditors(enrichEditors)
    } catch (err) {
      console.error('Error loading access lists:', err)
    }
  }

  const enrichWithUsernames = async (list: any[]): Promise<(LobbyAccessList & { username?: string })[]> => {
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
        autosave_enabled: autosaveEnabled,
        autosave_interval_seconds: clampAutosaveInterval(autosaveIntervalSeconds),
        edit_permission_mode: editPermissionMode,
      }

      // Only touch password_hash if the user explicitly opened the
      // set/change-password field -- otherwise saving other settings (name,
      // autosave, etc.) would silently wipe out an existing password every
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
      const current = lobby.adminUserIds ?? []
      if (current.includes(userId)) return

      const { error } = await (supabase
        .from('lobbies') as any)
        .update({ admin_user_ids: [...current, userId] })
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
      const current = lobby.adminUserIds ?? []
      const { error } = await (supabase
        .from('lobbies') as any)
        .update({ admin_user_ids: current.filter(id => id !== userId) })
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

  return (
    <div
      data-ui-element="true"
      className="modal-backdrop fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[10000100] p-4"
      style={{ touchAction: 'auto', overscrollBehavior: 'contain' }}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="bg-nier-blackLight border border-nier-border/40 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
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
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 px-4 py-3 text-xs tracking-[0.15em] uppercase transition-colors ${
              activeTab === 'settings'
                ? 'text-nier-bg border-b border-nier-bg bg-nier-bg/5'
                : 'text-nier-bg/75 hover:text-nier-bg hover:bg-nier-bg/5'
            }`}
          >
            {t('atrium.manage.settings')}
          </button>
          <button
            onClick={() => setActiveTab('whitelist')}
            className={`flex-1 px-4 py-3 text-xs tracking-[0.15em] uppercase transition-colors ${
              activeTab === 'whitelist'
                ? 'text-nier-bg border-b border-nier-bg bg-nier-bg/5'
                : 'text-nier-bg/75 hover:text-nier-bg hover:bg-nier-bg/5'
            }`}
          >
            {t('atrium.manage.whitelistTab', { count: whitelist.length })}
          </button>
          <button
            onClick={() => setActiveTab('blacklist')}
            className={`flex-1 px-4 py-3 text-xs tracking-[0.15em] uppercase transition-colors ${
              activeTab === 'blacklist'
                ? 'text-nier-bg border-b border-nier-bg bg-nier-bg/5'
                : 'text-nier-bg/75 hover:text-nier-bg hover:bg-nier-bg/5'
            }`}
          >
            {t('atrium.manage.blacklistTab', { count: blacklist.length })}
          </button>
          <button
            onClick={() => setActiveTab('editors')}
            className={`flex-1 px-4 py-3 text-xs tracking-[0.15em] uppercase transition-colors ${
              activeTab === 'editors'
                ? 'text-nier-bg border-b border-nier-bg bg-nier-bg/5'
                : 'text-nier-bg/75 hover:text-nier-bg hover:bg-nier-bg/5'
            }`}
          >
            {t('atrium.manage.editorsTab', { count: editors.length })}
          </button>
          {isOwner && (
            <button
              onClick={() => setActiveTab('admins')}
              className={`flex-1 px-4 py-3 text-xs tracking-[0.15em] uppercase transition-colors ${
                activeTab === 'admins'
                  ? 'text-nier-bg border-b border-nier-bg bg-nier-bg/5'
                  : 'text-nier-bg/75 hover:text-nier-bg hover:bg-nier-bg/5'
              }`}
            >
              {t('atrium.manage.adminsTab', { count: admins.length })}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'settings' && (
            <div className="space-y-4">
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

              <label className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                  isPublic ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
                }`}>
                  {isPublic && <span className="text-nier-bg text-xs">✓</span>}
                </div>
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="hidden"
                />
                <span className="text-nier-bg/80 text-xs tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">
                  {t('atrium.manage.public')}
                </span>
              </label>

              <div className="pt-2 border-t border-nier-border/20">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${
                    autosaveEnabled ? 'border-nier-bg bg-nier-bg/10' : 'border-nier-border/40'
                  }`}>
                    {autosaveEnabled && <span className="text-nier-bg text-xs">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={autosaveEnabled}
                    onChange={(e) => setAutosaveEnabled(e.target.checked)}
                    className="hidden"
                  />
                  <span className="text-nier-bg/80 text-xs tracking-[0.1em] uppercase group-hover:text-nier-bg transition-colors">
                    {t('atrium.manage.autosave')}
                  </span>
                </label>
                <p className="text-nier-bg/70 text-xs tracking-wider mt-1">
                  {t('atrium.manage.autosaveHint')}
                </p>

                {autosaveEnabled && (
                  <div className="mt-3">
                    <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">
                      {t('atrium.manage.saveEvery', { minutes: Math.floor(autosaveIntervalSeconds / 60), seconds: autosaveIntervalSeconds % 60 })}
                    </label>
                    <input
                      type="range"
                      min={AUTOSAVE_MIN_SECONDS}
                      max={AUTOSAVE_MAX_SECONDS}
                      step="10"
                      value={autosaveIntervalSeconds}
                      onChange={(e) => setAutosaveIntervalSeconds(parseInt(e.target.value, 10))}
                      className="w-full accent-nier-bg"
                    />
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-nier-border/20">
                <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">
                  {t('atrium.manage.editPermissions')}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { value: 'all', label: t('atrium.manage.permAll') },
                    { value: 'none', label: t('atrium.manage.permNone') },
                    { value: 'selected', label: t('atrium.manage.permSelected') },
                  ] as const).map(option => (
                    <button
                      key={option.value}
                      type="button"
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
            </div>
          )}

          {(activeTab === 'whitelist' || activeTab === 'blacklist' || activeTab === 'editors') && (() => {
            const currentList = activeTab === 'whitelist' ? whitelist : activeTab === 'blacklist' ? blacklist : editors
            const listLabel = activeTab === 'whitelist' ? t('atrium.manage.whitelistedUsers') : activeTab === 'blacklist' ? t('atrium.manage.blacklistedUsers') : t('atrium.manage.editors')
            return (
            <div className="space-y-4">
              {activeTab === 'editors' && (
                <p className="text-nier-bg/70 text-xs tracking-wider">
                  {t('atrium.manage.editorsNote')}
                </p>
              )}
              {/* Search Users */}
              <div>
                <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('atrium.manage.addUser')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                    placeholder={t('atrium.manage.searchUsername')}
                    className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                  />
                  <button
                    onClick={searchUsers}
                    className="px-4 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors"
                  >
                    {t('atrium.manage.search')}
                  </button>
                </div>

                {/* Search Results */}
                {searchResults.length > 0 && (
                  <div className="mt-2 bg-nier-black border border-nier-border/20 max-h-40 overflow-y-auto">
                    {searchResults.map(user => (
                      <div
                        key={user.id}
                        className="flex justify-between items-center px-3 py-2 hover:bg-nier-bg/5 transition-colors"
                      >
                        <span className="text-nier-bg text-sm tracking-wide">{user.username}</span>
                        <button
                          onClick={() => addToList(user.id, activeTab === 'editors' ? 'editor' : activeTab)}
                          className="px-3 py-1 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors"
                        >
                          {t('atrium.manage.add')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Current List */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase">
                    {listLabel}
                  </span>
                  <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                </div>
                <div className="space-y-2">
                  {currentList.length === 0 ? (
                    <div className="text-nier-bg/70 text-xs tracking-wider uppercase text-center py-4">{t('atrium.manage.noUsers')}</div>
                  ) : (
                    currentList.map(entry => (
                      <div
                        key={entry.id}
                        className="flex justify-between items-center bg-nier-black border border-nier-border/20 px-3 py-2"
                      >
                        <span className="text-nier-bg text-sm tracking-wide">{entry.username}</span>
                        <button
                          onClick={() => removeFromList(entry.id)}
                          className="px-3 py-1 border border-nier-red/40 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:bg-nier-red/20 hover:text-nier-bg transition-colors"
                        >
                          {t('atrium.manage.remove')}
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            )
          })()}

          {activeTab === 'admins' && (
            <div className="space-y-4">
              {/* Said before the controls it governs, the way the editors tab
                  says it. Explaining what a power does after somebody has
                  already handed it out is the wrong order. */}
              <p className="text-nier-bg/75 text-xs leading-relaxed">
                {t('atrium.manage.adminsNote')}
              </p>

              {/* Search Users */}
              <div>
                <label className="block text-nier-bg/80 text-xs tracking-[0.15em] uppercase mb-2">{t('atrium.manage.addUser')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
                    placeholder={t('atrium.manage.searchUsername')}
                    className="flex-1 bg-nier-black border border-nier-border/30 text-nier-bg px-3 py-2 text-sm tracking-wide placeholder-nier-bg/50 focus:border-nier-border/60 transition-colors"
                  />
                  <button
                    onClick={searchUsers}
                    className="px-4 py-2 bg-nier-bg text-nier-black text-xs tracking-[0.15em] uppercase hover:bg-nier-strong transition-colors"
                  >
                    {t('atrium.manage.search')}
                  </button>
                </div>

                {/* Search Results */}
                {searchResults.length > 0 && (
                  <div className="mt-2 bg-nier-black border border-nier-border/20 max-h-40 overflow-y-auto">
                    {searchResults.map(user => (
                      <div
                        key={user.id}
                        className="flex justify-between items-center px-3 py-2 hover:bg-nier-bg/5 transition-colors"
                      >
                        <span className="text-nier-bg text-sm tracking-wide">{user.username}</span>
                        <button
                          onClick={() => promoteToAdmin(user.id)}
                          className="px-3 py-1 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors"
                        >
                          {t('atrium.manage.add')}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Current Admins */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-nier-bg/80 text-xs tracking-[0.15em] uppercase">
                    {t('atrium.manage.admins')}
                  </span>
                  <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                </div>
                <div className="space-y-2">
                  {admins.length === 0 ? (
                    <div className="text-nier-bg/70 text-xs tracking-wider uppercase text-center py-4">{t('atrium.manage.noAdmins')}</div>
                  ) : (
                    admins.map(entry => (
                      <div
                        key={entry.userId}
                        className="flex justify-between items-center bg-nier-black border border-nier-border/20 px-3 py-2"
                      >
                        <span className="text-nier-bg text-sm tracking-wide">{entry.username}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setTransferTargetUserId(entry.userId)
                              setTransferTargetUsername(entry.username || t('atrium.manage.thisUser'))
                            }}
                            className="px-3 py-1 border border-nier-border/30 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors"
                          >
                            {t('atrium.manage.makeOwner')}
                          </button>
                          <button
                            onClick={() => demoteAdmin(entry.userId)}
                            className="px-3 py-1 border border-nier-red/40 text-nier-bg/80 text-xs tracking-[0.1em] uppercase hover:bg-nier-red/20 hover:text-nier-bg transition-colors"
                          >
                            {t('atrium.manage.demote')}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Save Settings -- visible on every tab so switching to Whitelist/
            Blacklist doesn't strand unsaved Settings-tab edits */}
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
