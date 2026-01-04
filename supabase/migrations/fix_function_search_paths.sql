-- Fix function search paths for security
-- This prevents search_path manipulation attacks by setting an immutable search_path

-- Fix can_change_display_name function
CREATE OR REPLACE FUNCTION public.can_change_display_name()
RETURNS boolean AS $$
BEGIN
  RETURN (
    SELECT display_name_last_changed IS NULL 
    OR display_name_last_changed < now() - interval '15 days'
    FROM public.profiles
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Fix can_user_join_lobby function
CREATE OR REPLACE FUNCTION public.can_user_join_lobby(
  p_lobby_id uuid,
  p_user_id uuid,
  p_password text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lobby public.lobbies%ROWTYPE;
  v_is_blacklisted boolean;
  v_is_whitelisted boolean;
  v_password_required boolean;
BEGIN
  -- Get lobby info
  SELECT * INTO v_lobby FROM public.lobbies WHERE id = p_lobby_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  -- Owner can always join
  IF v_lobby.owner_user_id = p_user_id THEN
    RETURN true;
  END IF;
  
  -- Check if blacklisted
  SELECT EXISTS(
    SELECT 1 FROM public.lobby_access_lists
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
      SELECT 1 FROM public.lobby_access_lists
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
    IF v_lobby.password_hash != p_password THEN
      RETURN false;
    END IF;
  END IF;
  
  RETURN true;
END;
$$;

-- Fix get_user_lobby_count function
CREATE OR REPLACE FUNCTION public.get_user_lobby_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.lobbies
  WHERE owner_user_id = p_user_id;
  
  RETURN v_count;
END;
$$;

-- Fix cleanup_old_traces function
CREATE OR REPLACE FUNCTION public.cleanup_old_traces()
RETURNS void AS $$
BEGIN
    DELETE FROM public.traces
    WHERE id NOT IN (
        SELECT id FROM public.traces
        ORDER BY created_at DESC
        LIMIT 1000
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

-- Fix cleanup_expired_trails function (if it exists)
-- This function may have been created via dashboard or other means
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cleanup_expired_trails' AND pronamespace = 'public'::regnamespace) THEN
    EXECUTE 'ALTER FUNCTION public.cleanup_expired_trails() SET search_path = ''''';
  END IF;
END;
$$;
