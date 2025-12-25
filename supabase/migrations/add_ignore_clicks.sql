-- Add ignore_clicks column to traces table
-- This allows traces to be unselectable with left click (useful for background elements)
-- but still accessible via right-click menu
ALTER TABLE traces ADD COLUMN IF NOT EXISTS ignore_clicks BOOLEAN DEFAULT false;
