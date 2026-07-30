-- The platform operator could edit atriums it only had access to through
-- operator privilege. It was supposed to be able to look and nothing else.
--
-- HOW IT HAPPENED
-- add_platform_admin.sql rewrote user_can_access_lobby to
--   user_has_member_access(...) OR is_platform_admin()
-- and left user_can_edit_lobby alone, with a comment claiming that kept the
-- operator read-only. It did not. user_can_edit_lobby's first test is:
--   IF NOT public.user_can_access_lobby(p_lobby_id) THEN RETURN false;
-- and after that gate, edit_permission_mode = 'all' -- the default for every
-- atrium -- returns true for anyone who got through. So widening the access
-- function widened editing along with it. Not touching the edit function was
-- not the same as not changing what it does.
--
-- This contradicted what users were told: the privacy policy states the
-- administrator's access is read-only and cannot add, edit or delete anything
-- in an atrium it doesn't own or wasn't invited to.
--
-- THE FIX
-- user_can_edit_lobby now gates on user_has_member_access -- membership as it
-- would be judged with no operator override at all. Everyone else is
-- unaffected: for any user who isn't in platform_admins the two functions
-- return exactly the same thing.
--
-- The operator keeps full read access, and keeps normal editing rights in
-- atriums it genuinely belongs to (owner, admin, whitelisted, public), since
-- user_has_member_access is true there on its own merits.

CREATE OR REPLACE FUNCTION public.user_can_edit_lobby(p_lobby_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_mode text;
  v_owner uuid;
  v_admins uuid[];
BEGIN
  SELECT edit_permission_mode, owner_user_id, admin_user_ids
  INTO v_mode, v_owner, v_admins
  FROM public.lobbies WHERE id = p_lobby_id;

  IF v_mode IS NULL THEN
    RETURN false; -- lobby not found
  END IF;

  -- Membership WITHOUT the operator override. This is the whole fix: it was
  -- user_can_access_lobby, which now also returns true for the operator.
  IF NOT public.user_has_member_access(p_lobby_id) THEN
    RETURN false;
  END IF;

  IF v_owner = (select auth.uid()) OR (select auth.uid()) = ANY(v_admins) THEN
    RETURN true;
  END IF;

  IF v_mode = 'all' THEN
    RETURN true;
  ELSIF v_mode = 'selected' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.lobby_access_lists al
      WHERE al.lobby_id = p_lobby_id
      AND al.user_id = (select auth.uid())
      AND al.list_type = 'editor'
    );
  END IF;

  RETURN false; -- v_mode = 'none'
END;
$$;

COMMENT ON FUNCTION public.user_can_edit_lobby IS 'Gates trace/layer writes per lobbies.edit_permission_mode; owner and admins always pass. Deliberately gated on user_has_member_access, NOT user_can_access_lobby: the platform operator can read every atrium but must never gain write access from that privilege alone.';
