import type { Trace } from '../types/database'

// Builds a DB-ready insert row from a Trace snapshot. Shared by duplicate
// (new id, offset position) and by undo/redo's delete<->reinsert round-trip
// (original id/created_at, no offset) -- and by the Layer panel's Duplicate
// Group. Lives in lib/ rather than inside a component so every caller shares
// one definition; a second copy would silently drop fields as the Trace shape
// grows (which is exactly how duplicate once lost width/height).
export function buildTraceInsertRow(
  trace: Trace,
  userId: string,
  username: string,
  lobbyId: string | undefined,
  offsetX: number,
  offsetY: number,
): Record<string, any> {
  const newTrace: any = {
    user_id: userId,
    username,
    type: trace.type,
    content: trace.content,
    position_x: trace.x + offsetX,
    position_y: trace.y + offsetY,
    scale: ((trace.scaleX ?? trace.scale ?? 1) + (trace.scaleY ?? trace.scale ?? 1)) / 2,
    scale_x: trace.scaleX ?? trace.scale ?? 1.0,
    scale_y: trace.scaleY ?? trace.scale ?? 1.0,
    rotation: trace.rotation ?? 0,
    flip_horizontal: trace.flipHorizontal ?? false,
    flip_vertical: trace.flipVertical ?? false,
    show_border: trace.showBorder ?? true,
    show_background: trace.showBackground ?? true,
    border_color: trace.borderColor,
    border_width: trace.borderWidth ?? 2,
    border_opacity: trace.borderOpacity,
    stroke_style: trace.strokeStyle,
    fill_color: trace.fillColor,
    fill_opacity: trace.fillOpacity,
    show_description: trace.showDescription ?? false,
    show_filename: trace.showFilename ?? true,
    font_size: trace.fontSize ?? 16,
    font_family: trace.fontFamily ?? 'sans',
    text_bold: trace.textBold ?? false,
    text_italic: trace.textItalic ?? false,
    text_scale_with_box: trace.textScaleWithBox ?? true,
    show_shadow: trace.showShadow ?? true,
    text_underline: trace.textUnderline ?? false,
    text_align: trace.textAlign ?? 'center',
    text_color: trace.textColor ?? '#ffffff',
    is_locked: false,
    border_radius: trace.borderRadius ?? 0,
    crop_x: trace.cropX ?? 0,
    crop_y: trace.cropY ?? 0,
    crop_width: trace.cropWidth ?? 1,
    crop_height: trace.cropHeight ?? 1,
    illuminate: trace.illuminate ?? false,
    light_color: trace.lightColor ?? '#ffffff',
    light_intensity: trace.lightIntensity ?? 1.0,
    light_radius: trace.lightRadius ?? 200,
    light_offset_x: trace.lightOffsetX ?? 0,
    light_offset_y: trace.lightOffsetY ?? 0,
    order_key: trace.orderKey ?? null,
    layer_name: trace.layerName ?? null,
    ignore_clicks: trace.ignoreClicks ?? false,
  }

  if (trace.imageUrl) newTrace.image_url = trace.imageUrl
  if (trace.mediaUrl) newTrace.media_url = trace.mediaUrl
  if (trace.linkUrl) newTrace.link_url = trace.linkUrl
  if (trace.isClickable) newTrace.is_clickable = true
  if (trace.lightPulse !== undefined) newTrace.light_pulse = trace.lightPulse
  if (trace.lightPulseSpeed !== undefined) newTrace.light_pulse_speed = trace.lightPulseSpeed
  if (trace.enableInteraction !== undefined) newTrace.enable_interaction = trace.enableInteraction
  if (trace.layerId) newTrace.layer_id = trace.layerId
  if (trace.frameId) newTrace.frame_id = trace.frameId
  if (lobbyId) newTrace.lobby_id = lobbyId
  // Applies to every resizable type (text, image, embed, video, shape) --
  // this used to be gated to shape only, so duplicating a text/image/embed/
  // video trace silently dropped its size and fell back to the default box.
  if (trace.width) newTrace.width = trace.width
  if (trace.height) newTrace.height = trace.height
  // A drawing's strokes (lib/brushes StrokeData): what it's painted from.
  if (trace.strokeData) newTrace.stroke_data = trace.strokeData

  if (trace.type === 'shape') {
    if (trace.shapeType) newTrace.shape_type = trace.shapeType
    if (trace.shapeColor) newTrace.shape_color = trace.shapeColor
    if (trace.shapeOpacity !== undefined) newTrace.shape_opacity = trace.shapeOpacity
    if (trace.cornerRadius !== undefined) newTrace.corner_radius = trace.cornerRadius
    if (trace.shapeOutlineOnly !== undefined) newTrace.shape_outline_only = trace.shapeOutlineOnly
    if (trace.shapeNoFill !== undefined) newTrace.shape_no_fill = trace.shapeNoFill
    if (trace.shapeOutlineColor) newTrace.shape_outline_color = trace.shapeOutlineColor
    if (trace.shapeOutlineWidth !== undefined) newTrace.shape_outline_width = trace.shapeOutlineWidth
    if (trace.shapeOutlineOpacity !== undefined) newTrace.shape_outline_opacity = trace.shapeOutlineOpacity
    if (trace.shapePoints) newTrace.shape_points = trace.shapePoints
    if (trace.pathCurveType) newTrace.path_curve_type = trace.pathCurveType
    if (trace.pathArrowStart) newTrace.path_arrow_start = trace.pathArrowStart
    if (trace.pathArrowEnd) newTrace.path_arrow_end = trace.pathArrowEnd
  }

  return newTrace
}

// A trace's columns as it now is, for writing over its row: every one a change
// can touch, set to what it is now -- a value taken away written as null. Not
// layer_id: groups are the layer queue's to write (lib/layerQueue), and a save
// that started before a trace was moved in or out of one would put it back.
export function traceColumns(trace: Trace): Record<string, any> {
  const columns: Record<string, any> = {
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
    border_width: trace.borderWidth ?? 2,
    border_opacity: trace.borderOpacity,
    stroke_style: trace.strokeStyle,
    fill_color: trace.fillColor,
    fill_opacity: trace.fillOpacity,
    show_description: trace.showDescription,
    show_filename: trace.showFilename,
    font_size: trace.fontSize,
    font_family: trace.fontFamily,
    text_bold: trace.textBold,
    text_italic: trace.textItalic,
    text_scale_with_box: trace.textScaleWithBox ?? true,
    show_shadow: trace.showShadow ?? true,
    text_underline: trace.textUnderline,
    text_align: trace.textAlign,
    text_color: trace.textColor,
    // Columns the database won't take empty get their defaults, should the
    // store hold none (a value taken back by undo is its default; a new
    // trace's row may leave them out).
    is_locked: trace.isLocked ?? false,
    border_radius: trace.borderRadius ?? 0,
    // Defaulted the same way traceInsert does. Without the fallback an
    // uncropped trace sends undefined here, which the web harmlessly drops
    // from the JSON body (so the column default applies) but the desktop
    // SQLite shim binds as a real NULL. Those nulls are invisible on
    // desktop -- reads default them back to 0/1 -- and only surface when
    // the atrium is exported and imported into Postgres, where these
    // columns are NOT NULL and reject the whole row.
    crop_x: trace.cropX ?? 0,
    crop_y: trace.cropY ?? 0,
    crop_width: trace.cropWidth ?? 1,
    crop_height: trace.cropHeight ?? 1,
    illuminate: trace.illuminate ?? false,
    light_color: trace.lightColor ?? '#ffffff',
    light_intensity: trace.lightIntensity ?? 1,
    light_radius: trace.lightRadius ?? 200,
    light_offset_x: trace.lightOffsetX ?? 0,
    light_offset_y: trace.lightOffsetY ?? 0,
    light_pulse: trace.lightPulse ?? false,
    light_pulse_speed: trace.lightPulseSpeed ?? 2,
    enable_interaction: trace.enableInteraction,
    ignore_clicks: trace.ignoreClicks,
    order_key: trace.orderKey ?? null,
    layer_name: trace.layerName ?? null,
    frame_id: trace.frameId ?? null,
  }

  // Add optional fields
  if (trace.mediaUrl !== undefined) columns.media_url = trace.mediaUrl
  if (trace.linkUrl !== undefined) columns.link_url = trace.linkUrl
  if (trace.isClickable !== undefined) columns.is_clickable = trace.isClickable ?? false
  if (trace.content !== undefined) columns.content = trace.content
  // width/height apply to every trace type that can be resized (text,
  // image, embed, video, shape) -- this used to be gated to shape only,
  // which silently dropped every other type's resize (manual or
  // auto-fit) on save, reverting to its creation-time size on reload.
  if (trace.width !== undefined) columns.width = trace.width
  if (trace.height !== undefined) columns.height = trace.height

  // Shape properties
  if (trace.type === 'shape') {
    if (trace.shapeType !== undefined) columns.shape_type = trace.shapeType
    if (trace.shapeColor !== undefined) columns.shape_color = trace.shapeColor
    if (trace.shapeOpacity !== undefined) columns.shape_opacity = trace.shapeOpacity
    if (trace.cornerRadius !== undefined) columns.corner_radius = trace.cornerRadius
    if (trace.shapeOutlineOnly !== undefined) columns.shape_outline_only = trace.shapeOutlineOnly
    if (trace.shapeNoFill !== undefined) columns.shape_no_fill = trace.shapeNoFill
    if (trace.shapeOutlineColor !== undefined) columns.shape_outline_color = trace.shapeOutlineColor
    if (trace.shapeOutlineWidth !== undefined) columns.shape_outline_width = trace.shapeOutlineWidth
    if (trace.shapeOutlineOpacity !== undefined) columns.shape_outline_opacity = trace.shapeOutlineOpacity
    if (trace.shapePoints !== undefined) columns.shape_points = trace.shapePoints
    if (trace.pathCurveType !== undefined) columns.path_curve_type = trace.pathCurveType
    if (trace.pathArrowStart !== undefined) columns.path_arrow_start = trace.pathArrowStart
    if (trace.pathArrowEnd !== undefined) columns.path_arrow_end = trace.pathArrowEnd
  }

  return columns
}

// The whole row of a trace that's there no longer -- deleted, and the
// deletion undone -- to put it back as it was: its id, its group, its lock.
export function traceRow(trace: Trace): Record<string, any> {
  return {
    ...buildTraceInsertRow(trace, trace.userId, trace.username, trace.lobbyId ?? undefined, 0, 0),
    ...traceColumns(trace),
    id: trace.id,
    ...(trace.createdAt ? { created_at: trace.createdAt } : {}),
  }
}
