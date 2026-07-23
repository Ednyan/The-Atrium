import { supabase, isDesktop } from './supabase'
import { useGameStore } from '../store/gameStore'
import { mapRowToTrace } from '../hooks/useTraces'

// Fired on window whenever a saveAllChanges() call completes successfully.
// Undo/redo history (see TraceOverlay.tsx) listens for this to clear its
// stacks, since a diff-based undo entry can no longer be safely replayed
// once the underlying rows it was computed against have been persisted
// (other collaborators' realtime edits may land in between).
export const TRACE_SAVE_COMPLETED_EVENT = 'trace-save-completed'

// Discard every unsaved trace change/deletion by re-fetching the atrium's
// traces from the database (the last saved state) and replacing the store's
// copy. setTraces() clears pendingChanges/deletedTraces, so after this the
// atrium reflects exactly what's persisted -- as if the user had refreshed,
// but without actually reloading the page. Used by the HUD "Don't Save"
// button. Returns false if there was nothing to discard or the reload failed.
export async function discardAllChanges(lobbyId: string): Promise<boolean> {
  const store = useGameStore.getState()
  if (!supabase || store.isSavingChanges) return false
  if (!store.hasPendingChanges()) return false

  try {
    const { data, error } = await supabase
      .from('traces')
      .select('*')
      .eq('lobby_id', lobbyId)
      .order('created_at', { ascending: false })
      .limit(100)

    if (error || !data) return false

    const traces = data.map(mapRowToTrace)

    // Desktop: re-warm the local media blob-URL cache for anything we just
    // pulled back, mirroring the initial load in useTraces, so reverted
    // image/audio/video traces still render immediately.
    if (isDesktop) {
      const localUrls = new Set<string>()
      for (const trace of traces) {
        for (const url of [trace.mediaUrl, trace.imageUrl]) {
          if (url && url.startsWith('local://')) localUrls.add(url)
        }
      }
      if (localUrls.size > 0) {
        const { resolveLocalUrl } = await import('./localDb')
        await Promise.allSettled(Array.from(localUrls).map(url => resolveLocalUrl(url)))
      }
    }

    useGameStore.getState().setTraces(traces)
    return true
  } catch {
    return false
  }
}

// Save every pending trace change/deletion to the database. Shared by the
// Ctrl+S shortcut, the HUD save button, autosave, and the desktop
// close-with-unsaved-changes prompt so they can't race each other.
export async function saveAllChanges(): Promise<void> {
  const store = useGameStore.getState()
  if (!supabase || store.isSavingChanges) return

  const db = supabase // Capture for use in closures
  store.setIsSavingChanges(true)

  try {
    const { pendingChanges, deletedTraces, traces, clearPendingChanges } = useGameStore.getState()

    // Handle deletions first
    const deletePromises = Array.from(deletedTraces).map(async (traceId) => {
      await (db.from('traces') as any).delete().eq('id', traceId)
    })
    await Promise.all(deletePromises)

    // Handle updates
    const updatePromises = Array.from(pendingChanges).map(async (traceId) => {
      const trace = traces.find(t => t.id === traceId)
      if (!trace) return

      const updateData: any = {
        type: trace.type,
        position_x: trace.x,
        position_y: trace.y,
        // scale_x/scale_y are authoritative and persisted independently so
        // non-uniform (stretched) resizes survive a reload; `scale` is kept
        // in sync as their average only for backward compatibility with any
        // code still reading the legacy single-value column.
        scale: ((trace.scaleX ?? 1) + (trace.scaleY ?? 1)) / 2,
        scale_x: trace.scaleX ?? 1,
        scale_y: trace.scaleY ?? 1,
        rotation: trace.rotation ?? 0,
        flip_horizontal: trace.flipHorizontal ?? false,
        flip_vertical: trace.flipVertical ?? false,
        show_border: trace.showBorder,
        show_background: trace.showBackground,
        border_color: trace.borderColor,
        border_opacity: trace.borderOpacity,
        fill_color: trace.fillColor,
        fill_opacity: trace.fillOpacity,
        show_description: trace.showDescription,
        show_filename: trace.showFilename,
        font_size: trace.fontSize,
        font_family: trace.fontFamily,
        text_bold: trace.textBold,
        text_italic: trace.textItalic,
        text_underline: trace.textUnderline,
        text_align: trace.textAlign,
        text_color: trace.textColor,
        is_locked: trace.isLocked,
        border_radius: trace.borderRadius,
        crop_x: trace.cropX,
        crop_y: trace.cropY,
        crop_width: trace.cropWidth,
        crop_height: trace.cropHeight,
        illuminate: trace.illuminate,
        light_color: trace.lightColor,
        light_intensity: trace.lightIntensity,
        light_radius: trace.lightRadius,
        light_offset_x: trace.lightOffsetX,
        light_offset_y: trace.lightOffsetY,
        light_pulse: trace.lightPulse,
        light_pulse_speed: trace.lightPulseSpeed,
        enable_interaction: trace.enableInteraction,
        ignore_clicks: trace.ignoreClicks,
        z_index: trace.zIndex,
      }

      // Add optional fields
      if (trace.mediaUrl !== undefined) updateData.media_url = trace.mediaUrl
      if (trace.linkUrl !== undefined) updateData.link_url = trace.linkUrl
      if (trace.content !== undefined) updateData.content = trace.content
      // width/height apply to every trace type that can be resized (text,
      // image, embed, video, shape) -- this used to be gated to shape only,
      // which silently dropped every other type's resize (manual or
      // auto-fit) on save, reverting to its creation-time size on reload.
      if (trace.width !== undefined) updateData.width = trace.width
      if (trace.height !== undefined) updateData.height = trace.height

      // Shape properties
      if (trace.type === 'shape') {
        if (trace.shapeType !== undefined) updateData.shape_type = trace.shapeType
        if (trace.shapeColor !== undefined) updateData.shape_color = trace.shapeColor
        if (trace.shapeOpacity !== undefined) updateData.shape_opacity = trace.shapeOpacity
        if (trace.cornerRadius !== undefined) updateData.corner_radius = trace.cornerRadius
        if (trace.shapeOutlineOnly !== undefined) updateData.shape_outline_only = trace.shapeOutlineOnly
        if (trace.shapeNoFill !== undefined) updateData.shape_no_fill = trace.shapeNoFill
        if (trace.shapeOutlineColor !== undefined) updateData.shape_outline_color = trace.shapeOutlineColor
        if (trace.shapeOutlineWidth !== undefined) updateData.shape_outline_width = trace.shapeOutlineWidth
        if (trace.shapeOutlineOpacity !== undefined) updateData.shape_outline_opacity = trace.shapeOutlineOpacity
        if (trace.shapePoints !== undefined) updateData.shape_points = trace.shapePoints
        if (trace.pathCurveType !== undefined) updateData.path_curve_type = trace.pathCurveType
        if (trace.pathArrowStart !== undefined) updateData.path_arrow_start = trace.pathArrowStart
        if (trace.pathArrowEnd !== undefined) updateData.path_arrow_end = trace.pathArrowEnd
      }

      await (db.from('traces') as any).update(updateData).eq('id', traceId)
    })
    await Promise.all(updatePromises)

    // Clear pending changes
    clearPendingChanges()
    window.dispatchEvent(new CustomEvent(TRACE_SAVE_COMPLETED_EVENT))
  } catch (error) {
    alert('Failed to save some changes. Please try again.')
  } finally {
    useGameStore.getState().setIsSavingChanges(false)
  }
}
