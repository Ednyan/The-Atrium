-- Add border and fill color/opacity customization columns to traces table
ALTER TABLE traces ADD COLUMN IF NOT EXISTS border_color TEXT;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS border_opacity FLOAT;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS fill_color TEXT;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS fill_opacity FLOAT;
