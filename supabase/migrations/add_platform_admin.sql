-- Platform-operator access: one account that can see and enter every atrium,
-- and is invisible while doing so in atriums it wouldn't otherwise reach.
--
-- WHY A SEPARATE TABLE, NOT A COLUMN ON profiles
-- profiles has "Users can update own profile" USING (auth.uid() = id), so an
-- is_admin flag living there could be switched on by any user against their
-- own row through the public API -- a straight privilege escalation. This
-- table has RLS enabled and deliberately NO policies, which means no
-- authenticated or anon role can read or write it at all. The functions below
-- are SECURITY DEFINER, so they bypass RLS to read it; membership can only be
-- changed with the service role (the Supabase dashboard/SQL editor).

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  note text
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- NOTE: superseded by fix_platform_admin_recursion.sql, which adds a SELECT
-- policy scoped to the caller's own row. Leaving this table with no policies
-- at all assumed SECURITY DEFINER bypasses RLS; in this project it does not,
-- so is_platform_admin() could never see a row. Writes are still impossible
-- (no INSERT/UPDATE/DELETE policies), which is the part that matters.

INSERT INTO public.platform_admins (user_id, note)
VALUES ('7b4ccdce-bd4f-4d4a-b5b5-ad3f69939999', 'Red_Puer / eduardoparanhos1@gmail.com -- platform operator')
ON CONFLICT (user_id) DO NOTHING;

-- =====================================================================
-- Helpers
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins pa
    WHERE pa.user_id = (select auth.uid())
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin IS 'True for the platform operator account(s) in platform_admins. Grants read access to every atrium; see user_has_member_access for the check that decides invisibility.';

-- The membership rules WITHOUT the admin override -- i.e. "would this user
-- get in on their own merits?". The client calls this to decide whether it
-- entered an atrium legitimately or via operator privilege, and hides its
-- presence entirely in the latter case. Kept as its own function so the two
-- questions can't drift apart: user_can_access_lobby is literally this OR
-- admin.
CREATE OR REPLACE FUNCTION public.user_has_member_access(p_lobby_id uuid)
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
          WHERE bl.lobby_id = l.id
          AND bl.user_id = v_uid
          AND bl.list_type = 'blacklist'
        )
        AND (
          l.is_public = true
          OR EXISTS (
            SELECT 1 FROM public.lobby_access_lists wl
            WHERE wl.lobby_id = l.id
            AND wl.user_id = v_uid
            AND wl.list_type = 'whitelist'
          )
        )
        AND (
          l.password_hash IS NULL
          OR EXISTS (
            SELECT 1 FROM public.lobby_sessions ls
            WHERE ls.lobby_id = l.id
            AND ls.user_id = v_uid
          )
        )
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION public.user_has_member_access IS 'Membership rules with NO platform-admin override -- "would this user get in without special privileges?". Used by the client to decide whether to enter invisibly.';

GRANT EXECUTE ON FUNCTION public.user_has_member_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

-- =====================================================================
-- Access: membership OR platform admin
-- =====================================================================

CREATE OR REPLACE FUNCTION public.user_can_access_lobby(p_lobby_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
BEGIN
  -- Read access only. user_can_edit_lobby is deliberately untouched, so the
  -- operator can observe a private atrium but not silently alter it -- an
  -- invisible editor would be considerably harder to reason about than an
  -- invisible reader.
  RETURN public.user_has_member_access(p_lobby_id) OR public.is_platform_admin();
END;
$$;

COMMENT ON FUNCTION public.user_can_access_lobby IS 'Membership (see user_has_member_access) OR the platform operator. Used by traces/layers/locations RLS.';

-- Atrium browser: the operator sees every atrium, not just public ones.
--
-- WARNING: the version originally written here included an EXISTS subquery
-- into lobby_access_lists, copied from an older migration. That reintroduced
-- the exact cycle fix_lobby_admin_recursion_v2.sql had removed (that table's
-- policies subquery into lobbies), and Postgres rejected every read with
-- "infinite recursion detected in policy for relation lobbies".
-- fix_platform_admin_recursion.sql replaces this with plain column checks.
DROP POLICY IF EXISTS "Anyone can view public lobbies" ON public.lobbies;
CREATE POLICY "Anyone can view public lobbies" ON public.lobbies
  FOR SELECT
  USING (
    is_public = true
    OR owner_user_id = (select auth.uid())
    OR (select auth.uid()) = ANY(admin_user_ids)
    OR public.is_platform_admin()
  );

-- =====================================================================
-- Join: the operator gets in without whitelist or password
-- =====================================================================
--
-- Reading rows (RLS) and being allowed through the door (this RPC) are
-- separate gates. Without this the operator could read a private atrium's
-- contents but the join call would still refuse entry.

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

  -- Platform operator: in, regardless of whitelist, blacklist or password.
  -- Tested against p_user_id rather than is_platform_admin(), since this
  -- function receives the user as an argument instead of reading auth.uid().
  IF EXISTS (SELECT 1 FROM public.platform_admins pa WHERE pa.user_id = p_user_id) THEN
    RETURN true;
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
