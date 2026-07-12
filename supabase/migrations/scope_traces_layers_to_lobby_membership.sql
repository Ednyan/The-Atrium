-- Fix: traces and layers have had `USING (true)` RLS policies since the
-- original schema, predating the lobby system. Once lobbies gained real
-- access control (owner / public / whitelist / blacklist, see
-- add_lobby_system.sql), those policies were never updated to match, so any
-- authenticated user could read/write/delete traces or layers in ANY lobby
-- via a direct Supabase API call -- including private (whitelisted) lobbies
-- and lobbies they've been blacklisted from -- as long as they knew (or
-- guessed/enumerated) the lobby's UUID. The app UI itself always goes
-- through can_user_join_lobby() before showing atrium content, but that
-- check was never enforced at the database layer.
--
-- This adds a SECURITY DEFINER helper mirroring the membership logic already
-- used by can_user_join_lobby() (owner, or public+not-blacklisted, or
-- whitelisted+not-blacklisted) and scopes traces/layers SELECT/INSERT/
-- UPDATE/DELETE to it.
--
-- Known residual gap (not fixed here): password-protected public lobbies.
-- Password verification happens once client-side at join time via
-- can_user_join_lobby(); there is no server-side session/membership record
-- created on success, so RLS has no state to check afterwards. An
-- authenticated user who never entered the password could still read/write
-- that lobby's traces directly via the API. Closing this fully would require
-- a persistent "verified membership" table populated by a server-side
-- password check -- a larger change, out of scope here.

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
      )
    )
  );
$$;

COMMENT ON FUNCTION public.user_can_access_lobby IS 'Mirrors can_user_join_lobby membership logic (owner, or public/whitelisted and not blacklisted) for use in traces/layers RLS policies. Does not check password -- see migration header.';

-- =====================================================
-- TRACES
-- =====================================================

DROP POLICY IF EXISTS "Allow public read access" ON public.traces;
DROP POLICY IF EXISTS "Allow public insert access" ON public.traces;
DROP POLICY IF EXISTS "Allow public update access" ON public.traces;
DROP POLICY IF EXISTS "Allow users to delete own traces" ON public.traces;

CREATE POLICY "Traces scoped to accessible lobby (select)" ON public.traces
  FOR SELECT
  USING (public.user_can_access_lobby(lobby_id));

CREATE POLICY "Traces scoped to accessible lobby (insert)" ON public.traces
  FOR INSERT
  WITH CHECK (public.user_can_access_lobby(lobby_id));

CREATE POLICY "Traces scoped to accessible lobby (update)" ON public.traces
  FOR UPDATE
  USING (public.user_can_access_lobby(lobby_id))
  WITH CHECK (public.user_can_access_lobby(lobby_id));

CREATE POLICY "Traces scoped to accessible lobby (delete)" ON public.traces
  FOR DELETE
  USING (public.user_can_access_lobby(lobby_id));

-- =====================================================
-- LAYERS
-- =====================================================

DROP POLICY IF EXISTS "Allow public read access to layers" ON public.layers;
DROP POLICY IF EXISTS "Allow public insert access to layers" ON public.layers;
DROP POLICY IF EXISTS "Allow public update access to layers" ON public.layers;
DROP POLICY IF EXISTS "Allow public delete access to layers" ON public.layers;

-- Layers with lobby_id = NULL (orphaned rows from before add_layers_lobby_id.sql
-- that couldn't be unambiguously backfilled) are intentionally inaccessible
-- here too: user_can_access_lobby(NULL) is always false.
CREATE POLICY "Layers scoped to accessible lobby (select)" ON public.layers
  FOR SELECT
  USING (public.user_can_access_lobby(lobby_id));

CREATE POLICY "Layers scoped to accessible lobby (insert)" ON public.layers
  FOR INSERT
  WITH CHECK (public.user_can_access_lobby(lobby_id));

CREATE POLICY "Layers scoped to accessible lobby (update)" ON public.layers
  FOR UPDATE
  USING (public.user_can_access_lobby(lobby_id))
  WITH CHECK (public.user_can_access_lobby(lobby_id));

CREATE POLICY "Layers scoped to accessible lobby (delete)" ON public.layers
  FOR DELETE
  USING (public.user_can_access_lobby(lobby_id));
