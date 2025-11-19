-- Add shape support to traces table
-- This allows creating basic geometric shapes as traces

-- Add shape-specific columns
ALTER TABLE traces 
ADD COLUMN IF NOT EXISTS shape_type TEXT CHECK (shape_type IN ('rectangle', 'circle', 'triangle')),
ADD COLUMN IF NOT EXISTS shape_color TEXT DEFAULT '#ffffff',
ADD COLUMN IF NOT EXISTS shape_opacity DECIMAL(3,2) DEFAULT 1.0 CHECK (shape_opacity >= 0 AND shape_opacity <= 1),
ADD COLUMN IF NOT EXISTS corner_radius INTEGER DEFAULT 0 CHECK (corner_radius >= 0),
ADD COLUMN IF NOT EXISTS width INTEGER DEFAULT 200 CHECK (width > 0),
ADD COLUMN IF NOT EXISTS height INTEGER DEFAULT 200 CHECK (height > 0);

-- Update type constraint to include 'shape'
ALTER TABLE traces DROP CONSTRAINT IF EXISTS traces_type_check;
ALTER TABLE traces ADD CONSTRAINT traces_type_check 
  CHECK (type IN ('text', 'image', 'audio', 'video', 'embed', 'shape'));

-- Add index for shape queries
CREATE INDEX IF NOT EXISTS idx_traces_shape_type ON traces(shape_type) WHERE type = 'shape';

-- Add comment
COMMENT ON COLUMN traces.shape_type IS 'Type of shape: rectangle, circle, or triangle';
COMMENT ON COLUMN traces.shape_color IS 'Fill color of the shape in hex format';
COMMENT ON COLUMN traces.shape_opacity IS 'Opacity of the shape from 0 to 1';
COMMENT ON COLUMN traces.corner_radius IS 'Corner radius for rectangles (0 = sharp corners)';
COMMENT ON COLUMN traces.width IS 'Width of the shape in pixels';
COMMENT ON COLUMN traces.height IS 'Height of the shape in pixels';
