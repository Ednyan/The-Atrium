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
    border_opacity: trace.borderOpacity,
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
    z_index: trace.zIndex ?? 0,
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
  if (lobbyId) newTrace.lobby_id = lobbyId
  // Applies to every resizable type (text, image, embed, video, shape) --
  // this used to be gated to shape only, so duplicating a text/image/embed/
  // video trace silently dropped its size and fell back to the default box.
  if (trace.width) newTrace.width = trace.width
  if (trace.height) newTrace.height = trace.height

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
