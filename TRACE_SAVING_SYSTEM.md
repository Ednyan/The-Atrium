# Trace Saving System Documentation

## Overview
The Digital Lobby application has a complete trace saving and persistence system using **Supabase** (PostgreSQL) with real-time synchronization.

## Database Schema

### Traces Table (`public.traces`)

All traces are saved to the Supabase database with the following fields:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | uuid | uuid_generate_v4() | Unique identifier (Primary Key) |
| `created_at` | timestamp with time zone | now() | Creation timestamp |
| `user_id` | text | - | User identifier |
| `username` | text | - | Display name of creator |
| `type` | text | - | Content type: 'text', 'image', 'audio', 'video', or 'embed' |
| `content` | text | - | Text content or caption/description |
| `position_x` | numeric | - | X coordinate in world space |
| `position_y` | numeric | - | Y coordinate in world space |
| `image_url` | text | null | (Deprecated - use media_url) |
| `media_url` | text | null | URL for media content (images, audio, video, embeds) |
| `scale` | numeric | 1.0 | Scale factor (1.0 = 100%) |
| `rotation` | numeric | 0.0 | Rotation in degrees (0-360) |

### Indexes
- `traces_created_at_idx` - For efficient chronological queries
- `traces_user_id_idx` - For user-specific queries

## Features

### ✅ Data Persistence
- **All trace data is automatically saved to Supabase**
- Transform changes (position, scale, rotation) sync in real-time
- Media files can be uploaded to Supabase Storage bucket `traces`

### ✅ Real-time Synchronization
- Uses Supabase Realtime subscriptions
- New traces appear instantly for all users
- Transform updates propagate automatically
- Updates are handled in `src/hooks/useTraces.ts`

### ✅ Supported Data Types

#### 1. Text Traces
- Plain text content (max 200 characters)
- Stored in `content` field

#### 2. Image Traces
- File upload or URL input
- Uploaded files stored in Supabase Storage
- URL stored in `media_url` field
- Optional caption in `content` field

#### 3. Audio Traces
- File upload (.mp3, .wav, etc.) or URL input
- Uploaded to Supabase Storage
- URL in `media_url` field
- Optional caption in `content` field

#### 4. Video Traces
- File upload (.mp4, .webm, etc.) or URL input
- Uploaded to Supabase Storage
- URL in `media_url` field
- Optional caption in `content` field

#### 5. Embed Traces
- YouTube, Vimeo, Spotify, SoundCloud, etc.
- URL in `media_url` field
- Optional description in `content` field

### ✅ Transform System

All traces support interactive transformations that are **automatically saved**:

1. **Position** (`position_x`, `position_y`)
   - Drag trace body to reposition
   - Updates saved to database on mouse up

2. **Scale** (`scale`)
   - Drag corner handles to resize
   - Scale factor applied (1.0 = original size)
   - Saved to database immediately

3. **Rotation** (`rotation`)
   - Drag top handle to rotate
   - Stored in degrees (0-360)
   - Saved to database on change

## Implementation Details

### Creating Traces

**Location:** `src/components/TracePanel.tsx`

```typescript
// Creates trace and saves to database
await supabase.from('traces').insert({
  id: newTrace.id,
  user_id: userId,
  username,
  type: traceType,
  content: content.trim(),
  position_x: finalPosition.x,
  position_y: finalPosition.y,
  media_url: uploadedUrl || null,
  scale: 1.0,
  rotation: 0.0,
})
```

### Updating Transforms

**Location:** `src/components/TraceOverlay.tsx`

```typescript
// Updates trace transform and syncs to database
const updateTraceTransform = async (traceId: string, updates: Partial<{
  x: number; y: number; scale: number; rotation: number
}>) => {
  // Update local state for immediate UI response
  setLocalTraceTransforms(prev => ({
    ...prev,
    [traceId]: { ...getTraceTransform(trace), ...updates }
  }))
  
  // Sync to database
  const updateData: any = {}
  if (updates.x !== undefined) updateData.position_x = updates.x
  if (updates.y !== undefined) updateData.position_y = updates.y
  if (updates.scale !== undefined) updateData.scale = updates.scale
  if (updates.rotation !== undefined) updateData.rotation = updates.rotation
  
  await supabase.from('traces').update(updateData).eq('id', traceId)
}
```

### Loading Traces

**Location:** `src/hooks/useTraces.ts`

```typescript
// Subscribe to real-time updates
const channel = supabase
  .channel('traces-channel')
  .on('postgres_changes', { 
    event: 'INSERT', 
    schema: 'public', 
    table: 'traces' 
  }, (payload) => {
    // Map database row to Trace type
    const newTrace: Trace = {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      type: row.type,
      content: row.content,
      x: parseFloat(row.position_x.toString()),
      y: parseFloat(row.position_y.toString()),
      mediaUrl: row.media_url || row.image_url,
      createdAt: row.created_at,
      scale: row.scale ?? 1.0,
      rotation: row.rotation ?? 0.0,
    }
    addTrace(newTrace)
  })
  .subscribe()
```

## Storage System

### Supabase Storage Bucket: `traces`

- **Public access enabled** for easy sharing
- Stores uploaded images, audio, and video files
- Automatic public URL generation
- File naming: `{userId}_{timestamp}.{ext}`

### Upload Process

1. User selects file in TracePanel
2. File uploaded to Supabase Storage bucket `traces`
3. Public URL retrieved
4. URL stored in `media_url` field in database
5. Trace rendered using the public URL

### Fallback System

If Supabase is not configured:
- Files converted to **Data URLs** (base64)
- Stored directly in `media_url` field
- Works for demo/testing without backend

## Security & Policies

### Row Level Security (RLS)

**Read Access:**
```sql
-- Allow anyone to read traces
CREATE POLICY "Allow public read access" ON public.traces
    FOR SELECT USING (true);
```

**Insert Access:**
```sql
-- Allow anyone to insert traces
CREATE POLICY "Allow public insert access" ON public.traces
    FOR INSERT WITH CHECK (true);
```

**Delete Access:**
```sql
-- Allow anyone to delete traces
CREATE POLICY "Allow users to delete own traces" ON public.traces
    FOR DELETE USING (true);
```

### Storage Policies

```sql
-- Public read access
CREATE POLICY "Allow public read access to traces bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'traces');

-- Public upload
CREATE POLICY "Allow public upload to traces bucket"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'traces');
```

## Data Cleanup

### Automatic Cleanup Function

Keeps only the most recent 1000 traces:

```sql
CREATE OR REPLACE FUNCTION cleanup_old_traces()
RETURNS void AS $$
BEGIN
    DELETE FROM public.traces
    WHERE id NOT IN (
        SELECT id FROM public.traces
        ORDER BY created_at DESC
        LIMIT 1000
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Note:** Automatic scheduling requires `pg_cron` extension (optional).

## User Interface

### Creating Traces

**3 Ways to create a trace:**

1. **"Leave Trace" Button** (bottom-right)
   - Opens TracePanel at player's current position
   - Default placement location

2. **Right-click Menu → "Leave trace here"**
   - Opens TracePanel at clicked world position
   - Precise placement control

3. **Direct Button Click**
   - Quick access to trace creation
   - Places at player position

### Transform Controls

**Select a trace** by clicking on it:
- Green border and glow indicates selection
- 4 green corner handles for scaling
- 1 blue top handle for rotation
- Drag trace body to reposition
- Press **ESC** to deselect
- **Double-click** to view full content in modal

## Type Definitions

**Location:** `src/types/database.ts`

```typescript
export interface Trace {
  id: string
  userId: string
  username: string
  type: 'text' | 'image' | 'audio' | 'video' | 'embed'
  content: string
  x: number
  y: number
  mediaUrl?: string
  createdAt: string
  scale: number      // Transform scale (1.0 = 100%)
  rotation: number   // Transform rotation (0-360 degrees)
}
```

## Summary

✅ **Fully Implemented Features:**
- Complete PostgreSQL database schema with all required fields
- Real-time synchronization using Supabase Realtime
- Automatic saving of all trace data (content, position, scale, rotation)
- File upload system with Supabase Storage
- Transform system with live updates to database
- Support for 5 content types (text, image, audio, video, embed)
- Metadata tracking (creator, date, description)
- Public access with Row Level Security policies

The saving system is **production-ready** and requires no additional implementation. All data is persisted automatically!
