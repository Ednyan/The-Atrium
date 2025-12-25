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
  shapePoints?: Array<{
    x: number
    y: number
    cp1x?: number // Control point 1 x (for bezier curves)
    cp1y?: number // Control point 1 y
    cp2x?: number // Control point 2 x
    cp2y?: number // Control point 2 y
  }> // For path shapes
  pathCurveType?: 'straight' | 'bezier' // For path shapes - line type
  width?: number
  height?: number
  // Non-uniform scale support
  scale?: number
  scaleX?: number
  scaleY?: number
  rotation: number
  // Customization options
  showBorder?: boolean
  showBackground?: boolean
  showDescription?: boolean
  showFilename?: boolean
  fontSize?: 'small' | 'medium' | 'large' | number
  fontFamily?: string
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
}

export interface LobbyAccessList {
  id: string
  lobbyId: string
  userId: string
  listType: 'whitelist' | 'blacklist'
  addedAt: string
  addedBy?: string | null
}
