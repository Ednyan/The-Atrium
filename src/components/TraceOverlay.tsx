// ...existing code...
// ...existing code...
// ...existing code...
// Removed useEffectOnce, use standard useEffect
import React, { useState, useRef, useEffect, Fragment, useCallback } from 'react'
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
  selectedTraceId: string | null
  setSelectedTraceId: (id: string | null) => void
}
type TransformMode = 'none' | 'move' | 'scale' | 'rotate' | 'crop' | 'point' | 'control-in' | 'control-out' | 'move-path'

export default function TraceOverlay({ traces, lobbyWidth, lobbyHeight, zoom, worldOffset, lobbyId, selectedTraceId, setSelectedTraceId }: TraceOverlayProps) {
    const [customFonts, setCustomFonts] = useState<string[]>([]);

    // Load font files from public/fonts folder - only once, with cleanup
    useEffect(() => {
      const styleElements: HTMLStyleElement[] = []
      
      fetch('/fonts/')
        .then(async res => {
          if (!res.ok) return [];
          const text = await res.text();
          const matches = Array.from(text.matchAll(/href="([^"]+\.(ttf|otf|woff2?|TTF|OTF|WOFF2?|woff|ttf|otf))"/g));
          const files = matches.map(m => m[1]);
          setCustomFonts(files);
          files.forEach(fontFile => {
            const fontName = fontFile.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
            const fontUrl = `/fonts/${fontFile}`;
            // Check if font already exists to avoid duplicates
            if (!document.querySelector(`style[data-font="${fontName}"]`)) {
              const style = document.createElement('style');
              style.setAttribute('data-font', fontName);
              style.innerHTML = `@font-face { font-family: '${fontName}'; src: url('${fontUrl}'); font-display: swap; }`;
              document.head.appendChild(style);
              styleElements.push(style);
            }
          });
        });
      
      // Cleanup: remove style elements we added
      return () => {
        styleElements.forEach(style => {
          if (style.parentNode) {
            style.parentNode.removeChild(style);
          }
        });
      };
    }, []);
  const { position, username, playerZIndex, playerColor, cursorState, setCursorState, otherUsers, removeTrace, userId, addTrace, markTraceChanged, markTraceDeleted, pendingChanges, deletedTraces, clearPendingChanges, hasPendingChanges } = useGameStore()
  const [showPlayerMenu, setShowPlayerMenu] = useState(false)
  const [transformMode, setTransformMode] = useState<TransformMode>('none')
  const [isCropMode, setIsCropMode] = useState(false)
  const [localTraceTransforms, setLocalTraceTransforms] = useState<Record<string, { x: number; y: number; scaleX: number; scaleY: number; rotation: number }>>({})
  const justDraggedRef = useRef(false)
  const [imageDimensions, setImageDimensions] = useState<Record<string, { width: number; height: number }>>({})
  const [modalTrace, setModalTrace] = useState<Trace | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; traceId: string } | null>(null)
  const [editingTrace, setEditingTrace] = useState<Trace | null>(null)
  const [imageProxySources, setImageProxySources] = useState<Record<string, string>>({}) // Track which images use proxy
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{ traceId: string } | null>(null)
  const [playingMedia, setPlayingMedia] = useState<Set<string>>(new Set()) // Track traces with playing media
  const [pathCreationMode, setPathCreationMode] = useState(false) // Track if we're in path creation mode
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null) // Track selected point for control handle editing
  const [localShapePoints, setLocalShapePoints] = useState<Record<string, any[]>>({}) // Track shape points during drag
  const [colorPickerCallback, setColorPickerCallback] = useState<((color: string) => void) | null>(null) // For fallback color picker
  const [inlineEditingTraceId, setInlineEditingTraceId] = useState<string | null>(null) // Track which text trace is being inline edited
  const hasEyeDropperSupport = typeof window !== 'undefined' && 'EyeDropper' in window
  const [inlineEditText, setInlineEditText] = useState<string>('') // Track the text being edited
  
  const startPosRef = useRef<{ x: number; y: number; corner: string; initialPoint?: {x: number, y: number}; initialCpx?: number; initialCpy?: number; initialPoints?: any[] }>({ x: 0, y: 0, corner: '' })
  const startTransformRef = useRef({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 })
  const startCropRef = useRef({ cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1 })
  const centerRef = useRef({ x: 0, y: 0 })
  
  // Refs to store latest values for event handlers (to avoid stale closures)
  const tracesRef = useRef(traces)
  const editingTraceRef = useRef(editingTrace)
  const localShapePointsRef = useRef(localShapePoints)
  const zoomRef = useRef(zoom)
  
  // Keep refs updated
  useEffect(() => { tracesRef.current = traces }, [traces])
  useEffect(() => { editingTraceRef.current = editingTrace }, [editingTrace])
  useEffect(() => { localShapePointsRef.current = localShapePoints }, [localShapePoints])
  useEffect(() => { zoomRef.current = zoom }, [zoom])

  // Cleanup stale entries from state objects when traces are removed
  useEffect(() => {
    const traceIds = new Set(traces.map(t => t.id))
    
    // Clean up imageProxySources
    setImageProxySources(prev => {
      const filtered: Record<string, string> = {}
      for (const id in prev) {
        if (traceIds.has(id)) filtered[id] = prev[id]
      }
      return Object.keys(filtered).length === Object.keys(prev).length ? prev : filtered
    })
    
    // Clean up imageDimensions
    setImageDimensions(prev => {
      const filtered: Record<string, { width: number; height: number }> = {}
      for (const id in prev) {
        if (traceIds.has(id)) filtered[id] = prev[id]
      }
      return Object.keys(filtered).length === Object.keys(prev).length ? prev : filtered
    })
    
    // Clean up localShapePoints
    setLocalShapePoints(prev => {
      const filtered: Record<string, any[]> = {}
      for (const id in prev) {
        if (traceIds.has(id)) filtered[id] = prev[id]
      }
      return Object.keys(filtered).length === Object.keys(prev).length ? prev : filtered
    })
    
    // Clean up playingMedia
    setPlayingMedia(prev => {
      const filtered = new Set<string>()
      prev.forEach(id => {
        if (traceIds.has(id)) filtered.add(id)
      })
      return filtered.size === prev.size ? prev : filtered
    })
  }, [traces])

  // Cancel inline editing when selecting a different trace
  useEffect(() => {
    if (inlineEditingTraceId && selectedTraceId !== inlineEditingTraceId) {
      setInlineEditingTraceId(null)
      setInlineEditText('')
    }
  }, [selectedTraceId, inlineEditingTraceId])

  // Proactively test image URLs and use proxy for blocked ones
  useEffect(() => {
    const pendingImages: { img: HTMLImageElement; timeout: ReturnType<typeof setTimeout> }[] = []
    
    traces.forEach(trace => {
      // Handle both 'image' type and 'embed' type that contains direct image URLs
      if ((trace.type === 'image' || trace.type === 'embed') && (trace.mediaUrl || trace.imageUrl)) {
        const url = trace.mediaUrl || trace.imageUrl
        
        // Skip if already processed
        if (imageProxySources[trace.id] !== undefined || !url) return
        
        // Check if URL is likely a direct image (ends with image extension)
        const isDirectImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url)
        
        if (!isDirectImage) {
          // Not a direct image URL (likely a page URL like reddit.com/...)
          // Always use proxy for non-direct image URLs
          const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
          setImageProxySources(prev => ({
            ...prev,
            [trace.id]: proxyUrl
          }))
          return
        }
        
        // For direct image URLs, try loading normally first
        const img = new Image()
        img.crossOrigin = 'anonymous'
        
        const timeout = setTimeout(() => {
          // If image hasn't loaded in 3 seconds, switch to proxy
          if (!img.complete) {
            const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
            setImageProxySources(prev => ({
              ...prev,
              [trace.id]: proxyUrl
            }))
          }
        }, 3000)
        
        pendingImages.push({ img, timeout })
        
        img.onload = () => {
          clearTimeout(timeout)
          // Mark as successfully loaded directly (empty string means use original)
          setImageProxySources(prev => ({
            ...prev,
            [trace.id]: ''
          }))
        }
        
        img.onerror = () => {
          clearTimeout(timeout)
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
    
    // Cleanup: cancel pending image loads and timeouts
    return () => {
      pendingImages.forEach(({ img, timeout }) => {
        clearTimeout(timeout)
        img.onload = null
        img.onerror = null
        img.src = '' // Cancel the image load
      })
    }
  }, [traces, imageProxySources])

  // ESC key to deselect trace and close menus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Cancel color picker if active
        if (colorPickerCallback) {
          setColorPickerCallback(null)
          document.body.style.cursor = 'default'
          return
        }
        setSelectedTraceId(null)
        setTransformMode('none')
        setIsCropMode(false)
        setContextMenu(null)
        setEditingTrace(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [colorPickerCallback])

  // Global right-click handler for ignoreClicks traces
  // Since pointer-events: none blocks all events, we need to manually detect right-clicks
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      // Only handle if not clicking on an existing trace element
      const target = e.target as HTMLElement
      if (target.closest('[data-trace-element="true"]')) {
        return // Let normal handler take care of it
      }
      
      // Check if click position overlaps with any ignoreClicks trace
      const clickX = e.clientX
      const clickY = e.clientY
      
      // Find ignoreClicks traces that contain this point
      for (const trace of traces) {
        if (!trace.ignoreClicks) continue
        
        // Calculate trace bounds in screen coordinates
        const traceX = trace.x * zoom + worldOffset.x
        const traceY = trace.y * zoom + worldOffset.y
        const scaleX = trace.scaleX ?? trace.scale ?? 1
        const scaleY = trace.scaleY ?? trace.scale ?? 1
        
        // Get trace dimensions
        let width = 200, height = 150
        if (trace.type === 'shape') {
          width = trace.width || 200
          height = trace.height || 200
        } else if (imageDimensions[trace.id]) {
          width = imageDimensions[trace.id].width
          height = imageDimensions[trace.id].height
        }
        
        const halfWidth = (width * scaleX * zoom) / 2
        const halfHeight = (height * scaleY * zoom) / 2
        
        // Check if click is within trace bounds
        if (clickX >= traceX - halfWidth && clickX <= traceX + halfWidth &&
            clickY >= traceY - halfHeight && clickY <= traceY + halfHeight) {
          e.preventDefault()
          setContextMenu({ x: clickX, y: clickY, traceId: trace.id })
          setSelectedTraceId(trace.id)
          return
        }
      }
    }
    
    window.addEventListener('contextmenu', handleGlobalContextMenu)
    return () => window.removeEventListener('contextmenu', handleGlobalContextMenu)
  }, [traces, zoom, worldOffset, imageDimensions])

  // Fallback color picker - capture canvas and sample color on click
  useEffect(() => {
    if (!colorPickerCallback) return

    document.body.style.cursor = 'crosshair'

    const handleClick = (e: MouseEvent) => {
      // Don't pick from UI elements
      const target = e.target as HTMLElement
      if (target.closest('.customize-menu') || target.closest('button')) {
        return
      }

      e.preventDefault()
      e.stopPropagation()

      // Try to capture the WebGL canvas
      const canvas = document.querySelector('canvas') as HTMLCanvasElement
      if (canvas) {
        try {
          // Create a temporary 2D canvas from the WebGL canvas snapshot
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = canvas.width
          tempCanvas.height = canvas.height
          const ctx = tempCanvas.getContext('2d')
          if (ctx) {
            // Draw the WebGL canvas to our 2D canvas
            ctx.drawImage(canvas, 0, 0)
            
            // Get click position relative to canvas
            const rect = canvas.getBoundingClientRect()
            const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width))
            const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height))
            
            // Read the pixel
            const pixelData = ctx.getImageData(x, y, 1, 1).data
            const color = `#${pixelData[0].toString(16).padStart(2, '0')}${pixelData[1].toString(16).padStart(2, '0')}${pixelData[2].toString(16).padStart(2, '0')}`
            
            colorPickerCallback(color)
          }
        } catch (err) {
          console.warn('Could not capture canvas color:', err)
        }
      }

      // Reset
      setColorPickerCallback(null)
      document.body.style.cursor = 'default'
    }

    // Use capture phase
    window.addEventListener('click', handleClick, true)
    return () => {
      window.removeEventListener('click', handleClick, true)
      document.body.style.cursor = 'default'
    }
  }, [colorPickerCallback])

  const getScreenPosition = useCallback((worldX: number, worldY: number) => {
    const screenX = (worldX * zoom) + worldOffset.x
    const screenY = (worldY * zoom) + worldOffset.y
    return { screenX, screenY }
  }, [zoom, worldOffset.x, worldOffset.y])

  const getTraceTransform = useCallback((trace: Trace) => {
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
  }, [localTraceTransforms])

  const updateTraceTransform = (traceId: string, updates: Partial<{ x: number; y: number; scale?: number; scaleX?: number; scaleY?: number; rotation: number }>) => {
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

    // Update the trace in the store (local only - no DB sync)
    const updatedTrace: Trace = {
      ...trace,
      x: newTransform.x,
      y: newTransform.y,
      scaleX: newTransform.scaleX,
      scaleY: newTransform.scaleY,
      rotation: newTransform.rotation,
    }
    addTrace(updatedTrace)
    
    // Mark as having pending changes
    markTraceChanged(traceId)
  }

  // Save all pending changes to the database
  const [isSaving, setIsSaving] = useState(false)
  const saveAllChanges = async () => {
    if (!supabase || isSaving) return
    
    const db = supabase // Capture for use in closures
    setIsSaving(true)
    
    try {
      // Handle deletions first
      const deletePromises = Array.from(deletedTraces).map(async (traceId) => {
        await (db.from('traces') as any).delete().eq('id', traceId)
      })
      await Promise.all(deletePromises)
      
      // Handle updates
      const updatePromises = Array.from(pendingChanges).map(async (traceId) => {
        const trace = traces.find(t => t.id === traceId)
        if (!trace) return
        
        const updateData: any = {
          position_x: trace.x,
          position_y: trace.y,
          scale: ((trace.scaleX ?? 1) + (trace.scaleY ?? 1)) / 2,
          rotation: trace.rotation ?? 0,
          show_border: trace.showBorder,
          show_background: trace.showBackground,
          show_description: trace.showDescription,
          show_filename: trace.showFilename,
          font_size: trace.fontSize,
          font_family: trace.fontFamily,
          text_bold: trace.textBold,
          text_italic: trace.textItalic,
          text_underline: trace.textUnderline,
          text_align: trace.textAlign,
          text_color: trace.textColor,
          is_locked: trace.isLocked,
          border_radius: trace.borderRadius,
          crop_x: trace.cropX,
          crop_y: trace.cropY,
          crop_width: trace.cropWidth,
          crop_height: trace.cropHeight,
          illuminate: trace.illuminate,
          light_color: trace.lightColor,
          light_intensity: trace.lightIntensity,
          light_radius: trace.lightRadius,
          light_offset_x: trace.lightOffsetX,
          light_offset_y: trace.lightOffsetY,
          light_pulse: trace.lightPulse,
          light_pulse_speed: trace.lightPulseSpeed,
          enable_interaction: trace.enableInteraction,
          ignore_clicks: trace.ignoreClicks,
          z_index: trace.zIndex,
        }
        
        // Add optional fields
        if (trace.mediaUrl !== undefined) updateData.media_url = trace.mediaUrl
        if (trace.content !== undefined) updateData.content = trace.content
        
        // Shape properties
        if (trace.type === 'shape') {
          if (trace.shapeType !== undefined) updateData.shape_type = trace.shapeType
          if (trace.shapeColor !== undefined) updateData.shape_color = trace.shapeColor
          if (trace.shapeOpacity !== undefined) updateData.shape_opacity = trace.shapeOpacity
          if (trace.cornerRadius !== undefined) updateData.corner_radius = trace.cornerRadius
          if (trace.shapeOutlineOnly !== undefined) updateData.shape_outline_only = trace.shapeOutlineOnly
          if (trace.shapeNoFill !== undefined) updateData.shape_no_fill = trace.shapeNoFill
          if (trace.shapeOutlineColor !== undefined) updateData.shape_outline_color = trace.shapeOutlineColor
          if (trace.shapeOutlineWidth !== undefined) updateData.shape_outline_width = trace.shapeOutlineWidth
          if (trace.shapePoints !== undefined) updateData.shape_points = trace.shapePoints
          if (trace.pathCurveType !== undefined) updateData.path_curve_type = trace.pathCurveType
          if (trace.width !== undefined) updateData.width = trace.width
          if (trace.height !== undefined) updateData.height = trace.height
        }
        
        await (db.from('traces') as any).update(updateData).eq('id', traceId)
      })
      await Promise.all(updatePromises)
      
      // Clear pending changes
      clearPendingChanges()
    } catch (error) {
      alert('Failed to save some changes. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  // Ctrl+S keyboard shortcut to save
  useEffect(() => {
    const handleSaveShortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (hasPendingChanges()) {
          saveAllChanges()
        }
      }
    }
    window.addEventListener('keydown', handleSaveShortcut)
    return () => window.removeEventListener('keydown', handleSaveShortcut)
  }, [hasPendingChanges, pendingChanges, deletedTraces, traces])

  const deleteTrace = async (traceId: string) => {
    const dontAskAgain = localStorage.getItem('dontAskDeleteTrace') === 'true'
    
    if (!dontAskAgain) {
      // Show custom confirmation dialog
      setDeleteConfirmDialog({ traceId })
      return
    }
    
    // Execute deletion
    executeDelete(traceId)
  }
  
  const executeDelete = (traceId: string) => {
    // Immediately remove from local state for instant UI update
    removeTrace(traceId)
    setContextMenu(null)
    setSelectedTraceId(null)
    setDeleteConfirmDialog(null)
    
    // Mark for deletion (will be deleted on save)
    markTraceDeleted(traceId)
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
      font_size: trace.fontSize ?? 16,
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
    
    // Add shape properties if it's a shape
    if (trace.type === 'shape') {
      if (trace.shapeType) newTrace.shape_type = trace.shapeType
      if (trace.shapeColor) newTrace.shape_color = trace.shapeColor
      if (trace.shapeOpacity !== undefined) newTrace.shape_opacity = trace.shapeOpacity
      if (trace.cornerRadius !== undefined) newTrace.corner_radius = trace.cornerRadius
      if (trace.width) newTrace.width = trace.width
      if (trace.height) newTrace.height = trace.height
    }

    const { error } = await (supabase.from('traces') as any).insert(newTrace)
    
    if (error) {
      alert('Failed to duplicate trace: ' + error.message)
    }
  }

  const updateTraceCustomization = (traceId: string, updates: Partial<Trace>) => {
    // Find the trace
    const trace = traces.find(t => t.id === traceId)
    if (!trace) return
    
    // Update editingTrace immediately if it matches
    if (editingTrace && editingTrace.id === traceId) {
      setEditingTrace({ ...editingTrace, ...updates })
    }
    
    // Update the trace in the store (local only - no DB sync)
    const updatedTrace: Trace = { ...trace, ...updates }
    addTrace(updatedTrace)
    
    // Mark as having pending changes
    markTraceChanged(traceId)
  }

  const handleMouseDown = (e: React.MouseEvent, trace: Trace, mode: TransformMode, corner?: string) => {
    if (trace.isLocked && mode !== 'crop') return // Allow crop even on locked traces
    
    // Disable move/rotate/scale for path shapes - they're controlled by point editing
    if (trace.type === 'shape' && trace.shapeType === 'path' && mode === 'move') return
    
    e.stopPropagation()
    setSelectedTraceId(trace.id)
    setTransformMode(mode)
    setCursorState('grabbing') // Change cursor to grabbing while dragging
    
    // Prevent text selection during drag
    document.body.classList.add('dragging')
    
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

    // Use refs to get latest values (avoid stale closures)
    const currentTraces = tracesRef.current
    const currentEditingTrace = editingTraceRef.current
    const currentLocalShapePoints = localShapePointsRef.current
    const currentZoom = zoomRef.current

    const trace = currentTraces.find(t => t.id === selectedTraceId)
    if (!trace) return
    
    // Use editingTrace if available for the most up-to-date data
    const currentTrace = (currentEditingTrace && currentEditingTrace.id === selectedTraceId) ? currentEditingTrace : trace

    const deltaX = e.clientX - startPosRef.current.x
    const deltaY = e.clientY - startPosRef.current.y
    
    // If mouse has moved more than 3 pixels, consider it a drag
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      justDraggedRef.current = true
    }

  if (transformMode === 'move') {
      // Convert screen delta to world delta
      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom
      
      updateTraceTransform(selectedTraceId, {
        x: startTransformRef.current.x + worldDeltaX,
        y: startTransformRef.current.y + worldDeltaY,
      })
    } else if (transformMode === 'crop') {
      // Handle crop area adjustment
      const { width, height } = getTraceSize(trace)
      const transform = getTraceTransform(trace)
      const containerWidth = width * (transform as any).scaleX * currentZoom
      const containerHeight = height * (transform as any).scaleY * currentZoom
      
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
    } else if (transformMode === 'point') {
      // Edit individual points for path shapes using world coordinates
      const pointIndex = parseInt(startPosRef.current.corner)
      if (isNaN(pointIndex)) return
      
      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom
      
      // Use local points if available, otherwise use currentTrace points (which uses editingTrace if available)
      const currentPoints = currentLocalShapePoints[selectedTraceId] || currentTrace.shapePoints || []
      const newPoints = [...currentPoints]
      if (newPoints[pointIndex]) {
        // Store initial point if not already stored
        if (!startPosRef.current.initialPoint) {
          startPosRef.current.initialPoint = { ...currentPoints[pointIndex] }
        }
        
        const initial = startPosRef.current.initialPoint as any
        
        // Move point and control handles together
        newPoints[pointIndex] = {
          ...initial,
          x: initial.x + worldDeltaX,
          y: initial.y + worldDeltaY,
          // Move control points with the anchor point
          cp1x: initial.cp1x !== undefined ? initial.cp1x + worldDeltaX : undefined,
          cp1y: initial.cp1y !== undefined ? initial.cp1y + worldDeltaY : undefined,
          cp2x: initial.cp2x !== undefined ? initial.cp2x + worldDeltaX : undefined,
          cp2y: initial.cp2y !== undefined ? initial.cp2y + worldDeltaY : undefined,
        }
        // Update local state for instant feedback, DB update on mouseup
        setLocalShapePoints(prev => ({ ...prev, [selectedTraceId]: newPoints }))
      }
    } else if (transformMode === 'control-in' || transformMode === 'control-out') {
      // Edit control points for bezier curves using world coordinates
      const pointIndex = parseInt(startPosRef.current.corner)
      if (isNaN(pointIndex)) return
      
      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom
      
      const currentPoints = currentLocalShapePoints[selectedTraceId] || currentTrace.shapePoints || []
      const newPoints = [...currentPoints]
      if (newPoints[pointIndex]) {
        // Store initial control points if not already stored
        if (!startPosRef.current.initialCpx) {
          const point = currentPoints[pointIndex]
          if (transformMode === 'control-in') {
            startPosRef.current.initialCpx = point.cp1x ?? point.x - 20
            startPosRef.current.initialCpy = point.cp1y ?? point.y
          } else {
            startPosRef.current.initialCpx = point.cp2x ?? point.x + 20
            startPosRef.current.initialCpy = point.cp2y ?? point.y
          }
        }
        
        const cpxKey = transformMode === 'control-in' ? 'cp1x' : 'cp2x'
        const cpyKey = transformMode === 'control-in' ? 'cp1y' : 'cp2y'
        
        if (startPosRef.current.initialCpx !== undefined && startPosRef.current.initialCpy !== undefined) {
          newPoints[pointIndex] = {
            ...newPoints[pointIndex],
            [cpxKey]: startPosRef.current.initialCpx + worldDeltaX,
            [cpyKey]: startPosRef.current.initialCpy + worldDeltaY
          }
          // Update local state for instant feedback, DB update on mouseup
          setLocalShapePoints(prev => ({ ...prev, [selectedTraceId]: newPoints }))
        }
      }
    } else if (transformMode === 'move-path') {
      // Move all points of a path shape together
      const worldDeltaX = deltaX / currentZoom
      const worldDeltaY = deltaY / currentZoom
      
      // Use local points if available (during drag), otherwise use currentTrace points
      const currentPoints = currentLocalShapePoints[selectedTraceId] || currentTrace.shapePoints || []
      
      // Store initial points if not already stored
      if (!startPosRef.current.initialPoints) {
        startPosRef.current.initialPoints = currentPoints.map(p => ({ ...p }))
      }
      
      const newPoints = startPosRef.current.initialPoints.map(p => ({
        x: p.x + worldDeltaX,
        y: p.y + worldDeltaY,
        cp1x: p.cp1x !== undefined ? p.cp1x + worldDeltaX : undefined,
        cp1y: p.cp1y !== undefined ? p.cp1y + worldDeltaY : undefined,
        cp2x: p.cp2x !== undefined ? p.cp2x + worldDeltaX : undefined,
        cp2y: p.cp2y !== undefined ? p.cp2y + worldDeltaY : undefined,
      }))
      
      // Update local state for instant feedback, DB update on mouseup
      setLocalShapePoints(prev => ({ ...prev, [selectedTraceId]: newPoints }))
    }
  }

  const handleMouseUp = async () => {
    // Remove dragging class from body
    document.body.classList.remove('dragging')
    
    // If we actually dragged, prevent immediate deselection
    if (justDraggedRef.current) {
      // Clear the flag after a short delay (longer than click event)
      setTimeout(() => {
        justDraggedRef.current = false
      }, 100)
    }
    
    // Use refs to get latest values (avoid stale closures)
    const currentLocalShapePoints = localShapePointsRef.current
    const currentTraces = tracesRef.current
    const currentEditingTrace = editingTraceRef.current
    
    // Save local shape points to database if any
    if (selectedTraceId && currentLocalShapePoints[selectedTraceId]) {
      const pointsToSave = currentLocalShapePoints[selectedTraceId]
      const trace = currentTraces.find(t => t.id === selectedTraceId)
      
      // Update editingTrace immediately so it has the latest data
      // Create editingTrace if it doesn't exist (for path editing without opening customize menu)
      if (trace) {
        if (currentEditingTrace && currentEditingTrace.id === selectedTraceId) {
          setEditingTrace({ ...currentEditingTrace, shapePoints: pointsToSave })
        } else {
          setEditingTrace({ ...trace, shapePoints: pointsToSave })
        }
      }
      
      // Update database
      await updateTraceCustomization(selectedTraceId, { shapePoints: pointsToSave })
      
      // Clear local state after saving so new points can be added without interference
      setLocalShapePoints(prev => {
        const next = { ...prev }
        delete next[selectedTraceId]
        return next
      })
    }
    
    // Clear initial point/control point references
    if (startPosRef.current.initialPoint) {
      startPosRef.current.initialPoint = undefined
    }
    if (startPosRef.current.initialCpx !== undefined) {
      startPosRef.current.initialCpx = undefined
      startPosRef.current.initialCpy = undefined
    }
    if (startPosRef.current.initialPoints) {
      startPosRef.current.initialPoints = undefined
    }
    
    // Reset cursor state when done dragging
    setCursorState('default')
    
    // If in crop mode, keep crop mode and transform mode active for more adjustments
    // For point/control editing, keep the trace selected but clear transform mode
    // This allows clicking on control handles after dragging a point
    if (transformMode !== 'crop' && transformMode !== 'point' && transformMode !== 'control-in' && transformMode !== 'control-out' && transformMode !== 'move-path') {
      setTransformMode('none')
    } else if (transformMode === 'point' || transformMode === 'control-in' || transformMode === 'control-out' || transformMode === 'move-path') {
      // For path point editing, keep the point selected but clear transform mode
      // This allows clicking control handles after dragging
      setTransformMode('none')
      // Note: selectedPointIndex remains set so control handles stay visible
    }
  }

  // Click outside to deselect
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // If a trace element was clicked, don't deselect
      const target = e.target as HTMLElement
      if (target.closest('[data-trace-element="true"]')) {
        return
      }
      
      // Don't deselect if we just finished dragging
      if (justDraggedRef.current) {
        return
      }
      
      // CRITICAL: If in path creation mode, prevent ANY deselection
      if (pathCreationMode) {
        const target = e.target as HTMLElement
        
        // If clicking on UI elements, just ignore the click
        if (target.closest('[data-trace-element]') ||
            target.closest('.layer-panel') ||
            target.closest('[role="dialog"]') ||
            target.closest('.customize-menu') ||
            target.closest('button') ||
            target.closest('select') ||
            target.closest('input')) {
          return
        }
        
        // Add new point at click location
        // Use editingTrace first if available (has latest local changes), then fall back to trace from store
        if (selectedTraceId) {
          const trace = traces.find(t => t.id === selectedTraceId)
          
          if (trace && trace.shapeType === 'path') {
            const worldX = (e.clientX - worldOffset.x) / zoom
            const worldY = (e.clientY - worldOffset.y) / zoom
            
            // Use editingTrace's points if available (most up-to-date), otherwise use trace's points
            const sourceTrace = (editingTrace && editingTrace.id === selectedTraceId) ? editingTrace : trace
            const currentPoints = sourceTrace.shapePoints || []
            const newPoints = [...currentPoints, { x: worldX, y: worldY }]
            
            const updated = { ...trace, shapePoints: newPoints }
            setEditingTrace(updated)
            updateTraceCustomization(selectedTraceId, { shapePoints: newPoints })
          }
        }
        
        // IMPORTANT: Always return when in creation mode - never deselect
        return
      }
      
      // Normal click outside behavior - only when NOT in creation mode
      const clickTarget = e.target as HTMLElement
      if (!clickTarget.closest('[data-trace-element]') && 
          !clickTarget.closest('.layer-panel') &&
          !clickTarget.closest('[role="dialog"]') &&
          !clickTarget.closest('.customize-menu') &&
          !clickTarget.closest('button') &&
          !clickTarget.closest('select') &&
          !clickTarget.closest('input')) {
        setSelectedTraceId(null)
        setTransformMode('none')
        setIsCropMode(false)
      }
    }
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Delete key to delete selected trace
      if (e.key === 'Delete' && selectedTraceId) {
        e.preventDefault()
        deleteTrace(selectedTraceId)
      }
    }
    
    window.addEventListener('click', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [selectedTraceId, pathCreationMode, worldOffset, zoom, traces, editingTrace])

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

  // Clear editingTrace when trace is deselected
  useEffect(() => {
    if (!selectedTraceId && editingTrace) {
      // Clear editingTrace when nothing is selected
      setEditingTrace(null)
    }
    // Don't sync on traces updates - let editingTrace be the source of truth during editing
  }, [selectedTraceId, editingTrace])

  // Disable path creation mode when selection is cleared
  // Note: We don't check editingTrace here to avoid disabling mode when updating points
  useEffect(() => {
    if (!selectedTraceId) {
      setPathCreationMode(false)
      setSelectedPointIndex(null)
    }
  }, [selectedTraceId])

  const getTraceSize = useCallback((trace: Trace) => {
    // For shapes, use their custom dimensions
    if (trace.type === 'shape') {
      return { 
        width: trace.width || 200, 
        height: trace.height || 200 
      }
    }
    
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
  }, [imageDimensions])

  const getBorderColor = useCallback((type: string) => {
    switch (type) {
      case 'text':
        return '#ffffff'
      case 'image':
        return '#e5e5e5'
      case 'audio':
        return '#d4d4d4'
      case 'video':
        return '#c4c4c4'
      case 'embed':
        return '#b4b4b4'
      default:
        return '#ffffff'
    }
  }, [])

  const convertYouTubeUrl = useCallback((url: string) => {
    const youtubeRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/
    const match = url.match(youtubeRegex)
    if (match) {
      return `https://www.youtube.com/embed/${match[1]}`
    }
    return url
  }, [])

  // Extract iframe src from HTML embed code or return URL as-is
  const extractEmbedUrl = useCallback((content: string): string | null => {
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
  }, [convertYouTubeUrl])

  // Memoize visible traces to avoid recalculating on every render
  // Only show traces that are within the viewport (with some margin)
  const visibleTraces = React.useMemo(() => {
    const margin = 500 // Extra margin around viewport
    const viewportLeft = -worldOffset.x / zoom - margin
    const viewportTop = -worldOffset.y / zoom - margin
    const viewportRight = (window.innerWidth - worldOffset.x) / zoom + margin
    const viewportBottom = (window.innerHeight - worldOffset.y) / zoom + margin
    
    return traces.filter(trace => {
      const traceX = trace.x
      const traceY = trace.y
      // Rough bounds check (traces are centered, so add some buffer)
      const buffer = 500 // Account for large traces
      return traceX >= viewportLeft - buffer && 
             traceX <= viewportRight + buffer && 
             traceY >= viewportTop - buffer && 
             traceY <= viewportBottom + buffer
    })
  }, [traces, zoom, worldOffset.x, worldOffset.y])

  // Memoize sorted items to avoid re-sorting on every render
  const sortedItems = React.useMemo(() => {
    return [
      ...visibleTraces.map(trace => ({ type: 'trace' as const, trace, zIndex: trace.zIndex ?? 0 })),
      { type: 'player' as const, trace: null, zIndex: playerZIndex * 100 }
    ].sort((a, b) => a.zIndex - b.zIndex)
  }, [visibleTraces, playerZIndex])

  return (
    <div style={{ cursor: 'none', pointerEvents: 'none' }}>
      {/* Render traces AND player in z-index order */}
      {sortedItems
          .map((item) => {
            if (item.type === 'player') {
              // Render player cursor
              const playerScreenX = position.x * zoom + worldOffset.x
              const playerScreenY = position.y * zoom + worldOffset.y

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

              // Get cursor SVG based on state
              const getCursorSvg = () => {
                const size = 24 // Fixed size regardless of zoom
                const baseProps = {
                  width: size,
                  height: size,
                  viewBox: "0 0 24 24",
                  style: { 
                    transform: 'translate(-2px, -2px)',
                    filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.5))`,
                    transition: 'transform 0.1s ease-out',
                  } as React.CSSProperties
                }

                switch (cursorState) {
                  case 'pointer':
                    // Hand pointing cursor (for clickable items)
                    return (
                      <svg {...baseProps}>
                        <path
                          d="M7 5.5a2.5 2.5 0 0 1 5 0v3.062a2.5 2.5 0 0 1 2 0V7.5a2.5 2.5 0 0 1 5 0v7a7.5 7.5 0 0 1-15 0v-5a2.5 2.5 0 0 1 5 0v1.062a2.5 2.5 0 0 1-2 0V5.5z"
                          fill={playerColor}
                          stroke="white"
                          strokeWidth="1.5"
                        />
                      </svg>
                    )
                  case 'grab':
                    // Open hand (for draggable items)
                    return (
                      <svg {...baseProps} style={{ ...baseProps.style, transform: 'translate(-2px, -2px) scale(1.1)' }}>
                        <path
                          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                          fill={playerColor}
                          stroke="#90EE90"
                          strokeWidth="2"
                        />
                      </svg>
                    )
                  case 'grabbing':
                    // Closed hand (while dragging)
                    return (
                      <svg {...baseProps} style={{ ...baseProps.style, transform: 'translate(-2px, -2px) scale(0.95)' }}>
                        <path
                          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                          fill={playerColor}
                          stroke="#FFD700"
                          strokeWidth="2"
                        />
                      </svg>
                    )
                  case 'not-allowed':
                    // Red X indicator
                    return (
                      <svg {...baseProps}>
                        <path
                          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                          fill={playerColor}
                          stroke="#FF4444"
                          strokeWidth="2"
                        />
                      </svg>
                    )
                  default:
                    // Default arrow cursor
                    return (
                      <svg {...baseProps}>
                        <path
                          d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                          fill={playerColor}
                          stroke="white"
                          strokeWidth="1.5"
                        />
                      </svg>
                    )
                }
              }

              // Player cursor
              return (
                <div
                  key="player-cursor"
                  style={{
                    position: 'absolute',
                    left: playerScreenX,
                    top: playerScreenY,
                    pointerEvents: 'none',
                    transition: 'left 0.05s ease-out, top 0.05s ease-out',
                    filter: `drop-shadow(0 0 8px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6))`,
                    zIndex: 10000,
                  }}
                >
                  {getCursorSvg()}
                  {/* Player label */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 20,
                      left: 12,
                      color: playerColor,
                      fontSize: '11px',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      textShadow: `0 0 8px rgba(${rgb.r},${rgb.g},${rgb.b},0.5), 0 2px 4px rgba(0,0,0,0.8)`,
                      letterSpacing: '0.5px',
                      background: 'rgba(0,0,0,0.6)',
                      padding: '2px 6px',
                      borderRadius: '3px',
                    }}
                  >
                    {username}
                  </div>
                </div>
              )
            }

            // Render trace
            const trace = item.trace!
            // Use editingTrace for selected trace to show live updates (check ID match to be safe)
            const displayTrace = (editingTrace && editingTrace.id === trace.id) ? editingTrace : trace
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
        // EXCEPTION: Keep rendering if media is playing (video/audio) OR if it's an interactive embed
        const isPlayingMedia = playingMedia.has(trace.id)
        const isInteractiveEmbed = trace.type === 'embed' && trace.enableInteraction
        if (!isPlayingMedia && !isInteractiveEmbed && (traceOpacity <= 0 || distanceFromCenter > fadeEndRadius)) {
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
                  willChange: 'transform, opacity',
                  ['--pulse-opacity' as any]: (trace.lightIntensity ?? 1.0) * 0.8 * traceOpacity,
                }}
              />
            )}
            
            {/* The trace itself */}
            <div style={{ opacity: traceOpacity, willChange: 'transform' }}>
            {/* Container for positioning - doesn't scale */}
            <div
              data-trace-element="true"
              className="absolute"
              style={{
                left: `${screenX}px`,
                top: `${screenY}px`,
                transform: `translate(-50%, -50%) rotate(${transform.rotation}deg)`,
                willChange: 'transform',
                transformOrigin: 'center center',
                pointerEvents: trace.ignoreClicks ? 'none' : 'auto',
              }}
              onMouseEnter={() => setCursorState('pointer')}
              onMouseLeave={() => setCursorState('default')}
              onMouseDown={(e) => handleMouseDown(e, trace, 'move')}
              onClick={(e) => {
                // Don't handle clicks if we're in a transform mode (e.g., dragging a point)
                if (transformMode !== 'none') {
                  e.stopPropagation()
                  return
                }
                e.stopPropagation()
                setSelectedTraceId(trace.id)
              }}
              onDoubleClick={(e) => {
                e.stopPropagation()
                // For text traces, enable inline editing instead of modal
                if (trace.type === 'text' && trace.userId === userId) {
                  setInlineEditingTraceId(trace.id)
                  setInlineEditText(trace.content)
                } else {
                  setModalTrace(trace)
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, traceId: trace.id })
                setSelectedTraceId(trace.id)
              }}
            >
              {/* Shape rendering - no border container */}
              {trace.type === 'shape' ? (
                <div
                  className="relative cursor-pointer"
                  style={{
                    width: `${borderWidth}px`,
                    height: `${borderHeight}px`,
                    pointerEvents: trace.ignoreClicks ? 'none' : 'auto',
                    overflow: 'hidden',
                  }}
                >
                  {(() => {
                    const shapeColor = trace.shapeColor || '#3b82f6'
                    const shapeOpacity = trace.shapeOpacity ?? 1.0
                    const cornerRadius = trace.cornerRadius || 0
                    const shapeType = trace.shapeType || 'rectangle'
                    const hasOutline = trace.shapeOutlineOnly ?? false
                    const noFill = trace.shapeNoFill ?? false
                    const outlineColor = trace.shapeOutlineColor || shapeColor
                    const outlineWidth = trace.shapeOutlineWidth ?? 2
                    
                    // Determine fill and stroke based on options (independent)
                    const fill = noFill ? 'none' : shapeColor
                    const stroke = hasOutline ? outlineColor : 'none'
                    const strokeWidth = hasOutline ? outlineWidth : 0
                    
                    // Convert corner radius to viewBox percentage separately for x and y to keep circles circular
                    const radiusPercentX = (cornerRadius / width) * 100
                    const radiusPercentY = (cornerRadius / height) * 100

                    const clipPathStyle = trace.cropWidth && trace.cropWidth < 1 
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined

                    if (shapeType === 'rectangle') {
                      return (
                        <svg
                          className="w-full h-full pointer-events-none select-none"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          style={{ clipPath: clipPathStyle }}
                        >
                          <rect
                            x={hasOutline ? strokeWidth / 2 : 0}
                            y={hasOutline ? strokeWidth / 2 : 0}
                            width={hasOutline ? 100 - strokeWidth : 100}
                            height={hasOutline ? 100 - strokeWidth : 100}
                            rx={radiusPercentX}
                            ry={radiusPercentY}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                            vectorEffect="non-scaling-stroke"
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
                          style={{ clipPath: clipPathStyle }}
                        >
                          <ellipse
                            cx="50"
                            cy="50"
                            rx={hasOutline ? 50 - strokeWidth / 2 : 50}
                            ry={hasOutline ? 50 - strokeWidth / 2 : 50}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                            vectorEffect="non-scaling-stroke"
                            opacity={shapeOpacity}
                          />
                        </svg>
                      )
                    } else if (shapeType === 'triangle') {
                      const inset = hasOutline ? strokeWidth / 2 : 0
                      
                      return (
                        <svg
                          className="w-full h-full pointer-events-none select-none"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                          style={{ clipPath: clipPathStyle }}
                        >
                          <polygon
                            points={`50,${15 + inset} ${85 - inset},${85 - inset} ${15 + inset},${85 - inset}`}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                            opacity={shapeOpacity}
                          />
                        </svg>
                      )
                    } else if (shapeType === 'path') {
                      // Path shapes are rendered as absolute overlay - see below
                      return null
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
                    border: showBorder ? `3px solid ${isSelected && isCropMode ? '#9ca3af' : isSelected ? '#ffffff' : borderColor}` : 'none',
                    borderRadius: `${displayTrace.borderRadius ?? 8}px`,
                    backgroundColor: showBackground ? 'rgba(26, 26, 46, 0.95)' : 'transparent',
                    padding: '0px',
                    pointerEvents: trace.ignoreClicks ? 'none' : 'auto',
                    boxShadow: isSelected && isCropMode
                      ? '0 0 20px rgba(156, 163, 175, 0.6)'
                      : isSelected 
                      ? '0 0 20px rgba(255, 255, 255, 0.5)' 
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
                      setImageDimensions(prev => ({
                        ...prev,
                        [trace.id]: { width: video.videoWidth, height: video.videoHeight }
                      }))
                    }
                  }}
                  onPlay={() => {
                    setPlayingMedia(prev => new Set(prev).add(trace.id))
                  }}
                  onPause={() => {
                    setPlayingMedia(prev => {
                      const next = new Set(prev)
                      next.delete(trace.id)
                      return next
                    })
                  }}
                  onEnded={() => {
                    setPlayingMedia(prev => {
                      const next = new Set(prev)
                      next.delete(trace.id)
                      return next
                    })
                  }}
                />
              )}

              {/* Audio Content */}
              {trace.type === 'audio' && trace.mediaUrl && (
                <div className="flex flex-col items-center justify-center h-full pointer-events-none select-none">
                  <span className="text-2xl mb-2">🔊</span>
                  <audio
                    src={trace.mediaUrl}
                    controls
                    className="w-full pointer-events-auto"
                    style={{ height: '30px' }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onPlay={() => {
                      setPlayingMedia(prev => new Set(prev).add(trace.id))
                    }}
                    onPause={() => {
                      setPlayingMedia(prev => {
                        const next = new Set(prev)
                        next.delete(trace.id)
                        return next
                      })
                    }}
                    onEnded={() => {
                      setPlayingMedia(prev => {
                        const next = new Set(prev)
                        next.delete(trace.id)
                        return next
                      })
                    }}
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
                  className={`flex flex-col items-center justify-center h-full w-full p-2 overflow-hidden ${inlineEditingTraceId === trace.id ? 'pointer-events-auto' : 'pointer-events-none select-none'}`}
                  style={{
                    clipPath: trace.cropWidth && trace.cropWidth < 1 
                      ? `inset(${(trace.cropY ?? 0) * 100}% ${(1 - (trace.cropX ?? 0) - (trace.cropWidth ?? 1)) * 100}% ${(1 - (trace.cropY ?? 0) - (trace.cropHeight ?? 1)) * 100}% ${(trace.cropX ?? 0) * 100}%)`
                      : undefined,
                  }}
                >
                  {inlineEditingTraceId === trace.id ? (
                    /* Inline editing textarea */
                    <textarea
                      autoFocus
                      value={inlineEditText}
                      onChange={(e) => setInlineEditText(e.target.value)}
                      onBlur={() => {
                        // Save changes on blur
                        if (inlineEditText !== trace.content) {
                          updateTraceCustomization(trace.id, { content: inlineEditText })
                        }
                        setInlineEditingTraceId(null)
                        setInlineEditText('')
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          // Cancel editing
                          setInlineEditingTraceId(null)
                          setInlineEditText('')
                        } else if (e.key === 'Enter' && !e.shiftKey) {
                          // Save on Enter (Shift+Enter for newline)
                          e.preventDefault()
                          if (inlineEditText !== trace.content) {
                            updateTraceCustomization(trace.id, { content: inlineEditText })
                          }
                          setInlineEditingTraceId(null)
                          setInlineEditText('')
                        }
                        e.stopPropagation()
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="w-full h-full bg-transparent resize-none outline-none border-2 border-white focus:border-gray-400"
                      style={{
                        fontSize:
                          typeof fontSize === 'number'
                            ? `${fontSize}px`
                            : fontSizeMap[fontSize as 'small' | 'medium' | 'large']
                              ? `calc(${fontSizeMap[fontSize as 'small' | 'medium' | 'large']} * ${Math.min(width / 120, height / 80)})`
                              : '14px',
                        fontFamily:
                          fontFamilyMap[fontFamily as 'sans' | 'serif' | 'mono']
                            ? fontFamilyMap[fontFamily as 'sans' | 'serif' | 'mono']
                            : fontFamily,
                        lineHeight: '1.2',
                        fontWeight: trace.textBold ? 'bold' : 'normal',
                        fontStyle: trace.textItalic ? 'italic' : 'normal',
                        textDecoration: trace.textUnderline ? 'underline' : 'none',
                        textAlign: trace.textAlign ?? 'center',
                        color: trace.textColor ?? '#ffffff',
                      }}
                    />
                  ) : (
                    /* Normal display */
                    <p 
                      className="w-full break-words"
                      style={{
                        fontSize:
                          typeof fontSize === 'number'
                            ? `${fontSize}px`
                            : fontSizeMap[fontSize as 'small' | 'medium' | 'large']
                              ? `calc(${fontSizeMap[fontSize as 'small' | 'medium' | 'large']} * ${Math.min(width / 120, height / 80)})`
                              : '14px',
                        fontFamily:
                          fontFamilyMap[fontFamily as 'sans' | 'serif' | 'mono']
                            ? fontFamilyMap[fontFamily as 'sans' | 'serif' | 'mono']
                            : fontFamily,
                        lineHeight: '1.2',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: Math.max(2, Math.floor(height / 20)),
                        WebkitBoxOrient: 'vertical',
                        fontWeight: trace.textBold ? 'bold' : 'normal',
                        fontStyle: trace.textItalic ? 'italic' : 'normal',
                        textDecoration: trace.textUnderline ? 'underline' : 'none',
                        textAlign: trace.textAlign ?? 'center',
                        color: trace.textColor ?? '#ffffff',
                      }}
                    >
                      {trace.content}
                    </p>
                  )}
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
                {/* Special handles for path shapes */}
                {(trace.type === 'shape' && trace.shapeType === 'path') ? (
                  <>
                    {/* Point handles for path - using world coordinates */}
                    {(() => {
                      const points = localShapePoints[trace.id] || displayTrace.shapePoints || []
                      return points.map((point, index) => {
                      // Convert world coordinates to screen coordinates
                      const { screenX, screenY } = getScreenPosition(point.x, point.y)
                      
                      const isPointSelected = selectedPointIndex === index
                      const isBezier = displayTrace.pathCurveType === 'bezier'
                      
                      return (
                        <Fragment key={`point-${index}`}>
                          {/* Main point handle */}
                          <div
                            data-trace-element="true"
                            className={`absolute w-4 h-4 border-2 border-black cursor-move pointer-events-auto z-10 hover:scale-125 transition-transform ${
                              isPointSelected ? 'bg-white' : 'bg-gray-400'
                            }`}
                            style={{
                              left: `${screenX}px`,
                              top: `${screenY}px`,
                              transform: 'translate(-50%, -50%)',
                            }}
                            onClick={(e) => {
                              e.stopPropagation() // Prevent background deselection
                            }}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              setSelectedPointIndex(index)
                              handleMouseDown(e, trace, 'point', `${index}`)
                            }}
                          />
                          
                          {/* Control point handles (only in bezier mode and when point is selected) */}
                          {isBezier && isPointSelected && (
                            <>
                              {(() => {
                                const cp1x = point.cp1x ?? point.x - 20
                                const cp1y = point.cp1y ?? point.y
                                const { screenX: cp1ScreenX, screenY: cp1ScreenY } = getScreenPosition(cp1x, cp1y)
                                
                                return (
                                  <>
                                    {/* Line from point to control handle */}
                                    <svg
                                      className="absolute pointer-events-none"
                                      style={{
                                        left: 0,
                                        top: 0,
                                        width: '100%',
                                        height: '100%',
                                        overflow: 'visible',
                                        zIndex: 9
                                      }}
                                    >
                                      <line
                                        x1={screenX}
                                        y1={screenY}
                                        x2={cp1ScreenX}
                                        y2={cp1ScreenY}
                                        stroke="#9ca3af"
                                        strokeWidth="1"
                                        strokeDasharray="4 2"
                                      />
                                    </svg>
                                    {/* Control handle */}
                                    <div
                                      data-trace-element="true"
                                      className="absolute w-3 h-3 bg-gray-300 border-2 border-black cursor-move pointer-events-auto z-10 hover:scale-125 transition-transform"
                                      style={{
                                        left: `${cp1ScreenX}px`,
                                        top: `${cp1ScreenY}px`,
                                        transform: 'translate(-50%, -50%)',
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation() // Prevent background deselection
                                      }}
                                      onMouseDown={(e) => {
                                        e.stopPropagation()
                                        e.preventDefault()
                                        setSelectedPointIndex(index) // Preserve point selection
                                        handleMouseDown(e, trace, 'control-in', `${index}`)
                                      }}
                                    />
                                  </>
                                )
                              })()}
                              
                              {/* Out-handle (cp2) */}
                              {(() => {
                                const cp2x = point.cp2x ?? point.x + 20
                                const cp2y = point.cp2y ?? point.y
                                const { screenX: cp2ScreenX, screenY: cp2ScreenY } = getScreenPosition(cp2x, cp2y)
                                
                                return (
                                  <>
                                    {/* Line from point to control handle */}
                                    <svg
                                      className="absolute pointer-events-none"
                                      style={{
                                        left: 0,
                                        top: 0,
                                        width: '100%',
                                        height: '100%',
                                        overflow: 'visible',
                                        zIndex: 9
                                      }}
                                    >
                                      <line
                                        x1={screenX}
                                        y1={screenY}
                                        x2={cp2ScreenX}
                                        y2={cp2ScreenY}
                                        stroke="#9ca3af"
                                        strokeWidth="1"
                                        strokeDasharray="4 2"
                                      />
                                    </svg>
                                    {/* Control handle */}
                                    <div
                                      data-trace-element="true"
                                      className="absolute w-3 h-3 bg-gray-300 border-2 border-black cursor-move pointer-events-auto z-10 hover:scale-125 transition-transform"
                                      style={{
                                        left: `${cp2ScreenX}px`,
                                        top: `${cp2ScreenY}px`,
                                        transform: 'translate(-50%, -50%)',
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation() // Prevent background deselection
                                      }}
                                      onMouseDown={(e) => {
                                        e.stopPropagation()
                                        e.preventDefault()
                                        setSelectedPointIndex(index) // Preserve point selection
                                        handleMouseDown(e, trace, 'control-out', `${index}`)
                                      }}
                                    />
                                  </>
                                )
                              })()}
                            </>
                          )}
                        </Fragment>
                      )
                    })
                    })()}
                    
                    {/* Move handle for entire path - centered on all points */}
                    {(() => {
                      const points = localShapePoints[trace.id] || trace.shapePoints || []
                      if (points.length === 0) return null
                      
                      // Calculate centroid
                      const sumX = points.reduce((sum, p) => sum + p.x, 0)
                      const sumY = points.reduce((sum, p) => sum + p.y, 0)
                      const centerX = sumX / points.length
                      const centerY = sumY / points.length
                      
                      const { screenX, screenY } = getScreenPosition(centerX, centerY)
                      
                      return (
                        <div
                          data-trace-element="true"
                          className="absolute w-6 h-6 border-2 border-white rounded-full cursor-move pointer-events-auto z-10 hover:scale-125 transition-transform bg-green-500"
                          style={{
                            left: `${screenX}px`,
                            top: `${screenY}px`,
                            transform: 'translate(-50%, -50%)',
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            setSelectedPointIndex(null)
                            handleMouseDown(e, trace, 'move-path', 'move-all')
                          }}
                        >
                          <div className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold">⊕</div>
                        </div>
                      )
                    })()}
                  </>
                ) : null}

                {/* Crop button for all trace types (not for path) */}
                {trace.type !== 'shape' || trace.shapeType !== 'path' ? (
                <button
                  data-trace-element="true"
                  className={`absolute text-xs font-bold px-3 py-1.5 border-2 shadow-lg pointer-events-auto z-10 transition-all hover:scale-110 ${
                    isCropMode 
                      ? 'bg-gray-600 border-gray-400 text-white hover:bg-gray-500' 
                      : 'bg-black border-white text-white hover:bg-gray-800'
                  }`}
                  style={{
                    left: `${screenX}px`,
                    top: `${screenY + (borderHeight / 2 + 30)}px`,
                    transform: 'translate(-50%, 0)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsCropMode(!isCropMode)
                    setTransformMode('none')
                  }}
                >
                  {isCropMode ? '✓ DONE' : '✂ CROP'}
                </button>
                ) : null}
              </>
            )}

            {/* Crop mode handles (only when crop mode is active) */}
            {isSelected && isCropMode && (
              <>
                {/* Crop area overlay - shows the crop boundaries */}
                <div
                  className="absolute pointer-events-auto cursor-pointer"
                  style={{
                    left: `${screenX - (width * (transform as any).scaleX * zoom / 2)}px`,
                    top: `${screenY - (height * (transform as any).scaleY * zoom / 2)}px`,
                    width: `${width * (transform as any).scaleX * zoom}px`,
                    height: `${height * (transform as any).scaleY * zoom}px`,
                    border: '2px dashed rgba(156, 163, 175, 0.9)',
                    boxShadow: 'inset 0 0 0 9999px rgba(0, 0, 0, 0.4)',
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsCropMode(false)
                    setTransformMode('none')
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
                      className="absolute w-4 h-4 bg-gray-400 border-2 border-black cursor-nwse-resize pointer-events-auto z-10"
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

        {/* Render path shapes as absolute SVG overlay */}
        {traces.filter(t => t.type === 'shape' && t.shapeType === 'path').map(trace => {
          // Use editingTrace if this is the trace being edited (for instant updates)
          const displayTrace = (editingTrace && editingTrace.id === trace.id) ? editingTrace : trace
          
          // Use local shape points during drag for instant feedback, otherwise use trace points
          const points = localShapePoints[displayTrace.id] || displayTrace.shapePoints || []
          if (points.length < 2) return null // Need at least 2 points to draw
          
          const curveType = displayTrace.pathCurveType || 'straight'
          const shapeColor = displayTrace.shapeColor || '#3b82f6'
          const shapeOpacity = displayTrace.shapeOpacity ?? 1.0
          const outlineWidth = displayTrace.shapeOutlineWidth ?? 2
          
          // Convert world coordinates to screen coordinates
          const screenPoints = points.map(p => {
            const { screenX, screenY } = getScreenPosition(p.x, p.y)
            const result: any = { x: screenX, y: screenY }
            if (p.cp1x !== undefined && p.cp1y !== undefined) {
              const cp1 = getScreenPosition(p.cp1x, p.cp1y)
              result.cp1x = cp1.screenX
              result.cp1y = cp1.screenY
            }
            if (p.cp2x !== undefined && p.cp2y !== undefined) {
              const cp2 = getScreenPosition(p.cp2x, p.cp2y)
              result.cp2x = cp2.screenX
              result.cp2y = cp2.screenY
            }
            return result
          })
          
          // Generate SVG path
          let pathData = ''
          if (curveType === 'bezier' && screenPoints.length >= 2) {
            pathData = `M ${screenPoints[0].x} ${screenPoints[0].y}`
            
            if (screenPoints.length === 2) {
              const p0 = screenPoints[0]
              const p1 = screenPoints[1]
              
              if (p0.cp2x !== undefined && p0.cp2y !== undefined) {
                const cp1x = p0.cp2x
                const cp1y = p0.cp2y
                const cp2x = p1.cp1x !== undefined ? p1.cp1x : cp1x
                const cp2y = p1.cp1y !== undefined ? p1.cp1y : cp1y
                pathData += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`
              } else {
                const midX = (p0.x + p1.x) / 2
                const midY = (p0.y + p1.y) / 2
                pathData += ` Q ${midX} ${midY}, ${p1.x} ${p1.y}`
              }
            } else {
              for (let i = 0; i < screenPoints.length - 1; i++) {
                const p0 = i > 0 ? screenPoints[i - 1] : screenPoints[i]
                const p1 = screenPoints[i]
                const p2 = screenPoints[i + 1]
                const p3 = i + 2 < screenPoints.length ? screenPoints[i + 2] : p2
                
                let cp1x, cp1y, cp2x, cp2y
                
                if (p1.cp2x !== undefined && p1.cp2y !== undefined) {
                  cp1x = p1.cp2x
                  cp1y = p1.cp2y
                } else {
                  const tension = 0.5
                  cp1x = p1.x + (p2.x - p0.x) / 6 * tension
                  cp1y = p1.y + (p2.y - p0.y) / 6 * tension
                }
                
                if (p2.cp1x !== undefined && p2.cp1y !== undefined) {
                  cp2x = p2.cp1x
                  cp2y = p2.cp1y
                } else {
                  const tension = 0.5
                  cp2x = p2.x - (p3.x - p1.x) / 6 * tension
                  cp2y = p2.y - (p3.y - p1.y) / 6 * tension
                }
                
                pathData += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`
              }
            }
          }
          
          return (
            <svg
              key={`path-${trace.id}`}
              className="absolute select-none"
              style={{
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                overflow: 'visible',
                zIndex: Math.min(trace.zIndex ?? 0, 40), // Cap at 40 to stay below handles (z-50)
                pointerEvents: 'none'
              }}
            >
              {curveType === 'bezier' ? (
                <>
                  {/* Invisible wider stroke for easier clicking */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={outlineWidth + 10}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedTraceId(trace.id)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSelectedTraceId(trace.id)
                      setContextMenu({ x: e.clientX, y: e.clientY, traceId: trace.id })
                    }}
                  />
                  {/* Visible path */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={shapeColor}
                    strokeWidth={outlineWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={shapeOpacity}
                    style={{ pointerEvents: 'none' }}
                  />
                </>
              ) : (
                <>
                  {/* Invisible wider stroke for easier clicking */}
                  <polyline
                    points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={outlineWidth + 10}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedTraceId(trace.id)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setSelectedTraceId(trace.id)
                      setContextMenu({ x: e.clientX, y: e.clientY, traceId: trace.id })
                    }}
                  />
                  {/* Visible path */}
                  <polyline
                    points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={shapeColor}
                    strokeWidth={outlineWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={shapeOpacity}
                    style={{ pointerEvents: 'none' }}
                  />
                </>
              )}
            </svg>
          )
        })}

        {/* Render path point handles as absolute overlay (only for selected path) */}
        {selectedTraceId && (() => {
          const trace = traces.find(t => t.id === selectedTraceId)
          if (!trace || trace.type !== 'shape' || trace.shapeType !== 'path') return null
          
          const displayTrace = (editingTrace && editingTrace.id === trace.id) ? editingTrace : trace
          const points = localShapePoints[trace.id] || displayTrace.shapePoints || []
          
          return (
            <>
              {/* Point handles */}
              {points.map((point, index) => {
                const { screenX, screenY } = getScreenPosition(point.x, point.y)
                const isPointSelected = selectedPointIndex === index
                const isBezier = displayTrace.pathCurveType === 'bezier'
                
                return (
                  <Fragment key={`handle-${index}`}>
                    {/* Main point handle */}
                    <div
                      data-trace-element="true"
                      className={`absolute w-4 h-4 border-2 border-black cursor-move pointer-events-auto z-[50] hover:scale-125 transition-transform ${
                        isPointSelected ? 'bg-white' : 'bg-gray-400'
                      }`}
                      style={{
                        left: `${screenX}px`,
                        top: `${screenY}px`,
                        transform: 'translate(-50%, -50%)',
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        setSelectedPointIndex(index)
                        handleMouseDown(e, trace, 'point', `${index}`)
                      }}
                    />
                    
                    {/* Bezier control handles (only when point is selected) */}
                    {isBezier && isPointSelected && (
                      <>
                        {/* In-handle (cp1) */}
                        {(() => {
                          const cp1x = point.cp1x ?? point.x - 20
                          const cp1y = point.cp1y ?? point.y
                          const { screenX: cp1ScreenX, screenY: cp1ScreenY } = getScreenPosition(cp1x, cp1y)
                          
                          return (
                            <>
                              <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 499 }}>
                                <line x1={screenX} y1={screenY} x2={cp1ScreenX} y2={cp1ScreenY} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 2" />
                              </svg>
                              <div
                                data-trace-element="true"
                                className="absolute w-3 h-3 bg-gray-300 border-2 border-black cursor-move pointer-events-auto z-[50] hover:scale-125 transition-transform"
                                style={{ left: `${cp1ScreenX}px`, top: `${cp1ScreenY}px`, transform: 'translate(-50%, -50%)' }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  setSelectedPointIndex(index)
                                  handleMouseDown(e, trace, 'control-in', `${index}`)
                                }}
                              />
                            </>
                          )
                        })()}
                        
                        {/* Out-handle (cp2) */}
                        {(() => {
                          const cp2x = point.cp2x ?? point.x + 20
                          const cp2y = point.cp2y ?? point.y
                          const { screenX: cp2ScreenX, screenY: cp2ScreenY } = getScreenPosition(cp2x, cp2y)
                          
                          return (
                            <>
                              <svg className="absolute pointer-events-none" style={{ left: 0, top: 0, width: '100%', height: '100%', zIndex: 499 }}>
                                <line x1={screenX} y1={screenY} x2={cp2ScreenX} y2={cp2ScreenY} stroke="#9ca3af" strokeWidth="1" strokeDasharray="4 2" />
                              </svg>
                              <div
                                data-trace-element="true"
                                className="absolute w-3 h-3 bg-gray-300 border-2 border-black cursor-move pointer-events-auto z-[50] hover:scale-125 transition-transform"
                                style={{ left: `${cp2ScreenX}px`, top: `${cp2ScreenY}px`, transform: 'translate(-50%, -50%)' }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => {
                                  e.stopPropagation()
                                  e.preventDefault()
                                  setSelectedPointIndex(index)
                                  handleMouseDown(e, trace, 'control-out', `${index}`)
                                }}
                              />
                            </>
                          )
                        })()}
                      </>
                    )}
                  </Fragment>
                )
              })}
              
              {/* Move handle - centered on all points */}
              {(() => {
                if (points.length === 0) return null
                const sumX = points.reduce((sum, p) => sum + p.x, 0)
                const sumY = points.reduce((sum, p) => sum + p.y, 0)
                const centerX = sumX / points.length
                const centerY = sumY / points.length
                const { screenX, screenY } = getScreenPosition(centerX, centerY)
                
                return (
                  <div
                    data-trace-element="true"
                    className="absolute w-6 h-6 border-2 border-black cursor-move pointer-events-auto z-[50] hover:scale-125 transition-transform bg-white"
                    style={{ left: `${screenX}px`, top: `${screenY}px`, transform: 'translate(-50%, -50%)' }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setSelectedPointIndex(null)
                      handleMouseDown(e, trace, 'move-path', 'move-all')
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold">⊕</div>
                  </div>
                )
              })()}
            </>
          )
        })()}

        {/* Render regular handles (corner, edge, rotation) as absolute overlay for non-path shapes */}
        {selectedTraceId && !isCropMode && (() => {
          const trace = traces.find(t => t.id === selectedTraceId)
          if (!trace || (trace.type === 'shape' && trace.shapeType === 'path')) return null
          
          const transform = localTraceTransforms[trace.id] || getTraceTransform(trace)
          const { screenX, screenY } = getScreenPosition(transform.x, transform.y)
          const { width, height } = getTraceSize(trace)
          
          // Get dimensions with scale and crop applied (same as in main trace rendering)
          const cropWidth = trace.cropWidth ?? 1
          const cropHeight = trace.cropHeight ?? 1
          
          const shapeWidth = trace.type === 'shape' ? (trace.width || 200) : width
          const shapeHeight = trace.type === 'shape' ? (trace.height || 200) : height
          const borderWidth = (trace.type === 'shape' ? shapeWidth : width * cropWidth) * (transform as any).scaleX * zoom
          const borderHeight = (trace.type === 'shape' ? shapeHeight : height * cropHeight) * (transform as any).scaleY * zoom
          
          return (
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
                    className="absolute w-3 h-3 bg-white border-2 border-black cursor-nwse-resize pointer-events-auto z-[50]"
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
                    className={`absolute w-3 h-3 bg-gray-400 border-2 border-black pointer-events-auto z-[50] ${cursorClass}`}
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
                className="absolute w-3 h-3 bg-gray-600 border-2 border-white cursor-grab pointer-events-auto z-[50]"
                style={{
                  left: `${screenX}px`,
                  top: `${screenY - (borderHeight / 2 + 20)}px`,
                  transform: 'translate(-50%, -50%)',
                }}
                onMouseDown={(e) => handleMouseDown(e, trace, 'rotate')}
              />
            </>
          )
        })()}

        {/* Render other users' cursors */}
        {Object.entries(otherUsers).map(([odUserId, user]) => {
          const userScreenX = user.x * zoom + worldOffset.x
          const userScreenY = user.y * zoom + worldOffset.y
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
              key={`other-user-${odUserId}`}
              style={{
                position: 'absolute',
                left: userScreenX,
                top: userScreenY,
                pointerEvents: 'none',
                transition: 'left 0.15s ease-out, top 0.15s ease-out',
                filter: `drop-shadow(0 0 6px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5))`,
                zIndex: 999,
              }}
            >
              {/* Cursor pointer SVG */}
              <svg
                width={20 * zoom}
                height={20 * zoom}
                viewBox="0 0 24 24"
                style={{ 
                  transform: 'translate(-2px, -2px)',
                  filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.5))`,
                }}
              >
                <path
                  d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.86a.5.5 0 0 0-.85.35z"
                  fill={userColor}
                  stroke="white"
                  strokeWidth="1.5"
                />
              </svg>
              {/* User label */}
              <div
                style={{
                  position: 'absolute',
                  top: 16 * zoom,
                  left: 10 * zoom,
                  color: userColor,
                  fontSize: `${10 * zoom}px`,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  textShadow: `0 0 6px rgba(${rgb.r},${rgb.g},${rgb.b},0.4), 0 2px 4px rgba(0,0,0,0.8)`,
                  letterSpacing: '0.5px',
                  background: 'rgba(0,0,0,0.6)',
                  padding: '2px 5px',
                  borderRadius: '3px',
                }}
              >
                {user.username}
              </div>
            </div>
          )
        })}

      {/* Context Menu */}
      {contextMenu && (
        <>
          {/* Menu */}
          <div
            className="fixed bg-black border border-gray-500 shadow-2xl py-1 z-[200] pointer-events-auto max-h-[80vh] overflow-y-auto"
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-3 h-3 border-l border-t border-gray-400 pointer-events-none" />
            <div className="absolute top-0 right-0 w-3 h-3 border-r border-t border-gray-400 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-l border-b border-gray-400 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-r border-b border-gray-400 pointer-events-none" />
            
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) setEditingTrace(trace)
                setContextMenu(null)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> Customize
            </button>
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceCustomization(trace.id, { isLocked: !trace.isLocked })
                }
                setContextMenu(null)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> {traces.find(t => t.id === contextMenu.traceId)?.isLocked ? 'Unlock' : 'Lock'}
            </button>
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceCustomization(trace.id, { ignoreClicks: !trace.ignoreClicks })
                }
                setContextMenu(null)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> {traces.find(t => t.id === contextMenu.traceId)?.ignoreClicks ? 'Enable Clicks' : 'Ignore Clicks'}
            </button>
            <div className="h-[1px] bg-gradient-to-r from-transparent via-gray-600 to-transparent my-1" />
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={async () => {
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
              <span className="text-gray-400 text-[10px]">◇</span> Reset Cropping
            </button>
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={async () => {
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
              <span className="text-gray-400 text-[10px]">◇</span> Reset Aspect Ratio
            </button>
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={async () => {
                const trace = traces.find(t => t.id === contextMenu.traceId)
                if (trace) {
                  updateTraceTransform(trace.id, { rotation: 0 })
                }
                setContextMenu(null)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> Reset Rotation
            </button>
            <div className="h-[1px] bg-gradient-to-r from-transparent via-gray-600 to-transparent my-1" />
            <button
              className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                duplicateTrace(contextMenu.traceId)
              }}
            >
              <span className="text-gray-400 text-[10px]">◇</span> Duplicate
            </button>
            <button
              className="w-full px-4 py-2 text-left text-red-400 hover:bg-red-900/30 transition-colors flex items-center gap-3 text-[11px] tracking-wider uppercase"
              onClick={() => {
                deleteTrace(contextMenu.traceId)
              }}
            >
              <span className="text-red-500 text-[10px]">◇</span> Delete
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
            className="customize-menu bg-black border border-gray-500 p-6 w-96 pointer-events-auto max-h-[90vh] overflow-y-auto relative"
            style={{ 
              position: 'fixed',
              right: '20px',
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 300
            }}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-gray-400 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-gray-400 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-gray-400 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-gray-400 pointer-events-none" />
            
            <div className="flex items-center gap-3 mb-6">
              <div className="w-1.5 h-1.5 rotate-45 border border-gray-400" />
              <h2 className="text-lg text-white tracking-[0.15em] uppercase">Customize Trace</h2>
            </div>
            
            <div className="space-y-5">
              {/* Toggle Options */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 text-white text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showBorder ?? true ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                    {(editingTrace.showBorder ?? true) && <span className="text-black text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showBorder ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showBorder: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showBorder: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-wider uppercase text-[10px]">Show Border</span>
                </label>

                <label className="flex items-center gap-3 text-white text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showBackground ?? true ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                    {(editingTrace.showBackground ?? true) && <span className="text-black text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showBackground ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showBackground: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showBackground: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-wider uppercase text-[10px]">Show Background</span>
                </label>

                <label className="flex items-center gap-3 text-white text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showDescription ?? true ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                    {(editingTrace.showDescription ?? true) && <span className="text-black text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showDescription ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showDescription: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showDescription: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-wider uppercase text-[10px]">Show Description</span>
                </label>

                <label className="flex items-center gap-3 text-white text-xs cursor-pointer group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.showFilename ?? true ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                    {(editingTrace.showFilename ?? true) && <span className="text-black text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.showFilename ?? true}
                    onChange={(e) => {
                      const updated = { ...editingTrace, showFilename: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { showFilename: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-wider uppercase text-[10px]">Show Username</span>
                </label>
              </div>

              {/* Font Settings for Text Traces */}
              {editingTrace.type === 'text' && (
                <>
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Text Content</label>
                    <textarea
                      value={editingTrace.content ?? ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, content: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { content: e.target.value })
                      }}
                      className="w-full bg-gray-900 text-white border border-gray-600 px-3 py-2 font-mono text-sm focus:outline-none focus:border-gray-400"
                      placeholder="Your message..."
                      rows={4}
                      maxLength={200}
                    />
                  </div>

                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Font Size (px)</label>
                    <input
                      type="number"
                      min={8}
                      max={200}
                      value={typeof editingTrace.fontSize === 'number' ? editingTrace.fontSize : (editingTrace.fontSize === 'small' ? 12 : editingTrace.fontSize === 'large' ? 24 : 16)}
                      onChange={e => {
                        const value = parseInt(e.target.value) || 16;
                        const updated = { ...editingTrace, fontSize: value };
                        setEditingTrace(updated);
                        // Update trace in store for live preview and mark as pending
                        const trace = traces.find(t => t.id === editingTrace.id);
                        if (trace) {
                          addTrace({ ...trace, fontSize: value });
                          markTraceChanged(editingTrace.id);
                        }
                      }}
                      className="w-full bg-gray-900 text-white border border-gray-600 px-3 py-2 font-mono text-sm focus:outline-none focus:border-gray-400"
                      placeholder="Font size in px"
                    />
                  </div>

                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Font Family</label>
                    <select
                      value={editingTrace.fontFamily ?? 'sans'}
                      onChange={e => {
                        const updated = { ...editingTrace, fontFamily: e.target.value };
                        setEditingTrace(updated);
                        updateTraceCustomization(editingTrace.id, { fontFamily: e.target.value });
                      }}
                      className="w-full bg-gray-900 text-white border border-gray-600 px-3 py-2 font-mono text-sm focus:outline-none focus:border-gray-400"
                    >
                      <option value="sans">Sans-serif</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Monospace</option>
                      <option value="palatino">Palatino</option>
                      <option value="garamond">Garamond</option>
                      <option value="comic">Comic Sans MS</option>
                      <option value="impact">Impact</option>
                      <option value="cursive">Cursive</option>
                      <option value="fantasy">Fantasy</option>
                      <option value="system-ui">System UI</option>
                      {customFonts.map(fontFile => {
                        const fontName = fontFile.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
                        return <option key={fontName} value={fontName}>{fontName} (Custom)</option>;
                      })}
                    </select>
                  </div>

                  {/* Text Formatting */}
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Text Style</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          const updated = { ...editingTrace, textBold: !editingTrace.textBold };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textBold: !editingTrace.textBold });
                        }}
                        className={`flex-1 px-3 py-2 font-bold text-sm border transition-colors ${
                          editingTrace.textBold
                            ? 'bg-white text-black border-white'
                            : 'bg-gray-900 text-white border-gray-600 hover:border-gray-400'
                        }`}
                      >
                        B
                      </button>
                      <button
                        onClick={() => {
                          const updated = { ...editingTrace, textItalic: !editingTrace.textItalic };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textItalic: !editingTrace.textItalic });
                        }}
                        className={`flex-1 px-3 py-2 italic text-sm border transition-colors ${
                          editingTrace.textItalic
                            ? 'bg-white text-black border-white'
                            : 'bg-gray-900 text-white border-gray-600 hover:border-gray-400'
                        }`}
                      >
                        I
                      </button>
                      <button
                        onClick={() => {
                          const updated = { ...editingTrace, textUnderline: !editingTrace.textUnderline };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textUnderline: !editingTrace.textUnderline });
                        }}
                        className={`flex-1 px-3 py-2 underline text-sm border transition-colors ${
                          editingTrace.textUnderline
                            ? 'bg-white text-black border-white'
                            : 'bg-gray-900 text-white border-gray-600 hover:border-gray-400'
                        }`}
                      >
                        U
                      </button>
                    </div>
                  </div>

                  {/* Text Alignment */}
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Text Alignment</label>
                    <div className="flex gap-2">
                      {(['left', 'center', 'right', 'justify'] as const).map((align) => (
                        <button
                          key={align}
                          onClick={() => {
                            const updated = { ...editingTrace, textAlign: align };
                            setEditingTrace(updated);
                            updateTraceCustomization(editingTrace.id, { textAlign: align });
                          }}
                          className={`flex-1 px-2 py-2 text-xs border transition-colors ${
                            (editingTrace.textAlign ?? 'center') === align
                              ? 'bg-white text-black border-white'
                              : 'bg-gray-900 text-white border-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {align === 'left' && '◀'}
                          {align === 'center' && '◆'}
                          {align === 'right' && '▶'}
                          {align === 'justify' && '▣'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Color */}
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Text Color</label>
                    <div className="flex gap-2 items-center">
                      <input
                        type="color"
                        value={editingTrace.textColor ?? '#ffffff'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, textColor: e.target.value };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textColor: e.target.value });
                        }}
                        className="w-10 h-10 border border-gray-600 cursor-pointer bg-transparent"
                      />
                      <input
                        type="text"
                        value={editingTrace.textColor ?? '#ffffff'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, textColor: e.target.value };
                          setEditingTrace(updated);
                        }}
                        onBlur={(e) => {
                          updateTraceCustomization(editingTrace.id, { textColor: e.target.value });
                        }}
                        className="flex-1 bg-gray-900 text-white border border-gray-600 px-3 py-2 font-mono text-sm focus:outline-none focus:border-gray-400"
                        placeholder="#ffffff"
                      />
                      <button
                        onClick={() => {
                          const updated = { ...editingTrace, textColor: '#ffffff' };
                          setEditingTrace(updated);
                          updateTraceCustomization(editingTrace.id, { textColor: '#ffffff' });
                        }}
                        className="px-3 py-2 bg-gray-900 text-white border border-gray-600 hover:border-gray-400 text-xs"
                        title="Reset to white"
                      >
                        ↺
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Border Radius Customization (for non-shape traces) */}
              {editingTrace.type !== 'shape' && (
                <div>
                  <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">
                    Border Radius: {editingTrace.borderRadius ?? 8}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="50"
                    step="1"
                    value={editingTrace.borderRadius ?? 8}
                    onChange={(e) => {
                      const value = parseInt(e.target.value)
                      const updated = { ...editingTrace, borderRadius: value }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { borderRadius: value })
                    }}
                    className="w-full accent-white"
                  />
                  <p className="text-gray-400 text-[9px] mt-1 tracking-wider">
                    Adjust the roundness of trace borders (0 = sharp corners)
                  </p>
                </div>
              )}

              {/* Description/Caption for Media Traces */}
              {(editingTrace.type === 'image' || editingTrace.type === 'audio' || editingTrace.type === 'video') && (
                <div>
                  <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Description / Caption</label>
                  <textarea
                    value={editingTrace.content ?? ''}
                    onChange={(e) => {
                      const updated = { ...editingTrace, content: e.target.value }
                      setEditingTrace(updated)
                    }}
                    onBlur={(e) => {
                      updateTraceCustomization(editingTrace.id, { content: e.target.value })
                    }}
                    className="w-full bg-gray-900 text-white border border-gray-600 px-3 py-2 font-mono text-sm focus:outline-none focus:border-gray-400"
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
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Embed URL or HTML</label>
                    <textarea
                      value={editingTrace.mediaUrl ?? ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, mediaUrl: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { mediaUrl: e.target.value })
                      }}
                      className="w-full bg-gray-900 text-white border border-gray-600 px-3 py-2 font-mono text-sm focus:outline-none focus:border-gray-400"
                      placeholder="URL or <iframe src='...'></iframe>"
                      rows={4}
                    />
                    <p className="text-gray-400 text-[9px] mt-1 tracking-wider">
                      Direct URL or full embed code
                    </p>
                  </div>

                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Description / Title</label>
                    <textarea
                      value={editingTrace.content ?? ''}
                      onChange={(e) => {
                        const updated = { ...editingTrace, content: e.target.value }
                        setEditingTrace(updated)
                      }}
                      onBlur={(e) => {
                        updateTraceCustomization(editingTrace.id, { content: e.target.value })
                      }}
                      className="w-full bg-gray-900 text-white border border-gray-600 px-3 py-2 font-mono text-sm focus:outline-none focus:border-gray-400"
                      placeholder="Optional description..."
                      rows={3}
                      maxLength={200}
                    />
                  </div>

                  <label className="flex items-center gap-3 text-white text-xs cursor-pointer mt-3 group">
                    <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.enableInteraction ?? false ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                      {(editingTrace.enableInteraction ?? false) && <span className="text-black text-[10px]">✓</span>}
                    </div>
                    <input
                      type="checkbox"
                      checked={editingTrace.enableInteraction ?? false}
                      onChange={(e) => {
                        const updated = { ...editingTrace, enableInteraction: e.target.checked }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { enableInteraction: e.target.checked })
                      }}
                      className="hidden"
                    />
                    <span className="tracking-wider uppercase text-[10px]">Enable Interaction</span>
                  </label>
                </>
              )}

              {/* Shape Customization */}
              {editingTrace.type === 'shape' && (
                <div className="space-y-4">
                  {/* Shape Type */}
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Shape Type</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['rectangle', 'circle', 'triangle', 'path'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, shapeType: type }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeType: type })
                          }}
                          className={`px-3 py-2 text-[10px] tracking-wider uppercase font-mono transition-all border ${
                            (editingTrace.shapeType || 'rectangle') === type
                              ? 'bg-white text-black border-white'
                              : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400 hover:text-white'
                          }`}
                        >
                          {type === 'rectangle' && '⬛ '}
                          {type === 'circle' && '⚫ '}
                          {type === 'triangle' && '▲ '}
                          {type === 'path' && '〰 '}
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Color Picker */}
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Fill Color</label>
                    
                    {/* Color preset palette */}
                    <div className="grid grid-cols-8 gap-1.5 mb-3">
                      {['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
                        '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
                        '#f43f5e', '#ffffff', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#000000'].map(color => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, shapeColor: color }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeColor: color })
                          }}
                          className="w-7 h-7 border border-gray-600 hover:border-white transition-all hover:scale-110"
                          style={{ backgroundColor: color }}
                          title={color}
                        />
                      ))}
                    </div>
                    
                    <div className="flex gap-2 items-center">
                      {/* Eyedropper button */}
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          
                          if (!hasEyeDropperSupport) {
                            alert('The color picker tool is not supported in this browser.\n\nPlease use Chrome, Edge, or another Chromium-based browser to use this feature.')
                            return
                          }
                          
                          try {
                            const eyeDropper = new (window as any).EyeDropper()
                            const result = await eyeDropper.open()
                            const color = result.sRGBHex
                            const updated = { ...editingTrace, shapeColor: color }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeColor: color })
                          } catch (err) {
                            // User cancelled or error - silently ignore
                          }
                        }}
                        className="p-2 border transition-all bg-gray-900 border-gray-600 text-white hover:border-gray-400"
                        title="Pick color from screen"
                      >
                        💧
                      </button>
                      
                      <input
                        type="color"
                        value={editingTrace.shapeColor || '#3b82f6'}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeColor: e.target.value }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { shapeColor: e.target.value })
                        }}
                        className="w-14 h-9 cursor-pointer bg-gray-900 border border-gray-600"
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
                        className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 transition-colors font-mono text-sm"
                      />
                    </div>
                  </div>

                  {/* Opacity Slider */}
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">
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
                      className="w-full accent-white"
                    />
                  </div>

                  {/* Outline and Fill Options */}
                  <div className="space-y-2">
                    <label className="flex items-center gap-3 text-white text-xs cursor-pointer group">
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.shapeOutlineOnly ?? false ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                        {(editingTrace.shapeOutlineOnly ?? false) && <span className="text-black text-[10px]">✓</span>}
                      </div>
                      <input
                        type="checkbox"
                        checked={editingTrace.shapeOutlineOnly ?? false}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeOutlineOnly: e.target.checked }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { shapeOutlineOnly: e.target.checked })
                        }}
                        className="hidden"
                      />
                      <span className="tracking-wider uppercase text-[10px]">Show Outline</span>
                    </label>

                    <label className="flex items-center gap-3 text-white text-xs cursor-pointer group">
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.shapeNoFill ?? false ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                        {(editingTrace.shapeNoFill ?? false) && <span className="text-black text-[10px]">✓</span>}
                      </div>
                      <input
                        type="checkbox"
                        checked={editingTrace.shapeNoFill ?? false}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeNoFill: e.target.checked }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { shapeNoFill: e.target.checked })
                        }}
                        className="w-4 h-4"
                      />
                      <span className="tracking-wider uppercase text-[10px]">No Fill</span>
                    </label>
                  </div>

                  {/* Outline Color (only show if outline is enabled) */}
                  {editingTrace.shapeOutlineOnly && (
                    <div>
                      <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Outline Color</label>
                      
                      {/* Color preset palette */}
                      <div className="grid grid-cols-8 gap-1.5 mb-3">
                        {['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6',
                          '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
                          '#f43f5e', '#ffffff', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#000000'].map(color => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => {
                              const updated = { ...editingTrace, shapeOutlineColor: color }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { shapeOutlineColor: color })
                            }}
                            className="w-7 h-7 border border-gray-600 hover:border-white transition-all hover:scale-110"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ))}
                      </div>
                      
                      <div className="flex gap-2 items-center">
                        {/* Eyedropper button */}
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            
                            if (!hasEyeDropperSupport) {
                              alert('The color picker tool is not supported in this browser.\n\nPlease use Chrome, Edge, or another Chromium-based browser to use this feature.')
                              return
                            }
                            
                            try {
                              const eyeDropper = new (window as any).EyeDropper()
                              const result = await eyeDropper.open()
                              const color = result.sRGBHex
                              const updated = { ...editingTrace, shapeOutlineColor: color }
                              setEditingTrace(updated)
                              updateTraceCustomization(editingTrace.id, { shapeOutlineColor: color })
                            } catch (err) {
                              // User cancelled or error - silently ignore
                            }
                          }}
                          className="p-2 border transition-all bg-gray-900 border-gray-600 text-white hover:border-gray-400"
                          title="Pick color from screen"
                        >
                          💧
                        </button>
                        
                        <input
                          type="color"
                          value={editingTrace.shapeOutlineColor || editingTrace.shapeColor || '#3b82f6'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, shapeOutlineColor: e.target.value }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeOutlineColor: e.target.value })
                          }}
                          className="w-14 h-9 cursor-pointer bg-gray-900 border border-gray-600"
                        />
                        <input
                          type="text"
                          value={editingTrace.shapeOutlineColor || editingTrace.shapeColor || '#3b82f6'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, shapeOutlineColor: e.target.value }
                            setEditingTrace(updated)
                          }}
                          onBlur={(e) => {
                            updateTraceCustomization(editingTrace.id, { shapeOutlineColor: e.target.value })
                          }}
                          placeholder="#3b82f6"
                          className="flex-1 px-3 py-2 bg-gray-900 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 transition-colors font-mono text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {/* Corner Radius (Rectangle only) */}
                  {(editingTrace.shapeType || 'rectangle') === 'rectangle' && (
                    <div>
                      <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">
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
                        className="w-full accent-white"
                      />
                      <p className="text-gray-400 text-[9px] mt-1 tracking-wider">
                        Rounds the corners of the rectangle
                      </p>
                    </div>
                  )}

                  {/* Outline Mode (hidden for path as it's always outline) */}
                  {editingTrace.shapeType !== 'path' && (
                  <div>
                    <label className="flex items-center gap-3 text-white text-xs cursor-pointer mb-2 group">
                      <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.shapeOutlineOnly ?? false ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                        {(editingTrace.shapeOutlineOnly ?? false) && <span className="text-black text-[10px]">✓</span>}
                      </div>
                      <input
                        type="checkbox"
                        checked={editingTrace.shapeOutlineOnly ?? false}
                        onChange={(e) => {
                          const updated = { ...editingTrace, shapeOutlineOnly: e.target.checked }
                          setEditingTrace(updated)
                          updateTraceCustomization(editingTrace.id, { shapeOutlineOnly: e.target.checked })
                        }}
                        className="hidden"
                      />
                      <span className="tracking-wider uppercase text-[10px]">Outline Only (No Fill)</span>
                    </label>
                    
                    {editingTrace.shapeOutlineOnly && (
                      <div className="ml-6">
                        <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">
                          Outline Width: {editingTrace.shapeOutlineWidth ?? 2}px
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="20"
                          step="1"
                          value={editingTrace.shapeOutlineWidth ?? 2}
                          onChange={(e) => {
                            const value = parseInt(e.target.value)
                            const updated = { ...editingTrace, shapeOutlineWidth: value }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapeOutlineWidth: value })
                          }}
                          className="w-full"
                        />
                        <p className="text-gray-400 text-[9px] mt-1 tracking-wider">
                          Adjust the thickness of the outline
                        </p>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Path Thickness Control */}
                  {editingTrace.shapeType === 'path' && (
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">
                      Path Thickness: {editingTrace.shapeOutlineWidth ?? 2}px
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="20"
                      step="1"
                      value={editingTrace.shapeOutlineWidth ?? 2}
                      onChange={(e) => {
                        const value = parseInt(e.target.value)
                        const updated = { ...editingTrace, shapeOutlineWidth: value }
                        setEditingTrace(updated)
                        updateTraceCustomization(editingTrace.id, { shapeOutlineWidth: value })
                      }}
                      className="w-full accent-white"
                    />
                    <p className="text-gray-400 text-[9px] mt-1 tracking-wider">
                      Adjust the thickness of the path
                    </p>
                  </div>
                  )}

                  {/* Path Point Editing */}
                  {editingTrace.shapeType === 'path' && (
                  <>
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Path Style</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['straight', 'bezier'] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            const updated = { ...editingTrace, pathCurveType: type }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { pathCurveType: type })
                          }}
                          className={`px-3 py-2 text-[10px] tracking-wider uppercase font-mono transition-all border ${
                            (editingTrace.pathCurveType || 'straight') === type
                              ? 'bg-white text-black border-white'
                              : 'bg-transparent text-gray-400 border-gray-600 hover:border-gray-400 hover:text-white'
                          }`}
                        >
                          {type === 'straight' && '━ Straight'}
                          {type === 'bezier' && '〰 Curved'}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">
                      Path Points ({(editingTrace.shapePoints || []).length})
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPathCreationMode(!pathCreationMode)
                        }}
                        className={`flex-1 px-4 py-2 font-mono text-[10px] tracking-wider uppercase transition-all border ${
                          pathCreationMode
                            ? 'bg-white text-black border-white'
                            : 'bg-transparent text-white border-gray-600 hover:border-gray-400'
                        }`}
                      >
                        {pathCreationMode ? '✓ Done Adding' : '+ Add Points'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const currentPoints = editingTrace.shapePoints || []
                          if (currentPoints.length > 2) {
                            const newPoints = currentPoints.slice(0, -1)
                            const updated = { ...editingTrace, shapePoints: newPoints }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { shapePoints: newPoints })
                          }
                        }}
                        className="px-4 py-2 bg-red-600/80 text-white font-mono text-[10px] tracking-wider uppercase hover:bg-red-600 transition-all border border-red-600"
                      >
                        Remove
                      </button>
                    </div>
                    <p className="text-gray-400 text-[9px] mt-2 tracking-wider">
                      {pathCreationMode 
                        ? 'Click anywhere on the canvas to add points to your path' 
                        : 'Click "Add Points" to start adding points, or drag existing points to adjust'}
                    </p>
                  </div>
                  </>
                  )}

                  {/* Shape Label */}
                  <div>
                    <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Label (optional)</label>
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
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:border-gray-400 transition-colors font-mono text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Lighting Controls */}
              <div className="border-t border-gray-600 pt-4 mt-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-1.5 h-1.5 rotate-45 border border-gray-400" />
                  <h3 className="text-white text-[10px] tracking-[0.15em] uppercase">Lighting</h3>
                </div>
                
                <label className="flex items-center gap-3 text-white text-xs cursor-pointer mb-3 group">
                  <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.illuminate ?? false ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                    {(editingTrace.illuminate ?? false) && <span className="text-black text-[10px]">✓</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={editingTrace.illuminate ?? false}
                    onChange={(e) => {
                      const updated = { ...editingTrace, illuminate: e.target.checked }
                      setEditingTrace(updated)
                      updateTraceCustomization(editingTrace.id, { illuminate: e.target.checked })
                    }}
                    className="hidden"
                  />
                  <span className="tracking-wider uppercase text-[10px]">Enable Light Emission</span>
                </label>

                {editingTrace.illuminate && (
                  <div className="space-y-3 ml-6">
                    <div>
                      <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Light Color</label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="color"
                          value={editingTrace.lightColor ?? '#ffffff'}
                          onChange={(e) => {
                            const updated = { ...editingTrace, lightColor: e.target.value }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { lightColor: e.target.value })
                          }}
                          className="w-12 h-9 cursor-pointer bg-gray-900 border border-gray-600"
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
                          className="flex-1 bg-gray-900 text-white border border-gray-600 px-3 py-2 font-mono text-sm focus:outline-none focus:border-gray-400"
                          placeholder="#ffffff"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">
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
                        className="w-full accent-white"
                      />
                    </div>

                    <div>
                      <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">
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
                        className="w-full accent-white"
                      />
                    </div>

                    <div>
                      <label className="block text-white text-[10px] tracking-[0.15em] uppercase mb-2">Light Position Offset</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-gray-400 text-[9px] tracking-wider mb-1">X: {editingTrace.lightOffsetX ?? 0}px</label>
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
                            className="w-full accent-white"
                          />
                        </div>
                        <div>
                          <label className="block text-gray-400 text-[9px] tracking-wider mb-1">Y: {editingTrace.lightOffsetY ?? 0}px</label>
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
                            className="w-full accent-white"
                          />
                        </div>
                      </div>
                      <p className="text-gray-400 text-[9px] mt-1 tracking-wider">
                        Adjust light source position relative to trace center
                      </p>
                    </div>

                    <div>
                      <label className="flex items-center gap-3 text-white text-xs cursor-pointer mb-2 group">
                        <div className={`w-4 h-4 border flex items-center justify-center transition-colors ${editingTrace.lightPulse ?? false ? 'border-white bg-white' : 'border-gray-600 group-hover:border-gray-400'}`}>
                          {(editingTrace.lightPulse ?? false) && <span className="text-black text-[10px]">✓</span>}
                        </div>
                        <input
                          type="checkbox"
                          checked={editingTrace.lightPulse ?? false}
                          onChange={(e) => {
                            const updated = { ...editingTrace, lightPulse: e.target.checked }
                            setEditingTrace(updated)
                            updateTraceCustomization(editingTrace.id, { lightPulse: e.target.checked })
                          }}
                          className="hidden"
                        />
                        <span className="tracking-wider uppercase text-[10px]">Enable Pulsing/Flickering</span>
                      </label>
                      
                      {editingTrace.lightPulse && (
                        <div className="ml-6">
                          <label className="block text-gray-400 text-[9px] tracking-wider mb-1">
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
                            className="w-full accent-white"
                          />
                          <p className="text-gray-400 text-[9px] mt-1 tracking-wider">
                            Lower = faster pulse, Higher = slower pulse
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  // Mark as pending if there were any changes
                  if (editingTrace) {
                    markTraceChanged(editingTrace.id);
                  }
                  setEditingTrace(null);
                }}
                className="w-full bg-white text-black font-mono text-[11px] tracking-[0.15em] uppercase py-2.5 px-4 hover:bg-gray-200 transition-all border border-white mt-4"
              >
                Done
              </button>
            </div>
          </div>

          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-transparent pointer-events-auto"
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
            className="bg-gray-900 border p-6 max-w-3xl max-h-[80vh] overflow-auto relative"
            style={{ borderColor: getBorderColor(modalTrace.type) }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-gray-500 pointer-events-none" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-gray-500 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-gray-500 pointer-events-none" />
            
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <div className="w-1.5 h-1.5 rotate-45 border border-gray-500" />
                <h2 className="text-white text-sm tracking-[0.15em] uppercase font-mono">
                  {modalTrace.type === 'text' && 'Text Trace'}
                  {modalTrace.type === 'image' && 'Image Trace'}
                  {modalTrace.type === 'audio' && 'Audio Trace'}
                  {modalTrace.type === 'video' && 'Video Trace'}
                  {modalTrace.type === 'embed' && 'Embedded Content'}
                </h2>
              </div>
              <button
                onClick={() => setModalTrace(null)}
                className="text-gray-400 hover:text-white text-lg transition-colors"
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
                  className="w-full max-h-96 object-contain"
                />
              )}

              {modalTrace.type === 'video' && modalTrace.mediaUrl && (
                <video
                  src={modalTrace.mediaUrl}
                  controls
                  autoPlay
                  className="w-full max-h-96"
                />
              )}

              {modalTrace.type === 'audio' && modalTrace.mediaUrl && (
                <div className="flex flex-col items-center p-8 bg-gray-800/50">
                  <span className="text-6xl mb-4">🎵</span>
                  <audio src={modalTrace.mediaUrl} controls autoPlay className="w-full" />
                </div>
              )}

              {modalTrace.type === 'embed' && modalTrace.mediaUrl && (() => {
                const embedUrl = extractEmbedUrl(modalTrace.mediaUrl)
                if (!embedUrl) {
                  return (
                    <div className="w-full h-96 flex items-center justify-center bg-gray-800/50">
                      <p className="text-gray-400 text-sm tracking-wider">Invalid embed code</p>
                    </div>
                  )
                }
                return (
                  <iframe
                    src={embedUrl}
                    className="w-full h-96"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                )
              })()}

              {modalTrace.type === 'text' && (
                <div className="bg-gray-800/50 p-6">
                  <p className="text-white text-lg whitespace-pre-wrap font-mono">
                    {modalTrace.content}
                  </p>
                </div>
              )}
            </div>

            {/* Caption/Description */}
            {modalTrace.content && modalTrace.type !== 'text' && (
              <div className="mb-4">
                <p className="text-gray-400 text-sm italic">
                  "{modalTrace.content}"
                </p>
              </div>
            )}

            {/* Metadata */}
            <div className="flex justify-between items-center text-[10px] text-gray-400 tracking-wider uppercase font-mono">
              <span>@{modalTrace.username}</span>
              <span>
                ({Math.round(modalTrace.x)}, {Math.round(modalTrace.y)})
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
          position={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmDialog && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[250] pointer-events-auto"
          onClick={() => setDeleteConfirmDialog(null)}
        >
          {/* Scanline overlay */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
            style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
            }}
          />
          
          <div
            className="bg-gray-900 border border-red-500/40 p-6 max-w-md w-full mx-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-4 h-4 border-l border-t border-red-500/60" />
            <div className="absolute top-0 right-0 w-4 h-4 border-r border-t border-red-500/60" />
            <div className="absolute bottom-0 left-0 w-4 h-4 border-l border-b border-red-500/60" />
            <div className="absolute bottom-0 right-0 w-4 h-4 border-r border-b border-red-500/60" />
            
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1.5 h-1.5 rotate-45 border border-red-500/60" />
              <h2 className="text-lg text-red-400 tracking-[0.15em] uppercase">Delete Trace</h2>
            </div>
            <p className="text-white mb-6 text-sm tracking-wide">
              Are you sure you want to delete this trace? This action cannot be undone.
            </p>
            <p className="text-gray-400 text-[10px] tracking-wider uppercase mb-6">
              ◇ Tip: Press <kbd className="px-2 py-1 bg-gray-800 border border-gray-600 text-gray-300 text-[9px] tracking-wider">Delete</kbd> key for quick deletion
            </p>
            
            <label className="flex items-center gap-3 text-gray-400 text-xs mb-6 cursor-pointer group">
              <div className="w-4 h-4 border border-gray-600 flex items-center justify-center group-hover:border-gray-400">
                <input
                  type="checkbox"
                  className="hidden"
                  onChange={(e) => {
                    localStorage.setItem('dontAskDeleteTrace', e.target.checked ? 'true' : 'false')
                    e.currentTarget.parentElement?.classList.toggle('bg-white')
                  }}
                />
              </div>
              <span className="tracking-wider uppercase text-[10px]">Don't ask again</span>
            </label>

            <div className="flex gap-3">
              <button
                className="flex-1 py-3 border border-gray-600 text-gray-400 text-[10px] tracking-[0.15em] uppercase hover:border-gray-400 hover:text-white transition-colors"
                onClick={() => setDeleteConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                className="flex-1 py-3 border border-red-500/40 bg-red-500/20 text-white text-[10px] tracking-[0.15em] uppercase hover:bg-red-500/30 transition-colors"
                onClick={() => executeDelete(deleteConfirmDialog.traceId)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Button - Nier:Automata style */}
      {hasPendingChanges() && (
        <div className="fixed top-6 right-6 z-[2000] pointer-events-auto">
          <button
            onClick={saveAllChanges}
            disabled={isSaving}
            className={`
              relative flex items-center gap-3 px-6 py-3 border
              transition-all duration-200 text-xs tracking-[0.15em] uppercase
              ${isSaving 
                ? 'bg-gray-800 border-gray-600 text-gray-400 cursor-not-allowed' 
                : 'bg-white border-white text-black hover:bg-gray-200'
              }
            `}
          >
            {/* Corner brackets */}
            <span className="absolute top-0 left-0 w-2 h-2 border-l border-t border-black/30" />
            <span className="absolute top-0 right-0 w-2 h-2 border-r border-t border-black/30" />
            <span className="absolute bottom-0 left-0 w-2 h-2 border-l border-b border-black/30" />
            <span className="absolute bottom-0 right-0 w-2 h-2 border-r border-b border-black/30" />
            
            {isSaving ? (
              <>
                <span className="animate-pulse">◇</span>
                Saving...
              </>
            ) : (
              <>
                <span>◇</span>
                Save Changes
                <span className="bg-black/20 px-2 py-0.5 text-[10px]">
                  {pendingChanges.size + deletedTraces.size}
                </span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
