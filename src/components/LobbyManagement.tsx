import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Lobby, LobbyAccessList, Profile } from '../types/database'

interface LobbyManagementProps {
  lobby: Lobby
  onClose: () => void
  onUpdate: () => void
}

export function LobbyManagement({ lobby, onClose, onUpdate }: LobbyManagementProps) {
  const [lobbyName, setLobbyName] = useState(lobby.name)
  const [password, setPassword] = useState('')
  const [isPublic, setIsPublic] = useState(lobby.isPublic)
  const [whitelist, setWhitelist] = useState<(LobbyAccessList & { username?: string })[]>([])
  const [blacklist, setBlacklist] = useState<(LobbyAccessList & { username?: string })[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Profile[]>([])
  const [activeTab, setActiveTab] = useState<'settings' | 'whitelist' | 'blacklist'>('settings')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAccessLists()
  }, [])

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

      // Enrich with usernames
      const enrichWhitelist = await enrichWithUsernames(whitelistData || [])
      const enrichBlacklist = await enrichWithUsernames(blacklistData || [])

      setWhitelist(enrichWhitelist)
      setBlacklist(enrichBlacklist)
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
        username: profile?.username || 'Unknown',
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

  const updateLobbySettings = async () => {
    if (!supabase) return

    try {
      const trimmedPassword = password.trim()
      const updates: any = {
        name: lobbyName,
        is_public: isPublic,
        // Set password_hash to null if empty (makes lobby public), otherwise set the password
        password_hash: trimmedPassword || null,
      }

      const { error } = await (supabase!
        .from('lobbies') as any)
        .update(updates)
        .eq('id', lobby.id)

      if (error) throw error

      onUpdate()
      setError(null)
      alert('Atrium settings updated!')
    } catch (err: any) {
      console.error('Error updating lobby:', err)
      setError(err.message || 'Failed to update lobby')
    }
  }

  const addToList = async (userId: string, listType: 'whitelist' | 'blacklist') => {
    if (!supabase) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

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
      setError(err.message || 'Failed to add user')
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
      setError(err.message || 'Failed to remove user')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-lobby-dark border-2 border-lobby-accent rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-lobby-accent/30">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-lobby-accent">⚙️ Manage Atrium</h2>
            <button
              onClick={onClose}
              className="text-white/60 hover:text-white text-2xl leading-none"
            >
              ×
            </button>
          </div>
          {error && (
            <div className="mt-3 text-red-400 text-sm bg-red-900/20 border border-red-500/30 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-lobby-accent/30">
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 px-4 py-3 font-semibold ${
              activeTab === 'settings'
                ? 'bg-lobby-accent/20 text-lobby-accent border-b-2 border-lobby-accent'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Settings
          </button>
          <button
            onClick={() => setActiveTab('whitelist')}
            className={`flex-1 px-4 py-3 font-semibold ${
              activeTab === 'whitelist'
                ? 'bg-lobby-accent/20 text-lobby-accent border-b-2 border-lobby-accent'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Whitelist ({whitelist.length})
          </button>
          <button
            onClick={() => setActiveTab('blacklist')}
            className={`flex-1 px-4 py-3 font-semibold ${
              activeTab === 'blacklist'
                ? 'bg-lobby-accent/20 text-lobby-accent border-b-2 border-lobby-accent'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            Blacklist ({blacklist.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'settings' && (
            <div className="space-y-4">
              <div>
                <label className="block text-white mb-2">Atrium Name</label>
                <input
                  type="text"
                  value={lobbyName}
                  onChange={(e) => setLobbyName(e.target.value)}
                  className="w-full bg-lobby-darker text-white border border-lobby-accent/30 rounded px-3 py-2"
                  maxLength={50}
                />
              </div>

              <div>
                <label className="block text-white mb-2">Password (leave empty to remove)</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password..."
                  className="w-full bg-lobby-darker text-white border border-lobby-accent/30 rounded px-3 py-2"
                />
              </div>

              <label className="flex items-center gap-2 text-white cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="w-4 h-4"
                />
                Public (visible in lobby browser)
              </label>

              <button
                onClick={updateLobbySettings}
                className="w-full px-4 py-3 bg-lobby-accent text-lobby-dark rounded hover:bg-lobby-accent/80 font-semibold"
              >
                Save Settings
              </button>
            </div>
          )}

          {(activeTab === 'whitelist' || activeTab === 'blacklist') && (
            <div className="space-y-4">
              {/* Search Users */}
              <div>
                <label className="block text-white mb-2">Add User</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && searchUsers()}
                    placeholder="Search username..."
                    className="flex-1 bg-lobby-darker text-white border border-lobby-accent/30 rounded px-3 py-2"
                  />
                  <button
                    onClick={searchUsers}
                    className="px-4 py-2 bg-lobby-accent text-lobby-dark rounded hover:bg-lobby-accent/80 font-semibold"
                  >
                    Search
                  </button>
                </div>

                {/* Search Results */}
                {searchResults.length > 0 && (
                  <div className="mt-2 bg-lobby-darker border border-lobby-accent/30 rounded max-h-40 overflow-y-auto">
                    {searchResults.map(user => (
                      <div
                        key={user.id}
                        className="flex justify-between items-center px-3 py-2 hover:bg-white/5"
                      >
                        <span className="text-white">{user.username}</span>
                        <button
                          onClick={() => addToList(user.id, activeTab)}
                          className="px-3 py-1 bg-lobby-accent/20 text-lobby-accent rounded text-sm hover:bg-lobby-accent/30"
                        >
                          Add
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Current List */}
              <div>
                <h3 className="text-white font-semibold mb-2">
                  {activeTab === 'whitelist' ? 'Whitelisted Users' : 'Blacklisted Users'}
                </h3>
                <div className="space-y-2">
                  {(activeTab === 'whitelist' ? whitelist : blacklist).length === 0 ? (
                    <div className="text-white/60 text-center py-4">No users in this list</div>
                  ) : (
                    (activeTab === 'whitelist' ? whitelist : blacklist).map(entry => (
                      <div
                        key={entry.id}
                        className="flex justify-between items-center bg-lobby-darker border border-lobby-accent/30 rounded px-3 py-2"
                      >
                        <span className="text-white">{entry.username}</span>
                        <button
                          onClick={() => removeFromList(entry.id)}
                          className="px-3 py-1 bg-red-600/20 text-red-400 rounded text-sm hover:bg-red-600/30"
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
