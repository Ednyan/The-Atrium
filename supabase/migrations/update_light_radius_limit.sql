-- Migration: Increase light_radius max from 1000 to 3000
ALTER TABLE public.traces
DROP CONSTRAINT IF EXISTS traces_light_radius_check;

ALTER TABLE public.traces
ADD CONSTRAINT traces_light_radius_check CHECK (light_radius >= 0 AND light_radius <= 3000);

COMMENT ON COLUMN public.traces.light_radius IS 'Radius of the light effect in pixels (0-3000)';
