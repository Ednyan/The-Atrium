-- Update font_size column to support numeric pixel values instead of preset strings
-- This allows users to set exact font sizes in pixels (e.g., 14, 24, 48)

-- First, drop the existing CHECK constraint
ALTER TABLE traces DROP CONSTRAINT IF EXISTS traces_font_size_check;

-- Change the column type from text to integer
-- Convert existing values: small=12, medium=16, large=24
ALTER TABLE traces 
ALTER COLUMN font_size TYPE integer 
USING (
  CASE font_size::text
    WHEN 'small' THEN 12
    WHEN 'medium' THEN 16
    WHEN 'large' THEN 24
    ELSE COALESCE(NULLIF(regexp_replace(font_size::text, '[^0-9]', '', 'g'), '')::integer, 16)
  END
);

-- Set a new default value
ALTER TABLE traces ALTER COLUMN font_size SET DEFAULT 16;

-- Add a reasonable range constraint
ALTER TABLE traces ADD CONSTRAINT traces_font_size_check CHECK (font_size >= 8 AND font_size <= 200);
