-- Add text formatting columns to traces table
-- These allow text traces to have bold, italic, underline styling, alignment, and color

ALTER TABLE traces ADD COLUMN IF NOT EXISTS text_bold BOOLEAN DEFAULT false;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS text_italic BOOLEAN DEFAULT false;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS text_underline BOOLEAN DEFAULT false;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS text_align TEXT DEFAULT 'center';
ALTER TABLE traces ADD COLUMN IF NOT EXISTS text_color TEXT DEFAULT '#ffffff';
