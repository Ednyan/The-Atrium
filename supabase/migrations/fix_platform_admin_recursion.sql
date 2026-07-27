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
-- 2. BELT-AND-BRACES: a SELECT policy on platform_admins
--
-- The table was created with RLS enabled and no policies at all, relying on
-- SECURITY DEFINER to read it. That is probably fine -- can_user_join_lobby
-- reads platform_admins the same way and demonstrably works -- but v2's
-- comments claim SECURITY DEFINER does not reliably bypass RLS here, and a
-- table that nothing can read is an unpleasant thing to be unsure about.
--
-- So: a SELECT policy scoped to the caller's own row. That is exactly
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

-- SUPERSEDED by fix_lobbies_policy_restore_whitelist.sql -- run that too.
--
-- The policy below is missing its whitelist branch, and the claim that once
-- accompanied it (that whitelist access is "handled by the app querying
-- lobby_access_lists directly") was simply wrong. The app does read that table
-- for the user's own entries, but it then reads the lobbies rows by id, and
-- this policy is what refuses them. fix_whitelist_private_access.sql (07-23)
-- had already solved it with a whitelisted_user_ids column; this rewrite was
-- based on the 07-15 migration and dropped it.
DROP POLICY IF EXISTS "Anyone can view public lobbies" ON public.lobbies;
CREATE POLICY "Anyone can view public lobbies" ON public.lobbies
  FOR SELECT
  USING (
    is_public = true
    OR owner_user_id = (select auth.uid())
    OR (select auth.uid()) = ANY(admin_user_ids)
    OR public.is_platform_admin()
  );
