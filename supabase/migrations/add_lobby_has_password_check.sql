-- Create function to check if a lobby requires a password
-- This is needed because password_hash may not be visible to non-owners
CREATE OR REPLACE FUNCTION public.lobby_has_password(p_lobby_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_password boolean;
BEGIN
  SELECT (password_hash IS NOT NULL) INTO v_has_password
  FROM public.lobbies
  WHERE id = p_lobby_id;
  
  RETURN COALESCE(v_has_password, false);
END;
$$;

COMMENT ON FUNCTION public.lobby_has_password IS 'Checks if a lobby requires a password to join (without exposing the hash)';

-- Create function to check user's access status for a lobby
-- Returns: 'owner', 'whitelisted', 'blacklisted', or 'none'
CREATE OR REPLACE FUNCTION public.get_user_lobby_access_status(p_lobby_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid;
  v_is_blacklisted boolean;
  v_is_whitelisted boolean;
BEGIN
  -- Check if owner
  SELECT owner_user_id INTO v_owner_id
  FROM public.lobbies
  WHERE id = p_lobby_id;
  
  IF v_owner_id = p_user_id THEN
    RETURN 'owner';
  END IF;
  
  -- Check if blacklisted
  SELECT EXISTS(
    SELECT 1 FROM public.lobby_access_lists
    WHERE lobby_id = p_lobby_id
    AND user_id = p_user_id
    AND list_type = 'blacklist'
  ) INTO v_is_blacklisted;
  
  IF v_is_blacklisted THEN
    RETURN 'blacklisted';
  END IF;
  
  -- Check if whitelisted
  SELECT EXISTS(
    SELECT 1 FROM public.lobby_access_lists
    WHERE lobby_id = p_lobby_id
    AND user_id = p_user_id
    AND list_type = 'whitelist'
  ) INTO v_is_whitelisted;
  
  IF v_is_whitelisted THEN
    RETURN 'whitelisted';
  END IF;
  
  RETURN 'none';
END;
$$;

COMMENT ON FUNCTION public.get_user_lobby_access_status IS 'Gets the access status of a user for a specific lobby';
