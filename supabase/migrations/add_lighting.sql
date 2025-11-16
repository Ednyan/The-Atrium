-- Migration: Add lighting fields to traces table
ALTER TABLE public.traces
ADD COLUMN IF NOT EXISTS illuminate boolean DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS light_color text DEFAULT '#ffffff' NOT NULL,
ADD COLUMN IF NOT EXISTS light_intensity numeric DEFAULT 1.0 NOT NULL CHECK (light_intensity >= 0 AND light_intensity <= 2),
ADD COLUMN IF NOT EXISTS light_radius numeric DEFAULT 200 NOT NULL CHECK (light_radius >= 0 AND light_radius <= 1000),
ADD COLUMN IF NOT EXISTS light_offset_x numeric DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS light_offset_y numeric DEFAULT 0 NOT NULL;

COMMENT ON COLUMN public.traces.illuminate IS 'Whether this trace emits light';
COMMENT ON COLUMN public.traces.light_color IS 'Hex color of the emitted light (e.g., #ffffff)';
COMMENT ON COLUMN public.traces.light_intensity IS 'Intensity multiplier for the light (0-2)';
COMMENT ON COLUMN public.traces.light_radius IS 'Radius of the light effect in pixels (0-1000)';
COMMENT ON COLUMN public.traces.light_offset_x IS 'X offset of light source from trace center';
COMMENT ON COLUMN public.traces.light_offset_y IS 'Y offset of light source from trace center';
