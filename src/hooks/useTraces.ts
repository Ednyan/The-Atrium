import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase } from '../lib/supabase'
import type { Trace } from '../types/database'

export function useTraces(lobbyId: string | null) {
  const { setTraces, addTrace, removeTrace } = useGameStore()

  useEffect(() => {
    if (!supabase || !lobbyId) {
      return
    }

    // Load existing traces
    const loadTraces = async () => {
      try {
        if (!supabase) {
          return
        }
        
        const { data, error } = await supabase
          .from('traces')
          .select('*')
          .eq('lobby_id', lobbyId)
          .order('created_at', { ascending: false })
          .limit(100)

        if (error) {
          throw error
        }

        if (data) {
          const traces: Trace[] = data.map((row: any) => ({
            id: row.id,
            userId: row.user_id,
            username: row.username,
            type: row.type,
            content: row.content,
            x: row.position_x,
            y: row.position_y,
            imageUrl: row.image_url || undefined,
            mediaUrl: row.media_url || undefined,
            createdAt: row.created_at,
            scale: row.scale ?? 1.0,
            scaleX: row.scale ?? 1.0,
            scaleY: row.scale ?? 1.0,
            rotation: row.rotation ?? 0.0,
            showBorder: row.show_border ?? true,
            showBackground: row.show_background ?? true,
            showDescription: row.show_description ?? true,
            showFilename: row.show_filename ?? true,
            fontSize: row.font_size ?? 16,
            fontFamily: row.font_family ?? 'sans',
            textBold: row.text_bold ?? false,
            textItalic: row.text_italic ?? false,
            textUnderline: row.text_underline ?? false,
            textAlign: row.text_align ?? 'center',
            textColor: row.text_color ?? '#ffffff',
            isLocked: row.is_locked ?? false,
            borderRadius: row.border_radius ?? 8,
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
            shapePoints: row.shape_points,
            pathCurveType: row.path_curve_type,
            width: row.width,
            height: row.height,
          }))
          setTraces(traces)
        }
      } catch (error) {
        // Silent error handling
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
        (payload) => {
          const row = payload.new as any
          const trace: Trace = {
            id: row.id,
            userId: row.user_id,
            username: row.username,
            type: row.type,
            content: row.content,
            x: row.position_x,
            y: row.position_y,
            imageUrl: row.image_url || undefined,
            mediaUrl: row.media_url || undefined,
            createdAt: row.created_at,
            scale: row.scale ?? 1.0,
            scaleX: row.scale ?? 1.0,
            scaleY: row.scale ?? 1.0,
            rotation: row.rotation ?? 0.0,
            showBorder: row.show_border ?? true,
            showBackground: row.show_background ?? true,
            showDescription: row.show_description ?? true,
            showFilename: row.show_filename ?? true,
            fontSize: row.font_size ?? 16,
            fontFamily: row.font_family ?? 'sans',
            textBold: row.text_bold ?? false,
            textItalic: row.text_italic ?? false,
            textUnderline: row.text_underline ?? false,
            textAlign: row.text_align ?? 'center',
            textColor: row.text_color ?? '#ffffff',
            isLocked: row.is_locked ?? false,
            borderRadius: row.border_radius ?? 8,
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
            shapePoints: row.shape_points,
            pathCurveType: row.path_curve_type,
            width: row.width,
            height: row.height,
          }
          addTrace(trace)
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
        (payload) => {
          const row = payload.new as any
          
          // Skip updates for traces with pending local changes (to preserve local edits)
          // Use getState() to get the current value, not a stale closure
          const currentPendingChanges = useGameStore.getState().pendingChanges
          if (currentPendingChanges.has(row.id)) {
            return
          }
          
          const trace: Trace = {
            id: row.id,
            userId: row.user_id,
            username: row.username,
            type: row.type,
            content: row.content,
            x: row.position_x,
            y: row.position_y,
            imageUrl: row.image_url || undefined,
            mediaUrl: row.media_url || undefined,
            createdAt: row.created_at,
            scale: row.scale ?? 1.0,
            scaleX: row.scale ?? 1.0,
            scaleY: row.scale ?? 1.0,
            rotation: row.rotation ?? 0.0,
            showBorder: row.show_border ?? true,
            showBackground: row.show_background ?? true,
            showDescription: row.show_description ?? true,
            showFilename: row.show_filename ?? true,
            fontSize: row.font_size ?? 16,
            fontFamily: row.font_family ?? 'sans',
            textBold: row.text_bold ?? false,
            textItalic: row.text_italic ?? false,
            textUnderline: row.text_underline ?? false,
            textAlign: row.text_align ?? 'center',
            textColor: row.text_color ?? '#ffffff',
            isLocked: row.is_locked ?? false,
            borderRadius: row.border_radius ?? 8,
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
            shapePoints: row.shape_points,
            pathCurveType: row.path_curve_type,
            width: row.width,
            height: row.height,
          }
          // Update the trace in the store
          addTrace(trace)
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
        (payload) => {
          const row = payload.old as any
          if (row.id) {
            removeTrace(row.id)
          }
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [lobbyId])
}
