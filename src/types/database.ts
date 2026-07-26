export interface Database {
  public: {
    Tables: {
      traces: {
        Row: {
          id: string
          created_at: string
          user_id: string
          username: string
          type: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape'
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
          type: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape'
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
          type?: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape'
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
  type: 'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape'
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
  shapeType?: 'rectangle' | 'circle' | 'triangle' | 'path'
  shapeColor?: string
  shapeOpacity?: number
  cornerRadius?: number // For rectangles only
  shapeOutlineOnly?: boolean // Show outline stroke
  shapeNoFill?: boolean // Render with no fill (invisible but still interactive)
  shapeOutlineColor?: string // Color of the outline stroke
  shapeOutlineWidth?: number // Width of the outline in pixels (1-20)
  shapeOutlineOpacity?: number // Outline/stroke opacity 0-1, independent of shapeOpacity (fill)
  shapePoints?: Array<{
    x: number
    y: number
    cp1x?: number // Control point 1 x (for bezier curves)
    cp1y?: number // Control point 1 y
    cp2x?: number // Control point 2 x
    cp2y?: number // Control point 2 y
  }> // For path shapes
  pathCurveType?: 'straight' | 'bezier' // For path shapes - line type
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
  // Soft ambient drop shadow under the trace frame. Default true; turning it
  // off leaves the trace flat against the canvas.
  showShadow?: boolean
  isLocked?: boolean
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
  // Embed interaction
  enableInteraction?: boolean // Allow iframe to be interacted with (for embeds)
  // Click interaction
  ignoreClicks?: boolean // Make trace unselectable with left click (for backgrounds)
  // Layer system
  layerId?: string | null
  zIndex?: number
  // Lobby association
  lobbyId?: string
}

export interface Layer {
  id: string
  createdAt: string
  name: string
  zIndex: number
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
  backgroundColor?: string
  particlesEnabled?: boolean
  particleColor?: string
  groundParticlesEnabled?: boolean
  groundParticleUrls?: string[]
  groundElementScale?: number
  groundElementScaleRange?: number
  groundElementDensity?: number
  particleOpacity?: number
  particleDensity?: number
  groundParticleOpacity?: number
  groundPatternMode?: 'grid' | 'random'
  gridSpacing?: number
  groundCoverFullView?: boolean
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
  // Atrium-wide autosave policy, configured by the owner in the Manage
  // panel. Every collaborator's client honors this while in the atrium.
  autosaveEnabled?: boolean
  autosaveIntervalSeconds?: number
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
