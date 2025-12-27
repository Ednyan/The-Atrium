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
import ProfileCustomization from './ProfileCustomization'
import { ThemeManager } from '../lib/themeManager'
import { supabase } from '../lib/supabase'
import type { Lobby } from '../types/database'

const AVATAR_SIZE = 20
const TRACE_RENDER_DISTANCE = 2000
const TRACE_FADE_DISTANCE = 1500
const MIN_ZOOM = 0.15
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
  const tracePlacementIndicatorRef = useRef<Graphics | null>(null)
  const traceIndicatorsRef = useRef<Container | null>(null)
  const tracesDataRef = useRef<typeof traces>([])
  const otherUsersRef = useRef<typeof otherUsers>({})
  const zoomRef = useRef(1.0)
  const targetZoomRef = useRef(1.0) // Target zoom for smooth interpolation
  const isPanningRef = useRef(false)
  const lastPanPositionRef = useRef({ x: 0, y: 0 })
  const worldOffsetRef = useRef({ x: 0, y: 0 })
  const cameraPositionRef = useRef({ x: 0, y: 0 }) // Independent camera position
  const lightingLayerRef = useRef<Graphics | null>(null)
  const themeManagerRef = useRef<ThemeManager | null>(null)
  const gridRef = useRef<Graphics | null>(null)
  const updateGridRef = useRef<((cameraX: number, cameraY: number) => void) | null>(null)
  const eventHandlersRef = useRef<{
    mousedown: ((e: MouseEvent) => void) | null,
    mousemove: ((e: MouseEvent) => void) | null,
    mouseup: ((e: MouseEvent) => void) | null,
    contextmenu: ((e: MouseEvent) => void) | null,
  }>({ mousedown: null, mousemove: null, mouseup: null, contextmenu: null })
  const [clickedTracePosition, setClickedTracePosition] = useState<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1.0)
  const [worldOffset, setWorldOffset] = useState({ x: 0, y: 0 })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null)
  
  const { username, position, setPosition, otherUsers, traces, userId } = useGameStore()
  const [showTracePanel, setShowTracePanel] = useState(false)
  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [showLobbyManagement, setShowLobbyManagement] = useState(false)
  const [showThemeCustomization, setShowThemeCustomization] = useState(false)
  const [showProfileCustomization, setShowProfileCustomization] = useState(false)
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null)
  const [isLobbyOwner, setIsLobbyOwner] = useState(false)
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)

  // Debug: Log when selectedTraceId changes
  useEffect(() => {
    console.log('LobbyScene: selectedTraceId changed to:', selectedTraceId)
  }, [selectedTraceId])

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
  const { updateCursorPosition } = usePresence(lobbyId)
  useTraces(lobbyId)

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
      const canvas = app.view as HTMLCanvasElement
      canvas.draggable = false
      canvas.ondragstart = () => false
      canvasRef.current.appendChild(canvas)
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
        // Check if mouse is over any UI elements (menus, panels, etc.)
        const target = e.target as HTMLElement
        const isOverUI = target.closest('.customize-menu, .layer-panel, select, input, textarea, button') !== null
        
        if (isOverUI) {
          // Let the browser handle normal scrolling for UI elements
          return
        }
        
        e.preventDefault()
        const delta = -e.deltaY * 0.001
        const newTargetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoomRef.current + delta * ZOOM_SPEED))
        targetZoomRef.current = newTargetZoom
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
      
      // Mouse down - start panning or show context menu (using window event for better capture)
      const handleMouseDown = (e: MouseEvent) => {
        // Left mouse button (button 0) - start panning
        if (e.button === 0) {
          // Close context menu if open
          setContextMenu(null)
          
          // Check if we're clicking on a trace element in the overlay
          // If so, don't start panning - let the trace handle the click
          const target = e.target as HTMLElement
          const isClickingTrace = target.closest('[data-trace-element]') !== null
          const isClickingUI = target.closest('[data-ui-element]') !== null || 
                               target.closest('button') !== null ||
                               target.closest('input') !== null ||
                               target.closest('select') !== null ||
                               target.closest('[role="dialog"]') !== null
          
          if (!isClickingTrace && !isClickingUI) {
            isPanningRef.current = true
            lastPanPositionRef.current = { x: e.clientX, y: e.clientY }
          }
          return
        }
        
        // Right mouse button (button 2) - show context menu for canvas (not traces)
        if (e.button === 2) {
          const target = e.target as HTMLElement
          const isClickingTrace = target.closest('[data-trace-element]') !== null
          
          // Only show canvas context menu if not clicking on a trace
          if (!isClickingTrace) {
            // Calculate world position where user right-clicked
            const worldX = (e.clientX - worldContainerRef.current!.x) / zoomRef.current
            const worldY = (e.clientY - worldContainerRef.current!.y) / zoomRef.current
            
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              worldX,
              worldY,
            })
          }
          return
        }
      }
      
      // Mouse move - handle panning and cursor tracking
      const handleMouseMove = (e: MouseEvent) => {
        // Always track cursor position in world coordinates
        // Convert screen coordinates to world coordinates
        const worldX = (e.clientX - worldContainerRef.current!.x) / zoomRef.current
        const worldY = (e.clientY - worldContainerRef.current!.y) / zoomRef.current
        
        // Update cursor position for presence (will be throttled in the hook)
        updateCursorPosition(worldX, worldY)
        
        if (isPanningRef.current) {
          const deltaX = e.clientX - lastPanPositionRef.current.x
          const deltaY = e.clientY - lastPanPositionRef.current.y
          
          // Convert mouse movement to world space based on current zoom
          // This makes panning feel consistent regardless of zoom level
          // The viewport size divided by zoom gives us the world space visible on screen
          const viewportWorldWidth = window.innerWidth / zoomRef.current
          const viewportWorldHeight = window.innerHeight / zoomRef.current
          
          // Convert pixel delta to percentage of screen, then to world units
          const worldDeltaX = (deltaX / window.innerWidth) * viewportWorldWidth
          const worldDeltaY = (deltaY / window.innerHeight) * viewportWorldHeight
          
          // Move the camera (not the player)
          cameraPositionRef.current.x -= worldDeltaX
          cameraPositionRef.current.y -= worldDeltaY
          
          lastPanPositionRef.current = { x: e.clientX, y: e.clientY }
        }
      }
      
      // Mouse up - stop panning
      const handleMouseUp = (e: MouseEvent) => {
        if (e.button === 0) {
          isPanningRef.current = false
        }
      }
      
      // Prevent context menu on right click (we handle it ourselves)
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault()
      }
      
      // Store handlers in ref for cleanup
      eventHandlersRef.current = {
        mousedown: handleMouseDown,
        mousemove: handleMouseMove,
        mouseup: handleMouseUp,
        contextmenu: handleContextMenu,
      }
      
      window.addEventListener('mousedown', handleMouseDown)
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('contextmenu', handleContextMenu)

      // Fluid animation loop
      let pulseTime = 0
      app.ticker.add(() => {
        // Smooth zoom interpolation
        const zoomLerpSpeed = 0.15 // Higher = faster, lower = smoother
        zoomRef.current += (targetZoomRef.current - zoomRef.current) * zoomLerpSpeed
        
        // Update world container scale
        worldContainer.scale.set(zoomRef.current)
        
        // Update zoom state for React (throttled updates to avoid too many re-renders)
        // Only update if zoom changed significantly (reduces re-renders during smooth zoom)
        if (Math.abs(zoomRef.current - zoom) > 0.02) {
          setZoom(zoomRef.current)
        }
        
        // Update camera (world container offset based on camera position)
        // Apply zoom to camera position for correct centering
        worldContainer.x = -cameraPositionRef.current.x * zoomRef.current + viewportWidth / 2
        worldContainer.y = -cameraPositionRef.current.y * zoomRef.current + viewportHeight / 2
        
        // Sync world offset for overlay (throttled to reduce re-renders)
        const newOffsetX = worldContainer.x
        const newOffsetY = worldContainer.y
        worldOffsetRef.current = { x: newOffsetX, y: newOffsetY }
        
        // Only update state if offset changed significantly
        if (Math.abs(newOffsetX - worldOffset.x) > 1 || Math.abs(newOffsetY - worldOffset.y) > 1) {
          setWorldOffset({ x: newOffsetX, y: newOffsetY })
        }
        
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

        // Update trace direction indicators on screen borders (Nier:Automata style)
        // Now relative to CAMERA position, not player position
        if (traceIndicatorsRef.current) {
          traceIndicatorsRef.current.removeChildren()
          pulseTime += 0.02 // Slower pulse for elegant animation
          
          // Find traces that are outside the camera viewport
          const offScreenTraces: Array<{ trace: any; distance: number; angle: number; screenX: number; screenY: number }> = []
          
          // Use CAMERA position for viewport calculations
          const cameraX = cameraPositionRef.current.x
          const cameraY = cameraPositionRef.current.y
          
          tracesDataRef.current.forEach((trace) => {
            // Calculate trace position in screen coordinates relative to CAMERA
            const traceScreenX = (trace.x - cameraX) * zoomRef.current + viewportWidth / 2
            const traceScreenY = (trace.y - cameraY) * zoomRef.current + viewportHeight / 2
            
            // Check if trace is outside viewport bounds
            const margin = 100
            const isOutsideViewport = 
              traceScreenX < -margin || traceScreenX > viewportWidth + margin ||
              traceScreenY < -margin || traceScreenY > viewportHeight + margin
            
            if (isOutsideViewport) {
              // Calculate angle and distance from CAMERA center to trace
              const dx = trace.x - cameraX
              const dy = trace.y - cameraY
              const distance = Math.sqrt(dx * dx + dy * dy)
              const angle = Math.atan2(dy, dx)
              offScreenTraces.push({ trace, distance, angle, screenX: traceScreenX, screenY: traceScreenY })
            }
          })
          
          // Sort by distance and show up to 8 closest off-screen traces
          offScreenTraces.sort((a, b) => a.distance - b.distance)
          const closestTraces = offScreenTraces.slice(0, 8)
          
          closestTraces.forEach(({ distance, angle }, index) => {
            // Calculate position on screen border with edge detection
            const edgeMargin = 50
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)
            
            // Find intersection with screen edges
            let indicatorX: number
            let indicatorY: number
            
            // Calculate intersection with each edge
            const halfW = viewportWidth / 2 - edgeMargin
            const halfH = viewportHeight / 2 - edgeMargin
            
            // Time to hit right/left edge
            const tX = cos !== 0 ? halfW / Math.abs(cos) : Infinity
            // Time to hit top/bottom edge
            const tY = sin !== 0 ? halfH / Math.abs(sin) : Infinity
            
            const t = Math.min(tX, tY)
            indicatorX = viewportWidth / 2 + cos * t
            indicatorY = viewportHeight / 2 + sin * t
            
            // Clamp to screen boundaries
            indicatorX = Math.max(edgeMargin, Math.min(viewportWidth - edgeMargin, indicatorX))
            indicatorY = Math.max(edgeMargin, Math.min(viewportHeight - edgeMargin, indicatorY))
            
            // Nier:Automata style indicator
            const indicator = new Graphics()
            
            // Staggered pulse for each indicator
            const staggeredPulse = Math.sin(pulseTime * 3 + index * 0.5) * 0.5 + 0.5
            const breathe = Math.sin(pulseTime * 2) * 0.3 + 0.7
            
            // Distance-based opacity (closer = more opaque)
            const maxDistance = 3000
            const distanceAlpha = Math.max(0.4, 1 - (distance / maxDistance) * 0.6)
            
            // Outer bracket frame (Nier style)
            const bracketSize = 18 + staggeredPulse * 4
            const bracketThickness = 1.5
            const bracketLength = 8
            
            indicator.lineStyle(bracketThickness, 0xDADADA, distanceAlpha * breathe)
            
            // Top-left bracket
            indicator.moveTo(-bracketSize, -bracketSize + bracketLength)
            indicator.lineTo(-bracketSize, -bracketSize)
            indicator.lineTo(-bracketSize + bracketLength, -bracketSize)
            
            // Top-right bracket
            indicator.moveTo(bracketSize - bracketLength, -bracketSize)
            indicator.lineTo(bracketSize, -bracketSize)
            indicator.lineTo(bracketSize, -bracketSize + bracketLength)
            
            // Bottom-right bracket
            indicator.moveTo(bracketSize, bracketSize - bracketLength)
            indicator.lineTo(bracketSize, bracketSize)
            indicator.lineTo(bracketSize - bracketLength, bracketSize)
            
            // Bottom-left bracket
            indicator.moveTo(-bracketSize + bracketLength, bracketSize)
            indicator.lineTo(-bracketSize, bracketSize)
            indicator.lineTo(-bracketSize, bracketSize - bracketLength)
            
            // Inner diamond shape
            const diamondSize = 6 + staggeredPulse * 2
            indicator.lineStyle(1.5, 0xFFFFFF, distanceAlpha * 0.9)
            indicator.moveTo(0, -diamondSize)
            indicator.lineTo(diamondSize, 0)
            indicator.lineTo(0, diamondSize)
            indicator.lineTo(-diamondSize, 0)
            indicator.lineTo(0, -diamondSize)
            
            // Center dot
            indicator.beginFill(0xFFFFFF, distanceAlpha)
            indicator.drawCircle(0, 0, 2)
            indicator.endFill()
            
            // Direction line extending outward
            const lineLength = 25 + staggeredPulse * 5
            indicator.lineStyle(1, 0xDADADA, distanceAlpha * 0.6)
            indicator.moveTo(Math.cos(angle) * 12, Math.sin(angle) * 12)
            indicator.lineTo(Math.cos(angle) * lineLength, Math.sin(angle) * lineLength)
            
            // Small arrow head at end of line
            const arrowDist = lineLength - 2
            const arrowSize = 4
            const arrowAngle = 0.5
            indicator.lineStyle(1, 0xDADADA, distanceAlpha * 0.8)
            indicator.moveTo(
              Math.cos(angle) * arrowDist,
              Math.sin(angle) * arrowDist
            )
            indicator.lineTo(
              Math.cos(angle - arrowAngle) * (arrowDist - arrowSize) + Math.cos(angle) * 2,
              Math.sin(angle - arrowAngle) * (arrowDist - arrowSize) + Math.sin(angle) * 2
            )
            indicator.moveTo(
              Math.cos(angle) * arrowDist,
              Math.sin(angle) * arrowDist
            )
            indicator.lineTo(
              Math.cos(angle + arrowAngle) * (arrowDist - arrowSize) + Math.cos(angle) * 2,
              Math.sin(angle + arrowAngle) * (arrowDist - arrowSize) + Math.sin(angle) * 2
            )
            
            indicator.x = indicatorX
            indicator.y = indicatorY
            
            // Distance text with Nier styling
            const distanceNum = Math.round(distance)
            const distanceText = new Text(`${distanceNum}`, {
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: 9,
              fill: 0xDADADA,
              letterSpacing: 1,
            })
            distanceText.alpha = distanceAlpha * 0.8
            distanceText.anchor.set(0.5)
            
            // Position text below the indicator
            distanceText.x = 0
            distanceText.y = bracketSize + 12
            indicator.addChild(distanceText)
            
            // Small unit text
            const unitText = new Text('u', {
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: 7,
              fill: 0x888888,
            })
            unitText.alpha = distanceAlpha * 0.6
            unitText.anchor.set(0, 0.5)
            unitText.x = distanceText.width / 2 + 2
            unitText.y = bracketSize + 12
            indicator.addChild(unitText)
            
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
      
      // Remove event listeners
      if (eventHandlersRef.current.mousedown) {
        window.removeEventListener('mousedown', eventHandlersRef.current.mousedown)
      }
      if (eventHandlersRef.current.mousemove) {
        window.removeEventListener('mousemove', eventHandlersRef.current.mousemove)
      }
      if (eventHandlersRef.current.mouseup) {
        window.removeEventListener('mouseup', eventHandlersRef.current.mouseup)
      }
      if (eventHandlersRef.current.contextmenu) {
        window.removeEventListener('contextmenu', eventHandlersRef.current.contextmenu)
      }
      
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
    <div className="fixed inset-0 bg-nier-black lobby-scene">
      {/* Canvas Container with Overlay - Full Viewport */}
      <div className="w-full h-full relative">
        {/* Pixi Canvas */}
        <div ref={canvasRef} className="absolute inset-0" />
        
        {/* Trace Content Overlay */}
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }}>
          <TraceOverlay
            traces={traces}
            lobbyWidth={window.innerWidth}
            lobbyHeight={window.innerHeight}
            zoom={zoom}
            worldOffset={worldOffset}
            lobbyId={lobbyId}
            selectedTraceId={selectedTraceId}
            setSelectedTraceId={setSelectedTraceId}
          />
        </div>
      </div>

      {/* HUD */}
      <div data-ui-element="true" className="fixed top-4 left-4 bg-black px-4 py-3 border-2 border-white z-[9999] font-mono pointer-events-auto" style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white"></div>
        <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-white"></div>
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-white"></div>
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white"></div>
        
        <p className="text-white text-[11px] tracking-[0.15em] uppercase">
          <span className="font-bold">{username}</span>
        </p>
        <button
          onClick={() => setShowProfileCustomization(true)}
          className="w-full mt-1 bg-gray-700 border border-gray-500 hover:border-white text-white px-2 py-1 text-[9px] tracking-wider uppercase transition-all"
        >
          ◇ Customize
        </button>
        {currentLobby && (
          <p className="text-gray-300 text-[9px] tracking-wider">
            {currentLobby.name} {isLobbyOwner && '(Owner)'}
          </p>
        )}
        <p className="text-gray-400 text-[9px] tracking-wider">
          {Object.keys(otherUsers).length} online
        </p>
        <p className="text-gray-400 text-[9px] mt-1 tracking-wider">
          ({Math.round(position.x)}, {Math.round(position.y)})
        </p>
        <p className="text-gray-400 text-[9px] tracking-wider">
          {zoomRef.current.toFixed(2)}x
        </p>
        <button
          onClick={() => {
            // Reset camera to center of map
            cameraPositionRef.current = { x: 0, y: 0 }
            worldOffsetRef.current = { x: 0, y: 0 }
            setWorldOffset({ x: 0, y: 0 })
          }}
          className="w-full mt-2 bg-gray-800 border border-gray-500 hover:border-white text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all"
        >
          ◇ Recenter
        </button>
        <div className="flex gap-1 mt-1">
          <button
            onClick={onLeaveLobby}
            className="flex-1 bg-red-800 hover:bg-red-600 text-white px-2 py-1 text-[9px] tracking-wider uppercase transition-all"
          >
            Leave
          </button>
          {isLobbyOwner && currentLobby && (
            <button
              onClick={() => setShowLobbyManagement(true)}
              className="flex-1 bg-white hover:bg-gray-200 text-black px-2 py-1 text-[9px] tracking-wider uppercase transition-all"
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
            className="w-full mt-1 bg-gray-800 border border-gray-500 hover:border-white text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all"
          >
            ◇ Copy Lobby ID
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
        className="fixed bottom-4 right-4 bg-white hover:bg-gray-200 text-black px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 border-gray-400 pointer-events-auto"
      >
        <span className="opacity-60 mr-2">◇</span>
        {showTracePanel ? 'Close' : 'Leave Trace'}
      </button>

      {/* Layers Button */}
      <button
        onClick={() => setShowLayerPanel(!showLayerPanel)}
        className="fixed bottom-20 right-4 bg-gray-800 hover:bg-gray-700 text-white px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 border-gray-500 pointer-events-auto"
      >
        <span className="opacity-60 mr-2">◇</span>
        {showLayerPanel ? 'Close' : 'Layers'}
      </button>

      {/* Trace Panel */}
      {showTracePanel && (
        <TracePanel onClose={handleCloseTracePanel} tracePosition={clickedTracePosition} lobbyId={lobbyId} />
      )}

      {/* Layer Panel */}
      {showLayerPanel && (
        <LayerPanel 
          onClose={() => setShowLayerPanel(false)}
          selectedTraceId={selectedTraceId}
          onSelectTrace={(traceId) => {
            console.log('LobbyScene: onSelectTrace called with:', traceId)
            console.log('LobbyScene: Current selectedTraceId before update:', selectedTraceId)
            setSelectedTraceId(traceId)
            console.log('LobbyScene: setSelectedTraceId called with:', traceId)
          }}
          onGoToTrace={(traceId) => {
            const trace = traces.find(t => t.id === traceId)
            if (trace) {
              console.log('Teleporting to trace:', {
                id: trace.id,
                tracePos: { x: trace.x, y: trace.y },
                currentCamera: { ...cameraPositionRef.current },
                currentPlayer: { ...positionRef.current }
              })
              // Set camera to trace position
              cameraPositionRef.current.x = trace.x
              cameraPositionRef.current.y = trace.y
              console.log('New camera position:', { ...cameraPositionRef.current })
            } else {
              console.warn('Trace not found:', traceId)
            }
          }}
        />
      )}

      {/* Instructions */}
      <div className="fixed bottom-4 left-4 px-4 py-3 border-2 border-white z-[9999] font-mono pointer-events-auto" style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white"></div>
        <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-white"></div>
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-white"></div>
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white"></div>
        
        <p className="text-white text-[10px] tracking-[0.15em] uppercase mb-2">Controls</p>
        <div className="space-y-1">
          <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
            <span className="text-gray-500">◇</span> Pan : Left Click + Drag
          </p>
          <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
            <span className="text-gray-500">◇</span> Menu : Right Click
          </p>
          <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
            <span className="text-gray-500">◇</span> Move : WASD / Arrows
          </p>
          <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
            <span className="text-gray-500">◇</span> Zoom : Mouse Wheel
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
            className="fixed bg-nier-blackLight border border-nier-border/40 shadow-2xl z-50 min-w-[180px] relative font-mono"
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
            }}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-nier-border/60 pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-nier-border/60 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-nier-border/60 pointer-events-none" />
            
            <div className="py-1">
              <button
                onClick={() => {
                  setPosition(contextMenu.worldX, contextMenu.worldY)
                  setContextMenu(null)
                }}
                className="w-full px-4 py-2 text-left text-nier-bg hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[10px] tracking-wider uppercase"
              >
                <span className="text-nier-border/60">◇</span>
                <span>Teleport here</span>
              </button>
              <button
                onClick={() => {
                  setClickedTracePosition({ x: contextMenu.worldX, y: contextMenu.worldY })
                  setShowTracePanel(true)
                  setContextMenu(null)
                }}
                className="w-full px-4 py-2 text-left text-nier-bg hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[10px] tracking-wider uppercase"
              >
                <span className="text-nier-border/60">◇</span>
                <span>Leave trace here</span>
              </button>
              {isLobbyOwner && (
                <button
                  onClick={() => {
                    setShowThemeCustomization(true)
                    setContextMenu(null)
                  }}
                  className="w-full px-4 py-2 text-left text-nier-bg hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[10px] tracking-wider uppercase border-t border-nier-border/20"
                >
                  <span className="text-nier-border/60">◇</span>
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

      {/* Profile Customization Modal */}
      {showProfileCustomization && (
        <ProfileCustomization
          onClose={() => setShowProfileCustomization(false)}
          position={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
        />
      )}
    </div>
  )
}
