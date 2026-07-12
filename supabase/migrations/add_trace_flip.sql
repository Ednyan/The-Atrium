-- Add horizontal/vertical flip support to traces. Implemented as two
-- independent booleans (not by negating scale_x/scale_y) because
-- saveAllChanges() already collapses scale_x/scale_y into a single averaged
-- `scale` column on save, which would silently destroy a sign-encoded flip.

ALTER TABLE public.traces
  ADD COLUMN IF NOT EXISTS flip_horizontal boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS flip_vertical boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.traces.flip_horizontal IS 'Mirror trace horizontally (CSS scaleX(-1)), independent of scale/scaleX/scaleY sizing';
COMMENT ON COLUMN public.traces.flip_vertical IS 'Mirror trace vertically (CSS scaleY(-1)), independent of scale/scaleX/scaleY sizing';
