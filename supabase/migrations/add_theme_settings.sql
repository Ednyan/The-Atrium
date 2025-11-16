-- Add theme_settings column to lobbies table
-- This stores customizable theme settings for each lobby

ALTER TABLE lobbies 
ADD COLUMN IF NOT EXISTS theme_settings JSONB DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN lobbies.theme_settings IS 'JSON object containing theme customization settings: gridColor, gridOpacity, backgroundColor, particlesEnabled, particleColor, groundParticlesEnabled, groundParticleUrls';

-- Create index for better performance when querying lobbies with theme settings
CREATE INDEX IF NOT EXISTS idx_lobbies_theme_settings ON lobbies USING GIN (theme_settings);
