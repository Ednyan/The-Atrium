-- Three related fixes around admins and password sessions.
--
-- 1. REGRESSION in fix_whitelist_private_access.sql: that migration rewrote
--    can_user_join_lobby and, in the process, undid two things
--    add_lobby_password_verification.sql had deliberately established --
--      (a) it reverted the password check from bcrypt (crypt()) back to a
--          plaintext `v_lobby.password_hash != p_password` comparison. Since
--          password_hash is stored bcrypt-hashed, that comparison is ALWAYS
--          true, so every non-owner/non-admin password attempt was silently
--          rejected (regular users simply could no longer enter a
--          password-protected atrium at all).
--      (b) it dropped the `INSERT INTO lobby_sessions` that records a
--          successful password entry. Both the traces/layers RLS
--          (user_can_access_lobby) and the client's refresh check rely on
--          that row existing, so without it a password atrium showed no
--          content and re-prompted on every refresh.
--    Restore both (bcrypt verify + session insert), keeping the owner/admin
--    bypass and whitelist logic fix_whitelist_private_access.sql added.
--
-- 2. user_can_access_lobby (the SELECT gate on traces/layers) was never
--    taught about admin_user_ids -- admins arrived as a lobbies column only
--    in fix_lobby_admin_recursion_v2.sql, after this function was last
--    written. So a non-owner admin could not read a password-protected
--    atrium's traces/layers (empty canvas), even though the usage bar --
--    get_lobby_size_bytes, a SECURITY DEFINER function that bypasses RLS --
--    still reported the real size, which is exactly the "looks empty but the
--    usage bar says otherwise" symptom. Give admins the owner's bypass.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. can_user_join_lobby: bcrypt verify + record session, owner/admin bypass.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_user_join_lobby(
  p_lobby_id uuid,
  p_user_id uuid,
  p_password text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lobby public.lobbies%ROWTYPE;
  v_is_blacklisted boolean;
  v_is_whitelisted boolean;
BEGIN
  SELECT * INTO v_lobby FROM public.lobbies WHERE id = p_lobby_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Owner and admins always join, bypassing whitelist and password.
  IF v_lobby.owner_user_id = p_user_id OR p_user_id = ANY(v_lobby.admin_user_ids) THEN
    RETURN true;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.lobby_access_lists
    WHERE lobby_id = p_lobby_id AND user_id = p_user_id AND list_type = 'blacklist'
  ) INTO v_is_blacklisted;
  IF v_is_blacklisted THEN
    RETURN false;
  END IF;

  IF NOT v_lobby.is_public THEN
    SELECT EXISTS(
      SELECT 1 FROM public.lobby_access_lists
      WHERE lobby_id = p_lobby_id AND user_id = p_user_id AND list_type = 'whitelist'
    ) INTO v_is_whitelisted;
    IF NOT v_is_whitelisted THEN
      RETURN false;
    END IF;
  END IF;

  -- Bcrypt-verified (not plaintext), and record a verified session on success
  -- so RLS (user_can_access_lobby) and the client refresh check can trust it.
  IF v_lobby.password_hash IS NOT NULL THEN
    IF p_password IS NULL OR v_lobby.password_hash != crypt(p_password, v_lobby.password_hash) THEN
      RETURN false;
    END IF;
    INSERT INTO public.lobby_sessions (lobby_id, user_id)
    VALUES (p_lobby_id, p_user_id)
    ON CONFLICT (lobby_id, user_id) DO UPDATE SET verified_at = now();
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.can_user_join_lobby IS 'Server-side gate for actually joining a lobby: owner/admin always allowed (bypassing whitelist+password), otherwise blacklist/whitelist/bcrypt-password checks apply. Records a lobby_sessions row on a successful password entry so RLS and the client can trust the verification afterwards.';

-- ---------------------------------------------------------------------
-- 2. user_can_access_lobby: admins get the same bypass as the owner.
-- plpgsql (not sql) per this project's rule that SECURITY DEFINER helpers
-- avoid the planner inlining that once ran one of these under caller RLS.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_lobby(p_lobby_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_uid uuid := (select auth.uid());
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.lobbies l
    WHERE l.id = p_lobby_id
    AND (
      l.owner_user_id = v_uid
      OR v_uid = ANY(l.admin_user_ids)
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.lobby_access_lists bl
          WHERE bl.lobby_id = l.id AND bl.user_id = v_uid AND bl.list_type = 'blacklist'
        )
        AND (
          l.is_public = true
          OR EXISTS (
            SELECT 1 FROM public.lobby_access_lists wl
            WHERE wl.lobby_id = l.id AND wl.user_id = v_uid AND wl.list_type = 'whitelist'
          )
        )
        AND (
          l.password_hash IS NULL
          OR EXISTS (
            SELECT 1 FROM public.lobby_sessions ls
            WHERE ls.lobby_id = l.id AND ls.user_id = v_uid
          )
        )
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION public.user_can_access_lobby IS 'Mirrors can_user_join_lobby membership logic (owner or admin always; otherwise public/whitelisted and not blacklisted, and password-verified via lobby_sessions if the lobby has a password) for use in traces/layers RLS policies.';
