import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Lobby } from '../types/database'

interface LobbyWithOwner extends Lobby {
  ownerUsername?: string
  playerCount?: number
}

interface LobbyBrowserProps {
  onJoinLobby: (lobbyId: string, password?: string) => void
  onClose: () => void
}

export function LobbyBrowser({ onJoinLobby, onClose }: LobbyBrowserProps) {
  const [lobbies, setLobbies] = useState<LobbyWithOwner[]>([])
  const [userLobbies, setUserLobbies] = useState<LobbyWithOwner[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateLobby, setShowCreateLobby] = useState(false)
  const [newLobbyName, setNewLobbyName] = useState('')
  const [newLobbyPassword, setNewLobbyPassword] = useState('')
  const [newLobbyIsPublic, setNewLobbyIsPublic] = useState(true)
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [canCreateMore, setCanCreateMore] = useState(true)

  useEffect(() => {
    loadLobbies()
    checkCanCreateLobby()
  }, [])

  const loadLobbies = async () => {
    if (!supabase) return
    
    setLoading(true)
    try {
      // Load public lobbies
      const { data: publicLobbies, error: publicError } = await supabase
        .from('lobbies')
        .select('*')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
      
      if (publicError) throw publicError

      // Load user's own lobbies
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: ownedLobbies, error: ownedError } = await supabase
          .from('lobbies')
          .select('*')
          .eq('owner_user_id', user.id)
          .order('created_at', { ascending: false })
        
        if (ownedError) throw ownedError
        
        // Get usernames and player counts
        const enrichedOwned = await enrichLobbiesWithData(ownedLobbies || [])
        setUserLobbies(enrichedOwned)
      }

      const enrichedPublic = await enrichLobbiesWithData(publicLobbies || [])
      setLobbies(enrichedPublic)
    } catch (err) {
      console.error('Error loading lobbies:', err)
      setError('Failed to load lobbies')
    } finally {
      setLoading(false)
    }
  }

  const enrichLobbiesWithData = async (lobbies: any[]): Promise<LobbyWithOwner[]> => {
    if (!supabase || lobbies.length === 0) return []

    const enriched = await Promise.all(lobbies.map(async (lobby) => {
      // Get owner username
      const { data: profile } = await (supabase!
        .from('profiles')
        .select('username')
        .eq('id', lobby.owner_user_id)
        .single() as any)
      
      // Get player count
      const { count } = await (supabase!
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('active_lobby_id', lobby.id) as any)

      return {
        id: lobby.id,
        name: lobby.name,
        ownerUserId: lobby.owner_user_id,
        passwordHash: lobby.password_hash,
        maxPlayers: lobby.max_players,
        isPublic: lobby.is_public,
        createdAt: lobby.created_at,
        updatedAt: lobby.updated_at,
        ownerUsername: profile?.username || 'Unknown',
        playerCount: count || 0,
      }
    }))

    return enriched
  }

  const checkCanCreateLobby = async () => {
    if (!supabase) return
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await (supabase as any).rpc('get_user_lobby_count', {
      p_user_id: user.id
    })

    if (!error && typeof data === 'number') {
      setCanCreateMore(data < 3)
    }
  }

  const createLobby = async () => {
    if (!supabase) return
    if (newLobbyName.length < 3) {
      setError('Lobby name must be at least 3 characters')
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Check lobby count
      const { data: count } = await (supabase as any).rpc('get_user_lobby_count', {
        p_user_id: user.id
      })

      if (count && count >= 3) {
        setError('You can only create up to 3 lobbies')
        return
      }

      const { data, error } = await (supabase
        .from('lobbies')
        .insert({
          name: newLobbyName,
          owner_user_id: user.id,
          password_hash: newLobbyPassword || null,
          is_public: newLobbyIsPublic,
          max_players: 50,
        })
        .select()
        .single() as any)

      if (error) throw error

      // Join the newly created lobby
      onJoinLobby(data.id)
      setShowCreateLobby(false)
      setNewLobbyName('')
      setNewLobbyPassword('')
      setNewLobbyIsPublic(true)
    } catch (err: any) {
      console.error('Error creating lobby:', err)
      setError(err.message || 'Failed to create lobby')
    }
  }

  const handleJoinClick = (lobby: LobbyWithOwner) => {
    if (lobby.passwordHash) {
      setSelectedLobbyId(lobby.id)
    } else {
      onJoinLobby(lobby.id)
    }
  }

  const handlePasswordSubmit = () => {
    if (selectedLobbyId) {
      onJoinLobby(selectedLobbyId, passwordInput)
      setPasswordInput('')
      setSelectedLobbyId(null)
    }
  }

  const deleteLobby = async (lobbyId: string) => {
    if (!supabase) return
    if (!confirm('Are you sure you want to delete this lobby? All traces will be lost.')) return

    try {
      const { error } = await supabase
        .from('lobbies')
        .delete()
        .eq('id', lobbyId)

      if (error) throw error

      loadLobbies()
      checkCanCreateLobby()
    } catch (err) {
      console.error('Error deleting lobby:', err)
      setError('Failed to delete lobby')
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="text-white text-xl">Loading lobbies...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-lobby-dark border-2 border-lobby-accent rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-lobby-accent/30">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-lobby-accent">🌐 Lobby Browser</h2>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Your Lobbies */}
          {userLobbies.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold text-lobby-accent mb-3">Your Lobbies ({userLobbies.length}/3)</h3>
              <div className="grid gap-3">
                {userLobbies.map(lobby => (
                  <div key={lobby.id} className="bg-lobby-darker border border-lobby-accent/30 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="text-white font-semibold text-lg">{lobby.name}</h4>
                        <div className="flex gap-4 mt-2 text-sm text-white/60">
                          <span>👥 {lobby.playerCount}/{lobby.maxPlayers}</span>
                          <span>{lobby.isPublic ? '🌍 Public' : '🔒 Private'}</span>
                          {lobby.passwordHash && <span>🔑 Password</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onJoinLobby(lobby.id)}
                          className="px-4 py-2 bg-lobby-accent text-lobby-dark rounded hover:bg-lobby-accent/80 font-semibold"
                        >
                          Join
                        </button>
                        <button
                          onClick={() => deleteLobby(lobby.id)}
                          className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Create Lobby */}
          <section>
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold text-lobby-accent">Create New Lobby</h3>
              {!canCreateMore && (
                <span className="text-sm text-red-400">Maximum 3 lobbies reached</span>
              )}
            </div>
            
            {showCreateLobby ? (
              <div className="bg-lobby-darker border border-lobby-accent/30 rounded-lg p-4 space-y-3">
                <input
                  type="text"
                  value={newLobbyName}
                  onChange={(e) => setNewLobbyName(e.target.value)}
                  placeholder="Lobby name..."
                  className="w-full bg-lobby-dark text-white border border-lobby-accent/30 rounded px-3 py-2"
                  maxLength={50}
                />
                <input
                  type="password"
                  value={newLobbyPassword}
                  onChange={(e) => setNewLobbyPassword(e.target.value)}
                  placeholder="Password (optional)"
                  className="w-full bg-lobby-dark text-white border border-lobby-accent/30 rounded px-3 py-2"
                />
                <label className="flex items-center gap-2 text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newLobbyIsPublic}
                    onChange={(e) => setNewLobbyIsPublic(e.target.checked)}
                    className="w-4 h-4"
                  />
                  Public (visible in lobby browser)
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={createLobby}
                    className="flex-1 px-4 py-2 bg-lobby-accent text-lobby-dark rounded hover:bg-lobby-accent/80 font-semibold"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setShowCreateLobby(false)}
                    className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCreateLobby(true)}
                disabled={!canCreateMore}
                className="w-full px-4 py-3 bg-lobby-accent/20 text-lobby-accent border border-lobby-accent/30 rounded hover:bg-lobby-accent/30 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                + Create New Lobby
              </button>
            )}
          </section>

          {/* Public Lobbies */}
          <section>
            <h3 className="text-lg font-semibold text-lobby-accent mb-3">Public Lobbies ({lobbies.length})</h3>
            <div className="grid gap-3">
              {lobbies.length === 0 ? (
                <div className="text-white/60 text-center py-8">No public lobbies available</div>
              ) : (
                lobbies.map(lobby => (
                  <div key={lobby.id} className="bg-lobby-darker border border-lobby-accent/30 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="text-white font-semibold text-lg">{lobby.name}</h4>
                        <div className="flex gap-4 mt-2 text-sm text-white/60">
                          <span>👤 {lobby.ownerUsername}</span>
                          <span>👥 {lobby.playerCount}/{lobby.maxPlayers}</span>
                          {lobby.passwordHash && <span>🔑 Password</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleJoinClick(lobby)}
                        className="px-4 py-2 bg-lobby-accent text-lobby-dark rounded hover:bg-lobby-accent/80 font-semibold"
                      >
                        Join
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Password Modal */}
      {selectedLobbyId && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-lobby-dark border-2 border-lobby-accent rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-xl font-bold text-lobby-accent mb-4">🔑 Password Required</h3>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              placeholder="Enter lobby password..."
              className="w-full bg-lobby-darker text-white border border-lobby-accent/30 rounded px-3 py-2 mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 px-4 py-2 bg-lobby-accent text-lobby-dark rounded hover:bg-lobby-accent/80 font-semibold"
              >
                Join
              </button>
              <button
                onClick={() => {
                  setSelectedLobbyId(null)
                  setPasswordInput('')
                }}
                className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
