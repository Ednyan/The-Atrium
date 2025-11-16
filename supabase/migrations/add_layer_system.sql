-- Migration: Add layer system with groups and z-index ordering
-- Run this in your Supabase SQL Editor

-- Add layer_id and z_index to traces table
ALTER TABLE public.traces
ADD COLUMN IF NOT EXISTS layer_id uuid,
ADD COLUMN IF NOT EXISTS z_index integer DEFAULT 0 NOT NULL;

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

-- Create indexes for layers
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

COMMENT ON TABLE public.layers IS 'Layer groups for organizing traces with z-index ordering';
COMMENT ON COLUMN public.layers.z_index IS 'Z-index for rendering order (higher renders on top)';
COMMENT ON COLUMN public.layers.is_group IS 'Whether this is a group container';
COMMENT ON COLUMN public.layers.parent_id IS 'Parent group ID for nested groups';

COMMENT ON COLUMN public.traces.layer_id IS 'Layer/group this trace belongs to';
COMMENT ON COLUMN public.traces.z_index IS 'Z-index for rendering order within layer';
