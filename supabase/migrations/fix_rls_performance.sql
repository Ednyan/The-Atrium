-- Fix RLS Performance Issues
-- This migration fixes auth.uid() calls that are re-evaluated per row
-- by wrapping them in (select auth.uid()) for better query planning

-- =====================================================
-- 1. FIX PROFILES TABLE RLS POLICIES
-- =====================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- Recreate with optimized auth calls
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT
  WITH CHECK ((select auth.uid()) = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- =====================================================
-- 2. MOVEMENT_TRAILS - DEPRECATED (will be dropped in section 7)
-- =====================================================

-- No policies needed - table will be dropped

-- =====================================================
-- 3. FIX LOBBIES TABLE RLS POLICIES
-- =====================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view public lobbies" ON public.lobbies;
DROP POLICY IF EXISTS "Users can create lobbies (max 3 per user enforced in app)" ON public.lobbies;
DROP POLICY IF EXISTS "Owners can update their lobbies" ON public.lobbies;
DROP POLICY IF EXISTS "Owners can delete their lobbies" ON public.lobbies;

-- Recreate with optimized auth calls
CREATE POLICY "Anyone can view public lobbies" ON public.lobbies
  FOR SELECT
  USING (
    is_public = true 
    OR owner_user_id = (select auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.lobby_access_lists
      WHERE lobby_id = id
      AND user_id = (select auth.uid())
      AND list_type = 'whitelist'
    )
  );

CREATE POLICY "Users can create lobbies (max 3 per user enforced in app)" ON public.lobbies
  FOR INSERT
  WITH CHECK ((select auth.uid()) = owner_user_id);

CREATE POLICY "Owners can update their lobbies" ON public.lobbies
  FOR UPDATE
  USING ((select auth.uid()) = owner_user_id)
  WITH CHECK ((select auth.uid()) = owner_user_id);

CREATE POLICY "Owners can delete their lobbies" ON public.lobbies
  FOR DELETE
  USING ((select auth.uid()) = owner_user_id);

-- =====================================================
-- 4. FIX LOBBY_ACCESS_LISTS TABLE RLS POLICIES
-- Consolidate multiple SELECT policies into one
-- IMPORTANT: Avoid circular reference with lobbies table
-- =====================================================

-- Drop existing overlapping policies
DROP POLICY IF EXISTS "Anyone can view access lists for lobbies they're in or own" ON public.lobby_access_lists;
DROP POLICY IF EXISTS "Lobby owners can manage access lists" ON public.lobby_access_lists;
DROP POLICY IF EXISTS "Users can view relevant access lists" ON public.lobby_access_lists;
DROP POLICY IF EXISTS "Lobby owners can insert access lists" ON public.lobby_access_lists;
DROP POLICY IF EXISTS "Lobby owners can update access lists" ON public.lobby_access_lists;
DROP POLICY IF EXISTS "Lobby owners can delete access lists" ON public.lobby_access_lists;

-- Create SELECT policy that doesn't reference lobbies to avoid circular dependency
-- Users can see access list entries where they are the subject or they added the entry
CREATE POLICY "Users can view relevant access lists" ON public.lobby_access_lists
  FOR SELECT
  USING (
    user_id = (select auth.uid())
    OR added_by = (select auth.uid())
  );

-- For INSERT/UPDATE/DELETE, we need to check lobby ownership
-- Use a security definer function to avoid RLS recursion
CREATE OR REPLACE FUNCTION public.is_lobby_owner(p_lobby_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.lobbies
    WHERE id = p_lobby_id
    AND owner_user_id = auth.uid()
  );
$$;

-- Separate policies for INSERT, UPDATE, DELETE using the security definer function
CREATE POLICY "Lobby owners can insert access lists" ON public.lobby_access_lists
  FOR INSERT
  WITH CHECK (public.is_lobby_owner(lobby_id));

CREATE POLICY "Lobby owners can update access lists" ON public.lobby_access_lists
  FOR UPDATE
  USING (public.is_lobby_owner(lobby_id))
  WITH CHECK (public.is_lobby_owner(lobby_id));

CREATE POLICY "Lobby owners can delete access lists" ON public.lobby_access_lists
  FOR DELETE
  USING (public.is_lobby_owner(lobby_id));

-- =====================================================
-- 5. FIX DUPLICATE INDEXES
-- =====================================================

-- Drop duplicate indexes on layers table
DROP INDEX IF EXISTS public.idx_layers_user_id;
-- Keep layers_user_id_idx

-- Drop duplicate indexes on traces table  
DROP INDEX IF EXISTS public.idx_traces_user_id;
-- Keep traces_user_id_idx

-- =====================================================
-- 6. ADD MISSING FOREIGN KEY INDEX
-- =====================================================

-- Add index for added_by foreign key on lobby_access_lists
CREATE INDEX IF NOT EXISTS idx_lobby_access_lists_added_by 
  ON public.lobby_access_lists(added_by);

-- =====================================================
-- 7. DROP DEPRECATED MOVEMENT_TRAILS TABLE
-- =====================================================

-- Drop policies first
DROP POLICY IF EXISTS "Users can insert their own trails" ON public.movement_trails;
DROP POLICY IF EXISTS "Users can delete their own trails" ON public.movement_trails;
DROP POLICY IF EXISTS "Anyone can read trails" ON public.movement_trails;

-- Drop indexes
DROP INDEX IF EXISTS public.idx_movement_trails_user_id;
DROP INDEX IF EXISTS public.idx_movement_trails_expires_at;

-- Drop the entire deprecated table
DROP TABLE IF EXISTS public.movement_trails CASCADE;
