-- Fix "infinite recursion detected in policy for relation lobbies" introduced
-- by add_lobby_admins.sql.
--
-- user_is_lobby_admin() is called from lobby_access_lists' OWN RLS policies
-- (it has to be, to decide "can this admin see/manage the list") and from
-- lobbies' UPDATE policy. It's SECURITY DEFINER specifically so that inner
-- query bypasses RLS entirely -- otherwise checking "is this user an admin"
-- would itself be subject to lobby_access_lists' policies, one of which
-- calls user_is_lobby_admin() again, looping forever.
--
-- The bug: it was declared LANGUAGE sql. Simple single-statement SQL
-- functions are eligible for the planner's function-inlining optimization,
-- which can flatten the function body directly into the calling query --
-- and once inlined, it no longer runs as its own call with the definer's
-- privileges, so the "bypass RLS" guarantee silently doesn't hold and the
-- recursion isn't prevented. Every other SECURITY DEFINER function in this
-- schema (can_user_join_lobby, get_user_lobby_count, transfer_lobby_ownership)
-- is LANGUAGE plpgsql, which the planner never inlines -- this brings
-- user_is_lobby_admin in line with that and closes the loophole.

CREATE OR REPLACE FUNCTION public.user_is_lobby_admin(p_lobby_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.lobby_access_lists al
    WHERE al.lobby_id = p_lobby_id
    AND al.user_id = auth.uid()
    AND al.list_type = 'admin'
  );
END;
$$;

COMMENT ON FUNCTION public.user_is_lobby_admin IS 'True if the current user has been promoted to admin for this lobby by its owner. LANGUAGE plpgsql deliberately -- see migration header for why LANGUAGE sql caused infinite RLS recursion.';
