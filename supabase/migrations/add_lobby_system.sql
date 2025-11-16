-- Add lobby system to support multiple separate lobbies/servers
-- Users can create up to 3 lobbies, with password protection and access control

-- Create lobbies table
CREATE TABLE IF NOT EXISTS lobbies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  password_hash text, -- NULL if no password required
  max_players integer DEFAULT 50,
  is_public boolean DEFAULT true, -- If false, only whitelist can join
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT name_length CHECK (char_length(name) >= 3 AND char_length(name) <= 50)
);

-- Create lobby access lists (whitelist/blacklist)
CREATE TABLE IF NOT EXISTS lobby_access_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id uuid NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  list_type text NOT NULL CHECK (list_type IN ('whitelist', 'blacklist')),
  added_at timestamp with time zone DEFAULT now(),
  added_by uuid REFERENCES auth.users(id), -- Who added this user to the list
  UNIQUE(lobby_id, user_id, list_type)
);

-- Add lobby_id to profiles (which lobby user is currently in)
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS active_lobby_id uuid REFERENCES lobbies(id) ON DELETE SET NULL;

-- Add lobby_id to traces (which lobby the trace belongs to)
ALTER TABLE traces
ADD COLUMN IF NOT EXISTS lobby_id uuid REFERENCES lobbies(id) ON DELETE CASCADE;

-- Create default lobby for existing data
INSERT INTO lobbies (id, name, owner_user_id, is_public)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Main Lobby',
  (SELECT id FROM auth.users LIMIT 1), -- Assign to first user, or you can use a specific admin user
  true
)
ON CONFLICT (id) DO NOTHING;

-- Update existing traces to belong to default lobby
UPDATE traces
SET lobby_id = '00000000-0000-0000-0000-000000000000'
WHERE lobby_id IS NULL;

-- Update existing profiles to be in default lobby
UPDATE profiles
SET active_lobby_id = '00000000-0000-0000-0000-000000000000'
WHERE active_lobby_id IS NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_lobbies_owner ON lobbies(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_lobby_access_lists_lobby ON lobby_access_lists(lobby_id);
CREATE INDEX IF NOT EXISTS idx_lobby_access_lists_user ON lobby_access_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_active_lobby ON profiles(active_lobby_id);
CREATE INDEX IF NOT EXISTS idx_traces_lobby ON traces(lobby_id);

-- Enable RLS on new tables
ALTER TABLE lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE lobby_access_lists ENABLE ROW LEVEL SECURITY;

-- Policies for lobbies table
CREATE POLICY "Anyone can view public lobbies"
  ON lobbies FOR SELECT
  USING (is_public = true OR owner_user_id = auth.uid());

CREATE POLICY "Users can create lobbies (max 3 per user enforced in app)"
  ON lobbies FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owners can update their lobbies"
  ON lobbies FOR UPDATE
  USING (auth.uid() = owner_user_id)
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owners can delete their lobbies"
  ON lobbies FOR DELETE
  USING (auth.uid() = owner_user_id);

-- Policies for lobby access lists
CREATE POLICY "Anyone can view access lists for lobbies they're in or own"
  ON lobby_access_lists FOR SELECT
  USING (
    auth.uid() IN (
      SELECT owner_user_id FROM lobbies WHERE id = lobby_id
    )
    OR auth.uid() = user_id
  );

CREATE POLICY "Lobby owners can manage access lists"
  ON lobby_access_lists FOR ALL
  USING (
    auth.uid() IN (
      SELECT owner_user_id FROM lobbies WHERE id = lobby_id
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT owner_user_id FROM lobbies WHERE id = lobby_id
    )
  );

-- Function to check if user can join a lobby
CREATE OR REPLACE FUNCTION can_user_join_lobby(
  p_lobby_id uuid,
  p_user_id uuid,
  p_password text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lobby lobbies%ROWTYPE;
  v_is_blacklisted boolean;
  v_is_whitelisted boolean;
  v_password_required boolean;
BEGIN
  -- Get lobby info
  SELECT * INTO v_lobby FROM lobbies WHERE id = p_lobby_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Owner can always join
  IF v_lobby.owner_user_id = p_user_id THEN
    RETURN true;
  END IF;
  
  -- Check if blacklisted
  SELECT EXISTS(
    SELECT 1 FROM lobby_access_lists
    WHERE lobby_id = p_lobby_id
    AND user_id = p_user_id
    AND list_type = 'blacklist'
  ) INTO v_is_blacklisted;
  
  IF v_is_blacklisted THEN
    RETURN false;
  END IF;
  
  -- Check if whitelist is enforced (private lobby)
  IF NOT v_lobby.is_public THEN
    SELECT EXISTS(
      SELECT 1 FROM lobby_access_lists
      WHERE lobby_id = p_lobby_id
      AND user_id = p_user_id
      AND list_type = 'whitelist'
    ) INTO v_is_whitelisted;
    
    IF NOT v_is_whitelisted THEN
      RETURN false;
    END IF;
  END IF;
  
  -- Check password if required
  IF v_lobby.password_hash IS NOT NULL THEN
    -- In production, use proper password hashing (bcrypt/scrypt)
    -- For now, simple comparison (you should hash p_password and compare)
    IF v_lobby.password_hash != p_password THEN
      RETURN false;
    END IF;
  END IF;
  
  RETURN true;
END;
$$;

-- Function to get lobby count for a user (to enforce 3 lobby limit)
CREATE OR REPLACE FUNCTION get_user_lobby_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM lobbies
  WHERE owner_user_id = p_user_id;
  
  RETURN v_count;
END;
$$;

-- Add comment for documentation
COMMENT ON TABLE lobbies IS 'Separate lobby/server instances that users can create and join';
COMMENT ON TABLE lobby_access_lists IS 'Whitelist and blacklist for lobby access control';
COMMENT ON FUNCTION can_user_join_lobby IS 'Checks if a user has permission to join a specific lobby';
COMMENT ON FUNCTION get_user_lobby_count IS 'Returns how many lobbies a user owns (max 3 allowed)';
