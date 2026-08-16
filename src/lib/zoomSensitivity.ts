// How much of the canvas one zoom gesture covers.
//
// Lives here because two components need it and each used to carry its own
// copy: LobbyScene applies it, and the Profile panel's slider sets it. With the
// default written out twice, changing it in one place left the slider showing a
// number the canvas wasn't using until something happened to store a value.
//
// The stored value is a user setting, so the default only applies to someone
// who has never touched the slider.

export const MIN_ZOOM_SENSITIVITY = 0.04
export const MAX_ZOOM_SENSITIVITY = 0.6
export const DEFAULT_ZOOM_SENSITIVITY = 0.10

export const ZOOM_SENSITIVITY_STORAGE_KEY = 'lobby_zoomSensitivity'

export const clampZoomSensitivity = (value: number) =>
  Math.max(MIN_ZOOM_SENSITIVITY, Math.min(MAX_ZOOM_SENSITIVITY, value))

export const getStoredZoomSensitivity = () => {
  try {
    const raw = localStorage.getItem(ZOOM_SENSITIVITY_STORAGE_KEY)
    if (!raw) return DEFAULT_ZOOM_SENSITIVITY
    const parsed = parseFloat(raw)
    if (!Number.isFinite(parsed)) return DEFAULT_ZOOM_SENSITIVITY
    return clampZoomSensitivity(parsed)
  } catch {
    return DEFAULT_ZOOM_SENSITIVITY
  }
}
