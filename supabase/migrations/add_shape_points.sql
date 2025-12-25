-- Add shape_points column for path shapes
ALTER TABLE traces ADD COLUMN IF NOT EXISTS shape_points JSONB;

-- Add path_curve_type column for path shape curve style
ALTER TABLE traces ADD COLUMN IF NOT EXISTS path_curve_type TEXT DEFAULT 'straight' CHECK (path_curve_type IN ('straight', 'bezier'));

-- Update shape_type constraint to include path
ALTER TABLE traces DROP CONSTRAINT IF EXISTS traces_shape_type_check;
ALTER TABLE traces ADD CONSTRAINT traces_shape_type_check 
  CHECK (shape_type IN ('rectangle', 'circle', 'triangle', 'path'));
