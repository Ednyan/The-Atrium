import { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function usePresence(lobbyId: string | null) {
  const { userId, username, position, playerColor, updateOtherUser, removeOtherUser } = useGameStore()
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

  useEffect(() => {
    if (!supabase || !userId || !username || !lobbyId) {
      console.log('⚠️ Presence hook: Missing requirements', { supabase: !!supabase, userId, username, lobbyId })
      return
    }

    console.log('🔌 Connecting to lobby presence channel...', { userId, username, lobbyId })

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
        console.log('📡 Presence channel status:', status)
        if (status === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to presence channel')
          await channel.track({
            username,
            x: position.x,
            y: position.y,
            playerColor: playerColorRef.current,
            online_at: new Date().toISOString(),
          })
          console.log('📍 Tracking position:', username, 'at', position.x, position.y)
        }
      })

    channelRef.current = channel

    // Send position updates at regular intervals (20 times per second)
    const updateInterval = setInterval(async () => {
      if (channelRef.current) {
        await channelRef.current.track({
          username,
          x: positionRef.current.x,
          y: positionRef.current.y,
          playerColor: playerColorRef.current,
          online_at: new Date().toISOString(),
        })
      }
    }, 50) // 50ms = 20 updates per second

    return () => {
      console.log('🔌 Disconnecting from presence channel')
      clearInterval(updateInterval)
      channel.unsubscribe()
    }
  }, [userId, username, lobbyId])
}
