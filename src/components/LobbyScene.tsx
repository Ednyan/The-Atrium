import { useEffect, useRef, useState } from 'react'
import { Application, Graphics, Text, Container } from 'pixi.js'
import { useGameStore } from '../store/gameStore'
import { usePresence } from '../hooks/usePresence'
import { useTraces } from '../hooks/useTraces'
import TracePanel from './TracePanel'
import TraceOverlay from './TraceOverlay'
import LayerPanel from './LayerPanel'
import { LobbyManagement } from './LobbyManagement'
import { ThemeCustomization } from './ThemeCustomization'
import { ThemeManager } from '../lib/themeManager'
import { supabase } from '../lib/supabase'
import type { Lobby } from '../types/database'

const AVATAR_SIZE = 20
const MOVE_SPEED = 5
const MOVE_ACCELERATION = 0.8
const TRACE_RENDER_DISTANCE = 2000
const TRACE_FADE_DISTANCE = 1500
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3.0
const ZOOM_SPEED = 0.1

interface LobbySceneProps {
  lobbyId: string
  onLeaveLobby: () => void
}

export default function LobbyScene({ lobbyId, onLeaveLobby }: LobbySceneProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)
  const worldContainerRef = useRef<Container | null>(null)
  const avatarsRef = useRef<Map<string, Graphics>>(new Map())
  const tracesRef = useRef<Map<string, Container>>(new Map())
  const labelRef = useRef<Text | null>(null)
  const playerAvatarRef = useRef<Graphics | null>(null)
  const positionRef = useRef({ x: 0, y: 0 })
  const velocityRef = useRef({ x: 0, y: 0 })
  const keysPressed = useRef<Set<string>>(new Set())
  const tracePlacementIndicatorRef = useRef<Graphics | null>(null)
  const traceIndicatorsRef = useRef<Container | null>(null)
  const tracesDataRef = useRef<typeof traces>([])
  const otherUsersRef = useRef<typeof otherUsers>({})
  const zoomRef = useRef(1.0)
  const isPanningRef = useRef(false)
  const lastPanPositionRef = useRef({ x: 0, y: 0 })
  const worldOffsetRef = useRef({ x: 0, y: 0 })
  const cameraPositionRef = useRef({ x: 0, y: 0 }) // Independent camera position
  const lightingLayerRef = useRef<Graphics | null>(null)
  const themeManagerRef = useRef<ThemeManager | null>(null)
  const gridRef = useRef<Graphics | null>(null)
  const updateGridRef = useRef<((cameraX: number, cameraY: number) => void) | null>(null)
  const [clickedTracePosition, setClickedTracePosition] = useState<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1.0)
  const [worldOffset, setWorldOffset] = useState({ x: 0, y: 0 })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null)
  
  const { username, position, setPosition, otherUsers, traces, userId } = useGameStore()
  const [showTracePanel, setShowTracePanel] = useState(false)
  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [showLobbyManagement, setShowLobbyManagement] = useState(false)
  const [showThemeCustomization, setShowThemeCustomization] = useState(false)
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null)
  const [isLobbyOwner, setIsLobbyOwner] = useState(false)

  // Load lobby info
  useEffect(() => {
    if (!supabase || !lobbyId) return

    const loadLobby = async () => {
      const { data, error } = await (supabase!
        .from('lobbies')
        .select('*')
        .eq('id', lobbyId)
        .single() as any)

      if (!error && data) {
        const lobby: Lobby = {
          id: data.id,
          name: data.name,
          ownerUserId: data.owner_user_id,
          passwordHash: data.password_hash,
          maxPlayers: data.max_players,
          isPublic: data.is_public,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          themeSettings: data.theme_settings,
        }
        setCurrentLobby(lobby)
        setIsLobbyOwner(data.owner_user_id === userId)
      }
    }

    loadLobby()
  }, [lobbyId, userId])
  
  // Keep traces ref in sync
  useEffect(() => {
    tracesDataRef.current = traces
    console.log('📦 Traces updated in state:', traces.length, 'total traces')
  }, [traces])
  
  // Keep otherUsers ref in sync
  useEffect(() => {
    otherUsersRef.current = otherUsers
  }, [otherUsers])
  
  // Handle closing trace panel
  const handleCloseTracePanel = () => {
    setShowTracePanel(false)
    setClickedTracePosition(null)
  }
  
  // Keep position ref in sync
  useEffect(() => {
    positionRef.current = position
    // Initialize camera to center on player at start (only once)
    if (cameraPositionRef.current.x === 0 && cameraPositionRef.current.y === 0) {
      cameraPositionRef.current = { x: position.x, y: position.y }
    }
  }, [position])
  
  // Initialize presence and traces for this lobby
  usePresence(lobbyId)
  useTraces(lobbyId)

  // Smooth keyboard controls with acceleration
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle keyboard movement if user is typing in an input/textarea
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      
      const key = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        keysPressed.current.add(key)
        e.preventDefault()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      keysPressed.current.delete(key)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // Initialize Pixi.js with endless scrolling world
  useEffect(() => {
    if (!canvasRef.current || appRef.current) return

    // Use full viewport dimensions
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Get theme settings from current lobby
    const gridColor = currentLobby?.themeSettings?.gridColor ? 
      parseInt(currentLobby.themeSettings.gridColor.replace('#', ''), 16) : 0x3b82f6
    const gridOpacity = currentLobby?.themeSettings?.gridOpacity ?? 0.2
    const bgColor = currentLobby?.themeSettings?.backgroundColor ? 
      parseInt(currentLobby.themeSettings.backgroundColor.replace('#', ''), 16) : 0x0a0a0f

    const app = new Application({
      width: viewportWidth,
      height: viewportHeight,
      backgroundColor: bgColor,
      antialias: true,
      resizeTo: window,
    })
    
    if (canvasRef.current) {
      canvasRef.current.appendChild(app.view as HTMLCanvasElement)
      appRef.current = app

      // Create world container that will move (camera effect)
      const worldContainer = new Container()
      app.stage.addChild(worldContainer)
      worldContainerRef.current = worldContainer

      // Create infinite grid (will be repositioned dynamically)
      const grid = new Graphics()
      worldContainer.addChild(grid)
      gridRef.current = grid
      
      // Create lighting layer (drawn above grid but below entities)
      const lightingLayer = new Graphics()
      worldContainer.addChild(lightingLayer)
      lightingLayerRef.current = lightingLayer
      
      // Function to redraw grid based on camera position
      const updateGrid = (cameraX: number, cameraY: number) => {
        grid.clear()
        grid.lineStyle(1, gridColor, gridOpacity)
        
        const gridSize = 50
        const startX = Math.floor((cameraX - viewportWidth) / gridSize) * gridSize
        const endX = Math.ceil((cameraX + viewportWidth * 2) / gridSize) * gridSize
        const startY = Math.floor((cameraY - viewportHeight) / gridSize) * gridSize
        const endY = Math.ceil((cameraY + viewportHeight * 2) / gridSize) * gridSize
        
        for (let x = startX; x <= endX; x += gridSize) {
          grid.moveTo(x, startY)
          grid.lineTo(x, endY)
        }
        for (let y = startY; y <= endY; y += gridSize) {
          grid.moveTo(startX, y)
          grid.lineTo(endX, y)
        }
      }
      updateGridRef.current = updateGrid

      // Mouse wheel zoom handler
      const handleWheel = (e: WheelEvent) => {
        e.preventDefault()
        const delta = -e.deltaY * 0.001
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current + delta * ZOOM_SPEED))
        zoomRef.current = newZoom
        worldContainer.scale.set(newZoom)
        setZoom(newZoom)
      }
      
      const wheelListener = handleWheel
      window.addEventListener('wheel', wheelListener, { passive: false })

      // Initialize theme manager
      const themeManager = new ThemeManager(worldContainer, {
        particleCount: 100,
        groundDensity: 0.5,
      })
      themeManagerRef.current = themeManager
      
      // Load theme assets asynchronously
      themeManager.loadTheme().then(() => {
        console.log('🎨 Theme loaded')
        themeManager.createParticles(viewportWidth, viewportHeight)
      })

      // Player avatar now rendered in DOM (TraceOverlay) for z-index support
      // Keep reference but make invisible
      const playerAvatar = new Graphics()
      playerAvatar.visible = false
      worldContainer.addChild(playerAvatar)
      playerAvatarRef.current = playerAvatar

      // Player label now rendered in DOM (TraceOverlay) for z-index support
      const label = new Text('', { fontSize: 12, fill: 0xffffff })
      label.visible = false
      worldContainer.addChild(label)
      labelRef.current = label

      // Create pulsing indicator for trace placement (initially hidden)
      const tracePlacementIndicator = new Graphics()
      worldContainer.addChild(tracePlacementIndicator)
      tracePlacementIndicatorRef.current = tracePlacementIndicator

      // Create container for trace direction indicators (on UI layer, not world)
      const traceIndicatorsContainer = new Container()
      app.stage.addChild(traceIndicatorsContainer)
      traceIndicatorsRef.current = traceIndicatorsContainer

      // Handle clicks and panning
      app.stage.eventMode = 'static'
      app.stage.hitArea = app.screen
      
      // Mouse down - start panning or show context menu
      app.stage.on('pointerdown', (event: any) => {
        const originalEvent = event.data.originalEvent as MouseEvent
        
        // Left mouse button (button 0) - start panning
        if (originalEvent.button === 0) {
          // Close context menu if open
          setContextMenu(null)
          
          isPanningRef.current = true
          lastPanPositionRef.current = { x: originalEvent.clientX, y: originalEvent.clientY }
          event.stopPropagation()
          return
        }
        
        // Right mouse button (button 2) - show context menu
        if (originalEvent.button === 2) {
          // Calculate world position where user right-clicked
          const worldX = (event.global.x - worldContainer.x) / zoomRef.current
          const worldY = (event.global.y - worldContainer.y) / zoomRef.current
          
          setContextMenu({
            x: originalEvent.clientX,
            y: originalEvent.clientY,
            worldX,
            worldY,
          })
          event.stopPropagation()
          return
        }
      })
      
      // Mouse move - handle panning
      const handleMouseMove = (e: MouseEvent) => {
        if (isPanningRef.current) {
          const deltaX = e.clientX - lastPanPositionRef.current.x
          const deltaY = e.clientY - lastPanPositionRef.current.y
          
          // Move the camera (not the player)
          cameraPositionRef.current.x -= deltaX / zoomRef.current
          cameraPositionRef.current.y -= deltaY / zoomRef.current
          
          lastPanPositionRef.current = { x: e.clientX, y: e.clientY }
        }
      }
      
      // Mouse up - stop panning
      const handleMouseUp = (e: MouseEvent) => {
        if (e.button === 0) {
          isPanningRef.current = false
        }
      }
      
      // Prevent context menu on right click
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault()
      }
      
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('contextmenu', handleContextMenu)

      // Fluid animation loop with keyboard input
      let pulseTime = 0
      app.ticker.add(() => {
        // Handle keyboard input with acceleration
        let targetVelX = 0
        let targetVelY = 0
        
        if (keysPressed.current.has('w') || keysPressed.current.has('arrowup')) {
          targetVelY = -MOVE_SPEED
        }
        if (keysPressed.current.has('s') || keysPressed.current.has('arrowdown')) {
          targetVelY = MOVE_SPEED
        }
        if (keysPressed.current.has('a') || keysPressed.current.has('arrowleft')) {
          targetVelX = -MOVE_SPEED
        }
        if (keysPressed.current.has('d') || keysPressed.current.has('arrowright')) {
          targetVelX = MOVE_SPEED
        }
        
        // Diagonal movement normalization
        if (targetVelX !== 0 && targetVelY !== 0) {
          const normalizer = Math.sqrt(2)
          targetVelX /= normalizer
          targetVelY /= normalizer
        }
        
        // Smooth acceleration/deceleration
        velocityRef.current.x += (targetVelX - velocityRef.current.x) * MOVE_ACCELERATION
        velocityRef.current.y += (targetVelY - velocityRef.current.y) * MOVE_ACCELERATION
        
        // Update position if moving
        if (Math.abs(velocityRef.current.x) > 0.01 || Math.abs(velocityRef.current.y) > 0.01) {
          const newX = positionRef.current.x + velocityRef.current.x
          const newY = positionRef.current.y + velocityRef.current.y
          setPosition(newX, newY)
        }
        
        // Update camera (world container offset based on camera position)
        worldContainer.x = -cameraPositionRef.current.x + viewportWidth / 2
        worldContainer.y = -cameraPositionRef.current.y + viewportHeight / 2
        
        // Sync world offset for overlay
        worldOffsetRef.current = { x: worldContainer.x, y: worldContainer.y }
        setWorldOffset({ x: worldContainer.x, y: worldContainer.y })
        
        // Update grid based on camera position
        updateGrid(cameraPositionRef.current.x, cameraPositionRef.current.y)
        
        // Update theme (ground elements and particles)
        const themeManager = themeManagerRef.current
        if (themeManager) {
          const camX = cameraPositionRef.current.x
          const camY = cameraPositionRef.current.y
          
          // Generate ground elements only near player and traces
          const playerPos = { x: positionRef.current.x, y: positionRef.current.y }
          const tracePositions = tracesDataRef.current.map(t => ({ x: t.x, y: t.y }))
          
          // Only generate in camera viewport (don't expand to include all traces)
          const margin = 500
          const minX = camX - viewportWidth / zoomRef.current - margin
          const minY = camY - viewportHeight / zoomRef.current - margin
          const maxX = camX + viewportWidth / zoomRef.current + margin
          const maxY = camY + viewportHeight / zoomRef.current + margin
          
          themeManager.generateGroundElements(
            minX, minY, maxX, maxY
          )
          
          // Update floating particles
          themeManager.updateParticles(camX, camY, viewportWidth, viewportHeight)
          
          // Cull distant ground elements for performance (also check if near player/traces)
          themeManager.cullGroundElements(camX, camY, viewportWidth, viewportHeight, playerPos.x, playerPos.y, tracePositions, zoomRef.current)
        }
        
        // NOTE: Lighting is now handled in TraceOverlay.tsx using DOM elements with blur
        // The Pixi.js lighting layer is kept for potential future use but not actively rendering
        if (lightingLayerRef.current) {
          lightingLayerRef.current.clear()
        }
        
        // Player avatar and label now rendered in DOM (no need to update Pixi objects)
        // Keeping refs for compatibility but they're invisible

        // Update pulsing indicator for trace placement
        if (tracePlacementIndicatorRef.current && clickedTracePosition) {
          pulseTime += 0.1
          const pulse = Math.abs(Math.sin(pulseTime))
          const size = 15 + pulse * 10
          
          tracePlacementIndicatorRef.current.clear()
          
          // Outer glow
          tracePlacementIndicatorRef.current.lineStyle(3, 0xffd700, 0.3 + pulse * 0.5)
          tracePlacementIndicatorRef.current.drawCircle(clickedTracePosition.x, clickedTracePosition.y, size + 10)
          
          // Middle ring
          tracePlacementIndicatorRef.current.lineStyle(2, 0xffd700, 0.5 + pulse * 0.5)
          tracePlacementIndicatorRef.current.drawCircle(clickedTracePosition.x, clickedTracePosition.y, size)
          
          // Inner bright circle
          tracePlacementIndicatorRef.current.beginFill(0xffd700, 0.6 + pulse * 0.4)
          tracePlacementIndicatorRef.current.drawCircle(clickedTracePosition.x, clickedTracePosition.y, 8)
          tracePlacementIndicatorRef.current.endFill()
        } else if (tracePlacementIndicatorRef.current) {
          // Clear indicator if no trace position
          tracePlacementIndicatorRef.current.clear()
        }

        // Update trace direction indicators on screen borders
        if (traceIndicatorsRef.current) {
          traceIndicatorsRef.current.removeChildren()
          
          // Find traces that are outside the camera viewport
          const offScreenTraces: Array<{ trace: any; distance: number; angle: number }> = []
          
          tracesDataRef.current.forEach((trace) => {
            // Calculate trace position in screen coordinates (accounting for zoom and camera position)
            // The world offset already includes zoom calculations from LobbyScene
            const traceScreenX = (trace.x - positionRef.current.x) * zoomRef.current + viewportWidth / 2
            const traceScreenY = (trace.y - positionRef.current.y) * zoomRef.current + viewportHeight / 2
            
            // Check if trace is outside viewport bounds (with some margin for trace size)
            const margin = 150 // Account for trace size
            const isOutsideViewport = 
              traceScreenX < -margin || traceScreenX > viewportWidth + margin ||
              traceScreenY < -margin || traceScreenY > viewportHeight + margin
            
            if (isOutsideViewport) {
              // Calculate angle and distance from camera center to trace
              const dx = trace.x - positionRef.current.x
              const dy = trace.y - positionRef.current.y
              const distance = Math.sqrt(dx * dx + dy * dy)
              const angle = Math.atan2(dy, dx)
              offScreenTraces.push({ trace, distance, angle })
            }
          })
          
          // Debug logging
          if (tracesDataRef.current.length > 0 && offScreenTraces.length > 0) {
            console.log('Zoom:', zoomRef.current.toFixed(2), 'Total traces:', tracesDataRef.current.length, 'Off-screen (outside viewport):', offScreenTraces.length)
          }
          
          // Sort by distance and show up to 5 closest off-screen traces
          offScreenTraces.sort((a, b) => a.distance - b.distance)
          const closestTraces = offScreenTraces.slice(0, 5)
          
          closestTraces.forEach(({ distance, angle }) => {
            // Calculate position on screen border
            const margin = 30
            let indicatorX = viewportWidth / 2 + Math.cos(angle) * (viewportWidth / 2 - margin)
            let indicatorY = viewportHeight / 2 + Math.sin(angle) * (viewportHeight / 2 - margin)
            
            // Clamp to screen boundaries
            indicatorX = Math.max(margin, Math.min(viewportWidth - margin, indicatorX))
            indicatorY = Math.max(margin, Math.min(viewportHeight - margin, indicatorY))
            
            // Create arrow indicator
            const indicator = new Graphics()
            
            // Arrow triangle
            indicator.beginFill(0xffd700, 0.8)
            indicator.moveTo(0, -8)
            indicator.lineTo(12, 0)
            indicator.lineTo(0, 8)
            indicator.lineTo(0, -8)
            indicator.endFill()
            
            // Circle background
            indicator.beginFill(0x16213e, 0.9)
            indicator.drawCircle(0, 0, 10)
            indicator.endFill()
            
            // Arrow again on top
            indicator.beginFill(0xffd700, 0.9)
            indicator.moveTo(0, -6)
            indicator.lineTo(10, 0)
            indicator.lineTo(0, 6)
            indicator.lineTo(0, -6)
            indicator.endFill()
            
            indicator.x = indicatorX
            indicator.y = indicatorY
            indicator.rotation = angle
            
            // Add distance text
            const distanceText = new Text(`${Math.round(distance)}`, {
              fontSize: 10,
              fill: 0xffd700,
            })
            distanceText.x = 0
            distanceText.y = 15
            distanceText.anchor.set(0.5)
            indicator.addChild(distanceText)
            
            traceIndicatorsRef.current?.addChild(indicator)
          })
        }

        // Update other users in world space
        const currentOtherUsers = otherUsersRef.current
        Object.entries(currentOtherUsers).forEach(([id, user]) => {
          let avatar = avatarsRef.current.get(id)
          
          if (!avatar) {
            console.log('🎨 Creating avatar for user:', user.username, 'at', user.x, user.y)
            const newAvatar = new Graphics()
            
            // Convert hex color to integer (e.g., '#ff0000' -> 0xff0000)
            const hexToInt = (hex: string) => {
              const cleanHex = hex.replace('#', '')
              return parseInt(cleanHex, 16)
            }
            const userColor = hexToInt(user.playerColor || '#ffffff')
            
            // Outer glow
            newAvatar.beginFill(userColor, 0.1)
            newAvatar.drawCircle(0, 0, AVATAR_SIZE + 8)
            newAvatar.endFill()
            
            // Middle glow
            newAvatar.beginFill(userColor, 0.3)
            newAvatar.drawCircle(0, 0, AVATAR_SIZE + 4)
            newAvatar.endFill()
            
            // Main circle
            newAvatar.beginFill(userColor)
            newAvatar.drawCircle(0, 0, AVATAR_SIZE)
            newAvatar.endFill()
            
            newAvatar.x = user.x
            newAvatar.y = user.y
            worldContainer.addChild(newAvatar)
            avatarsRef.current.set(id, newAvatar)

            const otherLabel = new Text(user.username, {
              fontSize: 12,
              fill: userColor,
            })
            otherLabel.x = user.x
            otherLabel.y = user.y - AVATAR_SIZE - 10
            otherLabel.anchor.set(0.5)
            worldContainer.addChild(otherLabel)
            avatar = newAvatar
            ;(avatar as any).label = otherLabel
            ;(avatar as any).playerColor = user.playerColor
          }

          // Update avatar color if it changed
          const currentColor = (avatar as any)?.playerColor
          if (currentColor !== user.playerColor) {
            // Redraw avatar with new color
            const hexToInt = (hex: string) => {
              const cleanHex = hex.replace('#', '')
              return parseInt(cleanHex, 16)
            }
            const userColor = hexToInt(user.playerColor || '#ffffff')
            
            avatar.clear()
            // Outer glow
            avatar.beginFill(userColor, 0.1)
            avatar.drawCircle(0, 0, AVATAR_SIZE + 8)
            avatar.endFill()
            // Middle glow
            avatar.beginFill(userColor, 0.3)
            avatar.drawCircle(0, 0, AVATAR_SIZE + 4)
            avatar.endFill()
            // Main circle
            avatar.beginFill(userColor)
            avatar.drawCircle(0, 0, AVATAR_SIZE)
            avatar.endFill()
            
            ;(avatar as any).playerColor = user.playerColor
            
            // Update label color too
            const otherLabel = (avatar as any)?.label
            if (otherLabel) {
              otherLabel.style.fill = userColor
            }
          }

          // Smooth interpolation
          if (avatar && avatar.transform) {
            avatar.x += (user.x - avatar.x) * 0.1
            avatar.y += (user.y - avatar.y) * 0.1
          }
          
          const otherLabel = (avatar as any)?.label
          if (otherLabel && otherLabel.transform) {
            otherLabel.x = avatar.x
            otherLabel.y = avatar.y - AVATAR_SIZE - 10
          }
          
          // Fade based on distance
          const dx = user.x - positionRef.current.x
          const dy = user.y - positionRef.current.y
          const distance = Math.sqrt(dx * dx + dy * dy)
          
          if (avatar && avatar.transform) {
            if (distance > TRACE_RENDER_DISTANCE) {
              avatar.visible = false
              if (otherLabel && otherLabel.transform) otherLabel.visible = false
            } else {
              avatar.visible = true
              if (otherLabel && otherLabel.transform) otherLabel.visible = true
              
              if (distance > TRACE_FADE_DISTANCE) {
                const fadeAlpha = 1 - ((distance - TRACE_FADE_DISTANCE) / (TRACE_RENDER_DISTANCE - TRACE_FADE_DISTANCE))
                avatar.alpha = Math.max(0, fadeAlpha)
                if (otherLabel && otherLabel.transform) otherLabel.alpha = Math.max(0, fadeAlpha)
              } else {
                avatar.alpha = 1
                if (otherLabel && otherLabel.transform) otherLabel.alpha = 1
              }
            }
          }
        })

        // Other users are now rendered in TraceOverlay DOM, so hide all Pixi avatars
        avatarsRef.current.forEach((avatar) => {
          if (avatar) {
            avatar.visible = false
            const label = (avatar as any)?.label
            if (label) {
              label.visible = false
            }
          }
        })
      })
    }

    return () => {
      // Cleanup theme manager
      if (themeManagerRef.current) {
        themeManagerRef.current.destroy()
        themeManagerRef.current = null
      }
      
      // Event listeners will be cleaned up automatically when window is unloaded
      if (appRef.current) {
        appRef.current.destroy(true, { children: true })
        appRef.current = null
      }
    }
  }, [username, setPosition, currentLobby]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme when lobby theme settings change
  useEffect(() => {
    if (!appRef.current || !gridRef.current || !updateGridRef.current || !currentLobby) return

    // Update background color
    const bgColor = currentLobby.themeSettings?.backgroundColor ? 
      parseInt(currentLobby.themeSettings.backgroundColor.replace('#', ''), 16) : 0x0a0a0f
    appRef.current.renderer.background.color = bgColor

    // Update grid (will use new colors on next redraw)
    const gridColor = currentLobby.themeSettings?.gridColor ? 
      parseInt(currentLobby.themeSettings.gridColor.replace('#', ''), 16) : 0x3b82f6
    const gridOpacity = currentLobby.themeSettings?.gridOpacity ?? 0.2
    
    // Recreate updateGrid function with new colors
    const grid = gridRef.current
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    
    const newUpdateGrid = (cameraX: number, cameraY: number) => {
      grid.clear()
      grid.lineStyle(1, gridColor, gridOpacity)
      
      const gridSize = 50
      const startX = Math.floor((cameraX - viewportWidth) / gridSize) * gridSize
      const endX = Math.ceil((cameraX + viewportWidth * 2) / gridSize) * gridSize
      const startY = Math.floor((cameraY - viewportHeight) / gridSize) * gridSize
      const endY = Math.ceil((cameraY + viewportHeight * 2) / gridSize) * gridSize
      
      for (let x = startX; x <= endX; x += gridSize) {
        grid.moveTo(x, startY)
        grid.lineTo(x, endY)
      }
      for (let y = startY; y <= endY; y += gridSize) {
        grid.moveTo(startX, y)
        grid.lineTo(endX, y)
      }
    }
    
    updateGridRef.current = newUpdateGrid
    
    // Trigger immediate grid update
    newUpdateGrid(cameraPositionRef.current.x, cameraPositionRef.current.y)

    // Update ThemeManager settings
    if (themeManagerRef.current) {
      const themeSettings = currentLobby.themeSettings
      const particleColor = themeSettings?.particleColor ? 
        parseInt(themeSettings.particleColor.replace('#', ''), 16) : 0xffffff
      
      themeManagerRef.current.updateConfig({
        particleColor,
        particlesEnabled: themeSettings?.particlesEnabled ?? true,
        groundEnabled: themeSettings?.groundParticlesEnabled ?? true,
        groundDensity: themeSettings?.groundElementDensity ?? 0.5,
        groundElementScale: themeSettings?.groundElementScale ?? 0.0625,
        groundElementScaleRange: themeSettings?.groundElementScaleRange ?? 0.025,
        particleOpacity: themeSettings?.particleOpacity ?? 0.6,
        particleDensity: themeSettings?.particleDensity ?? 1.0,
        groundParticleOpacity: themeSettings?.groundParticleOpacity ?? 1.0,
        groundPatternMode: themeSettings?.groundPatternMode ?? 'grid',
        gridSpacing: themeSettings?.gridSpacing ?? 100,
      })

      // Recreate particles with new settings
      themeManagerRef.current.createParticles(viewportWidth, viewportHeight)

      // Handle ground elements
      if (themeSettings?.groundParticlesEnabled === false) {
        // Clear ground elements if disabled
        themeManagerRef.current.clearGroundElements()
      } else if (themeSettings?.groundParticleUrls && themeSettings.groundParticleUrls.length > 0) {
        // Use custom ground elements - this completely replaces the default ones
        themeManagerRef.current.clearGroundElements() // Clear existing first
        themeManagerRef.current.loadCustomGroundElements(themeSettings.groundParticleUrls)
      } else {
        // No custom URLs provided - reload default ground elements
        themeManagerRef.current.clearGroundElements()
        themeManagerRef.current.loadTheme() // This will load default ground elements
      }
    }
  }, [currentLobby?.themeSettings])

  // Update traces visualization with fade effect
  useEffect(() => {
    if (!appRef.current || !worldContainerRef.current) return
    
    const worldContainer = worldContainerRef.current

    traces.forEach((trace) => {
      if (!tracesRef.current.has(trace.id)) {
        // Create simple marker for traces (DOM overlay handles actual content)
        const container = new Container()
        
        // Don't add marker dots - traces are displayed via DOM overlay

        container.x = trace.x
        container.y = trace.y
        
        worldContainer.addChild(container)
        tracesRef.current.set(trace.id, container)
      }
      
      // Update trace visibility and fade based on distance
      const traceContainer = tracesRef.current.get(trace.id)
      if (traceContainer) {
        const dx = trace.x - positionRef.current.x
        const dy = trace.y - positionRef.current.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        if (distance > TRACE_RENDER_DISTANCE) {
          traceContainer.visible = false
        } else {
          traceContainer.visible = true
          
          if (distance > TRACE_FADE_DISTANCE) {
            const fadeAlpha = 1 - ((distance - TRACE_FADE_DISTANCE) / (TRACE_RENDER_DISTANCE - TRACE_FADE_DISTANCE))
            traceContainer.alpha = Math.max(0, fadeAlpha)
          } else {
            traceContainer.alpha = 1
          }
        }
      }
    })
  }, [traces, position])

  return (
    <div className="fixed inset-0 bg-lobby-darker">
      {/* Canvas Container with Overlay - Full Viewport */}
      <div className="w-full h-full relative">
        {/* Pixi Canvas */}
        <div ref={canvasRef} className="absolute inset-0" />
        
        {/* Trace Content Overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <TraceOverlay
            traces={traces}
            lobbyWidth={window.innerWidth}
            lobbyHeight={window.innerHeight}
            zoom={zoom}
            worldOffset={worldOffset}
            lobbyId={lobbyId}
          />
        </div>
      </div>

      {/* HUD */}
      <div className="absolute top-4 left-4 bg-lobby-muted/90 backdrop-blur-sm px-4 py-2 rounded-lg border-2 border-lobby-accent/30 z-10">
        <p className="text-lobby-light text-sm">
          <span className="text-lobby-accent font-bold">{username}</span>
        </p>
        {currentLobby && (
          <p className="text-lobby-light/80 text-xs">
            📍 {currentLobby.name} {isLobbyOwner && '(Owner)'}
          </p>
        )}
        <p className="text-lobby-light/60 text-xs">
          {Object.keys(otherUsers).length} other{Object.keys(otherUsers).length !== 1 ? 's' : ''} online
        </p>
        <p className="text-lobby-light/70 text-xs mt-1">
          Position: ({Math.round(position.x)}, {Math.round(position.y)})
        </p>
        <p className="text-lobby-light/70 text-xs">
          Zoom: {zoomRef.current.toFixed(2)}x
        </p>
        <button
          onClick={() => {
            // Reset camera to center of map
            cameraPositionRef.current = { x: 0, y: 0 }
            worldOffsetRef.current = { x: 0, y: 0 }
            setWorldOffset({ x: 0, y: 0 })
          }}
          className="w-full mt-2 bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded text-xs font-semibold transition-all"
        >
          🎯 Recenter Camera
        </button>
        <div className="flex gap-1 mt-1">
          <button
            onClick={onLeaveLobby}
            className="flex-1 bg-red-600/80 hover:bg-red-600 text-white px-3 py-1 rounded text-xs font-semibold transition-all"
          >
            Leave
          </button>
          {isLobbyOwner && currentLobby && (
            <button
              onClick={() => setShowLobbyManagement(true)}
              className="flex-1 bg-lobby-accent/80 hover:bg-lobby-accent text-lobby-dark px-3 py-1 rounded text-xs font-semibold transition-all"
            >
              Manage
            </button>
          )}
        </div>
        {currentLobby && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(currentLobby.id)
              alert('Lobby ID copied! Share this with others to invite them.')
            }}
            className="w-full mt-1 bg-white/10 hover:bg-white/20 text-white px-3 py-1 rounded text-xs font-semibold transition-all"
          >
            📋 Copy Lobby ID
          </button>
        )}
      </div>

      {/* Trace Button */}
      <button
        onClick={() => {
          // Open trace panel at current player position
          setClickedTracePosition({ x: positionRef.current.x, y: positionRef.current.y })
          setShowTracePanel(!showTracePanel)
        }}
        className="absolute bottom-4 right-4 bg-lobby-accent hover:bg-lobby-accent/80 text-lobby-light px-6 py-3 rounded-lg font-semibold transition-all transform hover:scale-105 shadow-lg z-10"
      >
        {showTracePanel ? 'Close' : '📍 Leave Trace'}
      </button>

      {/* Layers Button */}
      <button
        onClick={() => setShowLayerPanel(!showLayerPanel)}
        className="absolute bottom-20 right-4 bg-lobby-muted hover:bg-lobby-muted/80 text-lobby-light px-6 py-3 rounded-lg font-semibold transition-all transform hover:scale-105 shadow-lg z-10 border-2 border-lobby-accent/50"
      >
        {showLayerPanel ? 'Close Layers' : '🎨 Layers'}
      </button>

      {/* Trace Panel */}
      {showTracePanel && (
        <TracePanel onClose={handleCloseTracePanel} tracePosition={clickedTracePosition} lobbyId={lobbyId} />
      )}

      {/* Layer Panel */}
      {showLayerPanel && (
        <LayerPanel onClose={() => setShowLayerPanel(false)} />
      )}

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 bg-lobby-muted/90 backdrop-blur-sm px-4 py-3 rounded-lg border-2 border-lobby-accent/30 z-10">
        <p className="text-lobby-light font-semibold text-xs mb-2">Controls:</p>
        <div className="space-y-1">
          <p className="text-lobby-light/60 text-xs flex items-center gap-2">
            <span className="text-lobby-accent">🖱️</span> Left click + drag to pan
          </p>
          <p className="text-lobby-light/60 text-xs flex items-center gap-2">
            <span className="text-lobby-accent">🖱️</span> Right click for menu
          </p>
          <p className="text-lobby-light/60 text-xs flex items-center gap-2">
            <span className="text-lobby-accent">�</span> "Leave Trace" button or right-click menu
          </p>
          <p className="text-lobby-light/60 text-xs flex items-center gap-2">
            <span className="text-lobby-accent">⌨️</span> WASD / Arrow keys to move
          </p>
          <p className="text-lobby-light/60 text-xs flex items-center gap-2">
            <span className="text-lobby-accent">🖱️</span> Mouse wheel to zoom
          </p>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          
          {/* Menu */}
          <div
            className="fixed bg-lobby-darker border-2 border-lobby-accent rounded-lg shadow-2xl z-50 min-w-[180px]"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
          >
            <div className="py-1">
              <button
                onClick={() => {
                  setPosition(contextMenu.worldX, contextMenu.worldY)
                  setContextMenu(null)
                }}
                className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2"
              >
                <span>🚀</span>
                <span>Teleport here</span>
              </button>
              <button
                onClick={() => {
                  setClickedTracePosition({ x: contextMenu.worldX, y: contextMenu.worldY })
                  setShowTracePanel(true)
                  setContextMenu(null)
                }}
                className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2"
              >
                <span>📍</span>
                <span>Leave trace here</span>
              </button>
              {isLobbyOwner && (
                <button
                  onClick={() => {
                    setShowThemeCustomization(true)
                    setContextMenu(null)
                  }}
                  className="w-full px-4 py-2 text-left text-white hover:bg-lobby-accent/20 transition-colors flex items-center gap-2 border-t border-lobby-accent/20"
                >
                  <span>🎨</span>
                  <span>Customize theme</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Theme Customization Modal */}
      {showThemeCustomization && currentLobby && (
        <ThemeCustomization
          lobby={currentLobby}
          onClose={() => setShowThemeCustomization(false)}
          onUpdate={() => {
            // Reload lobby info to get updated theme
            if (supabase) {
              (supabase
                .from('lobbies')
                .select('*')
                .eq('id', lobbyId)
                .single() as any)
                .then(({ data, error }: any) => {
                  if (!error && data) {
                    const lobby: Lobby = {
                      id: data.id,
                      name: data.name,
                      ownerUserId: data.owner_user_id,
                      passwordHash: data.password_hash,
                      maxPlayers: data.max_players,
                      isPublic: data.is_public,
                      createdAt: data.created_at,
                      updatedAt: data.updated_at,
                      themeSettings: data.theme_settings,
                    }
                    setCurrentLobby(lobby)
                  }
                })
            }
          }}
        />
      )}

      {/* Lobby Management Modal */}
      {showLobbyManagement && currentLobby && (
        <LobbyManagement
          lobby={currentLobby}
          onClose={() => setShowLobbyManagement(false)}
          onUpdate={() => {
            // Reload lobby info
            if (supabase) {
              (supabase!
                .from('lobbies')
                .select('*')
                .eq('id', lobbyId)
                .single() as any).then(({ data }: any) => {
                  if (data) {
                    setCurrentLobby({
                      id: data.id,
                      name: data.name,
                      ownerUserId: data.owner_user_id,
                      passwordHash: data.password_hash,
                      maxPlayers: data.max_players,
                      isPublic: data.is_public,
                      createdAt: data.created_at,
                      updatedAt: data.updated_at,
                    })
                  }
                })
            }
          }}
        />
      )}
    </div>
  )
}
