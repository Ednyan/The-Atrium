-- Restores the whitelist branch to the lobbies SELECT policy, which
-- add_platform_admin.sql dropped today.
--
-- WHAT HAPPENED
-- fix_whitelist_private_access.sql (2026-07-23) had already fixed exactly this
-- problem: it added lobbies.whitelisted_user_ids, a trigger keeping it in sync
-- with lobby_access_lists, and a policy branch checking it as a plain column
-- comparison. That works and is untouched here.
--
-- add_platform_admin.sql then rewrote the policy to add the operator override,
-- but built it from fix_rls_performance.sql (2026-01-04) as its base -- which
-- checks the whitelist with an EXISTS subquery into lobby_access_lists. That
-- reintroduced the RLS cycle and broke every read with "infinite recursion".
-- fix_platform_admin_recursion.sql then rebuilt it again from
-- fix_lobby_admin_recursion_v2.sql (2026-07-15), which has no whitelist branch
-- at all because it predates the fix. Recursion went away; whitelisted users
-- silently lost access to the private atriums they'd been invited to, leaving
-- promotion to admin as the only way in.
--
-- Two rewrites, two different stale migrations, neither of them the current
-- one. The lesson is narrow and worth stating: this policy has been rewritten
-- four times, so before touching it again, read the most recently applied
-- version rather than any file that merely looks authoritative.
--
-- This migration only recreates the policy, with every branch present. The
-- column and trigger from 07-23 already exist and are deliberately not
-- redefined -- re-adding the trigger under a new name would leave two
-- triggers recomputing the same cache on every access-list write.

-- Branches, and where each comes from:
--   is_public                      -- original
--   owner_user_id                  -- original
--   admin_user_ids                 -- fix_lobby_admin_recursion_v2 (07-15)
--   whitelisted_user_ids           -- fix_whitelist_private_access (07-23)
--   is_platform_admin()            -- add_platform_admin (07-27)
--
-- All five are plain per-row checks; is_platform_admin() reads only
-- platform_admins, which has no policy referring back to lobbies. Nothing here
-- subqueries lobby_access_lists, so the dependency graph stays acyclic.
DROP POLICY IF EXISTS "Anyone can view public lobbies" ON public.lobbies;
CREATE POLICY "Anyone can view public lobbies" ON public.lobbies
  FOR SELECT
  USING (
    is_public = true
    OR owner_user_id = (select auth.uid())
    OR (select auth.uid()) = ANY(admin_user_ids)
    OR (select auth.uid()) = ANY(whitelisted_user_ids)
    OR public.is_platform_admin()
  );

-- Safety net for anyone whose whitelist entries changed while the branch was
-- missing: the trigger only fires on writes to lobby_access_lists, so a stale
-- cache would otherwise persist until the next whitelist edit.
UPDATE public.lobbies l
SET whitelisted_user_ids = (
  SELECT COALESCE(array_agg(al.user_id), '{}')
  FROM public.lobby_access_lists al
  WHERE al.lobby_id = l.id AND al.list_type = 'whitelist'
)
WHERE whitelisted_user_ids IS DISTINCT FROM (
  SELECT COALESCE(array_agg(al.user_id), '{}')
  FROM public.lobby_access_lists al
  WHERE al.lobby_id = l.id AND al.list_type = 'whitelist'
);
