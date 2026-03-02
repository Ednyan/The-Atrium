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
// pathSimplify no longer needed - drawings saved as raster images
import type { Lobby, Trace } from '../types/database'

const AVATAR_SIZE = 20
const TRACE_RENDER_DISTANCE = 2000
const TRACE_FADE_DISTANCE = 1500
const MIN_ZOOM = 0.15
const MAX_ZOOM = 1.15
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
  // Object pool for trace indicators to prevent memory leaks
  const indicatorPoolRef = useRef<Array<{ graphics: Graphics, distanceText: Text, unitText: Text }>>([])
  const tracesDataRef = useRef<typeof traces>([])
  const otherUsersRef = useRef<typeof otherUsers>({})
  const zoomRef = useRef(1.0)
  const targetZoomRef = useRef(1.0) // Target zoom for smooth interpolation
  const cameraRestoredRef = useRef(false) // Whether we restored a saved camera position
  const isPanningRef = useRef(false)
  const lastPanPositionRef = useRef({ x: 0, y: 0 })
  const worldOffsetRef = useRef({ x: 0, y: 0 })
  const cameraPositionRef = useRef({ x: 0, y: 0 }) // Independent camera position
  const lightingLayerRef = useRef<Graphics | null>(null)
  const themeManagerRef = useRef<ThemeManager | null>(null)
  const gridRef = useRef<Graphics | null>(null)
  const updateGridRef = useRef<((cameraX: number, cameraY: number) => void) | null>(null)
  // prevThemeSettingsRef removed - was causing theme update issues
  const eventHandlersRef = useRef<{
    mousedown: ((e: MouseEvent) => void) | null,
    mousemove: ((e: MouseEvent) => void) | null,
    mouseup: ((e: MouseEvent) => void) | null,
    contextmenu: ((e: MouseEvent) => void) | null,
    wheel: ((e: WheelEvent) => void) | null,
  }>({ mousedown: null, mousemove: null, mouseup: null, contextmenu: null, wheel: null })
  const [clickedTracePosition, setClickedTracePosition] = useState<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1.0)
  const [worldOffset, setWorldOffset] = useState({ x: 0, y: 0 })
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null)
  const [onlinePlayerCount, setOnlinePlayerCount] = useState(1) // Start with 1 (self)
  
  const { username, position, setPosition, otherUsers, traces, userId } = useGameStore()
  const [showTracePanel, setShowTracePanel] = useState(false)
  const [showLayerPanel, setShowLayerPanel] = useState(false)
  const [showLobbyManagement, setShowLobbyManagement] = useState(false)
  const [showThemeCustomization, setShowThemeCustomization] = useState(false)
  const [showProfileCustomization, setShowProfileCustomization] = useState(false)
  const [currentLobby, setCurrentLobby] = useState<Lobby | null>(null)
  const [isLobbyOwner, setIsLobbyOwner] = useState(false)
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)
  const [hudMinimized, setHudMinimized] = useState(false)
  const [drawControlsMinimized, setDrawControlsMinimized] = useState(false)
  const [controlsMinimized, setControlsMinimized] = useState(false)

  // Freehand drawing mode
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isEraserMode, setIsEraserMode] = useState(false)
  const [completedStrokes, setCompletedStrokes] = useState<Array<{ points: Array<{ x: number; y: number }>; color: string; width: number; isEraser: boolean }>>([])
  const [drawingColor, setDrawingColor] = useState('#ffffff')
  const [drawingWidth, setDrawingWidth] = useState(3)
  const [drawingSmoothing, setDrawingSmoothing] = useState(30)
  const [isSavingDrawing, setIsSavingDrawing] = useState(false)
  const currentStrokeRef = useRef<Array<{ x: number; y: number }>>([])
  const isDrawingModeRef = useRef(false)
  const isEraserModeRef = useRef(false)
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null)
  const completedStrokesRef = useRef<typeof completedStrokes>([])
  const drawingColorRef = useRef('#ffffff')
  const drawingWidthRef = useRef(3)
  const smoothedPointRef = useRef<{ x: number; y: number } | null>(null)
  const drawingSmoothingRef = useRef(30)

  // Keep drawing mode ref in sync
  useEffect(() => {
    isDrawingModeRef.current = isDrawingMode
  }, [isDrawingMode])

  // Keep drawing refs in sync
  useEffect(() => { isEraserModeRef.current = isEraserMode }, [isEraserMode])
  useEffect(() => { drawingColorRef.current = drawingColor }, [drawingColor])
  useEffect(() => { drawingWidthRef.current = drawingWidth }, [drawingWidth])
  useEffect(() => { drawingSmoothingRef.current = drawingSmoothing }, [drawingSmoothing])
  useEffect(() => {
    completedStrokesRef.current = completedStrokes
    renderDrawingCanvas()
  }, [completedStrokes])

  // Canvas drawing helpers
  const drawBezierStroke = (ctx: CanvasRenderingContext2D, points: Array<{x: number; y: number}>, color: string, width: number, isEraser: boolean) => {
    if (points.length < 2) return
    ctx.save()
    ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over'
    ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y)
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = i > 0 ? points[i - 1] : points[i]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = i + 2 < points.length ? points[i + 2] : p2
        const tension = 0.5
        const cp1x = p1.x + (p2.x - p0.x) / 6 * tension
        const cp1y = p1.y + (p2.y - p0.y) / 6 * tension
        const cp2x = p2.x - (p3.x - p1.x) / 6 * tension
        const cp2y = p2.y - (p3.y - p1.y) / 6 * tension
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y)
      }
    }
    ctx.stroke()
    ctx.restore()
  }

  const renderDrawingCanvas = () => {
    const canvas = drawingCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Draw completed strokes
    for (const stroke of completedStrokesRef.current) {
      drawBezierStroke(ctx, stroke.points, stroke.color, stroke.width, stroke.isEraser)
    }
    // Draw current active stroke
    if (currentStrokeRef.current.length >= 2) {
      drawBezierStroke(ctx, currentStrokeRef.current, drawingColorRef.current, drawingWidthRef.current, isEraserModeRef.current)
    }
  }

  // Canvas resize effect
  useEffect(() => {
    if (!isDrawingMode) return
    const canvas = drawingCanvasRef.current
    if (!canvas) return
    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      renderDrawingCanvas()
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [isDrawingMode])

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
  }, [traces])
  
  // Keep otherUsers ref in sync
  useEffect(() => {
    otherUsersRef.current = otherUsers
  }, [otherUsers])
  
  // T key shortcut to open trace panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        e.stopPropagation()
        setClickedTracePosition({ x: positionRef.current.x, y: positionRef.current.y })
        setShowTracePanel(prev => !prev)
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        e.stopPropagation()
        setIsDrawingMode(prev => {
          if (!prev) return true
          // Exiting: clear everything
          setCompletedStrokes([])
          currentStrokeRef.current = []
          setIsEraserMode(false)
          return false
        })
      }
      if (e.key === 'e' || e.key === 'E') {
        if (isDrawingModeRef.current) {
          e.preventDefault()
          e.stopPropagation()
          setIsEraserMode(prev => !prev)
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  
  // Refresh online player count every 10 minutes
  useEffect(() => {
    if (!supabase || !lobbyId) return
    
    const fetchPlayerCount = async () => {
      const { count } = await (supabase!
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('active_lobby_id', lobbyId) as any)
      
      const newCount = (count || 0)
      // Only update if count changed
      if (newCount !== onlinePlayerCount) {
        setOnlinePlayerCount(newCount)
      }
    }
    
    // Initial fetch
    fetchPlayerCount()
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchPlayerCount, 30 * 1000)
    
    return () => clearInterval(interval)
  }, [lobbyId, onlinePlayerCount])
  
  // Handle closing trace panel
  const handleCloseTracePanel = () => {
    setShowTracePanel(false)
    setClickedTracePosition(null)
  }
  
  // Restore saved camera position for this lobby on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`lobby_camera_${lobbyId}`)
      if (saved) {
        const { x, y, zoom: savedZoom } = JSON.parse(saved)
        cameraPositionRef.current = { x, y }
        zoomRef.current = savedZoom ?? 1.0
        targetZoomRef.current = savedZoom ?? 1.0
        cameraRestoredRef.current = true
      }
    } catch {}
  }, [lobbyId])

  // Keep position ref in sync
  useEffect(() => {
    positionRef.current = position
    // Initialize camera to center on player at start (only once, if no saved position)
    if (!cameraRestoredRef.current && cameraPositionRef.current.x === 0 && cameraPositionRef.current.y === 0) {
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
      
      eventHandlersRef.current.wheel = handleWheel
      window.addEventListener('wheel', handleWheel, { passive: false })

      // Initialize theme manager
      const themeManager = new ThemeManager(worldContainer, {
        particleCount: 100,
        groundDensity: 0.5,
      })
      themeManagerRef.current = themeManager
      
      // Load theme assets asynchronously
      themeManager.loadTheme().then(() => {
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
        // Left mouse button (button 0) - start panning or drawing
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
                               target.closest('textarea') !== null ||
                               target.closest('select') !== null ||
                               target.closest('label') !== null ||
                               target.closest('[role="dialog"]') !== null ||
                               target.closest('.customize-menu') !== null ||
                               target.closest('.pointer-events-auto') !== null
          
          if (!isClickingTrace && !isClickingUI) {
            // Don't start panning if in drawing mode
            if (isDrawingModeRef.current) return
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
      
      // Store handlers in ref for cleanup (wheel is already set above)
      eventHandlersRef.current.mousedown = handleMouseDown
      eventHandlersRef.current.mousemove = handleMouseMove
      eventHandlersRef.current.mouseup = handleMouseUp
      eventHandlersRef.current.contextmenu = handleContextMenu
      
      window.addEventListener('mousedown', handleMouseDown)
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      window.addEventListener('contextmenu', handleContextMenu)

      // Fluid animation loop
      let pulseTime = 0
      let frameCounter = 0
      let lastGridZoom = 1.0 // Track zoom level when grid was last drawn
      
      app.ticker.add(() => {
        frameCounter++
        
        // Smooth zoom interpolation with snap-to-target to prevent jitter
        const zoomLerpSpeed = 0.1 // Slower for smoother animation
        const zoomDiff = targetZoomRef.current - zoomRef.current
        
        // Snap to target if very close (prevents oscillation/jitter)
        if (Math.abs(zoomDiff) < 0.003) {
          zoomRef.current = targetZoomRef.current
        } else {
          zoomRef.current += zoomDiff * zoomLerpSpeed
        }
        
        // Check if zoom is stable (reached target)
        const zoomIsStable = zoomRef.current === targetZoomRef.current
        
        // Update world container scale
        worldContainer.scale.set(zoomRef.current)
        
        // Update camera (world container offset based on camera position)
        // Round to whole pixels to prevent sub-pixel jitter
        const rawX = -cameraPositionRef.current.x * zoomRef.current + viewportWidth / 2
        const rawY = -cameraPositionRef.current.y * zoomRef.current + viewportHeight / 2
        worldContainer.x = Math.round(rawX)
        worldContainer.y = Math.round(rawY)
        
        // Sync world offset for overlay
        const newOffsetX = worldContainer.x
        const newOffsetY = worldContainer.y
        worldOffsetRef.current = { x: newOffsetX, y: newOffsetY }
        
        // Update state for React - traces need this to position correctly during zoom
        // Use requestAnimationFrame-style throttling (every frame is fine, React batches these)
        const offsetChanged = Math.abs(newOffsetX - worldOffset.x) > 0.5 || Math.abs(newOffsetY - worldOffset.y) > 0.5
        if (offsetChanged) {
          setWorldOffset({ x: newOffsetX, y: newOffsetY })
        }
        
        // Update zoom state for React - update during animation for smooth trace scaling
        if (Math.abs(zoomRef.current - zoom) > 0.001) {
          setZoom(zoomRef.current)
        }
        
        // Update grid - only when zoom is stable or panning (not during zoom animation)
        if (zoomIsStable && (frameCounter % 2 === 0 || Math.abs(zoomRef.current - lastGridZoom) > 0.001)) {
          updateGrid(cameraPositionRef.current.x, cameraPositionRef.current.y)
          lastGridZoom = zoomRef.current
        }
        
        // Update theme manager
        const themeManager = themeManagerRef.current
        if (themeManager) {
          const camX = cameraPositionRef.current.x
          const camY = cameraPositionRef.current.y
          
          // Always update floating particles (they should animate continuously)
          themeManager.updateParticles(camX, camY, viewportWidth, viewportHeight)
          
          // Only generate/cull ground elements when zoom is stable (heavy operations)
          if (frameCounter % 2 === 0 && zoomIsStable) {
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
            
            // Cull distant ground elements for performance (also check if near player/traces)
            themeManager.cullGroundElements(camX, camY, viewportWidth, viewportHeight, playerPos.x, playerPos.y, tracePositions, zoomRef.current)
          }
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
        // Uses object pooling to prevent memory leaks
        if (traceIndicatorsRef.current) {
          pulseTime += 0.02 // Slower pulse for elegant animation
          
          // Find traces that are outside the camera viewport
          const cameraX = cameraPositionRef.current.x
          const cameraY = cameraPositionRef.current.y
          
          const offScreenTraces: Array<{ distance: number; angle: number }> = []
          
          tracesDataRef.current.forEach((trace) => {
            const traceScreenX = (trace.x - cameraX) * zoomRef.current + viewportWidth / 2
            const traceScreenY = (trace.y - cameraY) * zoomRef.current + viewportHeight / 2
            
            const margin = 100
            const isOutsideViewport = 
              traceScreenX < -margin || traceScreenX > viewportWidth + margin ||
              traceScreenY < -margin || traceScreenY > viewportHeight + margin
            
            if (isOutsideViewport) {
              const dx = trace.x - cameraX
              const dy = trace.y - cameraY
              const distance = Math.sqrt(dx * dx + dy * dy)
              const angle = Math.atan2(dy, dx)
              offScreenTraces.push({ distance, angle })
            }
          })
          
          // Sort by distance and show up to 8 closest
          offScreenTraces.sort((a, b) => a.distance - b.distance)
          const closestTraces = offScreenTraces.slice(0, 8)
          const neededCount = closestTraces.length
          
          // Ensure pool has enough indicators (create if needed, only once)
          while (indicatorPoolRef.current.length < neededCount) {
            const graphics = new Graphics()
            const distanceText = new Text('', {
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: 9,
              fill: 0xDADADA,
              letterSpacing: 1,
            })
            distanceText.anchor.set(0.5)
            const unitText = new Text('u', {
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: 7,
              fill: 0x888888,
            })
            unitText.anchor.set(0, 0.5)
            graphics.addChild(distanceText)
            graphics.addChild(unitText)
            indicatorPoolRef.current.push({ graphics, distanceText, unitText })
          }
          
          // Hide all indicators first
          indicatorPoolRef.current.forEach(({ graphics }) => {
            graphics.visible = false
            if (graphics.parent) graphics.parent.removeChild(graphics)
          })
          
          // Update and show needed indicators
          closestTraces.forEach(({ distance, angle }, index) => {
            const poolItem = indicatorPoolRef.current[index]
            const { graphics: indicator, distanceText, unitText } = poolItem
            
            // Calculate position on screen border
            const edgeMargin = 50
            const cos = Math.cos(angle)
            const sin = Math.sin(angle)
            const halfW = viewportWidth / 2 - edgeMargin
            const halfH = viewportHeight / 2 - edgeMargin
            const tX = cos !== 0 ? halfW / Math.abs(cos) : Infinity
            const tY = sin !== 0 ? halfH / Math.abs(sin) : Infinity
            const t = Math.min(tX, tY)
            let indicatorX = viewportWidth / 2 + cos * t
            let indicatorY = viewportHeight / 2 + sin * t
            indicatorX = Math.max(edgeMargin, Math.min(viewportWidth - edgeMargin, indicatorX))
            indicatorY = Math.max(edgeMargin, Math.min(viewportHeight - edgeMargin, indicatorY))
            
            // Animation values
            const staggeredPulse = Math.sin(pulseTime * 3 + index * 0.5) * 0.5 + 0.5
            const breathe = Math.sin(pulseTime * 2) * 0.3 + 0.7
            const maxDistance = 3000
            const distanceAlpha = Math.max(0.4, 1 - (distance / maxDistance) * 0.6)
            const bracketSize = 18 + staggeredPulse * 4
            
            // Redraw the graphics (clear and redraw is efficient for Graphics)
            indicator.clear()
            indicator.lineStyle(1.5, 0xDADADA, distanceAlpha * breathe)
            
            // Brackets
            indicator.moveTo(-bracketSize, -bracketSize + 8)
            indicator.lineTo(-bracketSize, -bracketSize)
            indicator.lineTo(-bracketSize + 8, -bracketSize)
            indicator.moveTo(bracketSize - 8, -bracketSize)
            indicator.lineTo(bracketSize, -bracketSize)
            indicator.lineTo(bracketSize, -bracketSize + 8)
            indicator.moveTo(bracketSize, bracketSize - 8)
            indicator.lineTo(bracketSize, bracketSize)
            indicator.lineTo(bracketSize - 8, bracketSize)
            indicator.moveTo(-bracketSize + 8, bracketSize)
            indicator.lineTo(-bracketSize, bracketSize)
            indicator.lineTo(-bracketSize, bracketSize - 8)
            
            // Diamond
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
            
            // Direction line
            const lineLength = 25 + staggeredPulse * 5
            indicator.lineStyle(1, 0xDADADA, distanceAlpha * 0.6)
            indicator.moveTo(cos * 12, sin * 12)
            indicator.lineTo(cos * lineLength, sin * lineLength)
            
            indicator.x = indicatorX
            indicator.y = indicatorY
            
            // Update text
            distanceText.text = `${Math.round(distance)}`
            distanceText.alpha = distanceAlpha * 0.8
            distanceText.y = bracketSize + 12
            unitText.alpha = distanceAlpha * 0.6
            unitText.x = distanceText.width / 2 + 2
            unitText.y = bracketSize + 12
            
            indicator.visible = true
            traceIndicatorsRef.current?.addChild(indicator)
          })
        }

        // Update other users in world space
        const currentOtherUsers = otherUsersRef.current
        
        // Clean up avatars for users who have left
        avatarsRef.current.forEach((avatar, id) => {
          if (!currentOtherUsers[id]) {
            const label = (avatar as any)?.label
            if (label) {
              label.destroy()
            }
            avatar.destroy()
            avatarsRef.current.delete(id)
          }
        })
        
        Object.entries(currentOtherUsers).forEach(([id, user]) => {
          let avatar = avatarsRef.current.get(id)
          
          if (!avatar) {
            // Creating avatar for user
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
      if (eventHandlersRef.current.wheel) {
        window.removeEventListener('wheel', eventHandlersRef.current.wheel)
      }
      eventHandlersRef.current = { mousedown: null, mousemove: null, mouseup: null, contextmenu: null, wheel: null }
      
      // Save camera position for this lobby before cleanup
      try {
        localStorage.setItem(`lobby_camera_${lobbyId}`, JSON.stringify({
          x: cameraPositionRef.current.x,
          y: cameraPositionRef.current.y,
          zoom: zoomRef.current,
        }))
      } catch {}

      // Clear all refs to help garbage collection
      cameraRestoredRef.current = false
      worldContainerRef.current = null
      avatarsRef.current.clear()
      tracesRef.current.clear()
      labelRef.current = null
      playerAvatarRef.current = null
      tracePlacementIndicatorRef.current = null
      traceIndicatorsRef.current = null
      lightingLayerRef.current = null
      gridRef.current = null
      updateGridRef.current = null
      tracesDataRef.current = []
      otherUsersRef.current = {}
      
      // Destroy indicator pool objects to free GPU memory
      indicatorPoolRef.current.forEach(({ graphics, distanceText, unitText }) => {
        distanceText.destroy(true)
        unitText.destroy(true)
        graphics.destroy({ children: true })
      })
      indicatorPoolRef.current = []
      
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
    
    // Create a set of current trace IDs for fast lookup
    const currentTraceIds = new Set(traces.map(t => t.id))
    
    // Clean up containers for traces that no longer exist
    tracesRef.current.forEach((container, id) => {
      if (!currentTraceIds.has(id)) {
        container.destroy({ children: true })
        tracesRef.current.delete(id)
      }
    })

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
      <div data-ui-element="true" className="fixed top-4 left-4 bg-black px-3 py-2 border-2 border-white z-[9999] font-mono pointer-events-auto" style={{ backgroundColor: 'rgba(0,0,0,0.9)', maxWidth: '160px' }}>
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white"></div>
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white"></div>
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white"></div>
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white"></div>
        
        {/* Header with username, online count, and minimize toggle */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-white text-[10px] tracking-[0.1em] uppercase font-bold truncate">
            {username}
          </p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-green-400 text-[8px]">{onlinePlayerCount}</span>
            </div>
            <button
              onClick={() => setHudMinimized(!hudMinimized)}
              className="text-gray-500 hover:text-white text-[14px] transition-colors leading-none px-0.5"
              title={hudMinimized ? 'Expand' : 'Minimize'}
            >
              {hudMinimized ? '▸' : '▾'}
            </button>
          </div>
        </div>
        {!hudMinimized && (
          <>
        {currentLobby && (
          <p className="text-gray-300 text-[8px] tracking-wider truncate">
            {currentLobby.name} {isLobbyOwner && '(Owner)'}
          </p>
        )}
        <p className="text-gray-500 text-[8px] tracking-wider">
          ({Math.round(position.x)}, {Math.round(position.y)}) • {zoomRef.current.toFixed(2)}x
        </p>
        <button
          onClick={() => {
            // Reset camera to center of map
            cameraPositionRef.current = { x: 0, y: 0 }
            worldOffsetRef.current = { x: 0, y: 0 }
            setWorldOffset({ x: 0, y: 0 })
          }}
          className="w-full mt-1.5 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
        >
          Recenter
        </button>
        <div className="flex gap-1 mt-1">
          <button
            onClick={onLeaveLobby}
            className="flex-1 bg-red-900 hover:bg-red-700 text-white px-1 py-0.5 text-[8px] tracking-wider uppercase transition-all"
          >
            Leave
          </button>
          {isLobbyOwner && currentLobby && (
            <button
              onClick={() => setShowLobbyManagement(true)}
              className="flex-1 bg-white hover:bg-gray-200 text-black px-1 py-0.5 text-[8px] tracking-wider uppercase transition-all"
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
            className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
          >
            Copy ID
          </button>
        )}
        <button
          onClick={() => setShowProfileCustomization(true)}
          className="w-full mt-1 bg-gray-700 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
        >
          Profile
        </button>
        {isLobbyOwner && (
          <button
            onClick={() => setShowThemeCustomization(true)}
            className="w-full mt-1 bg-gray-800 border border-gray-600 hover:border-white text-white px-2 py-0.5 text-[8px] tracking-wider uppercase transition-all"
          >
            Theme
          </button>
        )}
          </>
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

      {/* Draw Button */}
      <button
        onClick={() => {
          if (isDrawingMode) {
            setCompletedStrokes([])
            currentStrokeRef.current = []
            setIsEraserMode(false)
          }
          setIsDrawingMode(!isDrawingMode)
        }}
        className={`fixed bottom-36 right-4 ${isDrawingMode ? 'bg-white text-black border-white' : 'bg-gray-800 hover:bg-gray-700 text-white border-gray-500'} px-5 py-2.5 font-mono text-[11px] tracking-[0.15em] uppercase transition-all shadow-lg z-[9999] border-2 pointer-events-auto`}
      >
        <span className="opacity-60 mr-2">✎</span>
        {isDrawingMode ? 'Exit Draw' : 'Draw'}
      </button>

      {/* Drawing Mode Overlay */}
      {isDrawingMode && (
        <>
          {/* Drawing controls panel */}
          <div
            data-ui-element="true"
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] font-mono pointer-events-auto"
            style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}
          >
            <div className="relative border-2 border-white px-6 py-3">
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-white" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t border-r border-white" />
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-white" />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-white" />

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <p className="text-white text-[10px] tracking-[0.15em] uppercase">Freehand Draw</p>
                  <button
                    onClick={() => setDrawControlsMinimized(!drawControlsMinimized)}
                    className="text-gray-500 hover:text-white text-[14px] transition-colors leading-none px-0.5"
                    title={drawControlsMinimized ? 'Expand controls' : 'Minimize controls'}
                  >
                    {drawControlsMinimized ? '▸' : '▾'}
                  </button>
                </div>

                {!drawControlsMinimized && (<>

                {/* Draw / Eraser toggle */}
                <div className="flex border border-gray-600">
                  <button
                    onClick={() => setIsEraserMode(false)}
                    className={`px-3 py-1 text-[9px] tracking-wider uppercase transition-all ${!isEraserMode ? 'bg-white text-black' : 'bg-transparent text-gray-400 hover:text-white'}`}
                  >
                    ✎ Brush
                  </button>
                  <button
                    onClick={() => setIsEraserMode(true)}
                    className={`px-3 py-1 text-[9px] tracking-wider uppercase transition-all ${isEraserMode ? 'bg-white text-black' : 'bg-transparent text-gray-400 hover:text-white'}`}
                  >
                    ◻ Eraser
                  </button>
                </div>

                {/* Color picker - only shown in brush mode */}
                {!isEraserMode && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-gray-400 text-[8px] tracking-wider uppercase">Color</span>
                    <input
                      type="color"
                      value={drawingColor}
                      onChange={(e) => setDrawingColor(e.target.value)}
                      className="w-6 h-6 cursor-pointer bg-transparent border border-gray-600"
                    />
                  </div>
                )}

                {/* Stroke width */}
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-[8px] tracking-wider uppercase">{isEraserMode ? 'Size' : 'Width'}</span>
                  <input
                    type="range"
                    min="1"
                    max={isEraserMode ? '60' : '20'}
                    value={drawingWidth}
                    onChange={(e) => setDrawingWidth(Number(e.target.value))}
                    className="w-16 h-1 cursor-pointer accent-white"
                  />
                  <span className="text-gray-300 text-[9px] w-4">{drawingWidth}</span>
                </div>

                {/* Smoothing */}
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400 text-[8px] tracking-wider uppercase">Smooth</span>
                  <input
                    type="range"
                    min="0"
                    max="80"
                    value={drawingSmoothing}
                    onChange={(e) => setDrawingSmoothing(Number(e.target.value))}
                    className="w-16 h-1 cursor-pointer accent-white"
                  />
                  <span className="text-gray-300 text-[9px] w-4">{drawingSmoothing}%</span>
                </div>

                {/* Quick colors - only in brush mode */}
                {!isEraserMode && (
                  <div className="flex gap-1">
                    {['#ffffff', '#ff4444', '#44ff44', '#4488ff', '#ffff44', '#ff44ff', '#44ffff'].map(color => (
                      <button
                        key={color}
                        onClick={() => setDrawingColor(color)}
                        className={`w-4 h-4 border ${drawingColor === color ? 'border-white scale-125' : 'border-gray-600'} transition-all`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                )}

                {/* Undo last stroke */}
                {completedStrokes.length > 0 && (
                  <button
                    onClick={() => setCompletedStrokes(prev => prev.slice(0, -1))}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all border border-gray-500"
                  >
                    Undo
                  </button>
                )}

                {/* Clear all strokes */}
                {completedStrokes.length > 0 && (
                  <button
                    onClick={() => {
                      setCompletedStrokes([])
                      currentStrokeRef.current = []
                    }}
                    className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all border border-gray-500"
                  >
                    Clear
                  </button>
                )}

                {/* Print (save as image) button */}
                {completedStrokes.length > 0 && (
                  <button
                    disabled={isSavingDrawing}
                    onClick={async () => {
                      setIsSavingDrawing(true)
                      try {
                        // Render all strokes to find tight bounding box
                        const allPoints = completedStrokes.flatMap(s => s.points)
                        if (allPoints.length === 0) return

                        const padding = 20
                        const minSX = Math.min(...allPoints.map(p => p.x)) - padding
                        const maxSX = Math.max(...allPoints.map(p => p.x)) + padding
                        const minSY = Math.min(...allPoints.map(p => p.y)) - padding
                        const maxSY = Math.max(...allPoints.map(p => p.y)) + padding
                        const cropW = Math.max(1, maxSX - minSX)
                        const cropH = Math.max(1, maxSY - minSY)

                        // Create offscreen canvas sized to the bounding box
                        const offscreen = document.createElement('canvas')
                        offscreen.width = Math.ceil(cropW)
                        offscreen.height = Math.ceil(cropH)
                        const offCtx = offscreen.getContext('2d')!

                        // Draw strokes shifted so bounding box starts at (0,0)
                        for (const stroke of completedStrokes) {
                          const shifted = stroke.points.map(p => ({ x: p.x - minSX, y: p.y - minSY }))
                          drawBezierStroke(offCtx, shifted, stroke.color, stroke.width, stroke.isEraser)
                        }

                        // Export as PNG blob and upload to Supabase Storage
                        const blob = await new Promise<Blob>((resolve) => {
                          offscreen.toBlob((b) => resolve(b!), 'image/png')
                        })
                        const fileName = `drawing_${userId}_${Date.now()}.png`
                        
                        let imageUrl = ''
                        const { error: uploadError } = await supabase!.storage
                          .from('traces')
                          .upload(fileName, blob, { contentType: 'image/png' })
                        
                        if (uploadError) {
                          console.error('Storage upload failed, falling back to data URL:', uploadError)
                          imageUrl = offscreen.toDataURL('image/png')
                        } else {
                          const { data: { publicUrl } } = supabase!.storage
                            .from('traces')
                            .getPublicUrl(fileName)
                          imageUrl = publicUrl
                        }

                        // Convert screen-space bounds to world coordinates
                        const panX = worldContainerRef.current?.x ?? 0
                        const panY = worldContainerRef.current?.y ?? 0
                        const zoom = zoomRef.current
                        const worldMinX = (minSX - panX) / zoom
                        const worldMinY = (minSY - panY) / zoom
                        const worldW = cropW / zoom
                        const worldH = cropH / zoom
                        const worldCenterX = worldMinX + worldW / 2
                        const worldCenterY = worldMinY + worldH / 2

                        if (supabase) {
                          const { data, error } = await supabase.from('traces').insert({
                            user_id: userId,
                            username,
                            type: 'image',
                            content: 'freehand drawing',
                            media_url: imageUrl,
                            position_x: worldCenterX,
                            position_y: worldCenterY,
                            scale: 1.0,
                            rotation: 0.0,
                            lobby_id: lobbyId,
                            width: Math.round(worldW),
                            height: Math.round(worldH),
                            show_border: false,
                            show_background: false,
                            show_description: false,
                          } as any).select()

                          if (!error && data && data[0]) {
                            const dbTrace = data[0] as any
                            const trace: Trace = {
                              id: dbTrace.id,
                              userId: dbTrace.user_id,
                              username: dbTrace.username,
                              type: dbTrace.type,
                              content: dbTrace.content,
                              x: dbTrace.position_x,
                              y: dbTrace.position_y,
                              createdAt: dbTrace.created_at,
                              scale: dbTrace.scale ?? 1.0,
                              scaleX: dbTrace.scale ?? 1.0,
                              scaleY: dbTrace.scale ?? 1.0,
                              rotation: dbTrace.rotation ?? 0.0,
                              width: dbTrace.width,
                              height: dbTrace.height,
                              mediaUrl: dbTrace.media_url,
                              showBorder: false,
                              showBackground: false,
                              showDescription: false,
                              lobbyId: dbTrace.lobby_id,
                            }
                            useGameStore.getState().addTrace(trace)
                          } else if (error) {
                            console.error('Failed to save drawing:', error)
                          }
                        }
                      } catch (err) {
                        console.error('Error saving drawing:', err)
                      }
                      setIsSavingDrawing(false)
                      setCompletedStrokes([])
                      currentStrokeRef.current = []
                    }}
                    className="bg-white hover:bg-gray-200 text-black px-4 py-1 text-[9px] tracking-wider uppercase transition-all border border-white font-bold"
                  >
                    {isSavingDrawing ? '...' : `⎙ Print (${completedStrokes.length})`}
                  </button>
                )}

                <button
                  onClick={() => {
                    setIsDrawingMode(false)
                    setCompletedStrokes([])
                    currentStrokeRef.current = []
                    setIsEraserMode(false)
                  }}
                  className="ml-2 bg-red-900 hover:bg-red-700 text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all border border-red-600"
                >
                  Exit
                </button>
                </>)}

                {drawControlsMinimized && (
                  <button
                    onClick={() => {
                      setIsDrawingMode(false)
                      setCompletedStrokes([])
                      currentStrokeRef.current = []
                      setIsEraserMode(false)
                    }}
                    className="ml-2 bg-red-900 hover:bg-red-700 text-white px-3 py-1 text-[9px] tracking-wider uppercase transition-all border border-red-600"
                  >
                    Exit
                  </button>
                )}
              </div>
              {!drawControlsMinimized && (
                <p className="text-gray-500 text-[8px] tracking-wider mt-1 text-center">Click and drag to draw • E to toggle eraser • "Print" saves as image</p>
              )}
            </div>
          </div>

          {/* Drawing canvas overlay - below UI buttons, above traces */}
          <canvas
            ref={drawingCanvasRef}
            className="fixed inset-0 z-[9998]"
            style={{
              cursor: isEraserMode ? 'cell' : 'crosshair',
              width: '100vw',
              height: '100vh',
            }}
            onMouseDown={(e) => {
              if (e.button === 0) {
                e.preventDefault()
                e.stopPropagation()
                const point = { x: e.clientX, y: e.clientY }
                currentStrokeRef.current = [point]
                smoothedPointRef.current = { ...point }
                setIsDrawing(true)
                renderDrawingCanvas()
              } else if (e.button === 2) {
                e.preventDefault()
                currentStrokeRef.current = []
                smoothedPointRef.current = null
                setIsDrawing(false)
                renderDrawingCanvas()
              }
            }}
            onMouseMove={(e) => {
              if (isDrawing) {
                const raw = { x: e.clientX, y: e.clientY }
                const smoothing = drawingSmoothingRef.current / 100
                if (smoothing > 0 && smoothedPointRef.current) {
                  // Exponential moving average: lerp from smoothed toward raw
                  const alpha = 1 - smoothing
                  const sx = smoothedPointRef.current.x + (raw.x - smoothedPointRef.current.x) * alpha
                  const sy = smoothedPointRef.current.y + (raw.y - smoothedPointRef.current.y) * alpha
                  smoothedPointRef.current = { x: sx, y: sy }
                  currentStrokeRef.current.push({ x: sx, y: sy })
                } else {
                  smoothedPointRef.current = { ...raw }
                  currentStrokeRef.current.push(raw)
                }
                renderDrawingCanvas()
              }
            }}
            onMouseUp={(e) => {
              if (e.button === 0 && isDrawing) {
                setIsDrawing(false)
                const rawPoints = currentStrokeRef.current
                if (rawPoints.length >= 2) {
                  setCompletedStrokes(prev => [...prev, {
                    points: [...rawPoints],
                    color: drawingColorRef.current,
                    width: drawingWidthRef.current,
                    isEraser: isEraserModeRef.current,
                  }])
                }
                currentStrokeRef.current = []
              }
            }}
            onWheel={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
          />
        </>
      )}

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
            // onSelectTrace called
            setSelectedTraceId(traceId)
            // setSelectedTraceId called
          }}
          onGoToTrace={(traceId) => {
            const trace = traces.find(t => t.id === traceId)
            if (trace) {
              // Set camera to trace position
              cameraPositionRef.current.x = trace.x
              cameraPositionRef.current.y = trace.y
              // Camera position updated
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
        
        <div className="flex items-center justify-between gap-3">
          <p className="text-white text-[10px] tracking-[0.15em] uppercase">Controls</p>
          <button
            onClick={() => setControlsMinimized(!controlsMinimized)}
            className="text-gray-500 hover:text-white text-[14px] transition-colors leading-none px-0.5"
            title={controlsMinimized ? 'Expand' : 'Minimize'}
          >
            {controlsMinimized ? '▸' : '▾'}
          </button>
        </div>
        {!controlsMinimized && (
          <div className="space-y-1 mt-2">
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Pan : Left Click + Drag
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Zoom : Mouse Wheel
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Leave Trace : "T" Key
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Select Traces : Left Click Trace
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Move Traces : Left Click Trace + Drag
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Edit Traces : Select Trace + Right Click
            </p>
            <p className="text-gray-300 text-[9px] tracking-wider flex items-center gap-2">
              <span className="text-gray-500">◇</span> Freehand Draw : "D" Key
            </p>
          </div>
        )}
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
              <button
                onClick={() => {
                  setIsDrawingMode(true)
                  setContextMenu(null)
                }}
                className="w-full px-4 py-2 text-left text-nier-bg hover:bg-nier-bg/10 transition-colors flex items-center gap-3 text-[10px] tracking-wider uppercase"
              >
                <span className="text-nier-border/60">◇</span>
                <span>Freehand draw</span>
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
                      themeSettings: data.theme_settings,
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
