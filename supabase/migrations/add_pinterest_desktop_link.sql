-- Letting the desktop app use a web account's Pinterest connection.
--
-- Desktop has no Supabase account: its identity is local, its vault is a
-- SQLite file, and the shim it uses in place of the real client has no
-- .functions at all. So it cannot authenticate to pinterest-api the way the
-- web app does, and it has nowhere to hang a Pinterest connection of its own.
--
-- Rather than give the desktop app Pinterest's tokens -- which would put a
-- refresh token on the user's disk, and mean writing token refresh a second
-- time in a second place -- it is given an opaque token that means only "act
-- as this user, for Pinterest reads". The Pinterest tokens stay where they
-- are: on the server, in a table no client can read.
--
-- Two steps, because the thing a person can retype has to be short, and a
-- short secret must not be long-lived:
--
--   1. The web app, where the user is signed in, asks for a PAIRING CODE.
--      Eight characters, ten minutes, single use.
--   2. The desktop app redeems that code for a LINK TOKEN, which is long,
--      unguessable, and never displayed.
--
-- Both are stored as SHA-256 hashes. A leaked database backup then yields
-- nothing usable, the same way a password table should not.

-- =====================================================
-- Short-lived pairing codes.
-- =====================================================
CREATE TABLE IF NOT EXISTS pinterest_desktop_pairings (
  code_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS pinterest_desktop_pairings_expires_idx
  ON pinterest_desktop_pairings (expires_at);

ALTER TABLE pinterest_desktop_pairings ENABLE ROW LEVEL SECURITY;

-- Deny-all, stated rather than implied. RLS with no policies already denies
-- everything, but an empty policy list reads like an oversight in review.
CREATE POLICY "No direct client access" ON pinterest_desktop_pairings
  FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- Long-lived link tokens, one per paired desktop install.
-- =====================================================
CREATE TABLE IF NOT EXISTS pinterest_desktop_links (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS pinterest_desktop_links_user_idx
  ON pinterest_desktop_links (user_id);

ALTER TABLE pinterest_desktop_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No direct client access" ON pinterest_desktop_links
  FOR ALL USING (false) WITH CHECK (false);

-- =====================================================
-- Client-safe surface: how many desktop installs are linked, and a way to
-- cut them all off. Neither returns a token, and both act only on the
-- calling user's own rows.
--
-- LANGUAGE plpgsql deliberately, as with the other functions in this
-- integration: a LANGUAGE sql function is eligible for planner inlining,
-- which can silently defeat SECURITY DEFINER's RLS bypass.
-- =====================================================
CREATE OR REPLACE FUNCTION public.count_pinterest_desktop_links()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  total integer;
BEGIN
  SELECT count(*) INTO total
  FROM public.pinterest_desktop_links
  WHERE user_id = auth.uid();
  RETURN COALESCE(total, 0);
END;
$$;

COMMENT ON FUNCTION public.count_pinterest_desktop_links IS
  'How many desktop installs can currently read this account''s Pinterest boards.';

CREATE OR REPLACE FUNCTION public.revoke_pinterest_desktop_links()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.pinterest_desktop_links
  WHERE user_id = auth.uid();
  GET DIAGNOSTICS removed = ROW_COUNT;

  -- Any half-finished pairing goes too. Revoking should leave nothing behind
  -- that could still become access a minute later.
  DELETE FROM public.pinterest_desktop_pairings
  WHERE user_id = auth.uid();

  RETURN COALESCE(removed, 0);
END;
$$;

COMMENT ON FUNCTION public.revoke_pinterest_desktop_links IS
  'Disconnects every linked desktop install from this account''s Pinterest connection.';

-- Disconnecting Pinterest entirely should not leave desktop installs holding
-- a token that would spring back to life if it were reconnected later.
CREATE OR REPLACE FUNCTION public.disconnect_pinterest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.pinterest_connections WHERE user_id = auth.uid();
  DELETE FROM public.pinterest_desktop_links WHERE user_id = auth.uid();
  DELETE FROM public.pinterest_desktop_pairings WHERE user_id = auth.uid();
END;
$$;
