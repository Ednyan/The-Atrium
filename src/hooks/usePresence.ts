import { useEffect, useRef, useCallback } from 'react'
import { useGameStore, useGamePick } from '../store/gameStore'
import { supabase } from '../lib/supabase'
import { isGhostEntry } from '../lib/operatorGhost'
import { CHANNEL_EVERY_MS, channelBatches, receiveLaser, setLaserSender } from '../lib/laser'
import { Mesh, PAGE, askForRelay, canLink, forgetPaths, livePositions, reportPath, userOf, type Live, type Signal } from '../lib/peers'
import { RESTART_MS } from '../lib/playback'
import { presenceChannel } from '../lib/rooms'
import { knownMembers } from '../lib/driveSync'
import type { RealtimeChannel } from '@supabase/supabase-js'

const isValidUserKey = (key: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)

// What this person announces in an atrium's presence.
const announcement = (username: string, playerColor: string, at: { x: number; y: number }, joinedAt: number) => ({
  username,
  x: at.x,
  y: at.y,
  playerColor,
  online_at: new Date(joinedAt).toISOString(),
  // Whether they can be connected to directly (lib/peers): nobody offers to
  // someone who can't answer -- the Linux app, or someone hiding their IP.
  link: canLink(),
  // Which of their pages this is: each is connected to on its own.
  page: PAGE,
})

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
  const { userId, username, playerColor, hideMyAddress, updateOtherUser, updateOtherUserPosition, removeOtherUser, setPosition } = useGamePick('userId', 'username', 'playerColor', 'hideMyAddress', 'updateOtherUser', 'updateOtherUserPosition', 'removeOtherUser', 'setPosition')
  const channelRef = useRef<RealtimeChannel | null>(null)
  const positionRef = useRef(useGameStore.getState().position)
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

  // Keep position ref up to date -- by subscribing, not by rendering for it:
  // it changes with every movement of the mouse (see useGamePick). And when
  // it changed, which a direct connection sends with it (RemoteCursors).
  const positionAtRef = useRef(performance.now())
  useEffect(() => useGameStore.subscribe((state, before) => {
    if (state.position === before.position) return
    positionRef.current = state.position
    positionAtRef.current = performance.now()
  }), [])

  // Keep player color ref up to date
  useEffect(() => {
    playerColorRef.current = playerColor
    
    // Immediately broadcast color change to other users -- and whether they
    // can connect directly, when this person hides their IP or stops.
    //
    // Strict false, not !ghostRef.current: while the check is pending this is
    // null, and `!null` is true -- which would publish the operator into an
    // atrium it is entering invisibly, from the one outbound path that fires
    // early enough for the race to be real.
    if (channelRef.current && userId && username && ghostRef.current === false) {
      channelRef.current.track(announcement(username, playerColor, positionRef.current, joinedAtRef.current))
    }
  }, [playerColor, userId, username, hideMyAddress])

  // Expose function to manually update position (for cursor tracking).
  // Every sample is kept for the direct connections, which send it the frame
  // it changes; the store -- what redraws what shows the position -- is
  // throttled, so a slow movement or the last steps before stopping would
  // reach the others late, or not until the next movement.
  const lastCursorUpdateRef = useRef({ x: 0, y: 0, time: 0 })
  const updateCursorPosition = useCallback((worldX: number, worldY: number) => {
    positionRef.current = { x: worldX, y: worldY }
    positionAtRef.current = performance.now()
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
    // The atrium's room (lib/rooms), or this Supabase channel where there's none.
    const channel = presenceChannel(lobbyId, {
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

    // Direct connections to the others (lib/peers): their cursors and lasers
    // live, rather than a cursor every 5 seconds through this channel. Made
    // once the ghost check says this person is seen -- an invisible operator
    // connects to no one -- and introduced through this channel. Hiding their
    // IP address (Profile), only through the relay, once there's a pass for
    // it; the switch takes effect at once.
    let mesh: Mesh | null = null
    // This page, among the places people are here (lib/peers).
    const place = `${userId}/${PAGE}`
    // Everyone here; and of them, the places that can be connected to directly
    // -- every page of theirs (a version from before `page` can't be).
    const everyone = () => Object.keys(channel.presenceState()).filter(key => key !== userId && isValidUserKey(key))
    // Directly linked only with those in the atrium (its roster, lib/driveSync):
    // an introduction says where a page can be reached, and someone who only
    // knows the atrium's address -- or views a public one -- isn't told that.
    const linkable = (user: string) => { const members = knownMembers(lobbyId); return !members || members.has(user) }
    const roster = () => Object.entries(channel.presenceState())
      .filter(([key]) => key !== userId && isValidUserKey(key) && linkable(key))
      .flatMap(([key, presences]) => (presences as { link?: boolean; page?: unknown }[])
        .filter(presence => presence.link !== false && typeof presence.page === 'string')
        .map(presence => `${key}/${presence.page}`))
    const fromPeer = (from: string, message: Live) => {
      const at = performance.now()
      const user = userOf(from)
      if (message.k === 'c' && Number.isFinite(message.x) && Number.isFinite(message.y)) {
        // A version from before `t`: its moment is its arrival. One overtaken
        // on the way (a direct link keeps no order) is behind already -- on
        // the clock of the page it came from: another of theirs keeps its own.
        const t = Number.isFinite(message.t) ? message.t! : at
        const latest = livePositions.get(user)
        if (latest?.by === from && t <= latest.t && latest.t - t < RESTART_MS) return
        livePositions.set(user, { x: message.x, y: message.y, t, at, by: from })
      }
      else if (message.k === 'l' && message.m && typeof message.m === 'object') receiveLaser({ ...(message.m as object), userId: user } as Parameters<typeof receiveLaser>[0])
    }
    const connect = () => {
      if (mesh || ghostRef.current !== false || !canLink() || channelRef.current !== channel) return
      mesh = new Mesh(place, signal => {
        void channel.send({ type: 'broadcast', event: 'rtc', payload: { ...signal, from: place } })
      }, fromPeer)
      mesh.sync(roster())
    }
    // A relay pass first (lib/peers): the last resort for a pair that can't
    // connect directly, and the only way for someone hiding their IP address.
    const link = () => {
      void askForRelay().then(() => {
        if (mesh) return
        connect()
        // Hiding, now someone who can be connected to (announcement's `link`).
        if (mesh && useGameStore.getState().hideMyAddress) void channel.track(announcement(username, playerColorRef.current, positionRef.current, joinedAtRef.current))
      })
    }
    const unlink = () => { mesh?.close(); mesh = null }
    ghostPromise.then(link)
    const stopWatching = useGameStore.subscribe((state, before) => {
      // Every connection closed, and made again the other way.
      if (state.hideMyAddress !== before.hideMyAddress) { unlink(); link() }
    })
    // Everyone here connected directly, both ways: the laser and the slow
    // cursor needn't touch the channel.
    const allDirect = () => !!mesh && everyone().every(id => mesh!.reaches(id))

    // Track presence
    channel
      .on('presence', { event: 'sync' }, () => { applyPresenceState(); mesh?.sync(roster()) })
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
          // Gone, not just announced again (which leaves and joins at once).
          if (!channel.presenceState()[key]?.length) mesh?.forget(key)
        }
      })
      // Through here, from anyone not connected directly; from someone who
      // is, the direct copy is newer, and this one is left.
      .on('broadcast', { event: 'cursor' }, ({ payload }: { payload: any }) => {
        if (payload && payload.userId !== userId && isValidUserKey(payload.userId) && !mesh?.linked(payload.userId)) {
          updateOtherUserPosition(payload.userId, payload.x, payload.y)
        }
      })
      // Someone's laser pointer (lib/laser): drawn, never kept.
      .on('broadcast', { event: 'laser' }, ({ payload }: { payload: any }) => {
        if (payload && payload.userId !== userId && isValidUserKey(payload.userId) && !mesh?.linked(payload.userId)) receiveLaser(payload)
      })
      // An introduction for a direct connection (lib/peers), from a place.
      .on('broadcast', { event: 'rtc' }, ({ payload }: { payload: any }) => {
        if (payload && typeof payload.from === 'string' && isValidUserKey(userOf(payload.from)) && linkable(userOf(payload.from)) && typeof payload.sdp === 'string' && (payload.kind === 'offer' || payload.kind === 'answer')) {
          void mesh?.signal(payload.from, payload as Signal)
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
          unlink()
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
          await channel.track(announcement(username, playerColorRef.current, positionRef.current, joinedAtRef.current))
        }
      })

    // Safety-net: reconcile periodically in case a join/leave broadcast was
    // ever missed, so a mismatch self-heals instead of persisting until the
    // affected user leaves and rejoins.
    // And the direct connections: the new and the gone, a relay pass renewed
    // before it runs out -- and someone hiding, with none to be had (the
    // month's budget spent), back to the channel, telling the others so.
    const reconcileInterval = setInterval(() => {
      reconcilePresenceState()
      if (mesh) {
        void askForRelay().then(held => {
          if (held || !mesh || !useGameStore.getState().hideMyAddress) return
          unlink()
          void channel.track(announcement(username, playerColorRef.current, positionRef.current, joinedAtRef.current))
        })
      }
      if (mesh) {
        mesh.sync(roster(), true)
        mesh.recheckRoutes()
      } else link()
      // Anyone here, settled, with no connection open or on its way: through
      // Supabase (said once; lib/peers reportPath).
      for (const id of everyone()) if (!mesh?.linked(id) && !mesh?.connecting(id)) reportPath(id, 'supabase')
    }, 20000)

    channelRef.current = channel
    // This person's laser out to the others -- not while invisible, like the
    // cursor below: every batch directly to whoever is connected; through the
    // channel, for anyone who isn't, four messages a second (lib/laser).
    const toChannel = channelBatches()
    setLaserSender(message => {
      if (ghostRef.current !== false) return
      mesh?.send({ k: 'l', m: message })
      if (!allDirect()) toChannel.add(message)
    })
    const laserInterval = setInterval(() => {
      const message = toChannel.take()
      if (message) void channel.send({ type: 'broadcast', event: 'laser', payload: { ...message, userId } })
    }, CHANNEL_EVERY_MS)

    // The cursor, directly, every frame it moves, with when it was there
    // (RemoteCursors plays it back by that). A tenth of a world unit is finer
    // than a pixel.
    let sentX = NaN, sentY = NaN
    const liveInterval = setInterval(() => {
      if (!mesh || ghostRef.current !== false) return
      const x = Math.round(positionRef.current.x * 10) / 10
      const y = Math.round(positionRef.current.y * 10) / 10
      if (x === sentX && y === sentY) return
      sentX = x
      sentY = y
      mesh.send({ k: 'c', x, y, t: Math.round(positionAtRef.current) })
    }, 16)

    // Send position updates only when position actually changes. Throttled
    // to max 1 update per 2 seconds to keep Realtime message usage minimal.
    // Sent as a lightweight broadcast (not track()) -- see comment above the
    // channel config for why position is kept out of the presence registry.
    let lastBroadcastTime = 0
    let lastBroadcastX = positionRef.current.x
    let lastBroadcastY = positionRef.current.y
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
        // 2. Player has moved significantly, AND
        // 3. somebody here isn't connected directly, who'd see it no other way
        //    (docs/DECENTRALIZING.md, 1c).
        if (timeSinceLastBroadcast >= MIN_BROADCAST_INTERVAL && (dx >= MIN_MOVEMENT_DISTANCE || dy >= MIN_MOVEMENT_DISTANCE) && !allDirect()) {
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
      clearInterval(liveInterval)
      clearInterval(laserInterval)
      clearInterval(reconcileInterval)
      setLaserSender(null)
      stopWatching()
      unlink()
      forgetPaths()
      livePositions.clear()
      channelRef.current = null
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
