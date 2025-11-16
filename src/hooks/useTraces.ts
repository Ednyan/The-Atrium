import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase } from '../lib/supabase'
import type { Trace } from '../types/database'

export function useTraces() {
  const { setTraces, addTrace, removeTrace } = useGameStore()

  useEffect(() => {
    if (!supabase) {
      console.log('⚠️ Traces hook: Supabase not available')
      return
    }

    console.log('📦 Loading traces from database...')

    // Load existing traces
    const loadTraces = async () => {
      try {
        if (!supabase) {
          console.log('❌ loadTraces: No supabase client')
          return
        }
        
        console.log('🔍 Executing database query for traces...')
        
        const { data, error } = await supabase
          .from('traces')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100)

        console.log('📊 Query result - data:', data, 'error:', error)

        if (error) {
          console.error('❌ Database error:', error)
          throw error
        }

        if (data) {
          console.log('✅ Loaded', data.length, 'traces from database')
          console.log('📋 First trace (if any):', data[0])
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
            fontSize: row.font_size ?? 'medium',
            fontFamily: row.font_family ?? 'sans',
            isLocked: row.is_locked ?? false,
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
            layerId: row.layer_id ?? null,
            zIndex: row.z_index ?? 0,
          }))
          console.log('🎯 Calling setTraces with', traces.length, 'traces')
          setTraces(traces)
          console.log('✅ setTraces completed')
        } else {
          console.log('⚠️ Query returned no data')
        }
      } catch (error) {
        console.error('❌ Error loading traces:', error)
      }
    }

    loadTraces()

    console.log('📡 Subscribing to trace updates...')

    // Subscribe to new traces
    const channel = supabase
      .channel('traces-channel')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'traces',
        },
        (payload) => {
          console.log('✨ New trace received:', payload.new)
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
            fontSize: row.font_size ?? 'medium',
            fontFamily: row.font_family ?? 'sans',
            isLocked: row.is_locked ?? false,
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
            layerId: row.layer_id ?? null,
            zIndex: row.z_index ?? 0,
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
        },
        (payload) => {
          console.log('🔄 Trace updated:', payload.new)
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
            fontSize: row.font_size ?? 'medium',
            fontFamily: row.font_family ?? 'sans',
            isLocked: row.is_locked ?? false,
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
            layerId: row.layer_id ?? null,
            zIndex: row.z_index ?? 0,
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
        },
        (payload) => {
          console.log('🗑️ Trace deleted:', payload.old)
          const row = payload.old as any
          if (row.id) {
            removeTrace(row.id)
          }
        }
      )
      .subscribe((status, err) => {
        console.log('📡 Traces channel status:', status)
        if (err) {
          console.error('❌ Traces channel error:', err)
        }
        if (status === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to traces updates!')
        }
      })

    return () => {
      console.log('🔌 Unsubscribing from trace updates')
      channel.unsubscribe()
    }
  }, [])
}
