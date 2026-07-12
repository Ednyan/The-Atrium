-- Fix: non-uniform (stretched) resizes were silently destroyed on save.
-- traceSave.ts's saveAllChanges() collapsed the in-session scale_x/scale_y
-- into a single averaged `scale` column, because that was the only column
-- that existed -- so a trace stretched via a side resize handle looked right
-- until the next save/reload, then snapped back to a uniform scale. This
-- adds independent scale_x/scale_y columns (same reasoning as
-- add_trace_flip.sql's flip_horizontal/flip_vertical) and backfills them
-- from the existing `scale` column so old rows keep their current size.
--
-- `scale` is left in place (still NOT NULL) since some code paths may still
-- read it; it's kept in sync as the average of scale_x/scale_y going
-- forward, but scale_x/scale_y are now the source of truth for rendering.

ALTER TABLE public.traces
  ADD COLUMN IF NOT EXISTS scale_x numeric,
  ADD COLUMN IF NOT EXISTS scale_y numeric;

UPDATE public.traces
SET scale_x = COALESCE(scale_x, scale),
    scale_y = COALESCE(scale_y, scale)
WHERE scale_x IS NULL OR scale_y IS NULL;

ALTER TABLE public.traces
  ALTER COLUMN scale_x SET DEFAULT 1.0,
  ALTER COLUMN scale_y SET DEFAULT 1.0,
  ALTER COLUMN scale_x SET NOT NULL,
  ALTER COLUMN scale_y SET NOT NULL;

COMMENT ON COLUMN public.traces.scale_x IS 'Horizontal scale factor, independent of scale_y (supports non-uniform stretch)';
COMMENT ON COLUMN public.traces.scale_y IS 'Vertical scale factor, independent of scale_x (supports non-uniform stretch)';
COMMENT ON COLUMN public.traces.scale IS 'Legacy uniform-scale column; kept as (scale_x+scale_y)/2 for backward compatibility. scale_x/scale_y are authoritative.';
