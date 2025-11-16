-- Migration: Add light pulse/flicker fields to traces table
ALTER TABLE public.traces
ADD COLUMN IF NOT EXISTS light_pulse boolean DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS light_pulse_speed numeric DEFAULT 2.0 NOT NULL CHECK (light_pulse_speed >= 0.5 AND light_pulse_speed <= 5.0);

COMMENT ON COLUMN public.traces.light_pulse IS 'Whether the light should pulse/flicker';
COMMENT ON COLUMN public.traces.light_pulse_speed IS 'Duration of pulse cycle in seconds (0.5-5.0)';
