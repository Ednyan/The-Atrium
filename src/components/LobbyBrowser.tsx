import { useEffect, useState, useMemo } from 'react'
import { supabase, isDesktop } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import ImportAtrium from './ImportAtrium'
import { LobbyManagement } from './LobbyManagement'
import { ReportFeedbackModal } from './ReportFeedbackModal'
import DownloadAtriumPanel, { type DownloadableAtrium } from './DownloadAtriumPanel'
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
  // Lobbies the current user administers but doesn't own -- admins get the
  // same in-atrium management permissions (whitelist/blacklist/editors/
  // settings, everything except the owner-only Admins tab) from the browser
  // too, without needing to enter the atrium first.
  const [adminLobbies, setAdminLobbies] = useState<LobbyWithOwner[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateLobby, setShowCreateLobby] = useState(false)
  const [managingLobbyId, setManagingLobbyId] = useState<string | null>(null)
  const [showJoinById, setShowJoinById] = useState(false)
  const [lobbyIdInput, setLobbyIdInput] = useState('')
  const [newLobbyName, setNewLobbyName] = useState('')
  const [newLobbyPassword, setNewLobbyPassword] = useState('')
  const [newLobbyIsPublic, setNewLobbyIsPublic] = useState(true)
  const [selectedLobbyId, setSelectedLobbyId] = useState<string | null>(null)
  const [passwordInput, setPasswordInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [canCreateMore, setCanCreateMore] = useState(true)
  const [editingLobbyId, setEditingLobbyId] = useState<string | null>(null)
  const [editingLobbyName, setEditingLobbyName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [joinByIdError, setJoinByIdError] = useState<string | null>(null)
  const [joinByIdLoading, setJoinByIdLoading] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [showReportForm, setShowReportForm] = useState(false)
  const { username } = useGameStore()
  const [vaultBusy, setVaultBusy] = useState(false)
  const [vaultError, setVaultError] = useState<string | null>(null)

  const toggleFullscreen = async () => {
    if (isDesktop) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const current = await win.isFullscreen()
      await win.setFullscreen(!current)
      setIsFullscreen(!current)
    } else {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
        setIsFullscreen(true)
      } else {
        await document.exitFullscreen()
        setIsFullscreen(false)
      }
    }
  }

  // Memoize particle positions (fireflies)
  const particles = useMemo(() => 
    [...Array(15)].map((_, i) => ({
      left: `${(i * 17 + 3) % 96}%`,
      top: `${(i * 23 + 5) % 94}%`,
      duration: 8 + (i * 1.5) % 6,
      delay: i * 0.5,
    })), []
  )

  // Memoize background rectangles (trace-like elements)
  const backgroundRects = useMemo(() => 
    [...Array(10)].map((_, i) => ({
      left: `${(i * 19 + 7) % 90}%`,
      top: `${(i * 31 + 12) % 85}%`,
      width: 30 + (i * 17) % 80,
      height: 15 + (i * 13) % 40,
      rotation: (i * 7) % 15 - 7,
      delay: i * 0.3,
    })), []
  )

  // Initial load and clear active_lobby_id (user is browsing, not in a lobby)
  useEffect(() => {
    const clearAndLoad = async () => {
      // Clear user's active_lobby_id since they're in the browser (not in a lobby)
      if (supabase) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await (supabase
            .from('profiles') as any)
            .update({ active_lobby_id: null })
            .eq('id', user.id)
        }
      }
      
      loadLobbies()
      checkCanCreateLobby()
    }
    
    clearAndLoad()
  }, [])

  useEffect(() => {
    if (!isDesktop) return

    let cancelled = false

    import('../lib/localDb')
      .then(async ({ getVaultBasePath }) => {
        const path = await getVaultBasePath()
        if (!cancelled) {
          setVaultPath(path)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setVaultError(err instanceof Error ? err.message : 'Failed to load vault folder')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])
  
  // Refresh player counts every 10 minutes
  useEffect(() => {
    const refreshInterval = setInterval(async () => {
      if (!supabase) return
      
      // Refresh player counts for all lobbies
      const refreshCounts = async (currentLobbies: LobbyWithOwner[]): Promise<LobbyWithOwner[]> => {
        if (currentLobbies.length === 0) return currentLobbies
        
        const updated = await Promise.all(currentLobbies.map(async (lobby) => {
          const { count } = await (supabase!
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('active_lobby_id', lobby.id) as any)
          
          const newCount = count || 0
          // Only update if count changed
          if (newCount !== lobby.playerCount) {
            return { ...lobby, playerCount: newCount }
          }
          return lobby
        }))
        return updated
      }
      
      setLobbies(prev => {
        refreshCounts(prev).then(updated => {
          if (JSON.stringify(updated) !== JSON.stringify(prev)) {
            setLobbies(updated)
          }
        })
        return prev
      })
      
      setUserLobbies(prev => {
        refreshCounts(prev).then(updated => {
          if (JSON.stringify(updated) !== JSON.stringify(prev)) {
            setUserLobbies(updated)
          }
        })
        return prev
      })
    }, 30 * 1000) // 30 seconds
    
    return () => clearInterval(refreshInterval)
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

      // The platform operator browses every atrium, so it skips the
      // public + whitelisted pair below and asks for the lot.
      //
      // RLS alone was never enough here: it governs which rows are *readable*,
      // while this function decides which rows are *requested*. Widening the
      // lobbies SELECT policy for the operator therefore changed nothing
      // visible until this query stopped filtering on is_public itself.
      let isPlatformAdmin = false
      if (!isDesktop) {
        try {
          const { data } = await (supabase as any).rpc('is_platform_admin')
          isPlatformAdmin = !!data
        } catch {
          // Function not deployed: browse as a normal user.
        }
      }

      let publicLobbies: any[] = []
      let privateLobbies: any[] = []

      if (isPlatformAdmin) {
        const { data: everyLobby, error: everyError } = await supabase
          .from('lobbies')
          .select('*')
          .order('created_at', { ascending: false })

        if (everyError) throw everyError
        publicLobbies = everyLobby || []
      } else {
        // Load public lobbies
        const { data: publicData, error: publicError } = await supabase
          .from('lobbies')
          .select('*')
          .eq('is_public', true)
          .order('created_at', { ascending: false })

        if (publicError) throw publicError
        publicLobbies = publicData || []

        // Load private lobbies where user is whitelisted
        const { data: whitelistEntries, error: whitelistError } = await (supabase
          .from('lobby_access_lists')
          .select('lobby_id')
          .eq('user_id', user.id)
          .eq('list_type', 'whitelist') as any)

        if (whitelistError) throw whitelistError

        const whitelistedLobbyIds = whitelistEntries?.map((entry: any) => entry.lobby_id) || []

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

      // Load lobbies the user administers but doesn't own -- these get the
      // same "Manage" affordance as owned atriums (just without the
      // owner-only Admins tab), so an admin doesn't have to enter the
      // atrium first to change its settings/whitelist/blacklist/editors.
      //
      // Web only. Administering someone else's atrium is inherently a
      // multi-user idea, and desktop's single local user owns everything in
      // its own vault, so there's nothing for this to find there. It also
      // uses .contains(), which the desktop SQLite shim doesn't implement --
      // that threw a TypeError rather than returning an error, so it escaped
      // the adminError check below and aborted loadLobbies entirely, leaving
      // the browser empty and showing "contains is not a function" instead of
      // the user's own local atriums.
      //
      // Wrapped defensively as well as gated: this list is supplementary, and
      // failing to load it should never take the whole browser down with it.
      if (!isDesktop) {
        try {
          const { data: adminLobbyData, error: adminError } = await (supabase
            .from('lobbies') as any)
            .select('*')
            .contains('admin_user_ids', [user.id])
            .neq('owner_user_id', user.id)
            .order('created_at', { ascending: false })

          if (!adminError) {
            const enrichedAdmin = await enrichLobbiesWithData(adminLobbyData || [])
            setAdminLobbies(enrichedAdmin)
          }
        } catch (adminErr) {
          console.error('Error loading administered atriums:', adminErr)
        }
      }

      // Combine public and whitelisted private lobbies, remove duplicates
      const allLobbies = [...publicLobbies, ...privateLobbies]
      const uniqueLobbies = Array.from(new Map(allLobbies.map(lobby => [lobby.id, lobby])).values())
      const enrichedPublic = await enrichLobbiesWithData(uniqueLobbies)
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

      // Check if lobby has password (using RPC since password_hash may not be visible to non-owners)
      const { data: hasPassword } = await (supabase as any).rpc('lobby_has_password', {
        p_lobby_id: lobby.id
      })

      return {
        id: lobby.id,
        name: lobby.name,
        ownerUserId: lobby.owner_user_id,
        passwordHash: hasPassword ? 'protected' : null, // Use hasPassword from RPC instead of raw password_hash
        maxPlayers: lobby.max_players,
        isPublic: lobby.is_public,
        createdAt: lobby.created_at,
        updatedAt: lobby.updated_at,
        autosaveEnabled: lobby.autosave_enabled ?? false,
        autosaveIntervalSeconds: lobby.autosave_interval_seconds,
        adminUserIds: lobby.admin_user_ids ?? [],
        editPermissionMode: lobby.edit_permission_mode ?? 'all',
        ownerUsername: profile?.username || 'Unknown',
        playerCount: count || 0,
      }
    }))

    return enriched
  }

  const checkCanCreateLobby = async () => {
    if (!supabase) return

    if (isDesktop) {
      setCanCreateMore(true)
      return
    }
    
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

      if (!isDesktop) {
        const { data: count } = await (supabase as any).rpc('get_user_lobby_count', {
          p_user_id: user.id
        })

        if (count && count >= 3) {
          setError('You can only create up to 3 lobbies')
          return
        }
      }

      const softSepiaTheme = {
        gridColor: '#9c9681',
        gridOpacity: 0.24,
        backgroundColor: '#1a1a18',
        particlesEnabled: true,
        particleColor: '#dad4bb',
        particleOpacity: 0.45,
        particleDensity: 0.8,
        groundParticlesEnabled: false,
        groundParticleOpacity: 0.82,
        groundPatternMode: 'grid',
        gridSpacing: 125,
        groundElementScale: 0.06,
        groundElementScaleRange: 0.02,
        groundElementDensity: 0.55,
      }

      const { data, error } = await (supabase!
        .from('lobbies') as any)
        .insert({
          name: newLobbyName,
          owner_user_id: user.id,
          password_hash: newLobbyPassword || null,
          is_public: newLobbyIsPublic,
          max_players: 50,
          theme_settings: softSepiaTheme,
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

  const handleJoinClick = async (lobby: LobbyWithOwner) => {
    if (!supabase) return
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Check user's access status for this lobby
      const { data: accessStatus, error: accessError } = await (supabase as any).rpc('get_user_lobby_access_status', {
        p_lobby_id: lobby.id,
        p_user_id: user.id
      })

      console.log('Access status:', accessStatus, 'Error:', accessError)

      // If blacklisted, show error
      if (accessStatus === 'blacklisted') {
        setError('You have been blocked from entering this atrium')
        return
      }

      // Owner or admin always skip the password -- everyone else (including
      // a plain whitelisted user, who can enter a private atrium but still
      // isn't trusted with its password) falls through to the password
      // check below like a normal visitor would.
      if (accessStatus === 'owner' || accessStatus === 'admin') {
        onJoinLobby(lobby.id)
        return
      }

      // Check if lobby has password - use RPC or fallback to lobby.passwordHash
      const { data: hasPassword, error: pwError } = await (supabase as any).rpc('lobby_has_password', {
        p_lobby_id: lobby.id
      })

      console.log('Has password RPC result:', hasPassword, 'Error:', pwError)

      // Use RPC result, or fallback to lobby.passwordHash if RPC fails
      const needsPassword = hasPassword === true || (pwError && lobby.passwordHash)

      if (needsPassword) {
        // Show password prompt
        console.log('Showing password prompt')
        setPasswordInput('') // Clear any previous input
        setSelectedLobbyId(lobby.id)
      } else {
        // No password required, join directly
        console.log('Joining directly (no password)')
        onJoinLobby(lobby.id)
      }
    } catch (err) {
      console.error('Error checking lobby access:', err)
      setError('Failed to check atrium access')
    }
  }

  const handlePasswordSubmit = () => {
    if (selectedLobbyId) {
      onJoinLobby(selectedLobbyId, passwordInput)
      setPasswordInput('')
      setSelectedLobbyId(null)
    }
  }

  // Handle Join by ID with proper access checks
  const handleJoinById = async () => {
    if (!supabase || !lobbyIdInput.trim()) return
    
    const lobbyId = lobbyIdInput.trim()
    setJoinByIdError(null)
    setJoinByIdLoading(true)
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setJoinByIdError('Not authenticated')
        setJoinByIdLoading(false)
        return
      }

      // First check if lobby exists
      const { data: lobby, error: lobbyError } = await (supabase as any)
        .from('lobbies')
        .select('id, name')
        .eq('id', lobbyId)
        .single()
      
      if (lobbyError || !lobby) {
        setJoinByIdError('Atrium not found. Please check the ID.')
        setJoinByIdLoading(false)
        return
      }

      // Check user's access status for this lobby
      const { data: accessStatus } = await (supabase as any).rpc('get_user_lobby_access_status', {
        p_lobby_id: lobbyId,
        p_user_id: user.id
      })

      // If blacklisted, show error
      if (accessStatus === 'blacklisted') {
        setJoinByIdError('You have been blocked from this atrium')
        setJoinByIdLoading(false)
        return
      }

      // Owner or admin always skip the password -- a plain whitelisted user
      // can still enter a private atrium by ID, but falls through to the
      // password check below like anyone else would.
      if (accessStatus === 'owner' || accessStatus === 'admin') {
        setShowJoinById(false)
        setLobbyIdInput('')
        setJoinByIdLoading(false)
        onJoinLobby(lobbyId)
        return
      }

      // Check if lobby has password
      const { data: hasPassword } = await (supabase as any).rpc('lobby_has_password', {
        p_lobby_id: lobbyId
      })

      if (hasPassword) {
        // Close join by ID modal and show password prompt
        setShowJoinById(false)
        setLobbyIdInput('')
        setJoinByIdLoading(false)
        setPasswordInput('')
        setSelectedLobbyId(lobbyId)
      } else {
        // No password required, join directly
        setShowJoinById(false)
        setLobbyIdInput('')
        setJoinByIdLoading(false)
        onJoinLobby(lobbyId)
      }
    } catch (err) {
      console.error('Error joining by ID:', err)
      setJoinByIdError('Failed to join atrium')
      setJoinByIdLoading(false)
    }
  }

  const deleteLobby = async (lobbyId: string) => {
    if (!supabase) return

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
    } finally {
      setDeleteConfirmId(null)
    }
  }

  const chooseVaultFolder = async () => {
    if (!isDesktop) return

    setVaultError(null)
    setVaultBusy(true)

    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: vaultPath ?? undefined,
        title: 'Choose Digital Atrium Vault Folder',
      })

      if (typeof selected !== 'string') {
        return
      }

      const { setVaultBasePath } = await import('../lib/localDb')
      const nextVaultPath = await setVaultBasePath(selected)
      setVaultPath(nextVaultPath)
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Failed to update vault folder')
    } finally {
      setVaultBusy(false)
    }
  }

  const renameLobby = async (lobbyId: string, newName: string) => {
    if (!supabase || !newName.trim()) return
    
    try {
      const { error } = await (supabase
        .from('lobbies') as any)
        .update({ name: newName.trim() })
        .eq('id', lobbyId)

      if (error) throw error

      // Update local state for user lobbies
      setUserLobbies(prev => prev.map(l => 
        l.id === lobbyId ? { ...l, name: newName.trim() } : l
      ))
      // Also update the available servers list
      setLobbies(prev => prev.map(l => 
        l.id === lobbyId ? { ...l, name: newName.trim() } : l
      ))
      setEditingLobbyId(null)
      setEditingLobbyName('')
    } catch (err) {
      console.error('Error renaming lobby:', err)
      setError('Failed to rename atrium')
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center z-50 font-mono px-4">
        <div className="relative px-[5vw] sm:px-10 py-[3vw] sm:py-6">
          <div className="absolute top-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-l border-white/40" />
          <div className="absolute top-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-t border-r border-white/40" />
          <div className="absolute bottom-0 left-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-l border-white/40" />
          <div className="absolute bottom-0 right-0 w-[2vw] sm:w-4 h-[2vw] sm:h-4 border-b border-r border-white/40" />
          <p className="text-white text-[clamp(9px,2.5vw,13px)] tracking-[0.25em] uppercase mb-4 text-center">Loading Atriums</p>
          <div className="w-[40vw] sm:w-48 h-[3px] bg-white/10 overflow-hidden mx-auto">
            <div className="h-full bg-white/80 animate-nier-slide" />
          </div>
          <p className="text-gray-500 text-[clamp(7px,1.8vw,10px)] tracking-[0.2em] uppercase mt-3 text-center">◇ Please wait</p>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-nier-black flex items-center justify-center z-50 p-4">
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-40"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(203, 203, 203, 0.1) 2px, rgba(203, 203, 203, 0.1) 4px)',
        }}
      />

      {/* Animated background grid */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-10"
        style={{
          backgroundImage: `
            linear-gradient(rgba(203, 203, 203, 0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(203, 203, 203, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Background rectangles (trace-like elements) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {backgroundRects.map((rect, i) => (
          <div
            key={i}
            className="absolute border border-nier-border/[0.08] bg-nier-border/[0.02]"
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              transform: `rotate(${rect.rotation}deg)`,
              animation: `rectFloat ${12 + i % 5}s ease-in-out infinite`,
              animationDelay: `${rect.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Floating particles (fireflies) */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {particles.map((particle, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-nier-border rounded-full opacity-0"
            style={{
              left: particle.left,
              top: particle.top,
              animation: `firefly ${particle.duration}s ease-in-out infinite`,
              animationDelay: `${particle.delay}s`,
            }}
          />
        ))}
      </div>
      
      <div className="bg-nier-blackLight border border-nier-border/40 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col relative z-10">
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
                <h2 className="text-lg text-white tracking-[0.15em] uppercase">Atrium Browser</h2>
              </div>
              <p className="text-nier-border/60 text-[10px] tracking-[0.1em] uppercase ml-5">Select destination</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={toggleFullscreen}
                className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-border hover:text-nier-bg hover:border-nier-border/60 transition-colors"
                title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? '⊡' : '⊞'}
              </button>
              <button
                onClick={loadLobbies}
                disabled={loading}
                className="px-3 h-8 flex items-center justify-center gap-2 border border-nier-border/30 text-nier-border text-[9px] tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors disabled:opacity-50"
              >
                <span className={loading ? 'animate-spin' : ''}>↻</span>
                Refresh
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center border border-nier-border/30 text-nier-border hover:text-nier-bg hover:border-nier-border/60 transition-colors"
              >
                ×
              </button>
            </div>
          </div>
          {isDesktop && (
            <div className="mt-4 border border-nier-border/20 bg-nier-black/60 px-4 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-nier-border text-[9px] tracking-[0.15em] uppercase mb-1">Desktop Vault</div>
                  <p className="text-nier-border/75 text-[10px] tracking-wide break-all">
                    {vaultPath || 'Preparing local atrium vault...'}
                  </p>
                  <p className="text-nier-border/45 text-[9px] tracking-wide mt-2">
                    Each atrium is mirrored into its own folder with an atrium.json file and copied local media.
                  </p>
                </div>
                <button
                  onClick={chooseVaultFolder}
                  disabled={vaultBusy}
                  className="px-3 h-8 shrink-0 flex items-center justify-center border border-nier-border/30 text-nier-border text-[9px] tracking-[0.1em] uppercase hover:text-nier-bg hover:border-nier-border/60 transition-colors disabled:opacity-50"
                >
                  {vaultBusy ? 'Syncing...' : 'Change Folder'}
                </button>
              </div>
              {vaultError && (
                <p className="text-[9px] tracking-wide mt-3" style={{ color: '#FF6161' }}>{vaultError}</p>
              )}
            </div>
          )}
          {error && (
            <div className="mt-4 text-xs tracking-wide border border-nier-red/40 bg-nier-red/10 px-4 py-2" style={{ color: '#FF6161' }}>
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Create Lobby */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Create New</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              {!canCreateMore && (
                <span className="text-[10px] tracking-wider" style={{ color: '#FF6161' }}>Limit reached</span>
              )}
            </div>

            {showCreateLobby ? (
              <div className="bg-nier-black border border-nier-border/30 p-5 space-y-4">
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Atrium Name</label>
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
                  <span className="tracking-wider uppercase text-[10px]">{isDesktop ? 'Local Public (visible to others on this PC)' : 'Public (visible in browser)'}</span>
                </label>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={createLobby}
                    className="flex-1 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors"
                  >
                    Create Atrium
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
                ◇ Create New Atrium
              </button>
            )}
          </section>

          {/* Your Atriums */}
          {userLobbies.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Your Atriums</span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
                <span className="text-nier-border/50 text-[10px]">{userLobbies.length}/3</span>
              </div>
              <div className="grid gap-3">
                {userLobbies.map(lobby => (
                  <div key={lobby.id} className="bg-nier-black border border-nier-border/20 p-4 hover:border-nier-border/40 transition-colors group">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        {editingLobbyId === lobby.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={editingLobbyName}
                              onChange={(e) => setEditingLobbyName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  renameLobby(lobby.id, editingLobbyName)
                                } else if (e.key === 'Escape') {
                                  setEditingLobbyId(null)
                                  setEditingLobbyName('')
                                }
                              }}
                              className="bg-nier-blackLight border border-nier-border/40 text-nier-bg px-2 py-1 text-sm tracking-wide focus:border-nier-border/60 transition-colors"
                              autoFocus
                              maxLength={50}
                            />
                            <button
                              onClick={() => renameLobby(lobby.id, editingLobbyName)}
                              className="text-nier-border/60 hover:text-nier-bg text-xs"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => {
                                setEditingLobbyId(null)
                                setEditingLobbyName('')
                              }}
                              className="text-nier-border/60 hover:text-nier-bg text-xs"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <h4 className="text-nier-bg text-sm tracking-wide">{lobby.name}</h4>
                            <button
                              onClick={() => {
                                setEditingLobbyId(lobby.id)
                                setEditingLobbyName(lobby.name)
                              }}
                              className="text-nier-border/40 hover:text-nier-border text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Rename"
                            >
                              ✎
                            </button>
                          </div>
                        )}
                        <div className="flex gap-4 mt-2 text-[10px] text-nier-border/60 tracking-wider uppercase">
                          <span>◇ {lobby.playerCount}/{lobby.maxPlayers} users</span>
                          <span>{lobby.isPublic ? (isDesktop ? '◦ Local Public' : '◦ Public') : (isDesktop ? '◦ Local Private' : '◦ Private')}</span>
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
                          onClick={() => setManagingLobbyId(lobby.id)}
                          className="px-3 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                          title="Manage access, password, and autosave without entering"
                        >
                          Manage
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(lobby.id)}
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

          {/* Atriums you administer (but don't own) -- same management
              permissions as the owner, minus the owner-only Admins tab */}
          {adminLobbies.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Administered Atriums</span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              </div>
              <div className="grid gap-3">
                {adminLobbies.map(lobby => (
                  <div key={lobby.id} className="bg-nier-black border border-nier-border/20 p-4 hover:border-nier-border/40 transition-colors group">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="text-nier-bg text-sm tracking-wide">{lobby.name}</h4>
                        <div className="flex gap-4 mt-2 text-[10px] text-nier-border/60 tracking-wider uppercase">
                          <span>◇ {lobby.playerCount}/{lobby.maxPlayers} users</span>
                          <span>{lobby.isPublic ? (isDesktop ? '◦ Local Public' : '◦ Public') : (isDesktop ? '◦ Local Private' : '◦ Private')}</span>
                          {lobby.passwordHash && <span>◦ Secured</span>}
                          <span className="text-nier-bg/70">◦ Admin</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleJoinClick(lobby)}
                          className="px-4 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.1em] uppercase hover:bg-nier-bgDark transition-colors"
                        >
                          Enter
                        </button>
                        <button
                          onClick={() => setManagingLobbyId(lobby.id)}
                          className="px-3 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                          title="Manage access, password, and autosave without entering"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Import Atrium -- now on both platforms. It used to be web-only,
              which left desktop with an Export but no way back in; the web
              side can now download the same .atrium.json (see
              lib/atriumDownload), so the transfer works in both directions.
              The heading names the source rather than the destination. */}
          {(
            <section>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">
                  {isDesktop ? 'Import from Web' : 'Import from Desktop'}
                </span>
                <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              </div>
              <button
                onClick={() => setShowImport(true)}
                disabled={!canCreateMore}
                className="w-full py-3 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ◇ Import Atrium (.json)
              </button>

              {/* Paired with Import so both directions of the transfer live
                  together. Web only -- desktop's equivalent is Export Atrium
                  on the welcome screen, which writes the same format. */}
              {!isDesktop && (
                <button
                  onClick={() => setShowDownload(true)}
                  className="w-full mt-2 py-3 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
                >
                  ◇ Download Atrium (.json)
                </button>
              )}
              {!canCreateMore && (
                <p className="text-[9px] tracking-wider mt-2" style={{ color: '#FF6161' }}>You have 3 atriums. Delete one to import.</p>
              )}
            </section>
          )}

          {/* Public Atriums */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-nier-border text-[10px] tracking-[0.15em] uppercase">Available Atriums</span>
              <div className="flex-1 h-[1px] bg-gradient-to-r from-nier-border/30 to-transparent" />
              <span className="text-nier-border/50 text-[10px]">{lobbies.filter(l => l.name.toLowerCase().includes(searchQuery.toLowerCase())).length} found</span>
              <button
                onClick={() => setShowJoinById(true)}
                className="px-3 py-1 border border-nier-border/30 text-nier-border text-[9px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors ml-2"
              >
                Join by ID
              </button>
            </div>
            
            {/* Search Bar */}
            <div className="mb-4">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search atriums by name..."
                  className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-2 text-sm tracking-wide placeholder-nier-border/30 focus:border-nier-border/60 transition-colors pr-10"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-nier-border/50 hover:text-nier-bg transition-colors"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            
            <div className="grid gap-3">
              {lobbies.filter(l => l.name.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
                <div className="text-nier-border/40 text-center py-12 text-xs tracking-wider uppercase">
                  {searchQuery ? 'No atriums match your search' : 'No atriums available'}
                </div>
              ) : (
                lobbies.filter(l => l.name.toLowerCase().includes(searchQuery.toLowerCase())).map(lobby => (
                  <div key={lobby.id} className="bg-nier-black border border-nier-border/20 p-4 hover:border-nier-border/40 transition-colors">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="text-nier-bg text-sm tracking-wide">
                          {lobby.name}
                          {!lobby.isPublic && <span className="ml-2 text-nier-border/50 text-[9px]">{isDesktop ? '[Local Private]' : '[Private]'}</span>}
                        </h4>
                        <div className="flex gap-4 mt-2 text-[10px] text-nier-border/60 tracking-wider uppercase">
                          <span>Atrium by: ◇ {lobby.ownerUsername}</span>
                          <span>◦ {lobby.playerCount}/{lobby.maxPlayers}</span>
                          {lobby.passwordHash && <span>◦ Secured</span>}
                          {!lobby.isPublic && <span>{isDesktop ? '◦ Local Private' : '◦ Whitelisted'}</span>}
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

      {/* Manage Atrium (access/password/autosave, without entering) */}
      {managingLobbyId && (() => {
        const ownedMatch = userLobbies.find(l => l.id === managingLobbyId)
        const managedLobby = ownedMatch ?? adminLobbies.find(l => l.id === managingLobbyId)
        if (!managedLobby) return null
        return (
          <LobbyManagement
            lobby={managedLobby}
            isOwner={!!ownedMatch}
            onClose={() => setManagingLobbyId(null)}
            onUpdate={loadLobbies}
          />
        )
      })()}

      {/* Password Modal */}
      {selectedLobbyId && (
        <div className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[100]">
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
              placeholder="Insert password here..."
              autoComplete="new-password"
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-3 text-sm tracking-wide placeholder-nier-border/30 focus:border-nier-border/60 transition-colors mb-4"
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
        <div className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[100]">
          <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
            
            <h3 className="text-nier-bg tracking-[0.15em] uppercase mb-2">◇ Join by ID</h3>
            <p className="text-nier-border/60 text-[10px] tracking-wider mb-4">
              Enter the atrium ID shared with you by the atrium owner.
            </p>
            {joinByIdError && (
              <div className="text-xs mb-3 bg-red-400/10 border border-red-400/30 px-3 py-2" style={{ color: '#FF6161' }}>
                {joinByIdError}
              </div>
            )}
            <input
              type="text"
              value={lobbyIdInput}
              onChange={(e) => {
                setLobbyIdInput(e.target.value)
                setJoinByIdError(null)
              }}
              onKeyPress={(e) => e.key === 'Enter' && lobbyIdInput && handleJoinById()}
              placeholder="Atrium ID (UUID)..."
              autoComplete="off"
              className="w-full bg-nier-black border border-nier-border/30 text-nier-bg px-4 py-3 text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors mb-4 font-mono"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={handleJoinById}
                disabled={!lobbyIdInput || joinByIdLoading}
                className="flex-1 py-2 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {joinByIdLoading ? 'Checking...' : 'Enter'}
              </button>
              <button
                onClick={() => {
                  setShowJoinById(false)
                  setLobbyIdInput('')
                  setJoinByIdError(null)
                }}
                className="px-4 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 bg-nier-black/80 flex items-center justify-center z-[100]">
          <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative">
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-nier-border/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-nier-border/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-nier-border/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-nier-border/60" />
            
            <h3 className="text-nier-bg tracking-[0.15em] uppercase mb-4">◇ Delete Atrium</h3>
            <p className="text-nier-border/60 text-xs tracking-wider mb-6">
              Are you sure you want to delete this atrium? All traces will be lost.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => deleteLobby(deleteConfirmId)}
                className="flex-1 py-2 bg-red-500/80 text-white text-[10px] tracking-[0.15em] uppercase hover:bg-red-500 transition-colors"
              >
                Delete
              </button>
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-4 py-2 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.1em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Atrium Modal */}
      {showImport && (
        <ImportAtrium
          onClose={() => setShowImport(false)}
          onImported={() => { loadLobbies(); checkCanCreateLobby(); }}
        />
      )}

      {/* Download picker. Owned and administered atriums first (the ones the
          user is most likely to want), then public ones, de-duplicated since
          an owned atrium that's also public appears in both lists. */}
      {showDownload && (
        <DownloadAtriumPanel
          onClose={() => setShowDownload(false)}
          atriums={(() => {
            const seen = new Set<string>()
            const out: DownloadableAtrium[] = []
            const add = (list: LobbyWithOwner[], access: DownloadableAtrium['access']) => {
              for (const l of list) {
                if (seen.has(l.id)) continue
                seen.add(l.id)
                out.push({ id: l.id, name: l.name, ownerUsername: l.ownerUsername, access })
              }
            }
            add(userLobbies, 'owner')
            add(adminLobbies, 'admin')
            add(lobbies, 'public')
            return out
          })()}
        />
      )}

      {/* Report a problem / suggest a feature */}
      <button
        onClick={() => setShowReportForm(true)}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[150] pointer-events-auto text-gray-500 hover:text-gray-300 text-[9px] font-mono tracking-[0.1em] uppercase underline decoration-gray-700 hover:decoration-gray-400 transition-colors"
      >
        Report a problem or suggest a feature
      </button>
      {showReportForm && (
        <ReportFeedbackModal
          onClose={() => setShowReportForm(false)}
          username={username}
        />
      )}

      {/* CSS for animations */}
      <style>{`
        @keyframes firefly {
          0% { opacity: 0; transform: translateY(0px) translateX(0px); }
          10% { opacity: 0.15; }
          30% { opacity: 0.3; transform: translateY(-20px) translateX(15px); }
          50% { opacity: 0.25; transform: translateY(-50px) translateX(-10px); }
          70% { opacity: 0.35; transform: translateY(-30px) translateX(25px); }
          90% { opacity: 0.1; transform: translateY(-10px) translateX(5px); }
          100% { opacity: 0; transform: translateY(0px) translateX(0px); }
        }
        
        @keyframes rectFloat {
          0%, 100% { opacity: 0.6; transform: rotate(var(--rotation, 0deg)) translateY(0px); }
          50% { opacity: 0.9; transform: rotate(var(--rotation, 0deg)) translateY(-10px); }
        }
      `}</style>
    </div>
  )
}
