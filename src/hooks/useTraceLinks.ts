import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import { mapRowToLink } from '../lib/traceLinks'
import { liveTable, readRows, type Change } from '../lib/liveChanges'

// The atrium's connections between traces: loaded with it, and kept live for
// everyone in it the way useTraces keeps traces live. On desktop the channel
// is the local shim's, which never fires -- there is nobody else to hear from.
//
// A read that fails leaves no connections rather than breaking the atrium:
// on the web, before add_trace_links.sql is applied, the table isn't there.
export function useTraceLinks(lobbyId: string | null) {
  useEffect(() => {
    if (!supabase || !lobbyId) return
    let cancelled = false
    const store = useGameStore.getState()

    ;(async () => {
      const { data, error } = await (supabase!.from('trace_links') as any).select('*').eq('lobby_id', lobbyId)
      if (cancelled) return
      store.setLinks(!error && Array.isArray(data) ? data.map(mapRowToLink) : [])
    })()

    // Others' changes (lib/liveChanges): through the room, or Supabase's feed.
    // The store leaves alone what's changed here and not saved yet.
    const applyChange = async (change: Change) => {
      const { receiveLink, forgetLink } = useGameStore.getState()
      for (const id of change.gone ?? []) forgetLink(id)
      if (change.ids?.length) for (const row of await readRows(supabase, 'trace_links', lobbyId, change.ids)) receiveLink(mapRowToLink(row))
      if (change.all) {
        const { data, error } = await (supabase!.from('trace_links') as any).select('*').eq('lobby_id', lobbyId)
        if (error || !Array.isArray(data)) return
        for (const row of data) receiveLink(mapRowToLink(row))
        // Saved here, and gone there: deleted (its trace was, say).
        const there = new Set(data.map((row: any) => row.id))
        for (const id of useGameStore.getState().savedLinks) if (!there.has(id)) forgetLink(id)
      }
    }
    const stopLive = liveTable(lobbyId, 'trace_links', () => {
      const channel = supabase
        .channel(`lobby-${lobbyId}-trace-links`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trace_links', filter: `lobby_id=eq.${lobbyId}` },
          (payload: any) => useGameStore.getState().receiveLink(mapRowToLink(payload.new)))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trace_links', filter: `lobby_id=eq.${lobbyId}` },
          (payload: any) => useGameStore.getState().receiveLink(mapRowToLink(payload.new)))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'trace_links', filter: `lobby_id=eq.${lobbyId}` },
          (payload: any) => { if (payload.old?.id) useGameStore.getState().forgetLink(payload.old.id) })
        .subscribe()
      return () => { channel.unsubscribe() }
    }, applyChange)

    return () => {
      cancelled = true
      stopLive()
    }
  }, [lobbyId])
}
