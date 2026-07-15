-- Add an "admin" role for atrium collaborators, promoted by the owner.
-- Admins get full parity with the owner for day-to-day management (settings,
-- whitelist/blacklist moderation, password, autosave) but cannot promote/
-- demote other admins or transfer/give up ownership -- those stay
-- owner-exclusive, enforced at the database layer below (not just hidden in
-- the UI), since lobby_access_lists and lobbies are reachable directly via
-- the Supabase API.

-- Widen list_type to add 'admin' alongside the existing whitelist/blacklist.
ALTER TABLE lobby_access_lists DROP CONSTRAINT IF EXISTS lobby_access_lists_list_type_check;
ALTER TABLE lobby_access_lists ADD CONSTRAINT lobby_access_lists_list_type_check
  CHECK (list_type IN ('whitelist', 'blacklist', 'admin'));

CREATE OR REPLACE FUNCTION public.user_is_lobby_admin(p_lobby_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lobby_access_lists al
    WHERE al.lobby_id = p_lobby_id
    AND al.user_id = (select auth.uid())
    AND al.list_type = 'admin'
  );
$$;

COMMENT ON FUNCTION public.user_is_lobby_admin IS 'True if the current user has been promoted to admin for this lobby by its owner.';

-- =====================================================
-- LOBBIES -- let admins update settings, but never owner_user_id itself
-- =====================================================

-- A plain RLS policy can only see the NEW row, not compare it against OLD, so
-- "admins can update settings but not reassign ownership" needs a trigger:
-- any change to owner_user_id is blocked unless it happens inside
-- transfer_lobby_ownership() below (which flips a transaction-local flag).
CREATE OR REPLACE FUNCTION public.protect_lobby_owner_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     AND current_setting('app.allow_owner_transfer', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'owner_user_id can only be changed via transfer_lobby_ownership()';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_lobby_owner_column_trigger ON public.lobbies;
CREATE TRIGGER protect_lobby_owner_column_trigger
  BEFORE UPDATE ON public.lobbies
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_lobby_owner_column();

DROP POLICY IF EXISTS "Owners can update their lobbies" ON public.lobbies;
CREATE POLICY "Owners and admins can update their lobbies"
  ON public.lobbies FOR UPDATE
  USING (auth.uid() = owner_user_id OR public.user_is_lobby_admin(id))
  WITH CHECK (auth.uid() = owner_user_id OR public.user_is_lobby_admin(id));

-- =====================================================
-- LOBBY ACCESS LISTS -- admins can moderate whitelist/blacklist, but the
-- 'admin' list itself (who has admin rights) stays owner-only
-- =====================================================

DROP POLICY IF EXISTS "Anyone can view access lists for lobbies they're in or own" ON public.lobby_access_lists;
CREATE POLICY "Anyone can view access lists for lobbies they're in, own, or admin"
  ON public.lobby_access_lists FOR SELECT
  USING (
    auth.uid() IN (
      SELECT owner_user_id FROM public.lobbies WHERE id = lobby_id
    )
    OR auth.uid() = user_id
    OR public.user_is_lobby_admin(lobby_id)
  );

DROP POLICY IF EXISTS "Lobby owners can manage access lists" ON public.lobby_access_lists;
CREATE POLICY "Lobby owners can manage all access list entries"
  ON public.lobby_access_lists FOR ALL
  USING (
    auth.uid() IN (
      SELECT owner_user_id FROM public.lobbies WHERE id = lobby_id
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT owner_user_id FROM public.lobbies WHERE id = lobby_id
    )
  );

CREATE POLICY "Lobby admins can manage whitelist and blacklist entries"
  ON public.lobby_access_lists FOR ALL
  USING (public.user_is_lobby_admin(lobby_id) AND list_type <> 'admin')
  WITH CHECK (public.user_is_lobby_admin(lobby_id) AND list_type <> 'admin');

-- =====================================================
-- OWNERSHIP TRANSFER -- owner-only, verified server-side regardless of
-- what the calling client sends
-- =====================================================

CREATE OR REPLACE FUNCTION public.transfer_lobby_ownership(
  p_lobby_id uuid,
  p_new_owner_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner_user_id uuid;
BEGIN
  SELECT owner_user_id INTO v_owner_user_id FROM public.lobbies WHERE id = p_lobby_id;

  IF v_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Lobby not found';
  END IF;

  IF v_owner_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Only the current owner can transfer ownership';
  END IF;

  IF p_new_owner_user_id = v_owner_user_id THEN
    RAISE EXCEPTION 'User is already the owner';
  END IF;

  PERFORM set_config('app.allow_owner_transfer', 'true', true);

  UPDATE public.lobbies SET owner_user_id = p_new_owner_user_id WHERE id = p_lobby_id;

  -- The new owner doesn't need an admin entry (owner supersedes it); drop one
  -- if it existed so the access-list UI doesn't show a redundant/confusing
  -- "admin" badge on the person who is now the owner.
  DELETE FROM public.lobby_access_lists
  WHERE lobby_id = p_lobby_id AND user_id = p_new_owner_user_id AND list_type = 'admin';

  -- Give the outgoing owner admin rights so they aren't suddenly locked out
  -- of the atrium they just handed off.
  INSERT INTO public.lobby_access_lists (lobby_id, user_id, list_type, added_by)
  VALUES (p_lobby_id, v_owner_user_id, 'admin', v_owner_user_id)
  ON CONFLICT (lobby_id, user_id, list_type) DO NOTHING;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.transfer_lobby_ownership IS 'Owner-only: reassigns lobby ownership, verified server-side. Demotes the outgoing owner to admin and clears any admin entry for the incoming owner.';
