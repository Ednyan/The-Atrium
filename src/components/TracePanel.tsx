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
  const [traceType, setTraceType] = useState<'text' | 'image' | 'audio' | 'video' | 'embed'>('text')
  const [mediaUrl, setMediaUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
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
      }

      console.log('Creating trace:', newTrace)

      // Save to Supabase if available
      if (supabase) {
        console.log('💾 Saving trace to database...')
        const { data, error } = await supabase.from('traces').insert({
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
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center" style={{ zIndex: 100 }}>
      <div className="bg-lobby-muted border-2 border-lobby-accent rounded-lg p-6 max-w-md w-full mx-4 shadow-2xl">
        <h2 className="text-2xl font-bold text-lobby-accent mb-4">Leave a Trace</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Trace Type Selector */}
          <div>
            <label className="block text-lobby-light text-sm mb-2 font-semibold">
              Content Type
            </label>
            <div className="grid grid-cols-5 gap-2">
              {(['text', 'image', 'audio', 'video', 'embed'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTraceType(type)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    traceType === type
                      ? 'bg-lobby-accent text-lobby-light'
                      : 'bg-lobby-darker text-lobby-light/60 hover:bg-lobby-darker/70'
                  }`}
                >
                  {type === 'text' && '📝 Text'}
                  {type === 'image' && '🖼️ Image'}
                  {type === 'audio' && '🎵 Audio'}
                  {type === 'video' && '🎬 Video'}
                  {type === 'embed' && '🔗 Embed'}
                </button>
              ))}
            </div>
          </div>

          {/* Text Content */}
          {traceType === 'text' && (
            <div>
              <label className="block text-lobby-light text-sm mb-2">
                Your message
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Share a thought, memory, or feeling..."
                maxLength={200}
                rows={4}
                className="w-full px-4 py-3 bg-lobby-darker border-2 border-lobby-accent/30 rounded-lg text-lobby-light placeholder-lobby-light/40 focus:outline-none focus:border-lobby-accent transition-colors resize-none"
                autoFocus
              />
              <p className="text-lobby-light/40 text-xs mt-1">
                {content.length}/200 characters
              </p>
            </div>
          )}

          {/* File Upload for Image/Audio/Video */}
          {(traceType === 'image' || traceType === 'audio' || traceType === 'video') && (
            <div>
              <label className="block text-lobby-light text-sm mb-2">
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
                className="w-full px-4 py-3 bg-lobby-darker border-2 border-lobby-accent/30 rounded-lg text-lobby-light file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-lobby-accent file:text-lobby-light file:cursor-pointer hover:file:bg-lobby-accent/80"
              />
              <p className="text-lobby-light/60 text-xs mt-2">Or paste a URL:</p>
              <input
                type="url"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={`https://example.com/${traceType}.${traceType === 'audio' ? 'mp3' : traceType === 'video' ? 'mp4' : 'jpg'}`}
                className="w-full px-4 py-2 mt-1 bg-lobby-darker border-2 border-lobby-accent/30 rounded-lg text-lobby-light placeholder-lobby-light/40 focus:outline-none focus:border-lobby-accent transition-colors"
              />
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Optional caption..."
                maxLength={100}
                className="w-full px-4 py-2 mt-2 bg-lobby-darker border-2 border-lobby-accent/30 rounded-lg text-lobby-light placeholder-lobby-light/40 focus:outline-none focus:border-lobby-accent transition-colors"
              />
            </div>
          )}

          {/* Embed URL */}
          {traceType === 'embed' && (
            <div>
              <label className="block text-lobby-light text-sm mb-2">
                Embed URL or HTML Code
              </label>
              <textarea
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder={`Direct URL:\nhttps://youtube.com/watch?v=...\n\nOr full embed code:\n<iframe src="https://..."></iframe>`}
                className="w-full px-4 py-3 bg-lobby-darker border-2 border-lobby-accent/30 rounded-lg text-lobby-light placeholder-lobby-light/40 focus:outline-none focus:border-lobby-accent transition-colors font-mono text-sm"
                rows={5}
                autoFocus
              />
              <p className="text-lobby-light/40 text-xs mt-1">
                📺 Direct URL (YouTube, Vimeo, etc.) or 📋 Paste full embed code from SoundCloud, Spotify, etc.
              </p>
              <input
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Optional description..."
                maxLength={100}
                className="w-full px-4 py-2 mt-2 bg-lobby-darker border-2 border-lobby-accent/30 rounded-lg text-lobby-light placeholder-lobby-light/40 focus:outline-none focus:border-lobby-accent transition-colors"
              />
            </div>
          )}

          <div className="bg-lobby-darker/50 border-2 border-lobby-accent/20 rounded-lg p-4">
            <p className="text-lobby-light/60 text-sm mb-2">
              📍 Trace placement location:
            </p>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-lobby-accent animate-pulse"></div>
              <p className="text-lobby-accent font-mono">
                X: {Math.round(finalPosition.x)} • Y: {Math.round(finalPosition.y)}
              </p>
            </div>
            <p className="text-lobby-light/40 text-xs mt-2">
              💡 Tip: Click on the map to choose where your trace appears!
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-lobby-darker hover:bg-lobby-dark text-lobby-light rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || (traceType === 'text' && !content.trim()) || ((traceType === 'image' || traceType === 'audio' || traceType === 'video') && !file && !mediaUrl) || (traceType === 'embed' && !mediaUrl)}
              className="flex-1 px-4 py-2 bg-lobby-accent hover:bg-lobby-accent/80 disabled:bg-lobby-accent/30 text-lobby-light font-semibold rounded-lg transition-all disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving...' : 'Leave Trace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
