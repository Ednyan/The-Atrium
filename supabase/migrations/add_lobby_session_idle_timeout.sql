-- Password-protected atriums re-asked for the password on every single
-- visit -- including a plain browser refresh while already inside one --
-- even though lobby_sessions (add_lobby_password_verification.sql) already
-- durably records a successful password entry. The client-side gate in
-- App.tsx never checked that table at all; it only asked "does this lobby
-- have a password", and if so always blocked with password_required.
--
-- This migration adds a client-callable RPC that:
--   1. Checks the same owner/blacklist/whitelist membership rules as
--      user_can_access_lobby(), so it's a single source of truth for "does
--      this user currently have access".
--   2. For a password-protected lobby, requires a lobby_sessions row that's
--      still within a 30-minute idle window (not just "exists forever") --
--      and if it IS still within that window, refreshes verified_at to
--      now(), extending the window. Combined with a periodic heartbeat call
--      from inside the atrium (while the user shows real activity), this
--      means an actively-used session never goes stale, but walking away
--      for 30+ minutes and then reloading correctly asks again.
--
-- user_can_access_lobby() itself is left untouched (its password check has
-- no expiry) since it's also relied on by traces/layers RLS, where an
-- expiring grant would kick a still-connected, actively-editing user's
-- writes mid-session the moment the clock lapsed -- not what this is for.
-- This is purely about whether the client shows the password PROMPT again.

CREATE OR REPLACE FUNCTION public.check_and_touch_lobby_access(p_lobby_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lobby lobbies%ROWTYPE;
  v_uid uuid := auth.uid();
  v_touched boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_lobby FROM lobbies WHERE id = p_lobby_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_lobby.owner_user_id = v_uid THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM lobby_access_lists
    WHERE lobby_id = p_lobby_id AND user_id = v_uid AND list_type = 'blacklist'
  ) THEN
    RETURN false;
  END IF;

  IF NOT v_lobby.is_public THEN
    IF NOT EXISTS (
      SELECT 1 FROM lobby_access_lists
      WHERE lobby_id = p_lobby_id AND user_id = v_uid AND list_type = 'whitelist'
    ) THEN
      RETURN false;
    END IF;
  END IF;

  IF v_lobby.password_hash IS NOT NULL THEN
    UPDATE lobby_sessions
    SET verified_at = now()
    WHERE lobby_id = p_lobby_id
      AND user_id = v_uid
      AND verified_at > now() - interval '30 minutes'
    RETURNING true INTO v_touched;

    IF v_touched IS NOT TRUE THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.check_and_touch_lobby_access IS 'Client-callable fast-path access check for App.tsx''s direct-URL/refresh entry point. Mirrors user_can_access_lobby''s membership rules but additionally expires a password verification after 30 minutes of inactivity (extending it on each call within that window) so a refresh while actively using a password-protected atrium never re-prompts, but returning after a long idle gap does.';

-- Lightweight heartbeat: just extends an existing verified session, called
-- periodically from LobbyScene while the user shows real activity. A no-op
-- if the lobby has no password or this user never verified one (no row to
-- touch), so it never grants access on its own.
CREATE OR REPLACE FUNCTION public.touch_lobby_session(p_lobby_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.lobby_sessions
  SET verified_at = now()
  WHERE lobby_id = p_lobby_id AND user_id = (select auth.uid());
$$;

COMMENT ON FUNCTION public.touch_lobby_session IS 'Heartbeat called periodically from inside an atrium while the user shows activity, keeping their lobby_sessions.verified_at fresh so check_and_touch_lobby_access''s 30-minute idle window never lapses during a long continuously-active visit.';
