-- Fix: password-protected lobbies stored and compared passwords in
-- PLAINTEXT. `password_hash` was misleadingly named -- can_user_join_lobby()
-- (add_lobby_system.sql) did a literal `!=` string comparison against the
-- raw submitted password, and clients (LobbyBrowser.tsx, LobbyManagement.tsx)
-- insert/update it with the plain password text.
--
-- Also, even once a password was correctly entered, that check happened
-- once client-side at join time and nothing server-side ever remembered it,
-- so RLS on traces/layers had no way to tell a verified user from one who'd
-- never entered the password -- see the "Known residual gap" note in
-- scope_traces_layers_to_lobby_membership.sql.
--
-- This migration:
--  1. Adds real bcrypt hashing (pgcrypto) for lobby passwords, backfilling
--     existing plaintext values in place.
--  2. Adds a lobby_sessions table recording "this user has proven they know
--     the current password for this lobby", populated by can_user_join_lobby()
--     on success.
--  3. Updates user_can_access_lobby() (the traces/layers RLS helper from
--     scope_traces_layers_to_lobby_membership.sql) to require a matching
--     lobby_sessions row whenever a lobby has a password, closing the gap.
--  4. Clears lobby_sessions for a lobby whenever its password changes (set,
--     changed, or removed), forcing re-verification.
--
-- No client changes are required for password create/update -- the trigger
-- below transparently hashes whatever plaintext the existing insert/update
-- calls send.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Backfill: hash any existing plaintext passwords in place. Bcrypt
-- hashes always match '^\$2[aby]\$[0-9]{2}\$', so this is safe to re-run.
-- ---------------------------------------------------------------------
UPDATE public.lobbies
SET password_hash = crypt(password_hash, gen_salt('bf'))
WHERE password_hash IS NOT NULL
  AND password_hash !~ '^\$2[aby]\$[0-9]{2}\$';

-- ---------------------------------------------------------------------
-- 2. lobby_sessions: records a successful password verification.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lobby_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id uuid NOT NULL REFERENCES public.lobbies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lobby_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lobby_sessions_lobby ON public.lobby_sessions(lobby_id);
CREATE INDEX IF NOT EXISTS idx_lobby_sessions_user ON public.lobby_sessions(user_id);

ALTER TABLE public.lobby_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own lobby sessions" ON public.lobby_sessions;
CREATE POLICY "Users can view their own lobby sessions" ON public.lobby_sessions
  FOR SELECT
  USING (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policies: rows are only ever written by the
-- SECURITY DEFINER functions below, which run with the function owner's
-- privileges and bypass RLS entirely.

COMMENT ON TABLE public.lobby_sessions IS 'Records that a user has successfully entered the current password for a lobby. Used by user_can_access_lobby() to enforce password protection at the RLS layer, not just client-side at join time. Cleared whenever the lobby password changes.';

-- ---------------------------------------------------------------------
-- 3. Auto-hash password_hash on write, and clear sessions when it changes.
-- search_path includes `extensions` (Supabase's default install location
-- for pgcrypto) as well as `public` since we can't be sure which schema
-- pgcrypto landed in on this project.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hash_lobby_password_and_clear_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    DELETE FROM lobby_sessions WHERE lobby_id = NEW.id;
  END IF;

  IF NEW.password_hash IS NOT NULL AND NEW.password_hash !~ '^\$2[aby]\$[0-9]{2}\$' THEN
    NEW.password_hash := crypt(NEW.password_hash, gen_salt('bf'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lobbies_hash_password ON public.lobbies;
CREATE TRIGGER lobbies_hash_password
  BEFORE INSERT OR UPDATE ON public.lobbies
  FOR EACH ROW
  EXECUTE FUNCTION public.hash_lobby_password_and_clear_sessions();

-- ---------------------------------------------------------------------
-- 4. can_user_join_lobby(): verify with crypt() instead of plaintext `!=`,
-- and record a lobby_sessions row on success so RLS can trust it later.
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
  v_lobby lobbies%ROWTYPE;
  v_is_blacklisted boolean;
  v_is_whitelisted boolean;
BEGIN
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

  -- Check password if required (bcrypt-verified, not plaintext)
  IF v_lobby.password_hash IS NOT NULL THEN
    IF p_password IS NULL OR v_lobby.password_hash != crypt(p_password, v_lobby.password_hash) THEN
      RETURN false;
    END IF;

    INSERT INTO lobby_sessions (lobby_id, user_id)
    VALUES (p_lobby_id, p_user_id)
    ON CONFLICT (lobby_id, user_id) DO UPDATE SET verified_at = now();
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.can_user_join_lobby IS 'Checks if a user has permission to join a specific lobby. Verifies the password with bcrypt (not plaintext) and records a lobby_sessions row on success so RLS (see user_can_access_lobby) can enforce password protection after the initial join too.';

-- ---------------------------------------------------------------------
-- 5. user_can_access_lobby(): require a verified session for password-
-- protected lobbies, in addition to the existing membership checks.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_lobby(p_lobby_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lobbies l
    WHERE l.id = p_lobby_id
    AND (
      l.owner_user_id = (select auth.uid())
      OR (
        NOT EXISTS (
          SELECT 1 FROM public.lobby_access_lists bl
          WHERE bl.lobby_id = l.id
          AND bl.user_id = (select auth.uid())
          AND bl.list_type = 'blacklist'
        )
        AND (
          l.is_public = true
          OR EXISTS (
            SELECT 1 FROM public.lobby_access_lists wl
            WHERE wl.lobby_id = l.id
            AND wl.user_id = (select auth.uid())
            AND wl.list_type = 'whitelist'
          )
        )
        AND (
          l.password_hash IS NULL
          OR EXISTS (
            SELECT 1 FROM public.lobby_sessions ls
            WHERE ls.lobby_id = l.id
            AND ls.user_id = (select auth.uid())
          )
        )
      )
    )
  );
$$;

COMMENT ON FUNCTION public.user_can_access_lobby IS 'Mirrors can_user_join_lobby membership logic (owner, or public/whitelisted and not blacklisted, and password-verified via lobby_sessions if the lobby has a password) for use in traces/layers RLS policies.';
