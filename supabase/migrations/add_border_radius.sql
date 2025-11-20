-- Migration: Add border_radius column to traces table
-- This allows customizable border radius for trace containers

ALTER TABLE public.traces
ADD COLUMN IF NOT EXISTS border_radius integer DEFAULT 8 NOT NULL CHECK (border_radius >= 0 AND border_radius <= 50);

COMMENT ON COLUMN public.traces.border_radius IS 'Border radius in pixels for trace container (0-50)';
