import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import type { Layer } from '../types/database'

export function mapRowToLayer(row: any): Layer {
  return {
    id: row.id,
    createdAt: row.created_at,
    name: row.name,
    orderKey: row.order_key ?? null,
    isGroup: row.is_group,
    parentId: row.parent_id,
    userId: row.user_id,
    lobbyId: row.lobby_id,
  }
}

// Reads the atrium's groups again. Changes made here put themselves in the
// store as they go; this is for everything else -- another person's change on
// the web, or anything that only announced itself (atrium:layers-changed).
export async function reloadLayers(lobbyId: string) {
  if (!supabase) return
  const { data, error } = await (supabase.from('layers') as any).select('*').eq('lobby_id', lobbyId)
  if (!error && Array.isArray(data)) {
    useGameStore.getState().setLayers(data.map(mapRowToLayer))
  }
}

// The atrium's groups: loaded with it and kept live, like its traces. On
// desktop the channel is the local shim's and never fires, so a change made
// outside the store says so with atrium:layers-changed.
export function useLayers(lobbyId: string | null) {
  useEffect(() => {
    if (!supabase || !lobbyId) return
    const reload = () => { void reloadLayers(lobbyId) }
    reload()
    window.addEventListener('atrium:layers-changed', reload)
    const channel = supabase
      .channel(`lobby-${lobbyId}-layers`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'layers', filter: `lobby_id=eq.${lobbyId}` }, reload)
      .subscribe()
    return () => {
      window.removeEventListener('atrium:layers-changed', reload)
      channel.unsubscribe()
    }
  }, [lobbyId])
}
