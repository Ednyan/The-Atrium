-- Add shape_no_fill and shape_outline_color columns to traces table
ALTER TABLE traces ADD COLUMN IF NOT EXISTS shape_no_fill BOOLEAN DEFAULT false;
ALTER TABLE traces ADD COLUMN IF NOT EXISTS shape_outline_color TEXT;
