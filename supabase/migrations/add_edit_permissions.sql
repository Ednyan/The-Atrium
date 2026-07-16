-- Per-atrium editing permission: owner/admins can restrict who else is
-- allowed to create/modify/delete traces and layers, independent of who can
-- simply view the atrium (view access is still governed entirely by
-- user_can_access_lobby -- this only gates writes).
--
-- 'all'      -- anyone who can access the lobby can edit (default, current
--               behavior unchanged)
-- 'none'     -- only the owner and admins can edit
-- 'selected' -- owner, admins, and users on a new 'editor' access list

ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS edit_permission_mode text NOT NULL DEFAULT 'all'
  CHECK (edit_permission_mode IN ('all', 'none', 'selected'));

ALTER TABLE lobby_access_lists DROP CONSTRAINT IF EXISTS lobby_access_lists_list_type_check;
ALTER TABLE lobby_access_lists ADD CONSTRAINT lobby_access_lists_list_type_check
  CHECK (list_type IN ('whitelist', 'blacklist', 'editor'));

CREATE OR REPLACE FUNCTION public.user_can_edit_lobby(p_lobby_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_mode text;
  v_owner uuid;
  v_admins uuid[];
BEGIN
  SELECT edit_permission_mode, owner_user_id, admin_user_ids
  INTO v_mode, v_owner, v_admins
  FROM public.lobbies WHERE id = p_lobby_id;

  IF v_mode IS NULL THEN
    RETURN false; -- lobby not found
  END IF;

  -- Must already be a valid member (owner, public, or whitelisted+not
  -- blacklisted) before edit mode is even considered.
  IF NOT public.user_can_access_lobby(p_lobby_id) THEN
    RETURN false;
  END IF;

  IF v_owner = auth.uid() OR auth.uid() = ANY(v_admins) THEN
    RETURN true;
  END IF;

  IF v_mode = 'all' THEN
    RETURN true;
  ELSIF v_mode = 'selected' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.lobby_access_lists al
      WHERE al.lobby_id = p_lobby_id
      AND al.user_id = auth.uid()
      AND al.list_type = 'editor'
    );
  END IF;

  RETURN false; -- v_mode = 'none'
END;
$$;

COMMENT ON FUNCTION public.user_can_edit_lobby IS 'Gates trace/layer writes per lobbies.edit_permission_mode; owner and admins always pass. Independent of user_can_access_lobby, which still governs read/view access regardless of edit mode.';

-- =====================================================
-- TRACES -- select stays on user_can_access_lobby (view is unaffected);
-- insert/update/delete move to user_can_edit_lobby
-- =====================================================

DROP POLICY IF EXISTS "Traces scoped to accessible lobby (insert)" ON public.traces;
CREATE POLICY "Traces scoped to editable lobby (insert)" ON public.traces
  FOR INSERT
  WITH CHECK (public.user_can_edit_lobby(lobby_id));

DROP POLICY IF EXISTS "Traces scoped to accessible lobby (update)" ON public.traces;
CREATE POLICY "Traces scoped to editable lobby (update)" ON public.traces
  FOR UPDATE
  USING (public.user_can_edit_lobby(lobby_id))
  WITH CHECK (public.user_can_edit_lobby(lobby_id));

DROP POLICY IF EXISTS "Traces scoped to accessible lobby (delete)" ON public.traces;
CREATE POLICY "Traces scoped to editable lobby (delete)" ON public.traces
  FOR DELETE
  USING (public.user_can_edit_lobby(lobby_id));

-- =====================================================
-- LAYERS -- same split
-- =====================================================

DROP POLICY IF EXISTS "Layers scoped to accessible lobby (insert)" ON public.layers;
CREATE POLICY "Layers scoped to editable lobby (insert)" ON public.layers
  FOR INSERT
  WITH CHECK (public.user_can_edit_lobby(lobby_id));

DROP POLICY IF EXISTS "Layers scoped to accessible lobby (update)" ON public.layers;
CREATE POLICY "Layers scoped to editable lobby (update)" ON public.layers
  FOR UPDATE
  USING (public.user_can_edit_lobby(lobby_id))
  WITH CHECK (public.user_can_edit_lobby(lobby_id));

DROP POLICY IF EXISTS "Layers scoped to accessible lobby (delete)" ON public.layers;
CREATE POLICY "Layers scoped to editable lobby (delete)" ON public.layers
  FOR DELETE
  USING (public.user_can_edit_lobby(lobby_id));
