-- Add outline mode support for shapes
-- Adds shape_outline_only and shape_outline_width columns to traces table

ALTER TABLE traces 
ADD COLUMN IF NOT EXISTS shape_outline_only BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS shape_outline_width INTEGER DEFAULT 2 CHECK (shape_outline_width >= 1 AND shape_outline_width <= 20);

-- Update corner_radius comment to reflect it now works for triangles too
COMMENT ON COLUMN traces.corner_radius IS 'Corner radius for rectangles and triangles (0 = sharp corners)';

-- Add comments for new columns
COMMENT ON COLUMN traces.shape_outline_only IS 'If true, shape renders as outline only (no fill)';
COMMENT ON COLUMN traces.shape_outline_width IS 'Width of shape outline in pixels (1-20)';
