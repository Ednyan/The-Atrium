import { useEffect, useRef, useCallback } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase } from '../lib/supabase'
import { isGhostEntry } from '../lib/operatorGhost'
import type { RealtimeChannel } from '@supabase/supabase-js'

const isValidUserKey = (key: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)

// Ghost mode: the platform operator entering an atrium it wouldn't otherwise
// have access to. It still subscribes -- it needs to see who is present -- but
// never announces itself, so it appears in nobody's roster and emits no cursor.
//
// Resolved in here rather than passed in. It used to arrive as a prop from
// LobbyScene, which meant the answer had to live in component state -- and
// since it started as "unknown", every single atrium entry incurred an extra
// LobbyScene render once it settled, plus a delayed presence connection. That
// was visible as a flicker on entry.
//
// Nothing outside this hook needs the value in order to render, so it stays a
// ref here and the channel connects immediately, exactly as it did before.
export function usePresence(lobbyId: string | null, onKicked?: (blacklisted: boolean) => void) {
  const { userId, username, position, playerColor, updateOtherUser, updateOtherUserPosition, removeOtherUser, setPosition } = useGameStore()
  const channelRef = useRef<RealtimeChannel | null>(null)
  const positionRef = useRef(position)
  const playerColorRef = useRef(playerColor)
  // Fixed once per atrium connection (not refreshed on every position/color
  // broadcast) so other users can compute "time in atrium" from it.
  const joinedAtRef = useRef<number>(Date.now())
  // Ref (not a channel effect dependency) so a new onKicked identity from the
  // caller on every render doesn't force the presence channel to tear down
  // and resubscribe.
  const onKickedRef = useRef(onKicked)
  useEffect(() => {
    onKickedRef.current = onKicked
  }, [onKicked])

  // null until the check answers. Everything that could publish this user
  // treats "not yet known" as "don't publish", so the window before it
  // resolves can't leak an operator into an atrium it entered invisibly.
  const ghostRef = useRef<boolean | null>(null)

  // Keep position ref up to date
  useEffect(() => {
    positionRef.current = position
  }, [position])

  // Keep player color ref up to date
  useEffect(() => {
    playerColorRef.current = playerColor
    
    // Immediately broadcast color change to other users.
    //
    // Strict false, not !ghostRef.current: while the check is pending this is
    // null, and `!null` is true -- which would publish the operator into an
    // atrium it is entering invisibly, from the one outbound path that fires
    // early enough for the race to be real.
    if (channelRef.current && userId && username && ghostRef.current === false) {
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

    // Started now, awaited only where it's actually needed (the track() call
    // below). Subscribing doesn't publish anything, so it doesn't have to
    // wait -- which is what keeps entry as immediate as it was before ghost
    // mode existed.
    ghostRef.current = null
    const ghostPromise = isGhostEntry(lobbyId)
    // Only fills in the unknown. A kick arriving before this resolves has
    // already decided the answer, and the probe must not downgrade it back.
    ghostPromise.then(value => { if (ghostRef.current === null) ghostRef.current = value })

    // Connecting to lobby presence channel
    joinedAtRef.current = Date.now()

    // Create lobby-specific presence channel. Presence (track/sync/join/
    // leave) is used only for the "who's here" roster -- username, color,
    // join time -- which changes rarely. Live cursor position is sent
    // separately over broadcast (see below): broadcast is a stateless
    // fire-and-forget pub/sub that doesn't mutate the presence registry, so
    // frequent position updates can't perturb (or be perturbed by) roster
    // sync, and don't cost anything extra in presence-diff bookkeeping.
    const channelName = `lobby-${lobbyId}-presence`
    const channel = supabase.channel(channelName, {
      config: {
        presence: {
          key: userId,
        },
        broadcast: {
          self: false,
          ack: false,
        },
      },
    })

    // Applies the channel's current presence snapshot additively (adds/
    // updates, never removes). Used for the 'sync' event, which the SDK
    // fires on every presence change -- so it can't be trusted to always
    // carry a fully settled snapshot. Removal on a momentarily-incomplete
    // sync used to wipe out other users who had just been correctly added,
    // making them vanish permanently instead of "sometimes" -- so removal
    // is handled separately, only by the slower periodic reconciliation
    // below. Position is merged against whatever's already known rather
    // than overwritten, since a cursor broadcast is almost always more
    // current than the position last recorded at presence-track time.
    const applyPresenceState = () => {
      const state = channel.presenceState()
      const otherUsers = useGameStore.getState().otherUsers

      Object.entries(state).forEach(([key, presences]) => {
        const presenceArr = presences as any[]
        if (key === userId || !presenceArr || presenceArr.length === 0) return
        if (!isValidUserKey(key)) return

        const presence = presenceArr[0] as any
        const existing = otherUsers[key]
        updateOtherUser(key, {
          userId: key,
          username: presence.username,
          x: existing?.x ?? presence.x,
          y: existing?.y ?? presence.y,
          playerColor: presence.playerColor || '#ffffff',
          timestamp: Date.now(),
          joinedAt: presence.online_at ? new Date(presence.online_at).getTime() : Date.now(),
        })
      })
    }

    // Full reconcile: additive pass plus dropping any locally-tracked user
    // the channel no longer reports -- catches a missed 'leave' broadcast.
    // Only run on a slow interval (see below), where the snapshot is much
    // less likely to be transiently incomplete than on a live 'sync' event.
    const reconcilePresenceState = () => {
      applyPresenceState()

      const state = channel.presenceState()
      const seenKeys = new Set(
        Object.keys(state).filter(key => key !== userId && isValidUserKey(key) && state[key]?.length > 0)
      )
      const currentOtherUsers = useGameStore.getState().otherUsers
      Object.keys(currentOtherUsers).forEach(key => {
        if (!seenKeys.has(key)) removeOtherUser(key)
      })
    }

    // Track presence
    channel
      .on('presence', { event: 'sync' }, applyPresenceState)
      .on('presence', { event: 'join' }, ({ key, newPresences }: { key: string; newPresences: any[] }) => {
        if (key !== userId && newPresences && newPresences.length > 0 && isValidUserKey(key)) {
          const presence = newPresences[0] as any
          const existing = useGameStore.getState().otherUsers[key]
          updateOtherUser(key, {
            userId: key,
            username: presence.username,
            x: existing?.x ?? presence.x,
            y: existing?.y ?? presence.y,
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
      .on('broadcast', { event: 'cursor' }, ({ payload }: { payload: any }) => {
        if (payload && payload.userId !== userId && isValidUserKey(payload.userId)) {
          updateOtherUserPosition(payload.userId, payload.x, payload.y)
        }
      })
      .on('broadcast', { event: 'kicked' }, ({ payload }: { payload: any }) => {
        if (payload && payload.targetUserId === userId) {
          // Stop being present the moment the removal lands, not when the
          // notice is acknowledged. Leaving is deliberately deferred so the
          // message can be read -- but until it was clicked, everyone else's
          // roster still listed somebody who had already been removed, which
          // is the one thing that panel is telling them is no longer true.
          //
          // Untrack retracts what was already published; ghost closes the two
          // outbound paths that would republish it -- the colour-change
          // track() and the cursor broadcast. The channel stays subscribed,
          // so the panel renders and the canvas behind it keeps working.
          ghostRef.current = true
          void channel.untrack()
          onKickedRef.current?.(!!payload.blacklisted)
        }
      })
      .subscribe(async (status: string) => {
        // track() is what puts a user in everyone else's roster. Skipping it
        // is the whole of the invisibility: the channel is still subscribed,
        // so presence and cursors from others arrive normally, but nothing
        // about this user is ever published.
        //
        // This is the one place that must wait for the answer -- and the only
        // one, since it's the only line here that publishes anything.
        if (status === 'SUBSCRIBED' && !(await ghostPromise)) {
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

    // Send position updates only when position actually changes. Throttled
    // to max 1 update per 2 seconds to keep Realtime message usage minimal.
    // Sent as a lightweight broadcast (not track()) -- see comment above the
    // channel config for why position is kept out of the presence registry.
    let lastBroadcastTime = 0
    let lastBroadcastX = position.x
    let lastBroadcastY = position.y
    const MIN_BROADCAST_INTERVAL = 5000 // 5000ms = 1 update per 5 seconds max
    const MIN_MOVEMENT_DISTANCE = 42 // Only update if moved at least 42 pixels

    const updateInterval = setInterval(async () => {
      // Second outbound path: the cursor broadcast. Suppressed too, or the
      // operator would be invisible in the roster while still painting a
      // moving cursor on everyone's canvas.
      //
      // Strict false: while the check is still pending this is null, which
      // must not broadcast. In practice it has long since resolved, since the
      // first broadcast can't happen until 5s in.
      if (channelRef.current && ghostRef.current === false) {
        const now = Date.now()
        const dx = Math.abs(positionRef.current.x - lastBroadcastX)
        const dy = Math.abs(positionRef.current.y - lastBroadcastY)
        const timeSinceLastBroadcast = now - lastBroadcastTime

        // Only broadcast if:
        // 1. Enough time has passed (throttle), AND
        // 2. Player has moved significantly
        if (timeSinceLastBroadcast >= MIN_BROADCAST_INTERVAL && (dx >= MIN_MOVEMENT_DISTANCE || dy >= MIN_MOVEMENT_DISTANCE)) {
          await channelRef.current.send({
            type: 'broadcast',
            event: 'cursor',
            payload: {
              userId,
              x: positionRef.current.x,
              y: positionRef.current.y,
            },
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

  // Fire-and-forget: there's no server-side session control to force-close
  // another client's connection, so "kicking" is a broadcast the target's
  // own (well-behaved) client acts on -- see the 'kicked' listener above.
  // Reuses this already-open presence channel instead of opening a new one.
  const kickUser = useCallback(async (targetUserId: string, blacklisted: boolean) => {
    await channelRef.current?.send({
      type: 'broadcast',
      event: 'kicked',
      payload: { targetUserId, blacklisted },
    })
  }, [])

  return { updateCursorPosition, getJoinedAt: () => joinedAtRef.current, kickUser }
}
