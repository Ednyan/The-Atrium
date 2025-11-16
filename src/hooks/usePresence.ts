import { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase, REALTIME_CHANNEL } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

export function usePresence() {
  const { userId, username, position, updateOtherUser, removeOtherUser } = useGameStore()
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!supabase || !userId || !username) {
      console.log('⚠️ Presence hook: Missing requirements', { supabase: !!supabase, userId, username })
      return
    }

    console.log('🔌 Connecting to presence channel...', { userId, username })

    // Create presence channel
    const channel = supabase.channel(REALTIME_CHANNEL, {
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
            online_at: new Date().toISOString(),
          })
          console.log('📍 Tracking position:', username, 'at', position.x, position.y)
        }
      })

    channelRef.current = channel

    return () => {
      console.log('🔌 Disconnecting from presence channel')
      channel.unsubscribe()
    }
  }, [userId, username])

  // Update position in real-time
  useEffect(() => {
    if (!channelRef.current) return

    const updatePresence = async () => {
      await channelRef.current?.track({
        username,
        x: position.x,
        y: position.y,
        online_at: new Date().toISOString(),
      })
    }

    updatePresence()
  }, [position, username])
}
