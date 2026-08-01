import { useEffect, useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase, isDesktop } from '../lib/supabase'
import type { Trace } from '../types/database'

// Ceiling on how long atrium entry will wait for images to decode. Generous
// enough for a normal atrium over a slow connection, short enough that a
// dead image host is a brief pause rather than a hang.
const IMAGE_PRELOAD_TIMEOUT_MS = 10000

// PostgREST caps a single response (Supabase's db-max-rows defaults to 1000),
// so large atriums are read in pages rather than one request.
const TRACE_PAGE_SIZE = 1000

// Loads EVERY trace in a lobby.
//
// This used to be a flat `.limit(100)`. Traces arriving live were appended to
// the store, so an atrium could hold more than 100 while you worked -- but any
// reload fetched only the 100 newest by created_at, and the oldest silently
// never came back. That read as traces "randomly disappearing" after a reload
// (the missing ones are the oldest, which has no visual pattern), and refreshing
// never recovered them because the fetch itself was what dropped them. The rows
// were never deleted -- just never asked for.
//
// Desktop takes the single-query path: its SQLite shim has no .range(), and an
// unbounded select against a local database is cheap anyway.
export async function fetchAllLobbyTraces(client: any, lobbyId: string): Promise<any[]> {
  const base = () => client
    .from('traces')
    .select('*')
    .eq('lobby_id', lobbyId)
    .order('created_at', { ascending: false })

  if (isDesktop) {
    const { data, error } = await base()
    if (error) throw error
    return data ?? []
  }

  const rows: any[] = []
  for (let from = 0; ; from += TRACE_PAGE_SIZE) {
    const { data, error } = await base().range(from, from + TRACE_PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < TRACE_PAGE_SIZE) break
  }
  return rows
}

export function mapRowToTrace(row: any): Trace {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    type: row.type,
    content: row.content,
    x: row.position_x,
    y: row.position_y,
    imageUrl: row.image_url || undefined,
    mediaUrl: row.media_url || undefined,
    linkUrl: row.link_url || undefined,
    isClickable: !!row.is_clickable,
    borderWidth: row.border_width ?? 2,
    createdAt: row.created_at,
    scale: row.scale ?? 1.0,
    // scale_x/scale_y are authoritative (support non-uniform stretch);
    // fall back to the legacy averaged `scale` column for rows saved before
    // they existed.
    scaleX: row.scale_x ?? row.scale ?? 1.0,
    scaleY: row.scale_y ?? row.scale ?? 1.0,
    rotation: row.rotation ?? 0.0,
    flipHorizontal: row.flip_horizontal ?? false,
    flipVertical: row.flip_vertical ?? false,
    showBorder: row.show_border ?? true,
    showBackground: row.show_background ?? true,
    borderColor: row.border_color,
    borderOpacity: row.border_opacity,
    fillColor: row.fill_color,
    fillOpacity: row.fill_opacity,
    showDescription: row.show_description ?? true,
    showFilename: row.show_filename ?? true,
    fontSize: row.font_size ?? 16,
    fontFamily: row.font_family ?? 'sans',
    textBold: row.text_bold ?? false,
    textItalic: row.text_italic ?? false,
    textScaleWithBox: row.text_scale_with_box ?? true,
    showShadow: row.show_shadow ?? true,
    textUnderline: row.text_underline ?? false,
    textAlign: row.text_align ?? 'center',
    textColor: row.text_color ?? '#ffffff',
    isLocked: row.is_locked ?? false,
    borderRadius: row.border_radius ?? 0,
    cropX: row.crop_x ?? 0,
    cropY: row.crop_y ?? 0,
    cropWidth: row.crop_width ?? 1,
    cropHeight: row.crop_height ?? 1,
    illuminate: row.illuminate ?? false,
    lightColor: row.light_color ?? '#ffffff',
    lightIntensity: row.light_intensity ?? 1.0,
    lightRadius: row.light_radius ?? 200,
    lightOffsetX: row.light_offset_x ?? 0,
    lightOffsetY: row.light_offset_y ?? 0,
    lightPulse: row.light_pulse ?? false,
    lightPulseSpeed: row.light_pulse_speed ?? 2.0,
    enableInteraction: row.enable_interaction ?? false,
    ignoreClicks: row.ignore_clicks ?? false,
    layerId: row.layer_id ?? null,
    zIndex: row.z_index ?? 0,
    lobbyId: row.lobby_id,
    // Shape properties
    shapeType: row.shape_type,
    shapeColor: row.shape_color,
    shapeOpacity: row.shape_opacity,
    cornerRadius: row.corner_radius,
    shapeOutlineOnly: row.shape_outline_only,
    shapeNoFill: row.shape_no_fill,
    shapeOutlineColor: row.shape_outline_color,
    shapeOutlineWidth: row.shape_outline_width,
    shapeOutlineOpacity: row.shape_outline_opacity ?? 1.0,
    shapePoints: row.shape_points,
    pathCurveType: row.path_curve_type,
    pathArrowStart: row.path_arrow_start,
    pathArrowEnd: row.path_arrow_end,
    width: row.width,
    height: row.height,
  }
}

export function useTraces(lobbyId: string | null) {
  const { setTraces, addTrace, removeTrace, setServerLobbySize } = useGameStore()
  // True while the initial trace fetch (and, on desktop, local media
  // pre-resolution) for this lobby is in flight. Callers (App.tsx) use this
  // to hold the atrium-entry loading screen open until data is actually
  // ready, instead of it being a purely cosmetic fixed-length animation.
  const [isLoading, setIsLoading] = useState(!!lobbyId)

  useEffect(() => {
    if (!supabase || !lobbyId) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    let cancelled = false

    // Fetch actual lobby size from Supabase RPC
    const fetchLobbySize = async (traceCount: number) => {
      try {
        const { data, error } = await (supabase as any).rpc('get_lobby_size_bytes', { p_lobby_id: lobbyId })
        if (!error && data !== null) {
          setServerLobbySize(Number(data), traceCount)
        }
      } catch {
        // Silently fall back to client-side estimation
      }
    }

    // Load existing traces
    const loadTraces = async () => {
      try {
        if (!supabase) {
          return
        }

        const data = await fetchAllLobbyTraces(supabase, lobbyId)

        if (data) {
          const traces: Trace[] = data.map(mapRowToTrace)
          setTraces(traces)
          // Fetch the real lobby size from Supabase
          fetchLobbySize(traces.length)

          // Desktop: pre-warm the local media blob-URL cache so images/audio/
          // video are already resolved by the time the atrium becomes visible,
          // instead of popping in one-by-one after the loading screen ends.
          const resolveLocalUrl = isDesktop
            ? (await import('../lib/localDb')).resolveLocalUrl
            : null

          if (resolveLocalUrl) {
            const localUrls = new Set<string>()
            for (const trace of traces) {
              for (const url of [trace.mediaUrl, trace.imageUrl]) {
                if (url && url.startsWith('local://')) localUrls.add(url)
              }
            }
            if (localUrls.size > 0) {
              await Promise.allSettled(Array.from(localUrls).map(url => resolveLocalUrl(url)))
            }
          }

          // Resolving a URL isn't the same as the picture being ready to
          // paint -- the browser still has to fetch and decode it. Without
          // this the loading screen ended as soon as the trace *rows* landed,
          // so images visibly popped in afterwards. Decoding them here moves
          // that wait into the loading screen where it belongs.
          if (!cancelled) {
            const imageUrls: string[] = []
            for (const trace of traces) {
              if (trace.type !== 'image') continue
              const raw = trace.mediaUrl || trace.imageUrl
              if (!raw) continue
              if (raw.startsWith('local://')) {
                // Already resolved above, so this hits the cache.
                if (resolveLocalUrl) {
                  const resolved = await resolveLocalUrl(raw)
                  if (resolved) imageUrls.push(resolved)
                }
              } else {
                imageUrls.push(raw)
              }
            }

            if (imageUrls.length > 0) {
              // Raced against a timeout on purpose: a slow or dead host must
              // not hold atrium entry hostage. Whatever hasn't finished by
              // then just keeps loading in the background, exactly as it did
              // before. onerror resolves too -- a broken image shouldn't
              // stall the others.
              await Promise.race([
                Promise.all(imageUrls.map(url => new Promise<void>(resolve => {
                  const img = new Image()
                  img.onload = () => resolve()
                  img.onerror = () => resolve()
                  img.src = url
                }))),
                new Promise<void>(resolve => setTimeout(resolve, IMAGE_PRELOAD_TIMEOUT_MS)),
              ])
            }
          }
        }
      } catch (error) {
        // Silent error handling
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadTraces()

    // Subscribe to new traces in this lobby
    const channel = supabase
      .channel(`lobby-${lobbyId}-traces`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'traces',
          filter: `lobby_id=eq.${lobbyId}`,
        },
        (payload: any) => {
          addTrace(mapRowToTrace(payload.new))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'traces',
          filter: `lobby_id=eq.${lobbyId}`,
        },
        (payload: any) => {
          const row = payload.new as any

          // Skip updates for traces with pending local changes (to preserve local edits)
          // Use getState() to get the current value, not a stale closure
          const currentPendingChanges = useGameStore.getState().pendingChanges
          if (currentPendingChanges.has(row.id)) {
            return
          }

          // Update the trace in the store
          addTrace(mapRowToTrace(row))
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'traces',
          filter: `lobby_id=eq.${lobbyId}`,
        },
        (payload: any) => {
          const row = payload.old as any
          if (row.id) {
            removeTrace(row.id)
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      channel.unsubscribe()
    }
  }, [lobbyId])

  return { isLoading }
}
