import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import { mapRowToLink } from '../lib/traceLinks'

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

    const channel = supabase
      .channel(`lobby-${lobbyId}-trace-links`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trace_links', filter: `lobby_id=eq.${lobbyId}` },
        (payload: any) => useGameStore.getState().receiveLink(mapRowToLink(payload.new)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trace_links', filter: `lobby_id=eq.${lobbyId}` },
        (payload: any) => useGameStore.getState().receiveLink(mapRowToLink(payload.new)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'trace_links', filter: `lobby_id=eq.${lobbyId}` },
        (payload: any) => { if (payload.old?.id) useGameStore.getState().forgetLink(payload.old.id) })
      .subscribe()

    return () => {
      cancelled = true
      channel.unsubscribe()
    }
  }, [lobbyId])
}
