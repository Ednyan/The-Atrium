-- Add an independent opacity for a shape's outline/stroke, separate from
-- shape_opacity (which now only controls fill opacity -- previously a single
-- opacity value applied to the whole SVG element, fill and stroke together).

ALTER TABLE traces
ADD COLUMN IF NOT EXISTS shape_outline_opacity REAL DEFAULT 1.0 CHECK (shape_outline_opacity >= 0 AND shape_outline_opacity <= 1);

COMMENT ON COLUMN traces.shape_outline_opacity IS 'Opacity of a shape''s outline/stroke (0-1), independent of shape_opacity which is fill-only';
