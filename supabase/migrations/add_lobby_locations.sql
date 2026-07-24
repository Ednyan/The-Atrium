-- Saved camera locations ("Locations" panel), a per-atrium shared list of
-- named camera views (position + zoom) editors can curate and anyone in the
-- atrium can jump to. Modeled on the layers table: per-lobby, ordered by an
-- order_index the panel reorders by drag, RLS split so reads follow
-- user_can_access_lobby and writes follow user_can_edit_lobby (owner/admin
-- always, others per the atrium's edit_permission_mode) exactly like layers.

CREATE TABLE IF NOT EXISTS public.lobby_locations (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
  lobby_id uuid NOT NULL REFERENCES public.lobbies(id) ON DELETE CASCADE,
  name text NOT NULL,
  position_x double precision NOT NULL,
  position_y double precision NOT NULL,
  zoom double precision NOT NULL DEFAULT 1,
  order_index integer NOT NULL DEFAULT 0,
  user_id text
);

CREATE INDEX IF NOT EXISTS lobby_locations_lobby_id_idx ON public.lobby_locations(lobby_id);
CREATE INDEX IF NOT EXISTS lobby_locations_order_idx ON public.lobby_locations(lobby_id, order_index);

ALTER TABLE public.lobby_locations ENABLE ROW LEVEL SECURITY;

-- Reads: anyone who can access the atrium (mirrors layers select).
CREATE POLICY "Locations scoped to accessible lobby (select)" ON public.lobby_locations
  FOR SELECT
  USING (public.user_can_access_lobby(lobby_id));

-- Writes: gated by edit permission, same split as traces/layers.
CREATE POLICY "Locations scoped to editable lobby (insert)" ON public.lobby_locations
  FOR INSERT
  WITH CHECK (public.user_can_edit_lobby(lobby_id));

CREATE POLICY "Locations scoped to editable lobby (update)" ON public.lobby_locations
  FOR UPDATE
  USING (public.user_can_edit_lobby(lobby_id))
  WITH CHECK (public.user_can_edit_lobby(lobby_id));

CREATE POLICY "Locations scoped to editable lobby (delete)" ON public.lobby_locations
  FOR DELETE
  USING (public.user_can_edit_lobby(lobby_id));

-- Realtime so a curated locations list stays in sync across everyone in the
-- atrium, same as layers.
ALTER PUBLICATION supabase_realtime ADD TABLE public.lobby_locations;

COMMENT ON TABLE public.lobby_locations IS 'Per-atrium shared named camera views (position + zoom) for the Locations panel and its presentation mode.';
