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
  const [showJoinById, setShowJoinById] = useState(false)
  const [lobbyIdInput, setLobbyIdInput] = useState('')
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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // Load public lobbies
      const { data: publicLobbies, error: publicError } = await supabase
        .from('lobbies')
        .select('*')
        .eq('is_public', true)
        .order('created_at', { ascending: false })
      
      if (publicError) throw publicError

      // Load private lobbies where user is whitelisted
      const { data: whitelistEntries, error: whitelistError } = await (supabase
        .from('lobby_access_lists')
        .select('lobby_id')
        .eq('user_id', user.id)
        .eq('list_type', 'whitelist') as any)
      
      if (whitelistError) throw whitelistError

      const whitelistedLobbyIds = whitelistEntries?.map((entry: any) => entry.lobby_id) || []
      
      let privateLobbies: any[] = []
      if (whitelistedLobbyIds.length > 0) {
        const { data: privateLobbyData, error: privateError } = await (supabase
          .from('lobbies')
          .select('*')
          .in('id', whitelistedLobbyIds)
          .eq('is_public', false) as any)
        
        if (!privateError) {
          privateLobbies = privateLobbyData || []
        }
      }

      // Load user's own lobbies
      const { data: ownedLobbies, error: ownedError } = await supabase
        .from('lobbies')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false })
      
      if (ownedError) throw ownedError
      
      // Get usernames and player counts
      const enrichedOwned = await enrichLobbiesWithData(ownedLobbies || [])
      setUserLobbies(enrichedOwned)

      // Combine public and whitelisted private lobbies, remove duplicates
      const allLobbies = [...(publicLobbies || []), ...privateLobbies]
      const uniqueLobbies = Array.from(new Map(allLobbies.map(lobby => [lobby.id, lobby])).values())
      const enrichedPublic = await enrichLobbiesWithData(uniqueLobbies)
      setLobbies(enrichedPublic)
      setLobbies(enrichedPublic)
    } catch (err: any) {
      console.error('Error loading lobbies:', err)
      setError(`Failed to load lobbies: ${err?.message || 'Unknown error'}`)
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

      const { data, error } = await (supabase!
        .from('lobbies') as any)
        .insert({
          name: newLobbyName,
          owner_user_id: user.id,
          password_hash: newLobbyPassword || null,
          is_public: newLobbyIsPublic,
          max_players: 50,
        })
        .select()
        .single()

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
      <div className="fixed inset-0 bg-nier-black flex items-center justify-center z-50">
        <div className="text-nier-bg text-sm tracking-[0.2em] uppercase animate-pulse">◇ Loading lobbies...</div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-nier-black/95 flex items-center justify-center z-50 p-4">
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
        }}
      />
      
      <div className="bg-nier-blackLight border border-nier-border/40 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col relative">
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-6 h-6 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-6 h-6 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-6 h-6 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-6 h-6 border-r border-b border-nier-border/60" />

        {/* Header */}
        <div className="p-6 border-b border-nier-border/20">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
                <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">Lobby Browser</h2>
              </div>
              <p className="text-nier-border/60 text-[10px] tracking-[0.1em] uppercase ml-5">Select destination</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-border hover:text-nier-bg hover:border-nier-border/60 transition-colors"
            >
              ×
            </button>
          </div>
          {error && (
            <div className="mt-4 text-nier-bg/80 text-xs tracking-wide border border-nier-red/40 bg-nier-red/10 px-4 py-2">
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Your Lobbies */}
          {userLobbies.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Your Lobbies</span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                <span className="text-nier-border/50 text-[10px]">{userLobbies.length}/3</span>
              </div>
              <div className="grid gap-3">
                {userLobbies.map(lobby => (
                  <div key={lobby.id} className="bg-nier-black border border-nier-border/20 p-4 hover:border-nier-border/40 transition-colors group">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="text-nier-bg text-sm tracking-wide">{lobby.name}</h4>
                        <div className="flex gap-4 mt-2 text-[10px] text-nier-border/60 tracking-wider uppercase">
                          <span>◇ {lobby.playerCount}/{lobby.maxPlayers} users</span>
                          <span>{lobby.isPublic ? '◦ Public' : '◦ Private'}</span>
                          {lobby.passwordHash && <span>◦ Secured</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onJoinLobby(lobby.id)}
                          className="px-4 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.1em] uppercase hover:bg-nier-bgDark transition-colors"
                        >
                          Enter
                        </button>
                        <button
                          onClick={() => deleteLobby(lobby.id)}
                          className="px-3 py-2 border border-nier-red/40 text-nier-border text-[10px] hover:bg-nier-red/20 hover:text-nier-bg transition-colors"
                        >
                          ×
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
            <div className="flex items-center gap-2 mb-4">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Create New</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              {!canCreateMore && (
                <span className="text-nier-red/60 text-[10px] tracking-wider">Limit reached</span>
              )}
            </div>
            
            {showCreateLobby ? (
              <div className="bg-nier-black border border-nier-border/30 p-5 space-y-4">
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Lobby Name</label>
                  <input
                    type="text"
                    value={newLobbyName}
                    onChange={(e) => setNewLobbyName(e.target.value)}
                    placeholder="Enter name..."
                    className="w-full bg-nier-blackLight border border-nier-border/30 text-nier-bg px-4 py-2 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                    maxLength={50}
                  />
                </div>
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Password (Optional)</label>
                  <input
                    type="password"
                    value={newLobbyPassword}
                    onChange={(e) => setNewLobbyPassword(e.target.value)}
                    placeholder="Leave empty for no password"
                    className="w-full bg-nier-blackLight border border-nier-border/30 text-nier-bg px-4 py-2 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                  />
                </div>
                <label className="flex items-center gap-3 text-nier-border text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${newLobbyIsPublic ? 'border-nier-bg bg-nier-bg' : 'border-nier-border/40 group-hover:border-nier-border/60'}`}>
                    {newLobbyIsPublic && <span className="text-nier-black text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={newLobbyIsPublic}
                    onChange={(e) => setNewLobbyIsPublic(e.target.checked)}
                    className="hidden"
                  />
                  <span className="tracking-wider uppercase text-[10px]">Public (visible in browser)</span>
                </label>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={createLobby}
                    className="flex-1 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
                  >
                    Create Lobby
                  </button>
                  <button
                    onClick={() => setShowCreateLobby(false)}
                    className="px-4 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCreateLobby(true)}
                disabled={!canCreateMore}
                className="w-full py-3 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ◇ Create New Lobby
              </button>
            )}
          </section>

          {/* Public Lobbies */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Available Lobbies</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              <span className="text-nier-border/50 text-[10px]">{lobbies.length} found</span>
              <button
                onClick={() => setShowJoinById(true)}
                className="px-3 py-1 border border-nier-border/30 text-nier-border text-[9px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors ml-2"
              >
                Join by ID
              </button>
            </div>
            <div className="grid gap-3">
              {lobbies.length === 0 ? (
                <div className="text-nier-border/40 text-center py-12 text-xs tracking-wider uppercase">No lobbies available</div>
              ) : (
                lobbies.map(lobby => (
                  <div key={lobby.id} className="bg-nier-black border border-nier-border/20 p-4 hover:border-nier-border/40 transition-colors">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="text-nier-bg text-sm tracking-wide">
                          {lobby.name}
                          {!lobby.isPublic && <span className="ml-2 text-nier-border/50 text-[9px]">[Private]</span>}
                        </h4>
                        <div className="flex gap-4 mt-2 text-[10px] text-nier-border/60 tracking-wider uppercase">
                          <span>◇ {lobby.ownerUsername}</span>
                          <span>◦ {lobby.playerCount}/{lobby.maxPlayers}</span>
                          {lobby.passwordHash && <span>◦ Secured</span>}
                          {!lobby.isPublic && <span>◦ Whitelisted</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleJoinClick(lobby)}
                        className="px-4 py-2 border border-nier-border/40 text-nier-bg text-[10px] tracking-[0.1em] uppercase hover:bg-nier-bg hover:text-nier-black transition-colors"
                      >
                        Enter
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
        <div className="absolute inset-0 bg-nier-black/80 flex items-center justify-center">
          <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
            
            <h3 className="text-nier-bg tracking-[0.15em] uppercase mb-4">◇ Password Required</h3>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              placeholder="Enter lobby password..."
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-3 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
              >
                Enter
              </button>
              <button
                onClick={() => {
                  setSelectedLobbyId(null)
                  setPasswordInput('')
                }}
                className="px-4 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join by ID Modal */}
      {showJoinById && (
        <div className="absolute inset-0 bg-nier-black/80 flex items-center justify-center">
          <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
            
            <h3 className="text-nier-bg tracking-[0.15em] uppercase mb-2">◇ Join by ID</h3>
            <p className="text-nier-border/60 text-[10px] tracking-wider mb-4">
              Enter the lobby ID shared with you by the lobby owner.
            </p>
            <input
              type="text"
              value={lobbyIdInput}
              onChange={(e) => setLobbyIdInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && lobbyIdInput && onJoinLobby(lobbyIdInput)}
              placeholder="Lobby ID (UUID)..."
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-3 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors mb-4 font-mono"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  if (lobbyIdInput) {
                    onJoinLobby(lobbyIdInput)
                    setShowJoinById(false)
                    setLobbyIdInput('')
                  }
                }}
                disabled={!lobbyIdInput}
                className="flex-1 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Enter
              </button>
              <button
                onClick={() => {
                  setShowJoinById(false)
                  setLobbyIdInput('')
                }}
                className="px-4 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
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
