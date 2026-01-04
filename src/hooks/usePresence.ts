import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function usePresence(lobbyId: string | null) {
  const { userId, username, position, playerColor, updateOtherUser, removeOtherUser, setPosition } = useGameStore()
  const channelRef = useRef<RealtimeChannel | null>(null)
  const positionRef = useRef(position)
  const playerColorRef = useRef(playerColor)

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
        online_at: new Date().toISOString(),
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

    // Create lobby-specific presence channel
    const channelName = `lobby-${lobbyId}-presence`
    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: userId,
        },
      },
    })

    // Track presence
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        
        Object.entries(state).forEach(([key, presences]) => {
          // Skip current user and filter out non-UUID keys (old pre-auth users)
          if (key !== userId && presences && presences.length > 0) {
            // Only show authenticated users (UUIDs start with hex characters and have dashes)
            const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
            if (isValidUUID) {
              const presence = presences[0] as any
              updateOtherUser(key, {
                userId: key,
                username: presence.username,
                x: presence.x,
                y: presence.y,
                playerColor: presence.playerColor || '#ffffff',
                timestamp: Date.now(),
              })
            }
          }
        })
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        // Only track authenticated users (valid UUIDs)
        const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
        if (key !== userId && newPresences && newPresences.length > 0 && isValidUUID) {
          const presence = newPresences[0] as any
          updateOtherUser(key, {
            userId: key,
            username: presence.username,
            x: presence.x,
            y: presence.y,
            playerColor: presence.playerColor || '#ffffff',
            timestamp: Date.now(),
          })
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key !== userId) {
          removeOtherUser(key)
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            username,
            x: position.x,
            y: position.y,
            playerColor: playerColorRef.current,
            online_at: new Date().toISOString(),
          })
        }
      })

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
            online_at: new Date().toISOString(),
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
      channel.unsubscribe()
    }
  }, [userId, username, lobbyId])

  return { updateCursorPosition }
}
