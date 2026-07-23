-- Whitelisted users could not enter a private atrium even when they knew its
-- ID and were whitelisted -- fix_lobby_admin_recursion_v2.sql's rewrite of
-- the `lobbies` SELECT policy (needed to break a genuine RLS recursion
-- between `lobbies` and `lobby_access_lists`) only allowed is_public,
-- owner, or admin to see a private lobby's row. Any *plain* whitelisted
-- user hit RLS on the very first `.from('lobbies').select(...).eq('id',
-- lobbyId)` lookup (both clicking a lobby and "Join by ID"), which came
-- back empty and was reported to the user as "Atrium not found" --
-- even though get_user_lobby_access_status() (called right after, and
-- itself unaffected since it reads its own whitelist row via `user_id =
-- auth.uid()`) would have correctly said 'whitelisted'.
--
-- Restoring a whitelist check on `lobbies`' own SELECT policy by querying
-- lobby_access_lists directly would recreate exactly the recursion v2 fixed
-- (lobby_access_lists' own policies subquery back into lobbies for the admin
-- check). So this mirrors the admin_user_ids approach instead: a plain
-- array column on lobbies itself, kept in sync with lobby_access_lists'
-- whitelist rows via trigger, checked as a column comparison (no subquery,
-- no recursion).

ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS whitelisted_user_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill from existing whitelist rows.
UPDATE lobbies l
SET whitelisted_user_ids = (
  SELECT COALESCE(array_agg(al.user_id), '{}')
  FROM lobby_access_lists al
  WHERE al.lobby_id = l.id AND al.list_type = 'whitelist'
);

-- Keep lobbies.whitelisted_user_ids in sync with lobby_access_lists so the
-- access-list table stays the single source of truth for management UI
-- (LobbyManagement's whitelist tab) while the array column is purely a
-- denormalized cache for RLS purposes.
CREATE OR REPLACE FUNCTION public.sync_lobby_whitelist_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lobby_id uuid;
BEGIN
  v_lobby_id := COALESCE(NEW.lobby_id, OLD.lobby_id);

  UPDATE public.lobbies
  SET whitelisted_user_ids = (
    SELECT COALESCE(array_agg(al.user_id), '{}')
    FROM public.lobby_access_lists al
    WHERE al.lobby_id = v_lobby_id AND al.list_type = 'whitelist'
  )
  WHERE id = v_lobby_id;

  RETURN NULL;
END;
$$;

-- No WHEN filter -- Postgres disallows referencing NEW in a WHEN clause on a
-- trigger that also fires for DELETE (NEW doesn't exist for that event), and
-- splitting into separate INSERT/UPDATE vs DELETE triggers just to filter on
-- list_type isn't worth it: the function's recompute is idempotent and cheap
-- (one aggregate query), so firing it unconditionally for every access-list
-- change (including blacklist rows) is harmless, just a touch less precise.
DROP TRIGGER IF EXISTS lobby_access_lists_sync_whitelist ON lobby_access_lists;
CREATE TRIGGER lobby_access_lists_sync_whitelist
  AFTER INSERT OR UPDATE OR DELETE ON lobby_access_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_lobby_whitelist_cache();

-- Restore whitelist visibility -- a plain column check, so it can never
-- retrigger lobby_access_lists' own policies (which is what caused the
-- original recursion when whitelist was checked via a subquery).
DROP POLICY IF EXISTS "Anyone can view public lobbies" ON public.lobbies;
CREATE POLICY "Anyone can view public lobbies" ON public.lobbies
  FOR SELECT
  USING (
    is_public = true
    OR owner_user_id = auth.uid()
    OR auth.uid() = ANY(admin_user_ids)
    OR auth.uid() = ANY(whitelisted_user_ids)
  );

-- get_user_lobby_access_status didn't check admin_user_ids at all (it
-- predates admins being moved onto lobbies directly in
-- fix_lobby_admin_recursion_v2.sql), so an admin looked identical to a
-- plain 'none'/'whitelisted' user to the frontend, which is why the join
-- flow couldn't distinguish "should skip the password prompt" (owner/admin)
-- from "should still be asked for the password" (plain whitelisted).
CREATE OR REPLACE FUNCTION public.get_user_lobby_access_status(p_lobby_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid;
  v_admin_ids uuid[];
  v_is_blacklisted boolean;
  v_is_whitelisted boolean;
BEGIN
  SELECT owner_user_id, admin_user_ids INTO v_owner_id, v_admin_ids
  FROM public.lobbies
  WHERE id = p_lobby_id;

  IF v_owner_id = p_user_id THEN
    RETURN 'owner';
  END IF;

  IF v_admin_ids IS NOT NULL AND p_user_id = ANY(v_admin_ids) THEN
    RETURN 'admin';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.lobby_access_lists
    WHERE lobby_id = p_lobby_id
    AND user_id = p_user_id
    AND list_type = 'blacklist'
  ) INTO v_is_blacklisted;

  IF v_is_blacklisted THEN
    RETURN 'blacklisted';
  END IF;

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

COMMENT ON FUNCTION public.get_user_lobby_access_status IS 'Gets the access status of a user for a specific lobby: owner, admin, whitelisted, blacklisted, or none';

-- can_user_join_lobby (the actual server-side gate `App.tsx`'s handleJoinLobby
-- calls -- the frontend checks above are UX only, this is what actually
-- decides) predates admin_user_ids entirely (last touched in
-- fix_function_search_paths.sql, before fix_lobby_admin_recursion_v2.sql
-- introduced admins living on lobbies directly). Without this fix, an admin
-- who isn't also separately whitelisted would be rejected by the "private
-- lobby requires whitelist" check, and even a whitelisted/public-lobby admin
-- would still be rejected by the password check, since the frontend (now
-- correctly) sends no password for an owner/admin. Admins now bypass both
-- checks exactly like the owner already did.
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
BEGIN
  -- Get lobby info
  SELECT * INTO v_lobby FROM public.lobbies WHERE id = p_lobby_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Owner and admins can always join, private/password requirements included.
  IF v_lobby.owner_user_id = p_user_id OR p_user_id = ANY(v_lobby.admin_user_ids) THEN
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

  -- Check password if required (whitelisted non-admin users still need it)
  IF v_lobby.password_hash IS NOT NULL THEN
    IF v_lobby.password_hash != p_password THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.can_user_join_lobby IS 'Server-side gate for actually joining a lobby: owner/admin always allowed, otherwise blacklist/whitelist/password checks apply.';
