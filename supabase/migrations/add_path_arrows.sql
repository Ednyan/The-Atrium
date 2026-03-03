-- Add arrow support for path shapes
ALTER TABLE traces ADD COLUMN IF NOT EXISTS path_arrow_start TEXT DEFAULT 'none';
ALTER TABLE traces ADD COLUMN IF NOT EXISTS path_arrow_end TEXT DEFAULT 'none';
