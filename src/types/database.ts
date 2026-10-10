import type { StrokeStyle } from '../lib/strokeStyle'
import type { StrokeData } from '../lib/brushes'
import type { ExrGrade } from '../lib/exr'
export interface Database {
  public: {
    Tables: {
      traces: {
        Row: {
          id: string
          created_at: string
          user_id: string
          username: string
          type: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document' | 'frame' | 'sheet' | 'chart'
          content: string
          position_x: number
          position_y: number
          image_url: string | null
          media_url: string | null
          scale: number
          rotation: number
        }
        Insert: {
          id?: string
          created_at?: string
          user_id: string
          username: string
          type: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document' | 'frame' | 'sheet' | 'chart'
          content: string
          position_x: number
          position_y: number
          image_url?: string | null
          media_url?: string | null
          scale?: number
          rotation?: number
        }
        Update: {
          id?: string
          created_at?: string
          user_id?: string
          username?: string
          type?: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document' | 'frame' | 'sheet' | 'chart'
          content?: string
          position_x?: number
          position_y?: number
          image_url?: string | null
          media_url?: string | null
          scale?: number
          rotation?: number
        }
      }
    }
  }
}

export interface UserPresence {
  userId: string
  username: string
  x: number
  y: number
  timestamp: number
  playerColor?: string
  // When this user's presence session in the current atrium started (epoch
  // ms) -- fixed at connect time, not refreshed on every position broadcast,
  // so "time in atrium" can be computed as Date.now() - joinedAt.
  joinedAt?: number
}

export interface Trace {
  id: string
  userId: string
  username: string
  type: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape' | 'document' | 'frame' | 'sheet' | 'chart'
  content: string
  x: number
  y: number
  imageUrl?: string
  mediaUrl?: string
  // Generic click-through URL for embed traces, separate from mediaUrl (the
  // hotlinked image itself) -- used by the link-card fallback when the
  // image fails to load, so the card can still link to the source page
  // (e.g. the original Pinterest pin) instead of the dead image URL.
  linkUrl?: string
  createdAt: string
  // Shape properties
  shapeType?: 'rectangle' | 'circle' | 'triangle' | 'diamond' | 'parallelogram' | 'path'
  shapeColor?: string
  shapeOpacity?: number
  cornerRadius?: number // For rectangles only
  shapeOutlineOnly?: boolean // Show outline stroke
  shapeNoFill?: boolean // Render with no fill (invisible but still interactive)
  shapeOutlineColor?: string // Color of the outline stroke
  shapeOutlineWidth?: number // Width of the outline in pixels (1-20)
  shapeOutlineOpacity?: number // Outline/stroke opacity 0-1, independent of shapeOpacity (fill)
  // A drawing stroke's stroke, kept to paint it again from (lib/brushes).
  strokeData?: StrokeData | null
  // A picture made from an EXR: its original, and how it's shown (lib/exr).
  exr?: ExrGrade
  shapePoints?: Array<{
    x: number
    y: number
    cp1x?: number // Control point 1 x (for bezier curves)
    cp1y?: number // Control point 1 y
    cp2x?: number // Control point 2 x
    cp2y?: number // Control point 2 y
  }> // For path shapes
  pathCurveType?: 'straight' | 'bezier' | 'elbow' // For path shapes - line type
  pathArrowStart?: 'none' | 'triangle' | 'diamond' // Arrow at start of path
  pathArrowEnd?: 'none' | 'triangle' | 'diamond' // Arrow at end of path
  width?: number
  height?: number
  // Non-uniform scale support
  scale?: number
  scaleX?: number
  scaleY?: number
  rotation: number
  // Mirroring (independent of scaleX/scaleY, applied as a CSS flip transform)
  flipHorizontal?: boolean
  flipVertical?: boolean
  // Customization options
  showBorder?: boolean
  showBackground?: boolean
  borderColor?: string // Custom border color
  borderOpacity?: number // Border opacity 0-1
  // Its border's, outline's or line's style (lib/strokeStyle); none is solid.
  strokeStyle?: StrokeStyle
  borderWidth?: number // Frame thickness in px when showBorder is on
  fillColor?: string // Custom fill/background color
  fillOpacity?: number // Fill/background opacity 0-1
  showDescription?: boolean
  showFilename?: boolean
  fontSize?: 'small' | 'medium' | 'large' | number
  fontFamily?: string
  // Text formatting options
  textBold?: boolean
  textItalic?: boolean
  textUnderline?: boolean
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  textColor?: string
  // When true (default), font size scales with the trace's own box, so
  // resizing the trace resizes the text. When false the font size is fixed
  // and resizing only changes how much room the text has to reflow in.
  textScaleWithBox?: boolean
  // The text as large as its box allows, fitted to it (lib/textFit
  // fitFontSize) -- new text traces are; unset, the font size is its own.
  textFit?: boolean
  // Where the text sits in its box, up and down. Unset: the middle.
  textValign?: 'top' | 'middle' | 'bottom'
  // Soft ambient drop shadow under the trace frame. Default true; turning it
  // off leaves the trace flat against the canvas.
  showShadow?: boolean
  isLocked?: boolean
  // Left-clicking the trace opens linkUrl. Its own field rather than being
  // inferred from linkUrl, so switching it off keeps the address.
  isClickable?: boolean
  borderRadius?: number // Border radius for trace container (0-50px)
  // Image cropping (values between 0 and 1, representing percentage)
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
  // Lighting properties
  illuminate?: boolean
  lightColor?: string
  lightIntensity?: number
  lightRadius?: number
  lightOffsetX?: number
  lightOffsetY?: number
  lightPulse?: boolean
  lightPulseSpeed?: number // 0.1 to 5.0, seconds per pulse cycle
  // Where its light comes from: a point at its middle (as it always has), all
  // of its shape, or its border. None is the middle.
  lightEmit?: 'center' | 'shape' | 'border'
  // Embed interaction
  enableInteraction?: boolean // Allow iframe to be interacted with (for embeds)
  // Click interaction
  ignoreClicks?: boolean // Make trace unselectable with left click (for backgrounds)
  // Layer system
  layerId?: string | null
  // Its place among the traces of its group (lib/order). Null only for a trace
  // saved by a version from before order keys.
  orderKey?: string | null
  // A text trace's name in the Layer panel (Text 1, ...). Other traces are
  // named by their content, their title.
  layerName?: string | null
  // The frame this trace is in (lib/frames); null in none. A frame's title
  // is its content.
  frameId?: string | null
  // Lobby association
  lobbyId?: string
}

export interface Layer {
  id: string
  createdAt: string
  name: string
  // Its place among the atrium's groups (lib/order).
  orderKey?: string | null
  isGroup: boolean
  parentId?: string | null
  userId: string
  lobbyId?: string | null
}

export interface LobbyLocation {
  id: string
  createdAt: string
  lobbyId: string
  name: string
  positionX: number
  positionY: number
  zoom: number
  orderIndex: number
  userId?: string | null
  // Blocks "set to current view" only -- rename and delete stay available,
  // since those already confirm before acting.
  isLocked?: boolean
}

export interface Profile {
  id: string
  username: string
  email: string
  displayName: string
  displayNameLastChanged: string
  createdAt: string
  updatedAt: string
  playerColor?: string
  activeLobbyId?: string | null
}

export interface ThemeSettings {
  gridColor?: string
  gridOpacity?: number
  gridEnabled?: boolean
  // Lines, dots, or none (lib/customThemes gridStyleOf: a theme from before
  // has gridEnabled alone). gridEnabled is kept in step, for what reads it.
  gridStyle?: 'none' | 'lines' | 'dots'
  // Distance between the grid lines, in world units. Also what
  // Shift-dragging a trace snaps onto.
  gridLineSpacing?: number
  backgroundColor?: string
  particlesEnabled?: boolean
  particleColor?: string
  particleOpacity?: number
  particleDensity?: number
  // Things on the ground (lib/ground): built-in elements by name, and
  // pictures of one's own by link; tinted, faded, scattered or in rows.
  groundEnabled?: boolean
  groundElements?: string[]
  groundColor?: string
  groundOpacity?: number
  groundDensity?: number
  groundScale?: number
  groundScaleRange?: number
  groundPattern?: 'random' | 'grid'
  groundSpacing?: number
  groundRotation?: number
  // A picture under the grid (LobbyScene's backdrop): repeated, as faint as
  // its opacity, its size a share of its own, following the view by a share
  // of how the world moves (0 fixed to the screen, 1 with the canvas).
  backgroundImage?: string
  backgroundImageEnabled?: boolean
  backgroundImageOpacity?: number
  backgroundImageScale?: number
  backgroundParallax?: number
  backgroundParallaxEnabled?: boolean
  backgroundImageFill?: boolean
}

export interface Lobby {
  id: string
  name: string
  ownerUserId: string
  passwordHash?: string | null
  maxPlayers: number
  isPublic: boolean
  createdAt: string
  updatedAt: string
  themeSettings?: ThemeSettings | null
  // User ids promoted to admin by the owner (full Manage Atrium access, but
  // can't promote/demote other admins or transfer ownership). Stored
  // directly on the lobby row rather than as lobby_access_lists rows so
  // checking it from that table's own RLS policy can't recurse -- see
  // fix_lobby_admin_recursion_v2.sql.
  adminUserIds?: string[]
  // Who can create/edit/delete traces and layers in this atrium -- 'all'
  // (default), 'none' (owner/admins only), or 'selected' (owner/admins plus
  // users on the 'editor' lobby_access_lists entries). View access is
  // unaffected by this; it only gates writes, enforced server-side via
  // user_can_edit_lobby (see add_edit_permissions.sql).
  editPermissionMode?: 'all' | 'none' | 'selected'
}

export interface LobbyAccessList {
  id: string
  lobbyId: string
  userId: string
  listType: 'whitelist' | 'blacklist' | 'editor'
  addedAt: string
  addedBy?: string | null
}
