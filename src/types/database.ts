export interface Database {
  public: {
    Tables: {
      traces: {
        Row: {
          id: string
          created_at: string
          user_id: string
          username: string
          type: 'text' | 'image' | 'audio' | 'video' | 'embed'
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
          type: 'text' | 'image' | 'audio' | 'video' | 'embed'
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
          type?: 'text' | 'image' | 'audio' | 'video' | 'embed'
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
  type: 'text' | 'image' | 'audio' | 'video' | 'embed'
  content: string
  x: number
  y: number
  imageUrl?: string
  mediaUrl?: string
  createdAt: string
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
  fontSize?: 'small' | 'medium' | 'large'
  fontFamily?: 'sans' | 'serif' | 'mono'
  isLocked?: boolean
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
  // Layer system
  layerId?: string | null
  zIndex?: number
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
}
