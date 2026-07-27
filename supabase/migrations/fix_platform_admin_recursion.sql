-- Fixes two mistakes in add_platform_admin.sql.
--
-- 1. INFINITE RECURSION (the reported error)
--
-- That migration rewrote the lobbies SELECT policy using an older version as
-- its base -- one that contains an EXISTS subquery into lobby_access_lists.
-- fix_lobby_admin_recursion_v2.sql had deliberately removed exactly that:
-- lobby_access_lists' own policies subquery into lobbies, so a lobbies policy
-- that queries lobby_access_lists closes the cycle and Postgres aborts with
-- "infinite recursion detected in policy for relation lobbies".
--
-- The rule that migration established, restored here: lobbies policies use
-- plain per-row column comparisons only. Never a subquery into another table
-- whose policies can reach back.
--
-- 2. is_platform_admin() COULD NEVER RETURN TRUE
--
-- platform_admins was created with RLS enabled and no policies, on the
-- assumption that SECURITY DEFINER bypasses RLS. v2's comments record that it
-- does NOT in this project -- the function owner isn't treated as exempt. So
-- the function read a table it had no policy to read, found nothing, and
-- would have reported everyone as a non-admin even once the recursion was
-- fixed.
--
-- Fixed with a SELECT policy scoped to the caller's own row. That is exactly
-- what the function needs, and it leaks nothing: it only lets someone learn
-- whether they themselves are an admin, which they can already tell from
-- whether the app grants them access. Writes stay impossible -- there are
-- still no INSERT/UPDATE/DELETE policies, so membership can only be changed
-- with the service role.
--
-- The policy is a plain column comparison, so it adds no new edge to the
-- policy dependency graph and cannot reintroduce a cycle.

DROP POLICY IF EXISTS "Admins can check their own status" ON public.platform_admins;
CREATE POLICY "Admins can check their own status" ON public.platform_admins
  FOR SELECT
  USING (user_id = (select auth.uid()));

-- Back to plain column checks, plus the operator override. Whitelisted access
-- to private atriums is deliberately NOT expressed here for the reason above;
-- it is handled by the app querying lobby_access_lists directly, exactly as
-- it did before add_platform_admin.sql.
DROP POLICY IF EXISTS "Anyone can view public lobbies" ON public.lobbies;
CREATE POLICY "Anyone can view public lobbies" ON public.lobbies
  FOR SELECT
  USING (
    is_public = true
    OR owner_user_id = (select auth.uid())
    OR (select auth.uid()) = ANY(admin_user_ids)
    OR public.is_platform_admin()
  );
