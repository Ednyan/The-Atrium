-- Add player_color column to profiles table
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS player_color text DEFAULT '#ffffff';

-- Add constraint to ensure it's a valid hex color
ALTER TABLE public.profiles
  ADD CONSTRAINT player_color_format CHECK (player_color ~ '^#[0-9a-fA-F]{6}$');
