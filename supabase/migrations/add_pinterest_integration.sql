-- Pinterest OAuth connection storage + a generic link_url for embed traces
-- (used for "styled link card" fallback when an embed's hotlinked image
-- fails to load -- lets the card link to the original page even though the
-- image itself isn't the click target).

-- =====================================================
-- pinterest_connections -- tokens are sensitive and only ever touched by
-- the Edge Functions (using the service-role key, which bypasses RLS
-- entirely). RLS denies ALL direct client access, including the owning
-- user -- the two SECURITY DEFINER functions below are the only
-- client-safe surface, and neither of them ever returns a token.
-- =====================================================

CREATE TABLE IF NOT EXISTS pinterest_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  pinterest_username text,
  connected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pinterest_connections ENABLE ROW LEVEL SECURITY;

-- Explicit deny-all policy. RLS already defaults to deny with zero
-- policies, but an RLS-enabled table with no policies at all reads like an
-- oversight during review -- this makes "nobody but the service role" the
-- unambiguous, documented intent.
CREATE POLICY "No direct client access" ON pinterest_connections
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Safe status check the client calls directly (e.g. to render "Connected
-- as X" in Profile Settings) -- returns whether a connection exists and the
-- Pinterest username, never the tokens. LANGUAGE plpgsql deliberately: a
-- LANGUAGE sql function here is eligible for planner inlining, which can
-- silently defeat SECURITY DEFINER's RLS-bypass guarantee (bit us before,
-- see fix_lobby_admin_recursion.sql) -- plpgsql is never inlined.
CREATE OR REPLACE FUNCTION public.get_pinterest_connection_status()
RETURNS TABLE (connected boolean, pinterest_username text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT true, pc.pinterest_username
  FROM public.pinterest_connections pc
  WHERE pc.user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::text;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.get_pinterest_connection_status IS 'Client-safe Pinterest connection check -- never returns tokens.';

-- Lets a user disconnect their own account directly (no Edge Function
-- round-trip needed since this never touches the token values).
CREATE OR REPLACE FUNCTION public.disconnect_pinterest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.pinterest_connections WHERE user_id = auth.uid();
END;
$$;

-- =====================================================
-- traces.link_url -- generic click-through URL for embed traces, used by
-- the link-card fallback (and by images/embeds generally as an optional
-- "visit source" target) when the image itself fails to hotlink.
-- =====================================================

ALTER TABLE traces ADD COLUMN IF NOT EXISTS link_url text;
