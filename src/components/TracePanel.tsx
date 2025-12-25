import { useState } from 'react'
import { useGameStore } from '../store/gameStore'
import { supabase } from '../lib/supabase'
import type { Trace } from '../types/database'

interface TracePanelProps {
  onClose: () => void
  tracePosition?: { x: number; y: number } | null
  lobbyId: string
}

export default function TracePanel({ onClose, tracePosition, lobbyId }: TracePanelProps) {
  const [content, setContent] = useState('')
  const [traceType, setTraceType] = useState<'text' | 'image' | 'audio' | 'video' | 'embed' | 'shape'>('text')
  const [mediaUrl, setMediaUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Shape-specific state
  const [shapeType, setShapeType] = useState<'rectangle' | 'circle' | 'triangle' | 'path'>('rectangle')
  const [shapeColor, setShapeColor] = useState('#3b82f6') // Default blue
  const [shapeOpacity, setShapeOpacity] = useState(1.0)
  const [cornerRadius, setCornerRadius] = useState(0)
  const [shapeWidth, setShapeWidth] = useState(200)
  const [shapeHeight, setShapeHeight] = useState(200)
  
  const { username, userId, position, addTrace } = useGameStore()
  
  // Use trace position if provided, otherwise fall back to character position
  const finalPosition = tracePosition || position

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return
    
    // Validate based on trace type
    if (traceType === 'text' && !content.trim()) return
    if ((traceType === 'image' || traceType === 'audio' || traceType === 'video') && !file && !mediaUrl) return
    if (traceType === 'embed' && !mediaUrl) return

    setIsSubmitting(true)

    try {
      let uploadedUrl = mediaUrl
      
      // Upload file if provided
      if (file && (traceType === 'image' || traceType === 'audio' || traceType === 'video')) {
        if (supabase) {
          // Upload to Supabase Storage
          const fileExt = file.name.split('.').pop()
          const fileName = `${userId}_${Date.now()}.${fileExt}`
          const { error } = await supabase.storage
            .from('traces')
            .upload(fileName, file)
          
          if (error) {
            console.error('Supabase upload error:', error)
            // Fall back to local data URL
            uploadedUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader()
              reader.onloadend = () => resolve(reader.result as string)
              reader.readAsDataURL(file)
            })
          } else {
            const { data: { publicUrl } } = supabase.storage
              .from('traces')
              .getPublicUrl(fileName)
            
            uploadedUrl = publicUrl
          }
        } else {
          // No Supabase - use local data URL
          console.log('No Supabase configured, using local data URL for file:', file.name)
          uploadedUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(file)
          })
        }
      }

      const newTrace: Trace = {
        id: `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        username,
        type: traceType,
        content: content.trim() || `${traceType} content`,
        x: finalPosition.x,
        y: finalPosition.y,
        mediaUrl: uploadedUrl || undefined,
        createdAt: new Date().toISOString(),
        scale: 1.0,
        scaleX: 1.0,
        scaleY: 1.0,
        rotation: 0.0,
        // Shape properties
        ...(traceType === 'shape' && {
          shapeType,
          shapeColor,
          shapeOpacity,
          cornerRadius,
          width: shapeWidth,
          height: shapeHeight,
          showBorder: false,
          showBackground: false,
          // Initialize points for path shapes
          ...(shapeType === 'path' && {
            shapePoints: [
              { x: finalPosition.x - 50, y: finalPosition.y },
              { x: finalPosition.x + 50, y: finalPosition.y }
            ],
            pathCurveType: 'straight'
          }),
        }),
      }

      console.log('Creating trace:', newTrace)

      // Save to Supabase if available
      if (supabase) {
        console.log('💾 Saving trace to database...')
        const { data, error} = await supabase.from('traces').insert({
          // Don't specify id - let database generate UUID
          user_id: userId,
          username,
          type: traceType,
          content: content.trim() || `${traceType} content`,
          position_x: finalPosition.x,
          position_y: finalPosition.y,
          media_url: uploadedUrl || null,
          scale: 1.0,
          rotation: 0.0,
          lobby_id: lobbyId,
          // Shape properties
          ...(traceType === 'shape' && {
            shape_type: shapeType,
            shape_color: shapeColor,
            shape_opacity: shapeOpacity,
            corner_radius: cornerRadius,
            width: shapeWidth,
            height: shapeHeight,
            show_border: false,
            show_background: false,
            // Initialize points for path shapes
            ...(shapeType === 'path' && {
              shape_points: [
                { x: finalPosition.x - 50, y: finalPosition.y },
                { x: finalPosition.x + 50, y: finalPosition.y }
              ],
              path_curve_type: 'straight'
            }),
          }),
        } as any).select() // Get the generated trace back
        
        if (error) {
          console.error('❌ Database insert error:', error)
          alert(`Failed to save trace: ${error.message}`)
          return // Don't add to local store if database fails
        } else {
          console.log('✅ Trace saved to database successfully!', data)
          
          // Use the database-generated trace
          if (data && data[0]) {
            const dbTrace = data[0] as any
            const trace: Trace = {
              id: dbTrace.id,
              userId: dbTrace.user_id,
              username: dbTrace.username,
              type: dbTrace.type,
              content: dbTrace.content,
              x: dbTrace.position_x,
              y: dbTrace.position_y,
              imageUrl: dbTrace.image_url || undefined,
              mediaUrl: dbTrace.media_url || undefined,
              createdAt: dbTrace.created_at,
              scale: dbTrace.scale ?? 1.0,
              scaleX: dbTrace.scale ?? 1.0,
              scaleY: dbTrace.scale ?? 1.0,
              rotation: dbTrace.rotation ?? 0.0,
              // Shape properties
              shapeType: dbTrace.shape_type,
              shapeColor: dbTrace.shape_color,
              shapeOpacity: dbTrace.shape_opacity,
              cornerRadius: dbTrace.corner_radius,
              width: dbTrace.width,
              height: dbTrace.height,
            }
            // Add to local store with database ID
            addTrace(trace)
          }
        }
      } else {
        console.warn('⚠️ Supabase not available, trace only saved locally')
        // Only add to local store if no Supabase
        addTrace(newTrace)
      }

      setContent('')
      setMediaUrl('')
      setFile(null)
      onClose()
    } catch (error) {
      console.error('Error creating trace:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="absolute inset-0 bg-nier-black/90 backdrop-blur-sm flex items-center justify-center" style={{ zIndex: 1000 }}>
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(218, 212, 187, 0.1) 2px, rgba(218, 212, 187, 0.1) 4px)',
        }}
      />
      
      <div className="bg-nier-blackLight border border-nier-border/40 p-6 max-w-md w-full mx-4 relative max-h-[90vh] overflow-y-auto">
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-5 h-5 border-l border-t border-nier-border/60" />
        <div className="absolute top-0 right-0 w-5 h-5 border-r border-t border-nier-border/60" />
        <div className="absolute bottom-0 left-0 w-5 h-5 border-l border-b border-nier-border/60" />
        <div className="absolute bottom-0 right-0 w-5 h-5 border-r border-b border-nier-border/60" />
        
        <div className="flex items-center gap-3 mb-6">
          <div className="w-1.5 h-1.5 rotate-45 border border-nier-border/60" />
          <h2 className="text-lg text-nier-bg tracking-[0.15em] uppercase">Leave a Trace</h2>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Trace Type Selector */}
          <div>
            <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-3">
              Content Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['text', 'image', 'audio', 'video', 'embed', 'shape'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTraceType(type)}
                  className={`px-3 py-2 text-[10px] tracking-wider uppercase transition-all ${
                    traceType === type
                      ? 'bg-nier-bg text-nier-black'
                      : 'bg-nier-black border border-nier-border/30 text-nier-border hover:border-nier-border/60 hover:text-nier-bg'
                  }`}
                >
                  {type === 'text' && '◇ Text'}
                  {type === 'image' && '◇ Image'}
                  {type === 'audio' && '◇ Audio'}
                  {type === 'video' && '◇ Video'}
                  {type === 'embed' && '◇ Embed'}
                  {type === 'shape' && '◇ Shape'}
                </button>
              ))}
            </div>
          </div>

          {/* Text Content */}
          {traceType === 'text' && (
            <div>
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                Your message
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Share a thought, memory, or feeling..."
                maxLength={200}
                rows={4}
                className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors resize-none"
                autoFocus
              />
              <p className="text-nier-border/40 text-[9px] tracking-wider mt-2 uppercase">
                {content.length}/200 characters
              </p>
            </div>
          )}

          {/* File Upload for Image/Audio/Video */}
          {(traceType === 'image' || traceType === 'audio' || traceType === 'video') && (
            <div className="space-y-3">
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                Upload {traceType}
              </label>
              <input
                type="file"
                accept={
                  traceType === 'image' ? 'image/*' :
                  traceType === 'audio' ? 'audio/*' :
                  'video/*'
                }
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm file:mr-4 file:py-2 file:px-4 file:border-0 file:bg-nier-bg file:text-nier-black file:text-[10px] file:tracking-wider file:uppercase file:cursor-pointer hover:file:bg-nier-bgDark"
              />
              <p className="text-nier-border/50 text-[9px] tracking-wider uppercase">Or paste a URL:</p>
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={`https://example.com/${traceType}.${traceType === 'audio' ? 'mp3' : traceType === 'video' ? 'mp4' : 'jpg'}`}
                className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
              />
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Optional caption..."
                maxLength={100}
                className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
              />
            </div>
          )}

          {/* Embed URL */}
          {traceType === 'embed' && (
            <div>
              <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                Embed URL or HTML Code
              </label>
              <textarea
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={`Direct URL:\nhttps://youtube.com/watch?v=...\n\nOr full embed code:\n<iframe src="https://..."></iframe>`}
                className="w-full px-4 py-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors font-mono"
                rows={5}
                autoFocus
              />
              <p className="text-nier-border/40 text-[9px] tracking-wider mt-2 uppercase">
                ◇ Direct URL or ◇ Paste full embed code
              </p>
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Optional description..."
                maxLength={100}
                className="w-full px-4 py-2 mt-3 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
              />
            </div>
          )}

          {/* Shape Controls */}
          {traceType === 'shape' && (
            <div className="space-y-4">
              {/* Shape Type */}
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Shape Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['rectangle', 'circle', 'triangle', 'path'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setShapeType(type)}
                      className={`px-3 py-2 text-[10px] tracking-wider uppercase capitalize transition-all ${
                        shapeType === type
                          ? 'bg-nier-bg text-nier-black'
                          : 'bg-nier-black border border-nier-border/30 text-nier-border hover:border-nier-border/60 hover:text-nier-bg'
                      }`}
                    >
                      {type === 'rectangle' && '◻'}
                      {type === 'circle' && '○'}
                      {type === 'triangle' && '△'}
                      {type === 'path' && '~'}
                      {' '}{type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Color Picker */}
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Color</label>
                <div className="flex gap-2 items-center">
                  <input
                    type="color"
                    value={shapeColor}
                    onChange={(e) => setShapeColor(e.target.value)}
                    className="w-12 h-10 cursor-pointer bg-nier-black border border-nier-border/30"
                  />
                  <input
                    type="text"
                    value={shapeColor}
                    onChange={(e) => setShapeColor(e.target.value)}
                    placeholder="#3b82f6"
                    className="flex-1 px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors font-mono"
                  />
                </div>
              </div>

              {/* Opacity Slider */}
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                  Opacity: {shapeOpacity.toFixed(2)}
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={shapeOpacity}
                  onChange={(e) => setShapeOpacity(parseFloat(e.target.value))}
                  className="w-full accent-nier-bg"
                />
              </div>

              {/* Size Controls */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Width (px)</label>
                  <input
                    type="number"
                    min="20"
                    max="1000"
                    value={shapeWidth}
                    onChange={(e) => setShapeWidth(parseInt(e.target.value) || 200)}
                    className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm focus:border-nier-border/60 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Height (px)</label>
                  <input
                    type="number"
                    min="20"
                    max="1000"
                    value={shapeHeight}
                    onChange={(e) => setShapeHeight(parseInt(e.target.value) || 200)}
                    className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm focus:border-nier-border/60 transition-colors"
                  />
                </div>
              </div>

              {/* Corner Radius (Rectangle only) */}
              {shapeType === 'rectangle' && (
                <div>
                  <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">
                    Corner Radius: {cornerRadius}px
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={cornerRadius}
                    onChange={(e) => setCornerRadius(parseInt(e.target.value))}
                    className="w-full accent-nier-bg"
                  />
                </div>
              )}

              {/* Optional Label */}
              <div>
                <label className="block text-nier-border text-[9px] tracking-[0.15em] uppercase mb-2">Label (optional)</label>
                <input
                  type="text"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Shape label..."
                  maxLength={50}
                  className="w-full px-4 py-2 bg-nier-black border border-nier-border/30 text-nier-bg text-sm tracking-wide placeholder-nier-border/40 focus:border-nier-border/60 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Location Info */}
          <div className="bg-nier-black border border-nier-border/20 p-4">
            <p className="text-nier-border/60 text-[9px] tracking-[0.15em] uppercase mb-2">
              ◇ Placement Location
            </p>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rotate-45 bg-nier-bg animate-pulse" />
              <p className="text-nier-bg font-mono text-sm">
                X: {Math.round(finalPosition.x)} • Y: {Math.round(finalPosition.y)}
              </p>
            </div>
            <p className="text-nier-border/40 text-[9px] tracking-wider mt-3 uppercase">
              Click on the map to choose placement
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 border border-nier-border/30 text-nier-border text-[10px] tracking-[0.15em] uppercase hover:border-nier-border/60 hover:text-nier-bg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (traceType === 'text' && !content.trim()) || ((traceType === 'image' || traceType === 'audio' || traceType === 'video') && !file && !mediaUrl) || (traceType === 'embed' && !mediaUrl)}
              className="flex-1 py-3 bg-nier-bg text-nier-black text-[10px] tracking-[0.15em] uppercase hover:bg-nier-bgDark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '◇ Saving...' : 'Leave Trace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
