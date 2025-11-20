import { useState, useRef, useEffect } from 'react'
import type { Trace } from '../types/database'
import { supabase } from '../lib/supabase'
import { useGameStore } from '../store/gameStore'
import ProfileCustomization from './ProfileCustomization'

interface TraceOverlayProps {
  traces: Trace[]
  lobbyWidth: number
  lobbyHeight: number
  zoom: number
  worldOffset: { x: number; y: number }
  lobbyId?: string
}

type TransformMode = 'none' | 'move' | 'scale' | 'rotate' | 'crop'

export default function TraceOverlay({ traces, lobbyWidth, lobbyHeight, zoom, worldOffset, lobbyId }: TraceOverlayProps) {
  const { position, username, playerZIndex, playerColor, otherUsers, removeTrace, userId } = useGameStore()
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [showPlayerMenu, setShowPlayerMenu] = useState(false)
  const [playerMenuPosition, setPlayerMenuPosition] = useState({ x: 0, y: 0 })
  const [transformMode, setTransformMode] = useState<TransformMode>('none')
  const [isCropMode, setIsCropMode] = useState(false)
  const [localTraceTransforms, setLocalTraceTransforms] = useState<Record<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number }>>({})
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({})
  const [modalTrace, setModalTrace] = useState<Trace | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; traceId: string } | null>(null)
  const [editingTrace, setEditingTrace] = useState<Trace | null>(null)
  const [imageProxySources, setImageProxySources] = useState<Record<string, string>>({}) // Track which images use proxy
  
  const startPosRef = useRef({ x: 0, y: 0, corner: '' })
  const startTransformRef = useRef({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
  const startCropRef = useRef({ cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 })
  const centerRef = useRef({ x: 0, y: 0 })

  // Proactively test image URLs and use proxy for blocked ones
  useEffect(() => {
    traces.forEach(trace => {
      // Handle both 'image' type and 'embed' type that contains direct image URLs
      if ((trace.type === 'image' || trace.type === 'embed') && (trace.mediaUrl || trace.imageUrl)) {
        const url = trace.mediaUrl || trace.imageUrl
        
        // Skip if already processed
        if (imageProxySources[trace.id] !== undefined || !url) return
        
        console.log(`Testing ${trace.type} URL for trace ${trace.id}:`, url)
        
        // Check if URL is likely a direct image (ends with image extension)
        const isDirectImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url)
        
        if (!isDirectImage) {
          // Not a direct image URL (likely a page URL like reddit.com/...)
          // Always use proxy for non-direct image URLs
          console.log(`Not a direct image URL, using proxy immediately`)
          const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
          setImageProxySources(prev => ({
            ...prev,
            [trace.id]: proxyUrl
          }))
          return
        }
        
        console.log(`Direct image URL detected, trying direct load first...`)
        
        // For direct image URLs, try loading normally first
        const img = new Image()
        img.crossOrigin = 'anonymous'
        
        const timeout = setTimeout(() => {
          // If image hasn't loaded in 3 seconds, switch to proxy
          if (!img.complete) {
            console.log(`Image load timeout, switching to proxy`)
            const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
            setImageProxySources(prev => ({
              ...prev,
              [trace.id]: proxyUrl
            }))
          }
        }, 3000)
        
        img.onload = () => {
          clearTimeout(timeout)
          console.log(`Image loaded successfully via direct URL`)
          // Mark as successfully loaded directly (empty string means use original)
          setImageProxySources(prev => ({
            ...prev,
            [trace.id]: ''
          }))
        }
        
        img.onerror = () => {
          clearTimeout(timeout)
          console.log(`Image failed to load directly, using proxy`)
          // Failed to load, use proxy
          const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
          setImageProxySources(prev => ({
            ...prev,
            [trace.id]: proxyUrl
          }))
        }
        
        img.src = url
      }
    })
  }, [traces, imageProxySources])

  // Calculate lighting influence on a trace
  // Log when traces change
  useEffect(() => {
    // Log only important trace changes
    if (traces.length === 0) {
      console.log('⚠️ No traces loaded')
    }
  }, [traces])

  // Log when image dimensions update
  useEffect(() => {
    const dimCount = Object.keys(imageDimensions).length
    if (dimCount > 0) {
      console.log('📐 Image dimensions updated:', dimCount, 'images', imageDimensions)
    }
  }, [imageDimensions])

  // Log when player z-index changes
  useEffect(() => {
    console.log('👤 Player z-index:', playerZIndex)
  }, [playerZIndex])

  // ESC key to deselect trace and close menus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedTraceId(null)
        setTransformMode('none')
        setIsCropMode(false)
        setContextMenu(null)
        setEditingTrace(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const getScreenPosition = (worldX: number, worldY: number) => {
    const screenX = (worldX * zoom) + worldOffset.x
    const screenY = (worldY * zoom) + worldOffset.y
    return { screenX, screenY }
  }

  const getTraceTransform = (trace: Trace) => {
    const local = localTraceTransforms[trace.id]
    if (local) return local
    
    // Ensure trace has valid transform data
    const transform = {
      x: trace.x ?? 0,
      y: trace.y ?? 0,
      scaleX: trace.scaleX ?? trace.scale ?? 1.0,
      scaleY: trace.scaleY ?? trace.scale ?? 1.0,
      rotation: trace.rotation ?? 0.0,
    }

    return transform
  }

  const updateTraceTransform = async (traceId: string, updates: Partial<{ x: number; y: number; scale?: number; scaleX?: number; scaleY?: number; rotation: number }>) => {
    const trace = traces.find(t => t.id === traceId)
    if (!trace) return

    const current = getTraceTransform(trace)
    // Merge updates; normalize to scaleX/scaleY
    const merged: any = { ...current, ...updates }
    if (updates.scale !== undefined) {
      merged.scaleX = updates.scale
      merged.scaleY = updates.scale
    }
    const newTransform = merged
    
    // Update local state immediately for smooth UI
    setLocalTraceTransforms(prev => ({ ...prev, [traceId]: newTransform }))

    // Sync to Supabase if available
    if (supabase) {
      const updateData: any = {
        position_x: newTransform.x,
        position_y: newTransform.y,
        // Persist average scale to DB to remain compatible with existing schema
        scale: ((newTransform.scaleX ?? 1) + (newTransform.scaleY ?? 1)) / 2,
        rotation: newTransform.rotation,
      }
      await (supabase.from('traces') as any).update(updateData).eq('id', traceId)
    }
  }

  const deleteTrace = async (traceId: string) => {
    if (!confirm('Are you sure you want to delete this trace?')) return
    
    // Immediately remove from local state for instant UI update
    removeTrace(traceId)
    setContextMenu(null)
    
    // Then delete from database
    if (supabase) {
      await (supabase.from('traces') as any).delete().eq('id', traceId)
    }
  }

  const duplicateTrace = async (traceId: string) => {
    const trace = traces.find(t => t.id === traceId)
    if (!trace || !supabase || !userId) return

    setContextMenu(null)

    // Create duplicate with slight offset
    const offset = 50
    const newTrace: any = {
      user_id: userId,
      username: username,
      type: trace.type,
      content: trace.content,
      position_x: trace.x + offset,
      position_y: trace.y + offset,
      scale: trace.scale ?? 1.0,
      rotation: trace.rotation ?? 0,
      show_border: trace.showBorder ?? true,
      show_background: trace.showBackground ?? true,
      show_description: trace.showDescription ?? true,
      show_filename: trace.showFilename ?? true,
      font_size: trace.fontSize ?? 'medium',
      font_family: trace.fontFamily ?? 'sans',
      is_locked: false, // Never duplicate as locked
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
    }

    // Only add optional fields if they exist
    if (trace.imageUrl) newTrace.image_url = trace.imageUrl
    if (trace.mediaUrl) newTrace.media_url = trace.mediaUrl
    if (trace.lightPulse !== undefined) newTrace.light_pulse = trace.lightPulse
    if (trace.lightPulseSpeed !== undefined) newTrace.light_pulse_speed = trace.lightPulseSpeed
    if (trace.enableInteraction !== undefined) newTrace.enable_interaction = trace.enableInteraction
    if (trace.layerId) newTrace.layer_id = trace.layerId
    if (lobbyId) newTrace.lobby_id = lobbyId

    const { error } = await (supabase.from('traces') as any).insert(newTrace)
    
    if (error) {
      console.error('Failed to duplicate trace:', error)
      alert('Failed to duplicate trace: ' + error.message)
    }
  }

  const updateTraceCustomization = async (traceId: string, updates: Partial<Trace>) => {
    if (!supabase) return
    
    const updateData: any = {}
    if (updates.showBorder !== undefined) updateData.show_border = updates.showBorder
    if (updates.showBackground !== undefined) updateData.show_background = updates.showBackground
    if (updates.showDescription !== undefined) updateData.show_description = updates.showDescription
    if (updates.showFilename !== undefined) updateData.show_filename = updates.showFilename
    if (updates.fontSize !== undefined) updateData.font_size = updates.fontSize
    if (updates.fontFamily !== undefined) updateData.font_family = updates.fontFamily
    if (updates.isLocked !== undefined) updateData.is_locked = updates.isLocked
    if (updates.mediaUrl !== undefined) updateData.media_url = updates.mediaUrl
    if (updates.content !== undefined) updateData.content = updates.content
    if (updates.cropX !== undefined) updateData.crop_x = updates.cropX
    if (updates.cropY !== undefined) updateData.crop_y = updates.cropY
    if (updates.cropWidth !== undefined) updateData.crop_width = updates.cropWidth
    if (updates.cropHeight !== undefined) updateData.crop_height = updates.cropHeight
    if (updates.illuminate !== undefined) updateData.illuminate = updates.illuminate
    if (updates.lightColor !== undefined) updateData.light_color = updates.lightColor
    if (updates.lightIntensity !== undefined) updateData.light_intensity = updates.lightIntensity
    if (updates.lightRadius !== undefined) updateData.light_radius = updates.lightRadius
    if (updates.lightOffsetX !== undefined) updateData.light_offset_x = updates.lightOffsetX
    if (updates.lightOffsetY !== undefined) updateData.light_offset_y = updates.lightOffsetY
    if (updates.lightPulse !== undefined) updateData.light_pulse = updates.lightPulse
    if (updates.lightPulseSpeed !== undefined) updateData.light_pulse_speed = updates.lightPulseSpeed
    if (updates.enableInteraction !== undefined) updateData.enable_interaction = updates.enableInteraction
    // Shape properties
    if (updates.shapeType !== undefined) updateData.shape_type = updates.shapeType
    if (updates.shapeColor !== undefined) updateData.shape_color = updates.shapeColor
    if (updates.shapeOpacity !== undefined) updateData.shape_opacity = updates.shapeOpacity
    if (updates.cornerRadius !== undefined) updateData.corner_radius = updates.cornerRadius
    if (updates.width !== undefined) updateData.width = updates.width
    if (updates.height !== undefined) updateData.height = updates.height
    
    await (supabase.from('traces') as any).update(updateData).eq('id', traceId)
  }

  const handleMouseDown = (e: React.MouseEvent, trace: Trace, mode: TransformMode, corner?: string) => {
    if (trace.isLocked && mode !== 'crop') return // Allow crop even on locked traces
    
    e.stopPropagation()
    setSelectedTraceId(trace.id)
    setTransformMode(mode)
    
  const transform = getTraceTransform(trace)
  startPosRef.current = { x: e.clientX, y: e.clientY, corner: corner || '' }
  // copy transform including scaleX/scaleY
  startTransformRef.current = { ...transform }
  // Store starting crop values
  startCropRef.current = {
    cropX: trace.cropX ?? 0,
    cropY: trace.cropY ?? 0,
    cropWidth: trace.cropWidth ?? 1,
    cropHeight: trace.cropHeight ?? 1,
  }
    
    const { screenX, screenY } = getScreenPosition(transform.x, transform.y)
    centerRef.current = { x: screenX, y: screenY }
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (transformMode === 'none' || !selectedTraceId) return

    const trace = traces.find(t => t.id === selectedTraceId)
    if (!trace) return

    const deltaX = e.clientX - startPosRef.current.x
    const deltaY = e.clientY - startPosRef.current.y

  if (transformMode === 'move') {
      // Convert screen delta to world delta
      const worldDeltaX = deltaX / zoom
      const worldDeltaY = deltaY / zoom
      
      updateTraceTransform(selectedTraceId, {
        x: startTransformRef.current.x + worldDeltaX,
        y: startTransformRef.current.y + worldDeltaY,
      })
    } else if (transformMode === 'crop') {
      // Handle crop area adjustment
      const { width, height } = getTraceSize(trace)
      const transform = getTraceTransform(trace)
      const containerWidth = width * (transform as any).scaleX * zoom
      const containerHeight = height * (transform as any).scaleY * zoom
      
      // Convert pixel delta to crop percentage delta
      const cropDeltaX = deltaX / containerWidth
      const cropDeltaY = deltaY / containerHeight
      
      const corner = startPosRef.current.corner
      const startCrop = startCropRef.current
      let newCropX = startCrop.cropX
      let newCropY = startCrop.cropY
      let newCropWidth = startCrop.cropWidth
      let newCropHeight = startCrop.cropHeight
      
      // Adjust crop based on which corner is being dragged
      if (corner === 'tl') {
        // Top-left: adjust X, Y, width, height
        const maxDeltaX = startCrop.cropWidth - 0.1
        const maxDeltaY = startCrop.cropHeight - 0.1
        const clampedDeltaX = Math.max(-startCrop.cropX, Math.min(maxDeltaX, cropDeltaX))
        const clampedDeltaY = Math.max(-startCrop.cropY, Math.min(maxDeltaY, cropDeltaY))
        
        newCropX = startCrop.cropX + clampedDeltaX
        newCropY = startCrop.cropY + clampedDeltaY
        newCropWidth = startCrop.cropWidth - clampedDeltaX
        newCropHeight = startCrop.cropHeight - clampedDeltaY
      } else if (corner === 'tr') {
        // Top-right: adjust Y, width, height
        const maxDeltaY = startCrop.cropHeight - 0.1
        const maxDeltaX = 1 - startCrop.cropX - startCrop.cropWidth
        const clampedDeltaY = Math.max(-startCrop.cropY, Math.min(maxDeltaY, cropDeltaY))
        const clampedDeltaX = Math.max(-(startCrop.cropWidth - 0.1), Math.min(maxDeltaX, cropDeltaX))
        
        newCropY = startCrop.cropY + clampedDeltaY
        newCropWidth = startCrop.cropWidth + clampedDeltaX
        newCropHeight = startCrop.cropHeight - clampedDeltaY
      } else if (corner === 'bl') {
        // Bottom-left: adjust X, width, height
        const maxDeltaX = startCrop.cropWidth - 0.1
        const maxDeltaY = 1 - startCrop.cropY - startCrop.cropHeight
        const clampedDeltaX = Math.max(-startCrop.cropX, Math.min(maxDeltaX, cropDeltaX))
        const clampedDeltaY = Math.max(-(startCrop.cropHeight - 0.1), Math.min(maxDeltaY, cropDeltaY))
        
        newCropX = startCrop.cropX + clampedDeltaX
        newCropWidth = startCrop.cropWidth - clampedDeltaX
        newCropHeight = startCrop.cropHeight + clampedDeltaY
      } else if (corner === 'br') {
        // Bottom-right: adjust width, height
        const maxDeltaX = 1 - startCrop.cropX - startCrop.cropWidth
        const maxDeltaY = 1 - startCrop.cropY - startCrop.cropHeight
        const clampedDeltaX = Math.max(-(startCrop.cropWidth - 0.1), Math.min(maxDeltaX, cropDeltaX))
        const clampedDeltaY = Math.max(-(startCrop.cropHeight - 0.1), Math.min(maxDeltaY, cropDeltaY))
        
        newCropWidth = startCrop.cropWidth + clampedDeltaX
        newCropHeight = startCrop.cropHeight + clampedDeltaY
      }
      
      updateTraceCustomization(selectedTraceId, {
        cropX: newCropX,
        cropY: newCropY,
        cropWidth: newCropWidth,
        cropHeight: newCropHeight,
      })
    } else if (transformMode === 'scale') {
      const startScaleX = (startTransformRef.current as any).scaleX ?? (startTransformRef.current as any).scale ?? 1
      const startScaleY = (startTransformRef.current as any).scaleY ?? (startTransformRef.current as any).scale ?? 1
      
      // Check if corner drag (diagonal) - should preserve aspect ratio
      const isCorner = startPosRef.current.corner.length === 2 // 'tl', 'tr', 'bl', 'br'
      
      if (isCorner) {
        // Uniform scaling for diagonal (corners) - preserve aspect ratio
        // Calculate distance from center to determine scale
        const startDist = Math.sqrt(
          Math.pow(startPosRef.current.x - centerRef.current.x, 2) + 
          Math.pow(startPosRef.current.y - centerRef.current.y, 2)
        )
        const currentDist = Math.sqrt(
          Math.pow(e.clientX - centerRef.current.x, 2) + 
          Math.pow(e.clientY - centerRef.current.y, 2)
        )
        
        const scaleFactor = currentDist / startDist
        const newScale = Math.max(0.1, startScaleX * scaleFactor)
        
        updateTraceTransform(selectedTraceId, { scaleX: newScale, scaleY: newScale })
      } else {
        // Non-uniform scaling for edges (horizontal/vertical only)
        const corner = startPosRef.current.corner
        let newScaleX = startScaleX
        let newScaleY = startScaleY
        
        const sensitivity = 0.01
        
        if (corner === 'l' || corner === 'r') {
          // Horizontal edge - scale X only
          const sign = corner === 'r' ? 1 : -1
          newScaleX = Math.max(0.1, startScaleX * (1 + deltaX * sensitivity * sign))
        } else if (corner === 't' || corner === 'b') {
          // Vertical edge - scale Y only
          const sign = corner === 'b' ? 1 : -1
          newScaleY = Math.max(0.1, startScaleY * (1 + deltaY * sensitivity * sign))
        }

        updateTraceTransform(selectedTraceId, { scaleX: newScaleX, scaleY: newScaleY })
      }
    } else if (transformMode === 'rotate') {
      // Calculate rotation based on angle from center
      const startAngle = Math.atan2(
        startPosRef.current.y - centerRef.current.y,
        startPosRef.current.x - centerRef.current.x
      )
      const currentAngle = Math.atan2(
        e.clientY - centerRef.current.y,
        e.clientX - centerRef.current.x
      )
      
      const angleDelta = (currentAngle - startAngle) * (180 / Math.PI)
      const newRotation = (startTransformRef.current.rotation + angleDelta) % 360
      
      updateTraceTransform(selectedTraceId, { rotation: newRotation })
    }
  }

  const handleMouseUp = () => {
    // If in crop mode, keep crop mode and transform mode active for more adjustments
    if (transformMode !== 'crop') {
      setTransformMode('none')
    }
  }

  // Click outside to deselect
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      // If clicking outside any trace (not on a trace or transform handle)
      if (!target.closest('[data-trace-element]')) {
        setSelectedTraceId(null)
        setTransformMode('none')
        setIsCropMode(false)
      }
    }
    
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  useEffect(() => {
    if (transformMode !== 'none') {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [transformMode, selectedTraceId])

  const getTraceSize = (trace: Trace) => {
    // For images, use a container that will adapt to content
    // We'll use inline styles on the image container to handle aspect ratio
    switch (trace.type) {
      case 'text':
        return { width: 120, height: 80 }
      case 'image':
        // Use dimensions if available, otherwise square default
        if (imageDimensions[trace.id]) {
          const dim = imageDimensions[trace.id]
          const maxSize = 200
          const scale = Math.min(maxSize / dim.width, maxSize / dim.height, 1)
          return { width: Math.round(dim.width * scale), height: Math.round(dim.height * scale) }
        }
        return { width: 150, height: 150 }
      case 'audio':
        return { width: 120, height: 60 }
      case 'video':
        // Use detected dimensions if available
        if (imageDimensions[trace.id]) {
          const dim = imageDimensions[trace.id]
          const maxSize = 200
          const scale = Math.min(maxSize / dim.width, maxSize / dim.height, 1)
          return { width: Math.round(dim.width * scale), height: Math.round(dim.height * scale) }
        }
        return { width: 200, height: 150 }
      case 'embed':
        // Use detected 16:9 dimensions if available
        if (imageDimensions[trace.id]) {
          const dim = imageDimensions[trace.id]
          const maxSize = 240
          const scale = Math.min(maxSize / dim.width, maxSize / dim.height, 1)
          return { width: Math.round(dim.width * scale), height: Math.round(dim.height * scale) }
        }
        // Default 16:9 aspect ratio
        return { width: 240, height: 135 }
      default:
        return { width: 120, height: 80 }
    }
  }

  const getBorderColor = (type: string) => {
    switch (type) {
      case 'text':
        return '#ffd700'
      case 'image':
        return '#ff69b4'
      case 'audio':
        return '#4ecdc4'
      case 'video':
        return '#e94560'
      case 'embed':
        return '#9b59b6'
      default:
        return '#ffd700'
    }
  }

  const convertYouTubeUrl = (url: string) => {
    const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/
    const match = url.match(youtubeRegex)
    if (match) {
      return `https://www.youtube.com/embed/${match[1]}`
    }
    return url
  }

  // Extract iframe src from HTML embed code or return URL as-is
  const extractEmbedUrl = (content: string): string | null => {
    // Check if it's HTML embed code (contains <iframe)
    if (content.includes('<iframe')) {
      const srcMatch = content.match(/src=["']([^"']+)["']/)
      if (srcMatch) {
        return srcMatch[1]
      }
      return null
    }
    // It's a regular URL
    return convertYouTubeUrl(content)
  }

  return (
    <>
      <div 
        className="absolute inset-0"
        onClick={() => {
          if (!showPlayerMenu) {
            setSelectedTraceId(null)
            setTransformMode('none')
            setContextMenu(null)
          }
        }}
      >
        {/* Render traces AND player in z-index order */}
        {[
          ...traces.map(trace => ({ type: 'trace' as const, trace, zIndex: trace.zIndex ?? 0 })),
          // Player z-index is stored as layer z-index, convert to trace z-index (layer * 100)
          { type: 'player' as const, trace: null, zIndex: playerZIndex * 100 }
        ]
          .sort((a, b) => a.zIndex - b.zIndex) // Sort by z-index (lower first)
          .map((item) => {
            if (item.type === 'player') {
              // Render player circle
              const playerScreenX = position.x * zoom + worldOffset.x
              const playerScreenY = position.y * zoom + worldOffset.y
              const baseSize = 20 // Same as AVATAR_SIZE in LobbyScene
              const playerSize = baseSize * zoom

              // Convert hex color to RGB for shadows
              const hexToRgb = (hex: string) => {
                const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
                return result ? {
                  r: parseInt(result[1], 16),
                  g: parseInt(result[2], 16),
                  b: parseInt(result[3], 16)
                } : { r: 255, g: 255, b: 255 }
              }
              const rgb = hexToRgb(playerColor)

              return (
                <div
                  key="player-circle"
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setPlayerMenuPosition({ x: e.clientX, y: e.clientY })
                    setShowPlayerMenu(true)
                  }}
                  style={{
                    position: 'absolute',
                    left: playerScreenX - playerSize / 2,
                    top: playerScreenY - playerSize / 2,
                    width: playerSize,
                    height: playerSize,
                    borderRadius: '50%',
                    backgroundColor: playerColor,
                    boxShadow: `0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6), 0 0 40px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3), inset 0 0 10px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`,
                    border: `2px solid ${playerColor}`,
                    pointerEvents: 'auto',
                    cursor: 'context-menu',
                    transition: 'left 0.05s ease-out, top 0.05s ease-out',
                    filter: 'blur(0.3px)',
                  }}
                >
                  {/* Inner glow */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: '20%',
                      borderRadius: '50%',
                      background: `radial-gradient(circle, rgba(${rgb.r},${rgb.g},${rgb.b},0.9) 0%, rgba(${rgb.r},${rgb.g},${rgb.b},0) 70%)`,
                      pointerEvents: 'none',
                    }}
                  />
                  {/* Player label */}
                  <div
                    style={{
                      position: 'absolute',
                      top: -18 * zoom,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      color: playerColor,
                      fontSize: `${11 * zoom}px`,
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      textShadow: `0 0 8px rgba(${rgb.r},${rgb.g},${rgb.b},0.5), 0 2px 4px rgba(0,0,0,0.8)`,
                      letterSpacing: '0.5px'
                    }}
                  >
                    {username}
                  </div>
                </div>
              )
            }

            // Render trace
            const trace = item.trace!
        const transform = getTraceTransform(trace)
        const { screenX, screenY } = getScreenPosition(transform.x, transform.y)
        const { width, height } = getTraceSize(trace)
        const borderColor = getBorderColor(trace.type)
        const isSelected = selectedTraceId === trace.id

        // Apply customization defaults
        const showBorder = trace.showBorder ?? true
        const showBackground = trace.showBackground ?? true
        const showDescription = trace.showDescription ?? true
        const showFilename = trace.showFilename ?? true
        const fontSize = trace.fontSize ?? 'medium'
        const fontFamily = trace.fontFamily ?? 'sans'

        const fontSizeMap = { small: '10px', medium: '12px', large: '14px' }
        const fontFamilyMap = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' }

        // Apply crop to border size
        const cropX = trace.cropX ?? 0
        const cropY = trace.cropY ?? 0
        const cropWidth = trace.cropWidth ?? 1
        const cropHeight = trace.cropHeight ?? 1
        
        // Border container should match the cropped content size
        // For shapes, use their actual width/height properties
        const shapeWidth = trace.type === 'shape' ? (trace.width || 200) : width
        const shapeHeight = trace.type === 'shape' ? (trace.height || 200) : height
        const borderWidth = (trace.type === 'shape' ? shapeWidth : width * cropWidth) * (transform as any).scaleX * zoom
        const borderHeight = (trace.type === 'shape' ? shapeHeight : height * cropHeight) * (transform as any).scaleY * zoom

        // Debug logging for image dimensions
        // Selected trace rendering

        // Calculate distance from viewport center for fade effect
        const viewportCenterX = lobbyWidth / 2
        const viewportCenterY = lobbyHeight / 2
        const distanceFromCenter = Math.sqrt(
          Math.pow(screenX - viewportCenterX, 2) + 
          Math.pow(screenY - viewportCenterY, 2)
        )
        
        // Define fade zones
        const viewportRadius = Math.sqrt(Math.pow(lobbyWidth / 2, 2) + Math.pow(lobbyHeight / 2, 2))
        const fadeStartRadius = viewportRadius * 0.6 // Start fading at 60% of viewport radius
        const fadeEndRadius = viewportRadius * 1.2 // Fully transparent at 120% of viewport radius
        
        // Calculate opacity based on distance
        let traceOpacity = 1.0
        if (distanceFromCenter > fadeStartRadius) {
          const fadeProgress = (distanceFromCenter - fadeStartRadius) / (fadeEndRadius - fadeStartRadius)
          traceOpacity = Math.max(0, 1 - fadeProgress)
        }
        
        // Don't render if completely transparent or far outside viewport
        if (traceOpacity <= 0 || distanceFromCenter > fadeEndRadius) {
          return null
        }

        return (
          <div key={trace.id} className="contents">
            {/* Light overlay FIRST so it renders below the trace */}
            {trace.illuminate && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `${screenX + (trace.lightOffsetX ?? 0) * zoom}px`,
                  top: `${screenY + (trace.lightOffsetY ?? 0) * zoom}px`,
                  width: `${(trace.lightRadius ?? 200) * zoom * 2}px`,
                  height: `${(trace.lightRadius ?? 200) * zoom * 2}px`,
                  borderRadius: '50%',
                  background: trace.lightColor ?? '#ffffff',
                  opacity: (trace.lightIntensity ?? 1.0) * 0.8 * traceOpacity,
                  mixBlendMode: 'screen',
                  filter: `blur(${(trace.lightRadius ?? 200) * zoom * 0.3}px)`,
                  animation: trace.lightPulse ? `pulse ${trace.lightPulseSpeed ?? 2}s ease-in-out infinite` : 'none',
                  transformOrigin: 'center center',
                  marginLeft: `${-(trace.lightRadius ?? 200) * zoom}px`,
                  marginTop: `${-(trace.lightRadius ?? 200) * zoom}px`,
                  ['--pulse-opacity' as any]: (trace.lightIntensity ?? 1.0) * 0.8 * traceOpacity,
                }}
              />
            )}
            
            {/* The trace itself */}
            <div style={{ opacity: traceOpacity }}>
            {/* Container for positioning - doesn't scale */}
            <div
              data-trace-element="true"
              className="absolute pointer-events-auto"
              style={{
                left: `${screenX}px`,
                top: `${screenY}px`,
                transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)`,
                transformOrigin: 'center center',
              }}
              onMouseDown={(e) => handleMouseDown(e, trace, 'move')}
              onClick={(e) => {
                e.stopPropagation()
                setSelectedTraceId(trace.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                setModalTrace(trace)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ x: e.clientX, y: e.clientY, traceId: trace.id })
              }}
            >
              {/* Shape rendering - no border container */}
              {trace.type === 'shape' ? (
                <div
                  className="relative cursor-pointer"
                  style={{
                    width: `${borderWidth}px`,
                    height: `${borderHeight}px`,
                  }}
                >
                  {(() => {
                    const shapeColor = trace.shapeColor || '#3b82f6'
                    const shapeOpacity = trace.shapeOpacity ?? 1.0
                    const cornerRadius = trace.cornerRadius || 0
                    const shapeType = trace.shapeType || 'rectangle'

                    if (shapeType === 'rectangle') {
                      return (
                        <svg
                          className="w-full h-full pointer-events-none select-none"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          <rect
                            x="0"
                            y="0"
                            width="100"
                            height="100"
                            rx={cornerRadius}
                            ry={cornerRadius}
                            fill={shapeColor}
                            opacity={shapeOpacity}
                          />
                        </svg>
                      )
                    } else if (shapeType === 'circle') {
                      return (
                        <svg
                          className="w-full h-full pointer-events-none select-none"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          <ellipse
                            cx="50"
                            cy="50"
                            rx="50"
                            ry="50"
                            fill={shapeColor}
                            opacity={shapeOpacity}
                          />
                        </svg>
                      )
                    } else if (shapeType === 'triangle') {
                      return (
                        <svg
                          className="w-full h-full pointer-events-none select-none"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          <polygon
                            points="50,10 90,90 10,90"
                            fill={shapeColor}
                            opacity={shapeOpacity}
                          />
                        </svg>
                      )
                    }
                    return null
                  })()}
                </div>
              ) : (
                /* Border container for non-shape traces - fixed size, doesn't scale with content */
                <>
                <div
                  className="relative cursor-pointer transition-shadow"
                  style={{
                    width: `${borderWidth}px`,
                    height: `${borderHeight}px`,
                    border: showBorder ? `3px solid ${isSelected && isCropMode ? '#ff8800' : isSelected ? '#00ff00' : borderColor}` : 'none',
                    borderRadius: '8px',
                    backgroundColor: showBackground ? 'rgba(26, 26, 46, 0.95)' : 'transparent',
                    padding: '5px',
                    boxShadow: isSelected && isCropMode
                      ? '0 0 20px rgba(255, 136, 0, 0.5)'
                      : isSelected 
                      ? '0 0 20px rgba(0, 255, 0, 0.5)' 
                      : (showBackground ? '0 4px 12px rgba(0, 0, 0, 0.8)' : 'none'),
                    overflow: 'hidden',
                  }}
                >
                  {/* Scaled content wrapper */}
                  <div
                    className="w-full h-full"
                    style={{
                      transform: `scale(${(transform as any).scaleX * zoom}, ${(transform as any).scaleY * zoom}) translate(${-cropX * 100}%, ${-cropY * 100}%)`,
                      transformOrigin: 'top left',
                      width: `${width}px`,
                      height: `${height}px`,
                    }}
                  >
              {/* Image Content */}
              {trace.type === 'image' && (trace.mediaUrl || trace.imageUrl) && (
                <img
                  src={imageProxySources[trace.id] || trace.mediaUrl || trace.imageUrl}
                  alt={trace.content || 'Trace image'}
                  crossOrigin="anonymous"
                  className="w-full h-full object-contain pointer-events-none select-none"
                  style={{ 
                    clipPath: trace.cropWidth && trace.cropWidth < 1 
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined,
                  }}
                  onLoad={(e) => {
                    const img = e.currentTarget
                    if (img.naturalWidth && img.naturalHeight) {
                      setImageDimensions(prev => ({
                        ...prev,
                        [trace.id]: { width: img.naturalWidth, height: img.naturalHeight }
                      }))
                    }
                  }}
                />
              )}
              
              {/* Image placeholder */}
              {trace.type === 'image' && !trace.mediaUrl && !trace.imageUrl && (
                <div className="flex flex-col items-center justify-center h-full pointer-events-none select-none">
                  <span className="text-4xl mb-2">🖼️</span>
                  <p className="text-xs text-white/60 text-center">
                    {trace.content || 'No image URL'}
                  </p>
                </div>
              )}

              {/* Video Content */}
              {trace.type === 'video' && trace.mediaUrl && (
                <video
                  src={trace.mediaUrl}
                  controls={false}
                  className="w-full h-full pointer-events-none select-none"
                  style={{ 
                    clipPath: trace.cropWidth && trace.cropWidth < 1 
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined,
                  }}
                  onLoadedMetadata={(e) => {
                    const video = e.currentTarget
                    if (video.videoWidth && video.videoHeight) {
                      console.log(`📐 Video loaded for trace ${trace.id}:`, video.videoWidth, 'x', video.videoHeight)
                      setImageDimensions(prev => ({
                        ...prev,
                        [trace.id]: { width: video.videoWidth, height: video.videoHeight }
                      }))
                    }
                  }}
                />
              )}

              {/* Audio Content */}
              {trace.type === 'audio' && trace.mediaUrl && (
                <div className="flex flex-col items-center justify-center h-full pointer-events-none select-none">
                  <span className="text-2xl mb-2"></span>
                  <audio
                    src={trace.mediaUrl}
                    controls
                    className="w-full pointer-events-auto"
                    style={{ height: '30px' }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                  {showDescription && trace.content && (
                    <p className="text-xs text-white/80 mt-1 text-center truncate w-full pointer-events-none select-none">
                      {trace.content}
                    </p>
                  )}
                </div>
              )}

              {/* Embed Content */}
              {trace.type === 'embed' && trace.mediaUrl && (() => {
                // Check if the embed URL is actually a direct image
                const isDirectImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(trace.mediaUrl)
                
                if (isDirectImage) {
                  // Render as image, not iframe
                  return (
                    <img
                      src={imageProxySources[trace.id] || trace.mediaUrl}
                      alt={trace.content || 'Embedded image'}
                      crossOrigin="anonymous"
                      className="w-full h-full object-contain pointer-events-none select-none"
                      style={{ 
                        clipPath: trace.cropWidth && trace.cropWidth < 1 
                          ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                          : undefined,
                      }}
                      onLoad={(e) => {
                        const img = e.currentTarget
                        if (img.naturalWidth && img.naturalHeight) {
                          setImageDimensions(prev => ({
                            ...prev,
                            [trace.id]: { width: img.naturalWidth, height: img.naturalHeight }
                          }))
                        }
                      }}
                    />
                  )
                }
                
                // Otherwise, treat as iframe embed
                const embedUrl = extractEmbedUrl(trace.mediaUrl)
                if (!embedUrl) {
                  return (
                    <div className="w-full h-full flex items-center justify-center bg-black/50">
                      <p className="text-white/60 text-sm">Invalid embed code</p>
                    </div>
                  )
                }
                return (
                  <iframe
                    src={embedUrl}
                    width="3840"
                    height="2160"
                    className="w-full h-full select-none"
                    style={{ 
                      pointerEvents: trace.enableInteraction ? 'auto' : 'none',
                      clipPath: trace.cropWidth && trace.cropWidth < 1 
                        ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                        : undefined,
                    }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    onClick={(e) => {
                      if (trace.enableInteraction) {
                        e.stopPropagation() // Prevent trace selection when interacting
                      }
                    }}
                    onDoubleClick={(e) => {
                      if (trace.enableInteraction) {
                        e.stopPropagation() // Prevent modal from opening
                      }
                    }}
                    onLoad={() => {
                      // Set high-resolution 16:9 dimensions for embeds to prevent pixelation when scaled
                      if (!imageDimensions[trace.id]) {
                        console.log(`📐 Embed loaded for trace ${trace.id}: setting to 16:9 (3840x2160)`)
                        setImageDimensions(prev => ({
                          ...prev,
                          [trace.id]: { width: 3840, height: 2160 }
                        }))
                      }
                    }}
                  />
                )
              })()}

              {/* Text Content */}
              {trace.type === 'text' && (
                <div 
                  className="flex flex-col items-center justify-center h-full w-full p-2 pointer-events-none select-none overflow-hidden"
                  style={{
                    clipPath: trace.cropWidth && trace.cropWidth < 1 
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined,
                  }}
                >
                  <p 
                    className="text-white text-center w-full break-words"
                    style={{
                      fontSize: `calc(${fontSizeMap[fontSize]} * ${Math.min(width / 120, height / 80)})`,
                      fontFamily: fontFamilyMap[fontFamily],
                      lineHeight: '1.2',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      display: '-webkit-box',
                      WebkitLineClamp: Math.max(2, Math.floor(height / 20)),
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {trace.content}
                  </p>
                </div>
              )}

                  </div>
                </div>
                </>
              )}

              {/* Username label - outside border container so it doesn't scale */}
              {showFilename && trace.type !== 'shape' && (
                <div
                  className="absolute text-xs font-semibold text-center pointer-events-none"
                  style={{
                    bottom: `-${20}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: borderColor,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {trace.username}
                </div>
              )}
            </div>

            {/* Transform controls (only for selected trace and not in crop mode) */}
            {isSelected && !isCropMode && (
              <>
                {/* Corner handles for scaling */}
                {['tl', 'tr', 'bl', 'br'].map((corner) => {
                  const offsetX = corner.includes('r') ? (borderWidth / 2) : -(borderWidth / 2)
                  const offsetY = corner.includes('b') ? (borderHeight / 2) : -(borderHeight / 2)
                  
                  // Apply rotation to handle positions
                  const rad = (transform.rotation * Math.PI) / 180
                  const cos = Math.cos(rad)
                  const sin = Math.sin(rad)
                  const rotatedX = offsetX * cos - offsetY * sin
                  const rotatedY = offsetX * sin + offsetY * cos
                  
                  return (
                    <div
                      key={corner}
                      data-trace-element="true"
                      className="absolute w-3 h-3 bg-green-400 border-2 border-white rounded-full cursor-nwse-resize pointer-events-auto z-10"
                      style={{
                        left: `${screenX + rotatedX}px`,
                        top: `${screenY + rotatedY}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onMouseDown={(e) => handleMouseDown(e, trace, 'scale', corner)}
                    />
                  )
                })}

                {/* Edge handles for non-uniform scaling */}
                {['t', 'r', 'b', 'l'].map((edge) => {
                  let offsetX = 0
                  let offsetY = 0
                  
                  if (edge === 't') offsetY = -(borderHeight / 2)
                  else if (edge === 'b') offsetY = (borderHeight / 2)
                  else if (edge === 'l') offsetX = -(borderWidth / 2)
                  else if (edge === 'r') offsetX = (borderWidth / 2)
                  
                  // Apply rotation to handle positions
                  const rad = (transform.rotation * Math.PI) / 180
                  const cos = Math.cos(rad)
                  const sin = Math.sin(rad)
                  const rotatedX = offsetX * cos - offsetY * sin
                  const rotatedY = offsetX * sin + offsetY * cos
                  
                  const cursorClass = (edge === 't' || edge === 'b') ? 'cursor-ns-resize' : 'cursor-ew-resize'
                  
                  return (
                    <div
                      key={edge}
                      data-trace-element="true"
                      className={`absolute w-3 h-3 bg-yellow-400 border-2 border-white rounded-full pointer-events-auto z-10 ${cursorClass}`}
                      style={{
                        left: `${screenX + rotatedX}px`,
                        top: `${screenY + rotatedY}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onMouseDown={(e) => handleMouseDown(e, trace, 'scale', edge)}
                    />
                  )
                })}

                {/* Rotation handle at top */}
                <div
                  data-trace-element="true"
                  className="absolute w-3 h-3 bg-blue-400 border-2 border-white rounded-full cursor-grab pointer-events-auto z-10"
                  style={{
                    left: `${screenX}px`,
                    top: `${screenY - (borderHeight / 2 + 20)}px`,
                    transform: 'translate(-50%, -50%)',
                  }}
                  onMouseDown={(e) => handleMouseDown(e, trace, 'rotate')}
                />

                {/* Crop button for all trace types */}
                <button
                  data-trace-element="true"
                  className={`absolute text-white text-xs font-bold px-3 py-1.5 rounded-md border-2 border-white shadow-lg pointer-events-auto z-10 transition-all hover:scale-110 ${
                    isCropMode ? 'bg-orange-600 hover:bg-orange-700' : 'bg-purple-500 hover:bg-purple-600'
                  }`}
                  style={{
                    left: `${screenX}px`,
                    top: `${screenY + (borderHeight / 2 + 30)}px`,
                    transform: 'translate(-50%, 0)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    console.log('✂️ Crop button clicked for trace:', trace.id)
                    setIsCropMode(!isCropMode)
                    setTransformMode('none')
                  }}
                >
                  {isCropMode ? '✅ Done' : '✂️ Crop'}
                </button>
              </>
            )}

            {/* Crop mode handles (only when crop mode is active) */}
            {isSelected && isCropMode && (
              <>
                {/* Crop area overlay - shows the crop boundaries */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: `${screenX - (width * (transform as any).scaleX * zoom / 2)}px`,
                    top: `${screenY - (height * (transform as any).scaleY * zoom / 2)}px`,
                    width: `${width * (transform as any).scaleX * zoom}px`,
                    height: `${height * (transform as any).scaleY * zoom}px`,
                    border: '2px dashed rgba(255, 136, 0, 0.8)',
                    boxShadow: 'inset 0 0 0 9999px rgba(0, 0, 0, 0.3)',
                  }}
                />
                
                {/* Crop handles at corners for adjusting crop area */}
                {['tl', 'tr', 'bl', 'br'].map((corner) => {
                  const cropX = trace.cropX ?? 0
                  const cropY = trace.cropY ?? 0
                  const cropWidth = trace.cropWidth ?? 1
                  const cropHeight = trace.cropHeight ?? 1
                  
                  // Calculate position based on crop values
                  const baseX = screenX - (width * (transform as any).scaleX * zoom / 2)
                  const baseY = screenY - (height * (transform as any).scaleY * zoom / 2)
                  const containerWidth = width * (transform as any).scaleX * zoom
                  const containerHeight = height * (transform as any).scaleY * zoom
                  
                  const cropLeft = baseX + (cropX * containerWidth)
                  const cropTop = baseY + (cropY * containerHeight)
                  const cropRight = baseX + ((cropX + cropWidth) * containerWidth)
                  const cropBottom = baseY + ((cropY + cropHeight) * containerHeight)
                  
                  const handleX = corner.includes('r') ? cropRight : cropLeft
                  const handleY = corner.includes('b') ? cropBottom : cropTop
                  
                  return (
                    <div
                      key={`crop-${corner}`}
                      data-trace-element="true"
                      className="absolute w-4 h-4 bg-orange-500 border-2 border-white rounded-sm cursor-nwse-resize pointer-events-auto z-10"
                      style={{
                        left: `${handleX}px`,
                        top: `${handleY}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        handleMouseDown(e, trace, 'crop', corner)
                      }}
                    />
                  )
                })}
              </>
            )}
          </div>
        </div>
        )
        })}

        {/* Render other users in DOM with same styling as active player */}
        {Object.entries(otherUsers).map(([userId, user]) => {
          const userScreenX = user.x * zoom + worldOffset.x
          const userScreenY = user.y * zoom + worldOffset.y
          const baseSize = 20
          const userSize = baseSize * zoom
          const userColor = user.playerColor || '#ffffff'

          // Convert hex color to RGB for shadows
          const hexToRgb = (hex: string) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
            return result ? {
              r: parseInt(result[1], 16),
              g: parseInt(result[2], 16),
              b: parseInt(result[3], 16)
            } : { r: 255, g: 255, b: 255 }
          }
          const rgb = hexToRgb(userColor)

          return (
            <div
              key={`other-user-${userId}`}
              style={{
                position: 'absolute',
                left: userScreenX - userSize / 2,
                top: userScreenY - userSize / 2,
                width: userSize,
                height: userSize,
                borderRadius: '50%',
                backgroundColor: userColor,
                boxShadow: `0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6), 0 0 40px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3), inset 0 0 10px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`,
                border: `2px solid ${userColor}`,
                pointerEvents: 'none',
                transition: 'left 0.1s ease-out, top 0.1s ease-out',
                filter: 'blur(0.3px)',
              }}
            >
              {/* Inner glow */}
              <div
                style={{
                  position: 'absolute',
                  inset: '20%',
                  borderRadius: '50%',
                  background: `radial-gradient(circle, rgba(${rgb.r},${rgb.g},${rgb.b},0.9) 0%, rgba(${rgb.r},${rgb.g},${rgb.b},0) 70%)`,
                  pointerEvents: 'none',
                }}
              />
              {/* User label */}
              <div
                style={{
                  position: 'absolute',
                  top: -18 * zoom,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  color: userColor,
                  fontSize: `${11 * zoom}px`,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  textShadow: `0 0 8px rgba(${rgb.r},${rgb.g},${rgb.b},0.5), 0 2px 4px rgba(0,0,0,0.8)`,
                  letterSpacing: '0.5px'
                }}
              >
                {user.username}
              </div>
            </div>
          )
        })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          {/* Menu */}
          <div
            className="fixed bg-lobby-muted border border-lobby-accent rounded-lg shadow-2xl py-2 z-[200] pointer-events-auto"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2"
              onClick={() => {
                console.log('Customize clicked')
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) setEditingTrace(trace)
                setContextMenu(null)
              }}
            >
              ⚙️ Customize
            </button>
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2"
              onClick={() => {
                console.log('Lock/Unlock clicked')
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceCustomization(trace.id, { isLocked: !trace.isLocked })
                }
                setContextMenu(null)
              }}
            >
              {traces.find(t => t.id === contextMenu.traceId)?.isLocked ? '🔓 Unlock' : '🔒 Lock'}
            </button>
            <div className="h-px bg-lobby-accent/30 my-1" />
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2"
              onClick={async () => {
                console.log('Reset Cropping clicked')
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceCustomization(trace.id, {
                    cropX: 0,
                    cropY: 0,
                    cropWidth: 1,
                    cropHeight: 1,
                  })
                }
                setContextMenu(null)
              }}
            >
              ↩️ Reset Cropping
            </button>
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2"
              onClick={async () => {
                console.log('Reset Aspect Ratio clicked')
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  const transform = getTraceTransform(trace)
                  const avgScale = (transform.scaleX + transform.scaleY) / 2
                  
                  updateTraceTransform(trace.id, {
                    scaleX: avgScale,
                    scaleY: avgScale,
                  })
                }
                setContextMenu(null)
              }}
            >
              ⬜ Reset Aspect Ratio
            </button>
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2"
              onClick={async () => {
                console.log('Reset Rotation clicked')
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceTransform(trace.id, { rotation: 0 })
                }
                setContextMenu(null)
              }}
            >
              🔄 Reset Rotation
            </button>
            <div className="h-px bg-lobby-accent/30 my-1" />
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2"
              onClick={() => {
                console.log('Duplicate clicked')
                duplicateTrace(contextMenu.traceId)
              }}
            >
              📋 Duplicate
            </button>
            <button
              className="w-full px-4 py-2 text-left text-red-400 hover:bg-red-500/20 transition-colors flex items-center gap-2"
              onClick={() => {
                console.log('Delete clicked')
                deleteTrace(contextMenu.traceId)
              }}
            >
              🗑️ Delete
            </button>
          </div>

          {/* Backdrop to close menu - renders behind menu but catches outside clicks */}
          <div
            className="fixed inset-0 pointer-events-auto"
            style={{ zIndex: 199 }}
            onClick={() => setContextMenu(null)}
          />
        </>
      )}

      {/* Customization Dialog */}
      {editingTrace && (
        <>
          <div
            className="bg-lobby-muted border-2 border-lobby-accent rounded-lg p-6 max-w-md w-full mx-4 pointer-events-auto"
            style={{ 
              position: 'fixed',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 300
            }}
          >
            <h2 className="text-2xl font-bold text-lobby-accent mb-4">Customize Trace</h2>
            
            <div className="space-y-4">
              {/* Toggle Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingTrace.showBorder ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showBorder: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showBorder: e.target.checked })
                    }}
                    className="w-4 h-4"
                  />
                  Show Border
                </label>

                <label className="flex items-center gap-2 text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingTrace.showBackground ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showBackground: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showBackground: e.target.checked })
                    }}
                    className="w-4 h-4"
                  />
                  Show Background
                </label>

                <label className="flex items-center gap-2 text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingTrace.showDescription ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showDescription: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showDescription: e.target.checked })
                    }}
                    className="w-4 h-4"
                  />
                  Show Description
                </label>

                <label className="flex items-center gap-2 text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingTrace.showFilename ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showFilename: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showFilename: e.target.checked })
                    }}
                    className="w-4 h-4"
                  />
                  Show Username
                </label>
              </div>

              {/* Font Settings for Text Traces */}
              {editingTrace.type === 'text' && (
                <>
                  <div>
                    <label className="block text-white mb-2">Text Content</label>
                    <textarea
                      value={editingTrace.content ?? ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, content: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { content: e.target.value })
                      }}
                      className="w-full bg-lobby-darker text-white border border-lobby-accent rounded px-3 py-2"
                      placeholder="Your message..."
                      rows={4}
                      maxLength={200}
                    />
                  </div>

                  <div>
                    <label className="block text-white mb-2">Font Size</label>
                    <select
                      value={editingTrace.fontSize ?? 'medium'}
                      onChange={(e) => {
                        const value = e.target.value as 'small' | 'medium' | 'large'
                        const updated = { ...editingTrace, fontSize: value }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { fontSize: value })
                      }}
                      className="w-full bg-lobby-darker text-white border border-lobby-accent rounded px-3 py-2"
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-white mb-2">Font Family</label>
                    <select
                      value={editingTrace.fontFamily ?? 'sans'}
                      onChange={(e) => {
                        const value = e.target.value as 'sans' | 'serif' | 'mono'
                        const updated = { ...editingTrace, fontFamily: value }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { fontFamily: value })
                      }}
                      className="w-full bg-lobby-darker text-white border border-lobby-accent rounded px-3 py-2"
                    >
                      <option value="sans">Sans Serif</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Monospace</option>
                    </select>
                  </div>
                </>
              )}

              {/* Description/Caption for Media Traces */}
              {(editingTrace.type === 'image' || editingTrace.type === 'audio' || editingTrace.type === 'video') && (
                <div>
                  <label className="block text-white mb-2">Description/Caption</label>
                  <textarea
                    value={editingTrace.content ?? ''}
                    onChange={(e) => {
                      const updated = { ...editingTrace, content: e.target.value }
                      setEditingTrace(updated)
                    }}
                    onBlur={(e) => {
                      updateTraceCustomization(editingTrace.id, { content: e.target.value })
                    }}
                    className="w-full bg-lobby-darker text-white border border-lobby-accent rounded px-3 py-2"
                    placeholder="Optional description..."
                    rows={3}
                    maxLength={200}
                  />
                </div>
              )}

              {/* Embed Content Editor */}
              {editingTrace.type === 'embed' && (
                <>
                  <div>
                    <label className="block text-white mb-2">Embed URL or HTML Code</label>
                    <textarea
                      value={editingTrace.mediaUrl ?? ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, mediaUrl: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { mediaUrl: e.target.value })
                      }}
                      className="w-full bg-lobby-darker text-white border border-lobby-accent rounded px-3 py-2 font-mono text-sm"
                      placeholder="URL or <iframe src='...'></iframe>"
                      rows={4}
                    />
                    <p className="text-white/40 text-xs mt-1">
                      Direct URL or full embed code
                    </p>
                  </div>

                  <div>
                    <label className="block text-white mb-2">Description/Title</label>
                    <textarea
                      value={editingTrace.content ?? ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, content: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { content: e.target.value })
                      }}
                      className="w-full bg-lobby-darker text-white border border-lobby-accent rounded px-3 py-2"
                      placeholder="Optional description..."
                      rows={3}
                      maxLength={200}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-white cursor-pointer mt-3">
                    <input
                      type="checkbox"
                      checked={editingTrace.enableInteraction ?? false}
                      onChange={(e) => {
                        const updated = { ...editingTrace, enableInteraction: e.target.checked }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { enableInteraction: e.target.checked })
                      }}
                      className="w-4 h-4"
                    />
                    Enable Interaction (click to play/interact)
                  </label>
                </>
              )}

              {/* Shape Customization */}
              {editingTrace.type === 'shape' && (
                <div className="space-y-4">
                  {/* Shape Type */}
                  <div>
                    <label className="block text-white mb-2 font-semibold">Shape Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['rectangle', 'circle', 'triangle'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, shapeType: type }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeType: type })
                          }}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${
                            (editingTrace.shapeType || 'rectangle') === type
                              ? 'bg-lobby-accent text-white'
                              : 'bg-lobby-darker text-white/60 hover:bg-lobby-darker/70'
                          }`}
                        >
                          {type === 'rectangle' && '⬛'}
                          {type === 'circle' && '⚫'}
                          {type === 'triangle' && '🔺'}
                          {' '}{type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Color Picker */}
                  <div>
                    <label className="block text-white mb-2 font-semibold">Fill Color</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={editingTrace.shapeColor || '#3b82f6'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeColor: e.target.value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { shapeColor: e.target.value })
                        }}
                        className="w-16 h-10 rounded-lg cursor-pointer bg-lobby-darker border-2 border-lobby-accent/30"
                      />
                      <input
                        type="text"
                        value={editingTrace.shapeColor || '#3b82f6'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeColor: e.target.value }
                          setEditingTrace(updated)
                        }}
                        onBlur={(e) => {
                          updateTraceCustomization(editingTrace.id, { shapeColor: e.target.value })
                        }}
                        placeholder="#3b82f6"
                        className="flex-1 px-4 py-2 bg-lobby-darker border-2 border-lobby-accent/30 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-lobby-accent transition-colors font-mono"
                      />
                    </div>
                  </div>

                  {/* Opacity Slider */}
                  <div>
                    <label className="block text-white mb-2 font-semibold">
                      Opacity: {((editingTrace.shapeOpacity ?? 1.0) * 100).toFixed(0)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={editingTrace.shapeOpacity ?? 1.0}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value)
                        const updated = { ...editingTrace, shapeOpacity: value }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { shapeOpacity: value })
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Corner Radius (Rectangle only) */}
                  {(editingTrace.shapeType || 'rectangle') === 'rectangle' && (
                    <div>
                      <label className="block text-white mb-2 font-semibold">
                        Corner Radius: {editingTrace.cornerRadius || 0}px
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={editingTrace.cornerRadius || 0}
                        onChange={(e) => {
                          const value = parseInt(e.target.value)
                          const updated = { ...editingTrace, cornerRadius: value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { cornerRadius: value })
                        }}
                        className="w-full"
                      />
                    </div>
                  )}

                  {/* Shape Label */}
                  <div>
                    <label className="block text-white mb-2 font-semibold">Label (optional)</label>
                    <input
                      type="text"
                      value={editingTrace.content || ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, content: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { content: e.target.value })
                      }}
                      placeholder="Shape label..."
                      maxLength={50}
                      className="w-full px-4 py-2 bg-lobby-darker border-2 border-lobby-accent/30 rounded-lg text-white placeholder-white/40 focus:outline-none focus:border-lobby-accent transition-colors"
                    />
                  </div>
                </div>
              )}

              {/* Lighting Controls */}
              <div className="border-t border-lobby-accent/30 pt-4 mt-4">
                <h3 className="text-lg font-semibold text-lobby-accent mb-3">💡 Lighting</h3>
                
                <label className="flex items-center gap-2 text-white cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={editingTrace.illuminate ?? false}
                    onChange={(e) => {
                      const updated = { ...editingTrace, illuminate: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { illuminate: e.target.checked })
                    }}
                    className="w-4 h-4"
                  />
                  <span className="font-semibold">Enable Light Emission</span>
                </label>

                {editingTrace.illuminate && (
                  <div className="space-y-3 ml-6">
                    <div>
                      <label className="block text-white mb-2">Light Color</label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="color"
                          value={editingTrace.lightColor ?? '#ffffff'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, lightColor: e.target.value }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { lightColor: e.target.value })
                          }}
                          className="w-12 h-10 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={editingTrace.lightColor ?? '#ffffff'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, lightColor: e.target.value }
                            setEditingTrace(updated)
                          }}
                          onBlur={(e) => {
                            updateTraceCustomization(editingTrace.id, { lightColor: e.target.value })
                          }}
                          className="flex-1 bg-lobby-darker text-white border border-lobby-accent rounded px-3 py-2"
                          placeholder="#ffffff"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-white mb-2">
                        Intensity: {(editingTrace.lightIntensity ?? 1.0).toFixed(1)}x
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.1"
                        value={editingTrace.lightIntensity ?? 1.0}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value)
                          const updated = { ...editingTrace, lightIntensity: value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { lightIntensity: value })
                        }}
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-white mb-2">
                        Radius: {editingTrace.lightRadius ?? 200}px
                      </label>
                      <input
                        type="range"
                        min="50"
                        max="3000"
                        step="50"
                        value={editingTrace.lightRadius ?? 200}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value)
                          const updated = { ...editingTrace, lightRadius: value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { lightRadius: value })
                        }}
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-white mb-2">Light Position Offset</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-white/70 text-sm mb-1">X: {editingTrace.lightOffsetX ?? 0}px</label>
                          <input
                            type="range"
                            min="-200"
                            max="200"
                            step="5"
                            value={editingTrace.lightOffsetX ?? 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value)
                              const updated = { ...editingTrace, lightOffsetX: value }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { lightOffsetX: value })
                            }}
                            className="w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-white/70 text-sm mb-1">Y: {editingTrace.lightOffsetY ?? 0}px</label>
                          <input
                            type="range"
                            min="-200"
                            max="200"
                            step="5"
                            value={editingTrace.lightOffsetY ?? 0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value)
                              const updated = { ...editingTrace, lightOffsetY: value }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { lightOffsetY: value })
                            }}
                            className="w-full"
                          />
                        </div>
                      </div>
                      <p className="text-white/50 text-xs mt-1">
                        Adjust light source position relative to trace center
                      </p>
                    </div>

                    <div>
                      <label className="flex items-center gap-2 text-white cursor-pointer mb-2">
                        <input
                          type="checkbox"
                          checked={editingTrace.lightPulse ?? false}
                          onChange={(e) => {
                            const updated = { ...editingTrace, lightPulse: e.target.checked }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { lightPulse: e.target.checked })
                          }}
                          className="w-4 h-4"
                        />
                        Enable Pulsing/Flickering
                      </label>
                      
                      {editingTrace.lightPulse && (
                        <div>
                          <label className="block text-white/70 text-sm mb-1">
                            Pulse Speed: {editingTrace.lightPulseSpeed ?? 2.0}s per cycle
                          </label>
                          <input
                            type="range"
                            min="0.5"
                            max="5.0"
                            step="0.1"
                            value={editingTrace.lightPulseSpeed ?? 2.0}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value)
                              const updated = { ...editingTrace, lightPulseSpeed: value }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { lightPulseSpeed: value })
                            }}
                            className="w-full"
                          />
                          <p className="text-white/50 text-xs mt-1">
                            Lower = faster pulse, Higher = slower pulse
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => setEditingTrace(null)}
                className="w-full bg-lobby-accent text-white font-semibold py-2 px-4 rounded hover:bg-opacity-80 transition-all"
              >
                Done
              </button>
            </div>
          </div>

          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto"
            style={{ zIndex: 250 }}
            onClick={() => setEditingTrace(null)}
          />
        </>
      )}

      {/* Full view modal */}
      {modalTrace && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-auto"
          onClick={() => setModalTrace(null)}
        >
          <div
            className="bg-lobby-darker border-4 rounded-lg p-6 max-w-3xl max-h-[80vh] overflow-auto"
            style={{ borderColor: getBorderColor(modalTrace.type) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold text-white">
                {modalTrace.type === 'text' && '📝 Text Trace'}
                {modalTrace.type === 'image' && '🖼️ Image Trace'}
                {modalTrace.type === 'audio' && '🎵 Audio Trace'}
                {modalTrace.type === 'video' && '🎬 Video Trace'}
                {modalTrace.type === 'embed' && '🔗 Embedded Content'}
              </h2>
              <button
                onClick={() => setModalTrace(null)}
                className="text-white/80 hover:text-white text-2xl"
              >
                ✕
              </button>
            </div>

            {/* Full content */}
            <div className="mb-4">
              {modalTrace.type === 'image' && modalTrace.mediaUrl && (
                <img
                  src={imageProxySources[modalTrace.id] || modalTrace.mediaUrl}
                  alt={modalTrace.content || 'Trace image'}
                  crossOrigin="anonymous"
                  className="w-full max-h-96 object-contain rounded-lg"
                />
              )}

              {modalTrace.type === 'video' && modalTrace.mediaUrl && (
                <video
                  src={modalTrace.mediaUrl}
                  controls
                  autoPlay
                  className="w-full max-h-96 rounded-lg"
                />
              )}

              {modalTrace.type === 'audio' && modalTrace.mediaUrl && (
                <div className="flex flex-col items-center p-8 bg-black/40 rounded-lg">
                  <span className="text-6xl mb-4">🎵</span>
                  <audio src={modalTrace.mediaUrl} controls autoPlay className="w-full" />
                </div>
              )}

              {modalTrace.type === 'embed' && modalTrace.mediaUrl && (() => {
                const embedUrl = extractEmbedUrl(modalTrace.mediaUrl)
                if (!embedUrl) {
                  return (
                    <div className="w-full h-96 flex items-center justify-center bg-black/50 rounded-lg">
                      <p className="text-white/60">Invalid embed code</p>
                    </div>
                  )
                }
                return (
                  <iframe
                    src={embedUrl}
                    className="w-full h-96 rounded-lg"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                )
              })()}

              {modalTrace.type === 'text' && (
                <div className="bg-black/40 p-6 rounded-lg">
                  <p className="text-white text-lg whitespace-pre-wrap">
                    {modalTrace.content}
                  </p>
                </div>
              )}
            </div>

            {/* Caption/Description */}
            {modalTrace.content && modalTrace.type !== 'text' && (
              <div className="mb-4">
                <p className="text-white/80 text-sm italic">
                  "{modalTrace.content}"
                </p>
              </div>
            )}

            {/* Metadata */}
            <div className="flex justify-between items-center text-sm text-white/60">
              <span>By @{modalTrace.username}</span>
              <span>
                Position: ({Math.round(modalTrace.x)}, {Math.round(modalTrace.y)})
              </span>
              <span>{new Date(modalTrace.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Player Customization Menu */}
      {showPlayerMenu && (
        <ProfileCustomization
          onClose={() => setShowPlayerMenu(false)}
          position={playerMenuPosition}
        />
      )}
    </>
  )
}
