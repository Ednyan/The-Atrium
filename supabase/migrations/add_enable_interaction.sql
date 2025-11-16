-- Add enable_interaction column to traces table
-- Allows embedded content (iframes) to be interactive without opening modal

ALTER TABLE traces
ADD COLUMN IF NOT EXISTS enable_interaction boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN traces.enable_interaction IS 'When true, embedded content (YouTube, etc.) can be clicked and interacted with directly on the map';
