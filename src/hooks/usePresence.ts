import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

const isValidUserKey = (key: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)

export function usePresence(lobbyId: string | null) {
  const { userId, username, position, playerColor, updateOtherUser, removeOtherUser, setPosition } = useGameStore()
  const channelRef = useRef<RealtimeChannel | null>(null)
  const positionRef = useRef(position)
  const playerColorRef = useRef(playerColor)
  // Fixed once per atrium connection (not refreshed on every position/color
  // broadcast) so other users can compute "time in atrium" from it.
  const joinedAtRef = useRef<number>(Date.now())

  // Keep position ref up to date
  useEffect(() => {
    positionRef.current = position
  }, [position])

  // Keep player color ref up to date
  useEffect(() => {
    playerColorRef.current = playerColor
    
    // Immediately broadcast color change to other users
    if (channelRef.current && userId && username) {
      channelRef.current.track({
        username,
        x: positionRef.current.x,
        y: positionRef.current.y,
        playerColor: playerColor,
        online_at: new Date(joinedAtRef.current).toISOString(),
      })
    }
  }, [playerColor, userId, username])

  // Expose function to manually update position (for cursor tracking)
  // Throttled to prevent excessive re-renders
  const lastCursorUpdateRef = useRef({ x: 0, y: 0, time: 0 })
  const updateCursorPosition = useCallback((worldX: number, worldY: number) => {
    const now = Date.now()
    const dx = Math.abs(worldX - lastCursorUpdateRef.current.x)
    const dy = Math.abs(worldY - lastCursorUpdateRef.current.y)
    const timeDiff = now - lastCursorUpdateRef.current.time
    
    // Only update if moved at least 2 pixels OR 50ms has passed
    if (dx > 2 || dy > 2 || timeDiff > 50) {
      setPosition(worldX, worldY)
      lastCursorUpdateRef.current = { x: worldX, y: worldY, time: now }
    }
  }, [setPosition])

  useEffect(() => {
    if (!supabase || !userId || !username || !lobbyId) {
      return
    }

    // Connecting to lobby presence channel
    joinedAtRef.current = Date.now()

    // Create lobby-specific presence channel
    const channelName = `lobby-${lobbyId}-presence`
    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: userId,
        },
      },
    })

    // Reconciles local otherUsers against the channel's current presence
    // state -- used for both the 'sync' event and a periodic safety-net
    // (see below), since presence is eventually-consistent and a missed
    // join/leave broadcast (e.g. two users connecting in close succession,
    // or a brief reconnect) can otherwise leave a user permanently missing
    // or stuck as a "ghost" until they leave and rejoin.
    const reconcilePresenceState = () => {
      const state = channel.presenceState()
      const seenKeys = new Set<string>()

      Object.entries(state).forEach(([key, presences]) => {
        const presenceArr = presences as any[]
        if (key === userId || !presenceArr || presenceArr.length === 0) return
        if (!isValidUserKey(key)) return

        seenKeys.add(key)
        const presence = presenceArr[0] as any
        updateOtherUser(key, {
          userId: key,
          username: presence.username,
          x: presence.x,
          y: presence.y,
          playerColor: presence.playerColor || '#ffffff',
          timestamp: Date.now(),
          joinedAt: presence.online_at ? new Date(presence.online_at).getTime() : Date.now(),
        })
      })

      // Drop any locally-tracked user the channel no longer reports --
      // catches a missed 'leave' broadcast.
      const currentOtherUsers = useGameStore.getState().otherUsers
      Object.keys(currentOtherUsers).forEach(key => {
        if (!seenKeys.has(key)) removeOtherUser(key)
      })
    }

    // Track presence
    channel
      .on('presence', { event: 'sync' }, reconcilePresenceState)
      .on('presence', { event: 'join' }, ({ key, newPresences }: { key: string; newPresences: any[] }) => {
        if (key !== userId && newPresences && newPresences.length > 0 && isValidUserKey(key)) {
          const presence = newPresences[0] as any
          updateOtherUser(key, {
            userId: key,
            username: presence.username,
            x: presence.x,
            y: presence.y,
            playerColor: presence.playerColor || '#ffffff',
            timestamp: Date.now(),
            joinedAt: presence.online_at ? new Date(presence.online_at).getTime() : Date.now(),
          })
        }
      })
      .on('presence', { event: 'leave' }, ({ key }: { key: string }) => {
        if (key !== userId) {
          removeOtherUser(key)
        }
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            username,
            x: position.x,
            y: position.y,
            playerColor: playerColorRef.current,
            online_at: new Date(joinedAtRef.current).toISOString(),
          })
        }
      })

    // Safety-net: reconcile periodically in case a join/leave broadcast was
    // ever missed, so a mismatch self-heals instead of persisting until the
    // affected user leaves and rejoins.
    const reconcileInterval = setInterval(reconcilePresenceState, 20000)

    channelRef.current = channel

    // Send position updates only when position actually changes
    // Throttle to max 1 update per 2 seconds to reduce Realtime message usage
    let lastBroadcastTime = 0
    let lastBroadcastX = position.x
    let lastBroadcastY = position.y
    const MIN_BROADCAST_INTERVAL = 2000 // 2000ms = 1 update per 2 seconds max
    const MIN_MOVEMENT_DISTANCE = 12 // Only update if moved at least 12 pixels

    const updateInterval = setInterval(async () => {
      if (channelRef.current) {
        const now = Date.now()
        const dx = Math.abs(positionRef.current.x - lastBroadcastX)
        const dy = Math.abs(positionRef.current.y - lastBroadcastY)
        const timeSinceLastBroadcast = now - lastBroadcastTime
        
        // Only broadcast if:
        // 1. Enough time has passed (throttle), AND
        // 2. Player has moved significantly
        if (timeSinceLastBroadcast >= MIN_BROADCAST_INTERVAL && (dx >= MIN_MOVEMENT_DISTANCE || dy >= MIN_MOVEMENT_DISTANCE)) {
          await channelRef.current.track({
            username,
            x: positionRef.current.x,
            y: positionRef.current.y,
            playerColor: playerColorRef.current,
            online_at: new Date(joinedAtRef.current).toISOString(),
          })
          lastBroadcastTime = now
          lastBroadcastX = positionRef.current.x
          lastBroadcastY = positionRef.current.y
        }
      }
    }, 200) // Check every 200ms, but only broadcast when conditions are met

    return () => {
      // Disconnecting from presence channel
      clearInterval(updateInterval)
      clearInterval(reconcileInterval)
      channel.unsubscribe()
    }
  }, [userId, username, lobbyId])

  return { updateCursorPosition, getJoinedAt: () => joinedAtRef.current }
}
