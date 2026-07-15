-- v1 (fix_lobby_admin_recursion.sql) assumed a SECURITY DEFINER function
-- genuinely bypasses RLS on the table it queries, and that only LANGUAGE sql
-- inlining was defeating that. It wasn't -- SECURITY DEFINER isn't bypassing
-- RLS in this project at all (the function's owner apparently isn't treated
-- as exempt from RLS on lobby_access_lists here), so ANY function that
-- queries lobby_access_lists, called from lobby_access_lists' own policy,
-- recurses regardless of language.
--
-- Real fix: stop storing "is this user an admin" as rows inside
-- lobby_access_lists -- the very table whose own policy needs to check it --
-- and store it directly on the lobbies row instead, as admin_user_ids.
-- Checking "auth.uid() = ANY(admin_user_ids)" from lobbies' own policies is a
-- plain per-row column comparison, not a new query, so it can never
-- retrigger RLS on any table. lobby_access_lists' policies then check admin
-- status via a subquery into lobbies (a different table whose policies have
-- no dependency back onto lobby_access_lists), so the dependency graph is
-- acyclic and recursion is impossible by construction -- no reliance on
-- SECURITY DEFINER/RLS-bypass behavior at all.

ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS admin_user_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill from the (now-abandoned) list_type='admin' rows added by
-- add_lobby_admins.sql, then stop using lobby_access_lists for this.
UPDATE lobbies l
SET admin_user_ids = (
  SELECT COALESCE(array_agg(al.user_id), '{}')
  FROM lobby_access_lists al
  WHERE al.lobby_id = l.id AND al.list_type = 'admin'
);

DELETE FROM lobby_access_lists WHERE list_type = 'admin';

ALTER TABLE lobby_access_lists DROP CONSTRAINT IF EXISTS lobby_access_lists_list_type_check;
ALTER TABLE lobby_access_lists ADD CONSTRAINT lobby_access_lists_list_type_check
  CHECK (list_type IN ('whitelist', 'blacklist'));

-- =====================================================
-- LOBBIES -- plain column checks only, no subqueries, so these can never
-- retrigger RLS on any table (including themselves)
-- =====================================================

DROP POLICY IF EXISTS "Anyone can view public lobbies" ON public.lobbies;
CREATE POLICY "Anyone can view public lobbies" ON public.lobbies
  FOR SELECT
  USING (is_public = true OR owner_user_id = auth.uid() OR auth.uid() = ANY(admin_user_ids));

DROP POLICY IF EXISTS "Owners and admins can update their lobbies" ON public.lobbies;
CREATE POLICY "Owners and admins can update their lobbies" ON public.lobbies
  FOR UPDATE
  USING (auth.uid() = owner_user_id OR auth.uid() = ANY(admin_user_ids))
  WITH CHECK (auth.uid() = owner_user_id OR auth.uid() = ANY(admin_user_ids));

-- =====================================================
-- LOBBY ACCESS LISTS -- admin check subqueries into lobbies (a different
-- table with no policy that depends back on lobby_access_lists), so this
-- terminates and can't cycle
-- =====================================================

DROP POLICY IF EXISTS "Anyone can view access lists for lobbies they're in, own, or admin" ON public.lobby_access_lists;
CREATE POLICY "Anyone can view access lists for lobbies they're in, own, or admin"
  ON public.lobby_access_lists FOR SELECT
  USING (
    auth.uid() IN (SELECT owner_user_id FROM public.lobbies WHERE id = lobby_id)
    OR auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.lobbies l WHERE l.id = lobby_id AND auth.uid() = ANY(l.admin_user_ids))
  );

DROP POLICY IF EXISTS "Lobby admins can manage whitelist and blacklist entries" ON public.lobby_access_lists;
CREATE POLICY "Lobby admins can manage whitelist and blacklist entries"
  ON public.lobby_access_lists FOR ALL
  USING (EXISTS (SELECT 1 FROM public.lobbies l WHERE l.id = lobby_id AND auth.uid() = ANY(l.admin_user_ids)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lobbies l WHERE l.id = lobby_id AND auth.uid() = ANY(l.admin_user_ids)));

-- No policy references it anymore -- everything above uses plain column
-- checks/subqueries into lobbies instead.
DROP FUNCTION IF EXISTS public.user_is_lobby_admin(uuid);

-- =====================================================
-- OWNERSHIP TRANSFER -- update to move admin_user_ids instead of
-- lobby_access_lists rows
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

  -- The new owner doesn't need an admin entry (owner supersedes it).
  UPDATE public.lobbies
  SET owner_user_id = p_new_owner_user_id,
      admin_user_ids = array_remove(admin_user_ids, p_new_owner_user_id)
  WHERE id = p_lobby_id;

  -- Give the outgoing owner admin rights so they aren't suddenly locked out
  -- of the atrium they just handed off.
  UPDATE public.lobbies
  SET admin_user_ids = array_append(admin_user_ids, v_owner_user_id)
  WHERE id = p_lobby_id AND NOT (v_owner_user_id = ANY(admin_user_ids));

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.transfer_lobby_ownership IS 'Owner-only: reassigns lobby ownership, verified server-side. Demotes the outgoing owner to admin (admin_user_ids) and clears any admin entry for the incoming owner.';
