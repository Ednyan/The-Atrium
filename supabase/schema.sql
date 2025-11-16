-- The Lobby Database Schema
-- Run this SQL in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create traces table
CREATE TABLE IF NOT EXISTS public.traces (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    user_id text NOT NULL,
    username text NOT NULL,
    type text NOT NULL CHECK (type IN ('text', 'image', 'audio', 'video', 'embed')),
    content text NOT NULL,
    position_x numeric NOT NULL,
    position_y numeric NOT NULL,
    image_url text,
    media_url text,
    scale numeric DEFAULT 1.0 NOT NULL,
    rotation numeric DEFAULT 0.0 NOT NULL,
    -- Customization options
    show_border boolean DEFAULT true NOT NULL,
    show_background boolean DEFAULT true NOT NULL,
    show_description boolean DEFAULT true NOT NULL,
    show_filename boolean DEFAULT true NOT NULL,
    font_size text DEFAULT 'medium' NOT NULL CHECK (font_size IN ('small', 'medium', 'large')),
    font_family text DEFAULT 'sans' NOT NULL CHECK (font_family IN ('sans', 'serif', 'mono')),
    is_locked boolean DEFAULT false NOT NULL,
    -- Image cropping (values between 0 and 1, representing percentage)
    crop_x numeric DEFAULT 0 NOT NULL CHECK (crop_x >= 0 AND crop_x <= 1),
    crop_y numeric DEFAULT 0 NOT NULL CHECK (crop_y >= 0 AND crop_y <= 1),
    crop_width numeric DEFAULT 1 NOT NULL CHECK (crop_width >= 0 AND crop_width <= 1),
    crop_height numeric DEFAULT 1 NOT NULL CHECK (crop_height >= 0 AND crop_height <= 1),
    -- Lighting properties
    illuminate boolean DEFAULT false NOT NULL,
    light_color text DEFAULT '#ffffff' NOT NULL,
    light_intensity numeric DEFAULT 1.0 NOT NULL CHECK (light_intensity >= 0 AND light_intensity <= 2),
    light_radius numeric DEFAULT 200 NOT NULL CHECK (light_radius >= 0 AND light_radius <= 1000),
    light_offset_x numeric DEFAULT 0 NOT NULL,
    light_offset_y numeric DEFAULT 0 NOT NULL,
    -- Layer system
    layer_id uuid,
    z_index integer DEFAULT 0 NOT NULL
);

-- Create layers table for layer groups
CREATE TABLE IF NOT EXISTS public.layers (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    name text NOT NULL,
    z_index integer NOT NULL,
    is_group boolean DEFAULT true NOT NULL,
    parent_id uuid REFERENCES public.layers(id) ON DELETE CASCADE,
    user_id text NOT NULL
);

-- Create index for layers
CREATE INDEX IF NOT EXISTS layers_z_index_idx ON public.layers(z_index);
CREATE INDEX IF NOT EXISTS layers_parent_id_idx ON public.layers(parent_id);
CREATE INDEX IF NOT EXISTS layers_user_id_idx ON public.layers(user_id);

-- Enable RLS for layers
ALTER TABLE public.layers ENABLE ROW LEVEL SECURITY;

-- Policies for layers
CREATE POLICY "Allow public read access to layers" ON public.layers
    FOR SELECT
    USING (true);

CREATE POLICY "Allow public insert access to layers" ON public.layers
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow public update access to layers" ON public.layers
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Allow public delete access to layers" ON public.layers
    FOR DELETE
    USING (true);

-- Enable Realtime for layers table
ALTER PUBLICATION supabase_realtime ADD TABLE public.layers;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS traces_created_at_idx ON public.traces(created_at DESC);
CREATE INDEX IF NOT EXISTS traces_user_id_idx ON public.traces(user_id);

-- Enable Row Level Security
ALTER TABLE public.traces ENABLE ROW LEVEL SECURITY;

-- Create policies for traces
-- Allow anyone to read traces
CREATE POLICY "Allow public read access" ON public.traces
    FOR SELECT
    USING (true);

-- Allow anyone to insert traces (for anonymous users)
CREATE POLICY "Allow public insert access" ON public.traces
    FOR INSERT
    WITH CHECK (true);

-- Allow anyone to update traces
CREATE POLICY "Allow public update access" ON public.traces
    FOR UPDATE
    USING (true)
    WITH CHECK (true);

-- Optional: Allow users to delete their own traces
CREATE POLICY "Allow users to delete own traces" ON public.traces
    FOR DELETE
    USING (true);

-- Enable Realtime for traces table
ALTER PUBLICATION supabase_realtime ADD TABLE public.traces;

-- Create storage bucket for trace images (optional)
INSERT INTO storage.buckets (id, name, public)
VALUES ('traces', 'traces', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for trace images
CREATE POLICY "Allow public read access to traces bucket"
ON storage.objects FOR SELECT
USING (bucket_id = 'traces');

CREATE POLICY "Allow public upload to traces bucket"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'traces');

-- Optional: Limit trace image size (10MB)
CREATE POLICY "Limit trace image size"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'traces' AND
    (pg_column_size(metadata) < 10485760)
);

-- Create a function to clean up old traces (optional - keeps last 1000)
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

-- Optional: Schedule cleanup weekly (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-old-traces', '0 0 * * 0', 'SELECT cleanup_old_traces()');

-- Migration: Add crop fields to existing traces table
-- Run this if you already have the traces table created
ALTER TABLE public.traces 
ADD COLUMN IF NOT EXISTS crop_x numeric DEFAULT 0 NOT NULL CHECK (crop_x >= 0 AND crop_x <= 1),
ADD COLUMN IF NOT EXISTS crop_y numeric DEFAULT 0 NOT NULL CHECK (crop_y >= 0 AND crop_y <= 1),
ADD COLUMN IF NOT EXISTS crop_width numeric DEFAULT 1 NOT NULL CHECK (crop_width >= 0 AND crop_width <= 1),
ADD COLUMN IF NOT EXISTS crop_height numeric DEFAULT 1 NOT NULL CHECK (crop_height >= 0 AND crop_height <= 1);

-- Migration: Add lighting fields to existing traces table
ALTER TABLE public.traces
ADD COLUMN IF NOT EXISTS illuminate boolean DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS light_color text DEFAULT '#ffffff' NOT NULL,
ADD COLUMN IF NOT EXISTS light_intensity numeric DEFAULT 1.0 NOT NULL CHECK (light_intensity >= 0 AND light_intensity <= 2),
ADD COLUMN IF NOT EXISTS light_radius numeric DEFAULT 200 NOT NULL CHECK (light_radius >= 0 AND light_radius <= 1000),
ADD COLUMN IF NOT EXISTS light_offset_x numeric DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS light_offset_y numeric DEFAULT 0 NOT NULL;

-- Migration: Add layer system fields
ALTER TABLE public.traces
ADD COLUMN IF NOT EXISTS layer_id uuid,
ADD COLUMN IF NOT EXISTS z_index integer DEFAULT 0 NOT NULL;

COMMENT ON TABLE public.traces IS 'Stores user-created traces (messages, images, audio, video, embeds) in the lobby';
COMMENT ON COLUMN public.traces.type IS 'Type of trace: text, image, audio, video, or embed';
COMMENT ON COLUMN public.traces.position_x IS 'X coordinate in the lobby';
COMMENT ON COLUMN public.traces.position_y IS 'Y coordinate in the lobby';
COMMENT ON COLUMN public.traces.media_url IS 'URL for audio, video, or embed content';
COMMENT ON COLUMN public.traces.scale IS 'Scale factor for the trace (1.0 = 100%)';
COMMENT ON COLUMN public.traces.rotation IS 'Rotation in degrees (0-360)';
